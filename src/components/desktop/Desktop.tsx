import { memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Agenda } from "../../hooks/useAgenda";
import type { Desktop as DesktopApi } from "../../hooks/useDesktop";
import type { MusicPlayer } from "../../hooks/useMusicPlayer";
import type { Pomodoro as PomodoroTimer } from "../../hooks/usePomodoro";
import type { Tasks } from "../../hooks/useTasks";
import type { Watchlist } from "../../hooks/useWatchlist";
import type { WeatherFeed } from "../../hooks/useWeather";
import { canMaximize, clampRect, WINDOW_SPECS, workArea, type Rect, type WindowKind } from "../../lib/desktop";
import type { TuiSurface } from "../../lib/tui";
import { snapRect, snapTargets, type Guide, type ResizeEdges } from "../../lib/snap";
import type { AgentConversation } from "./apps/agent/AgentSession";
import { AgendaWidget } from "./widgets/AgendaWidget";
import { Battery } from "./widgets/Battery";
import { Stocks } from "./widgets/Stocks";
import { TasksWidget } from "./widgets/TasksWidget";
import { WeatherWidget } from "./widgets/WeatherWidget";
import { SystemMeters } from "./widgets/SystemMeters";
import { Calculator } from "./widgets/Calculator";
import { Clock } from "./widgets/Clock";
import { MiniPlayer } from "./widgets/MiniPlayer";
import { Pomodoro } from "./widgets/Pomodoro";
import { TapeWidget } from "./widgets/TapeWidget";
import { AgentApp, IdeApp, LabApp, MarkdownEditor, ShellApp, TapePlayer } from "./lazyApps";
import { Window } from "./Window";

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
  /** What JARVIS watches (in App: he answers and alerts with the widgets closed). */
  feeds: Feeds;
  /** What the user and JARVIS are saying (jv_agent shows the interview). */
  conversation: AgentConversation;
}

interface Feeds {
  stocks: Watchlist;
  weather: WeatherFeed;
  agenda: Agenda;
  tasks: Tasks;
}

const sameGuides = (a: Guide[], b: Guide[]) => a.length === b.length && a.every((guide, i) => guide.axis === b[i].axis && guide.at === b[i].at);

/**
 * The windows over the hologram, above the caption and below the dock, plus the snap guides.
 * A maximised app in front lifts the whole layer over the dock and the drag strip: fullscreen.
 * Clicking the empty desktop (the hologram behind the windows) leaves no window focused.
 */
export function Desktop({ desktop, paused, timer, tui, music, feeds, conversation }: DesktopProps) {
  const [guides, setGuides] = useState<Guide[]>([]);
  // While a window is dragged or resized its geometry lives here: each pointer move re-renders
  // this layer only, not the whole app (dock, bar, panels), and nothing is stored until the
  // gesture ends.
  const [live, setLive] = useState<{ kind: WindowKind; rect: Rect } | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
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
      const { innerWidth: vw, innerHeight: vh } = window;
      const snapped = snapRect(candidate, edges, snapTargets(workArea(vw, vh), prefs), prefs);
      // Clamped as setRect will store it.
      setLive({ kind, rect: clampRect(snapped.rect, WINDOW_SPECS[kind], vw, vh) });
      setGuides((current) => (sameGuides(current, snapped.guides) ? current : snapped.guides));
    },
    [prefs],
  );
  const endDrag = useCallback(() => {
    const ended = liveRef.current;
    if (ended) setRect(ended.kind, ended.rect);
    setLive(null);
    setGuides([]);
  }, [setRect]);

  return (
    <div data-fullscreen={fullscreen || undefined} className={`pointer-events-none fixed inset-0 isolate ${fullscreen ? "z-[21]" : "z-[15]"}`}>
      <AnimatePresence>
        {desktop.windows.map(({ kind, rect, restore, maximized, z }) => (
          <Window
            key={kind}
            kind={kind}
            rect={rect}
            live={live?.kind === kind ? live.rect : undefined}
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
            <WindowContent kind={kind} paused={paused} timer={timer} music={music} feeds={feeds} conversation={conversation} close={desktop.close} />
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
  feeds: Feeds;
  conversation: AgentConversation;
  /** jv_sh closes its window when its last tab exits. */
  close: (kind: WindowKind) => void;
}

/** What each window's content reads, besides its kind: a change anywhere else leaves it alone. */
const CONTENT_INPUTS: Record<WindowKind, (props: ContentProps) => unknown[]> = {
  clock: ({ paused }) => [paused],
  pomodoro: ({ timer }) => [timer],
  battery: () => [],
  calculator: () => [],
  tape: ({ music, paused }) => [music, paused],
  miniplayer: ({ music }) => [music],
  system: ({ paused }) => [paused],
  stocks: ({ feeds }) => [feeds.stocks],
  weather: ({ feeds }) => [feeds.weather],
  agenda: ({ feeds }) => [feeds.agenda],
  tasks: ({ feeds }) => [feeds.tasks],
  markdown: () => [],
  ide: ({ paused }) => [paused],
  music: ({ music, paused }) => [music, paused],
  shell: ({ close }) => [close],
  lab: () => [],
  agent: ({ conversation }) => [conversation],
};

/**
 * A window's content only renders again when what it reads changed: dragging one window (a
 * state change per pointer move) or JARVIS streaming an answer does not redo the others.
 */
const WindowContent = memo(
  function WindowContent({ kind, paused, timer, music, feeds, conversation, close }: ContentProps) {
    return content({ kind, paused, timer, music, feeds, conversation, close });
  },
  (before, after) => {
    if (before.kind !== after.kind) return false;
    const was = CONTENT_INPUTS[before.kind](before);
    return CONTENT_INPUTS[after.kind](after).every((value, index) => value === was[index]);
  },
);

function content({ kind, paused, timer, music, feeds, conversation, close }: ContentProps) {
  const onClose = () => close(kind);
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
    case "system":
      return <SystemMeters paused={paused} />;
    case "stocks":
      return <Stocks watchlist={feeds.stocks} />;
    case "weather":
      return <WeatherWidget feed={feeds.weather} />;
    case "agenda":
      return <AgendaWidget agenda={feeds.agenda} />;
    case "tasks":
      return <TasksWidget tasks={feeds.tasks} />;
    case "markdown":
      return (
        <Suspense fallback={<Loading />}>
          <MarkdownEditor />
        </Suspense>
      );
    case "ide":
      return (
        <Suspense fallback={<Loading />}>
          <IdeApp paused={paused} />
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
    case "lab":
      return (
        <Suspense fallback={<Loading />}>
          <LabApp />
        </Suspense>
      );
    case "agent":
      return (
        <Suspense fallback={<Loading />}>
          <AgentApp conversation={conversation} />
        </Suspense>
      );
  }
}

function Loading() {
  return <div className="flex h-full items-center justify-center text-xs text-hud-text/50">Carregando…</div>;
}
