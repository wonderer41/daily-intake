import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import type { CheckinInput } from "@/lib/hermes/parse";
import { describeRef, refWhere } from "@/lib/hermes/keys";
import { publishLiveEvent } from "@/lib/live/publish";
import { addDays, localDateString } from "@/lib/time/zone";
import type { CheckinDto, HermesStateResponse, HermesWriteResult } from "@/types/dashboard-contracts";
import { dateOnly, toDbDate } from "./dto";

// The weekly check-in: Hermes writes it mid-week and updates it before the weekend (PUT
// /api/hermes/checkin/:date); the page shows it first on the banner until the week ends and lets the
// user check lines off. A line that is one of the cards' checklist items has no done state of its own:
// it reads (and, from the page, writes) that item's.

const CHECKIN_INCLUDE = {
  items: {
    orderBy: [{ position: "asc" }, { key: "asc" }],
    include: { checklistItem: { select: { id: true, cardId: true, version: true, done: true, externalKey: true } } },
  },
} satisfies Prisma.WeeklyCheckinInclude;

export type CheckinRow = Prisma.WeeklyCheckinGetPayload<{ include: typeof CHECKIN_INCLUDE }>;

/** Monday (YYYY-MM-DD) of the week `date` falls in. */
export function weekOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function currentWeekOf(now: Date, timeZone: string): string {
  return weekOf(localDateString(now, timeZone));
}

export async function findCheckin(week: string): Promise<CheckinRow | null> {
  return prisma.weeklyCheckin.findUnique({ where: { weekOf: toDbDate(week) }, include: CHECKIN_INCLUDE });
}

export function toCheckinDto(row: CheckinRow, sprintProgress: CheckinDto["sprintProgress"]): CheckinDto {
  return {
    weekOf: dateOnly(row.weekOf),
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sprintProgress,
    items: row.items.map((item) => ({
      id: item.id,
      key: item.key,
      text: item.text,
      done: item.checklistItem ? item.checklistItem.done : item.done,
      checklistItem: item.checklistItem ? { id: item.checklistItem.id, cardId: item.checklistItem.cardId, version: item.checklistItem.version } : null,
    })),
  };
}

export function toHermesCheckin(row: CheckinRow): NonNullable<HermesStateResponse["checkin"]> {
  return {
    weekOf: dateOnly(row.weekOf),
    summary: row.summary,
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map((item) => ({
      key: item.key,
      text: item.text,
      done: item.checklistItem ? item.checklistItem.done : item.done,
      itemId: item.checklistItem?.id ?? null,
      itemKey: item.checklistItem?.externalKey ?? null,
    })),
  };
}

/** Items done / total across the active sprint's cards that aren't archived. */
export async function activeSprintProgress(): Promise<CheckinDto["sprintProgress"]> {
  const sprint = await prisma.sprint.findFirst({ where: { status: "active" }, orderBy: [{ startsOn: "desc" }, { updatedAt: "desc" }], select: { id: true } });
  if (!sprint) return null;
  const where = { card: { sprintId: sprint.id, status: { not: "archived" as const } } };
  const [total, done] = await Promise.all([prisma.checklistItem.count({ where }), prisma.checklistItem.count({ where: { ...where, done: true } })]);
  return { done, total };
}

/**
 * Creates or rewrites the check-in for the week `date` falls in. The list is replaced: lines are
 * matched by key, so a line that stays keeps its check; lines left out are removed. Sending the same
 * check-in again changes nothing.
 */
export async function upsertCheckin(date: string, input: CheckinInput): Promise<HermesWriteResult<CheckinDto>> {
  const week = weekOf(date);
  const outcome = await prisma.$transaction(async (tx) => {
    // Resolve every item reference first, so a bad one changes nothing.
    const linked = await Promise.all(
      input.items.map(async (item, index) => {
        if (!item.itemRef) return null;
        const found = await tx.checklistItem.findUnique({ where: refWhere(item.itemRef), select: { id: true } });
        if (!found) throw new HttpError("NOT_FOUND", `No checklist item has ${describeRef(item.itemRef)}`, { field: `items[${index}].itemRef` });
        return found.id;
      }),
    );

    const existing = await tx.weeklyCheckin.findUnique({ where: { weekOf: toDbDate(week) }, include: { items: true } });
    if (!existing) {
      const row = await tx.weeklyCheckin.create({
        data: {
          weekOf: toDbDate(week),
          summary: input.summary,
          items: { create: input.items.map((item, index) => ({ key: item.key, text: item.text, position: index, checklistItemId: linked[index] })) },
        },
      });
      return { id: row.id, created: true, changed: true };
    }

    let changed = existing.summary !== input.summary;
    if (changed) await tx.weeklyCheckin.update({ where: { id: existing.id }, data: { summary: input.summary } });
    const keep = new Set(input.items.map((item) => item.key));
    const stale = existing.items.filter((item) => !keep.has(item.key)).map((item) => item.id);
    if (stale.length > 0) {
      await tx.checkinItem.deleteMany({ where: { id: { in: stale } } });
      changed = true;
    }
    for (const [index, item] of input.items.entries()) {
      const before = existing.items.find((row) => row.key === item.key);
      const data = { text: item.text, position: index, checklistItemId: linked[index] };
      if (!before) {
        await tx.checkinItem.create({ data: { checkinId: existing.id, key: item.key, ...data } });
        changed = true;
      } else if (before.text !== data.text || before.position !== data.position || before.checklistItemId !== data.checklistItemId) {
        await tx.checkinItem.update({ where: { id: before.id }, data });
        changed = true;
      }
    }
    // Touch the check-in so updatedAt says when Hermes last revised it.
    if (changed) await tx.weeklyCheckin.update({ where: { id: existing.id }, data: { updatedAt: new Date() } });
    return { id: existing.id, created: false, changed };
  });

  if (outcome.changed) await publishLiveEvent({ type: "banner.updated", kind: "checkin" });
  const row = await prisma.weeklyCheckin.findUniqueOrThrow({ where: { id: outcome.id }, include: CHECKIN_INCLUDE });
  return { data: toCheckinDto(row, await activeSprintProgress()), created: outcome.created };
}

/** PATCH /api/checkin/items/:id: checks a line that is not one of the cards' checklist items. */
export async function setCheckinItemDone(id: string, done: boolean, now = new Date()): Promise<CheckinDto> {
  const item = await prisma.checkinItem.findUnique({ where: { id }, select: { checkinId: true, checklistItemId: true, done: true } });
  if (!item) throw new HttpError("NOT_FOUND", "Check-in item not found");
  if (item.checklistItemId) {
    throw new HttpError("VALIDATION_ERROR", "This line is a checklist item; check it with PATCH /api/items/:id", { field: "done" });
  }
  if (item.done !== done) {
    await prisma.checkinItem.update({ where: { id }, data: { done, doneAt: done ? now : null } });
    await publishLiveEvent({ type: "banner.updated", kind: "checkin" });
  }
  const row = await prisma.weeklyCheckin.findUniqueOrThrow({ where: { id: item.checkinId }, include: CHECKIN_INCLUDE });
  return toCheckinDto(row, await activeSprintProgress());
}
