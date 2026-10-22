import type { CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { AllDayRow } from "./agenda";
import { type DayWindow, fraction, gapSegments, placeInLanes } from "./layout";
import type { AllDayView, EventCardView, NowCardView, TrackItem } from "./model";

/** Height of one row of blocks; overlapping events stack into more rows. */
const ROW_PX = 52;

function percent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

/**
 * The whole day on one bar: blocks as wide as the events last, free time as coloured stretches
 * underneath, and a "now" line on today. Fits without scrolling, so the day reads at a glance.
 */
export function TimelineDayBar({ allDay, items, window }: { allDay: AllDayView[]; items: TrackItem[]; window: DayWindow }) {
  const events = items.filter((item): item is EventCardView => item.type === "event");
  const placed = placeInLanes(events.map((event) => ({ event, start: Date.parse(event.startsAt), end: Date.parse(event.endsAt) })));
  const rows = Math.max(1, ...placed.map((entry) => entry.lanes));
  const segments = gapSegments(items);
  const now = items.find((item): item is NowCardView => item.type === "now");
  const nowAt = now ? Date.parse(now.at) : null;
  const left = (at: number) => percent(fraction(at, window));
  const width = (start: number, end: number) => percent(fraction(end, window) - fraction(start, window));

  return (
    <div className="tl-daybar">
      <AllDayRow events={allDay} />
      <div className="tl-daybar__frame">
        <div className="tl-daybar__scale" aria-hidden="true">
          {window.hours.map((hour, index) => (
            <span key={hour.at} className="tl-daybar__hour" style={{ left: left(hour.at) }} data-even={index % 2 === 0 || undefined}>
              {hour.label}
            </span>
          ))}
        </div>
        <ol className="tl-daybar__bar" style={{ height: rows * ROW_PX }}>
          {placed.map(({ item, lane }) => {
            const { event } = item;
            const style: CSSProperties = { left: left(item.start), width: width(item.start, item.end), top: lane * ROW_PX };
            return (
              <li
                key={event.id}
                className={cx("tl-daybar__block", event.workBlock && "tl-daybar__block--work-block", event.state === "past" && "tl-daybar__block--past")}
                style={style}
                title={`${event.start}–${event.end} ${event.title}`}
              >
                <span className="tl-daybar__time">
                  <time dateTime={event.startsAt}>{event.start}</time>
                  <span className="sr-only">
                    –<time dateTime={event.endsAt}>{event.end}</time>
                  </span>
                </span>
                <span className="tl-daybar__title">{event.title}</span>
                <span className="sr-only">
                  , {event.source}
                  {event.gap ? `, ${event.gap.description}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="tl-daybar__gaps" aria-hidden="true">
          {segments.map((segment) => (
            <span key={segment.start} className="tl-daybar__gap" data-tone={segment.gap.tone} style={{ left: left(segment.start), width: width(segment.start, segment.end) }}>
              <span className="tl-daybar__gap-label">{segment.gap.label}</span>
            </span>
          ))}
        </div>
        {now && nowAt !== null && nowAt >= window.start && nowAt <= window.end ? (
          <span className="tl-daybar__now" style={{ left: left(nowAt) }}>
            <span className="sr-only">Now, {now.time}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
