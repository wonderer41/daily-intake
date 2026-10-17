import { HttpError } from "@/lib/api/http";
import { type FetchLike, githubGet, repoApiPath } from "./api";

// Read-only GitHub calls behind the push review: branch heads, pull requests, commit lists and
// single commits with their diffs.

const PER_PAGE = 100;
const MAX_PAGES = 3;

export interface GithubAccess {
  token: string;
  fetch: FetchLike;
}

export interface OpenPull {
  number: number;
  title: string;
  /** The branch with the changes. */
  headRef: string;
  headSha: string;
  /** The branch it merges into. */
  baseRef: string;
}

export interface PullState {
  open: boolean;
  merged: boolean;
  headSha: string;
}

export interface CommitSummary {
  sha: string;
  /** Merge commits (2+ parents) are never reviewed themselves. */
  merge: boolean;
  message: string;
  author: string;
  /** ISO committer date (author date when missing). */
  committedAt: string | null;
}

export interface CommitFile {
  filename: string;
  /** added, modified, removed, renamed… */
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff text; absent for binary files and files GitHub finds too large. */
  patch: string | null;
}

export interface CommitDetail extends CommitSummary {
  files: CommitFile[];
}

/** Branch names keep their slashes; each segment is encoded on its own. */
function encodePath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function summaryOf(raw: unknown): CommitSummary | null {
  const entry = record(raw);
  const sha = str(entry.sha);
  if (!sha) return null;
  const commit = record(entry.commit);
  const committer = record(commit.committer);
  const author = record(commit.author);
  const date = str(committer.date) || str(author.date);
  const login = str(record(entry.author).login);
  return {
    sha,
    merge: Array.isArray(entry.parents) && entry.parents.length > 1,
    message: str(commit.message),
    author: login || str(author.name),
    committedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
  };
}

async function pages(first: URL, repo: string, access: GithubAccess, what: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let page: URL | null = first;
  for (let fetched = 0; page && fetched < MAX_PAGES; fetched += 1) {
    const reply = await githubGet(page, repo, access.token, access.fetch);
    if (!Array.isArray(reply.body)) throw new HttpError("UPSTREAM_ERROR", `GitHub returned a malformed ${what} for ${repo}`);
    rows.push(...reply.body);
    page = reply.next;
  }
  return rows;
}

/** The newest commit on a branch; null when the branch doesn't exist or the repository is empty. */
export async function fetchBranchHead(repo: string, branch: string, access: GithubAccess): Promise<string | null> {
  const url = new URL(`${repoApiPath(repo)}/branches/${encodePath(branch)}`);
  const reply = await githubGet(url, repo, access.token, access.fetch, [404, 409]);
  const sha = str(record(record(reply.body).commit).sha);
  return sha || null;
}

/** Open pull requests, up to 300. */
export async function fetchOpenPulls(repo: string, access: GithubAccess): Promise<OpenPull[]> {
  const url = new URL(`${repoApiPath(repo)}/pulls`);
  url.searchParams.set("state", "open");
  url.searchParams.set("per_page", String(PER_PAGE));
  const rows = await pages(url, repo, access, "pull request list");
  return rows.flatMap((raw) => {
    const pull = record(raw);
    const head = record(pull.head);
    const base = record(pull.base);
    const number = num(pull.number);
    const headSha = str(head.sha);
    return number > 0 && headSha ? [{ number, title: str(pull.title), headRef: str(head.ref), headSha, baseRef: str(base.ref) }] : [];
  });
}

/** One pull request's state; null when GitHub no longer has it. */
export async function fetchPull(repo: string, number: number, access: GithubAccess): Promise<PullState | null> {
  const url = new URL(`${repoApiPath(repo)}/pulls/${number}`);
  const reply = await githubGet(url, repo, access.token, access.fetch, [404]);
  if (reply.status === 404) return null;
  const pull = record(reply.body);
  return { open: pull.state === "open", merged: typeof pull.merged_at === "string", headSha: str(record(pull.head).sha) };
}

/** A pull request's own commits, oldest first (up to 300). */
export async function fetchPullCommits(repo: string, number: number, access: GithubAccess): Promise<CommitSummary[]> {
  const url = new URL(`${repoApiPath(repo)}/pulls/${number}/commits`);
  url.searchParams.set("per_page", String(PER_PAGE));
  const rows = await pages(url, repo, access, "commit list");
  return rows.map(summaryOf).filter((commit): commit is CommitSummary => commit !== null);
}

/**
 * Commits reachable from `head` but not from where it split off `base`, oldest first (GitHub
 * returns at most 250). Null when GitHub can't compare them (a commit is gone after a force push).
 */
export async function fetchCompareCommits(repo: string, base: string, head: string, access: GithubAccess): Promise<CommitSummary[] | null> {
  const url = new URL(`${repoApiPath(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  const reply = await githubGet(url, repo, access.token, access.fetch, [404]);
  if (reply.status === 404) return null;
  const commits = record(reply.body).commits;
  if (!Array.isArray(commits)) throw new HttpError("UPSTREAM_ERROR", `GitHub returned a malformed comparison for ${repo}`);
  return commits.map(summaryOf).filter((commit): commit is CommitSummary => commit !== null);
}

/** One commit with its changed files and diffs (GitHub lists up to 300 files). */
export async function fetchCommit(repo: string, sha: string, access: GithubAccess): Promise<CommitDetail> {
  const url = new URL(`${repoApiPath(repo)}/commits/${encodeURIComponent(sha)}`);
  const reply = await githubGet(url, repo, access.token, access.fetch);
  const summary = summaryOf(reply.body);
  if (!summary) throw new HttpError("UPSTREAM_ERROR", `GitHub returned a malformed commit for ${repo}`);
  const files = record(reply.body).files;
  return {
    ...summary,
    files: (Array.isArray(files) ? files : []).map((raw) => {
      const file = record(raw);
      return {
        filename: str(file.filename),
        status: str(file.status),
        additions: num(file.additions),
        deletions: num(file.deletions),
        patch: typeof file.patch === "string" ? file.patch : null,
      };
    }),
  };
}

/** Numbers of the pull requests a commit belongs to (open ones, or the merged one that brought it in). */
export async function fetchCommitPulls(repo: string, sha: string, access: GithubAccess): Promise<number[]> {
  const url = new URL(`${repoApiPath(repo)}/commits/${encodeURIComponent(sha)}/pulls`);
  const reply = await githubGet(url, repo, access.token, access.fetch, [404, 422]);
  if (!Array.isArray(reply.body)) return [];
  return reply.body.map((pull) => num(record(pull).number)).filter((number) => number > 0);
}
