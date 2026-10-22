import { dayBounds, formatClock, zonedTimeToUtc } from "@/lib/time/zone";
import type { GapView, TrackItem } from "./model";

// Geometry for the day bar and the hour grid: which hours they show, where an instant sits, and
// how overlapping events share the space. Everything is in epoch milliseconds; local hours come
// from the dashboard zone, so a 23- or 25-hour DST day still lines up with the clock.

/** The window the day bar and the hour grid always show, in local hours; events outside stretch it. */
export const DAY_WINDOW_HOURS = { start: 6, end: 22 } as const;

export interface HourMark {
  /** "08:00". */
  label: string;
  at: number;
}

export interface DayWindow {
  start: number;
  end: number;
  /** Every whole local hour from start to end, both included. */
  hours: HourMark[];
}

function localHour(at: number, timeZone: string): { hour: number; minute: number } {
  const [hour, minute] = formatClock(new Date(at), timeZone).split(":").map(Number);
  return { hour, minute };
}

/**
 * 06:00–22:00 on `date`, stretched to whole hours so every timed event fits, never past the day's
 * own edges (an event that runs on past midnight is cut at 24:00).
 */
export function dayWindow(date: string, timeZone: string, events: readonly { startsAt: string; endsAt: string }[]): DayWindow {
  const day = dayBounds(date, timeZone);
  const [dayStart, dayEnd] = [day.start.getTime(), day.end.getTime()];
  let startHour: number = DAY_WINDOW_HOURS.start;
  let endHour: number = DAY_WINDOW_HOURS.end;
  for (const event of events) {
    const start = Math.max(Date.parse(event.startsAt), dayStart);
    const end = Math.min(Date.parse(event.endsAt), dayEnd);
    startHour = Math.min(startHour, localHour(start, timeZone).hour);
    if (end >= dayEnd) {
      endHour = 24;
    } else {
      const { hour, minute } = localHour(end, timeZone);
      endHour = Math.max(endHour, minute > 0 ? hour + 1 : hour);
    }
  }
  const at = (hour: number) => (hour >= 24 ? dayEnd : zonedTimeToUtc(date, hour * 60, timeZone).getTime());
  const hours: HourMark[] = [];
  for (let hour = startHour; hour <= endHour; hour += 1) hours.push({ label: `${String(hour % 24).padStart(2, "0")}:00`, at: at(hour) });
  return { start: at(startHour), end: at(endHour), hours };
}

/** Where `at` sits in the window, from 0 (start) to 1 (end), clamped. */
export function fraction(at: number, window: Pick<DayWindow, "start" | "end">): number {
  return Math.min(1, Math.max(0, (at - window.start) / (window.end - window.start)));
}

export interface Interval {
  start: number;
  end: number;
}

export interface Placed<T> {
  item: T;
  /** 0-based lane (a row on the day bar, a column on the hour grid). */
  lane: number;
  /** Lanes its overlap group needs: the space each event of the group gets is 1 / lanes. */
  lanes: number;
}

/**
 * Puts overlapping intervals side by side. Each takes the first lane that is free at its start;
 * intervals that touch (one ends when the next starts) share a lane.
 */
export function placeInLanes<T extends Interval>(items: readonly T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -Infinity;
  let laneEnds: number[] = [];

  const closeGroup = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const entry of group) entry.lanes = lanes;
    placed.push(...group);
    group = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= groupEnd) {
      closeGroup();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    group.push({ item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  closeGroup();
  return placed;
}

export interface GapSegment extends Interval {
  gap: GapView;
}

/**
 * The free stretches between items, positioned: each runs from the latest end so far to the next
 * item's start (the same rule the gap labels use). Overlaps and zero-length gaps are left out.
 */
export function gapSegments(items: readonly TrackItem[]): GapSegment[] {
  const segments: GapSegment[] = [];
  let latestEnd = -Infinity;
  items.forEach((item, index) => {
    latestEnd = Math.max(latestEnd, item.type === "now" ? Date.parse(item.at) : Date.parse(item.endsAt));
    const next = items[index + 1];
    if (!item.gap || item.gap.minutes <= 0 || !next) return;
    const nextStart = next.type === "now" ? Date.parse(next.at) : Date.parse(next.startsAt);
    if (nextStart > latestEnd) segments.push({ start: latestEnd, end: nextStart, gap: item.gap });
  });
  return segments;
}
