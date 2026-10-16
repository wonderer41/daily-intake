import type { Sprint } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dashboardTimeZone, localDateString } from "@/lib/time/zone";
import type { GmailSnapshot, HermesStateCard, HermesStateResponse, HermesStateSprint } from "@/types/dashboard-contracts";
import { parseSnapshotPayload } from "./banner-payload";
import { currentItem, dateOnly, toDbDate, toSprintDto } from "./dto";
import { findCheckin, toHermesCheckin, weekOf } from "./checkin";
import { dueOnDto } from "./due";
import { toWaitingItemDto } from "./waiting";

function toStateSprint(row: Sprint, today: string): HermesStateSprint {
  const dto = toSprintDto(row, today);
  return {
    id: dto.id,
    key: dto.externalKey,
    name: dto.name,
    goal: dto.goal,
    startsOn: dto.startsOn,
    endsOn: dto.endsOn,
    status: dto.status,
    daysLeft: dto.daysLeft,
    version: dto.version,
  };
}

/** GET /api/hermes/state: what Hermes needs to reason before writing, keyed by the keys it writes with. */
export async function getHermesState(now = new Date()): Promise<HermesStateResponse> {
  const timeZone = dashboardTimeZone();
  const today = localDateString(now, timeZone);

  const [sprints, cards, alerts, message, watchlist, waiting, checkin, gmail] = await Promise.all([
    prisma.sprint.findMany({ where: { status: { in: ["active", "planned"] } }, orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }] }),
    prisma.workCard.findMany({
      where: { status: { not: "archived" } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        sprint: { select: { externalKey: true } },
        items: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: {
            progress: { where: { status: "pending" }, orderBy: [{ pushedAt: "desc" }, { createdAt: "desc" }], select: { kind: true, commitSha: true } },
          },
        },
      },
    }),
    prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: "asc" } }),
    prisma.dailyMessage.findUnique({ where: { date: toDbDate(today) } }),
    prisma.watchlistSymbol.findMany({ orderBy: [{ position: "asc" }, { symbol: "asc" }], select: { symbol: true } }),
    prisma.waitingItem.findMany({ orderBy: [{ position: "asc" }, { title: "asc" }] }),
    findCheckin(weekOf(today)),
    prisma.bannerSnapshot.findFirst({ where: { kind: "gmail" }, orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }], select: { payload: true, capturedAt: true } }),
  ]);

  const stateSprints = sprints.map((row) => toStateSprint(row, today));
  const stateCards: HermesStateCard[] = cards.map((card) => {
    const current = currentItem(card.items);
    return {
      id: card.id,
      key: card.externalKey,
      title: card.title,
      dueOn: dueOnDto(card.dueOn),
      status: card.status,
      sprintId: card.sprintId,
      sprintKey: card.sprint?.externalKey ?? null,
      repoFullName: card.repoFullName,
      milestoneTitle: card.milestoneTitle,
      hermesSuggestion: card.hermesSuggestion,
      position: card.position,
      progress: { done: card.items.filter((item) => item.done).length, total: card.items.length },
      current: current ? { itemId: current.item.id, itemKey: current.item.externalKey, title: current.item.title, label: current.label } : null,
      version: card.version,
      items: card.items.map((item) => ({
        id: item.id,
        key: item.externalKey,
        title: item.title,
        dueOn: dueOnDto(item.dueOn),
        issueNumber: item.issueNumber,
        done: item.done,
        isCurrent: item.isCurrent,
        position: item.position,
        version: item.version,
        progress: item.progress,
      })),
    };
  });

  return {
    generatedAt: now.toISOString(),
    date: today,
    timeZone,
    activeSprint: stateSprints.find((sprint) => sprint.status === "active") ?? null,
    sprints: stateSprints,
    cards: stateCards,
    alerts: alerts.map((alert) => ({
      dedupeKey: alert.dedupeKey,
      source: alert.source,
      title: alert.title,
      detail: alert.detail,
      severity: alert.severity,
      openedAt: alert.openedAt.toISOString(),
    })),
    dailyMessage: message ? { date: dateOnly(message.date), text: message.text, author: message.author } : null,
    watchlist: watchlist.map((row) => row.symbol),
    waiting: waiting.map((row) => ({ ...toWaitingItemDto(row), position: row.position })),
    checkin: checkin ? toHermesCheckin(checkin) : null,
    gmail: gmail ? storedGmail(gmail) : null,
  };
}

/** The stored Gmail snapshot, re-validated: an old or malformed row reads as none, so Hermes starts over. */
function storedGmail(row: { payload: unknown; capturedAt: Date }): HermesStateResponse["gmail"] {
  try {
    return { capturedAt: row.capturedAt.toISOString(), data: parseSnapshotPayload("gmail", row.payload) as GmailSnapshot };
  } catch {
    return null;
  }
}
