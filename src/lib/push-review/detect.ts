import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadGithubToken } from "@/lib/integrations/github/api";
import { fetchBranchHead, fetchOpenPulls, fetchPull, type GithubAccess, type OpenPull, type PullState } from "@/lib/integrations/github/pushes";
import { safeErrorMessage } from "@/lib/live/redact";

// The GitHub sync's half of the push review: keeps one PushWatch row per watched branch (each card
// repo's default branch and its open pull requests) pointing at the newest commit. The push-review
// job then reviews whatever lies between reviewedSha and headSha.
//
// - A repo seen for the first time starts at its current commit: nothing older is reviewed.
// - A pull request seen for the first time has all its commits reviewed (reviewedSha = null).
// - A pull request that leaves the open list: merged → kept (closedAt) so its last push is still
//   reviewed and the default branch skips the commits it brought in, then deleted after a week;
//   closed without merging → deleted.
// - Repos no longer on any card lose their rows.

const CLOSED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const TITLE_MAX = 300;
const BRANCH_MAX = 255;

export interface WatchRow {
  id: string;
  ref: string;
  branch: string;
  prNumber: number | null;
  prTitle: string | null;
  baseBranch: string | null;
  headSha: string;
  reviewedSha: string | null;
  hermesRunId: string | null;
  closedAt: Date | null;
}

/** What GitHub says about one repo right now. */
export interface RepoSnapshot {
  /** Lowercased "owner/repo". */
  repo: string;
  defaultBranch: string;
  /** Null for an empty repository. */
  defaultHead: string | null;
  openPulls: OpenPull[];
}

export interface WatchCreate {
  repo: string;
  ref: string;
  branch: string;
  prNumber: number | null;
  prTitle: string | null;
  baseBranch: string | null;
  headSha: string;
  reviewedSha: string | null;
}

export type WatchUpdate = Partial<Pick<WatchRow, "branch" | "prTitle" | "baseBranch" | "headSha" | "closedAt">>;

export interface RepoPlan {
  creates: WatchCreate[];
  updates: { id: string; data: WatchUpdate }[];
  deletes: string[];
  /** Watched pull requests missing from the open list: ask GitHub whether they were merged. */
  checkPulls: { id: string; number: number; headSha: string }[];
}

export const defaultRef = (branch: string) => `branch:${branch}`;
export const pullRef = (number: number) => `pr:${number}`;

function pullFields(pull: OpenPull) {
  return {
    branch: pull.headRef.slice(0, BRANCH_MAX),
    prTitle: pull.title.slice(0, TITLE_MAX),
    baseBranch: pull.baseRef.slice(0, BRANCH_MAX),
    headSha: pull.headSha,
  };
}

/** Row changes for one repo, from GitHub's current state. Pure. */
export function planRepoWatches(snapshot: RepoSnapshot, rows: readonly WatchRow[], now: Date): RepoPlan {
  const plan: RepoPlan = { creates: [], updates: [], deletes: [], checkPulls: [] };
  const mainRef = defaultRef(snapshot.defaultBranch.slice(0, BRANCH_MAX));

  // The default branch: a new one starts at its current commit.
  const main = rows.find((row) => row.ref === mainRef);
  if (snapshot.defaultHead) {
    if (!main) {
      plan.creates.push({
        repo: snapshot.repo,
        ref: mainRef,
        branch: snapshot.defaultBranch.slice(0, BRANCH_MAX),
        prNumber: null,
        prTitle: null,
        baseBranch: null,
        headSha: snapshot.defaultHead,
        reviewedSha: snapshot.defaultHead,
      });
    } else if (main.headSha !== snapshot.defaultHead) {
      plan.updates.push({ id: main.id, data: { headSha: snapshot.defaultHead } });
    }
  }
  // A renamed default branch: the old name's row goes.
  for (const row of rows) if (row.prNumber === null && row.ref !== mainRef) plan.deletes.push(row.id);

  const open = new Set<number>();
  for (const pull of snapshot.openPulls) {
    open.add(pull.number);
    const fields = pullFields(pull);
    const row = rows.find((candidate) => candidate.prNumber === pull.number);
    if (!row) {
      plan.creates.push({ repo: snapshot.repo, ref: pullRef(pull.number), prNumber: pull.number, ...fields, reviewedSha: null });
      continue;
    }
    const data: WatchUpdate = {};
    if (row.branch !== fields.branch) data.branch = fields.branch;
    if (row.prTitle !== fields.prTitle) data.prTitle = fields.prTitle;
    if (row.baseBranch !== fields.baseBranch) data.baseBranch = fields.baseBranch;
    if (row.headSha !== fields.headSha) data.headSha = fields.headSha;
    if (row.closedAt !== null) data.closedAt = null; // reopened
    if (Object.keys(data).length > 0) plan.updates.push({ id: row.id, data });
  }

  for (const row of rows) {
    if (row.prNumber === null || open.has(row.prNumber)) continue;
    if (row.closedAt === null) plan.checkPulls.push({ id: row.id, number: row.prNumber, headSha: row.headSha });
    else if (now.getTime() - row.closedAt.getTime() > CLOSED_KEEP_MS && row.hermesRunId === null) plan.deletes.push(row.id);
  }
  return plan;
}

/** A watched pull request that left the open list. Null: leave the row as it is. Pure. */
export function planClosedPull(
  check: RepoPlan["checkPulls"][number],
  state: PullState | null,
  now: Date,
): { op: "delete"; id: string } | { op: "update"; id: string; data: WatchUpdate } | null {
  if (state === null || (!state.open && !state.merged)) return { op: "delete", id: check.id };
  // Still open, just past the first 300 in GitHub's list: nothing to do.
  if (state.open) return null;
  return { op: "update", id: check.id, data: { closedAt: now, headSha: state.headSha || check.headSha } };
}

// ---------- applying it ----------

export interface PushWatchSyncInput {
  /** Repos whose card meta sync succeeded this round, with their default branch. */
  synced: { repoFullName: string; defaultBranch: string }[];
  /** Every repo on a non-archived card, including ones that failed this round (their rows stay). */
  cardRepos: string[];
}

export interface PushWatchSyncResult {
  /** Rows of the synced repos after this run. */
  watching: number;
  /** Of those, rows with commits waiting for a review. */
  toReview: number;
  failed: { repo: string; message: string }[];
}

export interface PushWatchDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

const ROW_SELECT = {
  id: true,
  ref: true,
  branch: true,
  prNumber: true,
  prTitle: true,
  baseBranch: true,
  headSha: true,
  reviewedSha: true,
  hermesRunId: true,
  closedAt: true,
} satisfies Prisma.PushWatchSelect;

async function applyPlan(plan: RepoPlan, access: GithubAccess, repo: string, now: Date): Promise<void> {
  if (plan.creates.length > 0) await prisma.pushWatch.createMany({ data: plan.creates, skipDuplicates: true });
  for (const { id, data } of plan.updates) await prisma.pushWatch.updateMany({ where: { id }, data });
  for (const check of plan.checkPulls) {
    const change = planClosedPull(check, await fetchPull(repo, check.number, access), now);
    if (change?.op === "delete") plan.deletes.push(change.id);
    else if (change) await prisma.pushWatch.updateMany({ where: { id: change.id }, data: change.data });
  }
  if (plan.deletes.length > 0) await prisma.pushWatch.deleteMany({ where: { id: { in: plan.deletes } } });
}

/**
 * Brings the PushWatch rows in line with GitHub (2 calls per repo, plus one per pull request that
 * just closed). One repo failing is recorded and the others still run.
 */
export async function syncPushWatches(now: Date, input: PushWatchSyncInput, deps: PushWatchDeps = {}): Promise<PushWatchSyncResult> {
  const result: PushWatchSyncResult = { watching: 0, toReview: 0, failed: [] };
  const keep = [...new Set(input.cardRepos.map((repo) => repo.trim().toLowerCase()))];
  await prisma.pushWatch.deleteMany({ where: { repo: { notIn: keep } } });

  const synced = new Map<string, string>();
  for (const { repoFullName, defaultBranch } of input.synced) {
    const repo = repoFullName.trim().toLowerCase();
    if (!synced.has(repo) && defaultBranch) synced.set(repo, defaultBranch);
  }
  if (synced.size === 0) return result;
  const access: GithubAccess = { token: loadGithubToken(deps.env ?? process.env), fetch: deps.fetch ?? fetch };

  for (const [repo, defaultBranch] of synced) {
    try {
      const [defaultHead, openPulls] = await Promise.all([fetchBranchHead(repo, defaultBranch, access), fetchOpenPulls(repo, access)]);
      const rows = await prisma.pushWatch.findMany({ where: { repo }, select: ROW_SELECT });
      await applyPlan(planRepoWatches({ repo, defaultBranch, defaultHead, openPulls }, rows, now), access, repo, now);
    } catch (error) {
      result.failed.push({ repo, message: safeErrorMessage(error) });
    }
  }

  const rows = await prisma.pushWatch.findMany({ where: { repo: { in: [...synced.keys()] } }, select: { headSha: true, reviewedSha: true } });
  result.watching = rows.length;
  result.toReview = rows.filter((row) => row.reviewedSha !== row.headSha).length;
  return result;
}

/** `pushes: watching 3 · 1 to review`, with failures appended. */
export function formatPushWatchResult(result: PushWatchSyncResult): string {
  const base = `pushes: watching ${result.watching} · ${result.toReview} to review`;
  return result.failed.length === 0 ? base : `${base} · failed ${result.failed.map((entry) => `${entry.repo}: ${entry.message}`).join("; ")}`;
}
