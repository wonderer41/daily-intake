import type { Alert, Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import type { AlertInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { AlertDto, HermesWriteResult } from "@/types/dashboard-contracts";
import { retryOnUniqueViolation } from "./concurrency";
import { alertInclude, toAlertDto } from "./dto";
import { mergeMeta, sameJson } from "./json";

// Alerts are machine-owned (Important has no edit form), so there is no version check: the latest
// push wins. A push for a resolved alert reopens it — the problem came back. Gerardo can dismiss an
// open alert; it stays hidden while Hermes keeps reporting the same problem, and shows again when it
// reopens after a resolve or goes from warning to critical.

async function loadAlertDto(id: string, now: Date): Promise<AlertDto> {
  return toAlertDto(await prisma.alert.findUniqueOrThrow({ where: { id }, include: alertInclude(now) }));
}

/** What a Hermes push changes on an existing alert; null when nothing. Exported for tests. */
export function alertChanges(row: Alert, input: AlertInput, now: Date): Prisma.AlertUpdateManyMutationInput | null {
  const data: Prisma.AlertUpdateManyMutationInput = {};
  if (input.source !== row.source) data.source = input.source;
  if (input.title !== row.title) data.title = input.title;
  if (input.detail !== undefined && input.detail !== row.detail) data.detail = input.detail;
  if (input.url !== undefined && input.url !== row.url) data.url = input.url;
  if (input.severity !== undefined && input.severity !== row.severity) {
    data.severity = input.severity;
    // Worse than when it was dismissed: show it again.
    if (row.dismissedAt !== null && row.severity === "warning" && input.severity === "critical") data.dismissedAt = null;
  }
  if (input.meta !== undefined) {
    const merged = mergeMeta(row.meta, input.meta);
    if (!sameJson(merged, row.meta)) data.meta = merged as Prisma.InputJsonObject;
  }
  if (row.resolvedAt !== null) {
    data.resolvedAt = null;
    data.openedAt = now;
    // A new occurrence: an old dismiss doesn't hide it.
    if (row.dismissedAt !== null) data.dismissedAt = null;
  }
  return Object.keys(data).length > 0 ? data : null;
}

/** Opens, updates or reopens the alert with this dedupeKey (PUT /api/hermes/alerts/:dedupeKey). */
export async function upsertAlert(dedupeKey: string, input: AlertInput, now = new Date()): Promise<HermesWriteResult<AlertDto>> {
  const outcome = await retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.alert.findUnique({ where: { dedupeKey } });
      if (!existing) {
        const row = await tx.alert.create({
          data: {
            dedupeKey,
            source: input.source,
            title: input.title,
            detail: input.detail ?? null,
            url: input.url ?? null,
            severity: input.severity ?? "warning",
            meta: mergeMeta({}, input.meta ?? {}) as Prisma.InputJsonObject,
            openedAt: now,
          },
        });
        return { id: row.id, created: true, changed: true };
      }
      const data = alertChanges(existing, input, now);
      if (data) await tx.alert.update({ where: { id: existing.id }, data });
      return { id: existing.id, created: false, changed: data !== null };
    }),
  );

  const data = await loadAlertDto(outcome.id, now);
  if (outcome.changed) await publishLiveEvent({ type: "alert.changed", alertId: outcome.id });
  return { data, created: outcome.created };
}

/** Closes the alert (POST /api/hermes/alerts/:dedupeKey/resolve). Resolving twice changes nothing. */
export async function resolveAlert(dedupeKey: string, now = new Date()): Promise<HermesWriteResult<AlertDto>> {
  const existing = await prisma.alert.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (!existing) throw new HttpError("NOT_FOUND", `No alert has dedupeKey ${dedupeKey}`);
  const { count } = await prisma.alert.updateMany({ where: { id: existing.id, resolvedAt: null }, data: { resolvedAt: now } });
  const data = await loadAlertDto(existing.id, now);
  if (count > 0) await publishLiveEvent({ type: "alert.changed", alertId: existing.id });
  return { data, created: false };
}

/** Resolves the alert only when it exists and is open, for jobs that clear their own alerts. */
export async function resolveOpenAlert(dedupeKey: string, now = new Date()): Promise<boolean> {
  const existing = await prisma.alert.findUnique({ where: { dedupeKey }, select: { resolvedAt: true } });
  if (!existing || existing.resolvedAt !== null) return false;
  await resolveAlert(dedupeKey, now);
  return true;
}

/** Hides an open alert on the page (POST /api/alerts/:id/dismiss). Dismissing twice changes nothing. */
export async function dismissAlert(id: string, now = new Date()): Promise<AlertDto> {
  const existing = await prisma.alert.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError("NOT_FOUND", `No alert has id ${id}`);
  const { count } = await prisma.alert.updateMany({ where: { id, dismissedAt: null }, data: { dismissedAt: now } });
  const data = await loadAlertDto(id, now);
  if (count > 0) await publishLiveEvent({ type: "alert.changed", alertId: id });
  return data;
}
