import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canMaximize,
  cascadeRect,
  centerRect,
  clampRect,
  DEFAULT_DESKTOP,
  parseDesktop,
  maximizedArea,
  tileRects,
  WINDOW_SPECS,
  type DesktopGroup,
  type DesktopPrefs,
  type Rect,
  type WindowKind,
} from "../lib/desktop";
import { useStoredState } from "../lib/storage";

export interface DesktopWindow {
  kind: WindowKind;
  /** Where it is drawn: the work area while maximised. */
  rect: Rect;
  /** Its own geometry, restored when it stops being maximised. */
  restore: Rect;
  maximized: boolean;
  /** Stacking order, 0 = bottom. */
  z: number;
}

export type ArrangeMode = "tile" | "cascade" | "center";

export interface Desktop {
  windows: DesktopWindow[];
  /** The front window, unless the empty desktop was clicked since: then none. */
  focused: WindowKind | null;
  prefs: DesktopPrefs;
  /** Single instance per kind: opening an open window brings it to the front. */
  open: (kind: WindowKind) => void;
  close: (kind: WindowKind) => void;
  focus: (kind: WindowKind) => void;
  /** No window focused (a click on the empty desktop); the next click or open focuses again. */
  blur: () => void;
  /** Clamped to the viewport; snapping is the caller's job. */
  setRect: (kind: WindowKind, rect: Rect) => void;
  arrange: (mode: ArrangeMode) => void;
  closeAll: () => void;
  /** Closes every widget or every app. */
  closeGroup: (group: DesktopGroup) => void;
  /** Apps only: fill the work area, or go back to their own size. */
  toggleMaximize: (kind: WindowKind) => void;
  unmaximize: (kind: WindowKind) => void;
  setPrefs: (change: (prefs: DesktopPrefs) => DesktopPrefs) => void;
}

const STORAGE_KEY = "jarvis.desktop";

const viewport = () => ({ vw: window.innerWidth, vh: window.innerHeight });

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Open windows, their geometry and the desktop preferences, persisted in localStorage.
 * `taskbar`: the top bar is on, so maximised apps stop below it.
 */
export function useDesktop({ taskbar = false }: { taskbar?: boolean } = {}): Desktop {
  const [state, setState] = useStoredState(STORAGE_KEY, DEFAULT_DESKTOP, parseDesktop);
  // Maximised windows follow the viewport.
  const [size, setSize] = useState(viewport);
  const [blurred, setBlurred] = useState(false);

  // Keeps every open window inside the current viewport (the stored one may have been larger).
  const clampAll = useCallback(() => {
    const { vw, vh } = viewport();
    setSize((current) => (current.vw === vw && current.vh === vh ? current : { vw, vh }));
    setState((current) => {
      let changed = false;
      const rects = { ...current.rects };
      current.order.forEach((kind, index) => {
        const rect = rects[kind];
        const next = rect ? clampRect(rect, WINDOW_SPECS[kind], vw, vh) : cascadeRect(kind, index, vw, vh);
        if (!rect || !sameRect(rect, next)) {
          rects[kind] = next;
          changed = true;
        }
      });
      return changed ? { ...current, rects } : current;
    });
  }, [setState]);

  useEffect(() => {
    clampAll();
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(clampAll);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [clampAll]);

  const open = useCallback(
    (kind: WindowKind) => {
      const { vw, vh } = viewport();
      setBlurred(false);
      setState((current) => {
        const others = current.order.filter((item) => item !== kind);
        const stored = current.rects[kind];
        const rect = stored ? clampRect(stored, WINDOW_SPECS[kind], vw, vh) : cascadeRect(kind, current.order.length, vw, vh);
        return { ...current, order: [...others, kind], rects: { ...current.rects, [kind]: rect } };
      });
    },
    [setState],
  );

  const close = useCallback(
    (kind: WindowKind) =>
      setState((current) => (current.order.includes(kind) ? { ...current, order: current.order.filter((item) => item !== kind) } : current)),
    [setState],
  );

  const focus = useCallback(
    (kind: WindowKind) => {
      setBlurred(false);
      setState((current) => {
        if (!current.order.includes(kind) || current.order[current.order.length - 1] === kind) return current;
        return { ...current, order: [...current.order.filter((item) => item !== kind), kind] };
      });
    },
    [setState],
  );

  const blur = useCallback(() => setBlurred(true), []);

  const setRect = useCallback(
    (kind: WindowKind, rect: Rect) => {
      const { vw, vh } = viewport();
      setState((current) => ({ ...current, rects: { ...current.rects, [kind]: clampRect(rect, WINDOW_SPECS[kind], vw, vh) } }));
    },
    [setState],
  );

  const arrange = useCallback(
    (mode: ArrangeMode) => {
      const { vw, vh } = viewport();
      setState((current) => {
        if (!current.order.length) return current;
        const rects = { ...current.rects };
        // Arranging gives every window its own size back.
        const maximized = current.maximized.filter((kind) => !current.order.includes(kind));
        if (mode === "tile") {
          tileRects(current.order, vw, vh).forEach((rect, index) => (rects[current.order[index]] = rect));
        } else if (mode === "cascade") {
          current.order.forEach((kind, index) => (rects[kind] = cascadeRect(kind, index, vw, vh)));
        } else {
          current.order.forEach((kind) => {
            const rect = rects[kind] ?? cascadeRect(kind, 0, vw, vh);
            rects[kind] = clampRect(centerRect(rect, vw, vh), WINDOW_SPECS[kind], vw, vh);
          });
        }
        return { ...current, rects, maximized };
      });
    },
    [setState],
  );

  const closeAll = useCallback(() => setState((current) => (current.order.length ? { ...current, order: [] } : current)), [setState]);

  const closeGroup = useCallback(
    (group: DesktopGroup) =>
      setState((current) => {
        const order = current.order.filter((kind) => WINDOW_SPECS[kind].group !== group);
        return order.length === current.order.length ? current : { ...current, order };
      }),
    [setState],
  );

  const toggleMaximize = useCallback(
    (kind: WindowKind) => {
      if (!canMaximize(kind)) return;
      setBlurred(false);
      setState((current) => {
        const maximized = current.maximized.includes(kind)
          ? current.maximized.filter((item) => item !== kind)
          : [...current.maximized, kind];
        const order = current.order.includes(kind) ? [...current.order.filter((item) => item !== kind), kind] : current.order;
        return { ...current, maximized, order };
      });
    },
    [setState],
  );

  const unmaximize = useCallback(
    (kind: WindowKind) =>
      setState((current) =>
        current.maximized.includes(kind) ? { ...current, maximized: current.maximized.filter((item) => item !== kind) } : current,
      ),
    [setState],
  );

  const setPrefs = useCallback(
    (change: (prefs: DesktopPrefs) => DesktopPrefs) => setState((current) => ({ ...current, prefs: change(current.prefs) })),
    [setState],
  );

  const windows = useMemo(
    () =>
      state.order.flatMap((kind, z) => {
        const restore = state.rects[kind];
        if (!restore) return [];
        const maximized = state.maximized.includes(kind);
        return [{ kind, rect: maximized ? maximizedArea(size.vw, size.vh, taskbar) : restore, restore, maximized, z }];
      }),
    [state.order, state.rects, state.maximized, size, taskbar],
  );

  const focused = !blurred && state.order.length ? state.order[state.order.length - 1] : null;
  return useMemo(
    () => ({ windows, focused, prefs: state.prefs, open, close, focus, blur, setRect, arrange, closeAll, closeGroup, toggleMaximize, unmaximize, setPrefs }),
    [windows, focused, state.prefs, open, close, focus, blur, setRect, arrange, closeAll, closeGroup, toggleMaximize, unmaximize, setPrefs],
  );
}
