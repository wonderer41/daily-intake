import { useId } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { SourceDown } from "@/components/ui/source-down";
import { SectionTitle } from "@/components/ui/typography";
import type { SourceStateDto, TimelineResponse } from "@/types/dashboard-contracts";
import { useDashboard } from "../context";
import { TimelineAgenda } from "./timeline/agenda";
import { TimelineDayBar } from "./timeline/day-bar";
import { TimelineHourGrid } from "./timeline/hour-grid";
import { dayWindow } from "./timeline/layout";
import { GapLegend } from "./timeline/legend";
import { buildTimelineView } from "./timeline/model";
import { TIMELINE_MODES, useTimelineMode } from "./timeline/mode";
import { TimelineTrack } from "./timeline/track";
import { useAutoScroll } from "./timeline/use-auto-scroll";
import "./timeline.css";

export interface TimelineProps {
  timeline: TimelineResponse;
  /** ISO time, ticks every minute: the now marker and past/current/future dimming. */
  now: string;
  /** The day shown (YYYY-MM-DD, dashboard zone). */
  date: string;
  /** Calendar health: render <SourceDown name="Calendar" …> when it isn't ok. */
  calendar: SourceStateDto;
}

function countLabel(count: number, today: boolean): string {
  const events = `${count} ${count === 1 ? "event" : "events"}`;
  return `calendar · ${today ? `${events} today` : events}`;
}

/**
 * The day's calendar, sitting on the painting (no glass panel), in one of four modes this device
 * remembers. Track (the default): cards on a line with the gaps above it, a dashed lilac "now" card,
 * all-day chips first; it drifts left at ~12px/s and loops, and Earlier / Later, arrow keys, touch
 * and trackpad scroll it too. Agenda: one row per event. Day bar: the whole day on one proportional
 * bar. Hours: a calendar-style day grid, overlapping events side by side.
 */
export function Timeline({ timeline, now, date, calendar }: TimelineProps) {
  const { timeZone } = useDashboard();
  const view = buildTimelineView(timeline, now, date, timeZone);
  const isToday = view.relation === "today";
  const empty = view.eventCount === 0;
  const [mode, setMode] = useTimelineMode();
  const track = mode === "track";
  const { viewportRef, earlier, later, onKeyDown, onPointerEnter, onPointerLeave, onFocus, onBlur } = useAutoScroll(date, track && !empty);

  const titleId = useId();
  const trackId = useId();
  const hintId = useId();

  return (
    <section className="tl" aria-labelledby={titleId} onFocus={onFocus} onBlur={onBlur}>
      <div className="tl-head">
        <div className="tl-head__title">
          <SectionTitle id={titleId} size={36}>
            Timeline
          </SectionTitle>
          <span className="tl-head__meta">{countLabel(view.eventCount, isToday)}</span>
        </div>
        <div className="tl-head__tools">
          <SegmentedControl label="Timeline view" options={TIMELINE_MODES} value={mode} onChange={setMode} />
          {mode === "hours" ? null : <GapLegend />}
          {empty || !track ? null : (
            <div className="tl-head__arrows">
              <Button variant="icon" aria-label="Earlier events" aria-controls={trackId} onClick={earlier}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="icon" aria-label="Later events" aria-controls={trackId} onClick={later}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </div>
      </div>

      <SourceDown name="Calendar" source={calendar} timeZone={timeZone} now={now} className="tl-source-down" />

      {empty ? (
        <p className="tl-empty">{isToday ? "No events today." : "No events this day."}</p>
      ) : mode === "agenda" ? (
        <TimelineAgenda allDay={view.allDay} items={view.items} />
      ) : mode === "day-bar" ? (
        <TimelineDayBar allDay={view.allDay} items={view.items} window={dayWindow(date, timeZone, timeline.events)} />
      ) : mode === "hours" ? (
        <TimelineHourGrid allDay={view.allDay} items={view.items} window={dayWindow(date, timeZone, timeline.events)} date={date} />
      ) : (
        <div
          ref={viewportRef}
          id={trackId}
          className="tl-viewport"
          role="region"
          aria-label="Timeline events"
          aria-describedby={hintId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          <TimelineTrack allDay={view.allDay} items={view.items} />
        </div>
      )}
      {empty || !track ? null : (
        <span id={hintId} className="sr-only">
          Left and right arrow keys step one card; Home and End go to the first and last.
        </span>
      )}
    </section>
  );
}
