import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseScheduleBody, requestEcho, scheduleWindow } from "./request";

const ITEM = "5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f";
const DENVER = "America/Denver";

function rejects(body: unknown, field: string): void {
  assert.throws(
    () => parseScheduleBody(body),
    (error: unknown) => error instanceof HttpError && error.code === "VALIDATION_ERROR" && (error.details as { field: string }).field === field,
  );
}

test("parses an item request", () => {
  assert.deepEqual(parseScheduleBody({ checklistItemId: ITEM.toUpperCase(), date: "2026-10-15", start: "19:00", durationMin: 90 }), {
    target: { kind: "item", id: ITEM },
    date: "2026-10-15",
    startMin: 19 * 60,
    durationMin: 90,
  });
  assert.deepEqual(parseScheduleBody({ alertId: ITEM, date: "2026-10-15", start: "00:05", durationMin: 1 }).target, { kind: "alert", id: ITEM });
});

test("needs exactly one target, a 24-hour start and 1–720 minutes", () => {
  rejects({ date: "2026-10-15", start: "19:00", durationMin: 90 }, "checklistItemId");
  rejects({ checklistItemId: ITEM, alertId: ITEM, date: "2026-10-15", start: "19:00", durationMin: 90 }, "checklistItemId");
  rejects({ checklistItemId: ITEM, date: "2026-10-15", start: "7:00", durationMin: 90 }, "start");
  rejects({ checklistItemId: ITEM, date: "2026-10-15", start: "24:00", durationMin: 90 }, "start");
  rejects({ checklistItemId: ITEM, date: "2026-10-15", start: "19:00", durationMin: 0 }, "durationMin");
  rejects({ checklistItemId: ITEM, date: "2026-10-15", start: "19:00", durationMin: 721 }, "durationMin");
  rejects({ checklistItemId: ITEM, date: "15/10/2026", start: "19:00", durationMin: 90 }, "date");
  rejects({ checklistItemId: ITEM, date: "2026-10-15", start: "19:00", durationMin: 90, extra: 1 }, "extra");
});

test("the window is in the dashboard's zone", () => {
  // 2026-10-15 is daylight time in Denver (UTC-6).
  const window = scheduleWindow({ target: { kind: "item", id: ITEM }, date: "2026-10-15", startMin: 19 * 60, durationMin: 90 }, new Date("2026-10-15T18:00:00Z"), DENVER);
  assert.deepEqual(window, { ok: true, start: new Date("2026-10-16T01:00:00Z"), end: new Date("2026-10-16T02:30:00Z") });
});

test("a past day, a start that already passed, or a block past midnight is refused in Hermes's words", () => {
  const now = new Date("2026-10-15T17:45:30Z"); // 11:45 in Denver
  const at = (date: string, startMin: number, durationMin = 30) => scheduleWindow({ target: { kind: "item", id: ITEM }, date, startMin, durationMin }, now, DENVER);
  assert.deepEqual(at("2026-10-14", 19 * 60), { ok: false, message: "That day is over. Pick a time today or later." });
  assert.deepEqual(at("2026-10-15", 11 * 60 + 44), { ok: false, message: "That time already passed today. Pick something after 11:45." });
  assert.equal(at("2026-10-15", 11 * 60 + 45).ok, true, "the current minute still counts");
  assert.deepEqual(at("2026-10-15", 23 * 60 + 45, 30), { ok: false, message: "That runs past midnight. Try an earlier start." });
  assert.equal(at("2026-10-15", 23 * 60 + 30, 30).ok, true, "ending exactly at midnight is fine");
  assert.equal(at("2026-10-16", 8 * 60).ok, true);
});

test("the transcript echo", () => {
  assert.equal(requestEcho({ target: { kind: "item", id: ITEM }, date: "2026-10-15", startMin: 19 * 60, durationMin: 90 }), "19:00–20:30 (90 min)");
});
