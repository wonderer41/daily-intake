import { prisma } from "@/lib/db/prisma";
import { syncCalendarTimeline } from "@/lib/integrations/google-calendar/timeline-sync";
import { orphansDir, readOrphansFolder } from "@/lib/integrations/orphans/folder";
import { formatOrphansCheck, lastWeeklyCheckAt, runOrphansCheck } from "@/lib/integrations/orphans/sync";
import { isSeerrConfigured } from "@/lib/integrations/seerr/config";
import { syncSeerrImportant } from "@/lib/integrations/seerr/important";
import { checkSeerrPending } from "@/lib/integrations/seerr/pending";
import { syncStockHistory, syncStockQuotes } from "@/lib/integrations/stocks/sync";
import { runPushReviewQueue } from "@/lib/push-review/runner";
import { runScheduleQueue } from "@/lib/schedule/runner";
import { publishLiveEvent, sendLiveEvent } from "@/lib/live/publish";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import { type CalendarJobResult, formatCalendarJobResult, syncCalendarAndPublish } from "./calendar-job";
import { runGithubSyncJob } from "./github-job";
import { formatRetentionResult, runRetention } from "./retention";
import type { WorkerJob } from "./scheduler";

const MINUTE = 60_000;

/** Calendar sync + live updates, wired to the real database, Google and NOTIFY. */
export function runCalendarSync(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<CalendarJobResult> {
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  return syncCalendarAndPublish(now, dashboardTimeZone(env), {
    sync: (at) => syncCalendarTimeline(at, env),
    readSyncError: async () => {
      if (!calendarId) return undefined;
      const state = await prisma.calendarSyncState.findUnique({ where: { calendarId }, select: { lastError: true } });
      return state?.lastError ?? null;
    },
    publish: publishLiveEvent,
  });
}

// Pending count from the previous poll; checkSeerrPending publishes seerr.changed when it differs.
let lastSeerrPending: number | null = null;

function failedSummary(failed: { symbol: string }[]): string {
  return failed.length ? ` · failed ${failed.map((entry) => entry.symbol).join(", ")}` : "";
}

/**
 * Every job the worker container runs. To add one, append
 * a single entry. `run` returns a short summary (counts, never secrets) for the log line, and should publish the
 * LiveEvents for whatever it changed. Throwing marks the run failed; the job still runs next time.
 */
export const workerJobs: WorkerJob[] = [
  {
    name: "calendar-sync",
    trigger: { everyMs: 2 * MINUTE },
    run: async ({ now }) => formatCalendarJobResult(await runCalendarSync(now)),
  },
  {
    name: "day-rollover",
    trigger: { dailyAt: { hour: 0, minute: 0 } },
    run: async ({ scheduledFor, timeZone }) => {
      // The planned instant is exactly local midnight, so its date is the new day even if the timer fired early.
      const date = localDateString(scheduledFor, timeZone);
      await sendLiveEvent({ type: "day.rollover", date });
      return `day.rollover ${date}`;
    },
  },
  {
    name: "retention",
    trigger: { dailyAt: { hour: 3, minute: 30 } },
    run: async ({ now, timeZone }) => formatRetentionResult(await runRetention(prisma, now, timeZone)),
  },
  {
    // Notes panel Seerr count (the first poll after a restart publishes too), then the Important
    // entries for requests waiting too long. Seerr is optional: without SEERR_URL / SEERR_API_KEY the
    // job does nothing and logs nothing.
    name: "seerr-poll",
    trigger: { everyMs: 2 * MINUTE },
    quiet: true,
    run: async ({ now }) => {
      if (!isSeerrConfigured()) return;
      const result = await checkSeerrPending(lastSeerrPending);
      lastSeerrPending = result.count;
      const important = await syncSeerrImportant(now);
      const changes = [important.opened && `+${important.opened}`, important.resolved && `${important.resolved} resolved`].filter(Boolean);
      return `${result.count} pending${result.changed ? " · changed" : ""} · ${important.waiting} in Important${changes.length ? ` (${changes.join(", ")})` : ""}`;
    },
  },
  {
    // The orphaned_data list (ORPHANS_DIR): every Wednesday, an hour after the orphan pipeline's 06:00
    // run, plus a catch-up at start when the worker was down then. Off without ORPHANS_DIR.
    name: "orphans-check",
    trigger: { weeklyAt: { weekday: 3, hour: 7, minute: 0 } },
    // Off: nothing to catch up.
    lastRunAt: async () => (orphansDir() ? lastWeeklyCheckAt() : new Date()),
    run: async ({ now, scheduledFor, timeZone }) => {
      const dir = orphansDir();
      if (!dir) return "off (ORPHANS_DIR not set)";
      return formatOrphansCheck(await runOrphansCheck({ dir, mode: "weekly", runFor: scheduledFor, now, timeZone }));
    },
  },
  {
    // Hourly look at the orphans folder. Only logs (as a failed run) when it isn't mounted or readable;
    // the Wednesday check is what raises it in Important.
    name: "orphans-mount",
    trigger: { everyMs: 60 * MINUTE },
    quiet: true,
    run: async () => {
      const dir = orphansDir();
      if (!dir) return;
      const folder = await readOrphansFolder(dir);
      if (!folder.ok) throw new Error(folder.problem);
    },
  },
  {
    // Finnhub quotes → stocks banner snapshot (D9). Publishes banner.updated itself.
    name: "stocks-quotes",
    trigger: { everyMs: 5 * MINUTE },
    run: async ({ now }) => {
      const result = await syncStockQuotes(now);
      return `${result.snapshot.rows.length} rows${failedSummary(result.failed)}`;
    },
  },
  {
    // Tiingo end-of-day history → cached 6-month change per symbol; runs once the previous close is final.
    name: "stocks-history",
    trigger: { dailyAt: { hour: 5, minute: 0 } },
    run: async ({ now }) => {
      const result = await syncStockHistory(now);
      return `updated ${result.updated.length} · skipped ${result.skipped.length}${failedSummary(result.failed)}`;
    },
  },
  {
    // GitHub → the card meta line (D7: read-only; publishes card.upserted for cards whose data changed),
    // then the push watch: the newest commit on each card repo's default branch and open pull requests.
    name: "github-sync",
    trigger: { everyMs: 5 * MINUTE },
    run: async ({ now }) => runGithubSyncJob(now),
  },
  {
    // Push review: asks Hermes which open items the new commits move forward and writes its push
    // updates. Each review runs in the background (up to 10 min, 2 at once), so a tick only picks up new ones.
    name: "push-review",
    trigger: { everyMs: 5_000 },
    quiet: true,
    run: async () => runPushReviewQueue(),
  },
  {
    // "Ask Hermes" in the scheduling bubble: hands new requests to Hermes and settles them from its answer.
    // Each request runs in the background (up to 2 min), so a tick only picks up new ones.
    name: "schedule-runner",
    trigger: { everyMs: 2_000 },
    quiet: true,
    run: async () => runScheduleQueue({ syncCalendar: () => runCalendarSync() }),
  },
];
