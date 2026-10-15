import { type BusyRange } from "@/lib/schedule/free-slot";
import type { TimelineEventDto } from "@/types/dashboard-contracts";
import { wallMinutes } from "./format";

export { findFree, type BusyRange } from "@/lib/schedule/free-slot";

/**
 * The page's timed events on `date` as busy ranges. All-day events don't block time, and the
 * target's own work block is skipped so a reschedule doesn't collide with the block it replaces.
 */
export function busyRanges(
  events: readonly TimelineEventDto[],
  date: string,
  timeZone: string,
  skip: { checklistItemId?: string; alertId?: string } = {},
): BusyRange[] {
  return events
    .filter((event) => !event.allDay)
    .filter((event) => !(skip.checklistItemId && event.checklistItemId === skip.checklistItemId))
    .filter((event) => !(skip.alertId && event.alertId === skip.alertId))
    .map((event) => ({ start: wallMinutes(event.startsAt, date, timeZone), end: wallMinutes(event.endsAt, date, timeZone) }))
    .filter((range) => range.end > range.start);
}
