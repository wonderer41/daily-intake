import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommitSummary } from "@/lib/integrations/github/pushes";
import { MAX_REVIEW_COMMITS, pullCommitsAfter, reviewableCommits, withoutWatchedPulls } from "./select";

function commit(sha: string, merge = false): CommitSummary {
  return { sha, merge, message: `commit ${sha}`, author: "me", committedAt: "2026-10-16T10:00:00.000Z" };
}

const shas = (commits: CommitSummary[]) => commits.map((entry) => entry.sha);

test("pull request commits after the last reviewed one; all of them when none was reviewed or it was force-pushed away", () => {
  const list = [commit("a"), commit("b"), commit("c")];
  assert.deepEqual(shas(pullCommitsAfter(list, null)), ["a", "b", "c"]);
  assert.deepEqual(shas(pullCommitsAfter(list, "b")), ["c"]);
  assert.deepEqual(shas(pullCommitsAfter(list, "c")), []);
  assert.deepEqual(shas(pullCommitsAfter(list, "gone")), ["a", "b", "c"]);
});

test("merge commits are never reviewed; only the newest commits are kept", () => {
  assert.deepEqual(reviewableCommits([commit("a"), commit("m", true), commit("b")]), { commits: [commit("a"), commit("b")], leftOut: 0 });
  const many = Array.from({ length: MAX_REVIEW_COMMITS + 3 }, (_, index) => commit(`c${index}`));
  const { commits, leftOut } = reviewableCommits(many);
  assert.equal(commits.length, MAX_REVIEW_COMMITS);
  assert.equal(commits[0].sha, "c3");
  assert.equal(leftOut, 3);
});

test("default-branch commits a watched pull request brought in are skipped; others (direct pushes, unwatched PRs) stay", () => {
  const commits = [commit("from-watched"), commit("direct"), commit("from-unwatched")];
  const pullsOf = new Map([
    ["from-watched", [12]],
    ["direct", []],
    ["from-unwatched", [13]],
  ]);
  assert.deepEqual(shas(withoutWatchedPulls(commits, pullsOf, new Set([12, 14]))), ["direct", "from-unwatched"]);
});
