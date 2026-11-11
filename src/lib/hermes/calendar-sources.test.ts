import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleCalendarListEntry } from "@/lib/integrations/google-calendar/client";
import { composeCalendarSources, resolveCalendarIds } from "./calendar-sources";

const MAIN: GoogleCalendarListEntry = { id: "me@gmail.com", name: "me@gmail.com", primary: true };
const IMPORTANT: GoogleCalendarListEntry = { id: "imp@group.calendar.google.com", name: "Important", primary: false };
const COLLEGE: GoogleCalendarListEntry = { id: "col@group.calendar.google.com", name: "College Activities", primary: false };
const GOOGLE = [IMPORTANT, MAIN, COLLEGE];
const AT = new Date("2026-11-11T22:00:00Z");

test("the list puts the booking calendar first, locked, with the sync state stored under its alias", () => {
  const calendars = composeCalendarSources(
    GOOGLE,
    [{ calendarId: IMPORTANT.id, name: "Important" }],
    [
      { calendarId: "primary", lastSyncAt: AT, lastError: null },
      { calendarId: IMPORTANT.id, lastSyncAt: null, lastError: "status 404" },
    ],
    "primary",
  );
  assert.deepEqual(
    calendars.map(({ id, shown, locked, onAccount, lastSyncAt, syncError }) => ({ id, shown, locked, onAccount, lastSyncAt, syncError })),
    [
      { id: MAIN.id, shown: true, locked: true, onAccount: true, lastSyncAt: AT.toISOString(), syncError: null },
      { id: IMPORTANT.id, shown: true, locked: false, onAccount: true, lastSyncAt: null, syncError: "status 404" },
      { id: COLLEGE.id, shown: false, locked: false, onAccount: true, lastSyncAt: null, syncError: null },
    ],
  );
});

test("a shown calendar Google no longer lists is kept, marked onAccount: false", () => {
  const calendars = composeCalendarSources(GOOGLE, [{ calendarId: "gone@group.calendar.google.com", name: "Old" }], [], "primary");
  const gone = calendars.find((calendar) => calendar.id === "gone@group.calendar.google.com");
  assert.deepEqual(gone && { name: gone.name, shown: gone.shown, onAccount: gone.onAccount }, { name: "Old", shown: true, onAccount: false });
});

test("a booking calendar missing from Google's list still shows, locked", () => {
  const calendars = composeCalendarSources([IMPORTANT], [], [], "primary");
  assert.deepEqual(
    calendars.map(({ id, locked, onAccount }) => ({ id, locked, onAccount })),
    [
      { id: "primary", locked: true, onAccount: false },
      { id: IMPORTANT.id, locked: false, onAccount: true },
    ],
  );
});

test("requested ids drop the booking calendar in any spelling and report unknown ones", () => {
  assert.deepEqual(resolveCalendarIds([IMPORTANT.id, "primary", MAIN.id, COLLEGE.id, IMPORTANT.id], GOOGLE, "primary"), {
    keep: [IMPORTANT, COLLEGE],
    unknown: [],
  });
  assert.deepEqual(resolveCalendarIds(["nope@group.calendar.google.com"], GOOGLE, "primary").unknown, ["nope@group.calendar.google.com"]);
  // When the booking calendar is another one, "primary" adds the main calendar by its real id.
  assert.deepEqual(resolveCalendarIds(["primary", IMPORTANT.id], GOOGLE, IMPORTANT.id), { keep: [MAIN], unknown: [] });
});
