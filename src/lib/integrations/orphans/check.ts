import { MAX_ORPHANS } from "@/lib/dashboard/banner-payload";
import type { AlertInput } from "@/lib/hermes/parse";
import type { OrphansSnapshot } from "@/types/dashboard-contracts";

// The orphans check, pure parts. Every Wednesday check (the orphans-check job) adds 1 to each entry
// still in the folder; an entry listed on ORPHAN_ALERT_CHECKS of them in a row shows in Important
// until it leaves the folder. A refresh (npm run orphans:check) only adds and removes entries.
// Raised by the dashboard itself; Hermes never touches orphans:* alerts.

export const ORPHANS_ALERT_PREFIX = "orphans:";
export const ORPHANS_MOUNT_KEY = "orphans:mount";
const ENTRY_PREFIX = "orphans:entry:";
/** Wednesday checks an orphan has to be listed on before it shows in Important. */
export const ORPHAN_ALERT_CHECKS = 2;
/** Wednesdays in a row the missing-mount warning is raised or updated; after that it is only logged. */
export const MOUNT_ALERT_RUNS = 2;
const TITLE_MAX = 200;
const DETAIL_MAX = 500;

/** `weekly` is the Wednesday run (adds a check); `refresh` is a manual run (adds nothing). */
export type OrphansCheckMode = "weekly" | "refresh";

export interface OrphanEntryRow {
  id: string;
  name: string;
  seenCount: number;
  firstSeenAt: Date;
}

export function orphanAlertKey(entryId: string): string {
  return `${ENTRY_PREFIX}${entryId}`;
}

export interface OrphanEntryPlan {
  /** Names not tracked yet. */
  create: string[];
  /** Ids of tracked entries still in the folder. */
  keep: string[];
  /** Ids of tracked entries gone from the folder. */
  remove: string[];
}

/** How the tracked entries change for one listing of the folder. */
export function planOrphanEntries(names: readonly string[], rows: readonly { id: string; name: string }[]): OrphanEntryPlan {
  const listed = new Set(names);
  const tracked = new Set(rows.map((row) => row.name));
  return {
    create: [...listed].filter((name) => !tracked.has(name)),
    keep: rows.filter((row) => listed.has(row.name)).map((row) => row.id),
    remove: rows.filter((row) => !listed.has(row.name)).map((row) => row.id),
  };
}

/** "Oct 21" in the dashboard zone. */
function shortDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
}

export function orphanAlertInput(entry: OrphanEntryRow, timeZone: string): AlertInput {
  return {
    source: "orphans",
    title: entry.name.length > TITLE_MAX ? `${entry.name.slice(0, TITLE_MAX - 1)}…` : entry.name,
    detail: `Still in orphaned_data after ${entry.seenCount} checks (first seen ${shortDate(entry.firstSeenAt, timeZone)})`,
    url: null,
    severity: "warning",
    meta: undefined,
  };
}

/** Entries to open or update in Important, and open orphans:* alerts to resolve (the mount warning aside). */
export function planOrphanAlerts(
  entries: readonly OrphanEntryRow[],
  openKeys: readonly string[],
): { upsert: OrphanEntryRow[]; resolve: string[] } {
  const upsert = entries.filter((entry) => entry.seenCount >= ORPHAN_ALERT_CHECKS);
  const wanted = new Set(upsert.map((entry) => orphanAlertKey(entry.id)));
  // Also clears keys from the old Hermes-owned orphans job (orphans:<arr>:<slug>).
  return { upsert, resolve: openKeys.filter((key) => key !== ORPHANS_MOUNT_KEY && !wanted.has(key)) };
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The banner list: longest-waiting first (most checks, then first seen), capped at MAX_ORPHANS. */
export function orphansSnapshot(entries: readonly OrphanEntryRow[]): OrphansSnapshot {
  const sorted = [...entries].sort(
    (a, b) => b.seenCount - a.seenCount || a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || byName(a.name, b.name),
  );
  return {
    total: entries.length,
    items: sorted.slice(0, MAX_ORPHANS).map((entry) => ({ name: entry.name, checks: entry.seenCount, firstSeenAt: entry.firstSeenAt.toISOString() })),
  };
}

/**
 * What a Wednesday run that can't read the folder does in Important: raise "Set up the orphans mount"
 * on the first MOUNT_ALERT_RUNS Wednesdays in a row, then only log (null). `open` is the open
 * orphans:mount alert, if any. A retry of the same Wednesday (`runFor`) counts once.
 */
export function planMountAlert(open: { meta: unknown } | null, runFor: Date, problem: string): AlertInput | null {
  const meta = open && typeof open.meta === "object" && open.meta !== null ? (open.meta as Record<string, unknown>) : {};
  if (open && meta.runFor === runFor.toISOString()) return null;
  const runs = (open && typeof meta.runs === "number" ? meta.runs : 0) + 1;
  if (runs > MOUNT_ALERT_RUNS) return null;
  return {
    source: "orphans",
    title: "Set up the orphans mount",
    detail: (runs === 1 ? problem : `${problem} (${runs} Wednesdays in a row)`).slice(0, DETAIL_MAX),
    url: null,
    severity: "warning",
    meta: { runs, runFor: runFor.toISOString() },
  };
}
