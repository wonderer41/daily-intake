import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenPull } from "@/lib/integrations/github/pushes";
import { formatPushWatchResult, planClosedPull, planRepoWatches, type RepoSnapshot, type WatchRow } from "./detect";

const NOW = new Date("2026-10-16T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { repo: "me/app", defaultBranch: "main", defaultHead: "m2", openPulls: [], ...overrides };
}

function pull(number: number, headSha: string, overrides: Partial<OpenPull> = {}): OpenPull {
  return { number, title: `PR ${number}`, headRef: `feature-${number}`, headSha, baseRef: "main", ...overrides };
}

function row(id: string, overrides: Partial<WatchRow> = {}): WatchRow {
  return {
    id,
    ref: "branch:main",
    branch: "main",
    prNumber: null,
    prTitle: null,
    baseBranch: null,
    headSha: "m1",
    reviewedSha: "m1",
    hermesRunId: null,
    closedAt: null,
    ...overrides,
  };
}

function pullRow(id: string, number: number, overrides: Partial<WatchRow> = {}): WatchRow {
  return row(id, { ref: `pr:${number}`, branch: `feature-${number}`, prNumber: number, prTitle: `PR ${number}`, baseBranch: "main", reviewedSha: null, ...overrides });
}

test("a repo seen for the first time starts at its current commit; its open pull requests are reviewed from the start", () => {
  const plan = planRepoWatches(snapshot({ openPulls: [pull(7, "p7")] }), [], NOW);
  assert.deepEqual(plan.creates, [
    { repo: "me/app", ref: "branch:main", branch: "main", prNumber: null, prTitle: null, baseBranch: null, headSha: "m2", reviewedSha: "m2" },
    { repo: "me/app", ref: "pr:7", prNumber: 7, branch: "feature-7", prTitle: "PR 7", baseBranch: "main", headSha: "p7", reviewedSha: null },
  ]);
  assert.deepEqual([plan.updates, plan.deletes, plan.checkPulls], [[], [], []]);
});

test("an empty repository gets no default-branch row until its first commit", () => {
  assert.deepEqual(planRepoWatches(snapshot({ defaultHead: null }), [], NOW).creates, []);
});

test("a new commit moves headSha only; reviewedSha stays for the review", () => {
  const plan = planRepoWatches(snapshot(), [row("main")], NOW);
  assert.deepEqual(plan.updates, [{ id: "main", data: { headSha: "m2" } }]);
  assert.deepEqual(planRepoWatches(snapshot({ defaultHead: "m1" }), [row("main")], NOW).updates, []);
});

test("a renamed default branch drops the old row and starts the new one at its current commit", () => {
  const plan = planRepoWatches(snapshot({ defaultBranch: "trunk" }), [row("old")], NOW);
  assert.deepEqual(plan.deletes, ["old"]);
  assert.equal(plan.creates[0].ref, "branch:trunk");
  assert.equal(plan.creates[0].reviewedSha, "m2");
});

test("an open pull request's new push, title or base is copied; a reopened one is open again", () => {
  const rows = [row("main", { headSha: "m2" }), pullRow("p7", 7, { headSha: "a" }), pullRow("p8", 8, { headSha: "b", closedAt: new Date(NOW.getTime() - DAY) })];
  const plan = planRepoWatches(snapshot({ openPulls: [pull(7, "a2", { title: "Renamed" }), pull(8, "b")] }), rows, NOW);
  assert.deepEqual(plan.updates, [
    { id: "p7", data: { prTitle: "Renamed", headSha: "a2" } },
    { id: "p8", data: { closedAt: null } },
  ]);
});

test("a watched pull request missing from the open list is checked; merged ones go after a week unless a review runs", () => {
  const rows = [
    row("main", { headSha: "m2" }),
    pullRow("gone", 3, { headSha: "g" }),
    pullRow("recent", 4, { closedAt: new Date(NOW.getTime() - DAY) }),
    pullRow("old", 5, { closedAt: new Date(NOW.getTime() - 8 * DAY) }),
    pullRow("old-running", 6, { closedAt: new Date(NOW.getTime() - 8 * DAY), hermesRunId: "run" }),
  ];
  const plan = planRepoWatches(snapshot(), rows, NOW);
  assert.deepEqual(plan.checkPulls, [{ id: "gone", number: 3, headSha: "g" }]);
  assert.deepEqual(plan.deletes, ["old"]);
});

test("a pull request that left the list: merged keeps its last push for review, closed or missing is dropped", () => {
  const check = { id: "p3", number: 3, headSha: "old" };
  assert.deepEqual(planClosedPull(check, { open: false, merged: true, headSha: "final" }, NOW), { op: "update", id: "p3", data: { closedAt: NOW, headSha: "final" } });
  assert.deepEqual(planClosedPull(check, { open: false, merged: false, headSha: "final" }, NOW), { op: "delete", id: "p3" });
  assert.deepEqual(planClosedPull(check, null, NOW), { op: "delete", id: "p3" });
  assert.equal(planClosedPull(check, { open: true, merged: false, headSha: "x" }, NOW), null);
});

test("sync summary", () => {
  assert.equal(formatPushWatchResult({ watching: 3, toReview: 1, failed: [] }), "pushes: watching 3 · 1 to review");
  assert.equal(formatPushWatchResult({ watching: 1, toReview: 0, failed: [{ repo: "me/x", message: "nope" }] }), "pushes: watching 1 · 0 to review · failed me/x: nope");
});
