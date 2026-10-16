import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChatIcon, ChevronDownIcon } from "@/components/ui/icons";
import { InnerCard } from "@/components/ui/inner-card";
import { ProgressSegments } from "@/components/ui/progress-segments";
import { localDateString } from "@/lib/time/zone";
import type { ChecklistItemDto, ItemProgressDto, UpdateCardRequest, UpdateItemRequest, WorkCardDto } from "@/types/dashboard-contracts";
import { fetchJson, isAbortError, isApiRequestError } from "../../api";
import { useDashboard, type TodayUpdater } from "../../context";
import { ChecklistRow } from "./checklist-row";
import { DueControl } from "./due-control";
import { cardDisplayTitle, countLine, dueLabel, effectiveDue, issueRef } from "./labels";
import { confirmProgress, dropProgress, setCardDue, setItemDone, setItemDue } from "./optimistic";

/** DOM id of a card's title button (focus fallback). */
export function cardToggleId(cardId: string): string {
  return `wo-toggle-${cardId}`;
}

const NOTICE_MS = 8_000;
const CONFLICT_NOTICE = "Changed elsewhere — reloaded.";

export interface WorkCardProps {
  card: WorkCardDto;
  open: boolean;
  /** The item whose scheduling bubble is open on this card, if any. */
  bubbleItemId: string | null;
  canSchedule: boolean;
  onToggle: () => void;
  /** Opens the bubble for an item; `fromSuggestion` = the collapsed card's "Schedule with Hermes". */
  onSchedule: (itemId: string, fromSuggestion: boolean) => void;
  onCloseBubble: () => void;
}

/**
 * One Working-on card. Collapsed: progress + current item (+ Hermes suggestion). Open: the checklist
 * with optimistic checkboxes, Schedule buttons, booked time tags and push notes.
 */
export function WorkCard({ card, open, bubbleItemId, canSchedule, onToggle, onSchedule, onCloseBubble }: WorkCardProps) {
  const { mutate, now, timeZone } = useDashboard();
  const title = cardDisplayTitle(card);
  const listId = useId();
  const current = card.current ? card.items.find((item) => item.id === card.current?.itemId) ?? null : null;
  const numbered = card.items.some((item) => item.issueNumber !== null);
  const today = localDateString(new Date(now), timeZone);
  const cardDue = card.dueOn ? dueLabel(card.dueOn, today) : null;
  const currentDueOn = current ? effectiveDue(current, card) : null;
  const currentDue = currentDueOn ? dueLabel(currentDueOn, today) : null;

  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Newest version the server returned per item, and the item's last write (writes go in order). */
  const versions = useRef(new Map<string, number>());
  const chains = useRef(new Map<string, Promise<unknown>>());
  /** Newest card version the server returned (deadline edits). */
  const cardVersion = useRef(card.version);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  function showNotice(text: string | null) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    if (text) noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }

  function showError(error: unknown) {
    if (isAbortError(error)) return;
    if (isApiRequestError(error, "CONFLICT")) showNotice(CONFLICT_NOTICE);
    else if (isApiRequestError(error)) showNotice(error.message);
    else showNotice("Couldn't save that. Try again.");
  }

  /** PATCH an item after any earlier write to it, with the newest version known. */
  function saveItem(item: ChecklistItemDto, change: Omit<UpdateItemRequest, "version">, update: TodayUpdater) {
    const previous = chains.current.get(item.id);
    const request = async () => {
      if (previous) await previous.catch(() => undefined);
      const body: UpdateItemRequest = { version: Math.max(item.version, versions.current.get(item.id) ?? 0), ...change };
      const saved = await fetchJson<ChecklistItemDto>(`/api/items/${encodeURIComponent(item.id)}`, { method: "PATCH", json: body });
      versions.current.set(item.id, saved.version);
      return saved;
    };
    const promise = mutate(update, request);
    chains.current.set(item.id, promise);
    promise
      .then(() => showNotice(null), showError)
      .finally(() => {
        if (chains.current.get(item.id) === promise) chains.current.delete(item.id);
      });
  }

  function toggleItem(item: ChecklistItemDto, done: boolean) {
    if (done && bubbleItemId === item.id) onCloseBubble();
    saveItem(item, { done }, (today) => setItemDone(today, card.id, item.id, done, now));
  }

  function setItemDeadline(item: ChecklistItemDto, dueOn: string | null) {
    saveItem(item, { dueOn }, (today) => setItemDue(today, card.id, item.id, dueOn));
  }

  function setCardDeadline(dueOn: string | null) {
    const body: UpdateCardRequest = { version: Math.max(card.version, cardVersion.current), dueOn };
    mutate(
      (today) => setCardDue(today, card.id, dueOn),
      () => fetchJson<WorkCardDto>(`/api/cards/${encodeURIComponent(card.id)}`, { method: "PATCH", json: body }),
    ).then((saved) => {
      cardVersion.current = saved.version;
      showNotice(null);
    }, showError);
  }

  function resolveNote(item: ChecklistItemDto, note: ItemProgressDto, action: "confirm" | "dismiss") {
    const update: TodayUpdater =
      action === "confirm"
        ? (today) => confirmProgress(today, card.id, item.id, note.id, now)
        : (today) => dropProgress(today, card.id, item.id, note.id);
    const url = `/api/items/${encodeURIComponent(item.id)}/progress/${encodeURIComponent(note.id)}/${action}`;
    mutate(update, () => fetchJson<ChecklistItemDto>(url, { method: "POST" })).then((saved) => {
      versions.current.set(item.id, saved.version);
      showNotice(null);
    }, showError);
  }

  return (
    <InnerCard as="article" open={open} className="flex flex-col gap-3 px-5 py-[18px] max-sm:px-4">
      <h3 className="m-0">
        <button
          id={cardToggleId(card.id)}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
          className="wo-toggle flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-3 border-0 bg-transparent p-0 text-left"
        >
          <span className="min-w-0 grow font-mono text-[18px] font-semibold text-text-strong [overflow-wrap:anywhere]">{title}</span>
          {card.metaLine ? <span className="font-mono text-[12px] font-normal text-text-muted">{card.metaLine}</span> : null}
          <ChevronDownIcon size={18} className="wo-chevron shrink-0 text-text-strong" />
        </button>
      </h3>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between gap-3 text-[14px]">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-text">
            {card.milestoneTitle ? <span>Milestone · {card.milestoneTitle}</span> : null}
            {cardDue ? <Chip tone={cardDue.overdue && card.progress.done < card.progress.total ? "overdue" : "neutral"}>{cardDue.text}</Chip> : null}
          </span>
          <span className="shrink-0 font-mono text-text-strong">{countLine(card)}</span>
        </div>
        <ProgressSegments segments={card.items.map((item) => item.done)} label={`${title} progress`} />
        {notice ? (
          <p aria-hidden="true" className="m-0 text-[13px] text-amber">
            {notice}
          </p>
        ) : null}
        <span role="status" className="sr-only">
          {notice ?? ""}
        </span>
      </div>

      {/* Summary: shown while collapsed. */}
      <div className="wo-reveal" data-expanded={open ? undefined : ""}>
        <div inert={open}>
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2.5 border-t border-[rgba(216,226,220,0.2)] pt-2.5">
              {current && card.current ? (
                <>
                  <span className="font-mono text-[12px] text-text-muted">{card.current.label}</span>
                  {issueRef(current) ? <span className="font-mono text-[13px] text-lily-pink">{issueRef(current)}</span> : null}
                  <span className="min-w-0 grow text-[16px] text-text-strong">{current.title}</span>
                  {currentDue ? <Chip tone={currentDue.overdue ? "overdue" : "neutral"}>{currentDue.text}</Chip> : null}
                  <Chip tone={card.current.label === "now" ? "in-progress" : "open"}>{card.current.label === "now" ? "In progress" : "Open"}</Chip>
                </>
              ) : (
                <span className="text-[14px] text-text-muted">{card.items.length === 0 ? "No checklist items yet." : "All done."}</span>
              )}
            </div>
            {card.hermesSuggestion ? (
              <div className="flex flex-wrap items-center gap-3.5 border border-[rgba(229,154,181,0.6)] bg-[rgba(229,154,181,0.08)] px-4 py-3.5">
                <div className="flex min-w-0 flex-[1_1_240px] items-baseline gap-2.5">
                  <ChatIcon className="shrink-0 self-center text-lily-pink" />
                  <p className="m-0 min-w-0">
                    <span className="mr-2.5 font-semibold text-lily-pink">Hermes</span>
                    <span className="text-text">{card.hermesSuggestion}</span>
                  </p>
                </div>
                {current && canSchedule ? (
                  <Button variant="primary" onClick={() => onSchedule(current.id, true)}>
                    Schedule with Hermes
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Checklist: shown while open. */}
      <div id={listId} className="wo-reveal" data-expanded={open ? "" : undefined}>
        <div inert={!open}>
          {canSchedule ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(216,226,220,0.2)] py-2">
              <span className="text-[14px] text-text-muted">{card.dueOn ? "Card deadline" : "No card deadline"}</span>
              <DueControl value={card.dueOn} name={title} onChange={setCardDeadline} />
            </div>
          ) : null}
          {card.items.length === 0 ? (
            <p className="m-0 border-t border-[rgba(216,226,220,0.2)] pt-3 text-[14px] text-text-muted">No checklist items yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col border-t border-[rgba(216,226,220,0.2)] p-0 pt-1" aria-label={`${title} checklist`}>
              {card.items.map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  cardId={card.id}
                  cardTitle={title}
                  numbered={numbered}
                  canSchedule={canSchedule}
                  bubbleOpen={bubbleItemId === item.id}
                  now={now}
                  timeZone={timeZone}
                  today={today}
                  onToggle={toggleItem}
                  onDueChange={setItemDeadline}
                  onSchedule={(itemId) => onSchedule(itemId, false)}
                  onCloseBubble={onCloseBubble}
                  onResolveNote={resolveNote}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </InnerCard>
  );
}
