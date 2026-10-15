import { integer, invalid, localDate, ROOT, strictObject } from "@/lib/api/validate";
import { uuid } from "@/lib/dashboard/user-parse";
import { formatClock, localDateString, zonedTimeToUtc } from "@/lib/time/zone";
import { DAY_MINUTES } from "./free-slot";
import { pastTimeMessage, SCHEDULE_MESSAGES } from "./messages";

export const MIN_DURATION = 1;
export const MAX_DURATION = 720;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ScheduleTargetRef = { kind: "item"; id: string } | { kind: "alert"; id: string };

export interface ScheduleInput {
  target: ScheduleTargetRef;
  /** The timeline's local date, YYYY-MM-DD. */
  date: string;
  /** Local minutes after midnight. */
  startMin: number;
  durationMin: number;
}

/** POST /api/schedule body: exactly one of checklistItemId / alertId, plus date, "HH:MM" start and length. */
export function parseScheduleBody(body: unknown): ScheduleInput {
  const value = strictObject(body, ROOT, ["checklistItemId", "alertId", "start", "date", "durationMin"]);
  const hasItem = value.checklistItemId !== undefined;
  if (hasItem === (value.alertId !== undefined)) invalid("checklistItemId", "or alertId is required (exactly one of them)");
  const target: ScheduleTargetRef = hasItem
    ? { kind: "item", id: uuid(value.checklistItemId, "checklistItemId") }
    : { kind: "alert", id: uuid(value.alertId, "alertId") };
  const date = localDate(value.date, "date");
  const match = typeof value.start === "string" ? CLOCK.exec(value.start) : null;
  if (!match) invalid("start", "must be a 24-hour HH:MM time");
  const durationMin = integer(value.durationMin, "durationMin", { min: MIN_DURATION, max: MAX_DURATION });
  return { target, date, startMin: Number(match[1]) * 60 + Number(match[2]), durationMin };
}

export type ScheduleWindow = { ok: true; start: Date; end: Date } | { ok: false; message: string };

/**
 * Where the requested block sits in time, or Hermes's reason it can't work: a day that is over, a start
 * that already passed today (the current minute still counts), or a block that runs past midnight.
 * The page checks the same rules first; this catches a stale page or a skewed clock.
 */
export function scheduleWindow(input: ScheduleInput, now: Date, timeZone: string): ScheduleWindow {
  const today = localDateString(now, timeZone);
  if (input.date < today) return { ok: false, message: SCHEDULE_MESSAGES.pastDay };
  const start = zonedTimeToUtc(input.date, input.startMin, timeZone);
  const startOfThisMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  if (input.date === today && start.getTime() < startOfThisMinute) return { ok: false, message: pastTimeMessage(formatClock(now, timeZone)) };
  if (input.startMin + input.durationMin > DAY_MINUTES) return { ok: false, message: SCHEDULE_MESSAGES.pastMidnight };
  return { ok: true, start, end: new Date(start.getTime() + input.durationMin * 60_000) };
}

/** "HH:MM" for local minutes after midnight. */
export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The requester's own message in the transcript: "19:00–20:30 (90 min)". */
export function requestEcho(input: ScheduleInput): string {
  return `${clock(input.startMin)}–${clock(input.startMin + input.durationMin)} (${input.durationMin} min)`;
}
