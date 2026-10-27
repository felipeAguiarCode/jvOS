import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { BootSequence } from "./components/BootSequence";
import { CoreButton } from "./components/CoreButton";
import { Greeting } from "./components/Greeting";
import { JarvisReply } from "./components/JarvisReply";
import { AdvancedMenu } from "./components/desktop/AdvancedMenu";
import { Desktop } from "./components/desktop/Desktop";
import { Launcher } from "./components/desktop/Launcher";
import { FlatCore, HiddenCore } from "./components/FlatCore";
import { QuickDock, type DockItemId, type HoldPhase, type RecordingState, type VoiceIndicator } from "./components/QuickDock";
import { SettingsPanel } from "./components/SettingsPanel";
import { Spotlight } from "./components/Spotlight";
import { Taskbar } from "./components/Taskbar";
import { VoiceCaption } from "./components/VoiceCaption";
import { useAssistant } from "./hooks/useAssistant";
import { useAssistantActions } from "./hooks/useAssistantActions";
import { useAudioAnalyzer, type VoiceStatus } from "./hooks/useAudioAnalyzer";
import { readBattery } from "./hooks/useBattery";
import { useDesktop } from "./hooks/useDesktop";
import { useDockNotice } from "./hooks/useDockNotice";
import { useMusicPlayer } from "./hooks/useMusicPlayer";
import { PHASE_LABEL, usePomodoro } from "./hooks/usePomodoro";
import { useReminders, type Reminder } from "./hooks/useReminders";
import { useModels, useSettings } from "./hooks/useSettings";
import type { SystemStats } from "./hooks/useSystemStats";
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
import { agentProfile, setAgentLauncher, type ToolReply } from "./lib/agents";
import { assistantFolder, type AssistantFolder } from "./lib/assistant";
import { beep } from "./lib/beep";
import { describeBoot, useBootPrefs } from "./lib/boot";
import { buildCommands, type AdvancedTab, type CommandContext, type SettingsSection } from "./lib/commands";
import { useCorePrefs } from "./lib/core";
import { isWindowKind, WINDOW_KINDS, WINDOW_SPECS, type DesktopGroup } from "./lib/desktop";
import { DictationContext, type DictationApi } from "./lib/dictation";
import { useDockPrefs } from "./lib/dock";
import { baseName, isInside } from "./lib/files";
import { useQuality, type QualityLevel } from "./lib/quality";
import { draftRequests, noteRequests, type FileRequest } from "./lib/requests";
import {
  describeDuration,
  localStamp,
  parseReminder,
  shortcutPrompt,
  spokenDate,
  spokenStatus,
  spokenTime,
  type MachineState,
  type ShortcutEvent,
} from "./lib/shortcuts";
import { createSpeechPlayer, useSpeechPrefs, useSpeechStatus, voiceReady } from "./lib/speech";
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
      /** …and for `voice:shortcut` (a shortcut, or a question said to Voice). */
      voiceShortcut: (event: ShortcutEvent) => void;
      /** A question for JARVIS, as if it had been said to the core. */
      ask: (text: string) => void;
      /** One of JARVIS's tool calls (`jvos_run`, `agent_review`…), as its MCP server hands it over. */
      action: (tool: string, args: Record<string, unknown>) => Promise<ToolReply>;
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
  asking: "active",
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
  asking: "Ouvindo para o JARVIS · clique no núcleo para enviar",
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
  asking: "Voice · ouvindo para o JARVIS",
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

  // JARVIS's shortcuts and questions said to Voice; handled below, once JARVIS exists.
  const shortcutHandler = useRef<(event: ShortcutEvent) => void>(() => undefined);
  const onShortcut = useCallback((event: ShortcutEvent) => shortcutHandler.current(event), []);

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
    onShortcut,
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

  // The core: click, talk, and JARVIS (Claude Code) answers inside it.
  const coreVoice = useMemo(
    () => (desktop ? { state: engineState, asked: engine.asked, record: engine.ask } : null),
    [desktop, engineState, engine.asked, engine.ask],
  );
  const notifyVoice = useCallback((text: string, tone?: "info" | "error") => showDockNotice("voice", text, tone), [showDockNotice]);
  // What JARVIS writes in its folder opens where it belongs: notes in Jarvis Mark, agents in jv_agent.
  const [jarvisFolder, setJarvisFolder] = useState<AssistantFolder | null>(null);
  useEffect(() => void assistantFolder().then(setJarvisFolder), []);
  const openKinds = useRef(openWindows);
  openKinds.current = openWindows;
  // The last text streamed for each file goes along with its "done": a window that opens late
  // only gets the latest request.
  const written = useRef(new Map<string, string>());
  const onAssistantFile = useCallback(
    ({ path, content, done }: FileRequest) => {
      if (!jarvisFolder) return;
      const kind = isInside(path, jarvisFolder.notes) ? "markdown" : isInside(path, jarvisFolder.agents) && /\.md$/i.test(path) ? "agent" : null;
      if (!kind) return;
      if (content !== null) written.current.set(path, content);
      const file = { path, content: content ?? written.current.get(path) ?? null, done };
      if (done) written.current.delete(path);
      if (!openKinds.current.some((item) => item.kind === kind)) openWindow(kind);
      (kind === "markdown" ? noteRequests : draftRequests).send(file);
    },
    [jarvisFolder, openWindow],
  );
  const assistant = useAssistant({ voice: coreVoice, notify: notifyVoice, onModelMissing: showModelMissing, onFile: onAssistantFile });
  const [historyOpen, setHistoryOpen] = useState(false);

  // What JARVIS can tell about the machine: the meters, the battery and the music.
  const musicNow = useRef(music);
  musicNow.current = music;
  const readMachine = useCallback(async (): Promise<MachineState> => {
    const fake = import.meta.env.DEV ? window.__JARVIS_SYSTEM__ : undefined;
    const stats = fake ?? (desktop ? await invoke<SystemStats>("system_stats").catch(() => null) : null);
    const { current, status } = musicNow.current;
    return {
      stats,
      battery: await readBattery(),
      music: current ? { title: current.track.title, artist: current.track.artist, station: current.station.name, playing: status === "playing" } : null,
    };
  }, [desktop]);

  // An answer JARVIS knows by himself: spoken in the core, or on the dock while he is busy.
  const { say } = assistant;
  const reply = useCallback(
    (question: string, answer: string) => {
      if (!say(question, answer)) notifyVoice(answer);
    },
    [say, notifyVoice],
  );

  // "me lembra de beber água em 20 minutos": the alarm, the dock and JARVIS's voice.
  const onReminder = useCallback(
    (reminder: Reminder) => {
      beep();
      audio.pulse();
      dock.show("voice", reminder.text ? `Lembrete: ${reminder.text}` : "Timer concluído");
      reply("Lembrete", reminder.text ? `Lembrete: ${reminder.text}.` : "O seu timer terminou.");
    },
    [audio, dock, reply],
  );
  const reminders = useReminders(onReminder);

  // JARVIS's voice shortcuts: what he answers at once here, what goes to Claude Code with its instructions.
  const { ask: askJarvis } = assistant;
  shortcutHandler.current = ({ action, text, said }: ShortcutEvent) => {
    audio.pulse();
    const now = new Date();
    switch (action) {
      case "ask":
        return askJarvis(said);
      case "research":
      case "memory":
        return askJarvis(said, shortcutPrompt(action, said, text, { now }));
      case "briefing":
        return void readMachine().then((machine) => askJarvis(said, shortcutPrompt("briefing", said, text, { now, machine: spokenStatus(machine) })));
      case "reminder": {
        const parsed = parseReminder(text);
        // "às 15h", "amanhã de manhã": JARVIS reads the clock and sets it.
        if (!parsed) return askJarvis(said, shortcutPrompt("reminder", said, text, { now }));
        if (!reminders.add(parsed.minutes, parsed.text)) return notifyVoice("Não consegui agendar o lembrete", "error");
        const when = describeDuration(parsed.minutes);
        return reply(said, parsed.text ? `Certo. Daqui a ${when} eu aviso: ${parsed.text}.` : `Timer de ${when} iniciado.`);
      }
      case "time":
        return reply(said, spokenTime(now));
      case "date":
        return reply(said, spokenDate(now));
      case "status":
        return void readMachine().then((machine) => reply(said, spokenStatus(machine)));
      case "focus":
        closeAll();
        openWindow("pomodoro");
        pomodoro.focus();
        return reply(said, `Protocolo foco ativado. Janelas fechadas e ${pomodoro.durations.focus} minutos de foco no relógio.`);
      case "note": {
        if (!desktop) return notifyVoice("Disponível no app desktop");
        const { date, time } = localStamp(now);
        return void invoke<string>("assistant_note", { text, date, time }).then(
          (path) => {
            reply(said, "Anotado.");
            notifyVoice(`Anotado em ${baseName(path)}`);
          },
          (error: unknown) => notifyVoice(String(error), "error"),
        );
      }
    }
  };

  // JARVIS's voice (Settings → Voz do JARVIS): his answers spoken, the hologram following it.
  const [speechPrefs, setSpeechPrefs] = useSpeechPrefs();
  const speech = useSpeechStatus();
  const replyVoice = speechPrefs.enabled && voiceReady(speech.status, speechPrefs.voice) ? { voice: speechPrefs.voice, speed: speechPrefs.speed } : null;
  const { setVoiceSource } = audio;
  const previewVoice = useCallback(async () => {
    const player = createSpeechPlayer({ voice: speechPrefs.voice, speed: speechPrefs.speed }, setVoiceSource);
    if (!player) return;
    player.prepare(0, "Às suas ordens. É assim que eu soo agora.");
    const buffer = await player.ready(0);
    const playback = buffer && (await player.play(buffer));
    if (!playback) notifyVoice("Não consegui falar com esta voz", "error");
    else await playback.ended;
    player.close();
  }, [speechPrefs.voice, speechPrefs.speed, setVoiceSource, notifyVoice]);

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
      !desktop || engineState === "awake" || engineState === "listening" || engineState === "talking" || engineState === "dictating" || engineState === "asking"
        ? 1
        : 0.6,
    );
  }, [desktop, engineState, setAttention]);

  useEffect(() => setSuspended(paused), [paused, setSuspended]);

  // Listening for a command, the particles and rings align on the core's equator. "Sempre
  // ouvindo" listens all the time, so there they align while someone speaks.
  useEffect(() => {
    if (!desktop) return setAlign(audioStatus === "listening" ? 1 : 0);
    setAlign(
      engineState === "talking" || engineState === "awake" || engineState === "dictating" || engineState === "asking" ? 1 : engineState === "listening" ? "voice" : 0,
    );
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

  // What the search bar (`/`) and JARVIS can run.
  const commandContext: CommandContext = {
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
    speaking: speechPrefs.enabled,
    toggleSpeaking: () => setSpeechPrefs((current) => ({ ...current, enabled: !current.enabled })),
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
  };
  const latestCommands = useRef(commandContext);
  latestCommands.current = commandContext;
  const actionCommands = useCallback(() => buildCommands(latestCommands.current), []);

  // JARVIS's hands: the jvOS actions, and the agents it writes, reviews and runs.
  const { add: addReminder } = reminders;
  const runAction = useAssistantActions({
    commands: actionCommands,
    openAgents: () => openWindow("agent"),
    notify: notifyVoice,
    machine: readMachine,
    remind: (minutes, text) => addReminder(minutes, text) !== null,
  });
  useEffect(
    () =>
      setAgentLauncher(async (launch) => {
        if (desktop) await invoke("agent_install", { name: launch.name });
        openWindow("shell");
        requestTab(agentProfile(launch));
        return `Rodando o agente ${launch.name} numa aba do jv_sh, em ${launch.folder}`;
      }),
    [desktop, openWindow],
  );

  const { hear } = engine;
  const { ask } = assistant;
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
        voiceShortcut: onShortcut,
        ask,
        action: runAction,
      };
    }
  }, [audio.signals, audio.status, preset.level, hear, onWindowCommand, onCloseGroup, onMusic, onPomodoro, onShortcut, ask, runAction]);

  const onDockSelect = (id: DockItemId) => {
    if (id === "voice") return void toggleVoice();
    if (id === "settings") return settingsOpen ? closeSettings() : setSettingsOpen(true);
    if (id === "widgets" || id === "apps") return setLauncher((open) => (open === id ? null : id));
    if (id === "terminal") return workspace.open("shell");
    if (!desktop) return dock.show(id, "Disponível no app desktop");
    void launchApp(id).then((error) => dock.show(id, error ?? "Abrindo…", error ? "error" : "info"));
  };

  // Everything the search bar can find; only built while it is open.
  const commands = searchOpen ? buildCommands(commandContext) : [];

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
        <VoiceCaption heard={engine.heard} transcribing={engine.transcribing || assistant.phase === "transcribing"} />
        {greeting !== null && <Greeting key={greeting} sound={bootPrefs.sound} onDone={endGreeting} />}
        {corePrefs.mode !== "off" && !booting && greeting === null && (
          <CoreButton phase={assistant.phase} onPress={assistant.press} onRelease={assistant.release} />
        )}
        {assistant.turn && greeting === null && (
          <JarvisReply key={assistant.turn.id} turn={assistant.turn} sound={bootPrefs.sound} speech={replyVoice} onVoice={setVoiceSource} onFinished={assistant.dismiss} />
        )}
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
        <AssistantDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          showToggle={corePrefs.mode !== "off" && !booting}
          items={assistant.items}
          turn={assistant.turn}
          busy={assistant.busy}
          coreActive={assistant.phase !== "idle"}
          onNewConversation={assistant.reset}
          onClear={assistant.clear}
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
          speech={{ ...speech, prefs: speechPrefs, onPrefs: setSpeechPrefs, onDownload: speech.download, onPreview: () => void previewVoice() }}
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
