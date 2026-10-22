import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "./cx";

type InputProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

/** Square, depth-tinted fill (80%), ink-light border, JetBrains Mono 15px, color-scheme dark, min-height 44px. */
export function TextInput({ className, ...rest }: InputProps) {
  return <input type="text" className={cx("input", className)} {...rest} />;
}

/** Whole numbers by default (inputMode numeric). Set min/max/step yourself, e.g. 1–720 for a length. */
export function NumberInput({ className, inputMode = "numeric", ...rest }: InputProps) {
  return <input type="number" inputMode={inputMode} className={cx("input", className)} {...rest} />;
}

export interface FieldProps {
  /** Mono 11px uppercase caption, e.g. "Start" or "Length · min". */
  label: ReactNode;
  /** The input (and anything shown beside it, like the "1 h 23 min" echo). */
  children: ReactNode;
  className?: string;
}

/** A <label> wrapping its caption and input, stacked with a 4px gap (as in the scheduling form). */
export function Field({ label, children, className }: FieldProps) {
  return (
    <label className={cx("field", className)}>
      {label}
      {children}
    </label>
  );
}

export interface TimeSelectProps {
  /** "HH:MM", 24-hour. */
  value: string;
  onChange: (value: string) => void;
  /** Names the two dropdowns for screen readers: "Start" → "Start hour", "Start minute". */
  label: string;
  /** Minute step of the minute list (default 5). A value off the step is listed too, so it still shows. */
  minuteStep?: number;
  invalid?: boolean;
  /** Put on the hour dropdown (e.g. for focusing it). */
  name?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 24-hour time as two dropdowns, hour 00–23 and minutes in steps: always 24-hour whatever the
 * browser's language (the native time field shows AM/PM on English-US browsers).
 */
export function TimeSelect({ value, onChange, label, minuteStep = 5, invalid, name }: TimeSelectProps) {
  const [hour = "00", minute = "00"] = value.split(":");
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, index) => pad2(index * minuteStep));
  if (!minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort();
  }
  return (
    <span className="flex items-center gap-1.5">
      <select
        name={name}
        className="input"
        aria-label={`${label} hour`}
        aria-invalid={invalid || undefined}
        value={hour}
        onChange={(event) => onChange(`${event.target.value}:${minute}`)}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={pad2(h)}>
            {pad2(h)}
          </option>
        ))}
      </select>
      <span aria-hidden="true">:</span>
      <select
        className="input"
        aria-label={`${label} minute`}
        aria-invalid={invalid || undefined}
        value={minute}
        onChange={(event) => onChange(`${hour}:${event.target.value}`)}
      >
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </span>
  );
}
