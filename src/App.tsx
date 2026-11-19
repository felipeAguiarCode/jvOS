import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { BootSequence } from "./components/BootSequence";
import { CoreButton } from "./components/CoreButton";
import { Greeting } from "./components/Greeting";
import { Homecoming } from "./components/Homecoming";
import { JarvisReply } from "./components/JarvisReply";
import { AdvancedMenu } from "./components/desktop/AdvancedMenu";
import { Desktop } from "./components/desktop/Desktop";
import { preloadWindow } from "./components/desktop/lazyApps";
import { Launcher } from "./components/desktop/Launcher";
import { FlatCore, HiddenCore } from "./components/FlatCore";
import { QuickDock, type DockItemId, type HoldPhase, type RecordingState, type VoiceIndicator } from "./components/QuickDock";
import { SettingsPanel } from "./components/SettingsPanel";
import { Spotlight } from "./components/Spotlight";
import { Taskbar } from "./components/Taskbar";
import { VoiceCaption } from "./components/VoiceCaption";
import { useAgenda } from "./hooks/useAgenda";
import { useAssistant } from "./hooks/useAssistant";
import { useAssistantActions } from "./hooks/useAssistantActions";
import { useChatSpeech } from "./hooks/useChatSpeech";
import { useAudioAnalyzer, type VoiceStatus } from "./hooks/useAudioAnalyzer";
import { readBattery } from "./hooks/useBattery";
import { useDesktop } from "./hooks/useDesktop";
import { useDockNotice } from "./hooks/useDockNotice";
import { useMusicPlayer } from "./hooks/useMusicPlayer";
import { PHASE_LABEL, usePomodoro } from "./hooks/usePomodoro";
import { useReminders, type Reminder } from "./hooks/useReminders";
import { useTasks } from "./hooks/useTasks";
import { useWatchlist } from "./hooks/useWatchlist";
import { useWeather } from "./hooks/useWeather";
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
import { agentProfile, launchAgent, setAgentLauncher, type ToolReply } from "./lib/agents";
import { assistantFolder, type AssistantFolder } from "./lib/assistant";
import { beep } from "./lib/beep";
import { describeBoot, useBootPrefs } from "./lib/boot";
import { cleanMemory, cleanupLine, cleanupSummary, formatBytes, type Cleanup } from "./lib/cleanup";
import type { NoteRequest } from "./components/chat/ChatView";
import { useChatModePrefs, type AppMode } from "./lib/chatMode";
import { buildCommands, type AdvancedTab, type CommandContext, type SettingsSection } from "./lib/commands";
import { useCorePrefs } from "./lib/core";
import { addDays, agendaReport, dateKey } from "./lib/agenda";
import { isWindowKind, WINDOW_KINDS, WINDOW_SPECS, type DesktopGroup, type WindowKind } from "./lib/desktop";
import { DictationContext, type DictationApi } from "./lib/dictation";
import { useDockPrefs } from "./lib/dock";
import { formatPrice, weatherReport } from "./lib/feeds";
import { baseName, isInside } from "./lib/files";
import { pickHomecoming } from "./lib/greetings";
import {
  agendaDueLine,
  agendaLine,
  dateLine,
  dayLine,
  line,
  reminderText,
  statusLine,
  stockAlertLine,
  tasksLine,
  timeLine,
  weatherLine,
  type LineKey,
  type LineValues,
} from "./lib/jarvisLines";
import { useQuality, type QualityLevel } from "./lib/quality";
import { draftRequests, noteRequests, type FileRequest } from "./lib/requests";
import {
  cleanTask,
  describeDuration,
  leadingNumber,
  localStamp,
  mentionsWhen,
  parseReminder,
  placeIn,
  shortcutPrompt,
  spokenStatus,
  type MachineState,
  type ShortcutEvent,
} from "./lib/shortcuts";
import { createSpeechPlayer, useSpeechPrefs, useSpeechStatus, voiceReady } from "./lib/speech";
import { readJson, writeJson } from "./lib/storage";
import { tasksReport } from "./lib/tasks";
import { useTaskbarModules } from "./lib/taskbar";
import { loadProfiles, requestTab } from "./lib/terminal";
import { tuiSurface, useTuiPrefs } from "./lib/tui";
import type { HoloSignals } from "./lib/signals";
import { applyTheme, DEFAULT_HUE } from "./lib/theme";

// The WebGL hologram (three.js and its effects) only loads with the 3D core.
const JarvisScene = lazy(() => import("./components/JarvisScene").then((module) => ({ default: module.JarvisScene })));
// The chat (and its Markdown) only loads with the chat mode.
const ChatView = lazy(() => import("./components/chat/ChatView").then((module) => ({ default: module.ChatView })));

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
      /** Stands in for `voice:dictation`: words dictated into the editor on screen. */
      dictate: (text: string) => void;
    };
  }
}

/** A shorter push-to-talk hold is a tap: like WhatsApp, it records nothing and shows how to talk. */
const MIN_HOLD_MS = 350;

/** Dock items that launch a configured program (Terminal opens jv_sh, inside JARVIS). */
const LAUNCHABLE: DockItemId[] = ["browser", "vscode", "claude"];

/** "fecha o navegador": what the engine answers. Mirrors `CANNOT_CLOSE` in src-tauri/src/voice/mod.rs. */
const CANNOT_CLOSE = "Fechar programas pela voz ainda não é possível";

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

/** What the top bar lists in the chat mode. */
const NO_WINDOWS: ReturnType<typeof useDesktop>["windows"] = [];

/** Set once the saved "top bar off" of older installs has been turned on (see App). */
const TASKBAR_MIGRATION = "jarvis.migrations.taskbarOn";

const launchApp = (id: string) =>
  invoke("launch_app", { id }).then(
    () => null,
    (error) => String(error),
  );

export default function App() {
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
  // The app's two faces: the holographic desktop, or the agent's chat over it.
  const [chatPrefs, setChatPrefs] = useChatModePrefs();
  const chat = chatPrefs.mode === "chat";
  // The GPU is only probed for a quality level once the 3D hologram is in use.
  const { preset, cycle, decline } = useQuality(corePrefs.mode === "3d");
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
  /** A set greeting (the homecoming's) instead of a picked one, and what JARVIS says after it. */
  const [greetingText, setGreetingText] = useState<readonly [string, string] | null>(null);
  const afterGreeting = useRef<(() => void) | null>(null);
  /** "Acorda, querido, papai chegou": the lights are coming on; `coreDark` while the core is out. */
  const [homecoming, setHomecoming] = useState<number | null>(null);
  const [coreDark, setCoreDark] = useState(false);
  /** Push-to-talk: Voice or M is being held. */
  const [holding, setHolding] = useState(false);
  const holdStart = useRef(0);

  // What JARVIS calls the user, and how he confirms a voice command out loud (set below, once he exists).
  const userName = settings?.assistantName ?? "";
  const confirmCommand = useRef<(answer: string) => void>(() => undefined);
  const confirm = useCallback((key: LineKey, values: LineValues = {}) => confirmCommand.current(line(key, userName, values)), [userName]);

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
        confirm("openWindow", { title });
      } else if (openWindows.some((item) => item.kind === kind)) {
        closeWindow(kind);
        showDockNotice(group, `Fechando ${title}`);
        confirm("closeWindow", { title });
      } else {
        showDockNotice(group, `${title} não está aberto`);
        confirm("notOpen", { title });
      }
    },
    [audio, openWindow, closeWindow, openWindows, showDockNotice, confirm],
  );

  // "fecha todos os widgets", "todas as aplicações", "tudo".
  const { closeGroup, closeAll } = workspace;
  const onCloseGroup = useCallback(
    (group: WindowGroup) => {
      const targets = openWindows.filter((item) => group === "all" || WINDOW_SPECS[item.kind].group === group);
      const what = group === "widgets" ? "widgets" : group === "apps" ? "apps" : "janelas";
      const item = group === "apps" ? "apps" : "widgets";
      audio.pulse();
      if (!targets.length) {
        showDockNotice(item, `Nenhum${group === "all" ? "a" : ""} ${what.replace(/s$/, "")} aberto${group === "all" ? "a" : ""}`);
        return confirm("nothingOpen");
      }
      if (group === "all") closeAll();
      else closeGroup(group);
      const count = `${targets.length} ${targets.length === 1 ? what.replace(/s$/, "") : what}`;
      showDockNotice(item, `Fechando ${count}`);
      confirm("closeGroup", { what: count });
    },
    [audio, openWindows, closeAll, closeGroup, showDockNotice, confirm],
  );

  // "próxima música", "para a música", "muda a playlist", "toca a Flash FM": the player acts
  // (window open or not), the Apps item says what happened and JARVIS confirms.
  const onMusic = useCallback(
    ({ action, target }: MusicCommandEvent) => {
      audio.pulse();
      const say = (text: string, key: LineKey, values: LineValues = {}, tone: "info" | "error" = "info") => {
        showDockNotice("apps", text, tone);
        confirm(key, values);
      };
      switch (action) {
        case "next":
          music.next();
          return say("Próxima música", "musicNext");
        case "previous":
          music.prev();
          return say("Música anterior", "musicPrevious");
        case "pause":
          music.pause();
          return say("Música pausada", "musicPause");
        case "resume":
          music.resume();
          return say("Tocando", "musicResume");
        case "nextPlaylist":
        case "previousPlaylist": {
          const station = music.stepPlaylist(action === "nextPlaylist" ? 1 : -1);
          return station ? say(`Tocando ${station.name}`, "musicStation", { station: station.name }) : say("Nenhuma playlist com músicas", "musicEmpty", {}, "error");
        }
        case "play": {
          if (!target) {
            music.resume();
            return say("Tocando", "musicResume");
          }
          const station = music.playNamed(target);
          return station
            ? say(`Tocando ${station.name}`, "musicStation", { station: station.name })
            : say(`Não achei a playlist “${target}”`, "musicNotFound", { target }, "error");
        }
      }
    },
    [audio, music, showDockNotice, confirm],
  );

  // "inicia o pomodoro", "pula a fase", "mais cinco minutos": the timer acts (its widget open or
  // not), the Widgets item says what happened and JARVIS confirms.
  const onPomodoro = useCallback(
    (action: PomodoroAction) => {
      audio.pulse();
      const phase = PHASE_LABEL[pomodoro.phase].toLowerCase();
      const say = (text: string, key: LineKey) => {
        showDockNotice("widgets", `Pomodoro: ${text}`);
        confirm(key, { phase });
      };
      switch (action) {
        case "start":
          pomodoro.start();
          return say(`${phase} em andamento`, "pomodoroStart");
        case "pause":
          pomodoro.pause();
          return say("pausado", "pomodoroPause");
        case "reset":
          pomodoro.reset();
          return say(`${phase} reiniciado`, "pomodoroReset");
        case "skip":
          pomodoro.skip();
          return say("fase pulada", "pomodoroSkip");
        case "longer":
        case "shorter": {
          const delta = action === "longer" ? 5 : -5;
          pomodoro.adjust(pomodoro.phase, delta);
          return say(`${delta > 0 ? "+" : "−"}5 min de ${phase}`, action === "longer" ? "pomodoroLonger" : "pomodoroShorter");
        }
      }
    },
    [audio, pomodoro, showDockNotice, confirm],
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
      confirm(!error ? "launch" : error === CANNOT_CLOSE ? "cannotClose" : "launchFailed", { app: name });
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
  /** Windows opening as soon as their app is in (the file goes on streaming meanwhile). */
  const opening = useRef(new Set<WindowKind>());
  const onAssistantFile = useCallback(
    ({ path, content, done }: FileRequest) => {
      if (!jarvisFolder) return;
      const kind = isInside(path, jarvisFolder.notes) ? "markdown" : isInside(path, jarvisFolder.agents) && /\.md$/i.test(path) ? "agent" : null;
      if (!kind) return;
      if (content !== null) written.current.set(path, content);
      const file = { path, content: content ?? written.current.get(path) ?? null, done };
      if (done) written.current.delete(path);
      // Opened with its app already loaded, the window shows the writing at once (see lazyApps).
      if (!openKinds.current.some((item) => item.kind === kind) && !opening.current.has(kind)) {
        opening.current.add(kind);
        void preloadWindow(kind)
          .catch(() => undefined)
          .then(() => {
            opening.current.delete(kind);
            openWindow(kind);
          });
      }
      (kind === "markdown" ? noteRequests : draftRequests).send(file);
    },
    [jarvisFolder, openWindow],
  );
  const assistant = useAssistant({ voice: coreVoice, notify: notifyVoice, onModelMissing: showModelMissing, onFile: onAssistantFile });
  const [historyOpen, setHistoryOpen] = useState(false);
  /** An answer already on screen (in the core) as the chat comes in: it is not said again there. */
  const heardInCore = useRef<number | null>(null);
  const answered = useRef(assistant.turn);
  answered.current = assistant.turn;
  const setMode = useCallback(
    (mode: AppMode) => {
      heardInCore.current = mode === "chat" && answered.current?.done ? answered.current.id : null;
      setChatPrefs((current) => (current.mode === mode ? current : { ...current, mode }));
    },
    [setChatPrefs],
  );
  const toggleMode = useCallback(() => setMode(chat ? "desktop" : "chat"), [chat, setMode]);
  /** A note a conversation's card asked to see, for the chat's notes section. */
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);
  // What jv_agent shows as the interview.
  const { items: conversationItems, turn: conversationTurn, phase: conversationPhase } = assistant;
  const conversation = useMemo(() => ({ items: conversationItems, turn: conversationTurn, phase: conversationPhase }), [conversationItems, conversationTurn, conversationPhase]);

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
  // A voice command's confirmation, under what was said; while he is busy the dock says it alone.
  const { said: lastSaid } = engine;
  confirmCommand.current = (answer: string) => void say(lastSaid.current || "Comando de voz", answer);

  // "me lembra de beber água em 20 minutos": the alarm, the dock and JARVIS's voice.
  const onReminder = useCallback(
    (reminder: Reminder) => {
      beep();
      audio.pulse();
      dock.show("voice", reminder.text ? `Lembrete: ${reminder.text}` : "Timer concluído");
      reply("Lembrete", reminder.text ? line("reminderDue", userName, { text: reminderText(reminder.text) }) : line("timerDone", userName));
    },
    [audio, dock, reply, userName],
  );
  const reminders = useReminders(onReminder);

  // What JARVIS watches for the user (the Ações, Clima and Agenda widgets), alive with them closed.
  const widgetOpen = (kind: WindowKind) => openWindows.some((item) => item.kind === kind);
  const stocks = useWatchlist({
    active: widgetOpen("stocks"),
    onAlert: (alert, quote) => {
      beep();
      audio.pulse();
      dock.show("widgets", `${quote.symbol}: ${formatPrice(quote.price, quote.currency)}`);
      reply("Alerta de preço", stockAlertLine(alert, quote, userName));
    },
  });
  const weather = useWeather({ active: widgetOpen("weather") });
  const agenda = useAgenda((event) => {
    beep();
    audio.pulse();
    dock.show("widgets", `Agenda: ${event.title}`);
    reply("Agenda", agendaDueLine(event, Date.now(), userName));
  });
  const tasks = useTasks();
  // The list shows itself while something is pending: at start, and whenever a task comes in.
  const pendingTasks = tasks.pending.length;
  const pendingBefore = useRef(0);
  useEffect(() => {
    if (pendingTasks > pendingBefore.current) openWindow("tasks");
    pendingBefore.current = pendingTasks;
  }, [pendingTasks, openWindow]);

  // "Acorda, querido, papai chegou": the workshop wakes up. Dark, then the lights flicker on and
  // the core powers up, the clock, the agenda and the list light up one by one, JARVIS welcomes
  // the user home and goes over the day.
  const comeHome = (said: string) => {
    if (booting || homecoming !== null || greeting !== null) return;
    setHomecoming(Date.now());
    setCoreDark(true);
    window.setTimeout(() => {
      setCoreDark(false);
      setIgnitedAt(performance.now());
      audio.pulse();
    }, 450);
    window.setTimeout(audio.pulse, 1750);
    (["clock", "agenda", "tasks"] as const)
      .filter((kind) => !openKinds.current.some((item) => item.kind === kind))
      .forEach((kind, index) =>
        window.setTimeout(() => {
          openWindow(kind);
          audio.pulse();
        }, 800 + index * 300),
      );
    afterGreeting.current = () => {
      const today = dateKey(new Date());
      reply(said, `${line("homecoming", userName)} ${dayLine(agenda.between(today, today), tasks.list(), "")}`);
    };
  };
  // The lights are on: JARVIS's greeting, then his words.
  const lightsOn = useCallback(() => {
    setHomecoming(null);
    setGreetingText(pickHomecoming(userName));
    setGreeting(Date.now());
  }, [userName]);

  // "Limpa a memória", "ativa o garbage collector", or the button in the settings: Claude Code,
  // idle, stops and gives its RAM back (it comes back on the next question).
  const runCleanup = useCallback(async (): Promise<Cleanup | null> => {
    const result = await cleanMemory();
    if (result?.outcome === "stopped") showDockNotice("voice", result.freed > 0 ? `Memória: ${formatBytes(result.freed)} liberados` : "Memória liberada");
    return result;
  }, [showDockNotice]);

  /** A task said to JARVIS ("adiciona tarefa…", "me lembra de…" without a when). */
  const addTask = (said: string, text: string) => {
    const added = tasks.add(cleanTask(text));
    if (typeof added === "string") return reply(said, line("taskNotAdded", userName, { problem: `${added.charAt(0).toLowerCase()}${added.slice(1)}` }));
    showDockNotice("widgets", `Tarefa ${added.id}: ${added.text}`);
    reply(said, line("taskAdded", userName, { id: added.id, text: added.text }));
  };

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
      case "briefing": {
        const today = dateKey(now);
        const events = agenda.between(today, today);
        const pending = tasks.list().filter((task) => !task.done);
        return void Promise.all([readMachine(), weather.city ? weather.forecast().catch(() => null) : null]).then(([machine, forecast]) =>
          askJarvis(
            said,
            shortcutPrompt("briefing", said, text, {
              now,
              machine: spokenStatus(machine),
              weather: forecast ? weatherReport(forecast) : undefined,
              agenda: events.length ? agendaReport(events) : undefined,
              tasks: pending.length ? tasksReport(pending) : undefined,
            }),
          ),
        );
      }
      case "weather": {
        // "como está o tempo em Curitiba amanhã": another city is answered, not kept.
        const place = placeIn(text);
        if (!place || !weather.city) openWindow("weather");
        // The widget asks for the city too.
        if (!place && !weather.city) return reply(said, line("weatherNoCity", userName));
        return void weather.forecast(place ?? undefined).then(
          (forecast) => reply(said, weatherLine(forecast, /amanh/i.test(said) ? "tomorrow" : "today", userName)),
          () => reply(said, line("weatherFailed", userName)),
        );
      }
      case "agenda": {
        // "repassa minha agenda": today's events and what is left on the list.
        const tomorrow = /amanh/i.test(said);
        const day = tomorrow ? addDays(dateKey(now), 1) : dateKey(now);
        const events = agenda.between(day, day);
        openWindow("agenda");
        return reply(said, tomorrow ? agendaLine(events, "amanhã", userName) : dayLine(events, tasks.list(), userName));
      }
      case "agendaRemove": {
        const id = leadingNumber(text);
        // "desmarca o compromisso do dentista": JARVIS finds it by name.
        if (id === null) return askJarvis(said);
        const removed = agenda.remove(id);
        if (!removed) return reply(said, line("agendaNotFound", userName, { id }));
        showDockNotice("widgets", `Agenda: ${removed.title} desmarcado`);
        return reply(said, line("agendaRemoved", userName, { id, title: removed.title }));
      }
      case "tasks":
        openWindow("tasks");
        return reply(said, tasksLine(tasks.list(), userName));
      case "taskAdd":
        return addTask(said, text);
      case "taskDone":
      case "taskRemove": {
        // "conclui a tarefa dois", "apaga a tarefa de comprar pão".
        const id = leadingNumber(text);
        const task = tasks.find(id ?? text);
        if (!task) return reply(said, line("taskNotFound", userName, { what: id !== null ? `número ${id}` : `“${reminderText(text)}”` }));
        const done = action === "taskDone";
        if (done) tasks.setDone(task.id);
        else tasks.remove(task.id);
        showDockNotice("widgets", `Tarefa ${task.id} ${done ? "concluída" : "apagada"}`);
        return reply(said, line(done ? "taskDone" : "taskRemoved", userName, { id: task.id, text: task.text }));
      }
      case "homecoming":
        return comeHome(said);
      case "chatMode":
        setMode("chat");
        return reply(said, line("chatMode", userName));
      case "desktopMode":
        setMode("desktop");
        return reply(said, line("desktopMode", userName));
      case "cleanup":
        return void runCleanup().then(
          (result) => reply(said, result ? cleanupLine(result, userName) : line("desktopOnly", userName)),
          (error: unknown) => notifyVoice(String(error), "error"),
        );
      case "reminder": {
        const parsed = parseReminder(text);
        // "às 15h", "amanhã de manhã": JARVIS reads the clock and sets it; with no when at all,
        // it is something to do today, for the list.
        if (!parsed) return mentionsWhen(text) ? askJarvis(said, shortcutPrompt("reminder", said, text, { now })) : addTask(said, text);
        if (!reminders.add(parsed.minutes, parsed.text)) return notifyVoice(line("reminderFailed", userName), "error");
        const when = describeDuration(parsed.minutes);
        return reply(said, parsed.text ? line("reminderSet", userName, { when, text: reminderText(parsed.text) }) : line("timerSet", userName, { when }));
      }
      case "time":
        return reply(said, timeLine(now, userName));
      case "date":
        return reply(said, dateLine(now, userName));
      case "status":
        return void readMachine().then((machine) => reply(said, statusLine(machine, userName)));
      case "focus":
        closeAll();
        openWindow("pomodoro");
        pomodoro.focus();
        return reply(said, line("focus", userName, { minutes: pomodoro.durations.focus }));
      case "note": {
        // "anota que tenho dentista sexta às 10": an appointment, which JARVIS puts on the agenda.
        if (mentionsWhen(text)) return askJarvis(said, shortcutPrompt("note", said, text, { now }));
        if (!desktop) return reply(said, line("desktopOnly", userName));
        const { date, time } = localStamp(now);
        return void invoke<string>("assistant_note", { text, date, time }).then(
          (path) => {
            reply(said, line("noted", userName));
            notifyVoice(`Anotado em ${baseName(path)}`);
            // The day's notes open in Jarvis Mark, to read and edit by hand.
            if (!openKinds.current.some((item) => item.kind === "markdown")) openWindow("markdown");
            noteRequests.send({ path, content: null, done: true });
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
  // In the chat his voice has a switch of its own, and any answer can be heard: a voice is enough.
  const chatVoice = useMemo(
    () => (voiceReady(speech.status, speechPrefs.voice) ? { voice: speechPrefs.voice, speed: speechPrefs.speed } : null),
    [speech.status, speechPrefs.voice, speechPrefs.speed],
  );
  const chatSpeech = useChatSpeech(chatVoice, setVoiceSource);
  // In the chat there is no core to show an answer and send it away: once it ends it is spoken
  // (with the chat's voice on) and leaves the stage; it is in its conversation by then.
  const { turn: lastTurn, dismiss: dismissTurn } = assistant;
  const { speak: speakInChat, stop: stopChatSpeech } = chatSpeech;
  useEffect(() => {
    if (!chat) return stopChatSpeech();
    if (!lastTurn?.done) return;
    if (chatPrefs.speak && lastTurn.id !== heardInCore.current && !lastTurn.cancelled && !lastTurn.error) speakInChat(lastTurn.id, lastTurn.text);
    dismissTurn();
  }, [chat, lastTurn, chatPrefs.speak, speakInChat, stopChatSpeech, dismissTurn]);
  /** A note or an agent JARVIS wrote: the app of the desktop that shows it. */
  const fileWindow = useCallback(
    (path: string): WindowKind | null =>
      !jarvisFolder ? null : isInside(path, jarvisFolder.notes) ? "markdown" : isInside(path, jarvisFolder.agents) && /\.md$/i.test(path) ? "agent" : null,
    [jarvisFolder],
  );
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
  /** Development-only: words "dictated" by the browser tests, which have no voice engine. */
  const [dictatedInTest, setDictatedInTest] = useState<{ id: number; text: string } | null>(null);
  const dictatedText = dictatedInTest ?? engine.dictation;
  const dictation = useMemo<DictationApi>(
    () => ({
      available: desktop,
      state: engineState === "dictating" ? "listening" : engine.dictationPending ? "transcribing" : "idle",
      hold: (down) => void holdDictation(down),
      text: dictatedText,
    }),
    [desktop, engineState, engine.dictationPending, dictatedText, holdDictation],
  );
  // The words go to the editor that was on screen when they were said, and only to it: a note of
  // the chat does not get what was dictated into Jarvis Mark, nor the other way round, whichever
  // comes on screen later.
  const dictatedWhere = useRef<{ id: number; chat: boolean } | null>(null);
  if (dictatedText && dictatedWhere.current?.id !== dictatedText.id) dictatedWhere.current = { id: dictatedText.id, chat };
  const dictatedInChat = dictatedWhere.current?.chat ?? false;
  const desktopDictation = useMemo<DictationApi>(
    () => (chat ? { ...dictation, state: "idle", text: null } : dictatedInChat ? { ...dictation, text: null } : dictation),
    [chat, dictation, dictatedInChat],
  );
  const chatDictation = useMemo<DictationApi>(() => (dictatedInChat ? dictation : { ...dictation, text: null }), [dictation, dictatedInChat]);

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

  const { paused, focused, reveal } = useWindowControls({
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
    onToggleMode: toggleMode,
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
      setGreetingText(null);
      setGreeting(Date.now());
      audio.pulse();
      window.setTimeout(audio.pulse, 1300);
      if (openSettings) setSettingsOpen(true);
    },
    [audio],
  );
  const endGreeting = useCallback(() => {
    setGreeting(null);
    setGreetingText(null);
    const next = afterGreeting.current;
    afterGreeting.current = null;
    next?.();
  }, []);
  const replayBoot = useCallback(() => {
    setAdvancedOpen(false);
    setGreeting(null);
    afterGreeting.current = null;
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
  // with the core off there is nothing to animate, so it stays closed. Waiting for "Hey Jarvis"
  // (standby) it stays closed too: a second capture and a per-frame analysis all day long, only
  // for the hologram to sway with the room's noise. It opens once he is awake.
  const visualCapture = isMicOpen(engineState) && engineState !== "standby" && corePrefs.mode !== "off";
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
    stocks,
    weather,
    agenda,
    tasks,
    show: openWindow,
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
        dictate: (text) => setDictatedInTest({ id: Date.now(), text }),
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
        {/* The desktop: under the chat it stays as it was, still (nothing ticks) and out of reach. */}
        <div data-testid="desktop-layer" inert={chat}>
        {/* Hidden or minimised, behind a maximised app or under the chat: nothing to draw. The
            first frame is always drawn: it reveals the window and starts the boot screen. */}
        {corePrefs.mode === "3d" ? (
          <Suspense fallback={null}>
            <JarvisScene
              quality={preset}
              ignition={booting || coreDark ? "standby" : ignitedAt}
              signals={audio.signals}
              sample={audio.sample}
              paused={paused || ((covered || chat) && firstFrame)}
              focused={focused}
              onFirstFrame={onFirstFrame}
              onQualityFallback={decline}
            />
          </Suspense>
        ) : corePrefs.mode === "2d" ? (
          <FlatCore
            ignition={booting || coreDark ? "standby" : ignitedAt}
            signals={audio.signals}
            sample={audio.sample}
            paused={paused || ((covered || chat) && firstFrame)}
            focused={focused}
            onFirstFrame={onFirstFrame}
          />
        ) : (
          <HiddenCore onFirstFrame={onFirstFrame} />
        )}
        <VoiceCaption heard={engine.heard} transcribing={engine.transcribing || assistant.phase === "transcribing"} />
        {greeting !== null && <Greeting key={greeting} name={userName} sound={bootPrefs.sound} text={greetingText ?? undefined} onDone={endGreeting} />}
        {corePrefs.mode !== "off" && !booting && greeting === null && (
          <CoreButton phase={assistant.phase} onPress={assistant.press} onRelease={assistant.release} />
        )}
        {assistant.turn && greeting === null && !chat && (
          <JarvisReply key={assistant.turn.id} turn={assistant.turn} sound={bootPrefs.sound} speech={replyVoice} onVoice={setVoiceSource} onFinished={assistant.dismiss} />
        )}
        <DictationContext.Provider value={desktopDictation}>
          <Desktop desktop={workspace} paused={paused || chat} timer={pomodoro} tui={tuiLook} music={music} feeds={{ stocks, weather, agenda, tasks }} conversation={conversation} />
        </DictationContext.Provider>
        {homecoming !== null && <Homecoming key={homecoming} onDone={lightsOn} />}
        </div>
        {/* Invisible strip to move the frameless window (double click toggles maximise). */}
        <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-20 h-7" />
        {chat && !booting && (
          <DictationContext.Provider value={chatDictation}>
          <Suspense fallback={null}>
            <ChatView
              assistant={assistant}
              top={taskbar ? 28 : 0}
              speak={chatPrefs.speak}
              onSpeak={(speak) => setChatPrefs((current) => ({ ...current, speak }))}
              speech={chatSpeech}
              onDesktop={() => setMode("desktop")}
              notice={dock.notice}
              canOpen={(path) => fileWindow(path) !== null}
              onOpenFile={(path) => {
                const kind = fileWindow(path);
                if (!kind) return;
                // A note stays in the chat, in its notes; an agent's draft is the desktop's jv_agent.
                if (kind === "markdown") {
                  setNoteRequest({ path, key: Date.now() });
                  return setChatPrefs((current) => ({ ...current, section: "notes" }));
                }
                setMode("desktop");
                workspace.open(kind);
                onAssistantFile({ path, content: null, done: true });
              }}
              section={chatPrefs.section}
              onSection={(section) => setChatPrefs((current) => ({ ...current, section }))}
              noteRequest={noteRequest}
              paused={paused}
              focused={focused}
              collapsed={chatPrefs.collapsed}
              onCollapsed={(collapsed) => setChatPrefs((current) => ({ ...current, collapsed }))}
              onRunAgent={(name, task) => {
                // With its own tools and wherever it works: that is the desktop's terminal (ADR-0007).
                if (!jarvisFolder) return notifyVoice("Disponível no app desktop");
                setMode("desktop");
                void launchAgent({ name, folder: `${jarvisFolder.agents}\\${name}`, task }).then(
                  (text) => notifyVoice(text),
                  (error: unknown) => notifyVoice(String(error), "error"),
                );
              }}
            />
          </Suspense>
          </DictationContext.Provider>
        )}
        {/* Like the dock, the bar comes in after the boot screen. */}
        <AnimatePresence>
          {taskbar && !booting && (
            <Taskbar
              // Under the chat the desktop's windows are out of reach: the bar does not offer them.
              windows={chat ? NO_WINDOWS : workspace.windows}
              focused={chat ? null : workspace.focused}
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
              chat={chat}
              onMode={toggleMode}
              paused={paused}
              modules={taskbarModules}
            />
          )}
        </AnimatePresence>
        <div inert={chat}>
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
          open={historyOpen && !chat}
          onOpenChange={setHistoryOpen}
          showToggle={corePrefs.mode !== "off" && !booting}
          items={assistant.items}
          turn={assistant.turn}
          busy={assistant.busy}
          coreActive={assistant.phase !== "idle"}
          onNewConversation={assistant.reset}
          onClear={assistant.clear}
        />
        </div>
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
          onCleanMemory={() => runCleanup().then((result) => (result ? cleanupSummary(result) : "Disponível no app desktop."))}
          onOpenAdvanced={openAdvanced}
          section={settingsSection}
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
