import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import {
  parseCardQuery,
  parseCreateCard,
  parseCreateItem,
  parseCreateNote,
  parseCreateSprint,
  parseDailyMessageBody,
  parseReorder,
  parseUpdateCard,
  parseUpdateItem,
  parseUpdateNote,
  uuid,
} from "./user-parse";

const ID = "3f1c2b8e-9a4d-4c1e-8f2a-6b7c8d9e0f1a";

function field(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return (error.details as { field: string }).field;
  }
}

test("unknown fields are rejected by name", () => {
  assert.equal(field(() => parseCreateCard({ title: "x", colour: "red" })), "colour");
  assert.equal(field(() => parseUpdateItem({ version: 1, done: true, force: true })), "force");
  assert.equal(field(() => parseCreateSprint({ name: "s", startsOn: "2026-10-01", endsOn: "2026-10-14", key: "k" })), "key");
});

test("updates need the version the page last read", () => {
  assert.equal(field(() => parseUpdateCard({ title: "x" })), "version");
  assert.equal(field(() => parseUpdateItem({ version: 0, done: true })), "version");
  assert.deepEqual(parseUpdateItem({ version: 3, done: true }), { version: 3, done: true, title: undefined, isCurrent: undefined, position: undefined, dueOn: undefined });
});

test("ids must be UUIDs; they come back lowercased", () => {
  assert.equal(uuid(ID.toUpperCase(), "id"), ID);
  assert.equal(field(() => uuid("12", "id")), "id");
  assert.equal(field(() => parseCreateCard({ title: "x", sprintId: "nope" })), "sprintId");
  assert.equal(field(() => parseCardQuery(new URLSearchParams("sprintId=nope"))), "sprintId");
  assert.equal(field(() => parseCardQuery(new URLSearchParams("status=gone"))), "status");
});

test("string limits follow the VarChar sizes; null clears an optional field", () => {
  assert.equal(field(() => parseCreateCard({ title: "x".repeat(161) })), "title");
  assert.equal(field(() => parseCreateItem({ title: "x".repeat(201) })), "title");
  assert.equal(parseUpdateCard({ version: 1, milestoneTitle: null, sprintId: null }).milestoneTitle, null);
  assert.equal(parseUpdateCard({ version: 1, milestoneTitle: null, sprintId: null }).sprintId, null);
  assert.equal(parseUpdateCard({ version: 1 }).sprintId, undefined);
  assert.equal(field(() => parseCreateCard({ title: "x", repoFullName: "not a repo" })), "repoFullName");
});

test("sprints: dates are YYYY-MM-DD, end on or after start, created planned by default", () => {
  assert.equal(parseCreateSprint({ name: "Week 42", startsOn: "2026-10-12", endsOn: "2026-10-18" }).status, "planned");
  assert.equal(field(() => parseCreateSprint({ name: "s", startsOn: "2026-10-12", endsOn: "2026-10-11" })), "endsOn");
  assert.equal(field(() => parseCreateSprint({ name: "s", startsOn: "2026-02-30", endsOn: "2026-03-01" })), "startsOn");
  assert.equal(field(() => parseCreateSprint({ name: "s", startsOn: "2026-10-12", endsOn: "2026-10-18", status: "closed" })), "status");
});

test("reorder lists at least one id and never repeats one", () => {
  assert.deepEqual(parseReorder({ ids: [ID] }), { ids: [ID] });
  assert.equal(field(() => parseReorder({ ids: [] })), "ids");
  assert.equal(field(() => parseReorder({ ids: [ID, ID] })), "ids[1]");
  assert.equal(field(() => parseReorder({ ids: [ID, 7] })), "ids[1]");
});

test("daily message needs a date and non-empty text", () => {
  assert.deepEqual(parseDailyMessageBody({ date: "2026-10-14", text: "  Go slow.  " }), { date: "2026-10-14", text: "Go slow." });
  assert.equal(field(() => parseDailyMessageBody({ date: "10/14", text: "x" })), "date");
  assert.equal(field(() => parseDailyMessageBody({ date: "2026-10-14", text: " " })), "text");
});

test("notes: text up to 200 characters, an optional http(s) link; an edit keeps what it doesn't send", () => {
  assert.deepEqual(parseCreateNote({ text: " Call the ISP " }), { text: "Call the ISP", url: null });
  assert.deepEqual(parseCreateNote({ text: "Call the ISP", url: "https://isp.example" }), { text: "Call the ISP", url: "https://isp.example" });
  assert.equal(field(() => parseCreateNote({ text: "" })), "text");
  assert.equal(field(() => parseCreateNote({ text: "x".repeat(201) })), "text");
  assert.equal(field(() => parseCreateNote({ text: "x", url: "ftp://isp.example" })), "url");
  assert.equal(field(() => parseCreateNote({ text: "x", author: "hermes" })), "author");
  assert.deepEqual(parseUpdateNote({ url: null }), { text: undefined, url: null });
  assert.deepEqual(parseUpdateNote({ text: "Call the ISP today" }), { text: "Call the ISP today", url: undefined });
});
