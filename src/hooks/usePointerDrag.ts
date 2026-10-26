import { useRef, type PointerEvent } from "react";

export interface PointerDragHandlers<T> {
  /** Called when the drag starts; returning null ignores the gesture. */
  onStart: (event: PointerEvent) => T | null;
  onMove: (delta: { dx: number; dy: number }, start: T, event: PointerEvent) => void;
  onEnd: (start: T, moved: boolean) => void;
  /**
   * Pixels the pointer must travel before the drag starts. Until then the press is left alone, so
   * a click on a button inside the handle stays a click (once dragging, the capture sends the
   * release's click to the handle, not the button); controls that use the pointer themselves
   * (sliders, fields) never start one.
   */
  threshold?: number;
}

const OWN_POINTER = "input, textarea, select, [contenteditable], [role=slider]";

/**
 * Left-button drag on an element, with pointer capture so the release arrives even when the
 * pointer leaves it (same pattern as the dock's push-to-talk). Spread the result on the handle.
 */
export function usePointerDrag<T>(handlers: PointerDragHandlers<T>) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const gesture = useRef<{ id: number; x: number; y: number; start: T; moved: boolean } | null>(null);
  // A press still under the threshold.
  const press = useRef<{ id: number; x: number; y: number } | null>(null);

  const begin = (event: PointerEvent, x: number, y: number) => {
    const start = latest.current.onStart(event);
    if (start === null) return;
    // Prevents text selection and focus changes while dragging.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, x, y, start, moved: false };
  };

  const end = (event: PointerEvent) => {
    if (press.current?.id === event.pointerId) press.current = null;
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    latest.current.onEnd(current.start, current.moved);
  };

  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || gesture.current) return;
      if (!latest.current.threshold) begin(event, event.clientX, event.clientY);
      else if (!(event.target as Element).closest(OWN_POINTER)) press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: PointerEvent) => {
      const pressed = press.current;
      if (pressed?.id === event.pointerId) {
        // Let go outside the element: the release never came here.
        if (!(event.buttons & 1)) press.current = null;
        else if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) >= latest.current.threshold!) {
          press.current = null;
          begin(event, pressed.x, pressed.y);
        }
      }
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (dx || dy) current.moved = true;
      latest.current.onMove({ dx, dy }, current.start, event);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
