import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingPrompt, localIso, parseHermesReply } from "./prompt";

const ITEM = "5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f";
const DENVER = "America/Denver";

test("localIso keeps the wall clock and the right offset across daylight time", () => {
  assert.equal(localIso(new Date("2026-10-16T01:00:00Z"), DENVER), "2026-10-15T19:00:00-06:00");
  assert.equal(localIso(new Date("2026-12-16T02:00:00Z"), DENVER), "2026-12-15T19:00:00-07:00");
  assert.equal(localIso(new Date("2026-10-15T09:30:00Z"), "Europe/Madrid"), "2026-10-15T11:30:00+02:00");
});

test("the prompt carries the block, the link-back marker and the move-the-old-block rule", () => {
  const prompt = bookingPrompt({
    subject: { kind: "item", id: ITEM, cardTitle: "Study sessions", itemTitle: "Streak tracking", issueNumber: 13, url: "https://github.com/a/b/issues/13" },
    calendarId: "primary",
    timeZone: DENVER,
    start: new Date("2026-10-16T01:00:00Z"),
    end: new Date("2026-10-16T02:30:00Z"),
  });
  assert.match(prompt, /calendar id: primary/);
  assert.match(prompt, /- title: "Work block · Study sessions #13 Streak tracking"/);
  assert.match(prompt, /- start: 2026-10-15T19:00:00-06:00\n- end: 2026-10-15T20:30:00-06:00/);
  assert.ok(prompt.includes(`- description: "https://github.com/a/b/issues/13\\n[daily-intake:item:${ITEM}]"`));
  assert.ok(prompt.includes(`dailyIntakeItemId=${ITEM}`));
  assert.match(prompt, /move that event to the new start and end/);

  const alert = bookingPrompt({ subject: { kind: "alert", id: ITEM, title: "VM 100 backup missed" }, calendarId: "primary", timeZone: DENVER, start: new Date(), end: new Date() });
  assert.match(alert, /- title: "Fix · VM 100 backup missed"/);
  assert.ok(alert.includes(`[daily-intake:alert:${ITEM}]`) && alert.includes(`dailyIntakeAlertId=${ITEM}`));
});

test("reads Hermes's one-line JSON, even wrapped in prose or a code fence", () => {
  assert.deepEqual(parseHermesReply('{"status":"booked","eventId":"abc123","start":"2026-10-15T19:00:00-06:00","end":"2026-10-15T20:30:00-06:00"}'), {
    status: "booked",
    eventId: "abc123",
    start: new Date("2026-10-16T01:00:00Z"),
    end: new Date("2026-10-16T02:30:00Z"),
  });
  assert.deepEqual(parseHermesReply('Checked your calendar.\n```json\n{"status":"conflict","title":"Work shift","start":"2026-10-15T15:30:00-06:00","end":"2026-10-15T18:30:00-06:00"}\n```'), {
    status: "conflict",
    title: "Work shift",
    start: new Date("2026-10-15T21:30:00Z"),
    end: new Date("2026-10-16T00:30:00Z"),
  });
  assert.deepEqual(parseHermesReply('{"status":"error","message":"Calendar access expired"}'), { status: "error", message: "Calendar access expired" });
});

test("anything else is unreadable", () => {
  assert.equal(parseHermesReply(""), null);
  assert.equal(parseHermesReply("Done! I booked it for you."), null);
  assert.equal(parseHermesReply('{"status":"booked"}'), null, "booked needs an event id");
  assert.equal(parseHermesReply('{"status":"maybe"}'), null);
  assert.equal(parseHermesReply("{not json}"), null);
});
