import type { BannerKind, DailyMessage, Sprint } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, dashboardTimeZone, localDateString } from "@/lib/time/zone";
import type {
  GmailSnapshot,
  HermesDailyMessage,
  HermesStateCard,
  HermesStateResponse,
  HermesStateSprint,
  OrphansSnapshot,
  StocksSnapshot,
} from "@/types/dashboard-contracts";
import { parseSnapshotPayload } from "./banner-payload";
import { currentItem, dateOnly, itemDoneBy, toDbDate, toSprintDto } from "./dto";
import { findCheckin, toHermesCheckin, weekOf } from "./checkin";
import { dueOnDto } from "./due";
import { listAllNotes, toNoteDto } from "./notes";

/** Days of earlier daily messages in the state, so Hermes can avoid repeating a word or fact. */
const RECENT_MESSAGE_DAYS = 60;

function toStateMessage(row: DailyMessage): HermesDailyMessage {
  return { date: dateOnly(row.date), text: row.text, author: row.author };
}

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

  const [sprints, cards, alerts, message, recentMessages, watchlist, notes, checkin, gmail, stocks, orphans] = await Promise.all([
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
    prisma.dailyMessage.findMany({
      where: { date: { gte: toDbDate(addDays(today, -RECENT_MESSAGE_DAYS)), lt: toDbDate(today) } },
      orderBy: { date: "desc" },
    }),
    prisma.watchlistSymbol.findMany({ orderBy: [{ position: "asc" }, { symbol: "asc" }], select: { symbol: true } }),
    listAllNotes(),
    findCheckin(weekOf(today)),
    newestSnapshot("gmail"),
    newestSnapshot("stocks"),
    newestSnapshot("orphans"),
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
        doneBy: itemDoneBy(item),
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
      url: alert.url,
      severity: alert.severity,
      openedAt: alert.openedAt.toISOString(),
      dismissedAt: alert.dismissedAt?.toISOString() ?? null,
    })),
    dailyMessage: message ? toStateMessage(message) : null,
    recentDailyMessages: recentMessages.map(toStateMessage),
    watchlist: watchlist.map((row) => row.symbol),
    notes: notes.map(toNoteDto),
    checkin: checkin ? toHermesCheckin(checkin) : null,
    gmail: stored<GmailSnapshot>("gmail", gmail),
    stocks: stored<StocksSnapshot>("stocks", stocks)?.data ?? null,
    orphans: stored<OrphansSnapshot>("orphans", orphans),
  };
}

function newestSnapshot(kind: BannerKind) {
  return prisma.bannerSnapshot.findFirst({ where: { kind }, orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }], select: { payload: true, capturedAt: true } });
}

/** A stored snapshot, re-validated: an old or malformed row reads as none, so Hermes starts over. */
function stored<T>(kind: BannerKind, row: { payload: unknown; capturedAt: Date } | null): { capturedAt: string; data: T } | null {
  if (!row) return null;
  try {
    return { capturedAt: row.capturedAt.toISOString(), data: parseSnapshotPayload(kind, row.payload) as T };
  } catch {
    return null;
  }
}
