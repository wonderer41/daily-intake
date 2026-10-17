import type { CommitSummary } from "@/lib/integrations/github/pushes";

// Which commits a review looks at. Pure, so the rules are easy to test.

/** A review covers at most this many commits (the newest); older ones are counted, not listed. */
export const MAX_REVIEW_COMMITS = 50;

/**
 * A pull request's commits (oldest first) after the last reviewed one. All of them when nothing
 * was reviewed yet, or when that commit is gone from the list (a force push rewrote the branch).
 */
export function pullCommitsAfter(commits: readonly CommitSummary[], reviewedSha: string | null): CommitSummary[] {
  if (reviewedSha === null) return [...commits];
  const index = commits.findIndex((commit) => commit.sha === reviewedSha);
  return index === -1 ? [...commits] : commits.slice(index + 1);
}

/** Commits to describe: no merge commits, newest MAX_REVIEW_COMMITS, oldest first. */
export function reviewableCommits(commits: readonly CommitSummary[]): { commits: CommitSummary[]; leftOut: number } {
  const own = commits.filter((commit) => !commit.merge);
  const kept = own.slice(-MAX_REVIEW_COMMITS);
  return { commits: kept, leftOut: own.length - kept.length };
}

/**
 * Default-branch commits minus the ones a watched pull request brought in (already reviewed
 * there). `pullsOf` gives each commit's pull request numbers; `watched` the repo's watched ones.
 */
export function withoutWatchedPulls(
  commits: readonly CommitSummary[],
  pullsOf: ReadonlyMap<string, readonly number[]>,
  watched: ReadonlySet<number>,
): CommitSummary[] {
  return commits.filter((commit) => !(pullsOf.get(commit.sha) ?? []).some((number) => watched.has(number)));
}
