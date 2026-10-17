import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { HermesLogo } from "@/components/ui/hermes-logo";
import { CloseIcon, ExternalIcon, PersonIcon } from "@/components/ui/icons";
import { InnerCard } from "@/components/ui/inner-card";
import { Field, TextInput } from "@/components/ui/inputs";
import { SourceDown } from "@/components/ui/source-down";
import { RailTitle } from "@/components/ui/typography";
import { localDateString } from "@/lib/time/zone";
import type { CreateNoteRequest, NoteDto, NotesDto, SourceStateDto, UpdateNoteRequest } from "@/types/dashboard-contracts";
import { fetchJson } from "../../api";
import { useDashboard } from "../../context";
import { noteLinkError, requestErrorText, seerrSummary, showSeerr, withNoteEdit, withoutNote } from "./format";
import { SeerrBubble } from "./seerr-bubble";

const TEXT_MAX = 200;

export interface NotesPanelProps {
  notes: NotesDto;
  /** sources.seerr: when it is down the Seerr item says so and its count reads "?"; null when Seerr isn't set up. */
  seerr: SourceStateDto | null;
}

/**
 * Notes: small things to remember. Seerr first (with the approve bubble), then the notes, newest
 * first: Gerardo's (add, edit, delete) and Hermes's (delete only; Hermes keeps them up to date).
 */
export function NotesPanel({ notes, seerr }: NotesPanelProps) {
  const { date, now, timeZone, mutate, refresh } = useDashboard();
  const [seerrOpen, setSeerrOpen] = useState(false);
  /** "new", a note id being edited, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addId = useId();
  // A past day is read-only.
  const readOnly = date < localDateString(new Date(now), timeZone);
  const seerrShown = showSeerr(notes, seerr?.ok ?? null, seerrOpen);

  async function add(input: CreateNoteRequest) {
    await fetchJson<NoteDto>("/api/notes", { method: "POST", json: input });
    setEditing(null);
    setError(null);
    await refresh();
  }

  function save(note: NoteDto, input: { text: string; url: string | null }) {
    const body: UpdateNoteRequest = input;
    setEditing(null);
    mutate(
      (today) => withNoteEdit(today, note.id, input),
      () => fetchJson<NoteDto>(`/api/notes/${encodeURIComponent(note.id)}`, { method: "PATCH", json: body }),
    ).then(
      () => setError(null),
      (failure: unknown) => setError(requestErrorText(failure)),
    );
  }

  function remove(note: NoteDto) {
    // The row is about to go; keep keyboard users in the panel.
    document.getElementById(addId)?.focus();
    mutate(
      (today) => withoutNote(today, note.id),
      () => fetchJson<{ deleted: true }>(`/api/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" }),
    ).then(
      () => setError(null),
      (failure: unknown) => setError(requestErrorText(failure)),
    );
  }

  return (
    <GlassPanel pad="rail" aria-label="Notes" className="flex flex-col gap-3">
      <RailTitle>Notes</RailTitle>
      {seerrShown && seerr ? (
        <SeerrItem count={notes.seerrPending} source={seerr} seerrUrl={notes.seerrUrl} open={seerrOpen} onOpenChange={setSeerrOpen} />
      ) : null}
      {notes.items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {notes.items.map((note) => (
            <li key={note.id}>
              {editing === note.id ? (
                <NoteForm
                  label="Edit note"
                  submitLabel="Save"
                  initial={note}
                  onSubmit={async (input) => save(note, input)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <NoteRow note={note} readOnly={readOnly} onEdit={() => setEditing(note.id)} onDelete={() => remove(note)} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {!seerrShown && notes.items.length === 0 && editing !== "new" ? <p className="m-0 text-[15px] text-text-muted">No notes.</p> : null}
      {readOnly ? null : editing === "new" ? (
        <NoteForm label="New note" submitLabel="Add" onSubmit={add} onCancel={() => setEditing(null)} />
      ) : (
        <Button id={addId} variant="ghost" className="self-start" onClick={() => setEditing("new")}>
          + Add note
        </Button>
      )}
      {error ? (
        <p role="status" className="m-0 text-[13px] text-amber">
          {error}
        </p>
      ) : null}
    </GlassPanel>
  );
}

/** 20px person or Hermes logo, with the writer's name for screen readers. */
function Author({ author }: { author: NoteDto["author"] }) {
  const name = author === "user" ? "You" : "Hermes";
  return (
    <span className="mt-0.5 shrink-0 text-text-muted" title={name}>
      {author === "user" ? <PersonIcon size={20} /> : <HermesLogo size={20} />}
      <span className="sr-only">{name}:</span>
    </span>
  );
}

const ICON_BUTTON = "flex size-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-text-muted hover:text-text-strong";

interface NoteRowProps {
  note: NoteDto;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function NoteRow({ note, readOnly, onEdit, onDelete }: NoteRowProps) {
  const mine = note.author === "user";
  const text = <span className="font-semibold break-words text-text-strong">{note.text}</span>;

  // Gerardo's note opens its edit form; Hermes's note is its link (it can't be edited here).
  let body = text;
  if (mine && !readOnly) {
    body = (
      <button type="button" onClick={onEdit} className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-left hover:underline">
        {text}
        <span className="sr-only"> (edit note)</span>
      </button>
    );
  } else if (!mine && note.url) {
    body = (
      <a href={note.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 no-underline hover:underline">
        {text}
        <ExternalIcon size={14} className="shrink-0 text-lilac-text" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }

  return (
    <InnerCard accent={mine ? undefined : "hermes"} className="flex min-w-0 items-start gap-2.5 py-1 pr-1 pl-3.5">
      <span className="flex min-h-11 items-center">
        <Author author={note.author} />
      </span>
      <div className="flex min-w-0 grow flex-col justify-center gap-0.5 self-center py-1.5">
        {body}
        {note.detail ? <span className="text-[13px] break-words text-text-muted">{note.detail}</span> : null}
      </div>
      {note.count !== null ? <span className="flex min-h-11 items-center font-mono text-[15px] text-text-strong">{note.count}</span> : null}
      {mine && note.url ? (
        <a href={note.url} target="_blank" rel="noopener noreferrer" className={ICON_BUTTON}>
          <ExternalIcon size={16} className="text-lilac-text" />
          <span className="sr-only">Open the link for {note.text} (opens in a new tab)</span>
        </a>
      ) : null}
      {readOnly ? null : (
        <button type="button" onClick={onDelete} className={ICON_BUTTON} aria-label={`Delete note: ${note.text}`}>
          <CloseIcon size={16} />
        </button>
      )}
    </InnerCard>
  );
}

interface NoteFormProps {
  /** The form's accessible name, e.g. "New note". */
  label: string;
  submitLabel: string;
  initial?: Pick<NoteDto, "text" | "url">;
  /** Rejects with the server's error to keep the form open with a message. */
  onSubmit: (input: { text: string; url: string | null }) => Promise<void>;
  onCancel: () => void;
}

function NoteForm({ label, submitLabel, initial, onSubmit, onCancel }: NoteFormProps) {
  const textId = useId();
  const [text, setText] = useState(initial?.text ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.getElementById(textId)?.focus();
  }, [textId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    const problem = trimmed === "" ? "Write something first." : noteLinkError(url);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ text: trimmed, url: url.trim() === "" ? null : url.trim() });
    } catch (failure) {
      setError(requestErrorText(failure));
      setSaving(false);
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <form aria-label={label} onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col gap-3">
      <Field label="Note">
        <TextInput id={textId} value={text} maxLength={TEXT_MAX} onChange={(event) => setText(event.target.value)} aria-invalid={error !== null && text.trim() === ""} />
      </Field>
      <Field label="Link · optional">
        <TextInput value={url} inputMode="url" placeholder="https://…" onChange={(event) => setUrl(event.target.value)} aria-invalid={error !== null && noteLinkError(url) !== null} />
      </Field>
      {error ? (
        <p role="status" className="m-0 text-[13px] text-amber">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface SeerrItemProps {
  count: number | null;
  source: SourceStateDto;
  seerrUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The Seerr button card; it opens the bubble with the pending requests right under it. */
function SeerrItem({ count, source, seerrUrl, open, onOpenChange }: SeerrItemProps) {
  const { now, timeZone } = useDashboard();
  const toggleId = useId();
  const bubbleId = useId();

  const close = () => {
    onOpenChange(false);
    // Focus was probably inside the bubble, which is about to unmount.
    document.getElementById(toggleId)?.focus();
  };
  const onToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div className="flex flex-col">
      <InnerCard accent="seerr" className="flex flex-col">
        <button
          id={toggleId}
          type="button"
          aria-expanded={open}
          aria-controls={open ? bubbleId : undefined}
          onClick={() => onOpenChange(!open)}
          onKeyDown={onToggleKeyDown}
          className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-[rgba(8,18,22,0.25)]"
        >
          <span className="flex grow flex-col gap-1">
            <span className="font-semibold text-text-strong">Seerr</span>
            <span className="text-[13px] text-text-muted">{seerrSummary(count)}</span>
          </span>
          <span className="shrink-0 text-[13px] text-reflection">{open ? "Close" : count === 0 ? "" : "Review"}</span>
        </button>
        <SourceDown name="Seerr" verb="checked" source={source} timeZone={timeZone} now={now} className="-mt-1 px-3.5 pb-3" />
      </InnerCard>
      {open ? (
        <div id={bubbleId} className="mt-3">
          <SeerrBubble count={count} seerrUrl={seerrUrl} onClose={close} />
        </div>
      ) : null}
    </div>
  );
}
