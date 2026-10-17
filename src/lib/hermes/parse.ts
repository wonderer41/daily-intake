import {
  ROOT,
  arrayOf,
  boolean,
  enumValue,
  fieldPath,
  integer,
  invalid,
  isoDateTime,
  jsonObject,
  localDate,
  optional,
  optionalHttpUrl,
  optionalString,
  requiredString,
  strictObject,
} from "@/lib/api/validate";
import { SYMBOL_PATTERN, WATCHLIST_MAX_SYMBOLS } from "@/lib/integrations/stocks/symbols";
import type { AlertSeverity, CardStatus, ProgressKind, SprintStatus } from "@/types/dashboard-contracts";
import { parseRef, type RowRef } from "./keys";

// Strict parsers for /api/hermes/* request bodies. Unknown fields are rejected by name.
// Convention for optional fields on an update: absent = keep the stored value, null = clear it.
// String limits match the @db.VarChar sizes in prisma/schema.prisma.

export const SPRINT_STATUSES: readonly SprintStatus[] = ["planned", "active", "closed"];
export const CARD_STATUSES: readonly CardStatus[] = ["active", "paused", "done", "archived"];
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["warning", "critical"];
export const PROGRESS_KINDS: readonly ProgressKind[] = ["looks_done", "partial"];

const MAX_POSITION = 2_000_000_000; // Postgres INTEGER, with room for appends
const MAX_VERSION = 2_147_483_647;
const META_MAX_BYTES = 4096;
const REPO_FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

function version(value: unknown): number | undefined {
  return optional(value, (v) => integer(v, "version", { min: 1, max: MAX_VERSION }));
}

function force(value: unknown): boolean {
  return value === undefined ? false : boolean(value, "force");
}

function position(value: unknown): number | undefined {
  return optional(value, (v) => integer(v, "position", { min: 0, max: MAX_POSITION }));
}

function meta(value: unknown): Record<string, unknown> | undefined {
  return optional(value, (v) => jsonObject(v, "meta", META_MAX_BYTES));
}

export interface SprintInput {
  name: string;
  goal: string | null | undefined;
  startsOn: string;
  endsOn: string;
  status: SprintStatus | undefined;
  version: number | undefined;
  force: boolean;
}

export function parseUpsertSprint(body: unknown): SprintInput {
  const o = strictObject(body, ROOT, ["name", "goal", "startsOn", "endsOn", "status", "version", "force"]);
  const startsOn = localDate(o.startsOn, "startsOn");
  const endsOn = localDate(o.endsOn, "endsOn");
  if (endsOn < startsOn) invalid("endsOn", "must be on or after startsOn");
  return {
    name: requiredString(o.name, "name", 120),
    goal: optionalString(o.goal, "goal", 500),
    startsOn,
    endsOn,
    status: optional(o.status, (v) => enumValue(v, "status", SPRINT_STATUSES)),
    version: version(o.version),
    force: force(o.force),
  };
}

export interface CardInput {
  title: string;
  repoFullName: string | null | undefined;
  milestoneTitle: string | null | undefined;
  /** YYYY-MM-DD; null clears it. */
  dueOn: string | null | undefined;
  /** A sprint key or id:<uuid>; null unlinks the card. */
  sprintKey: RowRef | null | undefined;
  status: CardStatus | undefined;
  position: number | undefined;
  hermesSuggestion: string | null | undefined;
  meta: Record<string, unknown> | undefined;
  version: number | undefined;
  force: boolean;
}

export function parseUpsertCard(body: unknown): CardInput {
  const o = strictObject(body, ROOT, [
    "title",
    "repoFullName",
    "milestoneTitle",
    "dueOn",
    "sprintKey",
    "status",
    "position",
    "hermesSuggestion",
    "meta",
    "version",
    "force",
  ]);
  const repoFullName = optionalString(o.repoFullName, "repoFullName", 200);
  if (repoFullName && !REPO_FULL_NAME.test(repoFullName)) invalid("repoFullName", 'must look like "owner/repo"');
  return {
    title: requiredString(o.title, "title", 160),
    repoFullName,
    milestoneTitle: optionalString(o.milestoneTitle, "milestoneTitle", 160),
    dueOn: (o.dueOn === undefined || o.dueOn === null ? o.dueOn : localDate(o.dueOn, "dueOn")) as string | null | undefined,
    sprintKey: o.sprintKey === undefined || o.sprintKey === null ? o.sprintKey : parseRef(o.sprintKey, "sprint", "sprintKey"),
    status: optional(o.status, (v) => enumValue(v, "status", CARD_STATUSES)),
    position: position(o.position),
    hermesSuggestion: optionalString(o.hermesSuggestion, "hermesSuggestion", 300),
    meta: meta(o.meta),
    version: version(o.version),
    force: force(o.force),
  };
}

export interface ItemInput {
  title: string;
  issueNumber: number | null | undefined;
  sourceUrl: string | null | undefined;
  /** YYYY-MM-DD; null clears it (the card's dueOn applies). */
  dueOn: string | null | undefined;
  done: boolean | undefined;
  isCurrent: boolean | undefined;
  position: number | undefined;
  version: number | undefined;
  force: boolean;
}

export function parseUpsertItem(body: unknown): ItemInput {
  const o = strictObject(body, ROOT, ["title", "issueNumber", "sourceUrl", "dueOn", "done", "isCurrent", "position", "version", "force"]);
  return {
    title: requiredString(o.title, "title", 200),
    issueNumber: o.issueNumber === null ? null : optional(o.issueNumber, (v) => integer(v, "issueNumber", { min: 1, max: MAX_VERSION })),
    sourceUrl: optionalHttpUrl(o.sourceUrl, "sourceUrl"),
    dueOn: (o.dueOn === undefined || o.dueOn === null ? o.dueOn : localDate(o.dueOn, "dueOn")) as string | null | undefined,
    done: optional(o.done, (v) => boolean(v, "done")),
    isCurrent: optional(o.isCurrent, (v) => boolean(v, "isCurrent")),
    position: position(o.position),
    version: version(o.version),
    force: force(o.force),
  };
}

export interface AlertInput {
  source: string;
  title: string;
  detail: string | null | undefined;
  url: string | null | undefined;
  severity: AlertSeverity | undefined;
  meta: Record<string, unknown> | undefined;
}

export function parseUpsertAlert(body: unknown): AlertInput {
  const o = strictObject(body, ROOT, ["source", "title", "detail", "url", "severity", "meta"]);
  return {
    source: requiredString(o.source, "source", 100),
    title: requiredString(o.title, "title", 200),
    detail: optionalString(o.detail, "detail", 500),
    url: optionalHttpUrl(o.url, "url"),
    severity: optional(o.severity, (v) => enumValue(v, "severity", ALERT_SEVERITIES)),
    meta: meta(o.meta),
  };
}

export interface ProgressInput {
  repoFullName: string;
  kind: ProgressKind;
  note: string;
  /** ISO, normalized to UTC. */
  pushedAt: string;
}

const COMMIT_SHA = /^[0-9a-f]{7,64}$/;

/** The :sha path segment: 7–64 hex characters, returned lowercased. */
export function parseCommitSha(raw: string): string {
  const sha = raw.trim().toLowerCase();
  if (!COMMIT_SHA.test(sha)) invalid("sha", "must be a commit SHA (7–64 hex characters; send the full 40)");
  return sha;
}

/** PUT /api/hermes/cards/:key/items/:itemKey/progress/:sha (D7). */
export function parseItemProgress(body: unknown): ProgressInput {
  const o = strictObject(body, ROOT, ["repoFullName", "kind", "note", "pushedAt"]);
  const repoFullName = requiredString(o.repoFullName, "repoFullName", 200);
  if (!REPO_FULL_NAME.test(repoFullName)) invalid("repoFullName", 'must look like "owner/repo"');
  return {
    repoFullName,
    kind: enumValue(o.kind, "kind", PROGRESS_KINDS),
    note: requiredString(o.note, "note", 500),
    pushedAt: isoDateTime(o.pushedAt, "pushedAt"),
  };
}

/** PUT /api/hermes/watchlist: 1–50 tickers, uppercased, duplicates dropped (first one wins). */
export function parseWatchlist(body: unknown): { symbols: string[] } {
  const o = strictObject(body, ROOT, ["symbols"]);
  const symbols = arrayOf(o.symbols, "symbols", WATCHLIST_MAX_SYMBOLS, (value, field) => {
    if (typeof value !== "string") invalid(field, "must be a string");
    const symbol = value.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) invalid(field, "must be a ticker symbol like NVDA or BRK.B (letters, digits, '.', '-'; at most 16)");
    return symbol;
  });
  if (symbols.length === 0) invalid("symbols", "must have at least one symbol");
  return { symbols: [...new Set(symbols)] };
}

export function parseDailyMessage(body: unknown): { text: string } {
  const o = strictObject(body, ROOT, ["text"]);
  return { text: requiredString(o.text, "text", 500) };
}

export function parseCalendarChanged(body: unknown): { calendarId: string | undefined } {
  const o = strictObject(body ?? {}, ROOT, ["calendarId"]);
  return { calendarId: optionalString(o.calendarId, "calendarId", 200) ?? undefined };
}

/** POST routes that take no input accept no body, or an empty JSON object. */
export function parseNoInput(body: unknown): void {
  strictObject(body ?? {}, ROOT, []);
}

/** Like readJsonBody, but an empty body is allowed and returned as undefined. */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    invalid(ROOT, "must be valid JSON");
  }
}

export interface NoteInput {
  text: string;
  /** Absent = keep, null = clear. */
  detail?: string | null;
  url?: string | null;
  count?: number | null;
}

/** PUT /api/hermes/notes/:key — a Hermes note. Count 0 keeps it but hides it. */
export function parseUpsertNote(body: unknown): NoteInput {
  const o = strictObject(body, ROOT, ["text", "detail", "url", "count"]);
  return {
    text: requiredString(o.text, "text", 200),
    detail: optionalString(o.detail, "detail", 200),
    url: optionalHttpUrl(o.url, "url"),
    count: o.count === null ? null : optional(o.count, (v) => integer(v, "count", { min: 0, max: 1_000_000 })),
  };
}

export interface CheckinInput {
  summary: string;
  items: { key: string; text: string; itemRef: RowRef | null }[];
}

const CHECKIN_ITEM_KEY = /^[a-z0-9][a-z0-9-]{0,99}$/;
const CHECKIN_MAX_ITEMS = 10;

/** PUT /api/hermes/checkin/:date — the summary plus up to 10 focus lines, each with a key unique in the list. */
export function parseUpsertCheckin(body: unknown): CheckinInput {
  const o = strictObject(body, ROOT, ["summary", "items"]);
  const items = arrayOf(o.items, "items", CHECKIN_MAX_ITEMS, (value, field) => {
    const item = strictObject(value, field, ["key", "text", "itemRef"]);
    const key = requiredString(item.key, fieldPath(field, "key"), 100);
    if (!CHECKIN_ITEM_KEY.test(key)) invalid(fieldPath(field, "key"), "must be lowercase letters, digits and dashes, e.g. streak-tracking");
    return {
      key,
      text: requiredString(item.text, fieldPath(field, "text"), 200),
      itemRef: item.itemRef === undefined || item.itemRef === null ? null : parseRef(item.itemRef, "item", fieldPath(field, "itemRef")),
    };
  });
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.key)) invalid(`items[${index}].key`, "repeats an earlier key");
    seen.add(item.key);
  }
  return { summary: requiredString(o.summary, "summary", 1000), items };
}
