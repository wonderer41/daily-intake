/** Minutes in a local day. */
export const DAY_MINUTES = 24 * 60;

export interface BusyRange {
  /** Local minutes after midnight. */
  start: number;
  end: number;
}

/**
 * Next free slot of `durationMin` at or after `fromMin`, or null when none is left before midnight.
 * Powers the conflict reply's "Use 20:30" button, on the page and on the server.
 */
export function findFree(fromMin: number, durationMin: number, events: readonly BusyRange[]): number | null {
  let t = fromMin;
  for (const ev of [...events].sort((a, b) => a.start - b.start)) {
    if (ev.end <= t) continue;
    if (ev.start >= t + durationMin) return t;
    t = Math.max(t, ev.end);
  }
  return t + durationMin <= DAY_MINUTES ? t : null;
}
