"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PaletteIcon } from "@/components/ui/icons";
import { BACKGROUNDS, THEMES, type TokenName } from "@/lib/appearance/themes";
import type { AppearanceDto } from "@/types/dashboard-contracts";
import { fetchJson } from "./api";
import { useDashboard } from "./context";
import "./appearance-picker.css";

/** The four colours a theme swatch shows: ground, actions, Hermes, gold. */
const SWATCH: readonly TokenName[] = ["pond", "lilac", "lily-pink", "reflection"];

/**
 * The header's Appearance button: a panel with the themes and backgrounds. A choice applies at
 * once (optimistic) and is saved for every device; the live stream switches other open screens.
 */
export function AppearancePicker() {
  const { today, mutate } = useDashboard();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme, background } = today.appearance;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const choose = (change: Partial<AppearanceDto>) => {
    setError(null);
    mutate(
      (data) => ({ ...data, appearance: { ...data.appearance, ...change } }),
      () => fetchJson<AppearanceDto>("/api/appearance", { method: "PUT", json: change }),
    ).catch(() => setError("Couldn't save that. The page is back to the saved look."));
  };

  return (
    <div className="appearance">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--icon"
        aria-label="Appearance"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <PaletteIcon size={20} />
      </button>
      {open ? (
        <div ref={panelRef} id={panelId} role="dialog" aria-label="Appearance" className="glass-panel appearance__panel">
          <fieldset className="appearance__group">
            <legend className="appearance__legend">Theme</legend>
            {THEMES.map((option) => (
              <label key={option.id} className="appearance__option">
                <input
                  type="radio"
                  name={`${panelId}-theme`}
                  value={option.id}
                  checked={option.id === theme}
                  onChange={() => choose({ theme: option.id })}
                  className="sr-only"
                />
                <span aria-hidden="true" className="appearance__swatch">
                  {SWATCH.map((token) => (
                    <span key={token} style={{ background: option.colors[token] }} />
                  ))}
                </span>
                {option.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="appearance__group">
            <legend className="appearance__legend">Background</legend>
            {BACKGROUNDS.map((option) => (
              <label key={option.id} className="appearance__option">
                <input
                  type="radio"
                  name={`${panelId}-background`}
                  value={option.id}
                  checked={option.id === background}
                  onChange={() => choose({ background: option.id })}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className="appearance__thumb"
                  style={option.images ? { backgroundImage: `url("${option.images.thumb}")` } : undefined}
                />
                {option.images ? option.label : `${option.label} (theme colour)`}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="appearance__error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
