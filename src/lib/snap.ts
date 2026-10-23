import { EDGE_MARGIN, GRID, TOP_MARGIN, type DesktopPrefs, type Rect } from "./desktop";

/** A line the window just snapped to, drawn while dragging. */
export interface Guide {
  axis: "x" | "y";
  at: number;
}

export interface SnapTargets {
  /** Vertical lines window edges stick to. */
  xs: number[];
  /** Horizontal lines window edges stick to. */
  ys: number[];
  /** Where a window's centre sticks, if enabled. */
  center: { x: number; y: number } | null;
}

/** Which edges a resize moves. */
export interface ResizeEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

export interface SnapResult {
  rect: Rect;
  guides: Guide[];
}

/** The work area's edges, inset by the margins, plus its centre. */
export function snapTargets(area: Rect, prefs: DesktopPrefs): SnapTargets {
  return {
    xs: [area.x + EDGE_MARGIN, area.x + area.w - EDGE_MARGIN],
    ys: [TOP_MARGIN, area.y + area.h - EDGE_MARGIN],
    center: prefs.snapCenter ? { x: area.x + area.w / 2, y: area.y + area.h / 2 } : null,
  };
}

interface Line {
  value: number;
  targets: number[];
  apply: (delta: number) => void;
}

/** Shifts the closest line within reach onto its target; otherwise rounds to the grid when asked. */
function snapAxis(lines: Line[], prefs: DesktopPrefs, onSnap: (at: number) => void, onGrid: () => void) {
  let best: { line: Line; target: number; delta: number } | null = null;
  if (prefs.snap) {
    for (const line of lines) {
      for (const target of line.targets) {
        const delta = target - line.value;
        if (Math.abs(delta) <= prefs.snapDistance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { line, target, delta };
      }
    }
  }
  if (best) {
    best.line.apply(best.delta);
    onSnap(best.target);
  } else if (prefs.grid) {
    onGrid();
  }
}

const toGrid = (value: number) => Math.round(value / GRID) * GRID;

/**
 * Moving: the edges stick to the edge targets and the centre to the centre target.
 * Resizing: only the edges being dragged stick, to the edge targets.
 */
export function snapRect(rect: Rect, edges: ResizeEdges | "move", targets: SnapTargets, prefs: DesktopPrefs): SnapResult {
  const out = { ...rect };
  const guides: Guide[] = [];
  if (!prefs.snap && !prefs.grid) return { rect: out, guides };
  const move = edges === "move";

  const linesX: Line[] = move
    ? [
        { value: rect.x, targets: targets.xs, apply: (d) => (out.x += d) },
        { value: rect.x + rect.w, targets: targets.xs, apply: (d) => (out.x += d) },
        ...(targets.center ? [{ value: rect.x + rect.w / 2, targets: [targets.center.x], apply: (d: number) => (out.x += d) }] : []),
      ]
    : [
        ...(edges.left ? [{ value: rect.x, targets: targets.xs, apply: (d: number) => ((out.x += d), (out.w -= d)) }] : []),
        ...(edges.right ? [{ value: rect.x + rect.w, targets: targets.xs, apply: (d: number) => (out.w += d) }] : []),
      ];
  const linesY: Line[] = move
    ? [
        { value: rect.y, targets: targets.ys, apply: (d) => (out.y += d) },
        { value: rect.y + rect.h, targets: targets.ys, apply: (d) => (out.y += d) },
        ...(targets.center ? [{ value: rect.y + rect.h / 2, targets: [targets.center.y], apply: (d: number) => (out.y += d) }] : []),
      ]
    : [
        ...(edges.top ? [{ value: rect.y, targets: targets.ys, apply: (d: number) => ((out.y += d), (out.h -= d)) }] : []),
        ...(edges.bottom ? [{ value: rect.y + rect.h, targets: targets.ys, apply: (d: number) => (out.h += d) }] : []),
      ];

  snapAxis(
    linesX,
    prefs,
    (at) => guides.push({ axis: "x", at }),
    () => {
      if (move) out.x = toGrid(out.x);
      else if (edges.left) {
        const right = out.x + out.w;
        out.x = toGrid(out.x);
        out.w = right - out.x;
      } else if (edges.right) out.w = toGrid(out.x + out.w) - out.x;
    },
  );
  snapAxis(
    linesY,
    prefs,
    (at) => guides.push({ axis: "y", at }),
    () => {
      if (move) out.y = toGrid(out.y);
      else if (edges.top) {
        const bottom = out.y + out.h;
        out.y = toGrid(out.y);
        out.h = bottom - out.y;
      } else if (edges.bottom) out.h = toGrid(out.y + out.h) - out.y;
    },
  );

  return { rect: out, guides };
}
