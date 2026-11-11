import { HttpError } from "@/lib/api/http";
import type { ShownCalendar } from "@/lib/integrations/google-calendar/sources";
import type { CalendarSyncResult } from "@/lib/integrations/google-calendar/timeline-sync";
import { localDateString } from "@/lib/time/zone";
import type { LiveEvent } from "@/types/dashboard-contracts";

export interface CalendarJobDeps {
  sync: (now: Date) => Promise<CalendarSyncResult>;
  /** CalendarSyncState.lastError for the configured calendar; undefined when unknown. */
  readSyncError: () => Promise<string | null | undefined>;
  publish: (event: LiveEvent) => Promise<void>;
}

export interface CalendarJobResult {
  sync: CalendarSyncResult;
  publishedDates: string[];
}

/**
 * Dates that get a `timeline.changed` event: every date the sync changed, plus today when the
 * stored sync error appeared, changed or cleared (the timeline shows it as `syncError`).
 */
export function timelineDatesToPublish(changedDates: string[], today: string, errorBefore: string | null | undefined, errorAfter: string | null | undefined): string[] {
  const dates = new Set(changedDates);
  if (errorBefore !== undefined && errorAfter !== undefined && (errorBefore ?? null) !== (errorAfter ?? null)) dates.add(today);
  return [...dates].sort();
}

async function readSafely(deps: CalendarJobDeps): Promise<string | null | undefined> {
  try {
    return await deps.readSyncError();
  } catch {
    return undefined;
  }
}

/**
 * One calendar-sync run: syncs the CalendarEvent cache and publishes `timeline.changed` for each
 * affected local date. Used by the worker job and by `npm run sync:calendar`. Rethrows sync errors
 * after publishing the error state, so the caller logs the failure.
 */
export async function syncCalendarAndPublish(now: Date, timeZone: string, deps: CalendarJobDeps): Promise<CalendarJobResult> {
  const today = localDateString(now, timeZone);
  const errorBefore = await readSafely(deps);
  let sync: CalendarSyncResult;
  try {
    sync = await deps.sync(now);
  } catch (error) {
    const errorAfter = await readSafely(deps);
    for (const date of timelineDatesToPublish([], today, errorBefore, errorAfter)) {
      await deps.publish({ type: "timeline.changed", date });
    }
    throw error;
  }

  // A successful sync always clears lastError.
  const publishedDates = timelineDatesToPublish(sync.changedDates, today, errorBefore, errorBefore === undefined ? undefined : null);
  for (const date of publishedDates) await deps.publish({ type: "timeline.changed", date });
  return { sync, publishedDates };
}

export function formatCalendarJobResult({ sync, publishedDates }: CalendarJobResult): string {
  const counts = `fetched ${sync.fetched} · created ${sync.created} · updated ${sync.updated} · cancelled ${sync.cancelled} · unchanged ${sync.unchanged}`;
  const incomplete = sync.complete ? "" : " · incomplete window";
  const published = publishedDates.length ? ` · timeline.changed ${publishedDates.join(", ")}` : "";
  return `${counts}${incomplete}${published}`;
}

// ---------- Every shown calendar (D4) ----------

export interface CalendarRunEntry extends CalendarJobResult {
  /** CalendarSource name; null for the booking calendar. */
  name: string | null;
}

interface CalendarFailure {
  calendar: ShownCalendar;
  error: unknown;
}

function calendarLabel(calendar: { calendarId: string; name: string | null }): string {
  return calendar.name ?? calendar.calendarId;
}

/**
 * One error for a run where some calendars failed. The booking calendar failing alone keeps its own
 * error (same as before there were several calendars); otherwise Google errors are joined, each with
 * its calendar's name, and anything that isn't a Google error is rethrown as is.
 */
export function combineCalendarFailures(failures: readonly CalendarFailure[]): unknown {
  if (failures.length === 1 && failures[0].calendar.name === null) return failures[0].error;
  const other = failures.find((failure) => !(failure.error instanceof HttpError));
  if (other) return other.error;
  const message = failures.map((failure) => `${calendarLabel(failure.calendar)}: ${(failure.error as HttpError).message}`).join("; ");
  return new HttpError("UPSTREAM_ERROR", message);
}

/**
 * Syncs each shown calendar in turn with syncCalendarAndPublish. A calendar that fails doesn't stop
 * the others; once all ran, the failures are thrown as one error (see combineCalendarFailures).
 */
export async function syncCalendarsAndPublish(
  now: Date,
  timeZone: string,
  calendars: readonly ShownCalendar[],
  depsFor: (calendarId: string) => CalendarJobDeps,
): Promise<CalendarRunEntry[]> {
  const entries: CalendarRunEntry[] = [];
  const failures: CalendarFailure[] = [];
  for (const calendar of calendars) {
    try {
      entries.push({ ...(await syncCalendarAndPublish(now, timeZone, depsFor(calendar.calendarId))), name: calendar.name });
    } catch (error) {
      failures.push({ calendar, error });
    }
  }
  if (failures.length) throw combineCalendarFailures(failures);
  return entries;
}

/** The worker's log line: one calendar keeps the short form, several are each prefixed with their name. */
export function formatCalendarRun(entries: readonly CalendarRunEntry[]): string {
  if (entries.length === 1) return formatCalendarJobResult(entries[0]);
  return entries.map((entry) => `${calendarLabel({ calendarId: entry.sync.calendarId, name: entry.name })}: ${formatCalendarJobResult(entry)}`).join(" | ");
}
