import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { GlassPanel } from "@/components/ui/glass-panel";
import { CommitIcon, ExternalIcon, WarningIcon } from "@/components/ui/icons";
import { Eyebrow, RailTitle } from "@/components/ui/typography";
import { localDateString } from "@/lib/time/zone";
import type { AlertDto } from "@/types/dashboard-contracts";
import { fetchJson } from "../../api";
import { type TodayUpdater, useDashboard } from "../../context";
import { ScheduleBubble } from "../../schedule-bubble";
import { cardDisplayTitle, itemName, shortSha } from "../working-on/labels";
import { confirmProgress, dropProgress } from "../working-on/optimistic";
import { blockTag, type ImportantEntry, type ImportantGroup, requestErrorText, withoutAlert } from "./format";

/**
 * Amber panel of things that need Gerardo: critical alerts first, then one group per source (push
 * updates from the cards are the GitHub group). Every entry can be dismissed or acted on. The caller
 * hides the panel when there are no groups.
 */
export function ImportantPanel({ groups }: { groups: ImportantGroup[] }) {
  const { date, now, timeZone, mutate } = useDashboard();
  // One scheduling bubble at a time across the panel. An alert that resolves while its bubble is
  // open simply stops rendering it.
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A past day is read-only.
  const readOnly = date < localDateString(new Date(now), timeZone);

  function run(update: TodayUpdater, url: string) {
    mutate(update, () => fetchJson<unknown>(url, { method: "POST" })).then(
      () => setError(null),
      (failure: unknown) => setError(requestErrorText(failure)),
    );
  }

  return (
    <GlassPanel tone="broken" pad="rail" aria-label="Important" className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5 text-amber">
        <WarningIcon size={18} />
        <RailTitle tone="amber">Important</RailTitle>
      </div>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="flex flex-col gap-2">
          <Eyebrow as="h3" tone={group.key === "critical" ? "reflection" : "muted"}>
            {group.label}
          </Eyebrow>
          <ul className="m-0 flex list-none flex-col p-0">
            {group.entries.map((entry) =>
              entry.kind === "alert" ? (
                <AlertEntry
                  key={entry.alert.id}
                  alert={entry.alert}
                  open={openId === entry.alert.id}
                  readOnly={readOnly}
                  tag={entry.alert.scheduled ? blockTag(entry.alert.scheduled, timeZone, new Date(now)) : null}
                  onToggle={() => setOpenId((current) => (current === entry.alert.id ? null : entry.alert.id))}
                  onClose={() => setOpenId(null)}
                  onDismiss={() => run((today) => withoutAlert(today, entry.alert.id), `/api/alerts/${encodeURIComponent(entry.alert.id)}/dismiss`)}
                />
              ) : (
                <PushEntry
                  key={entry.update.id}
                  entry={entry}
                  readOnly={readOnly}
                  onResolve={(action) => {
                    const { card, item, update } = entry;
                    run(
                      action === "confirm"
                        ? (today) => confirmProgress(today, card.id, item.id, update.id, now)
                        : (today) => dropProgress(today, card.id, item.id, update.id),
                      `/api/items/${encodeURIComponent(item.id)}/progress/${encodeURIComponent(update.id)}/${action}`,
                    );
                  }}
                />
              ),
            )}
          </ul>
        </section>
      ))}
      {error ? (
        <p role="status" className="m-0 text-[13px] text-amber">
          {error}
        </p>
      ) : null}
    </GlassPanel>
  );
}

const ROW = "flex flex-col gap-2.5 border-amber/35 not-first:mt-3 not-first:border-t not-first:pt-3";

/** "Open ↗": where Gerardo acts on it. */
function OpenLink({ url, what }: { url: string; what: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px] text-lilac-text underline-offset-2 hover:text-lily-pink hover:underline"
    >
      Open
      <ExternalIcon size={14} />
      <span className="sr-only"> {what} (opens in a new tab)</span>
    </a>
  );
}

interface AlertEntryProps {
  alert: AlertDto;
  open: boolean;
  readOnly: boolean;
  /** Booked block, e.g. "19:00–20:30". */
  tag: string | null;
  onToggle: () => void;
  onClose: () => void;
  onDismiss: () => void;
}

function AlertEntry({ alert, open, readOnly, tag, onToggle, onClose, onDismiss }: AlertEntryProps) {
  const buttonId = useId();
  const close = () => {
    onClose();
    // The bubble (and whatever had focus in it) is about to unmount; keep keyboard users on the row.
    document.getElementById(buttonId)?.focus();
  };

  return (
    <li className={ROW}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold break-words text-text-strong">{alert.title}</span>
        {alert.detail ? <span className="font-mono text-[12px] break-words text-text-muted">{alert.detail}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {readOnly ? null : (
          <Button id={buttonId} variant="alert" aria-expanded={open} onClick={onToggle}>
            {tag ? "Reschedule" : "Block time"}
          </Button>
        )}
        {tag ? (
          <Chip tone="in-progress">
            <span className="sr-only">Blocked </span>
            {tag}
          </Chip>
        ) : null}
        {alert.url ? <OpenLink url={alert.url} what={alert.title} /> : null}
        {readOnly ? null : (
          <Button variant="ghost" className="ml-auto" onClick={onDismiss}>
            Dismiss<span className="sr-only"> {alert.title}</span>
          </Button>
        )}
      </div>
      {open && !readOnly ? <ScheduleBubble target={{ kind: "alert", alert }} onClose={close} /> : null}
    </li>
  );
}

interface PushEntryProps {
  entry: Extract<ImportantEntry, { kind: "push" }>;
  readOnly: boolean;
  onResolve: (action: "confirm" | "dismiss") => void;
}

/** A push update on a card's item; Confirm and Dismiss are the card's own, so both places change. */
function PushEntry({ entry, readOnly, onResolve }: PushEntryProps) {
  const { card, item, update } = entry;
  const name = itemName(item);
  const looksDone = update.kind === "looks_done";

  return (
    <li className={ROW}>
      <div className="flex min-w-0 items-start gap-2.5">
        <CommitIcon className="mt-1 shrink-0 text-lily-pink" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[12px] text-text-muted">
            {cardDisplayTitle(card)} · {looksDone ? "looks done" : "partial"}
          </span>
          <span className="font-semibold break-words text-text-strong">{name}</span>
          {update.note ? <span className="text-[13px] text-text-muted [overflow-wrap:anywhere]">{update.note}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {looksDone && !readOnly ? (
          <Button size="sm" onClick={() => onResolve("confirm")}>
            Confirm<span className="sr-only"> {name} is done</span>
          </Button>
        ) : null}
        <a
          href={update.commitUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`${update.repoFullName}@${shortSha(update.commitSha)}`}
          className="inline-flex min-h-11 items-center gap-1 px-1 font-mono text-[13px] text-lilac-text underline-offset-2 hover:text-lily-pink hover:underline"
        >
          push {shortSha(update.commitSha)}
          <ExternalIcon size={12} />
          <span className="sr-only"> (opens GitHub in a new tab)</span>
        </a>
        {readOnly ? null : (
          <Button variant="ghost" className="ml-auto" onClick={() => onResolve("dismiss")}>
            Dismiss<span className="sr-only"> push update for {name}</span>
          </Button>
        )}
      </div>
    </li>
  );
}
