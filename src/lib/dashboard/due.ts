import { dateOnly, toDbDate } from "./dto";

// Deadlines on cards and checklist items: a local date (YYYY-MM-DD) stored in a @db.Date column.

/** The stored value for an input date; null clears it. */
export function toDueOn(value: string | null): Date | null {
  return value === null ? null : toDbDate(value);
}

/** True when the input would change the stored date (undefined = leave it alone). */
export function dueOnChanged(stored: Date | null, input: string | null | undefined): boolean {
  if (input === undefined) return false;
  return (stored === null ? null : dateOnly(stored)) !== input;
}

export function dueOnDto(stored: Date | null): string | null {
  return stored === null ? null : dateOnly(stored);
}
