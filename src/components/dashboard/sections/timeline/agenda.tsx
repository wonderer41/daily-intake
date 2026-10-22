import { Fragment } from "react";
import { Chip } from "@/components/ui/chip";
import { cx } from "@/components/ui/cx";
import type { AllDayView, GapView, TrackItem } from "./model";

/** The all-day events as chips above the agenda, the day bar and the hour grid. */
export function AllDayRow({ events }: { events: AllDayView[] }) {
  if (events.length === 0) return null;
  const done = events.every((event) => event.state === "past");
  return (
    <div className={cx("tl-all-day-row", done && "tl-item--done")}>
      <p className="tl-all-day__label">{done ? "all day · done" : "all day"}</p>
      <ul className="tl-all-day-row__list">
        {events.map((event) => (
          <li key={event.id}>
            <Chip tone="open" className="tl-chip" title={event.title}>
              {event.title}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GapRow({ gap }: { gap: GapView }) {
  return (
    <li className="tl-agenda__gap" data-tone={gap.tone}>
      <span aria-hidden="true" className="tl-agenda__gap-line" />
      <span aria-hidden="true">{gap.minutes < 0 ? "overlap" : `${gap.label} free`}</span>
      <span className="sr-only">{gap.description}</span>
    </li>
  );
}

/** One row per event, top to bottom, with the free time between them in the gap colours. */
export function TimelineAgenda({ allDay, items }: { allDay: AllDayView[]; items: TrackItem[] }) {
  return (
    <div className="tl-agenda">
      <AllDayRow events={allDay} />
      <ol className="tl-agenda__list">
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.type === "now" ? (
              <li className="tl-agenda__row tl-agenda__row--now" aria-current="time">
                <span className="tl-agenda__time">
                  <time dateTime={item.at}>{item.time}</time>
                </span>
                <span className="tl-agenda__title">Now</span>
              </li>
            ) : (
              <li className={cx("tl-agenda__row", item.workBlock && "tl-agenda__row--work-block", item.state === "past" && "tl-agenda__row--past")}>
                <span className="tl-agenda__time">
                  <time dateTime={item.startsAt}>{item.start}</time>–<time dateTime={item.endsAt}>{item.end}</time>
                </span>
                <span className="tl-agenda__title">{item.title}</span>
                <span className="tl-source">· {item.source}</span>
              </li>
            )}
            {item.gap ? <GapRow gap={item.gap} /> : null}
          </Fragment>
        ))}
      </ol>
    </div>
  );
}
