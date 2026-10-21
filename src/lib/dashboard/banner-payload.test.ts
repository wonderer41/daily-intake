import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseHermesBannerKind, parseSnapshotPayload } from "./banner-payload";

function field(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return (error.details as { field: string }).field;
  }
  assert.fail("expected a validation error");
}

const stockRow = { symbol: "NVDA", price: 181.2, currency: "USD", dayChangePct: 1.4, sixMonthChangePct: -3.25 };

test("stocks rows need finite numbers and unique symbols", () => {
  const parsed = parseSnapshotPayload("stocks", { asOf: "2026-10-14T20:00:00Z", rows: [stockRow] });
  assert.deepEqual(parsed, { asOf: "2026-10-14T20:00:00.000Z", rows: [stockRow] });
  assert.equal(field(() => parseSnapshotPayload("stocks", { asOf: "2026-10-14T20:00:00Z", rows: [{ ...stockRow, price: "181" }] })), "rows[0].price");
  assert.equal(field(() => parseSnapshotPayload("stocks", { asOf: "2026-10-14T20:00:00Z", rows: [stockRow, { ...stockRow, price: 1 }] })), "rows[1].symbol");
  assert.equal(field(() => parseSnapshotPayload("stocks", { asOf: "2026-10-14T20:00:00Z", rows: [] })), "rows");
  assert.equal(field(() => parseSnapshotPayload("stocks", { asOf: "2026-10-14T20:00:00Z", rows: [{ ...stockRow, currency: "usd" }] })), "rows[0].currency");
  assert.equal(field(() => parseSnapshotPayload("stocks", { asOf: "2026-10-14T20:00:00Z", rows: [{ ...stockRow, volume: 5 }] })), "rows[0].volume");
});

test("gmail payloads can never carry amounts", () => {
  const gmail = {
    since: "2026-10-14T06:00:00-06:00",
    needsReply: [{ from: "Ana", subject: "Saturday?" }],
    packages: [{ label: "Amazon", status: "out for delivery" }],
    payments: [{ merchant: "Hetzner", at: "2026-10-14T09:00:00Z" }],
    deletedCount: 12,
    archivedCount: 30,
  };
  const parsed = parseSnapshotPayload("gmail", gmail);
  assert.equal("threadUrl" in (parsed as typeof gmail).needsReply[0], false);
  const withAmount = { ...gmail, payments: [{ merchant: "Hetzner", at: "2026-10-14T09:00:00Z", amount: 4.5 }] };
  assert.equal(field(() => parseSnapshotPayload("gmail", withAmount)), "payments[0].amount");
  assert.equal(field(() => parseSnapshotPayload("gmail", { ...gmail, deletedCount: -1 })), "deletedCount");
  const withoutArchived: Record<string, unknown> = { ...gmail };
  delete withoutArchived.archivedCount;
  assert.equal(field(() => parseSnapshotPayload("gmail", withoutArchived)), "archivedCount");
});

test("gmail packages may carry their thread and latest mail time", () => {
  const base = { since: "2026-10-14T05:00:00-06:00", needsReply: [], payments: [], deletedCount: 0, archivedCount: 0 };
  const parcel = { label: "Keyboard (Amazon)", status: "shipped", threadUrl: "https://mail.google.com/mail/u/0/#all/18c2f0a1b2c3d4e5", updatedAt: "2026-10-13T16:20:00Z" };
  const parsed = parseSnapshotPayload("gmail", { ...base, packages: [parcel, { label: "Desk lamp", status: "delivered" }] }) as { packages: object[] };
  assert.deepEqual(parsed.packages, [{ ...parcel, updatedAt: "2026-10-13T16:20:00.000Z" }, { label: "Desk lamp", status: "delivered" }]);
  assert.equal(field(() => parseSnapshotPayload("gmail", { ...base, packages: [{ ...parcel, updatedAt: "yesterday" }] })), "packages[0].updatedAt");
  assert.equal(field(() => parseSnapshotPayload("gmail", { ...base, packages: [{ ...parcel, threadUrl: "mailto:x" }] })), "packages[0].threadUrl");
  assert.equal(field(() => parseSnapshotPayload("gmail", { ...base, packages: [{ ...parcel, tracking: "1Z" }] })), "packages[0].tracking");
});

test("orphans and scan payloads", () => {
  const orphan = { name: " .abc123.parts", checks: 2, firstSeenAt: "2026-10-14T13:00:00.000Z" };
  // Names are file names: kept exactly, leading space and dot included.
  assert.deepEqual(parseSnapshotPayload("orphans", { total: 3, items: [orphan] }), { total: 3, items: [orphan] });
  assert.equal(field(() => parseSnapshotPayload("orphans", { total: 1, items: [{ ...orphan, name: "" }] })), "items[0].name");
  assert.equal(field(() => parseSnapshotPayload("orphans", { total: 1, items: [{ ...orphan, name: "x".repeat(256) }] })), "items[0].name");
  assert.equal(field(() => parseSnapshotPayload("orphans", { total: 1, items: [{ ...orphan, checks: -1 }] })), "items[0].checks");
  assert.equal(field(() => parseSnapshotPayload("orphans", { total: 0, items: [orphan] })), "total");
  // The old Hermes shape reads as invalid, so a stored one is ignored.
  assert.equal(field(() => parseSnapshotPayload("orphans", { items: [], counts: { sonarr: 0, radarr: 0 } })), "counts");
  parseSnapshotPayload("scan", { ranAt: "2026-10-14T12:00:00Z", up: 30, total: 31, issues: [{ container: "jellyfin", summary: "restarting" }] });
  assert.equal(field(() => parseSnapshotPayload("scan", { ranAt: "2026-10-14T12:00:00Z", up: 32, total: 31, issues: [] })), "up");
  assert.equal(field(() => parseSnapshotPayload("scan", { ranAt: "2026-10-14T12:00:00Z", up: 1, total: 1, issues: [], capturedAt: "x" })), "capturedAt");
});

test("Hermes may push gmail, scan and stocks; unknown kinds and orphans are rejected", () => {
  assert.equal(parseHermesBannerKind("scan"), "scan");
  assert.equal(field(() => parseHermesBannerKind("weather")), "kind");
  assert.equal(field(() => parseHermesBannerKind("orphans")), "kind");
});
