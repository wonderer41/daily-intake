import { HttpError } from "@/lib/api/http";
import { loadGoogleCalendarConfig } from "@/lib/integrations/google-calendar/config";
import { runCalendarSync } from "@/lib/worker/jobs";
import type { CalendarRunEntry } from "@/lib/worker/calendar-job";
import type { HermesCalendarChangedResult } from "@/types/dashboard-contracts";

// POST /api/hermes/calendar/changed: Hermes just created or moved an event, so pull every shown
// calendar now instead of waiting for the next poll. Syncs in this process run one at a time (a
// second request waits, then syncs again so it sees the newest change).

const globalForSync = globalThis as unknown as { hermesCalendarSync?: Promise<unknown> };

/** Google failures are reported as 502 so Hermes never mistakes a Google 401 for its own token being wrong. */
export function asUpstream(error: unknown, prefix: string): unknown {
  if (error instanceof HttpError) return new HttpError("UPSTREAM_ERROR", `${prefix}: ${error.message}`);
  return error;
}

/** Throws a 502 when Google Calendar is not set up on the dashboard. */
export function requireGoogleCalendar(env: NodeJS.ProcessEnv = process.env): ReturnType<typeof loadGoogleCalendarConfig> {
  try {
    return loadGoogleCalendarConfig(env);
  } catch (error) {
    throw asUpstream(error, "Google Calendar is not set up on the dashboard");
  }
}

/** The worker's calendar sync, one run at a time in this process. Rethrows Google failures as 502. */
export async function syncCalendarsSerialized(env: NodeJS.ProcessEnv = process.env): Promise<CalendarRunEntry[]> {
  const previous = globalForSync.hermesCalendarSync ?? Promise.resolve();
  // Same job as the worker runs, so the same timeline.changed rules apply (changed dates, and
  // today when a sync error appears or clears).
  const run: Promise<CalendarRunEntry[]> = previous.catch(() => undefined).then(() => runCalendarSync(new Date(), env));
  globalForSync.hermesCalendarSync = run;
  try {
    return await run;
  } catch (error) {
    throw asUpstream(error, "Google Calendar sync failed");
  }
}

export function summarizeCalendarRun(entries: readonly CalendarRunEntry[]): HermesCalendarChangedResult {
  const calendars = entries.map(({ sync, name }) => ({
    calendarId: sync.calendarId,
    name,
    changedDates: sync.changedDates,
    created: sync.created,
    updated: sync.updated,
    cancelled: sync.cancelled,
    unchanged: sync.unchanged,
  }));
  const sum = (field: "created" | "updated" | "cancelled" | "unchanged") => calendars.reduce((total, calendar) => total + calendar[field], 0);
  return {
    calendarId: calendars[0]?.calendarId ?? "",
    changedDates: [...new Set(calendars.flatMap((calendar) => calendar.changedDates))].sort(),
    created: sum("created"),
    updated: sum("updated"),
    cancelled: sum("cancelled"),
    unchanged: sum("unchanged"),
    syncedAt: entries[0]?.sync.syncedAt ?? new Date().toISOString(),
    calendars,
  };
}

export async function syncCalendarNow(env: NodeJS.ProcessEnv = process.env): Promise<HermesCalendarChangedResult> {
  requireGoogleCalendar(env);
  return summarizeCalendarRun(await syncCalendarsSerialized(env));
}
