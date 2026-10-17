import assert from "node:assert/strict";
import { test } from "node:test";
import { pushWatchInput } from "./github-job";

test("push watch input: synced repos with their default branch; failed repos still count as card repos", () => {
  const github = (defaultBranch: string) => ({ github: { defaultBranch, lastCommitAt: null, weeklyCommits: 0, syncedAt: "" } });
  const input = pushWatchInput({
    updated: [{ cardId: "c1", repoFullName: "Me/App", meta: github("main") }],
    unchanged: [
      { cardId: "c2", repoFullName: "me/lib", meta: github("trunk") },
      { cardId: "c3", repoFullName: "me/odd", meta: {} },
    ],
    failed: [{ cardId: "c4", repoFullName: "me/down", meta: {}, message: "GitHub returned HTTP 502" }],
  });
  assert.deepEqual(input, {
    synced: [
      { repoFullName: "Me/App", defaultBranch: "main" },
      { repoFullName: "me/lib", defaultBranch: "trunk" },
    ],
    cardRepos: ["Me/App", "me/lib", "me/odd", "me/down"],
  });
});
