import { seasonsLabel } from "@/lib/integrations/seerr/labels";
import { formatClock, localDateString } from "@/lib/time/zone";
import type {
  AlertDto,
  ChecklistItemDto,
  ItemProgressDto,
  NoteDto,
  NotesDto,
  SeerrDecisionResponse,
  SeerrRequestDto,
  TodayResponse,
  WorkCardDto,
} from "@/types/dashboard-contracts";
import { isApiRequestError } from "../../api";

export { requestTitle, seasonsLabel } from "@/lib/integrations/seerr/labels";

// Pure text and state helpers for the Warnings rail (no React), so they can be unit-tested.

/** Seerr card: the count is "?" while Seerr can't be asked. */
export function seerrSummary(count: number | null): string {
  if (count === 0) return "No requests waiting";
  if (count === null) return "? guest requests to approve";
  return `${count} ${count === 1 ? "guest request" : "guest requests"} to approve`;
}

/** "Movie · requested by maria", "TV · seasons 1–2 · requested by luis". */
export function requestMeta(request: Pick<SeerrRequestDto, "mediaType" | "seasons" | "requestedBy">): string {
  const seasons = request.mediaType === "tv" ? seasonsLabel(request.seasons) : null;
  return [request.mediaType === "movie" ? "Movie" : "TV", seasons, `requested by ${request.requestedBy}`].filter(Boolean).join(" · ");
}

// ---------- Seerr decisions ----------

export type SeerrLibrary = SeerrDecisionResponse["library"];

/** What happened to a row in this bubble. Handled rows stay listed (greyed) until the bubble closes. */
export type SeerrOutcome =
  | { kind: "approved"; library: SeerrLibrary }
  | { kind: "declined" }
  /** 409: approved or declined in Seerr itself (or by another tab) before this click landed. */
  | { kind: "elsewhere" }
  /** 404: the request no longer exists in Seerr. */
  | { kind: "gone" };

const LIBRARY_LABEL: Record<SeerrLibrary, string> = {
  temp: "Temp library",
  permanent: "Permanent library",
  anime: "Anime library",
};

export function outcomeText(outcome: SeerrOutcome): string {
  switch (outcome.kind) {
    case "approved":
      return `Approved → ${LIBRARY_LABEL[outcome.library]}`;
    case "declined":
      return "Declined";
    case "elsewhere":
      return "Already handled in Seerr";
    case "gone":
      return "No longer in Seerr";
  }
}

export const SEERR_RETRY_TEXT = "Seerr didn't answer — try again.";

/**
 * A failed approve/decline: either the row is settled anyway (409 → handled elsewhere, 404 → gone;
 * the list is reloaded) or it stays active with a one-line reason.
 */
export function decisionFailure(error: unknown): { settled: SeerrOutcome } | { retry: string } {
  if (isApiRequestError(error, "CONFLICT")) return { settled: { kind: "elsewhere" } };
  if (isApiRequestError(error, "NOT_FOUND")) return { settled: { kind: "gone" } };
  return { retry: requestErrorText(error) };
}

/** One line for a failed /api/seerr/* call. Server messages are written for the page and never carry the API key. */
export function requestErrorText(error: unknown): string {
  if (isApiRequestError(error, "SEERR_UNAVAILABLE")) return SEERR_RETRY_TEXT;
  if (isApiRequestError(error, "NETWORK_ERROR")) return "Can't reach the dashboard server — try again.";
  if (isApiRequestError(error)) return error.message;
  return "Something went wrong — try again.";
}

/**
 * Optimistic count while a decision is in flight: sets (never decrements) the Seerr count to at
 * most `target`, so re-applying it on every refresh, or after the server already counted the
 * change, never drops it twice. A null count (Seerr down) is left alone.
 */
export function withSeerrPendingAtMost(today: TodayResponse, target: number): TodayResponse {
  const current = today.warnings.notes.seerrPending;
  if (current === null || current <= target) return today;
  return withNotes(today, { ...today.warnings.notes, seerrPending: target });
}

// ---------- The bubble's list ----------

/** GET /api/seerr/requests lists at most this many (PENDING_TAKE in src/lib/integrations/seerr/pending.ts). */
export const SEERR_LIST_CAP = 20;

export interface SeerrListState {
  /** "loading" only until the first answer; reloads keep showing the current rows. */
  phase: "loading" | "ready";
  rows: SeerrRequestDto[];
  outcomes: Record<number, SeerrOutcome>;
  /** Why the last load failed; cleared by the next good one. */
  error: string | null;
}

export type SeerrListAction =
  | { type: "loaded"; requests: SeerrRequestDto[] }
  | { type: "failed"; message: string }
  | { type: "handled"; id: number; outcome: SeerrOutcome };

export const initialSeerrList: SeerrListState = { phase: "loading", rows: [], outcomes: {}, error: null };

/**
 * Fresh pending list merged with what is on screen: handled rows stay where they were (Seerr no
 * longer lists them), rows still pending keep their place with fresh data, rows gone from Seerr
 * without a click here drop out, and new requests go on top (Seerr lists newest first).
 */
export function mergeRequestRows(
  previous: readonly SeerrRequestDto[],
  fresh: readonly SeerrRequestDto[],
  outcomes: Readonly<Record<number, SeerrOutcome>>,
): SeerrRequestDto[] {
  const freshById = new Map(fresh.map((request) => [request.id, request]));
  const known = new Set(previous.map((request) => request.id));
  const added = fresh.filter((request) => !known.has(request.id));
  const kept = previous.flatMap((request) => {
    const update = freshById.get(request.id);
    if (update) return [update];
    return outcomes[request.id] ? [request] : [];
  });
  return [...added, ...kept];
}

export function seerrListReducer(state: SeerrListState, action: SeerrListAction): SeerrListState {
  switch (action.type) {
    case "loaded":
      return { ...state, phase: "ready", rows: mergeRequestRows(state.rows, action.requests, state.outcomes), error: null };
    case "failed":
      return { ...state, phase: "ready", error: action.message };
    case "handled":
      return { ...state, outcomes: { ...state.outcomes, [action.id]: action.outcome } };
  }
}

/**
 * "+ 5 more in Seerr" when the list hit its cap and Seerr has more than it shows. Below the cap a
 * count that differs from the list is just a refresh in flight, not hidden requests.
 */
export function moreInSeerr(count: number | null, pendingShown: number): number | null {
  if (count === null || pendingShown < SEERR_LIST_CAP || count <= pendingShown) return null;
  return count - pendingShown;
}

// ---------- Notes ----------

function withNotes(today: TodayResponse, notes: NotesDto): TodayResponse {
  return { ...today, warnings: { ...today.warnings, notes } };
}

/**
 * Seerr shows while it has requests, while it is down (count "?") and while its bubble is open, so
 * approving the last request doesn't yank the bubble away. `seerrOk` null means Seerr isn't set up
 * on the server, so it never shows.
 */
export function showSeerr(notes: NotesDto, seerrOk: boolean | null, seerrOpen: boolean): boolean {
  return seerrOk !== null && (seerrOpen || !seerrOk || notes.seerrPending === null || notes.seerrPending > 0);
}

/** Optimistic delete. */
export function withoutNote(today: TodayResponse, id: string): TodayResponse {
  const { notes } = today.warnings;
  return withNotes(today, { ...notes, items: notes.items.filter((note) => note.id !== id) });
}

/** Optimistic edit of one of Gerardo's notes. */
export function withNoteEdit(today: TodayResponse, id: string, change: Pick<NoteDto, "text" | "url">): TodayResponse {
  const { notes } = today.warnings;
  return withNotes(today, { ...notes, items: notes.items.map((note) => (note.id === id ? { ...note, ...change } : note)) });
}

/** "" or whitespace = no link. Anything else must be http(s), like the server checks. */
export function noteLinkError(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? null : "The link must start with http:// or https://";
  } catch {
    return "That doesn't look like a link (https://…)";
  }
}

// ---------- Important ----------

export type ImportantEntry =
  | { kind: "alert"; alert: AlertDto; at: string }
  | { kind: "push"; card: WorkCardDto; item: ChecklistItemDto; update: ItemProgressDto; at: string };

export interface ImportantGroup {
  key: string;
  /** Shown as the group's eyebrow: "Critical", the alert's source, or "GitHub" for push updates. */
  label: string;
  entries: ImportantEntry[];
}

/** Push updates' group label. */
export const PUSH_GROUP_LABEL = "GitHub";

function newestFirst(a: { at: string }, b: { at: string }): number {
  return Date.parse(b.at) - Date.parse(a.at);
}

/**
 * Important's order: critical alerts first, then one group per alert source plus one for the push
 * updates still waiting on a card's items (GitHub alerts join that one). Groups are ordered by their newest entry, and entries
 * inside a group newest first.
 */
export function importantGroups(alerts: readonly AlertDto[], cards: readonly WorkCardDto[]): ImportantGroup[] {
  const critical: ImportantEntry[] = [];
  const groups = new Map<string, ImportantGroup>();
  const add = (key: string, label: string, entry: ImportantEntry) => {
    const group = groups.get(key) ?? { key, label, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  };

  for (const alert of alerts) {
    if (alert.resolvedAt !== null || alert.dismissedAt !== null) continue;
    const entry: ImportantEntry = { kind: "alert", alert, at: alert.openedAt };
    if (alert.severity === "critical") critical.push(entry);
    // GitHub alerts (e.g. a push review that failed) share the push updates' group.
    else if (alert.source.toLowerCase() === "github") add("push", PUSH_GROUP_LABEL, entry);
    else add(`source:${alert.source}`, alert.source, entry);
  }
  for (const card of cards) {
    for (const item of card.items) {
      if (item.done) continue;
      for (const update of item.progress) {
        if (update.status === "pending") add("push", PUSH_GROUP_LABEL, { kind: "push", card, item, update, at: update.pushedAt });
      }
    }
  }

  const sorted = [...groups.values()].map((group) => ({ ...group, entries: [...group.entries].sort(newestFirst) }));
  sorted.sort((a, b) => newestFirst(a.entries[0], b.entries[0]));
  return critical.length > 0 ? [{ key: "critical", label: "Critical", entries: critical.sort(newestFirst) }, ...sorted] : sorted;
}

/** Optimistic dismiss. */
export function withoutAlert(today: TodayResponse, id: string): TodayResponse {
  return { ...today, warnings: { ...today.warnings, alerts: today.warnings.alerts.filter((alert) => alert.id !== id) } };
}

/** Booked block tag: "19:00–20:30" today, "Oct 15 · 19:00–20:30" on another day. */
export function blockTag(scheduled: NonNullable<AlertDto["scheduled"]>, timeZone: string, now: Date): string {
  const start = new Date(scheduled.startsAt);
  const range = `${formatClock(start, timeZone)}–${formatClock(new Date(scheduled.endsAt), timeZone)}`;
  if (localDateString(start, timeZone) === localDateString(now, timeZone)) return range;
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(start);
  return `${day} · ${range}`;
}
