// Manual refresh of the orphans list: reads ORPHANS_DIR, removes the entries that are gone (resolving
// their Important entries), adds new ones and rewrites the banner list. Never adds a check: only the
// worker's Wednesday run does. Use it after fixing orphans by hand.
// Usage: npm run orphans:check   (in the deploy stack: docker exec <stack>-worker-1 npm run orphans:check)
import "dotenv/config";
import { checksLabel } from "@/components/dashboard/sections/banner/format";
import { prisma } from "@/lib/db/prisma";
import { orphansDir } from "@/lib/integrations/orphans/folder";
import { formatOrphansCheck, runOrphansCheck } from "@/lib/integrations/orphans/sync";
import { dashboardTimeZone } from "@/lib/time/zone";

async function main(): Promise<void> {
  const dir = orphansDir();
  if (!dir) throw new Error("ORPHANS_DIR is not set");
  const now = new Date();
  const result = await runOrphansCheck({ dir, mode: "refresh", runFor: now, now, timeZone: dashboardTimeZone() });

  console.log(`Orphans · ${dir}`);
  console.log(formatOrphansCheck(result));
  for (const item of result.snapshot.items) console.log(`  ${checksLabel(item.checks).padEnd(9)} ${item.name}`);
  const hidden = result.snapshot.total - result.snapshot.items.length;
  if (hidden > 0) console.log(`  +${hidden} more`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
