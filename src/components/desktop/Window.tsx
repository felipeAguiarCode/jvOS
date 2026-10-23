import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { usePointerDrag } from "../../hooks/usePointerDrag";
import { WINDOW_SPECS, type Rect, type WindowKind, type WindowStyle } from "../../lib/desktop";
import type { ResizeEdges } from "../../lib/snap";

export interface WindowProps {
  kind: WindowKind;
  /** Where it is drawn (the work area while maximised). */
  rect: Rect;
  /** Its own size, which a drag out of the maximised state goes back to. */
  restore: Rect;
  z: number;
  focused: boolean;
  /** Apps only: a maximise button, and a double click on the title bar toggles it. */
  maximizable: boolean;
  maximized: boolean;
  /** Opacity of the panel behind the content, 0.6..1. */
  opacity: number;
  onFocus: () => void;
  onClose: () => void;
  onToggleMaximize: () => void;
  /** Dragged out of the maximised state. */
  onUnmaximize: () => void;
  /** The geometry the pointer asks for; the desktop snaps and clamps it. */
  onDrag: (candidate: Rect, edges: ResizeEdges | "move") => void;
  onDragEnd: () => void;
  /** Terminal-style apps: glow, aberration and accent (Advanced menu → TUI). */
  surface?: { className: string; style?: CSSProperties };
  /** "tui": borderless, like a terminal app (name in reverse video); "holo": glowing glass. */
  chrome?: WindowStyle;
  children: ReactNode;
}

/** A maximised window stays put until the pointer really moves (a double click must not restore it). */
const DETACH_DISTANCE = 6;

interface MoveGesture {
  rect: Rect;
  pointerX: number;
  /** Where on the title bar it was grabbed, 0..1 of the width. */
  grab: number;
  /** Still maximised: the first real movement restores it under the pointer. */
  docked: boolean;
}

interface Handle {
  id: string;
  edges: ResizeEdges;
  className: string;
}

/** Six-pixel strips straddling the border, corners on top of them. */
const HANDLES: Handle[] = [
  { id: "n", edges: { top: true }, className: "-top-[3px] right-3 left-3 h-[6px] cursor-ns-resize" },
  { id: "s", edges: { bottom: true }, className: "right-3 -bottom-[3px] left-3 h-[6px] cursor-ns-resize" },
  { id: "e", edges: { right: true }, className: "top-3 -right-[3px] bottom-3 w-[6px] cursor-ew-resize" },
  { id: "w", edges: { left: true }, className: "top-3 bottom-3 -left-[3px] w-[6px] cursor-ew-resize" },
  { id: "ne", edges: { top: true, right: true }, className: "-top-[3px] -right-[3px] size-3 cursor-nesw-resize" },
  { id: "nw", edges: { top: true, left: true }, className: "-top-[3px] -left-[3px] size-3 cursor-nwse-resize" },
  { id: "se", edges: { bottom: true, right: true }, className: "-right-[3px] -bottom-[3px] size-3 cursor-nwse-resize" },
  { id: "sw", edges: { bottom: true, left: true }, className: "-bottom-[3px] -left-[3px] size-3 cursor-nesw-resize" },
];

/**
 * A desktop window: title bar that drags, edges that resize, Ctrl+W closes. Positioned with
 * left/top (motion owns the transform for the enter/exit animation); while nobody is dragging,
 * geometry changes (snap release, arranging) ease into place.
 */
export function Window({
  kind,
  rect,
  restore,
  z,
  focused,
  maximizable,
  maximized,
  opacity,
  onFocus,
  onClose,
  onToggleMaximize,
  onUnmaximize,
  onDrag,
  onDragEnd,
  surface,
  chrome = "tui",
  children,
}: WindowProps) {
  const root = useRef<HTMLElement>(null);
  const [interacting, setInteracting] = useState(false);
  const spec = WINDOW_SPECS[kind];
  const tui = chrome === "tui";
  // Widgets speak for themselves: their bar only drags and closes. Apps keep their name.
  const named = spec.group === "apps";
  const Icon = spec.icon;

  const begin = () => {
    onFocus();
    root.current?.focus({ preventScroll: true });
    setInteracting(true);
    return rect;
  };
  const end = () => {
    setInteracting(false);
    onDragEnd();
  };

  const move = usePointerDrag<MoveGesture>({
    onStart: (event) => {
      begin();
      return { rect, pointerX: event.clientX, grab: (event.clientX - rect.x) / rect.w, docked: maximized };
    },
    onMove: ({ dx, dy }, start) => {
      if (start.docked) {
        if (Math.hypot(dx, dy) < DETACH_DISTANCE) return;
        // Like a window manager: back to its own size, still under the pointer at the same spot.
        start.docked = false;
        start.rect = { ...restore, x: start.pointerX - start.grab * restore.w, y: rect.y };
        onUnmaximize();
      }
      onDrag({ ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }, "move");
    },
    onEnd: end,
  });

  const toggleFromTitle = (event: MouseEvent) => {
    if (!maximizable || event.button !== 0) return;
    onToggleMaximize();
  };

  const resize = (edges: ResizeEdges, dx: number, dy: number, start: Rect) => {
    let { x, y, w, h } = start;
    if (edges.right) w = Math.max(spec.min.w, start.w + dx);
    if (edges.bottom) h = Math.max(spec.min.h, start.h + dy);
    if (edges.left) {
      w = Math.max(spec.min.w, start.w - dx);
      x = start.x + start.w - w;
    }
    if (edges.top) {
      h = Math.max(spec.min.h, start.h - dy);
      y = start.y + start.h - h;
    }
    onDrag({ x, y, w, h }, edges);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // In a terminal Ctrl+W belongs to the shell (bash deletes a word); the × closes.
    if ((event.target as Element).closest("[data-terminal]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <motion.section
      ref={root}
      role="dialog"
      aria-label={spec.title}
      tabIndex={-1}
      data-window={kind}
      data-chrome={chrome}
      data-focused={focused || undefined}
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onPointerDownCapture={() => {
        if (!focused) onFocus();
      }}
      onKeyDown={onKeyDown}
      style={{ ...surface?.style, left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z + 1 }}
      className={`pointer-events-auto absolute outline-none select-none ${surface?.className ?? ""} ${
        interacting ? "" : "transition-[left,top,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      }`}
    >
      <div
        className={`absolute inset-0 flex flex-col overflow-hidden ${
          tui
            ? // A TUI: no border, no rounding; the window you are not in just dims a little.
              `transition-opacity duration-200 ${focused ? "" : "opacity-80"}`
            : `border ${maximized ? "rounded-none border-x-0" : "rounded-xl"} ${
                focused
                  ? "border-hud-cyan/35 shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_0_30px_color-mix(in_oklab,var(--color-hud-cyan)_4%,transparent)]"
                  : "border-hud-cyan/15 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
              }`
        }`}
      >
        <div
          aria-hidden
          className={`absolute inset-0 ${tui ? "backdrop-blur-sm" : "backdrop-blur-md"}`}
          // Fullscreen hides what is behind (the dock) almost completely.
          style={{ backgroundColor: `color-mix(in oklab, var(--color-hud-panel) ${Math.round((maximized ? Math.max(opacity, 0.95) : opacity) * 100)}%, transparent)` }}
        />
        {focused && !tui && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-hud-light/40 to-transparent"
          />
        )}
        {tui ? (
          // The first line of the terminal: the name in reverse video, lit when focused.
          <header
            {...move}
            onDoubleClick={toggleFromTitle}
            title={maximizable ? "Duplo clique para maximizar ou restaurar" : undefined}
            className="relative flex h-6 shrink-0 cursor-grab touch-none items-center gap-2 pr-1 font-mono text-[11px] active:cursor-grabbing"
          >
            {named && (
              <span
                className={`flex h-full items-center gap-1.5 px-2.5 font-semibold transition-colors ${
                  focused ? "bg-hud-light/85 text-hud-void" : "bg-hud-text/12 text-hud-text/60"
                }`}
              >
                <Icon size={11} strokeWidth={2} aria-hidden />
                {spec.title}
              </span>
            )}
            <span className="flex-1" />
            {maximizable && (
              <TitleButton tui label={`${maximized ? "Restaurar" : "Maximizar"} ${spec.title}`} onClick={onToggleMaximize}>
                {maximized ? <Minimize2 size={12} strokeWidth={1.8} /> : <Maximize2 size={12} strokeWidth={1.8} />}
              </TitleButton>
            )}
            <TitleButton tui label={`Fechar ${spec.title}`} onClick={onClose}>
              <X size={13} strokeWidth={1.8} />
            </TitleButton>
          </header>
        ) : (
          <header
            {...move}
            onDoubleClick={toggleFromTitle}
            title={maximizable ? "Duplo clique para maximizar ou restaurar" : undefined}
            className="relative flex h-8 shrink-0 cursor-grab touch-none items-center gap-2 border-b border-hud-cyan/10 pr-1 pl-3 active:cursor-grabbing"
          >
            {named && <Icon size={13} strokeWidth={1.6} aria-hidden className={focused ? "text-hud-light/90" : "text-hud-text/50"} />}
            <span className={`flex-1 truncate text-[10px] font-semibold tracking-[0.28em] uppercase ${focused ? "text-hud-light" : "text-hud-text/50"}`}>
              {named && spec.title}
            </span>
            {maximizable && (
              <TitleButton label={`${maximized ? "Restaurar" : "Maximizar"} ${spec.title}`} onClick={onToggleMaximize}>
                {maximized ? <Minimize2 size={13} strokeWidth={1.6} /> : <Maximize2 size={13} strokeWidth={1.6} />}
              </TitleButton>
            )}
            <TitleButton label={`Fechar ${spec.title}`} onClick={onClose}>
              <X size={14} strokeWidth={1.6} />
            </TitleButton>
          </header>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden @container">{children}</div>
      </div>
      {!maximized && HANDLES.map((handle) => <ResizeHandle key={handle.id} handle={handle} onStart={begin} onMove={resize} onEnd={end} />)}
    </motion.section>
  );
}

/** Title bar buttons are not drag handles, and a double click on them toggles nothing. */
function TitleButton({ label, onClick, tui = false, children }: { label: string; onClick: () => void; tui?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`grid cursor-pointer place-items-center text-hud-text/60 outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
        tui ? "h-5 w-6 hover:bg-hud-light/85 hover:text-hud-void" : "size-7 rounded-lg hover:bg-hud-cyan/10 hover:text-hud-light"
      }`}
    >
      {children}
    </button>
  );
}

function ResizeHandle({
  handle,
  onStart,
  onMove,
  onEnd,
}: {
  handle: Handle;
  onStart: () => Rect;
  onMove: (edges: ResizeEdges, dx: number, dy: number, start: Rect) => void;
  onEnd: () => void;
}) {
  const drag = usePointerDrag<Rect>({
    onStart,
    onMove: ({ dx, dy }, start) => onMove(handle.edges, dx, dy, start),
    onEnd,
  });
  return <div {...drag} aria-hidden data-testid={`resize-${handle.id}`} className={`absolute touch-none ${handle.className}`} />;
}
