import { useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { AutoScroller, HOLD_AFTER_INPUT_MS } from "./motion";

export interface AutoScrollControls {
  /** Attach to the scroll container (its first <ol> holds the cards). */
  viewportRef: RefObject<HTMLDivElement | null>;
  earlier: () => void;
  later: () => void;
  /** Arrow keys step one card; Home / End go to the ends. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  /** Press, move and release with the mouse to drag the track. Touch and trackpads keep scrolling natively. */
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
  /** Put both on the section so keyboard focus anywhere inside (arrows or track) pauses the drift. */
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
}

/** On the viewport while the mouse drags it (see timeline.css). */
const DRAGGING_CLASS = "is-dragging";

/**
 * Where the track opens: on today, the card just before "now" sits at the left edge, so what is on
 * and what comes next are in view; earlier cards are an "Earlier" away. Other days open at the start.
 */
function startOffset(viewport: HTMLElement): number {
  const nowCard = viewport.querySelector<HTMLElement>('[aria-current="time"]');
  if (!nowCard) return 0;
  const anchor = nowCard.previousElementSibling instanceof HTMLElement ? nowCard.previousElementSibling : nowCard;
  return anchor.offsetLeft;
}

/**
 * One AutoScroller per mounted track. `resetKey` (the day shown) starts the track over (see startOffset);
 * `active` is false while there is no track (empty day).
 */
export function useAutoScroll(resetKey: string, active: boolean): AutoScrollControls {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<AutoScroller | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!active || !element) return;
    element.scrollLeft = startOffset(element);
    // Opened on "now": let it be read before the drift (and the loop back to the start) moves it.
    const scroller = new AutoScroller(element, element.scrollLeft > 0 ? HOLD_AFTER_INPUT_MS : 0);
    scrollerRef.current = scroller;
    return () => {
      scroller.dispose();
      if (scrollerRef.current === scroller) scrollerRef.current = null;
    };
  }, [resetKey, active]);

  const earlier = useCallback(() => scrollerRef.current?.step(-1), []);
  const later = useCallback(() => scrollerRef.current?.step(1), []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (event.key === "ArrowLeft") scroller.step(-1);
    else if (event.key === "ArrowRight") scroller.step(1);
    else if (event.key === "Home") scroller.toEdge("start");
    else if (event.key === "End") scroller.toEdge("end");
    else return;
    event.preventDefault();
  }, []);

  // Touch has no hover; a finger on the track shows up as a manual scroll, which holds the drift instead.
  const onPointerEnter = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") scrollerRef.current?.setHovered(true);
  }, []);
  const onPointerLeave = useCallback(() => scrollerRef.current?.setHovered(false), []);

  // Mouse drag. The pointer is captured, so the drag keeps going if the mouse leaves the track while
  // pressed. The class (set on the element, not in React state, so no re-render per move) switches the
  // cursor to "grabbing" and stops the drag from selecting card text.
  const dragPointer = useRef<number | null>(null);
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !scrollerRef.current) return;
    dragPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add(DRAGGING_CLASS);
    scrollerRef.current.beginDrag(event.clientX);
  }, []);
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (dragPointer.current === event.pointerId) scrollerRef.current?.dragTo(event.clientX);
  }, []);
  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (dragPointer.current !== event.pointerId) return;
    dragPointer.current = null;
    event.currentTarget.classList.remove(DRAGGING_CLASS);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scrollerRef.current?.endDrag();
  }, []);

  // Only keyboard focus pauses: a mouse click on Earlier / Later leaves focus on the button, and that
  // should hold the drift for 10 s, not stop it until the next click elsewhere.
  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) scrollerRef.current?.setFocused(true);
  }, []);
  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    scrollerRef.current?.setFocused(false);
  }, []);

  return {
    viewportRef,
    earlier,
    later,
    onKeyDown,
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onFocus,
    onBlur,
  };
}
