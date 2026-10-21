import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { loadSeerrConfig, seerrImportantAfterDays } from "./config";
import { listAllPending, planSeerrImportant, seerrAlertInput, seerrAlertKey, waitingDetail } from "./important";
import { parseSeerrRequest, type SeerrRequest } from "./normalize";
import { movieRequest, testEnv, tvRequest } from "./test-fixtures";

const movie = parseSeerrRequest(movieRequest); // id 42, created 2026-10-13T02:14:05Z, maria
const tv = parseSeerrRequest(tvRequest); // id 43, created 2026-10-13T03:00:00Z, luis, seasons 1–2

function at(iso: string): Date {
  return new Date(iso);
}

function withId(request: SeerrRequest, id: number, createdAt = request.createdAt): SeerrRequest {
  return { ...request, id, createdAt };
}

test("SEERR_IMPORTANT_AFTER_DAYS: 5 by default, a whole number of at least 1 otherwise", () => {
  assert.equal(seerrImportantAfterDays(testEnv()), 5);
  assert.equal(seerrImportantAfterDays(testEnv({ SEERR_IMPORTANT_AFTER_DAYS: " " })), 5);
  assert.equal(seerrImportantAfterDays(testEnv({ SEERR_IMPORTANT_AFTER_DAYS: "3" })), 3);
  for (const bad of ["0", "-1", "2.5", "five"]) {
    assert.throws(() => seerrImportantAfterDays(testEnv({ SEERR_IMPORTANT_AFTER_DAYS: bad })), HttpError, bad);
  }
});

test("detail: type, seasons, whole days waiting and who asked", () => {
  assert.equal(waitingDetail(movie, at("2026-10-19T02:14:05Z")), "Movie · requested 6 days ago by maria");
  assert.equal(waitingDetail(movie, at("2026-10-14T02:14:04Z")), "Movie · requested 0 days ago by maria");
  assert.equal(waitingDetail(movie, at("2026-10-14T02:14:05Z")), "Movie · requested 1 day ago by maria");
  assert.equal(waitingDetail(tv, at("2026-10-18T03:00:00Z")), "TV · seasons 1–2 · requested 5 days ago by luis");
});

test("alert input: a warning from source seerr, linked to the title in Seerr when SEERR_PUBLIC_URL is set", () => {
  const now = at("2026-10-19T00:00:00Z");
  assert.deepEqual(seerrAlertInput(movie, "The Matrix (1999)", now, "https://requests.example.com"), {
    source: "seerr",
    title: "The Matrix (1999)",
    detail: "Movie · requested 5 days ago by maria",
    url: "https://requests.example.com/movie/603",
    severity: "warning",
    meta: undefined,
  });
  assert.equal(seerrAlertInput(tv, "Attack on Titan (2013)", now, null).url, null);
  assert.equal(seerrAlertInput(tv, "x".repeat(300), now, null).title.length, 200);
  assert.equal(seerrAlertKey(43), "seerr:request:43");
});

test("plan: raises requests waiting at least the limit, keeps known titles, resolves the rest", () => {
  const now = at("2026-10-18T03:00:00Z"); // tv waited exactly 5 days, movie a bit longer
  const fresh = withId(movie, 44, "2026-10-17T00:00:00.000Z");
  const plan = planSeerrImportant(
    [movie, tv, fresh],
    [
      { dedupeKey: "seerr:request:42", title: "The Matrix (1999)" },
      { dedupeKey: "seerr:request:43", title: "TMDB #1429" },
      { dedupeKey: "seerr:request:7", title: "Approved meanwhile (2020)" },
    ],
    now,
    5,
    true,
  );
  assert.deepEqual(
    plan.upsert.map(({ request, title }) => [request.id, title]),
    [
      [42, "The Matrix (1999)"],
      [43, null], // fallback title: look it up again
    ],
  );
  assert.deepEqual(plan.resolve, ["seerr:request:7"]);
});

test("plan: a list that hit the page limit resolves nothing", () => {
  const plan = planSeerrImportant([], [{ dedupeKey: "seerr:request:7", title: "Old (2020)" }], at("2026-10-18T00:00:00Z"), 5, false);
  assert.deepEqual(plan, { upsert: [], resolve: [] });
});

// A fake Seerr behind global fetch for the paging test.
const realFetch = globalThis.fetch;
let pages: Map<string, unknown>;
let paths: string[];

beforeEach(() => {
  pages = new Map();
  paths = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    paths.push(path);
    const body = pages.get(path);
    return body === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("listing reads every page of pending requests and drops a request that shifted onto the next page", async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({ ...movieRequest, id: 1000 + index }));
  // A new request arrived between the two reads: the old last one shows up again at the top of page 2.
  const second = [{ ...movieRequest, id: 1099 }, { ...tvRequest, id: 2000 }];
  pages.set("/api/v1/request?filter=pending&take=100&skip=0", { pageInfo: { results: 101 }, results: first });
  pages.set("/api/v1/request?filter=pending&take=100&skip=100", { pageInfo: { results: 101 }, results: second });

  const { requests, complete } = await listAllPending(loadSeerrConfig(testEnv()));
  assert.equal(complete, true);
  assert.equal(requests.length, 101);
  assert.equal(new Set(requests.map((request) => request.id)).size, 101);
  assert.deepEqual(paths, ["/api/v1/request?filter=pending&take=100&skip=0", "/api/v1/request?filter=pending&take=100&skip=100"]);
});

test("listing stops after 10 pages and says the list is incomplete", async () => {
  for (let page = 0; page < 11; page += 1) {
    const results = Array.from({ length: 100 }, (_, index) => ({ ...movieRequest, id: 1 + page * 100 + index }));
    pages.set(`/api/v1/request?filter=pending&take=100&skip=${page * 100}`, { pageInfo: { results: 1100 }, results });
  }
  const { requests, complete } = await listAllPending(loadSeerrConfig(testEnv()));
  assert.equal(complete, false);
  assert.equal(requests.length, 1000);
  assert.equal(paths.length, 10);
});
