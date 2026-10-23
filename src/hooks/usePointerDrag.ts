import { useRef, type PointerEvent } from "react";

export interface PointerDragHandlers<T> {
  /** Called on press; returning null ignores the gesture. */
  onStart: (event: PointerEvent) => T | null;
  onMove: (delta: { dx: number; dy: number }, start: T, event: PointerEvent) => void;
  onEnd: (start: T, moved: boolean) => void;
}

/**
 * Left-button drag on an element, with pointer capture so the release arrives even when the
 * pointer leaves it (same pattern as the dock's push-to-talk). Spread the result on the handle.
 */
export function usePointerDrag<T>(handlers: PointerDragHandlers<T>) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const gesture = useRef<{ id: number; x: number; y: number; start: T; moved: boolean } | null>(null);

  const end = (event: PointerEvent) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    latest.current.onEnd(current.start, current.moved);
  };

  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || gesture.current) return;
      const start = latest.current.onStart(event);
      if (start === null) return;
      // Prevents text selection and focus changes while dragging.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start, moved: false };
    },
    onPointerMove: (event: PointerEvent) => {
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
