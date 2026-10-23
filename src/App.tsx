import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BootSequence } from "./components/BootSequence";
import { Greeting } from "./components/Greeting";
import { AdvancedMenu } from "./components/desktop/AdvancedMenu";
import { Desktop } from "./components/desktop/Desktop";
import { Launcher } from "./components/desktop/Launcher";
import { FlatCore, HiddenCore } from "./components/FlatCore";
import { QuickDock, type DockItemId, type HoldPhase, type RecordingState, type VoiceIndicator } from "./components/QuickDock";
import { SettingsPanel } from "./components/SettingsPanel";
import { Spotlight } from "./components/Spotlight";
import { Taskbar } from "./components/Taskbar";
import { VoiceCaption } from "./components/VoiceCaption";
import { useAudioAnalyzer, type VoiceStatus } from "./hooks/useAudioAnalyzer";
import { useDesktop } from "./hooks/useDesktop";
import { useDockNotice } from "./hooks/useDockNotice";
import { useMusicPlayer } from "./hooks/useMusicPlayer";
import { PHASE_LABEL, usePomodoro } from "./hooks/usePomodoro";
import { useModels, useSettings } from "./hooks/useSettings";
import {
  isEngineActive,
  isMicOpen,
  MODEL_MISSING,
  useVoiceAssistant,
  type EngineState,
  type MusicCommandEvent,
  type PomodoroAction,
  type WindowCommandEvent,
  type WindowGroup,
} from "./hooks/useVoiceAssistant";
import { useWindowControls } from "./hooks/useWindowControls";
import { beep } from "./lib/beep";
import { describeBoot, useBootPrefs } from "./lib/boot";
import { buildCommands, type AdvancedTab, type SettingsSection } from "./lib/commands";
import { useCorePrefs } from "./lib/core";
import { isWindowKind, WINDOW_KINDS, WINDOW_SPECS, type DesktopGroup } from "./lib/desktop";
import { DictationContext, type DictationApi } from "./lib/dictation";
import { useDockPrefs } from "./lib/dock";
import { useQuality, type QualityLevel } from "./lib/quality";
import { readJson, writeJson } from "./lib/storage";
import { useTaskbarModules } from "./lib/taskbar";
import { loadProfiles, requestTab } from "./lib/terminal";
import { tuiSurface, useTuiPrefs } from "./lib/tui";
import type { HoloSignals } from "./lib/signals";
import { applyTheme, DEFAULT_HUE } from "./lib/theme";

// The WebGL hologram (three.js and its effects) only loads with the 3D core.
const JarvisScene = lazy(() => import("./components/JarvisScene").then((module) => ({ default: module.JarvisScene })));

declare global {
  interface Window {
    /** Development-only probe used by the Playwright checks. */
    __JARVIS__?: {
      signals: HoloSignals;
      status: VoiceStatus;
      quality: QualityLevel;
      hear: (text: string) => void;
      /** Stands in for the engine's `voice:window` event (the browser has no engine). */
      voiceWindow: (event: WindowCommandEvent) => void;
      /** …and for `voice:windows`. */
      voiceCloseGroup: (group: WindowGroup) => void;
      /** …and for `voice:music`. */
      voiceMusic: (event: MusicCommandEvent) => void;
      /** …and for `voice:pomodoro`. */
      voicePomodoro: (action: PomodoroAction) => void;
    };
  }
}

/** A shorter push-to-talk hold is a tap: like WhatsApp, it records nothing and shows how to talk. */
const MIN_HOLD_MS = 350;

/** Dock items that launch a configured program (Terminal opens jv_sh, inside JARVIS). */
const LAUNCHABLE: DockItemId[] = ["browser", "vscode", "claude"];

const ENGINE_INDICATOR: Record<EngineState, VoiceIndicator> = {
  off: "idle",
  loading: "loading",
  standby: "armed",
  awake: "active",
  listening: "active",
  ready: "armed",
  talking: "active",
  dictating: "active",
  error: "error",
};

const ENGINE_LABEL: Record<EngineState, string> = {
  off: "Desligada",
  loading: "Carregando o modelo de voz…",
  standby: "Aguardando “Hey Jarvis”",
  awake: "Ouvindo o comando",
  listening: "Ouvindo",
  ready: "Segure Voice ou M para falar",
  talking: "Ouvindo · solte para enviar",
  dictating: "Ditando no editor de Markdown",
  error: "Erro",
};

const DOCK_LABEL: Record<EngineState, string> = {
  off: "Voice",
  loading: "Voice · carregando",
  standby: "Voice · diga “Hey Jarvis”",
  awake: "Voice · ouvindo comando",
  listening: "Voice · ouvindo",
  ready: "Voice · segure para falar",
  talking: "Voice · solte para enviar",
  dictating: "Voice · ditando no Markdown",
  error: "Voice",
};

/** Set once the saved "top bar off" of older installs has been turned on (see App). */
const TASKBAR_MIGRATION = "jarvis.migrations.taskbarOn";

const launchApp = (id: string) =>
  invoke("launch_app", { id }).then(
    () => null,
    (error) => String(error),
  );

export default function App() {
  const { preset, cycle, decline } = useQuality();
  const audio = useAudioAnalyzer();
  const { settings, update, flush } = useSettings();
  const models = useModels();
  const dock = useDockNotice();
  const taskbar = settings?.taskbar ?? true;
  const workspace = useDesktop({ taskbar });
  // The Pomodoro rings even with its widget closed, and the top bar shows it.
  const pomodoro = usePomodoro((finished, next) => {
    audio.pulse();
    beep();
    dock.show("widgets", `Pomodoro: fim ${finished === "focus" ? "do foco" : "da pausa"} · ${PHASE_LABEL[next].toLowerCase()}`);
  });
  // jv_T4p3 plays on with its window closed; the hologram flashes as each song starts.
  const music = useMusicPlayer({ onTrackStart: audio.pulse });
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The Widgets or the Apps launcher, above its dock item. */
  const [launcher, setLauncher] = useState<DesktopGroup | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSession, setSearchSession] = useState(0);
  /** Where the search asked the settings panel / advanced menu to open. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab | null>(null);
  const [bootPrefs, setBootPrefs] = useBootPrefs();
  const [tuiPrefs, setTuiPrefs] = useTuiPrefs();
  const [taskbarModules, setTaskbarModules] = useTaskbarModules();
  const [dockPrefs, setDockPrefs] = useDockPrefs();
  const [corePrefs, setCorePrefs] = useCorePrefs();
  /** jv_sh profiles, for the search ("Nova aba: Git Bash"). */
  const [terminalProfiles, setTerminalProfiles] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void loadProfiles().then((found) => found && setTerminalProfiles(found.profiles));
  }, []);
  const tuiLook = useMemo(() => tuiSurface(tuiPrefs), [tuiPrefs]);
  /** The BIOS-style startup screen is showing. */
  const [booting, setBooting] = useState(() => bootPrefs.enabled);
  const [firstFrame, setFirstFrame] = useState(false);
  /** When the hologram started powering on after the boot (null: it was simply on). */
  const [ignitedAt, setIgnitedAt] = useState<number | null>(null);
  const [greeting, setGreeting] = useState<number | null>(null);
  /** Push-to-talk: Voice or M is being held. */
  const [holding, setHolding] = useState(false);
  const holdStart = useRef(0);

  // "abre o relógio", "fecha a calculadora": the engine decides, the desktop does it.
  const { open: openWindow, close: closeWindow, windows: openWindows } = workspace;
  const { show: showDockNotice } = dock;
  const onWindowCommand = useCallback(
    ({ kind, open }: WindowCommandEvent) => {
      if (!isWindowKind(kind)) return;
      // Reported on the window's own dock item: Widgets or Apps.
      const { title, group } = WINDOW_SPECS[kind];
      audio.pulse();
      if (open) {
        openWindow(kind);
        showDockNotice(group, `Abrindo ${title}`);
      } else if (openWindows.some((item) => item.kind === kind)) {
        closeWindow(kind);
        showDockNotice(group, `Fechando ${title}`);
      } else {
        showDockNotice(group, `${title} não está aberto`);
      }
    },
    [audio, openWindow, closeWindow, openWindows, showDockNotice],
  );

  // "fecha todos os widgets", "todas as aplicações", "tudo".
  const { closeGroup, closeAll } = workspace;
  const onCloseGroup = useCallback(
    (group: WindowGroup) => {
      const targets = openWindows.filter((item) => group === "all" || WINDOW_SPECS[item.kind].group === group);
      const what = group === "widgets" ? "widgets" : group === "apps" ? "apps" : "janelas";
      const item = group === "apps" ? "apps" : "widgets";
      audio.pulse();
      if (!targets.length) return showDockNotice(item, `Nenhum${group === "all" ? "a" : ""} ${what.replace(/s$/, "")} aberto${group === "all" ? "a" : ""}`);
      if (group === "all") closeAll();
      else closeGroup(group);
      showDockNotice(item, `Fechando ${targets.length} ${targets.length === 1 ? what.replace(/s$/, "") : what}`);
    },
    [audio, openWindows, closeAll, closeGroup, showDockNotice],
  );

  // "próxima música", "para a música", "muda a playlist", "toca a Flash FM": the player acts
  // (window open or not) and the Apps item says what happened.
  const onMusic = useCallback(
    ({ action, target }: MusicCommandEvent) => {
      audio.pulse();
      const say = (text: string, tone: "info" | "error" = "info") => showDockNotice("apps", text, tone);
      switch (action) {
        case "next":
          music.next();
          return say("Próxima música");
        case "previous":
          music.prev();
          return say("Música anterior");
        case "pause":
          music.pause();
          return say("Música pausada");
        case "resume":
          music.resume();
          return say("Tocando");
        case "nextPlaylist":
        case "previousPlaylist": {
          const station = music.stepPlaylist(action === "nextPlaylist" ? 1 : -1);
          return station ? say(`Tocando ${station.name}`) : say("Nenhuma playlist com músicas", "error");
        }
        case "play": {
          if (!target) {
            music.resume();
            return say("Tocando");
          }
          const station = music.playNamed(target);
          return station ? say(`Tocando ${station.name}`) : say(`Não achei a playlist “${target}”`, "error");
        }
      }
    },
    [audio, music, showDockNotice],
  );

  // "inicia o pomodoro", "pula a fase", "mais cinco minutos": the timer acts (its widget open or
  // not) and the Widgets item says what happened.
  const onPomodoro = useCallback(
    (action: PomodoroAction) => {
      audio.pulse();
      const phase = PHASE_LABEL[pomodoro.phase].toLowerCase();
      const say = (text: string) => showDockNotice("widgets", `Pomodoro: ${text}`);
      switch (action) {
        case "start":
          pomodoro.start();
          return say(`${phase} em andamento`);
        case "pause":
          pomodoro.pause();
          return say("pausado");
        case "reset":
          pomodoro.reset();
          return say(`${phase} reiniciado`);
        case "skip":
          pomodoro.skip();
          return say("fase pulada");
        case "longer":
        case "shorter": {
          const delta = action === "longer" ? 5 : -5;
          pomodoro.adjust(pomodoro.phase, delta);
          return say(`${delta > 0 ? "+" : "−"}5 min de ${phase}`);
        }
      }
    },
    [audio, pomodoro, showDockNotice],
  );

  const engine = useVoiceAssistant({
    onWake: audio.pulse,
    onCommand: ({ appId, name, error }) => {
      audio.pulse();
      const target = LAUNCHABLE.includes(appId as DockItemId) ? (appId as DockItemId) : "voice";
      dock.show(target, error ?? `Abrindo ${name}`, error ? "error" : "info");
    },
    onWindow: onWindowCommand,
    onCloseGroup,
    onMusic,
    onPomodoro,
  });
  const desktop = engine.available;
  const engineState = engine.status.state;
  const engineActive = isEngineActive(engineState);
  const listening = desktop ? engineActive : audio.status === "listening";
  const pushToTalk = settings?.activation === "pushToTalk";

  const showModelMissing = useCallback(() => {
    setSettingsOpen(true);
    dock.show("voice", "Baixe um modelo de voz", "error");
  }, [dock]);

  const toggleVoice = useCallback(async () => {
    if (!desktop) return audio.toggle();
    if (engineActive) return engine.stop();
    if ((await engine.start()) === MODEL_MISSING) showModelMissing();
  }, [desktop, engineActive, audio, engine, showModelMissing]);

  /**
   * Push-to-talk, WhatsApp style: listen while Voice or M is held and send what was said on
   * release; sliding away, Esc or a tap throws the recording away.
   */
  const holdVoice = useCallback(
    async (phase: HoldPhase) => {
      const down = phase === "start";
      let cancel = phase === "cancel";
      if (down) {
        holdStart.current = performance.now();
      } else if (cancel) {
        dock.show("voice", "Gravação cancelada");
      } else if (performance.now() - holdStart.current < MIN_HOLD_MS) {
        cancel = true;
        dock.show("voice", "Segure para falar");
      }
      setHolding(down);
      if (!desktop) return down ? void audio.start() : audio.stop();
      if ((await engine.push(down, cancel)) === MODEL_MISSING) {
        setHolding(false);
        showModelMissing();
      }
    },
    [desktop, audio, engine, dock, showModelMissing],
  );

  // Markdown dictation: the editor's own microphone; the assistant is deaf while it is held.
  const holdDictation = useCallback(
    async (down: boolean) => {
      if (!desktop) return;
      if ((await engine.dictate(down)) === MODEL_MISSING) showModelMissing();
    },
    [desktop, engine, showModelMissing],
  );
  const dictation = useMemo<DictationApi>(
    () => ({
      available: desktop,
      state: engineState === "dictating" ? "listening" : engine.dictationPending ? "transcribing" : "idle",
      hold: (down) => void holdDictation(down),
      text: engine.dictation,
    }),
    [desktop, engineState, engine.dictationPending, engine.dictation, holdDictation],
  );

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(null);
    void flush();
  }, [flush]);

  const closeLauncher = useCallback(() => setLauncher(null), []);
  // The settings backdrop covers the dock, so the launcher goes away with it (and with the dock).
  useEffect(() => {
    if (settingsOpen || advancedOpen || searchOpen || !dockPrefs.visible) setLauncher(null);
  }, [settingsOpen, advancedOpen, searchOpen, dockPrefs.visible]);

  // The advanced menu takes the settings panel's place.
  const openAdvanced = useCallback(() => {
    setSettingsOpen(false);
    setAdvancedOpen(true);
  }, []);
  const closeAdvanced = useCallback(() => {
    setAdvancedOpen(false);
    setAdvancedTab(null);
    void flush();
  }, [flush]);

  // The search bar (`/`) opens menus at a given section or tab.
  const openSettingsAt = useCallback((section?: SettingsSection) => {
    setAdvancedOpen(false);
    setSettingsSection(section ?? null);
    setSettingsOpen(true);
  }, []);
  const openAdvancedAt = useCallback(
    (tab?: AdvancedTab) => {
      setAdvancedTab(tab ?? null);
      openAdvanced();
    },
    [openAdvanced],
  );
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const { paused, reveal } = useWindowControls({
    onToggleVoice: () => void toggleVoice(),
    pushToTalk,
    onHoldVoice: (phase) => void holdVoice(phase),
    onCycleQuality: cycle,
    onOpenSettings: () => setSettingsOpen(true),
    onOpenAdvanced: openAdvanced,
    onOpenSearch: () => {
      setSearchSession((session) => session + 1);
      setSearchOpen(true);
    },
  });

  // The window shows on the hologram's first frame; the boot screen starts typing then.
  const onFirstFrame = useCallback(() => {
    reveal();
    setFirstFrame(true);
  }, [reveal]);
  // After the boot the planet powers on (a surge at the start and as it settles) and JARVIS says hello.
  const finishBoot = useCallback(
    (openSettings: boolean) => {
      setBooting(false);
      setIgnitedAt(performance.now());
      setGreeting(Date.now());
      audio.pulse();
      window.setTimeout(audio.pulse, 1300);
      if (openSettings) setSettingsOpen(true);
    },
    [audio],
  );
  const endGreeting = useCallback(() => setGreeting(null), []);
  const replayBoot = useCallback(() => {
    setAdvancedOpen(false);
    setGreeting(null);
    setBooting(true);
  }, []);
  const bootInfo = useMemo(
    () =>
      describeBoot({
        settings,
        models: models.models,
        desktop,
        quality: preset.level,
        modules: WINDOW_KINDS.length,
        windows: workspace.windows.length,
      }),
    [settings, models.models, desktop, preset.level, workspace.windows.length],
  );

  // In the desktop app the visual capture (hologram reactivity) follows the engine's microphone;
  // with the core off there is nothing to animate, so it stays closed.
  const visualCapture = isMicOpen(engineState) && corePrefs.mode !== "off";
  const { start: startAudio, stop: stopAudio, status: audioStatus, setAttention, setSuspended, setAlign } = audio;
  useEffect(() => {
    if (!desktop) return;
    if (visualCapture && audioStatus === "idle") void startAudio();
    if (!visualCapture && audioStatus !== "idle") stopAudio();
  }, [desktop, visualCapture, audioStatus, startAudio, stopAudio]);

  // Waiting for "Hey Jarvis", the hologram follows the voice more softly; awake, it follows fully.
  useEffect(() => {
    setAttention(
      !desktop || engineState === "awake" || engineState === "listening" || engineState === "talking" || engineState === "dictating" ? 1 : 0.6,
    );
  }, [desktop, engineState, setAttention]);

  useEffect(() => setSuspended(paused), [paused, setSuspended]);

  // Listening for a command, the particles and rings align on the core's equator. "Sempre
  // ouvindo" listens all the time, so there they align while someone speaks.
  useEffect(() => {
    if (!desktop) return setAlign(audioStatus === "listening" ? 1 : 0);
    setAlign(engineState === "talking" || engineState === "awake" || engineState === "dictating" ? 1 : engineState === "listening" ? "voice" : 0);
  }, [desktop, engineState, audioStatus, setAlign]);

  // The top bar became the default; an existing desktop install still has it saved as off, so
  // it is turned on once. Later choices stick.
  useEffect(() => {
    if (!settings || !desktop) return;
    if (readJson(TASKBAR_MIGRATION, (raw) => (raw === true ? true : null))) return;
    writeJson(TASKBAR_MIGRATION, true);
    if (!settings.taskbar) update((current) => ({ ...current, taskbar: true }));
  }, [settings, desktop, update]);

  // A maximised app in front covers the hologram completely.
  const covered = workspace.windows[workspace.windows.length - 1]?.maximized ?? false;

  const theme = settings?.theme;
  const accentHue = settings?.accentHue ?? DEFAULT_HUE;
  useEffect(() => {
    if (theme) applyTheme(theme, accentHue);
  }, [theme, accentHue]);

  const { show: showNotice, clear: clearNotice } = dock;
  // Engine messages are errors, or warnings while listening (e.g. a muted microphone).
  useEffect(() => {
    if (engine.status.message) showNotice("voice", engine.status.message, "error");
    else if (audio.status === "error" && audio.error) showNotice("voice", audio.error, "error");
    // Only the error shown here: hints like "Segure para falar" stay until they time out.
    else clearNotice("voice", "error");
  }, [engine.status.message, audio.status, audio.error, showNotice, clearNotice]);

  const { hear } = engine;
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__JARVIS__ = {
        signals: audio.signals,
        status: audio.status,
        quality: preset.level,
        hear,
        voiceWindow: onWindowCommand,
        voiceCloseGroup: onCloseGroup,
        voiceMusic: onMusic,
        voicePomodoro: onPomodoro,
      };
    }
  }, [audio.signals, audio.status, preset.level, hear, onWindowCommand, onCloseGroup, onMusic, onPomodoro]);

  const onDockSelect = (id: DockItemId) => {
    if (id === "voice") return void toggleVoice();
    if (id === "settings") return settingsOpen ? closeSettings() : setSettingsOpen(true);
    if (id === "widgets" || id === "apps") return setLauncher((open) => (open === id ? null : id));
    if (id === "terminal") return workspace.open("shell");
    if (!desktop) return dock.show(id, "Disponível no app desktop");
    void launchApp(id).then((error) => dock.show(id, error ?? "Abrindo…", error ? "error" : "info"));
  };

  // Everything the search bar can find; only built while it is open.
  const commands = searchOpen
    ? buildCommands({
        windows: workspace.windows,
        openWindow: workspace.open,
        closeWindow: workspace.close,
        arrange: workspace.arrange,
        closeAll: workspace.closeAll,
        closeGroup: workspace.closeGroup,
        music,
        terminalProfiles,
        openTerminalTab: requestTab,
        settings,
        updateSettings: update,
        launchProgram: (id) => {
          // Programs without a dock icon report on the Voice item.
          const target = LAUNCHABLE.includes(id as DockItemId) ? (id as DockItemId) : "voice";
          if (!desktop) return dock.show(target, "Disponível no app desktop");
          void launchApp(id).then((error) => dock.show(target, error ?? "Abrindo…", error ? "error" : "info"));
        },
        openSettings: openSettingsAt,
        openAdvanced: openAdvancedAt,
        openLauncher: dockPrefs.visible ? setLauncher : null,
        dockVisible: dockPrefs.visible,
        toggleDock: () => setDockPrefs((current) => ({ ...current, visible: !current.visible })),
        core: corePrefs.mode,
        setCore: (mode) => setCorePrefs((current) => ({ ...current, mode })),
        listening,
        toggleListening: () => void toggleVoice(),
        quality: preset.level,
        cycleQuality: cycle,
        bootEnabled: bootPrefs.enabled,
        toggleBoot: () => setBootPrefs((current) => ({ ...current, enabled: !current.enabled })),
        replayBoot,
        system: desktop
          ? {
              fullscreen: () => {
                const appWindow = getCurrentWindow();
                void appWindow.isFullscreen().then((fullscreen) => appWindow.setFullscreen(!fullscreen));
              },
              minimize: () => void getCurrentWindow().minimize(),
              quit: () => void getCurrentWindow().close(),
            }
          : null,
      })
    : [];

  const voiceIndicator: VoiceIndicator = desktop
    ? ENGINE_INDICATOR[engineState]
    : audio.status === "listening"
      ? "active"
      : audio.status === "error"
        ? "error"
        : "idle";
  const browserLabel = pushToTalk
    ? audio.status === "listening"
      ? "Voice · solte para parar"
      : "Voice · segure para falar"
    : audio.status === "listening"
      ? "Voice · ouvindo"
      : "Voice";
  const voiceLabel = desktop ? DOCK_LABEL[engineState] : browserLabel;
  const micLive = desktop ? engineState === "talking" : audio.status === "listening";
  const recording: RecordingState | null =
    pushToTalk && holding && voiceIndicator !== "error" ? (micLive ? "live" : "preparing") : null;

  return (
    <MotionConfig reducedMotion="user">
      <main className="fixed inset-0 overflow-hidden bg-hud-void">
        {/* Hidden or minimised, or behind a maximised app: nothing to draw. The first frame is
            always drawn: it reveals the window and starts the boot screen. */}
        {corePrefs.mode === "3d" ? (
          <Suspense fallback={null}>
            <JarvisScene
              quality={preset}
              background={settings?.background ?? "solid"}
              ignition={booting ? "standby" : ignitedAt}
              signals={audio.signals}
              sample={audio.sample}
              paused={paused || (covered && firstFrame)}
              onFirstFrame={onFirstFrame}
              onQualityFallback={decline}
            />
          </Suspense>
        ) : corePrefs.mode === "2d" ? (
          <FlatCore
            ignition={booting ? "standby" : ignitedAt}
            signals={audio.signals}
            sample={audio.sample}
            paused={paused || (covered && firstFrame)}
            onFirstFrame={onFirstFrame}
          />
        ) : (
          <HiddenCore onFirstFrame={onFirstFrame} />
        )}
        <VoiceCaption heard={engine.heard} transcribing={engine.transcribing} />
        {greeting !== null && <Greeting key={greeting} sound={bootPrefs.sound} onDone={endGreeting} />}
        <DictationContext.Provider value={dictation}>
          <Desktop desktop={workspace} paused={paused} timer={pomodoro} tui={tuiLook} music={music} />
        </DictationContext.Provider>
        {/* Invisible strip to move the frameless window (double click toggles maximise). */}
        <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-20 h-7" />
        {/* Like the dock, the bar comes in after the boot screen. */}
        <AnimatePresence>
          {taskbar && !booting && (
            <Taskbar
              windows={workspace.windows}
              focused={workspace.focused}
              onWindow={workspace.open}
              voice={voiceIndicator}
              voiceLabel={voiceLabel}
              onVoice={() => void toggleVoice()}
              pomodoro={pomodoro}
              music={music}
              quality={preset.level}
              onQuality={cycle}
              onSearch={() => {
                setSearchSession((session) => session + 1);
                setSearchOpen(true);
              }}
              onSettings={() => setSettingsOpen(true)}
              paused={paused}
              modules={taskbarModules}
            />
          )}
        </AnimatePresence>
        <QuickDock
          voice={voiceIndicator}
          voiceLabel={voiceLabel}
          notice={dock.notice}
          selected={settingsOpen ? "settings" : launcher}
          onSelect={onDockSelect}
          onVoiceHold={pushToTalk ? (phase) => void holdVoice(phase) : undefined}
          recording={recording}
          entered={!booting}
          visible={dockPrefs.visible}
          magnify={dockPrefs.magnify}
          armed={[
            ...(["widgets", "apps"] as const).filter((group) => workspace.windows.some((item) => WINDOW_SPECS[item.kind].group === group)),
            ...(workspace.windows.some((item) => item.kind === "shell") ? (["terminal"] as const) : []),
          ]}
          popovers={
            launcher
              ? {
                  [launcher]: (
                    <Launcher
                      key={launcher}
                      group={launcher}
                      open={workspace.windows.map((item) => item.kind)}
                      onPick={(kind) => {
                        workspace.open(kind);
                        closeLauncher();
                      }}
                      onClose={closeLauncher}
                      onAdvanced={openAdvanced}
                    />
                  ),
                }
              : undefined
          }
        />
        <SettingsPanel
          open={settingsOpen}
          onClose={closeSettings}
          settings={settings}
          onChange={update}
          desktop={desktop}
          listening={listening}
          listeningLabel={
            desktop
              ? (engine.status.message ?? ENGINE_LABEL[engineState])
              : listening
                ? "Microfone ativo (somente visual no navegador)"
                : "Desligada"
          }
          onToggleListening={() => void toggleVoice()}
          transcript={engine.transcript}
          models={models.models}
          progress={models.progress}
          modelErrors={models.errors}
          onDownload={(id) => void models.download(id)}
          onTestApp={launchApp}
          onOpenAdvanced={openAdvanced}
          section={settingsSection}
          core={corePrefs.mode}
        />
        <AdvancedMenu
          open={advancedOpen}
          onClose={closeAdvanced}
          settings={settings}
          onSettings={update}
          prefs={workspace.prefs}
          onPrefs={workspace.setPrefs}
          windows={workspace.windows.length}
          onArrange={workspace.arrange}
          onCloseAll={workspace.closeAll}
          boot={bootPrefs}
          onBoot={setBootPrefs}
          onReplayBoot={replayBoot}
          initialTab={advancedTab}
          tui={tuiPrefs}
          onTui={setTuiPrefs}
          taskbarModules={taskbarModules}
          onTaskbarModules={setTaskbarModules}
          dock={dockPrefs}
          onDock={setDockPrefs}
          core={corePrefs}
          onCore={setCorePrefs}
          playlists={music.playlists.map((playlist) => playlist.name)}
        />
        <Spotlight open={searchOpen} session={searchSession} onClose={closeSearch} commands={commands} />
        {booting && <BootSequence started={firstFrame} sound={bootPrefs.sound} info={bootInfo} onDone={finishBoot} />}
      </main>
    </MotionConfig>
  );
}
