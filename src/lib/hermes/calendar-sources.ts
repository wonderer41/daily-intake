import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { fetchGoogleCalendarList, type GoogleCalendarListEntry } from "@/lib/integrations/google-calendar/client";
import {
  isBookingCalendar,
  readCalendarSources,
  type CalendarSourceRow,
  type SyncStateRow,
} from "@/lib/integrations/google-calendar/sources";
import { publishLiveEvent } from "@/lib/live/publish";
import { safeErrorMessage } from "@/lib/live/redact";
import { addDays, dashboardTimeZone, datesSpanned, dayBounds, localDateString } from "@/lib/time/zone";
import type { HermesCalendarSource, HermesCalendarSources, HermesCalendarSourcesResult } from "@/types/dashboard-contracts";
import { asUpstream, requireGoogleCalendar, syncCalendarsSerialized } from "./calendar";

// D4: GET and PUT /api/hermes/calendar/sources. Hermes shows the user's Google calendars and
// changes which ones the timeline shows. The booking calendar (GOOGLE_CALENDAR_ID) is always shown.

const NAME_MAX = 200;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Every calendar on the account, plus shown calendars Google no longer lists, booking calendar first. */
export function composeCalendarSources(
  google: readonly GoogleCalendarListEntry[],
  sources: readonly CalendarSourceRow[],
  states: readonly SyncStateRow[],
  bookingId: string,
): HermesCalendarSource[] {
  const stateById = new Map(states.map((state) => [state.calendarId, state]));
  const sourceIds = new Set(sources.map((source) => source.calendarId));
  const health = (calendarId: string) => {
    const state = stateById.get(calendarId);
    return { lastSyncAt: iso(state?.lastSyncAt), syncError: state?.lastError ?? null };
  };

  const onAccount: HermesCalendarSource[] = google.map((calendar) => {
    const locked = isBookingCalendar(calendar, bookingId);
    const shown = locked || sourceIds.has(calendar.id);
    // The booking calendar's sync state is stored under GOOGLE_CALENDAR_ID, which may be "primary".
    const state = shown ? health(locked ? bookingId : calendar.id) : { lastSyncAt: null, syncError: null };
    return { id: calendar.id, name: calendar.name, primary: calendar.primary, shown, locked, onAccount: true, ...state };
  });
  const booking = onAccount.filter((calendar) => calendar.locked);
  const rest = onAccount.filter((calendar) => !calendar.locked);
  if (booking.length === 0) {
    booking.push({ id: bookingId, name: bookingId, primary: bookingId === "primary", shown: true, locked: true, onAccount: false, ...health(bookingId) });
  }

  const listed = new Set(google.map((calendar) => calendar.id));
  const gone: HermesCalendarSource[] = sources
    .filter((source) => !listed.has(source.calendarId) && source.calendarId !== bookingId)
    .map((source) => ({ id: source.calendarId, name: source.name, primary: false, shown: true, locked: false, onAccount: false, ...health(source.calendarId) }));

  return [...booking, ...rest, ...gone];
}

/**
 * Matches the requested ids against the account's calendars. The booking calendar (by id, or as
 * "primary") is dropped because it is always shown; "primary" names the account's main calendar.
 */
export function resolveCalendarIds(
  requested: readonly string[],
  google: readonly GoogleCalendarListEntry[],
  bookingId: string,
): { keep: GoogleCalendarListEntry[]; unknown: string[] } {
  const byId = new Map(google.map((calendar) => [calendar.id, calendar]));
  const keep = new Map<string, GoogleCalendarListEntry>();
  const unknown: string[] = [];
  for (const id of requested) {
    if (id === bookingId) continue;
    const calendar = id === "primary" ? google.find((entry) => entry.primary) : byId.get(id);
    if (!calendar) unknown.push(id);
    else if (!isBookingCalendar(calendar, bookingId)) keep.set(calendar.id, calendar);
  }
  return { keep: [...keep.values()], unknown };
}

async function readGoogleList(config: ReturnType<typeof requireGoogleCalendar>): Promise<GoogleCalendarListEntry[]> {
  try {
    return await fetchGoogleCalendarList(config);
  } catch (error) {
    throw asUpstream(error, "Could not read the Google calendar list");
  }
}

async function readStates(calendarIds: string[]): Promise<SyncStateRow[]> {
  if (calendarIds.length === 0) return [];
  return prisma.calendarSyncState.findMany({
    where: { calendarId: { in: calendarIds } },
    select: { calendarId: true, lastSyncAt: true, lastError: true },
  });
}

async function compose(google: GoogleCalendarListEntry[], bookingId: string): Promise<HermesCalendarSources> {
  const sources = await readCalendarSources();
  const states = await readStates([bookingId, ...sources.map((source) => source.calendarId)]);
  return { calendars: composeCalendarSources(google, sources, states, bookingId) };
}

export async function getCalendarSources(env: NodeJS.ProcessEnv = process.env): Promise<HermesCalendarSources> {
  const config = requireGoogleCalendar(env);
  return compose(await readGoogleList(config), config.calendarId);
}

/**
 * PUT /api/hermes/calendar/sources. `calendarIds` is already validated and de-duplicated. Removed
 * calendars lose their cached events right away; added ones are synced before the response.
 */
export async function setCalendarSources(
  calendarIds: string[],
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<HermesCalendarSourcesResult> {
  const config = requireGoogleCalendar(env);
  const bookingId = config.calendarId;
  const google = await readGoogleList(config);
  const { keep, unknown } = resolveCalendarIds(calendarIds, google, bookingId);
  if (unknown.length) {
    throw new HttpError(
      "VALIDATION_ERROR",
      `Not a calendar on the Google account: ${unknown.join(", ")}. GET /api/hermes/calendar/sources lists the ones you can show.`,
      { field: "calendarIds", unknown },
    );
  }

  const timeZone = dashboardTimeZone(env);
  const today = localDateString(now, timeZone);
  const keepIds = new Set(keep.map((calendar) => calendar.id));
  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.calendarSource.findMany({ select: { calendarId: true } });
    const beforeIds = new Set(before.map((row) => row.calendarId));
    const removed = before.map((row) => row.calendarId).filter((id) => !keepIds.has(id));
    const added = keep.filter((calendar) => !beforeIds.has(calendar.id));

    // Dates the page may be showing (from yesterday on, like the sync window) that lose events.
    const removedEvents = removed.length
      ? await tx.calendarEvent.findMany({
          where: { calendarId: { in: removed }, status: { not: "cancelled" }, endsAt: { gt: dayBounds(addDays(today, -1), timeZone).start } },
          select: { startsAt: true, endsAt: true },
        })
      : [];
    if (removed.length) {
      await tx.calendarEvent.deleteMany({ where: { calendarId: { in: removed } } });
      await tx.calendarSyncState.deleteMany({ where: { calendarId: { in: removed } } });
      await tx.calendarSource.deleteMany({ where: { calendarId: { in: removed } } });
    }
    for (const calendar of keep) {
      const name = calendar.name.slice(0, NAME_MAX);
      await tx.calendarSource.upsert({
        where: { calendarId: calendar.id },
        create: { calendarId: calendar.id, name, addedBy: "hermes" },
        update: { name },
      });
    }
    const dates = new Set(removedEvents.flatMap((event) => datesSpanned(event.startsAt, event.endsAt, timeZone)));
    return { changed: removed.length > 0 || added.length > 0, added: added.length, removedDates: [...dates] };
  });

  if (saved.changed) {
    // Today too: the timeline's sync health covers every shown calendar.
    for (const date of [...new Set([today, ...saved.removedDates])].sort()) await publishLiveEvent({ type: "timeline.changed", date });
  }

  let synced = false;
  let syncError: string | undefined;
  if (saved.added > 0) {
    try {
      // Publishes timeline.changed for the dates the new calendars filled.
      await syncCalendarsSerialized(env);
      synced = true;
    } catch (error) {
      syncError = safeErrorMessage(error, env);
    }
  }

  const data = await compose(google, bookingId);
  return { data, created: false, changed: saved.changed, synced, ...(syncError ? { syncError } : {}) };
}
