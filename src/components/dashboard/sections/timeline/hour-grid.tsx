import { useEffect, useRef } from "react";
import { cx } from "@/components/ui/cx";
import { AllDayRow } from "./agenda";
import { type DayWindow, fraction, placeInLanes } from "./layout";
import type { AllDayView, EventCardView, NowCardView, TrackItem } from "./model";

/** Height of one hour on the grid. */
const HOUR_PX = 56;
/** Shortest block drawn, so a 10-minute event still shows its time. */
const MIN_BLOCK_PX = 26;

function percent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

/**
 * A day view like a calendar app: hours down the side, events placed by time, overlapping events
 * side by side. Scrolls inside its own frame and opens an hour before now (or the first event).
 */
export function TimelineHourGrid({ allDay, items, window, date }: { allDay: AllDayView[]; items: TrackItem[]; window: DayWindow; date: string }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const events = items.filter((item): item is EventCardView => item.type === "event");
  const placed = placeInLanes(events.map((event) => ({ event, start: Date.parse(event.startsAt), end: Date.parse(event.endsAt) })));
  const now = items.find((item): item is NowCardView => item.type === "now");
  const nowAt = now ? Date.parse(now.at) : null;
  const height = (window.hours.length - 1) * HOUR_PX;
  const top = (at: number) => fraction(at, window) * height;
  const focusAt = nowAt ?? placed[0]?.item.start ?? null;

  // Open on the interesting part of the day, once per day shown (the user's own scrolling stays).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || focusAt === null) return;
    frame.scrollTop = Math.max(0, top(focusAt) - HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the day changes
  }, [date]);

  return (
    <div className="tl-grid">
      <AllDayRow events={allDay} />
      <div ref={frameRef} className="tl-grid__frame" role="region" aria-label="Timeline hours" tabIndex={0}>
        <div className="tl-grid__inner" style={{ height }}>
          <div className="tl-grid__hours" aria-hidden="true">
            {window.hours.map((hour) => (
              <span key={hour.at} className="tl-grid__hour" style={{ top: top(hour.at) }}>
                <span className="tl-grid__hour-label">{hour.label}</span>
              </span>
            ))}
          </div>
          <ol className="tl-grid__events">
            {placed.map(({ item, lane, lanes }) => {
              const { event } = item;
              const blockTop = top(item.start);
              const blockHeight = Math.max(MIN_BLOCK_PX, top(item.end) - blockTop);
              return (
                <li
                  key={event.id}
                  className={cx(
                    "tl-grid__block",
                    event.workBlock && "tl-grid__block--work-block",
                    event.state === "past" && "tl-grid__block--past",
                    blockHeight < 48 && "tl-grid__block--short",
                  )}
                  // Side-by-side blocks keep 3px between them.
                  style={{ top: blockTop, height: blockHeight, left: percent(lane / lanes), width: `calc(${percent(1 / lanes)} - 3px)` }}
                  title={`${event.start}–${event.end} ${event.title}`}
                >
                  <span className="tl-grid__time">
                    <time dateTime={event.startsAt}>{event.start}</time>–<time dateTime={event.endsAt}>{event.end}</time>
                  </span>
                  <span className="tl-grid__title">{event.title}</span>
                  <span className="sr-only">
                    , {event.source}
                    {event.gap ? `, ${event.gap.description}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          {now && nowAt !== null && nowAt >= window.start && nowAt <= window.end ? (
            <span className="tl-grid__now" style={{ top: top(nowAt) }}>
              <span className="tl-grid__now-label">{now.time}</span>
              <span className="sr-only">Now, {now.time}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
