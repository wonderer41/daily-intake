import { prisma } from "@/lib/db/prisma";

// D4: which Google calendars the timeline shows. The booking calendar (GOOGLE_CALENDAR_ID, where
// blocks booked from the page go) is always shown; Hermes adds the others to CalendarSource.

export interface CalendarSourceRow {
  calendarId: string;
  name: string;
}

/** GOOGLE_CALENDAR_ID, or undefined when Google Calendar is not set up. */
export function bookingCalendarId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.GOOGLE_CALENDAR_ID?.trim() || undefined;
}

/** True for the booking calendar, also when GOOGLE_CALENDAR_ID is the "primary" alias and Google lists it by its real id. */
export function isBookingCalendar(calendar: { id: string; primary: boolean }, bookingId: string | undefined): boolean {
  if (!bookingId) return false;
  return calendar.id === bookingId || (bookingId === "primary" && calendar.primary);
}

export function readCalendarSources(): Promise<CalendarSourceRow[]> {
  return prisma.calendarSource.findMany({ orderBy: [{ createdAt: "asc" }, { calendarId: "asc" }], select: { calendarId: true, name: true } });
}

export interface ShownCalendar {
  calendarId: string;
  /** CalendarSource name; null for the booking calendar. */
  name: string | null;
}

/** The booking calendar first, then the CalendarSource rows. Empty when Google Calendar is not set up. */
export function shownCalendars(bookingId: string | undefined, sources: readonly CalendarSourceRow[]): ShownCalendar[] {
  if (!bookingId) return [];
  const shown: ShownCalendar[] = [{ calendarId: bookingId, name: null }];
  for (const source of sources) {
    if (source.calendarId !== bookingId) shown.push({ calendarId: source.calendarId, name: source.name });
  }
  return shown;
}

export async function readShownCalendars(env: NodeJS.ProcessEnv = process.env): Promise<ShownCalendar[]> {
  const bookingId = bookingCalendarId(env);
  return bookingId ? shownCalendars(bookingId, await readCalendarSources()) : [];
}

export interface SyncStateRow {
  calendarId: string;
  lastSyncAt: Date | null;
  lastError: string | null;
}

/**
 * One health line for the timeline across every shown calendar. lastSyncAt is the oldest one (null
 * until every calendar has synced once). Errors are grouped by message, so a shared Google failure
 * shows once; an error only some extra calendars have is prefixed with their names.
 */
export function combineSyncStates(
  calendars: readonly ShownCalendar[],
  states: readonly SyncStateRow[],
): { lastSyncAt: Date | null; syncError: string | null } {
  const byId = new Map(states.map((state) => [state.calendarId, state]));
  let lastSyncAt: Date | null = null;
  let allSynced = calendars.length > 0;
  const errors = new Map<string, ShownCalendar[]>();

  for (const calendar of calendars) {
    const state = byId.get(calendar.calendarId);
    if (!state?.lastSyncAt) allSynced = false;
    else if (!lastSyncAt || state.lastSyncAt < lastSyncAt) lastSyncAt = state.lastSyncAt;
    if (state?.lastError) errors.set(state.lastError, [...(errors.get(state.lastError) ?? []), calendar]);
  }

  const lines = [...errors].map(([message, failing]) => {
    const everyone = failing.length === calendars.length;
    const named = failing.every((calendar) => calendar.name !== null);
    return everyone || !named ? message : `${failing.map((calendar) => calendar.name).join(", ")}: ${message}`;
  });
  return { lastSyncAt: allSynced ? lastSyncAt : null, syncError: lines.length ? lines.join(" · ") : null };
}
