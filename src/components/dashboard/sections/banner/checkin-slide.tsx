import { useState } from "react";
import { CheckboxRow } from "@/components/ui/checkbox";
import { ChatIcon } from "@/components/ui/icons";
import { Eyebrow } from "@/components/ui/typography";
import type { CheckinDto, CheckinItemDto, ChecklistItemDto, TodayResponse, UpdateCheckinItemRequest, UpdateItemRequest } from "@/types/dashboard-contracts";
import { fetchJson, isAbortError, isApiRequestError } from "../../api";
import { useDashboard } from "../../context";
import { sprintLine } from "../working-on/labels";
import { setItemDone } from "../working-on/optimistic";

/** Sets a check-in line's mark (and nothing else): for the optimistic layer. */
export function setCheckinLineDone(today: TodayResponse, lineId: string, done: boolean): TodayResponse {
  const checkin = today.banner.checkin;
  if (!checkin) return today;
  return {
    ...today,
    banner: { ...today.banner, checkin: { ...checkin, items: checkin.items.map((item) => (item.id === lineId ? { ...item, done } : item)) } },
  };
}

/** "Wed 18:00", in the dashboard zone. */
function dayClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "written Wed 18:00", or "updated Fri 18:02" once Hermes revised it. */
export function writtenLine(checkin: Pick<CheckinDto, "createdAt" | "updatedAt">, timeZone: string): string {
  const revised = Date.parse(checkin.updatedAt) - Date.parse(checkin.createdAt) > 60_000;
  return `${revised ? "updated" : "written"} ${dayClock(revised ? checkin.updatedAt : checkin.createdAt, timeZone)}`;
}

/** "Oct 19", the Monday the check-in belongs to. */
function weekLabel(weekOf: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${weekOf}T00:00:00Z`));
}

/**
 * The weekly check-in, first slide while it is up: Hermes's summary and its focus list for the rest of
 * the week. Lines can be checked off here; a line that is one of the cards' checklist items shares that
 * item's check, so it is saved through the item (PATCH /api/items/:id).
 */
export function CheckinSlide({ checkin }: { checkin: CheckinDto }) {
  const { today, timeZone, now, mutate } = useDashboard();
  const [notice, setNotice] = useState<string | null>(null);
  const sprint = today.workingOn.activeSprint;
  const progress = checkin.sprintProgress;

  function toggle(line: CheckinItemDto, done: boolean) {
    const linked = line.checklistItem;
    const request: () => Promise<unknown> = linked
      ? () => {
          const body: UpdateItemRequest = { version: linked.version, done };
          return fetchJson<ChecklistItemDto>(`/api/items/${encodeURIComponent(linked.id)}`, { method: "PATCH", json: body });
        }
      : () => {
          const body: UpdateCheckinItemRequest = { done };
          return fetchJson<CheckinDto>(`/api/checkin/items/${encodeURIComponent(line.id)}`, { method: "PATCH", json: body });
        };
    const update = (current: TodayResponse) => {
      const marked = setCheckinLineDone(current, line.id, done);
      return linked ? setItemDone(marked, linked.cardId, linked.id, done, now) : marked;
    };
    mutate(update, request).then(
      () => setNotice(null),
      (error: unknown) => {
        if (isAbortError(error)) return;
        setNotice(isApiRequestError(error, "CONFLICT") ? "Changed elsewhere — reloaded." : "Couldn't save that. Try again.");
      },
    );
  }

  const open = checkin.items.filter((item) => !item.done).length;

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>{`Weekly check-in · week of ${weekLabel(checkin.weekOf)} · ${writtenLine(checkin, timeZone)}`}</Eyebrow>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {progress && progress.total > 0 ? (
          <span className="font-mono text-[15px] text-text-strong">{`${progress.done} / ${progress.total} items done`}</span>
        ) : null}
        <span className="font-mono text-[13px] text-text-muted">{sprintLine(sprint)}</span>
      </div>
      <p className="m-0 flex max-w-[75ch] items-baseline gap-2.5 text-[16px] leading-[1.45] text-text">
        <ChatIcon className="shrink-0 self-center text-lily-pink" />
        <span>
          <span className="mr-2 font-semibold text-lily-pink">Hermes</span>
          {checkin.summary}
        </span>
      </p>
      {checkin.items.length > 0 ? (
        <section aria-label="Focus for the rest of the week" className="flex flex-col">
          <h3 className="m-0 font-mono text-[11px] tracking-[0.12em] text-text-muted uppercase">
            {`Focus for the rest of the week · ${open} open`}
          </h3>
          <ul className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 md:grid-cols-2">
            {checkin.items.map((line) => (
              <li key={line.id} className="border-b border-[rgba(216,226,220,0.14)]">
                <CheckboxRow checked={line.done} onCheckedChange={(done) => toggle(line, done)}>
                  <span className={line.done ? "line-through" : undefined}>{line.text}</span>
                  {line.checklistItem ? <span className="sr-only"> (also on its card)</span> : null}
                </CheckboxRow>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {notice ? <p role="status" className="m-0 text-[13px] text-amber">{notice}</p> : null}
    </div>
  );
}
