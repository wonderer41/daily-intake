import { useCallback, useSyncExternalStore } from "react";

// How the timeline is drawn on this device. Kept in the browser only (each screen picks its own);
// the server always renders the track, and the saved mode takes over right after hydration.

export type TimelineMode = "track" | "agenda" | "day-bar" | "hours";

export const TIMELINE_MODES: readonly { value: TimelineMode; label: string }[] = [
  { value: "track", label: "Track" },
  { value: "agenda", label: "Agenda" },
  { value: "day-bar", label: "Day bar" },
  { value: "hours", label: "Hours" },
];

const STORAGE_KEY = "daily-intake:timeline-mode";
const DEFAULT_MODE: TimelineMode = "track";
const listeners = new Set<() => void>();
/** Used when storage is blocked (private window, disabled site data): the choice lasts for the visit. */
let memory: TimelineMode | null = null;

export function isTimelineMode(value: unknown): value is TimelineMode {
  return TIMELINE_MODES.some((mode) => mode.value === value);
}

function readMode(): TimelineMode {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isTimelineMode(saved)) return saved;
  } catch {
    // Storage unavailable: fall back to this visit's choice.
  }
  return memory ?? DEFAULT_MODE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useTimelineMode(): [TimelineMode, (mode: TimelineMode) => void] {
  const mode = useSyncExternalStore(subscribe, readMode, () => DEFAULT_MODE);
  const setMode = useCallback((next: TimelineMode) => {
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Kept in memory only.
    }
    for (const listener of listeners) listener();
  }, []);
  return [mode, setMode];
}
