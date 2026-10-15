import { localDateString, zonedTimeToUtc } from "@/lib/time/zone";

/** What the block is for: a checklist item on a Working-on card, or an open Broken alert. */
export type BookingSubject =
  | { kind: "item"; id: string; cardTitle: string; itemTitle: string; issueNumber: number | null; url: string | null }
  | { kind: "alert"; id: string; title: string };

export interface BookingRequest {
  subject: BookingSubject;
  calendarId: string;
  timeZone: string;
  start: Date;
  end: Date;
}

/** "2026-10-15T19:00:00-06:00": the local wall clock with its UTC offset, which Google accepts as is. */
export function localIso(instant: Date, timeZone: string): string {
  const date = localDateString(instant, timeZone);
  const midnight = zonedTimeToUtc(date, 0, timeZone);
  const minutes = Math.round((instant.getTime() - midnight.getTime()) / 60_000);
  const wall = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 0, minutes);
  const offsetMin = Math.round((wall - instant.getTime()) / 60_000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${new Date(wall).toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function blockTitle(subject: BookingSubject): string {
  if (subject.kind === "alert") return `Fix · ${subject.title}`;
  const issue = subject.issueNumber === null ? "" : ` #${subject.issueNumber}`;
  return `Work block · ${subject.cardTitle}${issue} ${subject.itemTitle}`.slice(0, 300);
}

function blockDescription(subject: BookingSubject): string {
  if (subject.kind === "alert") return `[daily-intake:alert:${subject.id}]`;
  return `${subject.url ? `${subject.url}\n` : ""}[daily-intake:item:${subject.id}]`;
}

/**
 * The run input for Hermes's API server. Hermes books with its own Google access; the dashboard only
 * reads the calendar. The marker and the private property let the calendar sync link the event back
 * to the item or alert, and let Hermes find an earlier block for the same thing and move it.
 */
export function bookingPrompt(request: BookingRequest): string {
  const { subject } = request;
  const marker = subject.kind === "item" ? `[daily-intake:item:${subject.id}]` : `[daily-intake:alert:${subject.id}]`;
  const property = subject.kind === "item" ? `dailyIntakeItemId=${subject.id}` : `dailyIntakeAlertId=${subject.id}`;
  return [
    `You are booking a focused work block on the user's Google Calendar (calendar id: ${request.calendarId}).`,
    `Time zone: ${request.timeZone}.`,
    "",
    "Block:",
    `- title: ${JSON.stringify(blockTitle(subject))}`,
    `- start: ${localIso(request.start, request.timeZone)}`,
    `- end: ${localIso(request.end, request.timeZone)}`,
    `- description: ${JSON.stringify(blockDescription(subject))}`,
    `- private extended property: ${property}`,
    "",
    "Steps:",
    `1. Look for an existing event whose description contains ${marker} or that has the private extended property ${property}. That is an earlier block for the same thing.`,
    "2. Read the calendar for the new window. If any non-cancelled event overlaps it, other than the earlier block from step 1, do not create or change anything.",
    "3. Otherwise, if step 1 found an earlier block, move that event to the new start and end. If not, create the event exactly as above.",
    "",
    "Reply with ONE line of JSON and nothing else:",
    '{"status":"booked","eventId":"<google event id>","start":"<ISO>","end":"<ISO>"}',
    "or",
    '{"status":"conflict","title":"<conflicting event title>","start":"<ISO>","end":"<ISO>"}',
    "or",
    '{"status":"error","message":"<short reason>"}',
  ].join("\n");
}

export type HermesReply =
  | { status: "booked"; eventId: string; start: Date | null; end: Date | null }
  | { status: "conflict"; title: string | null; start: Date | null; end: Date | null }
  | { status: "error"; message: string };

function instant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Reads Hermes's answer. The model is asked for one line of JSON but can wrap it in prose or a code
 * fence, so the last line holding a JSON object with a known status wins. Null means unreadable.
 */
export function parseHermesReply(output: string): HermesReply | null {
  const lines = output.split(/\r?\n/).reverse();
  for (const line of lines) {
    const from = line.indexOf("{");
    const to = line.lastIndexOf("}");
    if (from === -1 || to <= from) continue;
    let value: unknown;
    try {
      value = JSON.parse(line.slice(from, to + 1));
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const reply = value as Record<string, unknown>;
    if (reply.status === "booked") {
      const eventId = text(reply.eventId, 1024);
      if (eventId) return { status: "booked", eventId, start: instant(reply.start), end: instant(reply.end) };
    } else if (reply.status === "conflict") {
      return { status: "conflict", title: text(reply.title, 300), start: instant(reply.start), end: instant(reply.end) };
    } else if (reply.status === "error") {
      return { status: "error", message: text(reply.message, 500) ?? "" };
    }
  }
  return null;
}
