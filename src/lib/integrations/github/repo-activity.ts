import { HttpError } from "@/lib/api/http";
import { type FetchLike, githubGet as get, type GithubReply as Reply, repoApiPath } from "./api";

export { parseRepoFullName } from "./api";

// Read-only GitHub calls behind the card meta line.

const PER_PAGE = 100;
const MAX_COMMIT_PAGES = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface RepoActivity {
  defaultBranch: string;
  /** ISO time of the newest commit on the default branch (committer date); null for an empty repository. */
  lastCommitAt: string | null;
  /** Commits on the default branch in the last 7 days, counted up to MAX_COMMIT_PAGES * PER_PAGE. */
  weeklyCommits: number;
}

function committedAt(commit: unknown): number | null {
  const details = (commit as { commit?: { committer?: { date?: unknown }; author?: { date?: unknown } } } | null)?.commit;
  const raw = details?.committer?.date ?? details?.author?.date;
  const time = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

/** Commits of a branch, newest first as GitHub lists them. A 409 means the repository is empty. */
async function listCommits(url: URL, repo: string, token: string, fetchImpl: FetchLike, maxPages: number): Promise<unknown[]> {
  const commits: unknown[] = [];
  let page: URL | null = url;
  for (let fetched = 0; page && fetched < maxPages; fetched += 1) {
    const reply: Reply = await get(page, repo, token, fetchImpl, [409]);
    if (reply.status === 409) return [];
    if (!Array.isArray(reply.body)) throw new HttpError("UPSTREAM_ERROR", `GitHub returned a malformed commit list for ${repo}`);
    commits.push(...reply.body);
    page = reply.next;
  }
  return commits;
}

/**
 * Default branch, newest commit and the last 7 days' commit count for one repository.
 * Two calls when the week has commits; three when it has none (the newest commit ever is then fetched on its own).
 */
export async function fetchRepoActivity(repoFullName: string, token: string, now: Date, fetchImpl: FetchLike = fetch): Promise<RepoActivity> {
  const repoPath = repoApiPath(repoFullName);

  const repository = (await get(new URL(repoPath), repoFullName, token, fetchImpl)).body as { default_branch?: unknown } | null;
  const defaultBranch = typeof repository?.default_branch === "string" ? repository.default_branch : "";
  if (!defaultBranch) throw new HttpError("UPSTREAM_ERROR", `GitHub returned no default branch for ${repoFullName}`);

  const week = new URL(`${repoPath}/commits`);
  week.searchParams.set("sha", defaultBranch);
  week.searchParams.set("since", new Date(now.getTime() - WEEK_MS).toISOString());
  week.searchParams.set("per_page", String(PER_PAGE));
  const recent = await listCommits(week, repoFullName, token, fetchImpl, MAX_COMMIT_PAGES);

  let newest = recent.map(committedAt).filter((time): time is number => time !== null).reduce<number | null>((max, time) => (max === null || time > max ? time : max), null);
  if (recent.length === 0) {
    const latest = new URL(`${repoPath}/commits`);
    latest.searchParams.set("sha", defaultBranch);
    latest.searchParams.set("per_page", "1");
    newest = (await listCommits(latest, repoFullName, token, fetchImpl, 1)).map(committedAt).find((time) => time !== null) ?? null;
  }

  return {
    defaultBranch,
    lastCommitAt: newest === null ? null : new Date(newest).toISOString(),
    weeklyCommits: recent.length,
  };
}
