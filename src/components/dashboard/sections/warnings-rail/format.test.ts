import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlertDto, ChecklistItemDto, ItemProgressDto, NotesDto, NoteDto, SeerrRequestDto, TodayResponse, WorkCardDto } from "@/types/dashboard-contracts";
import { ApiRequestError } from "../../api";
import {
  blockTag,
  decisionFailure,
  importantGroups,
  initialSeerrList,
  mergeRequestRows,
  moreInSeerr,
  noteLinkError,
  outcomeText,
  requestErrorText,
  requestMeta,
  requestTitle,
  SEERR_RETRY_TEXT,
  seasonsLabel,
  seerrListReducer,
  seerrSummary,
  showSeerr,
  withNoteEdit,
  withoutAlert,
  withoutNote,
  withSeerrPendingAtMost,
} from "./format";

const zone = "America/Denver";

function request(id: number, overrides: Partial<SeerrRequestDto> = {}): SeerrRequestDto {
  return {
    id,
    title: `Title ${id}`,
    year: 2001,
    mediaType: "movie",
    seasons: null,
    requestedBy: "maria",
    createdAt: "2026-10-13T02:14:05.000Z",
    ...overrides,
  };
}

function notes(overrides: Partial<NotesDto> = {}): NotesDto {
  return { seerrPending: 0, seerrUrl: null, items: [], ...overrides };
}

function note(id: string, overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    author: "user",
    key: null,
    text: `Note ${id}`,
    detail: null,
    url: null,
    count: null,
    createdAt: "2026-10-16T15:00:00.000Z",
    updatedAt: "2026-10-16T15:00:00.000Z",
    ...overrides,
  };
}

function withWarnings(warnings: Partial<TodayResponse["warnings"]>): TodayResponse {
  return { warnings: { alerts: [], notes: notes(), ...warnings } } as unknown as TodayResponse;
}

test("counts read naturally", () => {
  assert.equal(seerrSummary(1), "1 guest request to approve");
  assert.equal(seerrSummary(2), "2 guest requests to approve");
  assert.equal(seerrSummary(0), "No requests waiting");
  assert.equal(seerrSummary(null), "? guest requests to approve");
});

test("seasons collapse into ranges; season 0 is specials", () => {
  assert.equal(seasonsLabel(null), null);
  assert.equal(seasonsLabel([]), null);
  assert.equal(seasonsLabel([1]), "season 1");
  assert.equal(seasonsLabel([3, 1, 2]), "seasons 1–3");
  assert.equal(seasonsLabel([1, 2, 5, 7, 8]), "seasons 1–2, 5, 7–8");
  assert.equal(seasonsLabel([0]), "specials");
  assert.equal(seasonsLabel([0, 1, 2]), "specials + seasons 1–2");
});

test("request rows: title (year), type, seasons, requester", () => {
  assert.equal(requestTitle(request(1, { title: "The Matrix", year: 1999 })), "The Matrix (1999)");
  assert.equal(requestTitle(request(1, { title: "TMDB #603", year: null })), "TMDB #603");
  assert.equal(requestMeta(request(1)), "Movie · requested by maria");
  assert.equal(requestMeta(request(2, { mediaType: "tv", seasons: [1, 2], requestedBy: "luis" })), "TV · seasons 1–2 · requested by luis");
  assert.equal(requestMeta(request(3, { mediaType: "tv", seasons: [] })), "TV · requested by maria");
});

test("outcomes name the library the request really went to", () => {
  assert.equal(outcomeText({ kind: "approved", library: "temp" }), "Approved → Temp library");
  assert.equal(outcomeText({ kind: "approved", library: "permanent" }), "Approved → Permanent library");
  assert.equal(outcomeText({ kind: "approved", library: "anime" }), "Approved → Anime library");
  assert.equal(outcomeText({ kind: "declined" }), "Declined");
  assert.equal(outcomeText({ kind: "elsewhere" }), "Already handled in Seerr");
});

test("decision failures: 409/404 settle the row, everything else keeps it active", () => {
  assert.deepEqual(decisionFailure(new ApiRequestError(409, "CONFLICT", "Seerr request 42 is no longer pending")), {
    settled: { kind: "elsewhere" },
  });
  assert.deepEqual(decisionFailure(new ApiRequestError(404, "NOT_FOUND", "Seerr request 42 was not found")), { settled: { kind: "gone" } });
  assert.deepEqual(decisionFailure(new ApiRequestError(502, "SEERR_UNAVAILABLE", "Seerr failed with status 503")), {
    retry: SEERR_RETRY_TEXT,
  });
  assert.deepEqual(decisionFailure(new ApiRequestError(502, "UPSTREAM_ERROR", "Seerr sent no keywords")), { retry: "Seerr sent no keywords" });
  assert.equal(requestErrorText(new ApiRequestError(0, "NETWORK_ERROR", "x")), "Can't reach the dashboard server — try again.");
  assert.equal(requestErrorText(new Error("boom")), "Something went wrong — try again.");
});

test("optimistic count only ever lowers to the target, so re-applying it is harmless", () => {
  const today = withWarnings({ notes: notes({ seerrPending: 3 }) });
  const once = withSeerrPendingAtMost(today, 2);
  assert.equal(once.warnings.notes.seerrPending, 2);
  assert.equal(withSeerrPendingAtMost(once, 2), once);
  // The server already counted the approval (live refresh landed first): no double drop.
  const refreshed = withWarnings({ notes: notes({ seerrPending: 2 }) });
  assert.equal(withSeerrPendingAtMost(refreshed, 2).warnings.notes.seerrPending, 2);
  // Seerr down: leave the "?" alone.
  const down = withWarnings({ notes: notes({ seerrPending: null }) });
  assert.equal(withSeerrPendingAtMost(down, 0).warnings.notes.seerrPending, null);
});

test("reloading keeps handled rows in place, refreshes pending ones, puts new ones on top", () => {
  const a = request(1);
  const b = request(2);
  const c = request(3);
  const outcomes = { 2: { kind: "approved", library: "temp" } } as const;
  const merged = mergeRequestRows([a, b, c], [request(4), { ...a, title: "Renamed" }], outcomes);
  assert.deepEqual(
    merged.map((r) => [r.id, r.title]),
    [
      [4, "Title 4"],
      [1, "Renamed"],
      [2, "Title 2"],
    ],
  );
  assert.deepEqual(mergeRequestRows([], [a, b], {}), [a, b]);
});

test("list reducer: first load, failed reload keeps rows, handled rows survive the next load", () => {
  let state = seerrListReducer(initialSeerrList, { type: "loaded", requests: [request(1), request(2)] });
  assert.equal(state.phase, "ready");
  state = seerrListReducer(state, { type: "failed", message: SEERR_RETRY_TEXT });
  assert.equal(state.rows.length, 2);
  assert.equal(state.error, SEERR_RETRY_TEXT);
  state = seerrListReducer(state, { type: "handled", id: 1, outcome: { kind: "declined" } });
  state = seerrListReducer(state, { type: "loaded", requests: [request(2)] });
  assert.deepEqual(
    state.rows.map((r) => r.id),
    [1, 2],
  );
  assert.equal(state.error, null);
  assert.deepEqual(state.outcomes[1], { kind: "declined" });
});

test("'more in Seerr' only when the list hit its cap", () => {
  assert.equal(moreInSeerr(25, 20), 5);
  assert.equal(moreInSeerr(2, 2), null);
  assert.equal(moreInSeerr(3, 2), null); // a count that is briefly ahead of the list
  assert.equal(moreInSeerr(null, 20), null);
});

test("Seerr shows while it has requests, is down, or its bubble is open", () => {
  assert.equal(showSeerr(notes(), true, false), false);
  assert.equal(showSeerr(notes({ seerrPending: 2 }), true, false), true);
  assert.equal(showSeerr(notes({ seerrPending: null }), false, false), true);
  assert.equal(showSeerr(notes({ seerrPending: 0 }), true, true), true);
});

test("Seerr never shows when it isn't set up on the server", () => {
  assert.equal(showSeerr(notes({ seerrPending: null }), null, false), false);
  assert.equal(showSeerr(notes({ seerrPending: null }), null, true), false);
});

test("note edits and deletes are pure and repeatable", () => {
  const today = withWarnings({ notes: notes({ items: [note("a"), note("b")] }) });
  const edited = withNoteEdit(today, "a", { text: "Call the ISP", url: "https://isp.example" });
  assert.deepEqual(
    edited.warnings.notes.items.map((item) => [item.id, item.text, item.url]),
    [
      ["a", "Call the ISP", "https://isp.example"],
      ["b", "Note b", null],
    ],
  );
  assert.deepEqual(withNoteEdit(edited, "a", { text: "Call the ISP", url: "https://isp.example" }), edited);
  const removed = withoutNote(edited, "a");
  assert.deepEqual(removed.warnings.notes.items.map((item) => item.id), ["b"]);
  assert.deepEqual(withoutNote(removed, "a"), removed);
});

test("a note's link is optional but must be http(s)", () => {
  assert.equal(noteLinkError(""), null);
  assert.equal(noteLinkError("   "), null);
  assert.equal(noteLinkError("https://example.com/x"), null);
  assert.equal(noteLinkError("javascript:alert(1)"), "The link must start with http:// or https://");
  assert.equal(noteLinkError("not a link"), "That doesn't look like a link (https://…)");
});

// ---------- Important ----------

function alert(id: string, overrides: Partial<AlertDto> = {}): AlertDto {
  return {
    id,
    dedupeKey: `proxmox:${id}`,
    source: "proxmox",
    title: `Alert ${id}`,
    detail: null,
    url: null,
    severity: "warning",
    openedAt: "2026-10-16T10:00:00.000Z",
    resolvedAt: null,
    dismissedAt: null,
    scheduled: null,
    ...overrides,
  };
}

function pushUpdate(id: string, pushedAt: string, overrides: Partial<ItemProgressDto> = {}): ItemProgressDto {
  return {
    id,
    kind: "looks_done",
    status: "pending",
    note: "Added the streak model",
    repoFullName: "example-user/study-sessions",
    commitSha: "abc1234def5678abc1234def5678abc1234def56",
    commitUrl: "https://github.com/example-user/study-sessions/commit/abc1234",
    pushedAt,
    ...overrides,
  };
}

function card(id: string, items: Partial<ChecklistItemDto>[]): WorkCardDto {
  return {
    id,
    title: `Card ${id}`,
    repoFullName: "example-user/study-sessions",
    items: items.map((item, index) => ({ id: `${id}-item-${index}`, title: `Item ${index}`, issueNumber: null, done: false, progress: [], ...item })),
  } as unknown as WorkCardDto;
}

function shape(groups: ReturnType<typeof importantGroups>): [string, string[]][] {
  return groups.map((group) => [group.label, group.entries.map((entry) => (entry.kind === "alert" ? entry.alert.id : entry.update.id))]);
}

test("Important: critical first, then groups by source ordered by their newest entry, newest first inside", () => {
  const alerts = [
    alert("old-proxmox", { openedAt: "2026-10-14T08:00:00.000Z" }),
    alert("seerr-dune", { source: "seerr", openedAt: "2026-10-16T09:00:00.000Z" }),
    alert("new-proxmox", { openedAt: "2026-10-15T08:00:00.000Z" }),
    alert("disk", { severity: "critical", openedAt: "2026-10-13T08:00:00.000Z" }),
    alert("ups", { severity: "critical", source: "seerr", openedAt: "2026-10-15T12:00:00.000Z" }),
  ];
  const cards = [card("c", [{ progress: [pushUpdate("p1", "2026-10-15T20:00:00.000Z")] }, { progress: [pushUpdate("p2", "2026-10-16T11:00:00.000Z")] }])];
  assert.deepEqual(shape(importantGroups(alerts, cards)), [
    ["Critical", ["ups", "disk"]],
    ["GitHub", ["p2", "p1"]],
    ["seerr", ["seerr-dune"]],
    ["proxmox", ["new-proxmox", "old-proxmox"]],
  ]);
});

test("Important: a GitHub alert (failed push review) joins the push updates' group", () => {
  const alerts = [alert("review-failed", { source: "github", openedAt: "2026-10-16T12:00:00.000Z" }), alert("proxmox", { openedAt: "2026-10-16T13:00:00.000Z" })];
  const cards = [card("c", [{ progress: [pushUpdate("p1", "2026-10-16T11:00:00.000Z")] }])];
  assert.deepEqual(shape(importantGroups(alerts, cards)), [
    ["proxmox", ["proxmox"]],
    ["GitHub", ["review-failed", "p1"]],
  ]);
});

test("Important leaves out dismissed or resolved alerts, done items and settled push updates", () => {
  const alerts = [
    alert("dismissed", { dismissedAt: "2026-10-16T10:30:00.000Z" }),
    alert("resolved", { resolvedAt: "2026-10-16T10:30:00.000Z" }),
  ];
  const cards = [
    card("c", [
      { done: true, progress: [pushUpdate("on-done-item", "2026-10-16T11:00:00.000Z")] },
      { progress: [pushUpdate("dismissed-update", "2026-10-16T11:00:00.000Z", { status: "dismissed" })] },
    ]),
  ];
  assert.deepEqual(importantGroups(alerts, cards), []);
});

test("dismissing an alert drops it from the page, and again changes nothing", () => {
  const today = withWarnings({ alerts: [alert("a"), alert("b")] });
  const once = withoutAlert(today, "a");
  assert.deepEqual(once.warnings.alerts.map((entry) => entry.id), ["b"]);
  assert.deepEqual(withoutAlert(once, "a"), once);
});

test("booked block tag: clock range today, with the day otherwise", () => {
  const now = new Date("2026-10-14T18:00:00Z"); // 12:00 MDT
  const today = { calendarEventId: "e", startsAt: "2026-10-15T01:00:00Z", endsAt: "2026-10-15T02:30:00Z" }; // 19:00–20:30 MDT
  assert.equal(blockTag(today, zone, now), "19:00–20:30");
  const tomorrow = { calendarEventId: "e", startsAt: "2026-10-15T15:00:00Z", endsAt: "2026-10-15T16:00:00Z" };
  assert.equal(blockTag(tomorrow, zone, now), "Oct 15 · 09:00–10:00");
});
