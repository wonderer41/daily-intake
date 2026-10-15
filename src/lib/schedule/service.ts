import type { Prisma, ScheduleRequest } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import { dashboardTimeZone, dayBounds, formatClock, localDateString, zonedTimeToUtc } from "@/lib/time/zone";
import type { ScheduleMessage, ScheduleRequestDto } from "@/types/dashboard-contracts";
import { DAY_MINUTES, findFree, type BusyRange } from "./free-slot";
import { loadHermesApiConfig, stopRun } from "./hermes-runs";
import { SCHEDULE_MESSAGES } from "./messages";
import { requestEcho, scheduleWindow, type ScheduleInput, type ScheduleTargetRef } from "./request";

// The scheduling bubble's server side (POST /api/schedule and friends). A request is either settled
// right here (bad time, not set up, or a clash with the cached calendar) or left "checking" for the
// worker's schedule-runner job, which asks Hermes to book it.

export interface CachedEvent {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

const EVENT_FIELDS = { id: true, title: true, startsAt: true, endsAt: true } as const;

function hermesSays(text: string, at: Date): ScheduleMessage {
  return { who: "hermes", text, at: at.toISOString() };
}

function transcriptOf(value: Prisma.JsonValue): ScheduleMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const { who, text, at } = entry as Record<string, unknown>;
    return (who === "hermes" || who === "me") && typeof text === "string" && typeof at === "string" ? [{ who, text, at }] : [];
  });
}

/** Appends a message to a stored transcript, for the update that settles a request. */
export function withMessage(row: Pick<ScheduleRequest, "transcript">, message: ScheduleMessage): Prisma.InputJsonValue {
  return [...transcriptOf(row.transcript), message] as unknown as Prisma.InputJsonValue;
}

export async function toScheduleDto(row: ScheduleRequest): Promise<ScheduleRequestDto> {
  const ids = [row.conflictEventId, row.calendarEventId].filter((id): id is string => id !== null);
  const events = ids.length ? await prisma.calendarEvent.findMany({ where: { id: { in: ids } }, select: EVENT_FIELDS }) : [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const conflict = row.conflictEventId ? byId.get(row.conflictEventId) : undefined;
  const booked = row.calendarEventId ? byId.get(row.calendarEventId) : undefined;
  return {
    id: row.id,
    status: row.status,
    checklistItemId: row.checklistItemId,
    alertId: row.alertId,
    requestedStart: row.requestedStart.toISOString(),
    durationMin: row.durationMin,
    conflict: conflict
      ? { eventId: conflict.id, title: conflict.title, startsAt: conflict.startsAt.toISOString(), endsAt: conflict.endsAt.toISOString() }
      : null,
    suggestedStart: row.suggestedStart?.toISOString() ?? null,
    booked: booked ? { calendarEventId: booked.id, startsAt: booked.startsAt.toISOString(), endsAt: booked.endsAt.toISOString() } : null,
    transcript: transcriptOf(row.transcript),
    error: row.error,
  };
}

/** Local minutes after midnight on `date`, clamped to the day. */
function wallMinutes(instant: Date, date: string, timeZone: string): number {
  const day = localDateString(instant, timeZone);
  if (day < date) return 0;
  if (day > date) return DAY_MINUTES;
  const [hours, minutes] = formatClock(instant, timeZone).split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Timed, non-cancelled events cached for a local day, without the target's own blocks: a reschedule
 * must not clash with the block it replaces. All-day events don't block time (same as the page).
 */
export async function cachedBusy(date: string, timeZone: string, skip: ScheduleTargetRef): Promise<CachedEvent[]> {
  const { start, end } = dayBounds(date, timeZone);
  const notTarget: Prisma.CalendarEventWhereInput =
    skip.kind === "item"
      ? { OR: [{ checklistItemId: null }, { checklistItemId: { not: skip.id } }] }
      : { OR: [{ alertId: null }, { alertId: { not: skip.id } }] };
  return prisma.calendarEvent.findMany({
    where: { status: { not: "cancelled" }, allDay: false, startsAt: { lt: end }, endsAt: { gt: start }, ...notTarget },
    orderBy: { startsAt: "asc" },
    select: EVENT_FIELDS,
  });
}

export function firstOverlap(events: readonly CachedEvent[], start: Date, end: Date): CachedEvent | null {
  return events.find((event) => event.startsAt < end && event.endsAt > start) ?? null;
}

/** Next free start (at or after the requested one, and not in the past) for the "Use HH:MM" button. */
export function suggestStart(
  events: readonly CachedEvent[],
  input: Pick<ScheduleInput, "date" | "startMin" | "durationMin">,
  now: Date,
  timeZone: string,
): Date | null {
  const busy: BusyRange[] = events.map((event) => ({
    start: wallMinutes(event.startsAt, input.date, timeZone),
    end: wallMinutes(event.endsAt, input.date, timeZone),
  }));
  const nowMin = localDateString(now, timeZone) === input.date ? wallMinutes(now, input.date, timeZone) : 0;
  const free = findFree(Math.max(input.startMin, nowMin), input.durationMin, busy);
  return free === null ? null : zonedTimeToUtc(input.date, free, timeZone);
}

async function assertTarget(target: ScheduleTargetRef): Promise<void> {
  const found =
    target.kind === "item"
      ? await prisma.checklistItem.findUnique({ where: { id: target.id }, select: { id: true } })
      : await prisma.alert.findUnique({ where: { id: target.id }, select: { id: true } });
  if (!found) throw new HttpError("NOT_FOUND", target.kind === "item" ? "Checklist item not found" : "Alert not found");
}

export async function createScheduleRequest(input: ScheduleInput, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ScheduleRequestDto> {
  const timeZone = dashboardTimeZone(env);
  await assertTarget(input.target);
  const window = scheduleWindow(input, now, timeZone);
  const base = {
    checklistItemId: input.target.kind === "item" ? input.target.id : null,
    alertId: input.target.kind === "alert" ? input.target.id : null,
    requestedStart: window.ok ? window.start : zonedTimeToUtc(input.date, input.startMin, timeZone),
    durationMin: input.durationMin,
  };
  const mine: ScheduleMessage = { who: "me", text: requestEcho(input), at: now.toISOString() };

  let data: Prisma.ScheduleRequestUncheckedCreateInput;
  if (!window.ok) {
    data = { ...base, status: "failed", error: window.message, transcript: [mine, hermesSays(window.message, now)] as unknown as Prisma.InputJsonValue };
  } else if (!loadHermesApiConfig(env)) {
    const message = SCHEDULE_MESSAGES.notConfigured;
    data = { ...base, status: "failed", error: message, transcript: [mine, hermesSays(message, now)] as unknown as Prisma.InputJsonValue };
  } else {
    // D6: a fast check against the cached calendar first; Hermes checks Google again before booking.
    const busy = await cachedBusy(input.date, timeZone, input.target);
    const clash = firstOverlap(busy, window.start, window.end);
    data = clash
      ? {
          ...base,
          status: "conflict",
          conflictEventId: clash.id,
          suggestedStart: suggestStart(busy, input, now, timeZone),
          transcript: [mine, hermesSays(`I can't book that: ${clash.title} is on your calendar then.`, now)] as unknown as Prisma.InputJsonValue,
        }
      : { ...base, status: "checking", transcript: [mine] as unknown as Prisma.InputJsonValue };
  }

  const row = await prisma.scheduleRequest.create({ data });
  await publishLiveEvent({ type: "schedule.updated", scheduleId: row.id });
  return toScheduleDto(row);
}

export async function getScheduleRequest(id: string): Promise<ScheduleRequestDto> {
  const row = await prisma.scheduleRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError("NOT_FOUND", "Schedule request not found");
  return toScheduleDto(row);
}

/**
 * Settles a request that is still "checking". Returns false when it was settled already (cancelled
 * by the bubble, or by another run), so the caller leaves it alone.
 */
export async function settleScheduleRequest(id: string, data: Prisma.ScheduleRequestUncheckedUpdateManyInput): Promise<boolean> {
  const { count } = await prisma.scheduleRequest.updateMany({ where: { id, status: "checking" }, data });
  if (count > 0) await publishLiveEvent({ type: "schedule.updated", scheduleId: id });
  return count > 0;
}

/** The bubble closed before Hermes answered: stop the run and mark the request cancelled. */
export async function cancelScheduleRequest(id: string, env: NodeJS.ProcessEnv = process.env): Promise<ScheduleRequestDto> {
  const row = await prisma.scheduleRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError("NOT_FOUND", "Schedule request not found");
  if (row.status === "checking" && (await settleScheduleRequest(id, { status: "cancelled" })) && row.hermesRunId) {
    const config = loadHermesApiConfig(env);
    if (config) void stopRun(config, row.hermesRunId);
  }
  return getScheduleRequest(id);
}
