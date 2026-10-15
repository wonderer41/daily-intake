import type { Prisma, WaitingItem } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import type { WaitingItemInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { HermesWriteResult, WaitingItemDto } from "@/types/dashboard-contracts";
import { retryOnUniqueViolation } from "./concurrency";

// Custom "Waiting on you" items. Like alerts they are machine-owned (no edit form on the page), so
// the latest push wins and repeating a push changes nothing.

export function toWaitingItemDto(row: WaitingItem): WaitingItemDto {
  return { key: row.key, title: row.title, count: row.count, detail: row.detail, url: row.url };
}

/** What the page shows: count > 0 only, in position order. */
export async function listVisibleWaitingItems(): Promise<WaitingItem[]> {
  return prisma.waitingItem.findMany({ where: { count: { gt: 0 } }, orderBy: [{ position: "asc" }, { title: "asc" }] });
}

function waitingChanges(row: WaitingItem, input: WaitingItemInput): Prisma.WaitingItemUpdateInput | null {
  const data: Prisma.WaitingItemUpdateInput = {};
  if (input.title !== row.title) data.title = input.title;
  if (input.count !== row.count) data.count = input.count;
  if (input.detail !== undefined && input.detail !== row.detail) data.detail = input.detail;
  if (input.url !== undefined && input.url !== row.url) data.url = input.url;
  if (input.position !== undefined && input.position !== row.position) data.position = input.position;
  return Object.keys(data).length > 0 ? data : null;
}

/** Creates or updates the item with this key (PUT /api/hermes/waiting/:key). */
export async function upsertWaitingItem(key: string, input: WaitingItemInput): Promise<HermesWriteResult<WaitingItemDto>> {
  const outcome = await retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.waitingItem.findUnique({ where: { key } });
      if (!existing) {
        const row = await tx.waitingItem.create({
          data: { key, title: input.title, count: input.count, detail: input.detail ?? null, url: input.url ?? null, position: input.position ?? 0 },
        });
        return { row, created: true, changed: true };
      }
      const data = waitingChanges(existing, input);
      const row = data ? await tx.waitingItem.update({ where: { id: existing.id }, data }) : existing;
      return { row, created: false, changed: data !== null };
    }),
  );
  if (outcome.changed) await publishLiveEvent({ type: "waiting.changed" });
  return { data: toWaitingItemDto(outcome.row), created: outcome.created };
}

/** Removes the item (DELETE /api/hermes/waiting/:key). 404 when there is no such item. */
export async function deleteWaitingItem(key: string): Promise<{ deleted: true }> {
  const { count } = await prisma.waitingItem.deleteMany({ where: { key } });
  if (count === 0) throw new HttpError("NOT_FOUND", `No waiting item has key ${key}`);
  await publishLiveEvent({ type: "waiting.changed" });
  return { deleted: true };
}
