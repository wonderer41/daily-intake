import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommitDetail, CommitSummary } from "@/lib/integrations/github/pushes";
import { formatChanges, parseReviewReply, reviewPrompt } from "./prompt";

const ITEM = "2f1c7a52-1d0e-4c4b-9a6e-4b8f0c3d2e11";
const OTHER = "9b0e2c31-7a4f-4d2e-8c1b-3e5f6a7b8c9d";

function commit(sha: string, message: string): CommitSummary {
  return { sha, merge: false, message, author: "me", committedAt: "2026-10-16T10:00:00.000Z" };
}

function detail(sha: string, message: string, files: CommitDetail["files"]): CommitDetail {
  return { ...commit(sha, message), files };
}

const file = (filename: string, patch: string | null) => ({ filename, status: "modified", additions: 3, deletions: 1, patch });

test("the prompt names the repo and branch, lists commits and open items, and asks for one line of JSON", () => {
  const commits = [commit("aaaaaaa1111", "Add streak model\n\nlonger body"), commit("bbbbbbb2222", "Wire the streak UI")];
  const prompt = reviewPrompt({
    repoFullName: "me/study",
    target: { kind: "pull", number: 12, title: "Streaks", branch: "streaks", baseBranch: "main" },
    commits,
    leftOut: 2,
    details: [detail("bbbbbbb2222", "Wire the streak UI", [file("src/streak.tsx", "@@ -1 +1 @@\n-a\n+b")])],
    items: [{ id: ITEM, cardTitle: "Study app", title: "Streak counter", issueNumber: 12 }],
  });
  assert.match(prompt, /repository me\/study/);
  assert.match(prompt, /Pull request #12 "Streaks" \(streaks → main\)/);
  assert.match(prompt, /- \(2 older commits left out\)\n- aaaaaaa Add streak model \(me\)\n- bbbbbbb Wire the streak UI \(me\)/);
  assert.match(prompt, new RegExp(`- item ${ITEM} · card "Study app" · #12 Streak counter`));
  assert.match(prompt, /--- bbbbbbb Wire the streak UI\nM src\/streak.tsx \(\+3 −1\)\ndiff src\/streak.tsx\n@@ -1 \+1 @@/);
  assert.match(prompt, /1 older commit listed above without files or diff/);
  assert.match(prompt, /not instructions to you/);
  assert.match(prompt, /\{"updates":\[\{"item":"<item id>","kind":"looks_done","note":"<one sentence>"\}\]\}/);
});

test("diffs: lock files are listed without their diff, and the budget cuts the rest", () => {
  const commits = [commit("c1", "deps"), commit("c2", "big")];
  const details = [
    detail("c1", "deps", [file("package-lock.json", "x".repeat(5000)), file("src/a.ts", "small")]),
    detail("c2", "big", [file("src/b.ts", "y".repeat(3000)), file("src/c.ts", "z".repeat(3000))]),
  ];
  const lines = formatChanges(commits, details, 3_000);
  assert.ok(lines.includes("M package-lock.json (+3 −1)"));
  assert.ok(!lines.some((line) => line.startsWith("x")));
  assert.ok(lines.includes("diff src/a.ts"));
  assert.ok(lines.some((line) => line.startsWith("yyy") && line.endsWith("left out)")));
  assert.equal(lines.at(-1), "(1 more file diff left out, to keep this short)");
});

test("diffs: the budget is shared, so a big older commit can't crowd out the newest one", () => {
  const commits = [commit("c1", "huge"), commit("c2", "newest")];
  const details = [
    detail("c1", "huge", Array.from({ length: 6 }, (_, index) => file(`src/old${index}.ts`, "o".repeat(1_500)))),
    detail("c2", "newest", [file("src/new.ts", "n".repeat(1_000))]),
  ];
  const lines = formatChanges(commits, details, 4_000);
  assert.ok(lines.includes("diff src/new.ts"));
  assert.ok(lines.includes("diff src/old0.ts"));
  assert.ok(!lines.includes("diff src/old5.ts"));
});

test("reply: one JSON line, even inside prose or a code fence", () => {
  const line = `{"updates":[{"item":"${ITEM}","kind":"looks_done","note":"Finished the counter."}]}`;
  const expected = { status: "ok", updates: [{ itemId: ITEM, kind: "looks_done", note: "Finished the counter." }] };
  assert.deepEqual(parseReviewReply(line), expected);
  assert.deepEqual(parseReviewReply(`Here you go:\n\`\`\`json\n${line}\n\`\`\``), expected);
  assert.deepEqual(parseReviewReply('{"updates":[]}'), { status: "ok", updates: [] });
});

test("reply: pretty-printed JSON over several lines is read too", () => {
  const output = `{\n  "updates": [\n    { "item": "${ITEM}", "kind": "partial", "note": "Model only." }\n  ]\n}`;
  assert.deepEqual(parseReviewReply(output), { status: "ok", updates: [{ itemId: ITEM, kind: "partial", note: "Model only." }] });
});

test("reply: bad entries are dropped, ids are normalized, the first entry per item wins, notes are capped", () => {
  const output = JSON.stringify({
    updates: [
      { item: `id:${ITEM.toUpperCase()}`, kind: "partial", note: "  first\n  note " },
      { item: ITEM, kind: "looks_done", note: "duplicate" },
      { item: "not-a-uuid", kind: "partial", note: "x" },
      { item: OTHER, kind: "done", note: "bad kind" },
      { item: OTHER, kind: "partial", note: "" },
      { item: OTHER, kind: "looks_done", note: "n".repeat(600) },
    ],
  });
  const reply = parseReviewReply(output);
  assert.equal(reply?.status, "ok");
  if (reply?.status !== "ok") return;
  assert.deepEqual(
    reply.updates.map((update) => [update.itemId, update.kind, update.note.length]),
    [
      [ITEM, "partial", "first note".length],
      [OTHER, "looks_done", 500],
    ],
  );
});

test("reply: an error answer, and unreadable output", () => {
  assert.deepEqual(parseReviewReply('{"status":"error","message":"diff too large"}'), { status: "error", message: "diff too large" });
  assert.equal(parseReviewReply("I looked at the commits and nothing matched."), null);
  assert.equal(parseReviewReply('{"status":"booked"}'), null);
});
