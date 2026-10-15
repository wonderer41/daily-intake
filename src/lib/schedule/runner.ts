import type { ScheduleRequest } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import { safeErrorMessage } from "@/lib/live/redact";
import { dashboardTimeZone, formatClock, localDateString } from "@/lib/time/zone";
import { getRun, HermesApiError, isTerminal, loadHermesApiConfig, startRun, stopRun, type RunState } from "./hermes-runs";
import { couldNotBookMessage, SCHEDULE_MESSAGES } from "./messages";
import { bookingPrompt, parseHermesReply, type BookingSubject } from "./prompt";
import { cachedBusy, firstOverlap, settleScheduleRequest, suggestStart, withMessage, type CachedEvent } from "./service";

// The worker's schedule-runner job: hands each "checking" request to Hermes's API server, polls the
// run until it ends (2 min at most, counted from when the request was made), and settles the request
// from Hermes's one-line JSON answer. A request whose run already started is resumed after a worker
// restart instead of being booked twice; the run's Idempotency-Key is the request id as well.

/** Hermes gets this long from the moment the request was made; the bubble waits a little longer. */
export const SCHEDULE_TIMEOUT_MS = 120_000;
const POLL_MS = 2_000;

export interface RunnerDeps {
  /** The calendar sync (with its live updates), so a new or moved block reaches the cache right away. */
  syncCalendar: () => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
}

const inFlight = new Set<string>();

/** One tick: starts work on every "checking" request this process isn't already handling. */
export async function runScheduleQueue(deps: RunnerDeps): Promise<string> {
  const rows = await prisma.scheduleRequest.findMany({ where: { status: "checking" }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true } });
  let started = 0;
  for (const { id } of rows) {
    if (inFlight.has(id)) continue;
    inFlight.add(id);
    started += 1;
    void processScheduleRequest(id, deps)
      .then((outcome) => console.log(`[schedule] ${id} ${outcome}`))
      .catch((error: unknown) => console.error(`[schedule] ${id} failed: ${safeErrorMessage(error)}`))
      .finally(() => inFlight.delete(id));
  }
  return started ? `picked up ${started}` : "";
}

function hermesSays(text: string) {
  return { who: "hermes" as const, text, at: new Date().toISOString() };
}

async function fail(row: Pick<ScheduleRequest, "id" | "transcript">, message: string): Promise<void> {
  await settleScheduleRequest(row.id, { status: "failed", error: message, transcript: withMessage(row, hermesSays(message)) });
}

async function loadRequest(id: string) {
  return prisma.scheduleRequest.findUnique({
    where: { id },
    include: {
      checklistItem: { select: { id: true, cardId: true, title: true, issueNumber: true, sourceUrl: true, card: { select: { title: true } } } },
      alert: { select: { id: true, title: true } },
    },
  });
}

type RequestRow = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

function subjectOf(row: RequestRow): BookingSubject | null {
  if (row.checklistItem) {
    const item = row.checklistItem;
    return { kind: "item", id: item.id, cardTitle: item.card.title, itemTitle: item.title, issueNumber: item.issueNumber, url: item.sourceUrl };
  }
  return row.alert ? { kind: "alert", id: row.alert.id, title: row.alert.title } : null;
}

export async function processScheduleRequest(id: string, deps: RunnerDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const row = await loadRequest(id);
  if (!row || row.status !== "checking") return "skipped (already settled)";
  const deadline = row.createdAt.getTime() + SCHEDULE_TIMEOUT_MS;
  const config = loadHermesApiConfig(env);
  if (!config) {
    await fail(row, SCHEDULE_MESSAGES.notConfigured);
    return "failed: HERMES_API_URL / HERMES_API_KEY not set";
  }

  let runId = row.hermesRunId;
  if (!runId) {
    const subject = subjectOf(row);
    if (!subject) {
      await fail(row, "That item is gone, so there is nothing to book.");
      return "failed: target deleted";
    }
    const timeZone = dashboardTimeZone(env);
    const end = new Date(row.requestedStart.getTime() + row.durationMin * 60_000);
    const prompt = bookingPrompt({ subject, calendarId: env.GOOGLE_CALENDAR_ID?.trim() || "primary", timeZone, start: row.requestedStart, end });
    try {
      runId = await startRun(config, prompt, row.id);
    } catch (error) {
      const busy = error instanceof HermesApiError && error.busy;
      await fail(row, busy ? SCHEDULE_MESSAGES.busy : SCHEDULE_MESSAGES.noAnswer);
      return `failed to start the run: ${safeErrorMessage(error)}`;
    }
    // Saved only while still "checking": if the bubble cancelled meanwhile, stop the run we just started.
    const { count } = await prisma.scheduleRequest.updateMany({ where: { id, status: "checking" }, data: { hermesRunId: runId } });
    if (count === 0) {
      await stopRun(config, runId);
      return "cancelled before the run was saved";
    }
  }

  for (;;) {
    if (Date.now() > deadline) {
      await stopRun(config, runId);
      await fail(row, SCHEDULE_MESSAGES.noAnswer);
      return `timed out (run ${runId})`;
    }
    const state = await getRun(config, runId).catch(() => null); // a blip: try again until the deadline
    if (state && isTerminal(state.status)) return settleFromRun(row, state, deps, env);
    const current = await prisma.scheduleRequest.findUnique({ where: { id }, select: { status: true } });
    if (current?.status !== "checking") {
      await stopRun(config, runId);
      return "cancelled by the page";
    }
    await sleep(POLL_MS);
  }
}

async function syncQuietly(deps: RunnerDeps): Promise<void> {
  try {
    await deps.syncCalendar();
  } catch (error) {
    console.error(`[schedule] calendar sync after Hermes's answer failed: ${safeErrorMessage(error)}`);
  }
}

async function publishTarget(row: RequestRow): Promise<void> {
  if (row.checklistItem) await publishLiveEvent({ type: "item.upserted", cardId: row.checklistItem.cardId, itemId: row.checklistItem.id });
  else if (row.alert) await publishLiveEvent({ type: "alert.changed", alertId: row.alert.id });
}

async function settleFromRun(row: RequestRow, state: RunState, deps: RunnerDeps, env: NodeJS.ProcessEnv): Promise<string> {
  if (state.status !== "completed") {
    await fail(row, SCHEDULE_MESSAGES.noAnswer);
    return `run ended ${state.status}`;
  }
  const reply = parseHermesReply(state.output);
  if (!reply) {
    await fail(row, SCHEDULE_MESSAGES.unreadable);
    return "unreadable answer";
  }
  if (reply.status === "error") {
    await fail(row, couldNotBookMessage(reply.message));
    return "Hermes reported an error";
  }

  // Booked or conflict: refresh the cache so the new block (or the event Hermes saw) is there.
  await syncQuietly(deps);
  const timeZone = dashboardTimeZone(env);

  if (reply.status === "booked") {
    const calendarId = env.GOOGLE_CALENDAR_ID?.trim() || "primary";
    const cached = await prisma.calendarEvent.findUnique({ where: { calendarId_externalId: { calendarId, externalId: reply.eventId } }, select: { id: true } });
    if (!cached) {
      console.warn(
        `[schedule] Hermes booked event ${reply.eventId}, but it is not in the dashboard's calendar (${calendarId}). ` +
          "Hermes and the dashboard may be signed in to different Google accounts.",
      );
    }
    const settled = await settleScheduleRequest(row.id, {
      status: "booked",
      calendarEventId: cached?.id ?? null,
      transcript: withMessage(row, hermesSays("Done. It's on your calendar.")),
    });
    if (settled) await publishTarget(row);
    return cached ? "booked" : "booked (event not in the dashboard's calendar)";
  }

  const date = localDateString(row.requestedStart, timeZone);
  const [hours, minutes] = formatClock(row.requestedStart, timeZone).split(":").map(Number);
  const target = row.checklistItemId ? { kind: "item" as const, id: row.checklistItemId } : { kind: "alert" as const, id: row.alertId ?? "" };
  const end = new Date(row.requestedStart.getTime() + row.durationMin * 60_000);
  const busy: CachedEvent[] = await cachedBusy(date, timeZone, target);
  const clash = firstOverlap(busy, row.requestedStart, end);
  // Count what Hermes saw too, in case the cache still lacks it.
  const seen = reply.start && reply.end ? [{ id: "", title: reply.title ?? "", startsAt: reply.start, endsAt: reply.end }] : [];
  const suggested = suggestStart([...busy, ...seen], { date, startMin: hours * 60 + minutes, durationMin: row.durationMin }, new Date(), timeZone);
  const title = clash?.title ?? reply.title ?? "something else";
  await settleScheduleRequest(row.id, {
    status: "conflict",
    conflictEventId: clash?.id ?? null,
    suggestedStart: suggested,
    transcript: withMessage(row, hermesSays(`I can't book that: ${title} is on your calendar then.`)),
  });
  return "conflict";
}
