import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseUpsertCard, parseUpsertItem } from "@/lib/hermes/parse";
import { dueOnChanged, dueOnDto, toDueOn } from "./due";
import { parseUpdateCard, parseUpdateItem } from "./user-parse";

test("a due date is stored as the bare day and read back the same", () => {
  const stored = toDueOn("2026-10-31");
  assert.equal(stored?.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(dueOnDto(stored), "2026-10-31");
  assert.equal(toDueOn(null), null);
});

test("only a different day counts as a change; undefined leaves it alone", () => {
  const stored = toDueOn("2026-10-31");
  assert.equal(dueOnChanged(stored, undefined), false);
  assert.equal(dueOnChanged(stored, "2026-10-31"), false);
  assert.equal(dueOnChanged(stored, "2026-11-01"), true);
  assert.equal(dueOnChanged(stored, null), true);
  assert.equal(dueOnChanged(null, null), false);
});

test("Hermes and the page can set or clear dueOn on cards and items", () => {
  assert.equal(parseUpsertCard({ title: "Orphan cleanup", dueOn: "2026-10-31" }).dueOn, "2026-10-31");
  assert.equal(parseUpsertItem({ title: "Review BDMVs", dueOn: null }).dueOn, null);
  assert.equal(parseUpsertItem({ title: "Review BDMVs" }).dueOn, undefined);
  assert.equal(parseUpdateCard({ version: 3, dueOn: "2026-10-31" }).dueOn, "2026-10-31");
  assert.equal(parseUpdateItem({ version: 2, dueOn: null }).dueOn, null);
  for (const bad of ["31/10/2026", "2026-02-30", 20261031]) {
    assert.throws(() => parseUpdateItem({ version: 2, dueOn: bad }), (error: unknown) => error instanceof HttpError && error.code === "VALIDATION_ERROR");
  }
});
