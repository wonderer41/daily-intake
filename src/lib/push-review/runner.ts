import type { PushWatch } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import { resolveOpenAlert, upsertAlert } from "@/lib/dashboard/alerts";
import { upsertItemProgress } from "@/lib/dashboard/progress";
import { loadGithubToken } from "@/lib/integrations/github/api";
import {
  type CommitDetail,
  type CommitSummary,
  fetchCommit,
  fetchCommitPulls,
  fetchCompareCommits,
  fetchPullCommits,
  type GithubAccess,
} from "@/lib/integrations/github/pushes";
import { safeErrorMessage } from "@/lib/live/redact";
import { getRun, HermesApiError, isTerminal, loadHermesApiConfig, startRun, stopRun } from "@/lib/schedule/hermes-runs";
import { parseReviewReply, type ReviewItem, reviewPrompt, type ReviewTarget } from "./prompt";
import { pullCommitsAfter, reviewableCommits, withoutWatchedPulls } from "./select";

// The worker's push-review job: for each PushWatch row with commits after reviewedSha, reads them
// from GitHub, asks Hermes (through its API server) which open checklist items they move forward,
// and writes the answer as push updates on the newest reviewed commit. Several pushes between two
// reviews become one review. A run already started is resumed after a worker restart.
//
// A failed review is retried on a later sync (new pushes join it). The third failure in a row
// moves past those commits and raises the Important alert github:push-review:<owner/repo>, which
// the repo's next successful review resolves.

export const MAX_RUNNING = 2;
export const RUN_TIMEOUT_MS = 10 * 60_000;
export const RETRY_DELAY_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
const POLL_MS = 3_000;
/** Commits whose files and diff are fetched (the newest ones); older ones are listed by message only. */
const DETAIL_COMMITS = 20;

export interface PushReviewDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const inFlight = new Set<string>();

/** One tick: starts work on rows with commits to review, up to MAX_RUNNING at once. */
export async function runPushReviewQueue(deps: PushReviewDeps = {}): Promise<string> {
  const free = MAX_RUNNING - inFlight.size;
  if (free <= 0) return "";
  // A handful of rows per repo, so the filtering happens here rather than in SQL.
  const now = Date.now();
  const rows = (
    await prisma.pushWatch.findMany({
      orderBy: { updatedAt: "asc" },
      select: { id: true, headSha: true, reviewedSha: true, hermesRunId: true, nextAttemptAt: true },
    })
  ).filter(
    (row) =>
      // A run that was going when the worker stopped, or commits waiting whose retry time has come.
      row.hermesRunId !== null || (row.reviewedSha !== row.headSha && (row.nextAttemptAt === null || row.nextAttemptAt.getTime() <= now)),
  );

  let started = 0;
  for (const { id } of rows) {
    if (started >= free) break;
    if (inFlight.has(id)) continue;
    inFlight.add(id);
    started += 1;
    void processPushReview(id, deps)
      .then((outcome) => console.log(`[push-review] ${outcome}`))
      .catch((error: unknown) => console.error(`[push-review] ${id} failed: ${safeErrorMessage(error)}`))
      .finally(() => inFlight.delete(id));
  }
  return started ? `picked up ${started}` : "";
}

function label(row: Pick<PushWatch, "repo" | "branch" | "prNumber">): string {
  return row.prNumber === null ? `${row.repo}@${row.branch}` : `${row.repo}#${row.prNumber}`;
}

const RUN_CLEARED = { hermesRunId: null, runStartedAt: null, runToSha: null, runCommitSha: null, runCommittedAt: null };

/** Marks the commits up to `toSha` as handled without a review (nothing to match, or Hermes isn't set up). */
async function skipTo(row: PushWatch, toSha: string): Promise<void> {
  await prisma.pushWatch.updateMany({
    where: { id: row.id, hermesRunId: null },
    data: { reviewedSha: toSha, attempts: 0, nextAttemptAt: null, lastError: null },
  });
}

export async function processPushReview(id: string, deps: PushReviewDeps = {}): Promise<string> {
  const env = deps.env ?? process.env;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let row = await prisma.pushWatch.findUnique({ where: { id } });
  if (!row) return `${id} gone`;
  const name = label(row);
  const config = loadHermesApiConfig(env);

  if (!row.hermesRunId) {
    if (row.reviewedSha === row.headSha) return `${name} nothing new`;
    if (!config) {
      await skipTo(row, row.headSha);
      return `${name} skipped: HERMES_API_URL / HERMES_API_KEY not set`;
    }
    const toSha = row.headSha;
    let prepared: Prepared;
    try {
      prepared = await prepareReview(row, { token: loadGithubToken(env), fetch: deps.fetch ?? fetch });
    } catch (error) {
      return recordFailure(row, toSha, `reading GitHub failed: ${safeErrorMessage(error)}`);
    }
    if (prepared.kind === "skip") {
      await skipTo(row, toSha);
      return `${name} skipped: ${prepared.reason}`;
    }

    let runId: string;
    try {
      runId = await startRun(config, prepared.prompt, `push-review:${row.id}:${toSha}:${row.attempts}`);
    } catch (error) {
      const busy = error instanceof HermesApiError && error.busy;
      return recordFailure(row, toSha, busy ? "Hermes was busy" : `starting the run failed: ${safeErrorMessage(error)}`);
    }
    const { count } = await prisma.pushWatch.updateMany({
      where: { id, hermesRunId: null },
      data: { hermesRunId: runId, runStartedAt: new Date(), runToSha: toSha, runCommitSha: prepared.commitSha, runCommittedAt: prepared.committedAt },
    });
    if (count === 0) {
      await stopRun(config, runId);
      return `${name} changed while starting; run stopped`;
    }
    row = await prisma.pushWatch.findUnique({ where: { id } });
    if (!row) {
      await stopRun(config, runId);
      return `${name} no longer watched; run stopped`;
    }
  }

  return followRun(row, deps, sleep);
}

/** Polls the row's run until it ends, then writes its answer or records the failure. */
async function followRun(row: PushWatch, deps: PushReviewDeps, sleep: (ms: number) => Promise<void>): Promise<string> {
  const env = deps.env ?? process.env;
  const name = label(row);
  const runId = row.hermesRunId ?? "";
  const toSha = row.runToSha ?? row.headSha;
  const config = loadHermesApiConfig(env);
  if (!config) return recordFailure(row, toSha, "HERMES_API_URL / HERMES_API_KEY were removed while a review was running");
  const deadline = (row.runStartedAt ?? new Date()).getTime() + RUN_TIMEOUT_MS;

  for (;;) {
    if (Date.now() > deadline) {
      await stopRun(config, runId);
      return recordFailure(row, toSha, `Hermes didn't answer within ${RUN_TIMEOUT_MS / 60_000} minutes`);
    }
    const state = await getRun(config, runId).catch(() => null); // a blip: try again until the deadline
    if (state && isTerminal(state.status)) {
      if (state.status !== "completed") return recordFailure(row, toSha, `the Hermes run ended ${state.status}`);
      const reply = parseReviewReply(state.output);
      if (!reply) return recordFailure(row, toSha, "Hermes's answer couldn't be read");
      if (reply.status === "error") return recordFailure(row, toSha, `Hermes: ${reply.message || "couldn't review"}`);
      const written = await writeUpdates(row, reply.updates);
      const { count } = await prisma.pushWatch.updateMany({
        where: { id: row.id, hermesRunId: runId },
        data: { ...RUN_CLEARED, reviewedSha: toSha, attempts: 0, nextAttemptAt: null, lastError: null },
      });
      if (count > 0) await resolveOpenAlert(alertKey(row.repo));
      return `${name} reviewed: ${written} push update${written === 1 ? "" : "s"}`;
    }
    const current = await prisma.pushWatch.findUnique({ where: { id: row.id }, select: { hermesRunId: true } });
    if (current?.hermesRunId !== runId) {
      await stopRun(config, runId);
      return `${name} no longer watched; run stopped`;
    }
    await sleep(POLL_MS);
  }
}

// ---------- reading GitHub ----------

type Prepared = { kind: "skip"; reason: string } | { kind: "review"; prompt: string; commitSha: string; committedAt: Date };

async function openItems(repo: string): Promise<{ items: ReviewItem[]; repoFullName: string }> {
  const cards = await prisma.workCard.findMany({
    where: { status: { not: "archived" }, repoFullName: { equals: repo, mode: "insensitive" } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      title: true,
      repoFullName: true,
      items: { where: { done: false }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, title: true, issueNumber: true } },
    },
  });
  return {
    items: cards.flatMap((card) => card.items.map((item) => ({ id: item.id, cardTitle: card.title, title: item.title, issueNumber: item.issueNumber }))),
    repoFullName: cards[0]?.repoFullName?.trim() || repo,
  };
}

/** The commits to review after reviewedSha (oldest first), minus what was already reviewed elsewhere. */
async function newCommits(row: PushWatch, access: GithubAccess): Promise<{ commits: CommitSummary[]; leftOut: number }> {
  if (row.prNumber !== null) return reviewableCommits(pullCommitsAfter(await fetchPullCommits(row.repo, row.prNumber, access), row.reviewedSha));

  const base = row.reviewedSha ?? row.headSha;
  const compared = await fetchCompareCommits(row.repo, base, row.headSha, access);
  // GitHub can't compare (the old commit is gone after a force push): review the newest commit only.
  const { commits, leftOut } = reviewableCommits(compared ?? [await fetchCommit(row.repo, row.headSha, access)]);
  const watched = await prisma.pushWatch.findMany({ where: { repo: row.repo, prNumber: { not: null } }, select: { prNumber: true } });
  if (watched.length === 0) return { commits, leftOut };
  const pullsOf = new Map<string, number[]>();
  for (const commit of commits) pullsOf.set(commit.sha, await fetchCommitPulls(row.repo, commit.sha, access));
  return { commits: withoutWatchedPulls(commits, pullsOf, new Set(watched.map((entry) => entry.prNumber ?? 0))), leftOut };
}

async function prepareReview(row: PushWatch, access: GithubAccess): Promise<Prepared> {
  const { items, repoFullName } = await openItems(row.repo);
  if (items.length === 0) return { kind: "skip", reason: "no open items on its cards" };

  const { commits, leftOut } = await newCommits(row, access);
  if (commits.length === 0) return { kind: "skip", reason: "only merge commits or commits already reviewed in a pull request" };

  const details: CommitDetail[] = [];
  for (const commit of commits.slice(-DETAIL_COMMITS)) details.push(await fetchCommit(row.repo, commit.sha, access));

  const target: ReviewTarget =
    row.prNumber === null
      ? { kind: "branch", branch: row.branch }
      : { kind: "pull", number: row.prNumber, title: row.prTitle ?? "", branch: row.branch, baseBranch: row.baseBranch ?? "" };
  const newest = commits[commits.length - 1];
  return {
    kind: "review",
    prompt: reviewPrompt({ repoFullName, target, commits, leftOut, details, items }),
    commitSha: newest.sha,
    committedAt: newest.committedAt ? new Date(newest.committedAt) : new Date(),
  };
}

// ---------- writing the answer ----------

/** Push updates for the items Hermes named, if they are still on one of this repo's cards. */
async function writeUpdates(row: PushWatch, updates: { itemId: string; kind: "looks_done" | "partial"; note: string }[]): Promise<number> {
  const sha = row.runCommitSha ?? row.runToSha ?? row.headSha;
  const pushedAt = (row.runCommittedAt ?? new Date()).toISOString();
  let written = 0;
  for (const update of updates) {
    const item = await prisma.checklistItem.findUnique({
      where: { id: update.itemId },
      select: { id: true, cardId: true, card: { select: { repoFullName: true, status: true } } },
    });
    const repoFullName = item?.card.repoFullName?.trim() ?? "";
    if (!item || item.card.status === "archived" || repoFullName.toLowerCase() !== row.repo) continue;
    try {
      await upsertItemProgress({ kind: "id", id: item.cardId }, { kind: "id", id: item.id }, sha, {
        repoFullName,
        kind: update.kind,
        note: update.note,
        pushedAt,
      });
      written += 1;
    } catch (error) {
      if (!(error instanceof HttpError && error.code === "NOT_FOUND")) throw error; // deleted meanwhile
    }
  }
  return written;
}

// ---------- failures ----------

export function alertKey(repo: string): string {
  return `github:push-review:${repo}`;
}

function commitsUrl(row: PushWatch, toSha: string): string {
  const base = `https://github.com/${row.repo}`;
  if (row.prNumber !== null) return `${base}/pull/${row.prNumber}/commits`;
  return row.reviewedSha && row.reviewedSha !== toSha ? `${base}/compare/${row.reviewedSha}...${toSha}` : `${base}/commit/${toSha}`;
}

/**
 * Counts a failed try. Before MAX_ATTEMPTS it waits RETRY_DELAY_MS; the last one moves past
 * `toSha` and raises the Important alert.
 */
async function recordFailure(row: PushWatch, toSha: string, message: string): Promise<string> {
  const name = label(row);
  const attempts = row.attempts + 1;
  const lastError = message.slice(0, 500);
  const where = { id: row.id, hermesRunId: row.hermesRunId };
  if (attempts < MAX_ATTEMPTS) {
    await prisma.pushWatch.updateMany({ where, data: { ...RUN_CLEARED, attempts, lastError, nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS) } });
    return `${name} failed (try ${attempts} of ${MAX_ATTEMPTS}): ${message}`;
  }
  const { count } = await prisma.pushWatch.updateMany({ where, data: { ...RUN_CLEARED, reviewedSha: toSha, attempts: 0, lastError, nextAttemptAt: null } });
  if (count > 0) {
    const place = row.prNumber === null ? row.branch : `pull request #${row.prNumber}`;
    await upsertAlert(alertKey(row.repo), {
      source: "github",
      title: `Hermes couldn't review pushes on ${row.repo}`.slice(0, 200),
      detail: `${place}: ${message}`.slice(0, 500),
      url: commitsUrl(row, toSha),
      severity: "warning",
      meta: undefined,
    });
  }
  return `${name} failed ${MAX_ATTEMPTS} times, moved on: ${message}`;
}
