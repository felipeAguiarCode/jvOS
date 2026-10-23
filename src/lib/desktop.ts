import { AudioLines, BatteryMedium, Calculator, CassetteTape, Clock, Disc3, FileCode, FileText, SquareTerminal, Timer, type LucideIcon } from "lucide-react";
import { DOCK_RESERVE } from "./layout";

/** Everything that can open as a window over the hologram. */
export type WindowKind = "clock" | "pomodoro" | "battery" | "calculator" | "tape" | "miniplayer" | "markdown" | "code" | "music" | "shell";
export const WINDOW_KINDS: WindowKind[] = ["clock", "pomodoro", "battery", "calculator", "tape", "miniplayer", "markdown", "code", "music", "shell"];

export interface Size {
  w: number;
  h: number;
}

/** Window geometry in CSS pixels from the top-left of the viewport. */
export interface Rect extends Size {
  x: number;
  y: number;
}

export type SnapDistance = 8 | 14 | 24;
export const SNAP_DISTANCES: SnapDistance[] = [8, 14, 24];

export type WindowStyle = "tui" | "holo";

export interface DesktopPrefs {
  /** "tui": borderless terminal-style windows (sway + TUI apps); "holo": glowing glass panels. */
  windowStyle: WindowStyle;
  /** Windows stick to the screen edges while dragged. */
  snap: boolean;
  snapDistance: SnapDistance;
  /** …and to the centre of the area above the dock. */
  snapCenter: boolean;
  /** Positions round to an 8 px grid when nothing else snaps. */
  grid: boolean;
  /** Opacity of the window panels, 0.6..1. */
  opacity: number;
}

export const DEFAULT_PREFS: DesktopPrefs = { windowStyle: "tui", snap: true, snapDistance: 14, snapCenter: true, grid: false, opacity: 0.85 };

/** Persisted desktop (`jarvis.desktop`): open windows in z-order and the last geometry of each kind. */
export interface DesktopState {
  version: 1;
  /** Kept after a window closes, so it reopens where it was. When maximised: the size to restore. */
  rects: Partial<Record<WindowKind, Rect>>;
  /** Open windows, bottom to top. Being listed here is being open. */
  order: WindowKind[];
  /** Apps filling the work area (kept across closing and reopening, like a window manager). */
  maximized: WindowKind[];
  prefs: DesktopPrefs;
}

export const DEFAULT_DESKTOP: DesktopState = { version: 1, rects: {}, order: [], maximized: [], prefs: DEFAULT_PREFS };

/** Widgets (small tools) or apps (the editors); each has its own dock item. */
export type DesktopGroup = "widgets" | "apps";

export interface WindowSpec {
  title: string;
  icon: LucideIcon;
  size: Size;
  min: Size;
  group: DesktopGroup;
}

export const WINDOW_SPECS: Record<WindowKind, WindowSpec> = {
  clock: { title: "Relógio", icon: Clock, size: { w: 300, h: 160 }, min: { w: 220, h: 120 }, group: "widgets" },
  pomodoro: { title: "Pomodoro", icon: Timer, size: { w: 300, h: 250 }, min: { w: 260, h: 220 }, group: "widgets" },
  battery: { title: "Bateria", icon: BatteryMedium, size: { w: 300, h: 150 }, min: { w: 220, h: 120 }, group: "widgets" },
  calculator: { title: "Calculadora", icon: Calculator, size: { w: 300, h: 420 }, min: { w: 260, h: 360 }, group: "widgets" },
  // jv_T4p3's widgets: the cassette alone, and the controls alone.
  tape: { title: "Fita", icon: Disc3, size: { w: 380, h: 250 }, min: { w: 260, h: 180 }, group: "widgets" },
  miniplayer: { title: "Mini player", icon: AudioLines, size: { w: 360, h: 150 }, min: { w: 300, h: 140 }, group: "widgets" },
  markdown: { title: "Jarvis Mark", icon: FileText, size: { w: 880, h: 560 }, min: { w: 480, h: 300 }, group: "apps" },
  code: { title: "Jarvis Code", icon: FileCode, size: { w: 760, h: 520 }, min: { w: 420, h: 280 }, group: "apps" },
  music: { title: "jv_T4p3", icon: CassetteTape, size: { w: 920, h: 620 }, min: { w: 660, h: 480 }, group: "apps" },
  shell: { title: "jv_sh", icon: SquareTerminal, size: { w: 900, h: 540 }, min: { w: 480, h: 300 }, group: "apps" },
};

/** Apps maximise (button, double click on the title bar); widgets keep their size. */
export const canMaximize = (kind: WindowKind) => WINDOW_SPECS[kind].group === "apps";

/** The invisible strip that drags the Tauri window: nothing under it receives clicks. */
export const TOP_SAFE = 28;
/** The optional top bar takes exactly that strip. */
export const TASKBAR_HEIGHT = TOP_SAFE;
/** Snap/clamp inset at the top (strip + a little air). */
export const TOP_MARGIN = 32;
/** Snap inset at the other edges. */
export const EDGE_MARGIN = 16;
/** A window can never leave less than this on screen, in either axis. */
export const MIN_VISIBLE = 48;
export const GRID = 8;
const CASCADE_ORIGIN = { x: 24, y: 40 };
const CASCADE_STEP = 32;

/** The screen minus the drag strip and the dock. */
export function workArea(vw: number, vh: number): Rect {
  return { x: 0, y: TOP_SAFE, w: vw, h: Math.max(0, vh - DOCK_RESERVE - TOP_SAFE) };
}

/** A maximised app: the whole screen, over the dock too; below the top bar when it is on. */
export function maximizedArea(vw: number, vh: number, taskbar: boolean): Rect {
  const top = taskbar ? TASKBAR_HEIGHT : 0;
  return { x: 0, y: top, w: vw, h: vh - top };
}

/** Size between the spec's minimum and the viewport; title bar below the strip; part of it always on screen. */
export function clampRect(rect: Rect, spec: WindowSpec, vw: number, vh: number): Rect {
  const w = Math.round(Math.min(Math.max(rect.w, spec.min.w), Math.max(spec.min.w, vw)));
  const h = Math.round(Math.min(Math.max(rect.h, spec.min.h), Math.max(spec.min.h, vh - TOP_SAFE)));
  const x = Math.round(Math.min(Math.max(rect.x, MIN_VISIBLE - w), vw - MIN_VISIBLE));
  const y = Math.round(Math.min(Math.max(rect.y, TOP_SAFE), vh - MIN_VISIBLE));
  return { x, y, w, h };
}

/** Default place for a new window: a cascade from the top-left corner, away from the hologram. */
export function cascadeRect(kind: WindowKind, slot: number, vw: number, vh: number): Rect {
  const spec = WINDOW_SPECS[kind];
  const area = workArea(vw, vh);
  const bottom = area.y + area.h - EDGE_MARGIN;
  const fit = Math.max(1, Math.floor((bottom - CASCADE_ORIGIN.y - spec.size.h) / CASCADE_STEP) + 1);
  const step = slot % fit;
  return clampRect({ x: CASCADE_ORIGIN.x + step * CASCADE_STEP, y: CASCADE_ORIGIN.y + step * CASCADE_STEP, ...spec.size }, spec, vw, vh);
}

/** Side by side: a grid of equal cells over the work area, in the order given. */
export function tileRects(kinds: WindowKind[], vw: number, vh: number): Rect[] {
  const area = workArea(vw, vh);
  const count = kinds.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const top = TOP_MARGIN;
  const cellW = (area.w - EDGE_MARGIN * (cols + 1)) / cols;
  const cellH = (area.y + area.h - EDGE_MARGIN - top - EDGE_MARGIN * (rows - 1)) / rows;
  return kinds.map((kind, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const rect = { x: EDGE_MARGIN + col * (cellW + EDGE_MARGIN), y: top + row * (cellH + EDGE_MARGIN), w: cellW, h: cellH };
    return clampRect(rect, WINDOW_SPECS[kind], vw, vh);
  });
}

/** Centred on the work area (the hologram's own centre line). */
export function centerRect(rect: Rect, vw: number, vh: number): Rect {
  const area = workArea(vw, vh);
  return { ...rect, x: area.x + (area.w - rect.w) / 2, y: area.y + (area.h - rect.h) / 2 };
}

export function isWindowKind(value: unknown): value is WindowKind {
  return typeof value === "string" && (WINDOW_KINDS as string[]).includes(value);
}

const isKind = isWindowKind;

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const { x, y, w, h } = value as Record<string, unknown>;
  return [x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Accepts a stored desktop, dropping anything unknown or malformed instead of failing. */
export function parseDesktop(raw: unknown): DesktopState | null {
  if (!raw || typeof raw !== "object") return null;
  const { rects, order, maximized, prefs } = raw as Record<string, unknown>;

  const cleanRects: DesktopState["rects"] = {};
  if (rects && typeof rects === "object") {
    for (const [kind, rect] of Object.entries(rects)) {
      if (isKind(kind) && isRect(rect)) cleanRects[kind] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    }
  }

  const cleanOrder: WindowKind[] = [];
  if (Array.isArray(order)) {
    for (const kind of order) {
      if (isKind(kind) && !cleanOrder.includes(kind)) cleanOrder.push(kind);
    }
  }

  const p = (prefs && typeof prefs === "object" ? prefs : {}) as Partial<Record<keyof DesktopPrefs, unknown>>;
  const cleanPrefs: DesktopPrefs = {
    // "sway" was the bordered predecessor of "tui".
    windowStyle: p.windowStyle === "holo" ? "holo" : DEFAULT_PREFS.windowStyle,
    snap: typeof p.snap === "boolean" ? p.snap : DEFAULT_PREFS.snap,
    snapDistance: (SNAP_DISTANCES as number[]).includes(p.snapDistance as number) ? (p.snapDistance as SnapDistance) : DEFAULT_PREFS.snapDistance,
    snapCenter: typeof p.snapCenter === "boolean" ? p.snapCenter : DEFAULT_PREFS.snapCenter,
    grid: typeof p.grid === "boolean" ? p.grid : DEFAULT_PREFS.grid,
    opacity: typeof p.opacity === "number" && p.opacity >= 0.6 && p.opacity <= 1 ? p.opacity : DEFAULT_PREFS.opacity,
  };

  const cleanMaximized = Array.isArray(maximized) ? WINDOW_KINDS.filter((kind) => maximized.includes(kind) && canMaximize(kind)) : [];

  return { version: 1, rects: cleanRects, order: cleanOrder, maximized: cleanMaximized, prefs: cleanPrefs };
}
