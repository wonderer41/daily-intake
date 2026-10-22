import assert from "node:assert/strict";
import test from "node:test";
import { zonedTimeToUtc } from "@/lib/time/zone";
import { dayWindow, fraction, gapSegments, placeInLanes } from "./layout";
import type { EventCardView, NowCardView, TrackItem } from "./model";

const DENVER = "America/Denver";
const DAY = "2026-10-21";
const at = (hhmm: string, date = DAY) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, DENVER).toISOString();
};
const event = (start: string, end: string, date = DAY) => ({ startsAt: at(start, date), endsAt: at(end, date) });

test("the window is 06:00–22:00 when everything fits inside", () => {
  const window = dayWindow(DAY, DENVER, [event("08:15", "10:15"), event("13:00", "14:00")]);
  assert.equal(new Date(window.start).toISOString(), at("06:00"));
  assert.equal(new Date(window.end).toISOString(), at("22:00"));
  assert.equal(window.hours.length, 17);
  assert.deepEqual(
    [window.hours[0].label, window.hours[16].label],
    ["06:00", "22:00"],
  );
});

test("events outside stretch the window to whole hours, never past the day", () => {
  const early = dayWindow(DAY, DENVER, [event("05:30", "06:15")]);
  assert.equal(early.hours[0].label, "05:00");
  const late = dayWindow(DAY, DENVER, [event("21:00", "22:30")]);
  assert.equal(late.hours.at(-1)?.label, "23:00");
  // Runs on past midnight: cut at the end of the day, labelled 00:00.
  const overnight = dayWindow(DAY, DENVER, [{ startsAt: at("23:00"), endsAt: at("01:00", "2026-10-22") }]);
  assert.equal(new Date(overnight.end).toISOString(), at("00:00", "2026-10-22"));
  assert.equal(overnight.hours.at(-1)?.label, "00:00");
});

test("on a 25-hour fall-back day the hours still follow the local clock", () => {
  const window = dayWindow("2026-11-01", DENVER, []);
  assert.equal(new Date(window.start).toISOString(), "2026-11-01T13:00:00.000Z"); // 06:00 MST
  assert.equal(window.hours.length, 17);
  assert.equal(fraction(Date.parse(at("14:00", "2026-11-01")), window), 0.5);
});

test("fraction clamps to the window", () => {
  const window = { start: 1_000, end: 2_000 };
  assert.equal(fraction(500, window), 0);
  assert.equal(fraction(1_250, window), 0.25);
  assert.equal(fraction(5_000, window), 1);
});

test("overlapping events share the space; touching ones share a lane", () => {
  const placed = placeInLanes([
    { id: "a", start: 0, end: 60 },
    { id: "b", start: 60, end: 120 }, // touches a: same lane
    { id: "c", start: 200, end: 300 },
    { id: "d", start: 220, end: 260 }, // overlaps c
    { id: "e", start: 270, end: 290 }, // overlaps c, not d: reuses d's lane
  ]);
  const byId = Object.fromEntries(placed.map((entry) => [entry.item.id, [entry.lane, entry.lanes]]));
  assert.deepEqual(byId, { a: [0, 1], b: [0, 1], c: [0, 2], d: [1, 2], e: [1, 2] });
});

test("gap segments run from the latest end so far to the next start", () => {
  const card = (id: string, start: string, end: string, gapMinutes: number | null): EventCardView => ({
    type: "event",
    id,
    title: id,
    startsAt: at(start),
    endsAt: at(end),
    start,
    end,
    source: "calendar",
    state: "future",
    workBlock: false,
    marker: "future",
    gap: gapMinutes === null ? null : { minutes: gapMinutes, tone: "long", label: `${gapMinutes}m`, description: "" },
  });
  const now: NowCardView = { type: "now", id: "now", at: at("12:00"), time: "12:00", marker: "now", gap: { minutes: 60, tone: "long", label: "1h", description: "" } };
  const items: TrackItem[] = [card("long", "08:00", "11:00", 0), card("inside", "09:00", "10:00", 60), now, card("after", "13:00", "14:00", null)];
  const segments = gapSegments(items);
  // "inside" ends at 10:00 but "long" ran to 11:00: the free stretch starts at 11:00.
  assert.deepEqual(
    segments.map((segment) => [new Date(segment.start).toISOString(), new Date(segment.end).toISOString()]),
    [
      [at("11:00"), at("12:00")],
      [at("12:00"), at("13:00")],
    ],
  );
});
