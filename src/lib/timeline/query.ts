import { prisma } from "@/lib/db/prisma";
import { combineSyncStates, readShownCalendars, type ShownCalendar } from "@/lib/integrations/google-calendar/sources";
import { dashboardTimeZone, dayBounds } from "@/lib/time/zone";
import type { TimelineResponse } from "@/types/dashboard-contracts";
import { buildTimeline } from "./build";

/**
 * calendarId of the demo events written by `npm run db:seed` (scripts/seed.ts). The Google sync
 * only touches rows of its own calendarId, so it never cancels these; `npm run db:seed -- --clean`
 * deletes them.
 */
export const SEED_CALENDAR_ID = "seed";

/**
 * Calendars whose cached events the page shows and the scheduler treats as busy: every shown
 * Google calendar, plus the demo seed outside production.
 */
export function timelineCalendarIds(shown: readonly ShownCalendar[], env: NodeJS.ProcessEnv = process.env): string[] {
  const ids = shown.map((calendar) => calendar.calendarId);
  if (env.NODE_ENV !== "production") ids.push(SEED_CALENDAR_ID);
  return ids;
}

/** The timeline for one local date, read from the CalendarEvent cache (never from Google directly). */
export async function getTimeline(date: string, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<TimelineResponse> {
  const timeZone = dashboardTimeZone(env);
  const shown = await readShownCalendars(env);
  const calendarIds = timelineCalendarIds(shown, env);

  const { start, end } = dayBounds(date, timeZone);
  const [events, syncStates] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { calendarId: { in: calendarIds }, status: { not: "cancelled" }, startsAt: { lt: end }, endsAt: { gt: start } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        kind: true,
        checklistItemId: true,
        alertId: true,
        htmlLink: true,
      },
    }),
    shown.length
      ? prisma.calendarSyncState.findMany({
          where: { calendarId: { in: shown.map((calendar) => calendar.calendarId) } },
          select: { calendarId: true, lastSyncAt: true, lastError: true },
        })
      : [],
  ]);
  const health = combineSyncStates(shown, syncStates);

  return buildTimeline({
    date,
    timeZone,
    now,
    events,
    lastSyncAt: health.lastSyncAt,
    syncError: shown.length ? health.syncError : "Google Calendar is not configured",
  });
}
