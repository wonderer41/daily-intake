import { resolveOpenAlert, upsertAlert } from "@/lib/dashboard/alerts";
import { prisma } from "@/lib/db/prisma";
import type { AlertInput } from "@/lib/hermes/parse";
import { getMediaDetails, listRequests } from "./client";
import { loadSeerrConfig, seerrImportantAfterDays, type SeerrConfig } from "./config";
import { requestTitle, seasonsLabel } from "./labels";
import type { SeerrRequest } from "./normalize";

// Guest requests left waiting in Seerr, raised in Important by the dashboard itself (Hermes doesn't
// see Seerr). The 2-minute Seerr poll opens one warning per request pending longer than
// SEERR_IMPORTANT_AFTER_DAYS, keyed seerr:request:<id>, and resolves it once the request is no longer
// pending (approved or declined). Gerardo can dismiss it like any alert.

export const SEERR_ALERT_PREFIX = "seerr:request:";
const DAY_MS = 86_400_000;
const PAGE_SIZE = 100;
/** Pages read at most per poll; past that the list is incomplete and nothing is resolved. */
const MAX_PAGES = 10;
const TITLE_MAX = 200;
/** requestTitle's fallback when Seerr couldn't load the details: looked up again next time. */
const FALLBACK_TITLE = /^TMDB #\d+$/;

export function seerrAlertKey(requestId: number): string {
  return `${SEERR_ALERT_PREFIX}${requestId}`;
}

/** Every pending request, page by page. `complete` is false when Seerr had more than MAX_PAGES pages. */
export async function listAllPending(config: SeerrConfig): Promise<{ requests: SeerrRequest[]; complete: boolean }> {
  const byId = new Map<number, SeerrRequest>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { total, results } = await listRequests(config, "pending", PAGE_SIZE, page * PAGE_SIZE);
    // A request made between two pages shifts the offsets; the map drops the repeat.
    for (const request of results) byId.set(request.id, request);
    if (results.length < PAGE_SIZE || byId.size >= total) return { requests: [...byId.values()], complete: true };
  }
  return { requests: [...byId.values()], complete: false };
}

/** Whole days since the request was made. */
export function daysWaiting(request: Pick<SeerrRequest, "createdAt">, now: Date): number {
  return Math.floor((now.getTime() - new Date(request.createdAt).getTime()) / DAY_MS);
}

/** "Movie · requested 6 days ago by maria", "TV · seasons 1–2 · requested 6 days ago by luis". */
export function waitingDetail(request: SeerrRequest, now: Date): string {
  const days = daysWaiting(request, now);
  const seasons = request.mediaType === "tv" ? seasonsLabel(request.seasons) : null;
  const ago = `requested ${days} ${days === 1 ? "day" : "days"} ago by ${request.requestedBy}`;
  return [request.mediaType === "movie" ? "Movie" : "TV", seasons, ago].filter(Boolean).join(" · ");
}

/** The title's page in Seerr's web UI (SEERR_PUBLIC_URL), or null when that isn't set. */
export function seerrTitleUrl(publicUrl: string | null, request: Pick<SeerrRequest, "mediaType" | "tmdbId">): string | null {
  return publicUrl ? `${publicUrl}/${request.mediaType}/${request.tmdbId}` : null;
}

export function seerrAlertInput(request: SeerrRequest, title: string, now: Date, publicUrl: string | null): AlertInput {
  return {
    source: "seerr",
    title: title.slice(0, TITLE_MAX),
    detail: waitingDetail(request, now),
    url: seerrTitleUrl(publicUrl, request),
    severity: "warning",
    meta: undefined,
  };
}

export interface SeerrImportantPlan {
  /** Requests waiting too long. `title` is the open alert's, or null when it has to be looked up. */
  upsert: { request: SeerrRequest; title: string | null }[];
  /** Open seerr:request:* alerts whose request is no longer pending. Empty when the list was incomplete. */
  resolve: string[];
}

/** What one poll changes, from Seerr's pending requests and the open Seerr alerts. Pure. */
export function planSeerrImportant(
  pending: readonly SeerrRequest[],
  open: readonly { dedupeKey: string; title: string }[],
  now: Date,
  afterDays: number,
  complete: boolean,
): SeerrImportantPlan {
  const titles = new Map(open.map((alert) => [alert.dedupeKey, alert.title]));
  const waiting = pending.filter((request) => now.getTime() - new Date(request.createdAt).getTime() >= afterDays * DAY_MS);
  const waitingKeys = new Set(waiting.map((request) => seerrAlertKey(request.id)));
  return {
    upsert: waiting.map((request) => {
      const title = titles.get(seerrAlertKey(request.id));
      return { request, title: title && !FALLBACK_TITLE.test(title) ? title : null };
    }),
    resolve: complete ? open.map((alert) => alert.dedupeKey).filter((key) => !waitingKeys.has(key)) : [],
  };
}

async function lookUpTitle(config: SeerrConfig, request: SeerrRequest): Promise<string> {
  try {
    const details = await getMediaDetails(config, request.mediaType, request.tmdbId);
    return requestTitle(details);
  } catch {
    return requestTitle({ title: `TMDB #${request.tmdbId}`, year: null });
  }
}

/** The Important part of the Seerr poll. Throws when Seerr can't be read; then nothing changes. */
export async function syncSeerrImportant(
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ waiting: number; opened: number; resolved: number }> {
  const config = loadSeerrConfig(env);
  const afterDays = seerrImportantAfterDays(env);
  const [{ requests, complete }, open] = await Promise.all([
    listAllPending(config),
    prisma.alert.findMany({ where: { dedupeKey: { startsWith: SEERR_ALERT_PREFIX }, resolvedAt: null }, select: { dedupeKey: true, title: true } }),
  ]);
  const plan = planSeerrImportant(requests, open, now, afterDays, complete);

  let opened = 0;
  for (const { request, title } of plan.upsert) {
    const name = title ?? (await lookUpTitle(config, request));
    const result = await upsertAlert(seerrAlertKey(request.id), seerrAlertInput(request, name, now, config.publicUrl), now);
    if (result.created) opened += 1;
  }
  let resolved = 0;
  for (const key of plan.resolve) if (await resolveOpenAlert(key, now)) resolved += 1;
  return { waiting: plan.upsert.length, opened, resolved };
}
