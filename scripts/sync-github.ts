// Runs one GitHub sync (the worker's github-sync job): the card meta line, then the push watch.
// Prints a line per card and per watched branch. Reviews themselves run in the worker.
// Usage: npm run sync:github
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { formatMetaLine } from "@/lib/dashboard/meta-line";
import { type CardMetaOutcome, syncGithubCardMeta } from "@/lib/integrations/github/card-meta";
import { formatPushWatchResult, syncPushWatches } from "@/lib/push-review/detect";
import { dashboardTimeZone } from "@/lib/time/zone";
import { pushWatchInput } from "@/lib/worker/github-job";

async function main(): Promise<void> {
  const timeZone = dashboardTimeZone();
  const now = new Date();
  const result = await syncGithubCardMeta(now);
  const { updated, unchanged, failed } = result;

  const rows = [
    ...updated.map((entry) => ({ entry, status: "updated" })),
    ...unchanged.map((entry) => ({ entry, status: "unchanged" })),
    ...failed.map((entry) => ({ entry, status: `failed: ${entry.message}` })),
  ];
  if (rows.length === 0) {
    console.log("no cards with repos");
    return;
  }

  const metaLine = ({ repoFullName, meta }: CardMetaOutcome) => formatMetaLine({ repoFullName, meta }, now, timeZone) ?? "-";
  const lines = rows.map(({ entry, status }) => ({ repo: entry.repoFullName, line: metaLine(entry), status }));
  const repoWidth = Math.max(...lines.map(({ repo }) => repo.length));
  const lineWidth = Math.max(...lines.map(({ line }) => line.length));
  for (const { repo, line, status } of lines) console.log(`${repo.padEnd(repoWidth)}  ${line.padEnd(lineWidth)}  (${status})`);

  const pushes = await syncPushWatches(now, pushWatchInput(result));
  console.log(`\n${formatPushWatchResult(pushes)}`);
  const watches = await prisma.pushWatch.findMany({ orderBy: [{ repo: "asc" }, { ref: "asc" }] });
  for (const watch of watches) {
    const where = watch.prNumber === null ? watch.branch : `#${watch.prNumber} ${watch.branch}`;
    const state = watch.reviewedSha === watch.headSha ? "reviewed" : `waiting for review (from ${watch.reviewedSha?.slice(0, 7) ?? "the start"})`;
    const error = watch.lastError ? ` · last error: ${watch.lastError}` : "";
    console.log(`${watch.repo}  ${where}  ${watch.headSha.slice(0, 7)}  ${state}${error}`);
  }
  if (failed.length > 0 || pushes.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
