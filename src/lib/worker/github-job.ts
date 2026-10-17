import { isPlainObject } from "@/lib/api/validate";
import { cardMetaJobSummary, type CardMetaSyncResult, syncGithubCardMeta } from "@/lib/integrations/github/card-meta";
import { formatPushWatchResult, type PushWatchSyncInput, syncPushWatches } from "@/lib/push-review/detect";

/** The push watch's input from a card meta sync: repos that synced (with their default branch) and every card repo. */
export function pushWatchInput(result: CardMetaSyncResult): PushWatchSyncInput {
  const synced = [...result.updated, ...result.unchanged];
  return {
    synced: synced.flatMap(({ repoFullName, meta }) => {
      const github = isPlainObject(meta.github) ? meta.github : null;
      const defaultBranch = typeof github?.defaultBranch === "string" ? github.defaultBranch : "";
      return defaultBranch ? [{ repoFullName, defaultBranch }] : [];
    }),
    cardRepos: [...synced, ...result.failed].map(({ repoFullName }) => repoFullName),
  };
}

/**
 * The worker's github-sync job: the card meta line, then the push watch (new commits for the
 * push-review job). Throws when every card failed.
 */
export async function runGithubSyncJob(now: Date): Promise<string> {
  const meta = await syncGithubCardMeta(now);
  const summary = cardMetaJobSummary(meta);
  const pushes = await syncPushWatches(now, pushWatchInput(meta));
  return `${summary} · ${formatPushWatchResult(pushes)}`;
}
