import { addDays, formatClock, localDateString, zonedTimeToUtc } from "@/lib/time/zone";

/** A local wall-clock time in DASHBOARD_TIME_ZONE. */
export interface DailyTime {
  hour: number;
  minute: number;
}

/** A local weekday and time in DASHBOARD_TIME_ZONE. `weekday` counts like Date#getDay: 0 = Sunday … 6 = Saturday. */
export interface WeeklyTime extends DailyTime {
  weekday: number;
}

export type JobTrigger = { everyMs: number } | { dailyAt: DailyTime } | { weeklyAt: WeeklyTime };

/** The triggers tied to the local clock (everything but everyMs). */
export type ClockTrigger = Exclude<JobTrigger, { everyMs: number }>;

/** Shortest interval a job may use, so a typo can't turn into a hot loop. */
export const MIN_INTERVAL_MS = 1_000;

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clockLabel({ hour, minute }: DailyTime): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isTimeOfDay({ hour, minute }: DailyTime): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

export function describeTrigger(trigger: JobTrigger): string {
  if ("everyMs" in trigger) {
    const ms = trigger.everyMs;
    if (ms % 3_600_000 === 0) return `every ${ms / 3_600_000}h`;
    if (ms % 60_000 === 0) return `every ${ms / 60_000}m`;
    return `every ${ms / 1000}s`;
  }
  if ("dailyAt" in trigger) return `daily ${clockLabel(trigger.dailyAt)}`;
  return `weekly ${WEEKDAY_NAMES[trigger.weeklyAt.weekday]} ${clockLabel(trigger.weeklyAt)}`;
}

/** Throws a readable error for an interval below MIN_INTERVAL_MS or an impossible weekday or time of day. */
export function validateTrigger(trigger: JobTrigger): void {
  if ("everyMs" in trigger) {
    if (!Number.isInteger(trigger.everyMs) || trigger.everyMs < MIN_INTERVAL_MS) {
      throw new Error(`everyMs must be an integer of at least ${MIN_INTERVAL_MS}`);
    }
    return;
  }
  if ("dailyAt" in trigger) {
    if (!isTimeOfDay(trigger.dailyAt)) throw new Error("dailyAt must be { hour: 0–23, minute: 0–59 }");
    return;
  }
  const { weekday } = trigger.weeklyAt;
  if (!isTimeOfDay(trigger.weeklyAt) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error("weeklyAt must be { weekday: 0–6 (0 = Sunday), hour: 0–23, minute: 0–59 }");
  }
}

function wallClockMs(date: string, minutes: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 0, minutes);
}

function clockMinutes(instant: Date, timeZone: string): number {
  const [hour, minute] = formatClock(instant, timeZone).split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * The instant the zone's clock shows `minutes` past midnight on `date`. When that wall time is
 * skipped by a DST jump (e.g. 02:30 on spring-forward day), it is moved forward by the gap
 * (→ 03:30), so a daily job still runs exactly once that day.
 */
export function localTimeInstant(date: string, minutes: number, timeZone: string): Date {
  const instant = zonedTimeToUtc(date, minutes, timeZone);
  const wanted = wallClockMs(date, minutes);
  const actual = wallClockMs(localDateString(instant, timeZone), clockMinutes(instant, timeZone));
  return actual === wanted ? instant : new Date(instant.getTime() + (wanted - actual));
}

/** The first local occurrence of `at` strictly after `after` (DST-safe; on fall-back days, the first one). */
export function nextDailyRun(after: Date, at: DailyTime, timeZone: string): Date {
  const minutes = at.hour * 60 + at.minute;
  let date = addDays(localDateString(after, timeZone), -1);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = localTimeInstant(date, minutes, timeZone);
    if (candidate.getTime() > after.getTime()) return candidate;
    date = addDays(date, 1);
  }
  throw new Error("Could not compute the next daily run");
}

/** The first local occurrence of `at` (weekday and time) strictly after `after`; DST-safe like nextDailyRun. */
export function nextWeeklyRun(after: Date, at: WeeklyTime, timeZone: string): Date {
  let candidate = nextDailyRun(after, at, timeZone);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    if (new Date(wallClockMs(localDateString(candidate, timeZone), 0)).getUTCDay() === at.weekday) return candidate;
    candidate = nextDailyRun(candidate, at, timeZone);
  }
  throw new Error("Could not compute the next weekly run");
}

/** The next run of a dailyAt or weeklyAt trigger strictly after `after`. */
export function nextClockRun(after: Date, trigger: ClockTrigger, timeZone: string): Date {
  return "dailyAt" in trigger ? nextDailyRun(after, trigger.dailyAt, timeZone) : nextWeeklyRun(after, trigger.weeklyAt, timeZone);
}

/** The latest run of a dailyAt or weeklyAt trigger at or before `at`. */
export function previousClockRun(at: Date, trigger: ClockTrigger, timeZone: string): Date {
  // Eight days back is longer than any clock period, so the first run found is never after `at`.
  let run = nextClockRun(new Date(at.getTime() - 8 * 86_400_000), trigger, timeZone);
  for (let next = nextClockRun(run, trigger, timeZone); next.getTime() <= at.getTime(); next = nextClockRun(run, trigger, timeZone)) {
    run = next;
  }
  return run;
}

/**
 * Fixed-rate schedule for interval jobs: the next tick of `lastStart + k * everyMs` that is
 * strictly after `now`. Ticks missed while a slow run was still going are skipped, not queued.
 */
export function nextIntervalRun(lastStart: Date, everyMs: number, now: Date): Date {
  const elapsed = now.getTime() - lastStart.getTime();
  const periods = Math.max(1, Math.floor(elapsed / everyMs) + 1);
  return new Date(lastStart.getTime() + periods * everyMs);
}

/** "1.2s" style duration for log lines. */
export function formatDuration(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
