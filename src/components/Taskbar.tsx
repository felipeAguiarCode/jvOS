import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { BatteryCharging, BatteryMedium, BatteryWarning, Gauge, Mic, MicOff, Plug, Search, Settings, Timer } from "lucide-react";
import { isPlugged, LOW_BATTERY, useBattery } from "../hooks/useBattery";
import type { DesktopWindow } from "../hooks/useDesktop";
import type { MusicPlayer } from "../hooks/useMusicPlayer";
import { PHASE_LABEL, usePomodoroRemaining, type Pomodoro } from "../hooks/usePomodoro";
import { WINDOW_SPECS, type WindowKind } from "../lib/desktop";
import type { TaskbarModules } from "../lib/taskbar";
import { formatRemaining } from "./desktop/widgets/Pomodoro";
import type { VoiceIndicator } from "./QuickDock";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

interface TaskbarProps {
  windows: DesktopWindow[];
  focused: WindowKind | null;
  /** Opens a window, or brings it to the front. */
  onWindow: (kind: WindowKind) => void;
  voice: VoiceIndicator;
  voiceLabel: string;
  onVoice: () => void;
  pomodoro: Pomodoro;
  /** jv_T4p3: shown while a song is loaded; clicking pauses or resumes. */
  music: MusicPlayer;
  quality: string;
  onQuality: () => void;
  onSearch: () => void;
  onSettings: () => void;
  /** The app window is hidden: the clock stops ticking. */
  paused: boolean;
  /** Which modules to show (Advanced menu → Barra superior). */
  modules: TaskbarModules;
}

/**
 * Waybar-style bar along the top, kept minimal: search, the open windows and the microphone on
 * the left, the focused window in the middle, what is going on (timer, music, battery) and the
 * time on the right; details live in the tooltips. Its empty parts drag the frameless window.
 */
export function Taskbar({
  windows,
  focused,
  onWindow,
  voice,
  voiceLabel,
  onVoice,
  pomodoro,
  music,
  quality,
  onQuality,
  onSearch,
  onSettings,
  paused,
  modules,
}: TaskbarProps) {
  const now = useMinuteClock(paused);
  const battery = useBattery();
  const title = focused ? WINDOW_SPECS[focused].title : "JARVIS OS";
  const pomodoroActive = pomodoro.running || pomodoro.remaining !== pomodoro.durations[pomodoro.phase] * 60_000;

  return (
    <motion.nav
      aria-label="Barra superior"
      data-tauri-drag-region
      initial={{ y: -28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -28, opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-[22] flex h-7 items-center gap-3 border-b border-hud-line/40 bg-hud-panel/92 px-2 font-mono text-[11px] text-hud-text/80 backdrop-blur-sm select-none"
    >
      <div className="flex items-center gap-0.5">
        <BarButton label="Buscar (/)" onClick={onSearch}>
          <Search size={13} strokeWidth={1.8} />
        </BarButton>
        {modules.voice && (
          <BarButton label={voiceLabel} onClick={onVoice} active={voice === "active"}>
            {voice === "error" ? (
              <MicOff size={13} strokeWidth={1.8} className="text-hud-alert" />
            ) : (
              <Mic size={13} strokeWidth={1.8} className={voice === "active" ? "text-hud-light" : voice === "idle" ? "text-hud-text/50" : ""} />
            )}
          </BarButton>
        )}
        {/* Only what is open: the dock and the search open the rest. */}
        {modules.windows &&
          windows.map(({ kind }) => {
            const spec = WINDOW_SPECS[kind];
            const isFocused = focused === kind;
            return (
              <BarButton key={kind} label={spec.title} pressed onClick={() => onWindow(kind)} active={isFocused}>
                <spec.icon size={13} strokeWidth={1.7} className={isFocused ? "text-hud-light" : "text-hud-text/70"} />
                <span aria-hidden className={`absolute inset-x-1.5 bottom-0 h-[2px] rounded-full ${isFocused ? "bg-hud-light" : "bg-hud-line/70"}`} />
              </BarButton>
            );
          })}
      </div>

      {/* The focused window, centred on the screen (not on the free space). */}
      {modules.title && (
        <span
          data-testid="taskbar-title"
          data-tauri-drag-region
          className="pointer-events-none absolute left-1/2 max-w-[28vw] -translate-x-1/2 truncate text-hud-text/55"
        >
          {title}
        </span>
      )}
      <span data-tauri-drag-region className="h-full flex-1" />

      <div className="flex items-center gap-1">
        {modules.pomodoro && pomodoroActive && (
          <PomodoroModule pomodoro={pomodoro} onClick={() => onWindow("pomodoro")} />
        )}
        {modules.music && music.current && (
          <Module
            label={music.status === "playing" ? "Música: pausar" : "Música: tocar"}
            title={`${music.current.track.title} — ${music.current.track.artist}`}
            onClick={music.toggle}
            tone={music.status === "playing" ? "light" : "dim"}
          >
            <span aria-hidden>♪</span>
            <span data-testid="taskbar-music" className="max-w-[180px] truncate">
              {music.current.track.title}
            </span>
          </Module>
        )}
        {modules.battery && battery.kind === "ready" && <BatteryModule battery={battery} onClick={() => onWindow("battery")} />}
        {modules.quality && (
          <Module label="Qualidade gráfica (Ctrl+Shift+Q)" onClick={onQuality}>
            <Gauge size={12} strokeWidth={1.8} aria-hidden />
            <span className="uppercase">{quality}</span>
          </Module>
        )}
        {(modules.date || modules.clock) && (
          <Module label="Data e hora" onClick={() => onWindow("clock")} tone="light">
            {modules.date && <span className="text-hud-text/60">{DATE.format(now).replace(/\./g, "")}</span>}
            {modules.clock && <span className="tabular-nums">{TIME.format(now)}</span>}
          </Module>
        )}
        <BarButton label="Configurações" onClick={onSettings}>
          <Settings size={13} strokeWidth={1.7} />
        </BarButton>
      </div>
    </motion.nav>
  );
}

/** Its own component: the countdown ticks here, not in the whole bar. */
function PomodoroModule({ pomodoro, onClick }: { pomodoro: Pomodoro; onClick: () => void }) {
  const remaining = usePomodoroRemaining(pomodoro);
  return (
    <Module label={`Pomodoro: ${PHASE_LABEL[pomodoro.phase]}`} onClick={onClick} tone={pomodoro.running ? "light" : "dim"}>
      <Timer size={12} strokeWidth={1.8} aria-hidden />
      <span className="tabular-nums">{formatRemaining(remaining)}</span>
    </Module>
  );
}

function BatteryModule({ battery, onClick }: { battery: Extract<ReturnType<typeof useBattery>, { kind: "ready" }>; onClick: () => void }) {
  const percent = Math.round(battery.level * 100);
  const plugged = isPlugged(battery);
  const low = !battery.charging && battery.level <= LOW_BATTERY;
  const Icon = plugged ? Plug : battery.charging ? BatteryCharging : low ? BatteryWarning : BatteryMedium;
  return (
    <Module label={`Bateria ${percent}%`} onClick={onClick} tone={low ? "alert" : "normal"}>
      <Icon size={12} strokeWidth={1.8} aria-hidden />
      <span className="tabular-nums">{percent}%</span>
    </Module>
  );
}

/** A status module: icon and text, clickable. */
function Module({
  label,
  title = label,
  onClick,
  tone = "normal",
  children,
}: {
  label: string;
  /** Tooltip, when it says more than the label. */
  title?: string;
  onClick: () => void;
  tone?: "normal" | "light" | "dim" | "alert";
  children: ReactNode;
}) {
  const color = tone === "light" ? "text-hud-light" : tone === "dim" ? "text-hud-text/55" : tone === "alert" ? "text-hud-alert" : "";
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50 ${color}`}
    >
      {children}
    </button>
  );
}

function BarButton({
  label,
  onClick,
  pressed,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`relative grid h-6 w-7 cursor-pointer place-items-center rounded outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
        active ? "bg-hud-cyan/[0.12]" : ""
      }`}
    >
      {children}
    </button>
  );
}

/** The current time, refreshed on the minute (and on the second while starting up). */
function useMinuteClock(paused: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (paused) return;
    let timer = 0;
    const tick = () => {
      const date = new Date();
      setNow(date);
      timer = window.setTimeout(tick, 60_000 - (date.getTime() % 60_000) + 50);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [paused]);
  return now;
}
