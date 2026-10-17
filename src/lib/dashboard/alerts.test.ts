import assert from "node:assert/strict";
import test from "node:test";
import type { Alert } from "@/generated/prisma/client";
import type { AlertInput } from "@/lib/hermes/parse";
import { alertChanges } from "./alerts";

const NOW = new Date("2026-10-16T18:00:00.000Z");
const OPENED = new Date("2026-10-16T08:00:00.000Z");
const DISMISSED = new Date("2026-10-16T09:00:00.000Z");

function row(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    dedupeKey: "container:jellyfin",
    source: "scan",
    title: "jellyfin restarting",
    detail: "3 restarts since 06:00",
    url: null,
    severity: "warning",
    openedAt: OPENED,
    resolvedAt: null,
    dismissedAt: DISMISSED,
    meta: {},
    updatedAt: OPENED,
    ...overrides,
  };
}

function input(overrides: Partial<AlertInput> = {}): AlertInput {
  return { source: "scan", title: "jellyfin restarting", detail: "3 restarts since 06:00", url: undefined, severity: "warning", meta: undefined, ...overrides };
}

test("a dismissed alert stays hidden while Hermes keeps reporting the same problem", () => {
  assert.equal(alertChanges(row(), input(), NOW), null);
  assert.deepEqual(alertChanges(row(), input({ detail: "5 restarts since 06:00" }), NOW), { detail: "5 restarts since 06:00" });
});

test("a dismissed alert shows again when it turns critical", () => {
  assert.deepEqual(alertChanges(row(), input({ severity: "critical" }), NOW), { severity: "critical", dismissedAt: null });
  // Going back down does not bring it back; only getting worse does.
  assert.deepEqual(alertChanges(row({ severity: "critical" }), input({ severity: "warning" }), NOW), { severity: "warning" });
});

test("a resolved alert that comes back is a new occurrence: reopened and shown again", () => {
  assert.deepEqual(alertChanges(row({ resolvedAt: new Date("2026-10-16T12:00:00.000Z") }), input(), NOW), {
    resolvedAt: null,
    openedAt: NOW,
    dismissedAt: null,
  });
});

test("the link is kept when absent, set when sent, cleared with null", () => {
  assert.equal(alertChanges(row({ url: "https://pve.example/#vm100" }), input(), NOW), null);
  assert.deepEqual(alertChanges(row(), input({ url: "https://pve.example/#vm100" }), NOW), { url: "https://pve.example/#vm100" });
  assert.deepEqual(alertChanges(row({ url: "https://pve.example/#vm100" }), input({ url: null }), NOW), { url: null });
});
