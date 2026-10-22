import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Field, TextInput } from "@/components/ui/inputs";
import type { ChecklistItemDto, SprintDto, WorkCardDto } from "@/types/dashboard-contracts";
import { fetchJson, isApiRequestError } from "../../api";
import { useDashboard } from "../../context";

export type AddKind = "card" | "item";

const KINDS: readonly { kind: AddKind; label: string }[] = [
  { kind: "card", label: "Card" },
  { kind: "item", label: "Item" },
];

/** The server's reason, or a plain fallback; a 400 names the field it didn't like. */
function errorText(error: unknown): string {
  if (isApiRequestError(error) && error.status > 0 && error.status < 500) return error.message;
  return "Couldn't save it. Check your connection and try again.";
}

/** "+ Add ▾" in the Working-on header: pick what to add, then its form opens under the header. */
export function AddMenu({ onPick }: { onPick: (kind: AddKind) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>("[data-add-kind]")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>("[aria-controls]")?.focus();
  };

  return (
    <div ref={rootRef} className="wo-add" onKeyDown={onKeyDown}>
      <Button variant="ghost" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>
        + Add
        <ChevronDownIcon size={14} />
      </Button>
      {open ? (
        <ul id={menuId} className="wo-add__menu glass-panel" aria-label="Add">
          {KINDS.map(({ kind, label }) => (
            <li key={kind}>
              <button
                type="button"
                data-add-kind={kind}
                className="wo-add__option"
                onClick={() => {
                  setOpen(false);
                  onPick(kind);
                }}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface AddCardFormProps {
  activeSprint: SprintDto | null;
  onDone: (createdCardId: string | null) => void;
}

/** New card: title, optional repo (owner/repo) and deadline. It joins the active sprint, at the end. */
export function AddCardForm({ activeSprint, onDone }: AddCardFormProps) {
  const { refresh } = useDashboard();
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const card = await fetchJson<WorkCardDto>("/api/cards", {
        method: "POST",
        json: { title, repoFullName: repo.trim() || null, dueOn: dueOn || null, sprintId: activeSprint?.id ?? null },
      });
      await refresh();
      onDone(card.id);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  };

  return (
    <form className="wo-add-form inner-card" aria-label="Add a card" onSubmit={submit} onKeyDown={(event) => event.key === "Escape" && onDone(null)}>
      <div className="wo-add-form__fields">
        <Field label="Title" className="grow">
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} autoFocus />
        </Field>
        <Field label="Repo · optional">
          <TextInput value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/repo" maxLength={200} spellCheck={false} />
        </Field>
        <Field label="Deadline · optional">
          <input type="date" className="input" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="wo-add-form__error">
          {error}
        </p>
      ) : null}
      <div className="wo-add-form__actions">
        <Button type="submit" size="sm" disabled={busy || title.trim() === ""}>
          {busy ? "Creating…" : "Create card"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <span className="wo-add-form__hint">{activeSprint ? `Joins ${activeSprint.name}.` : "No active sprint: it won't be in one."}</span>
      </div>
    </form>
  );
}

export interface AddItemFormProps {
  cards: WorkCardDto[];
  /** The card the item goes to at first (the open one). */
  initialCardId: string | null;
  onAdded: (cardId: string) => void;
  onDone: () => void;
}

/** New checklist item on any card. Stays open after adding, for the next one; Done closes it. */
export function AddItemForm({ cards, initialCardId, onAdded, onDone }: AddItemFormProps) {
  const { refresh } = useDashboard();
  const [cardId, setCardId] = useState(initialCardId ?? cards[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  if (cards.length === 0) {
    return (
      <div className="wo-add-form inner-card">
        <p className="m-0 text-[14px] text-text-muted">Add a card first: items live on cards.</p>
        <div className="wo-add-form__actions">
          <Button variant="secondary" size="sm" onClick={onDone}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<ChecklistItemDto>(`/api/cards/${encodeURIComponent(cardId)}/items`, { method: "POST", json: { title } });
      await refresh();
      onAdded(cardId);
      const card = cards.find((entry) => entry.id === cardId);
      setStatus({ error: false, text: `Added to ${card ? card.title : "the card"}.` });
      setTitle("");
      titleRef.current?.focus();
    } catch (caught) {
      setStatus({ error: true, text: errorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="wo-add-form inner-card" aria-label="Add an item" onSubmit={submit} onKeyDown={(event) => event.key === "Escape" && onDone()}>
      <div className="wo-add-form__fields">
        <Field label="Card">
          <select className="input" value={cardId} onChange={(event) => setCardId(event.target.value)}>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Item" className="grow">
          <input ref={titleRef} type="text" className="input" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus />
        </Field>
      </div>
      {status ? (
        <p role={status.error ? "alert" : "status"} className={status.error ? "wo-add-form__error" : "wo-add-form__hint"}>
          {status.text}
        </p>
      ) : null}
      <div className="wo-add-form__actions">
        <Button type="submit" size="sm" disabled={busy || title.trim() === ""}>
          {busy ? "Adding…" : "Add item"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </form>
  );
}
