import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import {
  parseNoInput,
  parseUpsertAlert,
  parseUpsertCard,
  parseUpsertItem,
  parseUpsertNote,
  parseUpsertSprint,
  parseWatchlist,
} from "./parse";

function field(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return (error.details as { field: string }).field;
  }
  assert.fail("expected a validation error");
}

test("card upserts: absent means keep, null means clear, unknown fields fail", () => {
  const card = parseUpsertCard({ title: " Orphan cleanup ", sprintKey: "hermes:sprint:2026-10-12", hermesSuggestion: null, version: 3 });
  assert.equal(card.title, "Orphan cleanup");
  assert.deepEqual(card.sprintKey, { kind: "key", key: "hermes:sprint:2026-10-12" });
  assert.deepEqual(parseUpsertCard({ title: "x", sprintKey: "id:5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f" }).sprintKey, {
    kind: "id",
    id: "5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f",
  });
  assert.equal(parseUpsertCard({ title: "x", sprintKey: null }).sprintKey, null);
  assert.equal(card.hermesSuggestion, null);
  assert.equal(card.milestoneTitle, undefined);
  assert.equal(card.version, 3);
  assert.equal(card.force, false);
  assert.equal(field(() => parseUpsertCard({ title: "x", colour: "red" })), "colour");
  assert.equal(field(() => parseUpsertCard({ title: "x", sprintKey: "sprint-1" })), "sprintKey");
  assert.equal(field(() => parseUpsertCard({ title: "x", repoFullName: "not a repo" })), "repoFullName");
  assert.equal(field(() => parseUpsertCard({ title: "x".repeat(161) })), "title");
  assert.equal(field(() => parseUpsertCard({ title: "x", version: 0 })), "version");
  assert.equal(field(() => parseUpsertCard({ title: "x", force: "yes" })), "force");
  assert.equal(field(() => parseUpsertCard({ title: "x", status: "deleted" })), "status");
});

test("item upserts validate types and urls", () => {
  const item = parseUpsertItem({ title: "Review the 4 BDMV folders", isCurrent: true, issueNumber: null });
  assert.equal(item.isCurrent, true);
  assert.equal(item.issueNumber, null);
  assert.equal(item.done, undefined);
  assert.equal(field(() => parseUpsertItem({ title: "x", done: "true" })), "done");
  assert.equal(field(() => parseUpsertItem({ title: "x", sourceUrl: "ftp://x" })), "sourceUrl");
  assert.equal(field(() => parseUpsertItem({ title: "x", position: -1 })), "position");
});

test("sprint upserts need real, ordered dates", () => {
  const sprint = parseUpsertSprint({ name: "Week 42", startsOn: "2026-10-12", endsOn: "2026-10-18", status: "active" });
  assert.equal(sprint.status, "active");
  assert.equal(sprint.goal, undefined);
  assert.equal(field(() => parseUpsertSprint({ name: "x", startsOn: "2026-10-12", endsOn: "2026-10-11" })), "endsOn");
  assert.equal(field(() => parseUpsertSprint({ name: "x", startsOn: "12/10/2026", endsOn: "2026-10-18" })), "startsOn");
});

test("alerts and empty-input routes", () => {
  assert.equal(parseUpsertAlert({ source: "scan", title: "jellyfin restarting" }).severity, undefined);
  assert.equal(field(() => parseUpsertAlert({ source: "scan", title: "x", severity: "info" })), "severity");
  parseNoInput(undefined);
  parseNoInput({});
  assert.equal(field(() => parseNoInput({ force: true })), "force");
});

test("watchlist: 1–50 tickers, uppercased, duplicates dropped", () => {
  assert.deepEqual(parseWatchlist({ symbols: [" nvda", "AMD", "NVDA", "brk.b"] }).symbols, ["NVDA", "AMD", "BRK.B"]);
  assert.equal(field(() => parseWatchlist({ symbols: [] })), "symbols");
  assert.equal(field(() => parseWatchlist({ symbols: "NVDA" })), "symbols");
  assert.equal(field(() => parseWatchlist({ symbols: Array.from({ length: 51 }, (_, i) => `S${i}`) })), "symbols");
  assert.equal(field(() => parseWatchlist({ symbols: ["NVDA", "1BAD"] })), "symbols[1]");
  assert.equal(field(() => parseWatchlist({ symbols: ["NVDA", 7] })), "symbols[1]");
  assert.equal(field(() => parseWatchlist({ symbols: ["NVDA"], replace: true })), "replace");
});

test("alerts take an optional http(s) link", () => {
  assert.equal(parseUpsertAlert({ source: "seerr", title: "Dune waiting 5 days" }).url, undefined);
  assert.equal(parseUpsertAlert({ source: "seerr", title: "Dune", url: "https://requests.example/request/12" }).url, "https://requests.example/request/12");
  assert.equal(parseUpsertAlert({ source: "seerr", title: "Dune", url: null }).url, null);
  assert.equal(field(() => parseUpsertAlert({ source: "seerr", title: "Dune", url: "javascript:alert(1)" })), "url");
});

test("Hermes notes: text required, count optional (null clears), unknown fields rejected", () => {
  assert.deepEqual(parseUpsertNote({ text: " PRs to review ", count: 3, url: "https://github.com/pulls" }), {
    text: "PRs to review",
    detail: undefined,
    url: "https://github.com/pulls",
    count: 3,
  });
  assert.equal(parseUpsertNote({ text: "Router reboot at 02:00" }).count, undefined);
  assert.equal(parseUpsertNote({ text: "x", count: null }).count, null);
  assert.equal(field(() => parseUpsertNote({ text: "" })), "text");
  assert.equal(field(() => parseUpsertNote({ text: "x".repeat(201) })), "text");
  assert.equal(field(() => parseUpsertNote({ text: "x", count: -1 })), "count");
  assert.equal(field(() => parseUpsertNote({ title: "PRs", count: 3 })), "title");
});
