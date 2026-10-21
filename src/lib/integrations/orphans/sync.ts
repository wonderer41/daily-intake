import type { Prisma } from "@/generated/prisma/client";
import { resolveOpenAlert, upsertAlert } from "@/lib/dashboard/alerts";
import { prisma } from "@/lib/db/prisma";
import { publishLiveEvent } from "@/lib/live/publish";
import type { OrphansSnapshot } from "@/types/dashboard-contracts";
import {
  ORPHANS_ALERT_PREFIX,
  ORPHANS_MOUNT_KEY,
  type OrphansCheckMode,
  orphanAlertInput,
  orphanAlertKey,
  orphansSnapshot,
  planMountAlert,
  planOrphanAlerts,
  planOrphanEntries,
} from "./check";
import { readOrphansFolder } from "./folder";

export interface OrphansCheckResult {
  snapshot: OrphansSnapshot;
  added: number;
  removed: number;
  /** False for a refresh, and for a retry of a Wednesday run that already counted. */
  counted: boolean;
  /** Orphans in Important after this check. */
  important: number;
  opened: number;
  resolved: number;
}

/** When the last Wednesday run wrote its list, for the worker's catch-up. Refreshes (pushedBy user) don't count. */
export async function lastWeeklyCheckAt(): Promise<Date | null> {
  const row = await prisma.bannerSnapshot.findFirst({
    where: { kind: "orphans", pushedBy: "system" },
    orderBy: [{ capturedAt: "desc" }],
    select: { capturedAt: true },
  });
  return row?.capturedAt ?? null;
}

async function raiseMountAlert(problem: string, runFor: Date, now: Date): Promise<void> {
  const existing = await prisma.alert.findUnique({ where: { dedupeKey: ORPHANS_MOUNT_KEY }, select: { resolvedAt: true, meta: true } });
  const input = planMountAlert(existing && existing.resolvedAt === null ? existing : null, runFor, problem);
  if (input) await upsertAlert(ORPHANS_MOUNT_KEY, input, now);
}

/**
 * Lists the folder and brings the entries, the banner list and Important up to date. A weekly run
 * adds 1 to every entry still there, once per Wednesday (`runFor`): a retry of the same run only
 * refreshes. Throws when the folder can't be read; a weekly run raises the mount warning first.
 */
export async function runOrphansCheck(options: {
  dir: string;
  mode: OrphansCheckMode;
  runFor: Date;
  now: Date;
  timeZone: string;
}): Promise<OrphansCheckResult> {
  const { dir, mode, runFor, now, timeZone } = options;
  const folder = await readOrphansFolder(dir);
  if (!folder.ok) {
    if (mode === "weekly") await raiseMountAlert(folder.problem, runFor, now);
    throw new Error(folder.problem);
  }

  // Entries and the list change together, so the list (which the catch-up reads) never claims a
  // Wednesday that wasn't counted.
  const outcome = await prisma.$transaction(async (tx) => {
    const counted =
      mode === "weekly" &&
      !(await tx.bannerSnapshot.findFirst({ where: { kind: "orphans", pushedBy: "system", capturedAt: { gte: runFor } }, select: { id: true } }));
    const plan = planOrphanEntries(folder.names, await tx.orphanEntry.findMany({ select: { id: true, name: true } }));
    if (plan.remove.length > 0) await tx.orphanEntry.deleteMany({ where: { id: { in: plan.remove } } });
    if (plan.keep.length > 0) {
      await tx.orphanEntry.updateMany({
        where: { id: { in: plan.keep } },
        data: counted ? { seenCount: { increment: 1 }, lastSeenAt: now } : { lastSeenAt: now },
      });
    }
    if (plan.create.length > 0) {
      await tx.orphanEntry.createMany({
        data: plan.create.map((name) => ({ name, seenCount: counted ? 1 : 0, firstSeenAt: now, lastSeenAt: now })),
        skipDuplicates: true,
      });
    }
    const entries = await tx.orphanEntry.findMany({ select: { id: true, name: true, seenCount: true, firstSeenAt: true } });
    const snapshot = orphansSnapshot(entries);
    await tx.bannerSnapshot.create({
      data: { kind: "orphans", payload: snapshot as unknown as Prisma.InputJsonObject, capturedAt: now, pushedBy: mode === "weekly" ? "system" : "user" },
    });
    return { entries, snapshot, counted, added: plan.create.length, removed: plan.remove.length };
  });
  await publishLiveEvent({ type: "banner.updated", kind: "orphans" });

  const open = await prisma.alert.findMany({ where: { dedupeKey: { startsWith: ORPHANS_ALERT_PREFIX }, resolvedAt: null }, select: { dedupeKey: true } });
  const alerts = planOrphanAlerts(outcome.entries, open.map((alert) => alert.dedupeKey));
  let opened = 0;
  for (const entry of alerts.upsert) {
    const result = await upsertAlert(orphanAlertKey(entry.id), orphanAlertInput(entry, timeZone), now);
    if (result.created) opened += 1;
  }
  let resolved = 0;
  for (const key of alerts.resolve) if (await resolveOpenAlert(key, now)) resolved += 1;
  // The folder read fine.
  if (await resolveOpenAlert(ORPHANS_MOUNT_KEY, now)) resolved += 1;

  const { snapshot, added, removed, counted } = outcome;
  return { snapshot, added, removed, counted, important: alerts.upsert.length, opened, resolved };
}

/** Log line: "3 in folder (+1 new, 2 gone) · counted · 1 in Important (+1)". */
export function formatOrphansCheck(result: OrphansCheckResult): string {
  const changes = [result.opened && `+${result.opened}`, result.resolved && `${result.resolved} resolved`].filter(Boolean);
  return [
    `${result.snapshot.total} in folder (+${result.added} new, ${result.removed} gone)`,
    result.counted ? "counted" : "not counted",
    `${result.important} in Important${changes.length ? ` (${changes.join(", ")})` : ""}`,
  ].join(" · ");
}
