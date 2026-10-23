import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Desktop as DesktopApi } from "../../hooks/useDesktop";
import type { MusicPlayer } from "../../hooks/useMusicPlayer";
import type { Pomodoro as PomodoroTimer } from "../../hooks/usePomodoro";
import { canMaximize, workArea, type Rect, type WindowKind } from "../../lib/desktop";
import type { TuiSurface } from "../../lib/tui";
import { snapRect, snapTargets, type Guide, type ResizeEdges } from "../../lib/snap";
import { Battery } from "./widgets/Battery";
import { Calculator } from "./widgets/Calculator";
import { Clock } from "./widgets/Clock";
import { MiniPlayer } from "./widgets/MiniPlayer";
import { Pomodoro } from "./widgets/Pomodoro";
import { TapeWidget } from "./widgets/TapeWidget";
import { Window } from "./Window";

// The editors (CodeMirror, Markdown) load on first use, not with the hologram.
const MarkdownEditor = lazy(() => import("./apps/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));
const CodeEditor = lazy(() => import("./apps/CodeEditor").then((module) => ({ default: module.CodeEditor })));
const TapePlayer = lazy(() => import("./apps/TapePlayer").then((module) => ({ default: module.TapePlayer })));
const ShellApp = lazy(() => import("./apps/ShellApp").then((module) => ({ default: module.ShellApp })));

interface DesktopProps {
  desktop: DesktopApi;
  /** The app window is hidden or minimised: widgets stop ticking. */
  paused: boolean;
  /** The Pomodoro timer (it lives in App so the top bar shows it too). */
  timer: PomodoroTimer;
  /** Look of the terminal-style apps. */
  tui: TuiSurface;
  /** jv_T4p3's playback (it lives in App so the music goes on with the window closed). */
  music: MusicPlayer;
}

const sameGuides = (a: Guide[], b: Guide[]) => a.length === b.length && a.every((guide, i) => guide.axis === b[i].axis && guide.at === b[i].at);

/**
 * The windows over the hologram, above the caption and below the dock, plus the snap guides.
 * A maximised app in front lifts the whole layer over the dock and the drag strip: fullscreen.
 * Clicking the empty desktop (the hologram behind the windows) leaves no window focused.
 */
export function Desktop({ desktop, paused, timer, tui, music }: DesktopProps) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const { prefs, setRect, blur } = desktop;
  // The front window, focused or not: a maximised one still covers everything.
  const fullscreen = desktop.windows[desktop.windows.length - 1]?.maximized ?? false;

  // Everything else (dock, top bar, menus, the drag strip) sits over the scene, so a press that
  // reaches the scene canvas is a press on the desktop itself.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest("[data-desktop-surface]")) blur();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [blur]);

  const drag = useCallback(
    (kind: WindowKind, candidate: Rect, edges: ResizeEdges | "move") => {
      const area = workArea(window.innerWidth, window.innerHeight);
      const snapped = snapRect(candidate, edges, snapTargets(area, prefs), prefs);
      setRect(kind, snapped.rect);
      setGuides((current) => (sameGuides(current, snapped.guides) ? current : snapped.guides));
    },
    [prefs, setRect],
  );
  const endDrag = useCallback(() => setGuides([]), []);

  return (
    <div data-fullscreen={fullscreen || undefined} className={`pointer-events-none fixed inset-0 isolate ${fullscreen ? "z-[21]" : "z-[15]"}`}>
      <AnimatePresence>
        {desktop.windows.map(({ kind, rect, restore, maximized, z }) => (
          <Window
            key={kind}
            kind={kind}
            rect={rect}
            restore={restore}
            z={z}
            focused={desktop.focused === kind}
            maximizable={canMaximize(kind)}
            maximized={maximized}
            opacity={prefs.opacity}
            chrome={prefs.windowStyle}
            onFocus={() => desktop.focus(kind)}
            onClose={() => desktop.close(kind)}
            // TUI windows are all terminals; in the holographic style only the apps are.
            surface={prefs.windowStyle === "tui" || canMaximize(kind) ? tui : undefined}
            onToggleMaximize={() => desktop.toggleMaximize(kind)}
            onUnmaximize={() => desktop.unmaximize(kind)}
            onDrag={(candidate, edges) => drag(kind, candidate, edges)}
            onDragEnd={endDrag}
          >
            <WindowContent kind={kind} paused={paused} timer={timer} music={music} onClose={() => desktop.close(kind)} />
          </Window>
        ))}
      </AnimatePresence>
      {guides.map((guide) => (
        <span
          key={`${guide.axis}${guide.at}`}
          aria-hidden
          data-testid="snap-guide"
          className="absolute z-[100] bg-hud-light/50 shadow-[0_0_8px_color-mix(in_oklab,var(--color-hud-holo)_70%,transparent)]"
          style={guide.axis === "x" ? { left: guide.at, top: 0, bottom: 0, width: 1 } : { top: guide.at, left: 0, right: 0, height: 1 }}
        />
      ))}
    </div>
  );
}

interface ContentProps {
  kind: WindowKind;
  paused: boolean;
  timer: PomodoroTimer;
  music: MusicPlayer;
  /** jv_sh closes its window when its last tab exits. */
  onClose: () => void;
}

function WindowContent({ kind, paused, timer, music, onClose }: ContentProps) {
  switch (kind) {
    case "clock":
      return <Clock paused={paused} />;
    case "pomodoro":
      return <Pomodoro timer={timer} />;
    case "battery":
      return <Battery />;
    case "calculator":
      return <Calculator />;
    case "tape":
      return <TapeWidget music={music} paused={paused} />;
    case "miniplayer":
      return <MiniPlayer music={music} />;
    case "markdown":
      return (
        <Suspense fallback={<Loading />}>
          <MarkdownEditor />
        </Suspense>
      );
    case "code":
      return (
        <Suspense fallback={<Loading />}>
          <CodeEditor />
        </Suspense>
      );
    case "music":
      return (
        <Suspense fallback={<Loading />}>
          <TapePlayer music={music} paused={paused} />
        </Suspense>
      );
    case "shell":
      return (
        <Suspense fallback={<Loading />}>
          <ShellApp onClose={onClose} />
        </Suspense>
      );
  }
}

function Loading() {
  return <div className="flex h-full items-center justify-center text-xs text-hud-text/50">Carregando…</div>;
}
