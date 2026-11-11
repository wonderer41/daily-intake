import assert from "node:assert/strict";
import test from "node:test";
import { combineSyncStates, isBookingCalendar, shownCalendars, type ShownCalendar } from "./sources";

const AT = new Date("2026-11-11T22:00:00Z");
const EARLIER = new Date("2026-11-11T21:58:00Z");

const BOOKING: ShownCalendar = { calendarId: "primary", name: null };
const IMPORTANT: ShownCalendar = { calendarId: "imp@group.calendar.google.com", name: "Important" };
const COLLEGE: ShownCalendar = { calendarId: "col@group.calendar.google.com", name: "College Activities" };

test("the booking calendar is matched by id, or as the account's main calendar when it is \"primary\"", () => {
  assert.equal(isBookingCalendar({ id: "me@gmail.com", primary: true }, "primary"), true);
  assert.equal(isBookingCalendar({ id: "me@gmail.com", primary: true }, "me@gmail.com"), true);
  assert.equal(isBookingCalendar({ id: "imp@group.calendar.google.com", primary: false }, "primary"), false);
  assert.equal(isBookingCalendar({ id: "me@gmail.com", primary: true }, "imp@group.calendar.google.com"), false);
  assert.equal(isBookingCalendar({ id: "me@gmail.com", primary: true }, undefined), false);
});

test("shown calendars are the booking calendar first, then the sources, and nothing without Google", () => {
  const sources = [
    { calendarId: IMPORTANT.calendarId, name: "Important" },
    { calendarId: "primary", name: "should not repeat" },
  ];
  assert.deepEqual(shownCalendars("primary", sources), [BOOKING, IMPORTANT]);
  assert.deepEqual(shownCalendars(undefined, sources), []);
});

test("sync health: oldest sync wins, and it is null until every calendar synced once", () => {
  const states = [
    { calendarId: "primary", lastSyncAt: AT, lastError: null },
    { calendarId: IMPORTANT.calendarId, lastSyncAt: EARLIER, lastError: null },
  ];
  assert.deepEqual(combineSyncStates([BOOKING, IMPORTANT], states), { lastSyncAt: EARLIER, syncError: null });
  assert.deepEqual(combineSyncStates([BOOKING, IMPORTANT, COLLEGE], states), { lastSyncAt: null, syncError: null });
  assert.deepEqual(combineSyncStates([], states), { lastSyncAt: null, syncError: null });
});

test("sync health: a shared error shows once, an extra calendar's own error names it", () => {
  const shared = [
    { calendarId: "primary", lastSyncAt: AT, lastError: "Google OAuth token refresh failed" },
    { calendarId: IMPORTANT.calendarId, lastSyncAt: AT, lastError: "Google OAuth token refresh failed" },
  ];
  assert.equal(combineSyncStates([BOOKING, IMPORTANT], shared).syncError, "Google OAuth token refresh failed");

  const own = [
    { calendarId: "primary", lastSyncAt: AT, lastError: null },
    { calendarId: IMPORTANT.calendarId, lastSyncAt: AT, lastError: "status 404" },
    { calendarId: COLLEGE.calendarId, lastSyncAt: AT, lastError: "status 404" },
  ];
  assert.equal(combineSyncStates([BOOKING, IMPORTANT, COLLEGE], own).syncError, "Important, College Activities: status 404");

  const bookingOnly = [{ calendarId: "primary", lastSyncAt: AT, lastError: "invalid_grant" }];
  assert.equal(combineSyncStates([BOOKING, IMPORTANT], bookingOnly).syncError, "invalid_grant");
});
