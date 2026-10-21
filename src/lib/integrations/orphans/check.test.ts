import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ORPHANS } from "@/lib/dashboard/banner-payload";
import {
  ORPHANS_MOUNT_KEY,
  orphanAlertInput,
  orphanAlertKey,
  orphansSnapshot,
  planMountAlert,
  planOrphanAlerts,
  planOrphanEntries,
  type OrphanEntryRow,
} from "./check";

const DENVER = "America/Denver";
const WED = new Date("2026-10-21T13:00:00.000Z"); // Wednesday 07:00 MDT
const entry = (id: string, name: string, seenCount: number, firstSeenAt = WED): OrphanEntryRow => ({ id, name, seenCount, firstSeenAt });

test("a listing creates new names, keeps the listed ones and removes the gone ones", () => {
  const rows = [
    { id: "a", name: "Movie.2024" },
    { id: "b", name: "Gone.S01E01.mkv" },
  ];
  assert.deepEqual(planOrphanEntries(["Movie.2024", ".abc.parts", "New.Show"], rows), {
    create: [".abc.parts", "New.Show"],
    keep: ["a"],
    remove: ["b"],
  });
  assert.deepEqual(planOrphanEntries([], rows), { create: [], keep: [], remove: ["a", "b"] });
});

test("an orphan reaches Important on its second Wednesday check", () => {
  const entries = [entry("1", "new", 0), entry("2", "first", 1), entry("3", "second", 2), entry("4", "fifth", 5)];
  const plan = planOrphanAlerts(entries, []);
  assert.deepEqual(
    plan.upsert.map((row) => row.id),
    ["3", "4"],
  );
  assert.deepEqual(plan.resolve, []);
});

test("open orphans alerts no longer wanted are resolved, the mount warning aside", () => {
  const open = [orphanAlertKey("3"), orphanAlertKey("gone"), "orphans:radarr:old-hermes-key", ORPHANS_MOUNT_KEY];
  const plan = planOrphanAlerts([entry("3", "still", 2)], open);
  assert.deepEqual(plan.resolve, [orphanAlertKey("gone"), "orphans:radarr:old-hermes-key"]);
});

test("the alert names the orphan and how long it has been there", () => {
  const input = orphanAlertInput(entry("3", "SOUND_OF_METAL_2019_CC_UHD-KRUPPE", 3, new Date("2026-10-07T13:00:00.000Z")), DENVER);
  assert.deepEqual(input, {
    source: "orphans",
    title: "SOUND_OF_METAL_2019_CC_UHD-KRUPPE",
    detail: "Still in orphaned_data after 3 checks (first seen Oct 7)",
    url: null,
    severity: "warning",
    meta: undefined,
  });
  assert.equal(orphanAlertKey("3"), "orphans:entry:3");
  const long = orphanAlertInput(entry("4", "x".repeat(255), 2), DENVER).title;
  assert.equal(long.length, 200);
  assert.ok(long.endsWith("…"));
});

test("the banner list puts the longest-waiting first and keeps the total", () => {
  const snapshot = orphansSnapshot([
    entry("1", "b-new", 0, new Date("2026-10-21T15:00:00.000Z")),
    entry("2", "z-old", 3, new Date("2026-10-07T13:00:00.000Z")),
    entry("3", "a-two", 2, new Date("2026-10-14T13:00:00.000Z")),
    entry("4", "a-new", 0, new Date("2026-10-21T15:00:00.000Z")),
  ]);
  assert.equal(snapshot.total, 4);
  assert.deepEqual(
    snapshot.items.map((item) => [item.name, item.checks]),
    [
      ["z-old", 3],
      ["a-two", 2],
      ["a-new", 0],
      ["b-new", 0],
    ],
  );
  assert.equal(snapshot.items[0].firstSeenAt, "2026-10-07T13:00:00.000Z");

  const many = orphansSnapshot(Array.from({ length: MAX_ORPHANS + 5 }, (_, index) => entry(String(index), `n${index}`, 1)));
  assert.equal(many.total, MAX_ORPHANS + 5);
  assert.equal(many.items.length, MAX_ORPHANS);
});

test("the mount warning is raised on the first two Wednesdays in a row, then only logged", () => {
  const problem = "/data/orphans is empty and owned by root: the folder isn't mounted into the worker";
  const first = planMountAlert(null, WED, problem);
  assert.deepEqual(first, {
    source: "orphans",
    title: "Set up the orphans mount",
    detail: problem,
    url: null,
    severity: "warning",
    meta: { runs: 1, runFor: WED.toISOString() },
  });
  // A catch-up retry of the same Wednesday counts once.
  assert.equal(planMountAlert({ meta: first?.meta }, WED, problem), null);

  const nextWed = new Date("2026-10-28T13:00:00.000Z");
  const second = planMountAlert({ meta: first?.meta }, nextWed, problem);
  assert.equal(second?.detail, `${problem} (2 Wednesdays in a row)`);
  assert.deepEqual(second?.meta, { runs: 2, runFor: nextWed.toISOString() });

  assert.equal(planMountAlert({ meta: second?.meta }, new Date("2026-11-04T14:00:00.000Z"), problem), null);
  // Resolved in between (no open alert): it starts over.
  assert.equal(planMountAlert(null, new Date("2026-11-04T14:00:00.000Z"), problem)?.meta?.runs, 1);
});
