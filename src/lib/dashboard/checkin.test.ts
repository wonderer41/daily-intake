import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseUpsertCheckin } from "@/lib/hermes/parse";
import { weekOf } from "./checkin";

test("a check-in belongs to the Monday of its week (Monday–Sunday)", () => {
  // 2026-10-19 is a Monday.
  for (const day of ["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-25"]) assert.equal(weekOf(day), "2026-10-19", day);
  assert.equal(weekOf("2026-10-26"), "2026-10-26");
  assert.equal(weekOf("2027-01-01"), "2026-12-28", "across a year end");
});

function rejects(body: unknown, field: string): void {
  assert.throws(
    () => parseUpsertCheckin(body),
    (error: unknown) => error instanceof HttpError && error.code === "VALIDATION_ERROR" && (error.details as { field: string }).field === field,
  );
}

test("Hermes sends a summary and up to 10 focus lines with unique keys", () => {
  const parsed = parseUpsertCheckin({
    summary: "Ahead on study-sessions; orphan-cleanup hasn't moved.",
    items: [
      { key: "streak-tracking", text: "#13 Streak tracking", itemRef: "github:issue:example-user/study-sessions#13" },
      { key: "call-isp", text: "Call the ISP" },
    ],
  });
  assert.equal(parsed.items[0].itemRef?.kind, "key");
  assert.equal(parsed.items[1].itemRef, null);

  rejects({ items: [] }, "summary");
  rejects({ summary: "x", items: [{ key: "Bad Key", text: "x" }] }, "items[0].key");
  rejects({ summary: "x", items: [{ key: "a", text: "x" }, { key: "a", text: "y" }] }, "items[1].key");
  rejects({ summary: "x", items: Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, text: "x" })) }, "items");
  rejects({ summary: "x", items: [{ key: "a", text: "x", itemRef: "nope" }] }, "items[0].itemRef");
});
