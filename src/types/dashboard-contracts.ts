// Daily Intake — shared API contracts.
// Additive to src/types/contracts.ts. Import these types; do not redefine response shapes.
// All timestamps are ISO 8601 strings in UTC. All "date" fields are local dates (YYYY-MM-DD)
// in DASHBOARD_TIME_ZONE (default America/Denver).

export type Actor = "user" | "hermes" | "github" | "system";
export type SprintStatus = "planned" | "active" | "closed";
export type CardStatus = "active" | "paused" | "done" | "archived";
export type CalendarEventKind = "calendar" | "work_block";
export type ScheduleStatus = "checking" | "conflict" | "booked" | "failed" | "cancelled";
export type BannerKind = "gmail" | "orphans" | "scan" | "stocks";
export type AlertSeverity = "warning" | "critical";
export type GapTone = "short" | "medium" | "long" | "overlap"; // <30m, 30–60m, >60m, negative
export type ProgressKind = "looks_done" | "partial";
export type ProgressStatus = "pending" | "confirmed" | "dismissed";

// ---------- Sprints, cards, checklist ----------

export interface SprintDto {
  id: string;
  externalKey: string | null;
  name: string;
  goal: string | null;
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD
  status: SprintStatus;
  /** Local calendar days from today to endsOn (0 on the last day); null unless active. */
  daysLeft: number | null;
  version: number;
}

/** What one push did to one checklist item, as judged by Hermes (D7). */
export interface ItemProgressDto {
  id: string;
  /** looks_done: "looks done from push X — confirm?" (never checks the item by itself); partial: progress note. */
  kind: ProgressKind;
  status: ProgressStatus;
  note: string;
  repoFullName: string;
  commitSha: string;
  /** https://github.com/{repoFullName}/commit/{commitSha} */
  commitUrl: string;
  pushedAt: string;
}

export type ItemDoneBy = "user" | "hermes" | "push";

export interface ChecklistItemDto {
  id: string;
  cardId: string;
  externalKey: string | null;
  title: string;
  issueNumber: number | null;
  sourceUrl: string | null;
  /** Deadline, YYYY-MM-DD local; null = the card's dueOn applies. Overdue once that day is over. */
  dueOn: string | null;
  done: boolean;
  doneAt: string | null;
  /**
   * Who checked it: "user" on the page, "hermes" through its API, "push" when Gerardo confirmed a
   * Hermes push update (see donePush). Null while open, and on items checked before this was recorded.
   */
  doneBy: ItemDoneBy | null;
  /** The confirmed push, when doneBy is "push". */
  donePush: { repoFullName: string; commitSha: string; commitUrl: string } | null;
  isCurrent: boolean;
  position: number;
  createdBy: Actor;
  version: number;
  /** Next upcoming work block for this item, if booked. */
  scheduled: { calendarEventId: string; startsAt: string; endsAt: string } | null;
  /**
   * Pending push notes, newest push first; empty once the item is done. Confirm or dismiss with
   * POST /api/items/:id/progress/:progressId/{confirm|dismiss}.
   */
  progress: ItemProgressDto[];
}

export interface WorkCardDto {
  id: string;
  externalKey: string | null;
  title: string;
  repoFullName: string | null;
  milestoneTitle: string | null;
  /** Deadline, YYYY-MM-DD local. Items without their own dueOn fall under it. */
  dueOn: string | null;
  sprintId: string | null;
  status: CardStatus;
  position: number;
  createdBy: Actor;
  /** Pre-formatted meta line, e.g. "last commit 10:31 · 6 this week". */
  metaLine: string | null;
  progress: { done: number; total: number };
  /** isCurrent item, or the first unchecked one; null when all done. */
  current: { itemId: string; label: "now" | "next" } | null;
  /** Hermes suggestion shown on the collapsed card (e.g. "Block 90 min tonight for #12?"). */
  hermesSuggestion: string | null;
  items: ChecklistItemDto[];
  version: number;
  updatedAt: string;
}

export interface CreateCardRequest {
  title: string;
  repoFullName?: string | null;
  milestoneTitle?: string | null;
  sprintId?: string | null;
  position?: number;
}

export interface UpdateCardRequest {
  version: number;
  title?: string;
  status?: CardStatus;
  sprintId?: string | null;
  position?: number;
  milestoneTitle?: string | null;
  /** YYYY-MM-DD, or null to clear. */
  dueOn?: string | null;
}

export interface CreateItemRequest {
  title: string;
  issueNumber?: number | null;
  sourceUrl?: string | null;
  position?: number;
}

export interface UpdateItemRequest {
  version: number;
  done?: boolean;
  title?: string;
  isCurrent?: boolean;
  position?: number;
  /** YYYY-MM-DD, or null to clear. */
  dueOn?: string | null;
}

export interface ReorderRequest {
  /** Full ordered list of ids; the server rewrites positions. */
  ids: string[];
}

// ---------- Timeline ----------

export interface TimelineEventDto {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  kind: CalendarEventKind;
  state: "past" | "current" | "future";
  checklistItemId: string | null;
  alertId: string | null;
  htmlLink: string | null;
}

export interface TimelineGapDto {
  afterEventId: string; // gap between this event (or "now") and the next one
  minutes: number; // negative = overlap
  tone: GapTone;
}

export interface TimelineResponse {
  date: string; // YYYY-MM-DD
  timeZone: string;
  now: string; // server time, for the "now" marker
  allDay: TimelineEventDto[];
  events: TimelineEventDto[]; // timed, sorted by startsAt
  gaps: TimelineGapDto[];
  lastSyncAt: string | null;
  syncError: string | null;
}

// ---------- Scheduling with Hermes ----------

export interface ScheduleRequestBody {
  /** Exactly one of checklistItemId / alertId. */
  checklistItemId?: string;
  alertId?: string;
  /** Local wall-clock start on the timeline's date, "HH:MM". */
  start: string;
  date: string; // YYYY-MM-DD
  durationMin: number; // 1–720
}

export interface ScheduleMessage {
  who: "hermes" | "me";
  text: string;
  at: string;
}

export interface ScheduleRequestDto {
  id: string;
  status: ScheduleStatus;
  checklistItemId: string | null;
  alertId: string | null;
  requestedStart: string;
  durationMin: number;
  conflict: { eventId: string; title: string; startsAt: string; endsAt: string } | null;
  suggestedStart: string | null;
  booked: { calendarEventId: string; startsAt: string; endsAt: string } | null;
  transcript: ScheduleMessage[];
  error: string | null;
}

// ---------- Banner snapshots (payloads pushed by Hermes / n8n) ----------

export interface GmailSnapshot {
  since: string; // ISO
  needsReply: { from: string; subject: string; threadUrl?: string | null }[];
  /** label = store or item. `updatedAt` (its latest mail) is Hermes's bookkeeping; the page doesn't show it. */
  packages: { label: string; status: string; threadUrl?: string | null; updatedAt?: string }[];
  payments: { merchant: string; at: string }[]; // no amounts, by design
  /** Mail that arrived since `since` and is now in the trash / out of the inbox (not trashed). */
  deletedCount: number;
  archivedCount: number;
}

/** Written by the worker's orphans check (src/lib/integrations/orphans), never by Hermes. */
export interface OrphansSnapshot {
  /** Every top-level file or folder in orphaned_data at this check. */
  total: number;
  /** Longest-waiting first, at most MAX_ORPHANS of them. */
  items: {
    /** Raw file or folder name, exactly as listed. */
    name: string;
    /** Wednesday checks that listed it; 0 when only a manual refresh has seen it so far. */
    checks: number;
    firstSeenAt: string;
  }[];
}

export interface ScanSnapshot {
  ranAt: string;
  up: number;
  total: number;
  issues: { container: string; summary: string }[];
}

export interface StocksSnapshot {
  asOf: string;
  rows: {
    symbol: string;
    price: number;
    currency: string;
    dayChangePct: number;
    /** Null until Tiingo has history for the symbol (new listing, uncovered ticker). */
    sixMonthChangePct: number | null;
  }[];
}

export type BannerPayload =
  | { kind: "gmail"; payload: GmailSnapshot }
  | { kind: "orphans"; payload: OrphansSnapshot }
  | { kind: "scan"; payload: ScanSnapshot }
  | { kind: "stocks"; payload: StocksSnapshot };

export interface BannerDto {
  dailyMessage: { date: string; text: string; author: Actor } | null;
  gmail: { capturedAt: string; data: GmailSnapshot } | null;
  orphans: { capturedAt: string; data: OrphansSnapshot } | null;
  /** Sonarr ↗ / Radarr ↗ on the orphans panel (SONARR_URL / RADARR_URL, http(s) only); null when not set. */
  orphanLinks: { sonarrUrl: string | null; radarrUrl: string | null };
  scan: { capturedAt: string; data: ScanSnapshot } | null;
  stocks: { capturedAt: string; data: StocksSnapshot } | null;
  /** This week's check-in (Hermes writes it mid-week); null when there is none. Shown first. */
  checkin: CheckinDto | null;
}

// ---------- Weekly check-in ----------

export interface CheckinItemDto {
  id: string;
  key: string;
  text: string;
  done: boolean;
  /**
   * Set when the line is one of the cards' checklist items. It shares that item's done state, so the
   * page checks it with PATCH /api/items/:id (with this version), not PATCH /api/checkin/items/:id.
   */
  checklistItem: { id: string; cardId: string; version: number } | null;
}

export interface CheckinDto {
  /** Monday of the local week. */
  weekOf: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  /** Items done / total across the active sprint's cards; null without an active sprint. */
  sprintProgress: { done: number; total: number } | null;
  items: CheckinItemDto[];
}

/** PUT /api/hermes/checkin/:date — replaces the focus list; lines keep their checks by key. */
export interface HermesCheckinBody {
  summary: string;
  items: { key: string; text: string; itemRef?: string | null }[];
}

/** PATCH /api/checkin/items/:id — lines that are not a checklist item. */
export interface UpdateCheckinItemRequest {
  done: boolean;
}

// ---------- Warnings ----------

export interface AlertDto {
  id: string;
  dedupeKey: string;
  /** Important groups its entries by source. */
  source: string;
  title: string;
  detail: string | null;
  /** Where to act on it (http or https); null when Hermes sent none. */
  url: string | null;
  severity: AlertSeverity;
  openedAt: string;
  /** Null while open; Important only lists open alerts. */
  resolvedAt: string | null;
  /** Set once Gerardo dismissed it; Important hides it until it reopens or turns critical. */
  dismissedAt: string | null;
  scheduled: { calendarEventId: string; startsAt: string; endsAt: string } | null;
}

export interface SeerrRequestDto {
  id: number;
  title: string;
  year: number | null;
  mediaType: "movie" | "tv";
  seasons: number[] | null;
  requestedBy: string;
  createdAt: string;
}

export interface SeerrDecisionRequest {
  library: "temp" | "permanent";
}

/** Response of POST /api/seerr/requests/:id/approve. */
export interface SeerrDecisionResponse {
  ok: true;
  /** The library the request actually landed in: anime always reports "anime", whatever the switch said. */
  library: "temp" | "permanent" | "anime";
}

export interface NotesDto {
  /** Live count from Seerr; null when Seerr is unavailable or not set up (see TodayResponse.sources.seerr). */
  seerrPending: number | null;
  /** Browser link for "Open Seerr ↗" (SEERR_PUBLIC_URL, http(s) only); null when not set. */
  seerrUrl: string | null;
  /** Newest first. Hermes notes with count 0 are left out. */
  items: NoteDto[];
}

/** A line in Notes: Gerardo's own (author "user", no key) or Hermes's (keyed, e.g. "PRs to review · 3"). */
export interface NoteDto {
  id: string;
  author: "user" | "hermes";
  /** Hermes notes only, "<source>:<thing>"; null on Gerardo's. */
  key: string | null;
  text: string;
  detail: string | null;
  url: string | null;
  /** Shown on the right; null shows none. */
  count: number | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/notes — a note of Gerardo's. */
export interface CreateNoteRequest {
  text: string;
  url?: string | null;
}

/** PATCH /api/notes/:id — only Gerardo's own notes. Absent = keep, null = clear the link. */
export interface UpdateNoteRequest {
  text?: string;
  url?: string | null;
}

// ---------- Whole page ----------

/** Health of one integration, so its section can degrade on its own ("Calendar unavailable — last synced 10:42"). */
export interface SourceStateDto {
  ok: boolean;
  /** Last successful sync (calendar) or live check (Seerr); null if none is known. */
  lastSyncAt: string | null;
  /** Plain one-line reason when ok is false; null when ok. */
  error: string | null;
}

export interface TodayResponse {
  date: string;
  timeZone: string;
  generatedAt: string;
  banner: BannerDto;
  timeline: TimelineResponse;
  workingOn: { activeSprint: SprintDto | null; cards: WorkCardDto[] };
  /** Important (open alerts not dismissed, oldest first; push updates come from workingOn) and Notes. */
  warnings: { alerts: AlertDto[]; notes: NotesDto };
  /** `seerr` is null when Seerr isn't set up on the server (it is optional). */
  sources: { calendar: SourceStateDto; seerr: SourceStateDto | null };
}

// ---------- Live stream (/api/stream, Server-Sent Events) ----------

export type LiveEvent =
  | { type: "card.upserted"; cardId: string }
  | { type: "card.removed"; cardId: string }
  | { type: "item.upserted"; cardId: string; itemId: string }
  | { type: "sprint.upserted"; sprintId: string }
  | { type: "timeline.changed"; date: string }
  | { type: "banner.updated"; kind: BannerKind | "dailyMessage" | "checkin" }
  | { type: "alert.changed"; alertId: string }
  | { type: "schedule.updated"; scheduleId: string }
  | { type: "seerr.changed" }
  | { type: "notes.changed" }
  | { type: "day.rollover"; date: string };

// ---------- Hermes write API (/api/hermes/*, bearer HERMES_DASHBOARD_TOKEN) ----------
// Path segments for cards, items and sprints take the row's key or "id:<uuid>" (rows created on
// the page have no key). An id that does not exist is 404; ids never create rows.

export interface HermesUpsertCard {
  title: string;
  repoFullName?: string | null;
  milestoneTitle?: string | null;
  /** The sprint's key or "id:<uuid>"; null unlinks the card. */
  sprintKey?: string | null;
  status?: CardStatus;
  position?: number;
  hermesSuggestion?: string | null;
  /** Shallow-merged into the stored meta; a null value removes that key. */
  meta?: Record<string, unknown>;
  /** The version Hermes last read. Needed to change an existing card unless force is set (D15). */
  version?: number;
  /** Override user-edited fields. */
  force?: boolean;
}

export interface HermesUpsertItem {
  title: string;
  issueNumber?: number | null;
  sourceUrl?: string | null;
  /** User-owned: changing it on an existing item needs force (D15). */
  done?: boolean;
  isCurrent?: boolean;
  position?: number;
  /** The version Hermes last read. Needed to change an existing item unless force is set (D15). */
  version?: number;
  force?: boolean;
}

export interface HermesUpsertSprint {
  name: string;
  goal?: string | null;
  startsOn: string;
  endsOn: string;
  /** Setting "active" closes the previously active sprint (D8). */
  status?: SprintStatus;
  /** The version Hermes last read. Needed to change an existing sprint unless force is set (D15). */
  version?: number;
  force?: boolean;
}

export interface HermesUpsertAlert {
  source: string;
  title: string;
  detail?: string | null;
  /** Where Gerardo acts on it (http or https). */
  url?: string | null;
  severity?: AlertSeverity;
  /** Shallow-merged into the stored meta; a null value removes that key. */
  meta?: Record<string, unknown>;
}

/** PUT /api/hermes/notes/:key — a Hermes note. Absent = keep, null = clear. */
export interface HermesUpsertNote {
  text: string;
  detail?: string | null;
  url?: string | null;
  count?: number | null;
}

export interface HermesWriteResult<T> {
  data: T;
  created: boolean;
}

/** GET and PUT /api/hermes/watchlist (D9). */
export interface HermesWatchlist {
  symbols: string[];
}

export interface HermesWatchlistResult extends HermesWriteResult<HermesWatchlist> {
  /** False when the stored list already was exactly these symbols in this order. */
  changed: boolean;
  /** True when the stocks banner was refreshed right away (only tried when the list changed). */
  synced: boolean;
  /** Why the refresh did not run or failed, or which symbols had no quote. Never contains secrets. */
  syncError?: string;
}

/** `details` of a 409 CONFLICT from a Hermes upsert: re-read, then retry with currentVersion or force. */
export interface HermesConflictDetails<T> {
  reason: "version_required" | "stale_version" | "done_is_user_owned";
  /** Fields the request would have changed. */
  fields: string[];
  currentVersion: number;
  data: T;
}

export interface HermesDailyMessage {
  date: string; // YYYY-MM-DD
  text: string;
  author: Actor;
}

export interface HermesBannerResult {
  kind: BannerKind;
  capturedAt: string;
  data: GmailSnapshot | OrphansSnapshot | ScanSnapshot | StocksSnapshot;
}

export interface HermesCalendarChangedResult {
  calendarId: string;
  changedDates: string[];
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  syncedAt: string;
}

// GET /api/hermes/state — compact on purpose (Hermes reads it before every write).
// Rows Gerardo created on the page have key: null; Hermes addresses them as "id:<id>".

export interface HermesStateSprint {
  id: string;
  key: string | null;
  name: string;
  goal: string | null;
  startsOn: string;
  endsOn: string;
  status: SprintStatus;
  daysLeft: number | null;
  version: number;
}

export interface HermesStateItem {
  id: string;
  key: string | null;
  title: string;
  issueNumber: number | null;
  dueOn: string | null;
  done: boolean;
  /** Who checked it ("push" = Gerardo confirmed one of your push updates); null while open or unknown. */
  doneBy: ItemDoneBy | null;
  isCurrent: boolean;
  position: number;
  version: number;
  /** Push notes still waiting for the user, so Hermes does not suggest the same push again. */
  progress: { kind: ProgressKind; commitSha: string }[];
}

export interface HermesStateCard {
  id: string;
  key: string | null;
  title: string;
  dueOn: string | null;
  status: CardStatus;
  sprintId: string | null;
  sprintKey: string | null;
  repoFullName: string | null;
  milestoneTitle: string | null;
  hermesSuggestion: string | null;
  position: number;
  progress: { done: number; total: number };
  current: { itemId: string; itemKey: string | null; title: string; label: "now" | "next" } | null;
  version: number;
  items: HermesStateItem[];
}

export interface HermesStateAlert {
  dedupeKey: string;
  source: string;
  title: string;
  detail: string | null;
  url: string | null;
  severity: AlertSeverity;
  openedAt: string;
  /** Gerardo dismissed it; re-sending the same problem keeps it hidden. */
  dismissedAt: string | null;
}

export interface HermesStateResponse {
  generatedAt: string;
  date: string; // today in DASHBOARD_TIME_ZONE
  timeZone: string;
  activeSprint: HermesStateSprint | null;
  /** Planned and active sprints. */
  sprints: HermesStateSprint[];
  /** Every card that is not archived, ordered by position. */
  cards: HermesStateCard[];
  /** Open alerts only. */
  alerts: HermesStateAlert[];
  dailyMessage: HermesDailyMessage | null;
  /** The daily messages of the 60 days before today, newest first, so Hermes doesn't repeat itself. */
  recentDailyMessages: HermesDailyMessage[];
  /** Stocks watchlist in banner order (D9). */
  watchlist: string[];
  /** Every note, Gerardo's and Hermes's, zero counts included, newest first. */
  notes: NoteDto[];
  /** The newest Gmail snapshot, so the Gmail job can carry Needs reply and Packages forward. */
  gmail: { capturedAt: string; data: GmailSnapshot } | null;
  /** The newest stock quotes the dashboard fetched (the stocks slide), for the stock-swings job. */
  stocks: StocksSnapshot | null;
  /** The newest orphans check (read-only: the worker keeps the list), so Hermes can say what is stuck. */
  orphans: { capturedAt: string; data: OrphansSnapshot } | null;
  /** This week's check-in, if written. `done` already reflects linked checklist items. */
  checkin: {
    weekOf: string;
    summary: string;
    updatedAt: string;
    items: { key: string; text: string; done: boolean; itemId: string | null; itemKey: string | null }[];
  } | null;
}
