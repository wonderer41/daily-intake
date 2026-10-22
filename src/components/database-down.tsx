"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { RailTitle } from "@/components/ui/typography";
import { formatClock } from "@/lib/time/zone";

/** How often the page asks /api/health whether the database is back. */
export const HEALTH_POLL_MS = 30_000;

export interface DatabaseDownProps {
  /** Heading parts for the day the page was asked for, e.g. "Thursday" and "October 22". */
  weekday: string;
  monthDay: string;
  timeZone: string;
  /** When the server found the database down (ISO); the first "Last checked" time. */
  checkedAt: string;
}

/**
 * Shown instead of the dashboard while the database is unreachable (src/app/page.tsx decides).
 * It polls /api/health and reloads the page as soon as the database answers again, so a tab left
 * open recovers on its own; "Try now" checks right away.
 */
export function DatabaseDown({ weekday, monthDay, timeZone, checkedAt }: DatabaseDownProps) {
  const [lastChecked, setLastChecked] = useState(() => new Date(checkedAt));
  const [checking, setChecking] = useState(false);
  // Only a check the user asked for is announced; the automatic ones stay quiet for screen readers.
  const [announcement, setAnnouncement] = useState("");
  const inFlight = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    let back = false;
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      back = response.ok;
    } catch {
      // The app itself is unreachable too: same as "still down".
    }
    if (back) {
      window.location.reload();
      return;
    }
    const now = new Date();
    setLastChecked(now);
    if (manual) setAnnouncement(`Still can't reach the database (checked ${formatClock(now, timeZone)}).`);
    setChecking(false);
    inFlight.current = false;
  }, [timeZone]);

  useEffect(() => {
    const timer = window.setInterval(() => void check(false), HEALTH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  return (
    <main className="mx-auto box-border flex max-w-[1360px] flex-col gap-7 px-[clamp(16px,4vw,48px)] pt-10 pb-14">
      <Header weekday={weekday} eyebrow={monthDay} />
      <GlassPanel tone="broken" pad="rail" aria-labelledby="database-down-title" className="flex max-w-[640px] flex-col gap-4">
        <RailTitle id="database-down-title" tone="amber">
          Database unavailable
        </RailTitle>
        <p className="m-0 text-[15px] leading-relaxed text-text">
          The dashboard can&apos;t reach its database. It reloads by itself when the database is back.
        </p>
        <p className="m-0 font-mono text-[12px] leading-normal text-text-muted">
          {checking ? "Checking…" : `Last checked ${formatClock(lastChecked, timeZone)} · checking every ${HEALTH_POLL_MS / 1000} s`}
        </p>
        <div>
          <Button variant="alert" onClick={() => void check(true)} disabled={checking}>
            Try now
          </Button>
        </div>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </GlassPanel>
    </main>
  );
}
