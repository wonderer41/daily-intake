import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { SprintDto } from "@/types/dashboard-contracts";
import { fetchJson, isApiRequestError } from "../../api";
import { useDashboard } from "../../context";
import { sprintLine } from "./labels";

/** "Oct 26 – Nov 8" from two YYYY-MM-DD dates. */
function dateRange(sprint: Pick<SprintDto, "startsOn" | "endsOn">): string {
  const day = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00Z`));
  return `${day(sprint.startsOn)} – ${day(sprint.endsOn)}`;
}

/**
 * The sprint line in the Working-on header, as a button: it lists the planned sprints, and starting
 * one (after "Start X? This ends Y.") makes it the active sprint. Sprints are planned through Hermes.
 */
export function SprintSwitcher({ activeSprint }: { activeSprint: SprintDto | null }) {
  const { refresh } = useDashboard();
  const [open, setOpen] = useState(false);
  const [planned, setPlanned] = useState<SprintDto[] | null>(null);
  const [confirming, setConfirming] = useState<SprintDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchJson<{ data: SprintDto[] }>("/api/sprints?status=planned").then(
      (reply) => !cancelled && setPlanned(reply.data),
      () => !cancelled && setError("Couldn't load the planned sprints."),
    );
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setPlanned(null);
    setConfirming(null);
    setError(null);
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    close();
    buttonRef.current?.focus();
  };

  async function start(sprint: SprintDto) {
    setBusy(true);
    setError(null);
    try {
      await fetchJson<SprintDto>(`/api/sprints/${encodeURIComponent(sprint.id)}`, { method: "PATCH", json: { version: sprint.version, status: "active" } });
      await refresh();
      close();
      buttonRef.current?.focus();
    } catch (caught) {
      setError(isApiRequestError(caught, "CONFLICT") ? "That sprint changed meanwhile. Open the list again." : "Couldn't start it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="wo-sprint" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="wo-sprint__button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {sprintLine(activeSprint)}
        <ChevronDownIcon size={12} />
        <span className="sr-only"> (switch sprint)</span>
      </button>
      {open ? (
        <div id={panelId} className="wo-sprint__panel glass-panel" role="group" aria-label="Switch sprint">
          <p className="wo-sprint__heading">Planned</p>
          {planned === null && !error ? <p className="wo-sprint__note">Loading…</p> : null}
          {planned?.length === 0 ? <p className="wo-sprint__note">No planned sprints. Ask Hermes to plan one.</p> : null}
          {planned && planned.length > 0 ? (
            <ul className="wo-sprint__list">
              {planned.map((sprint) => (
                <li key={sprint.id}>
                  <button type="button" className="wo-sprint__option" aria-pressed={confirming?.id === sprint.id} onClick={() => setConfirming(sprint)}>
                    <span>{sprint.name}</span>
                    <span className="wo-sprint__dates">{dateRange(sprint)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {confirming ? (
            <div className="wo-sprint__confirm">
              <p className="m-0">
                Start {confirming.name}?{activeSprint ? ` This ends ${activeSprint.name}.` : ""}
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void start(confirming)}>
                  {busy ? "Starting…" : "Start"}
                </Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="wo-add-form__error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
