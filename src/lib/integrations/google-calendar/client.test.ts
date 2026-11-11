import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { fetchGoogleCalendarList, fetchGoogleCalendarWindow } from "./client";
import type { GoogleCalendarConfig } from "./config";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const FROM = new Date("2026-10-14T06:00:00Z");
const TO = new Date("2026-10-30T06:00:00Z");

// The token cache is keyed by client + refresh token, so each test uses its own refresh token.
function config(refreshToken: string): GoogleCalendarConfig {
  return { clientId: "client", clientSecret: "secret", refreshToken, calendarId: "primary" };
}

/** Fakes Google: counts token refreshes and answers the events call with `calendarStatus(token)`. */
function fakeGoogle(options: { expiresIn?: number; calendarStatus?: (token: string) => number } = {}) {
  const calls = { tokens: 0, calendarTokens: [] as string[] };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      calls.tokens += 1;
      return Response.json({ access_token: `token-${calls.tokens}`, expires_in: options.expiresIn ?? 3599 });
    }
    const token = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    calls.calendarTokens.push(token);
    const status = options.calendarStatus?.(token) ?? 200;
    return status === 200 ? Response.json({ items: [] }) : new Response("{}", { status });
  };
  return calls;
}

test("reuses the access token across syncs instead of refreshing every time", async () => {
  const calls = fakeGoogle();
  await fetchGoogleCalendarWindow(config("reuse"), FROM, TO);
  await fetchGoogleCalendarWindow(config("reuse"), FROM, TO);
  assert.equal(calls.tokens, 1);
  assert.deepEqual(calls.calendarTokens, ["token-1", "token-1"]);
});

test("refreshes when the token is about to expire", async () => {
  const calls = fakeGoogle({ expiresIn: 30 });
  await fetchGoogleCalendarWindow(config("short-lived"), FROM, TO);
  await fetchGoogleCalendarWindow(config("short-lived"), FROM, TO);
  assert.equal(calls.tokens, 2);
});

test("a different refresh token never gets another one's access token", async () => {
  const calls = fakeGoogle();
  await fetchGoogleCalendarWindow(config("first-account"), FROM, TO);
  await fetchGoogleCalendarWindow(config("second-account"), FROM, TO);
  assert.equal(calls.tokens, 2);
});

test("a rejected token is dropped and the request retried once with a fresh one", async () => {
  const calls = fakeGoogle({ calendarStatus: (token) => (token === "token-1" ? 401 : 200) });
  await fetchGoogleCalendarWindow(config("revoked"), FROM, TO);
  await fetchGoogleCalendarWindow(config("revoked"), FROM, TO);
  assert.equal(calls.tokens, 2);
  assert.deepEqual(calls.calendarTokens, ["token-1", "token-2", "token-2"]);
});

test("a token rejected twice in a row is an UNAUTHORIZED error", async () => {
  const calls = fakeGoogle({ calendarStatus: () => 401 });
  await assert.rejects(
    fetchGoogleCalendarWindow(config("always-401"), FROM, TO),
    (error: unknown) => error instanceof HttpError && error.code === "UNAUTHORIZED",
  );
  assert.equal(calls.tokens, 2);
});

test("the calendar list reads every page, names each calendar and marks the main one", async () => {
  const pages: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "list-token", expires_in: 3599 });
    pages.push(url);
    if (!url.includes("pageToken=")) {
      return Response.json({
        items: [
          { id: "me@gmail.com", summary: "me@gmail.com", primary: true },
          { id: "imp@group.calendar.google.com", summary: "Important" },
        ],
        nextPageToken: "next",
      });
    }
    return Response.json({ items: [{ id: "shared@group.calendar.google.com", summary: "Team", summaryOverride: "Work team" }, { id: "x@y" }] });
  };
  const calendars = await fetchGoogleCalendarList(config("list"));
  assert.deepEqual(calendars, [
    { id: "me@gmail.com", name: "me@gmail.com", primary: true },
    { id: "imp@group.calendar.google.com", name: "Important", primary: false },
    { id: "shared@group.calendar.google.com", name: "Work team", primary: false },
    { id: "x@y", name: "x@y", primary: false },
  ]);
  assert.equal(pages.length, 2);
  assert.ok(pages[0].includes("/users/me/calendarList?") && pages[0].includes("showHidden=true"));
});

test("the calendar list reports Google errors as HttpError", async () => {
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "t", expires_in: 3599 });
    return new Response("{}", { status: 500 });
  };
  await assert.rejects(fetchGoogleCalendarList(config("list-error")), (error: unknown) => error instanceof HttpError && error.code === "UPSTREAM_ERROR");
});
