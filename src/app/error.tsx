"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { RailTitle } from "@/components/ui/typography";

interface ErrorPageProps {
  error: unknown;
  /** Re-fetches and re-renders the page (Next 16's error boundary API). */
  retry: () => void;
}

/**
 * Any page error other than a database outage (which src/app/page.tsx shows as "Database
 * unavailable"). In production Next hides the message; the digest matches the server log line.
 */
export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <main className="mx-auto box-border flex max-w-[1360px] flex-col gap-7 px-[clamp(16px,4vw,48px)] pt-10 pb-14">
      <GlassPanel tone="broken" pad="rail" aria-labelledby="error-title" className="flex max-w-[640px] flex-col gap-4">
        <RailTitle id="error-title" tone="amber">
          Something went wrong
        </RailTitle>
        <p className="m-0 text-[15px] leading-relaxed text-text">The page couldn&apos;t load. Trying again usually fixes it.</p>
        {digest ? <p className="m-0 font-mono text-[12px] leading-normal text-text-muted">Error {digest}</p> : null}
        <div>
          <Button variant="alert" onClick={retry}>
            Try again
          </Button>
        </div>
      </GlassPanel>
    </main>
  );
}
