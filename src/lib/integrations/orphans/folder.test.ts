import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { describeReadError, judgeListing, orphansDir, readOrphansFolder } from "./folder";

test("ORPHANS_DIR empty or unset turns the check off", () => {
  const env = (value?: string) => ({ ORPHANS_DIR: value }) as unknown as NodeJS.ProcessEnv;
  assert.equal(orphansDir(env()), null);
  assert.equal(orphansDir(env("  ")), null);
  assert.equal(orphansDir(env(" /mnt/nas/orphaned_data ")), "/mnt/nas/orphaned_data");
});

test("an empty folder owned by root is the one Docker made: not mounted", () => {
  assert.deepEqual(judgeListing("/data/orphans", [], 0), {
    ok: false,
    problem: "/data/orphans is empty and owned by root: the folder isn't mounted into the worker",
  });
  assert.deepEqual(judgeListing("/data/orphans", [], 1000), { ok: true, names: [] });
  // Root-owned but with entries in it: real data, whoever owns it.
  assert.deepEqual(judgeListing("/data/orphans", ["b", "a"], 0), { ok: true, names: ["a", "b"] });
});

test("read errors name the path and the reason", () => {
  const error = (code: string) => Object.assign(new Error(code), { code });
  assert.equal(describeReadError("/x", error("ENOENT")), "/x doesn't exist");
  assert.equal(describeReadError("/x", error("ENOTDIR")), "/x is not a folder");
  assert.match(describeReadError("/x", error("EACCES")), /^\/x can't be read by uid \d+$/);
  assert.equal(describeReadError("/x", new Error("boom")), "/x can't be read: boom");
});

test("the top level is listed, dotfiles and folders included, never deeper", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "orphans-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "Movie.2024.1080p"));
  await writeFile(path.join(dir, "Movie.2024.1080p", "movie.mkv"), "");
  await writeFile(path.join(dir, ".abc123.parts"), "");
  await writeFile(path.join(dir, "Show.S01E02.mkv"), "");

  assert.deepEqual(await readOrphansFolder(dir), { ok: true, names: [".abc123.parts", "Movie.2024.1080p", "Show.S01E02.mkv"] });
  assert.deepEqual(await readOrphansFolder(path.join(dir, "missing")), { ok: false, problem: `${path.join(dir, "missing")} doesn't exist` });
});

test("an empty folder the worker owns reads as no orphans", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "orphans-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Running as root (some CI containers), an empty temp folder is root-owned too.
  assert.equal((await readOrphansFolder(dir)).ok, process.getuid?.() !== 0);
});

test("a folder the worker can't read is reported, not read as empty", { skip: process.getuid?.() === 0 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "orphans-"));
  t.after(async () => {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, "x.mkv"), "");
  await chmod(dir, 0o000);
  const folder = await readOrphansFolder(dir);
  assert.equal(folder.ok, false);
  assert.match(folder.ok ? "" : folder.problem, /can't be read by uid/);
});
