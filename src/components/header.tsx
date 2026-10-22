import type { ReactNode } from "react";
import { SourceLegend } from "./source-legend";

export interface HeaderProps {
  /** The weekday of the day the page shows, e.g. "Monday": the page's heading. */
  weekday: string;
  /** The date above it, e.g. "October 12" (shown in capitals). */
  eyebrow: string;
  /** Muted live-status bits next to the date ("Reconnecting…", "Back to today"). */
  status?: ReactNode;
  /** Buttons after the source legend (the Appearance picker). */
  actions?: ReactNode;
}

export function Header({ weekday, eyebrow, status, actions }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="m-0 font-mono text-[12px] leading-normal tracking-[0.16em] text-reflection uppercase">{eyebrow}</p>
          {status}
        </div>
        <h1 className="m-0 font-display text-[clamp(44px,6vw,72px)] leading-[0.95] font-semibold tracking-[-0.015em] text-text-strong">
          {weekday}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SourceLegend />
        {actions}
      </div>
    </header>
  );
}
