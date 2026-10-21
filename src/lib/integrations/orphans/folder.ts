import { readdir, stat } from "node:fs/promises";

// The orphaned_data folder qbit_manage moves leftover downloads to, mounted read-only into the worker
// at ORPHANS_DIR (deploy/compose.yml). Only the top level is read: each file or folder there is one
// orphan. Nothing is ever written to it.

/** ORPHANS_DIR, or null when it isn't set (the orphans check is off). */
export function orphansDir(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.ORPHANS_DIR?.trim() || null;
}

export type OrphansFolder = { ok: true; names: string[] } | { ok: false; problem: string };

/**
 * Pure verdict on a listing. An empty folder owned by root is the one Docker creates when the host
 * path doesn't exist (typo, NAS not mounted yet): reading it as "no orphans" would resolve every
 * entry, so it counts as not mounted. The real folder isn't owned by root.
 */
export function judgeListing(dir: string, names: readonly string[], ownerUid: number): OrphansFolder {
  if (names.length === 0 && ownerUid === 0) {
    return { ok: false, problem: `${dir} is empty and owned by root: the folder isn't mounted into the worker` };
  }
  return { ok: true, names: [...names].sort() };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/** One line on why the folder can't be read, naming the path and, for permissions, the worker's uid. */
export function describeReadError(dir: string, error: unknown): string {
  switch (errorCode(error)) {
    case "ENOENT":
      return `${dir} doesn't exist`;
    case "ENOTDIR":
      return `${dir} is not a folder`;
    case "EACCES":
    case "EPERM":
      return `${dir} can't be read by uid ${process.getuid?.() ?? "?"}`;
    default:
      return `${dir} can't be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The names at the top of `dir`, dotfiles included, sorted; or why they can't be trusted. */
export async function readOrphansFolder(dir: string): Promise<OrphansFolder> {
  try {
    const names = await readdir(dir);
    const ownerUid = names.length === 0 ? (await stat(dir)).uid : -1;
    return judgeListing(dir, names, ownerUid);
  } catch (error) {
    return { ok: false, problem: describeReadError(dir, error) };
  }
}
