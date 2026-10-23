import {
  AppWindow,
  Columns2,
  Gauge,
  Layers,
  LayoutGrid,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  Monitor,
  Music,
  Orbit,
  Pause,
  Play,
  SkipForward,
  PanelTop,
  Palette,
  PanelBottom,
  Power,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  SquareTerminal,
  SquareStack,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DesktopWindow, ArrangeMode } from "../hooks/useDesktop";
import type { MusicPlayer } from "../hooks/useMusicPlayer";
import { CORE_MODES, type CoreMode } from "./core";
import { WINDOW_KINDS, WINDOW_SPECS, type DesktopGroup, type WindowKind } from "./desktop";
import type { Command } from "./search";
import type { Activation, Background, Settings } from "./settings";
import type { Theme } from "./theme";

export type SettingsSection = "activation" | "appearance" | "voice" | "apps";
export type AdvancedTab = "colors" | "core" | "windows" | "layout" | "tui" | "taskbar" | "dock" | "voice";

/** Everything the commands act on; built by App. */
export interface CommandContext {
  windows: DesktopWindow[];
  openWindow: (kind: WindowKind) => void;
  closeWindow: (kind: WindowKind) => void;
  arrange: (mode: ArrangeMode) => void;
  closeAll: () => void;
  closeGroup: (group: DesktopGroup) => void;
  /** jv_T4p3's playback. */
  music: MusicPlayer;
  /** jv_sh's profiles (once known), and a way to open a tab with one. */
  terminalProfiles?: { id: string; name: string }[];
  openTerminalTab?: (profile: string) => void;
  settings: Settings | null;
  updateSettings: (change: (current: Settings) => Settings) => void;
  /** Launches a configured program (or says it needs the desktop app). */
  launchProgram: (id: string) => void;
  openSettings: (section?: SettingsSection) => void;
  openAdvanced: (tab?: AdvancedTab) => void;
  /** Opens the Widgets or the Apps launcher; null while the dock is turned off. */
  openLauncher: ((group: DesktopGroup) => void) | null;
  dockVisible: boolean;
  toggleDock: () => void;
  core: CoreMode;
  setCore: (mode: CoreMode) => void;
  listening: boolean;
  toggleListening: () => void;
  quality: string;
  cycleQuality: () => void;
  bootEnabled: boolean;
  toggleBoot: () => void;
  replayBoot: () => void;
  /** Tauri window actions; absent in a browser. */
  system: { fullscreen: () => void; minimize: () => void; quit: () => void } | null;
}

/** Extra words per window, so "hora" finds the clock and "notas" Jarvis Mark. */
const WINDOW_KEYWORDS: Record<WindowKind, string[]> = {
  clock: ["hora", "horas", "relogio", "clock", "time"],
  pomodoro: ["timer", "temporizador", "foco", "focus", "cronometro"],
  battery: ["bateria", "battery", "energia", "carga"],
  calculator: ["calculator", "conta", "contas", "matematica"],
  markdown: ["markdown", "md", "editor", "texto", "notas", "documento", "ditado"],
  code: ["codigo", "code", "editor", "programacao", "syntax", "ide"],
  music: ["musica", "music", "player", "tocador", "tape", "radio", "radios", "playlist", "vice city", "gta", "youtube"],
  shell: ["terminal", "shell", "console", "powershell", "bash", "cmd", "prompt", "wsl", "linha de comando"],
  tape: ["fita", "cassete", "tape", "musica", "widget"],
  miniplayer: ["mini", "player", "musica", "controles", "widget"],
};

const APP_SUBTITLES: Partial<Record<WindowKind, string>> = {
  markdown: "App · editor de Markdown",
  code: "App · editor de código",
  music: "App · rádios do GTA Vice City",
  shell: "App · seus perfis do Windows Terminal",
};

const THEMES: { value: Theme; label: string }[] = [
  { value: "blue", label: "Azul" },
  { value: "green", label: "Verde Matrix" },
  { value: "yellow", label: "Amarelo digital" },
  { value: "custom", label: "Personalizada" },
];

const BACKGROUNDS: { value: Background; label: string }[] = [
  { value: "solid", label: "Preto" },
  { value: "grid", label: "Grid côncavo" },
  { value: "matrix", label: "Matrix" },
];

const ACTIVATIONS: { value: Activation; label: string }[] = [
  { value: "pushToTalk", label: "Segurar para falar" },
  { value: "wakeWord", label: "Hey Jarvis" },
  { value: "always", label: "Sempre ouvindo" },
];

const SETTINGS_SECTIONS: { section: SettingsSection; title: string; keywords: string[] }[] = [
  { section: "activation", title: "Ativação", keywords: ["escuta", "microfone", "voz", "modo"] },
  { section: "appearance", title: "Aparência", keywords: ["cor", "tema", "fundo", "background"] },
  { section: "voice", title: "Reconhecimento de voz", keywords: ["whisper", "modelo", "idioma", "language", "download"] },
  { section: "apps", title: "Programas e palavras-chave", keywords: ["programas", "palavras", "keywords", "comandos", "atalhos"] },
];

const ADVANCED_TABS: { tab: AdvancedTab; title: string; keywords: string[] }[] = [
  { tab: "colors", title: "Cores", keywords: ["matiz", "hue", "cor", "tema", "fundo", "inicializacao", "bios"] },
  { tab: "core", title: "Núcleo", keywords: ["nucleo", "holograma", "core", "2d", "3d", "memoria", "ram", "desempenho", "leve", "desligar"] },
  { tab: "windows", title: "Janelas", keywords: ["encaixe", "snap", "opacidade", "transparencia"] },
  { tab: "layout", title: "Layout", keywords: ["organizar", "grade", "grid", "alinhamento"] },
  { tab: "tui", title: "TUI", keywords: ["terminal", "glow", "brilho", "aberracao", "cromatica", "acento", "editor", "fosforo"] },
  { tab: "taskbar", title: "Barra superior", keywords: ["barra", "taskbar", "waybar", "topo", "modulos", "relogio", "bateria"] },
  { tab: "dock", title: "Dock", keywords: ["dock", "barra inferior", "icones", "ampliar", "magnificacao", "esconder"] },
  { tab: "voice", title: "Voz", keywords: ["voz", "comandos", "frases", "falar", "palavras", "interacoes", "pomodoro", "musica", "verbos"] },
];

const ARRANGE: { mode: ArrangeMode; title: string; icon: LucideIcon; keywords: string[] }[] = [
  { mode: "tile", title: "Organizar janelas lado a lado", icon: Columns2, keywords: ["tile", "lado", "grade"] },
  { mode: "cascade", title: "Organizar janelas em cascata", icon: SquareStack, keywords: ["cascade", "cascata", "empilhar"] },
  { mode: "center", title: "Centralizar janelas", icon: Layers, keywords: ["center", "centro", "meio"] },
];

export function buildCommands(context: CommandContext): Command[] {
  const commands: Command[] = [];
  const openKinds = new Set(context.windows.map((window) => window.kind));

  // Widgets and apps: open (or bring to the front).
  for (const kind of WINDOW_KINDS) {
    const spec = WINDOW_SPECS[kind];
    const apps = spec.group === "apps";
    commands.push({
      id: `window:${kind}`,
      title: spec.title,
      subtitle: apps ? APP_SUBTITLES[kind] : "Widget",
      group: apps ? "Apps" : "Widgets",
      icon: spec.icon,
      keywords: [...WINDOW_KEYWORDS[kind], "abrir", "open"],
      badge: openKinds.has(kind) ? "aberto" : undefined,
      run: () => context.openWindow(kind),
    });
  }

  for (const window of context.windows) {
    const { title } = WINDOW_SPECS[window.kind];
    commands.push({
      id: `close:${window.kind}`,
      title: `Fechar ${title}`,
      subtitle: "Janela aberta",
      group: "Janelas",
      icon: X,
      keywords: ["fechar", "close", ...WINDOW_KEYWORDS[window.kind]],
      shortcut: "Ctrl W",
      run: () => context.closeWindow(window.kind),
    });
  }
  if (context.windows.length) {
    for (const item of ARRANGE) {
      commands.push({ id: `arrange:${item.mode}`, title: item.title, subtitle: "Layout", group: "Janelas", icon: item.icon, keywords: item.keywords, run: () => context.arrange(item.mode) });
    }
    commands.push({ id: "close-all", title: "Fechar todas as janelas", subtitle: "Também por voz: “fecha tudo”", group: "Janelas", icon: X, keywords: ["fechar", "close", "limpar", "tudo"], run: context.closeAll });
    if (context.windows.some((window) => WINDOW_SPECS[window.kind].group === "widgets")) {
      commands.push({ id: "close-widgets", title: "Fechar todos os widgets", subtitle: "Também por voz", group: "Janelas", icon: X, keywords: ["fechar", "widgets"], run: () => context.closeGroup("widgets") });
    }
    if (context.windows.some((window) => WINDOW_SPECS[window.kind].group === "apps")) {
      commands.push({ id: "close-apps", title: "Fechar todas as aplicações", subtitle: "Também por voz", group: "Janelas", icon: X, keywords: ["fechar", "apps", "aplicativos", "aplicacoes"], run: () => context.closeGroup("apps") });
    }
  }

  for (const app of context.settings?.apps ?? []) {
    commands.push({
      id: `program:${app.id}`,
      title: app.name,
      subtitle: `Programa · ${app.command || "sem comando"}`,
      group: "Programas",
      icon: AppWindow,
      keywords: [...app.keywords, "abrir", "programa"],
      run: () => context.launchProgram(app.id),
    });
  }

  // Menus.
  commands.push({ id: "settings", title: "Configurações", subtitle: "Painel lateral", group: "Menus", icon: Settings2, keywords: ["settings", "preferencias", "ajustes", "opcoes"], shortcut: "Ctrl ,", run: () => context.openSettings() });
  for (const item of SETTINGS_SECTIONS) {
    commands.push({ id: `settings:${item.section}`, title: `Configurações › ${item.title}`, group: "Menus", icon: Settings2, keywords: item.keywords, run: () => context.openSettings(item.section) });
  }
  commands.push({ id: "advanced", title: "Menu avançado", subtitle: "Cores, janelas e layout", group: "Menus", icon: SlidersHorizontal, keywords: ["advanced", "preferencias"], shortcut: "Ctrl Shift ,", run: () => context.openAdvanced() });
  for (const item of ADVANCED_TABS) {
    commands.push({ id: `advanced:${item.tab}`, title: `Menu avançado › ${item.title}`, group: "Menus", icon: SlidersHorizontal, keywords: item.keywords, run: () => context.openAdvanced(item.tab) });
  }
  // jv_sh: a new tab with any of the user's profiles.
  for (const profile of context.terminalProfiles ?? []) {
    commands.push({
      id: `shell-tab:${profile.id}`,
      title: `Nova aba: ${profile.name}`,
      subtitle: "jv_sh",
      group: "Apps",
      icon: SquareTerminal,
      keywords: ["terminal", "aba", "shell", "nova", profile.name.toLowerCase()],
      run: () => {
        context.openWindow("shell");
        context.openTerminalTab?.(profile.id);
      },
    });
  }

  const openLauncher = context.openLauncher;
  if (openLauncher) {
    commands.push({ id: "launcher:widgets", title: "Menu de widgets", subtitle: "Acima do item Widgets da dock", group: "Menus", icon: LayoutGrid, keywords: ["launcher", "lancador", "widgets"], run: () => openLauncher("widgets") });
    commands.push({ id: "launcher:apps", title: "Menu de apps", subtitle: "Acima do item Apps da dock", group: "Menus", icon: AppWindow, keywords: ["launcher", "lancador", "apps", "aplicativos", "aplicacoes"], run: () => openLauncher("apps") });
  }

  // Music: each station and playlist plays from its first song, in jv_T4p3.
  const music = context.music;
  for (const station of music.playlists.filter((playlist) => playlist.tracks.length)) {
    commands.push({
      id: `music:${station.id}`,
      title: `Tocar ${station.name}`,
      subtitle: station.custom ? `jv_T4p3 · sua playlist · ${station.tracks.length} músicas` : `jv_T4p3 · ${station.genre}`,
      group: "Música",
      icon: Music,
      keywords: ["tocar", "radio", "musica", "vice city", "gta", "play", station.genre.toLowerCase()],
      badge: music.current?.station.id === station.id ? "no ar" : undefined,
      run: () => {
        context.openWindow("music");
        music.play(station.id, 0);
      },
    });
  }
  if (music.current) {
    const playing = music.status === "playing";
    commands.push({
      id: "music:toggle",
      title: playing ? "Pausar a música" : "Retomar a música",
      subtitle: `${music.current.track.title} — ${music.current.track.artist}`,
      group: "Música",
      icon: playing ? Pause : Play,
      keywords: ["musica", "pausar", "tocar", "play", "pause"],
      run: music.toggle,
    });
    commands.push({ id: "music:next", title: "Próxima música", subtitle: music.current.station.name, group: "Música", icon: SkipForward, keywords: ["musica", "proxima", "pular", "next", "skip"], run: music.next });
  }

  // Appearance.
  const settings = context.settings;
  if (settings) {
    for (const theme of THEMES) {
      commands.push({
        id: `theme:${theme.value}`,
        title: `Cor do JARVIS: ${theme.label}`,
        group: "Aparência",
        icon: Palette,
        keywords: ["tema", "theme", "cor", "color"],
        badge: settings.theme === theme.value ? "atual" : undefined,
        run: () => context.updateSettings((current) => ({ ...current, theme: theme.value })),
      });
    }
    for (const background of BACKGROUNDS) {
      commands.push({
        id: `background:${background.value}`,
        title: `Fundo: ${background.label}`,
        group: "Aparência",
        icon: Monitor,
        keywords: ["fundo", "background", "wallpaper"],
        badge: settings.background === background.value ? "atual" : undefined,
        run: () => context.updateSettings((current) => ({ ...current, background: background.value })),
      });
    }
    commands.push({
      id: "taskbar",
      title: settings.taskbar ? "Ocultar a barra superior" : "Mostrar a barra superior",
      group: "Aparência",
      icon: PanelTop,
      keywords: ["barra", "taskbar", "waybar", "topo", "superior", "panel"],
      run: () => context.updateSettings((current) => ({ ...current, taskbar: !current.taskbar })),
    });
    for (const activation of ACTIVATIONS) {
      commands.push({
        id: `activation:${activation.value}`,
        title: `Modo de ativação: ${activation.label}`,
        group: "Voz",
        icon: Mic,
        keywords: ["ativacao", "voz", "escuta", "modo", "microfone"],
        badge: settings.activation === activation.value ? "atual" : undefined,
        run: () => context.updateSettings((current) => ({ ...current, activation: activation.value })),
      });
    }
  }
  for (const mode of CORE_MODES) {
    commands.push({
      id: `core:${mode.value}`,
      title: `Núcleo: ${mode.label}`,
      group: "Aparência",
      icon: Orbit,
      keywords: ["nucleo", "holograma", "core", "memoria", "ram", "desempenho", "leve", "desligar"],
      badge: context.core === mode.value ? "atual" : undefined,
      run: () => context.setCore(mode.value),
    });
  }
  commands.push({
    id: "dock",
    title: context.dockVisible ? "Ocultar a dock" : "Mostrar a dock",
    group: "Aparência",
    icon: PanelBottom,
    keywords: ["dock", "barra inferior", "icones", "esconder"],
    run: context.toggleDock,
  });
  commands.push({
    id: "listening",
    title: context.listening ? "Desligar a escuta" : "Ligar a escuta",
    group: "Voz",
    icon: context.listening ? MicOff : Mic,
    keywords: ["escuta", "microfone", "voz", "voice", "ouvir"],
    shortcut: "M",
    run: context.toggleListening,
  });

  // System.
  commands.push({ id: "quality", title: "Alternar qualidade gráfica", subtitle: `Atual: ${context.quality.toUpperCase()}`, group: "Sistema", icon: Gauge, keywords: ["qualidade", "quality", "desempenho", "performance"], shortcut: "Ctrl Shift Q", run: context.cycleQuality });
  commands.push({ id: "boot-replay", title: "Ver a tela de inicialização", group: "Sistema", icon: ScanLine, keywords: ["bios", "boot", "inicializacao", "crt"], run: context.replayBoot });
  commands.push({
    id: "boot-toggle",
    title: context.bootEnabled ? "Desativar a tela de inicialização" : "Ativar a tela de inicialização",
    group: "Sistema",
    icon: ScanLine,
    keywords: ["bios", "boot", "inicializacao"],
    run: context.toggleBoot,
  });
  if (context.system) {
    const system = context.system;
    commands.push({ id: "fullscreen", title: "Tela cheia", group: "Sistema", icon: Maximize, keywords: ["fullscreen", "cheia"], shortcut: "F11", run: system.fullscreen });
    commands.push({ id: "minimize", title: "Minimizar o JARVIS", group: "Sistema", icon: Minimize, keywords: ["minimizar", "minimize", "esconder"], shortcut: "Ctrl M", run: system.minimize });
    commands.push({ id: "quit", title: "Fechar o JARVIS", group: "Sistema", icon: Power, keywords: ["sair", "quit", "fechar", "encerrar"], shortcut: "Ctrl Q", run: system.quit });
  }
  return commands;
}
