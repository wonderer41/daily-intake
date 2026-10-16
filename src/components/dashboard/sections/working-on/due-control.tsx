import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "@/components/ui/icons";
import { isDateString } from "@/lib/time/zone";

export interface DueControlProps {
  /** The deadline set on this card or item itself (YYYY-MM-DD), or null. */
  value: string | null;
  /** What it is for, read out with the button: "#13 Streak tracking", "orphan-cleanup". */
  name: string;
  onChange: (next: string | null) => void;
}

/**
 * "Due" button that opens a native date field in place. Picking a date saves it; Clear removes it;
 * Esc or Cancel closes without saving. Focus moves to the field on open and back to the button on close.
 */
export function DueControl({ value, name, onChange }: DueControlProps) {
  const [open, setOpen] = useState(false);
  const closedRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const inputId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) closedRef.current?.querySelector("button")?.focus();
    wasOpen.current = open;
  }, [open]);

  const save = (next: string | null) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <span ref={closedRef} className="contents">
        <Button variant="ghost" aria-expanded={false} onClick={() => setOpen(true)}>
          <CalendarIcon size={15} />
          Due
          <span className="sr-only"> date for {name}</span>
        </Button>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" onKeyDown={onKeyDown}>
      <label htmlFor={inputId} className="sr-only">
        Due date for {name}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="date"
        className="input"
        defaultValue={value ?? ""}
        onChange={(event) => {
          if (isDateString(event.target.value)) save(event.target.value);
        }}
      />
      {value ? (
        <Button variant="ghost" onClick={() => save(null)}>
          Clear<span className="sr-only"> due date for {name}</span>
        </Button>
      ) : null}
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
