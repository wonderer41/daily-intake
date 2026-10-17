import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchBranchHead, fetchCommit, fetchCommitPulls, fetchCompareCommits, fetchOpenPulls, fetchPull, fetchPullCommits, type GithubAccess } from "./pushes";

const TOKEN = "github_pat_TEST_TOKEN_123456";

/** A fake GitHub: `routes` maps a path (plus search, when given) to a reply. Unknown paths are 404. */
function fakeGithub(routes: Record<string, { status?: number; body?: unknown; link?: string }>) {
  const paths: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    paths.push(url.pathname + url.search);
    const reply = routes[url.pathname + url.search] ?? routes[url.pathname] ?? { status: 404, body: { message: "Not Found" } };
    const headers = reply.link ? { link: reply.link } : undefined;
    return new Response(JSON.stringify(reply.body ?? null), { status: reply.status ?? 200, headers });
  }) as typeof fetch;
  const access: GithubAccess = { token: TOKEN, fetch: fetchImpl };
  return { access, paths };
}

const commitJson = (sha: string, parents = 1, date = "2026-10-16T10:00:00Z") => ({
  sha,
  parents: Array.from({ length: parents }, (_, index) => ({ sha: `p${index}` })),
  author: { login: "me" },
  commit: { message: `msg ${sha}`, author: { name: "Me", date: "2020-01-01T00:00:00Z" }, committer: { date } },
});

test("branch head: slashes in the branch name stay path separators; a missing branch or empty repo is null", async () => {
  const { access, paths } = fakeGithub({ "/repos/me/app/branches/release/v1": { body: { commit: { sha: "abc" } } }, "/repos/me/app/branches/main": { status: 404 } });
  assert.equal(await fetchBranchHead("me/app", "release/v1", access), "abc");
  assert.equal(await fetchBranchHead("me/app", "main", access), null);
  assert.equal(paths[0], "/repos/me/app/branches/release/v1");
});

test("open pull requests follow GitHub's next page", async () => {
  const next = "https://api.github.com/repos/me/app/pulls?state=open&per_page=100&page=2";
  const { access } = fakeGithub({
    "/repos/me/app/pulls?state=open&per_page=100": {
      body: [{ number: 7, title: "Streaks", head: { ref: "streaks", sha: "s7" }, base: { ref: "main" } }],
      link: `<${next}>; rel="next"`,
    },
    "/repos/me/app/pulls?state=open&per_page=100&page=2": { body: [{ number: 8, title: "Fix", head: { ref: "fix", sha: "s8" }, base: { ref: "main" } }, { number: 0 }] },
  });
  assert.deepEqual(await fetchOpenPulls("me/app", access), [
    { number: 7, title: "Streaks", headRef: "streaks", headSha: "s7", baseRef: "main" },
    { number: 8, title: "Fix", headRef: "fix", headSha: "s8", baseRef: "main" },
  ]);
});

test("one pull request: merged or not; gone is null", async () => {
  const { access } = fakeGithub({
    "/repos/me/app/pulls/7": { body: { state: "closed", merged_at: "2026-10-16T10:00:00Z", head: { sha: "final" } } },
    "/repos/me/app/pulls/8": { body: { state: "closed", merged_at: null, head: { sha: "x" } } },
  });
  assert.deepEqual(await fetchPull("me/app", 7, access), { open: false, merged: true, headSha: "final" });
  assert.deepEqual(await fetchPull("me/app", 8, access), { open: false, merged: false, headSha: "x" });
  assert.equal(await fetchPull("me/app", 9, access), null);
});

test("commit lists: pull request commits and comparisons, merges flagged; a failed comparison is null", async () => {
  const { access } = fakeGithub({
    "/repos/me/app/pulls/7/commits?per_page=100": { body: [commitJson("a"), commitJson("m", 2)] },
    "/repos/me/app/compare/old...new": { body: { commits: [commitJson("b")] } },
  });
  const listed = await fetchPullCommits("me/app", 7, access);
  assert.deepEqual(
    listed.map((entry) => [entry.sha, entry.merge, entry.author, entry.committedAt]),
    [
      ["a", false, "me", "2026-10-16T10:00:00.000Z"],
      ["m", true, "me", "2026-10-16T10:00:00.000Z"],
    ],
  );
  assert.deepEqual((await fetchCompareCommits("me/app", "old", "new", access))?.map((entry) => entry.sha), ["b"]);
  assert.equal(await fetchCompareCommits("me/app", "gone", "new", access), null);
});

test("one commit with its files; binary files have no patch", async () => {
  const { access } = fakeGithub({
    "/repos/me/app/commits/abc": {
      body: {
        ...commitJson("abc"),
        files: [
          { filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1 @@" },
          { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
        ],
      },
    },
  });
  const commit = await fetchCommit("me/app", "abc", access);
  assert.equal(commit.message, "msg abc");
  assert.deepEqual(commit.files, [
    { filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1 @@" },
    { filename: "logo.png", status: "added", additions: 0, deletions: 0, patch: null },
  ]);
});

test("a commit's pull requests; none when GitHub doesn't know the commit", async () => {
  const { access } = fakeGithub({ "/repos/me/app/commits/abc/pulls": { body: [{ number: 12 }, { number: 3 }] } });
  assert.deepEqual(await fetchCommitPulls("me/app", "abc", access), [12, 3]);
  assert.deepEqual(await fetchCommitPulls("me/app", "zzz", access), []);
});
