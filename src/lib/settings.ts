import { invoke, isTauri } from "@tauri-apps/api/core";
import { DEFAULT_HUE, type Theme } from "./theme";
import voiceDefaults from "../../src-tauri/voice-commands.json";

/** Mirrors `src-tauri/src/settings.rs`. */
export type Activation = "wakeWord" | "always" | "pushToTalk";
export type Language = "pt" | "en" | "auto";
/** Mirrors `BACKGROUNDS` in src-tauri/src/settings.rs. */
export type Background = "solid" | "grid" | "matrix";

export interface AppEntry {
  id: string;
  name: string;
  keywords: string[];
  /** Executable (on PATH or a quoted path) plus arguments, or a URL. */
  command: string;
  /** Dock apps: cannot be removed or renamed. */
  builtin: boolean;
}

/** What a voice command does. Mirrors `VoiceCommand` in src-tauri/src/settings.rs. */
export type VoiceCommandKind = "window" | "group" | "music" | "pomodoro" | "playlist" | "shortcut" | "verbs" | "playVerbs";

/** The Claude model JARVIS answers with. Mirrors `ASSISTANT_MODELS` in src-tauri/src/settings.rs. */
export type AssistantModel = "haiku" | "sonnet" | "opus" | "default";

export const ASSISTANT_MODELS: { value: AssistantModel; label: string; hint: string }[] = [
  { value: "haiku", label: "Haiku", hint: "O mais rápido" },
  { value: "sonnet", label: "Sonnet", hint: "Rápido e capaz, recomendado" },
  { value: "opus", label: "Opus", hint: "O mais inteligente, responde mais devagar" },
  { value: "default", label: "Padrão", hint: "O modelo e o esforço do seu Claude Code" },
];

/** A spoken interaction (Menu avançado → Voz): built-in ones can only change their phrases. */
export interface VoiceCommand {
  id: string;
  kind: VoiceCommandKind;
  /** The window, group, action or (for "playlist") the playlist's name. */
  target: string;
  label: string;
  phrases: string[];
  builtin: boolean;
}

/** The built-in commands, from the same file the Rust side reads. */
export const DEFAULT_VOICE_COMMANDS: VoiceCommand[] = (voiceDefaults as Omit<VoiceCommand, "builtin">[]).map((command) => ({
  ...(command as Omit<VoiceCommand, "builtin">),
  builtin: true,
}));

/** Browser twin of the Rust sanitiser: built-ins keep their action and come back if missing. */
export function withBuiltinCommands(commands: VoiceCommand[] | undefined): VoiceCommand[] {
  const stored = Array.isArray(commands) ? commands : [];
  const builtins = DEFAULT_VOICE_COMMANDS.map((command) => {
    const saved = stored.find((item) => item.id === command.id);
    return saved && Array.isArray(saved.phrases) ? { ...command, phrases: saved.phrases } : command;
  });
  const custom = stored.filter((item) => item.id.startsWith("custom-")).map((item) => ({ ...item, builtin: false }));
  return [...builtins, ...custom];
}

export const createVoiceCommandId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export interface Settings {
  voiceEnabled: boolean;
  activation: Activation;
  model: string;
  /** JARVIS's brain (Claude Code `--model`). */
  assistantModel: AssistantModel;
  language: Language;
  /** Color of the hologram and the interface. */
  theme: Theme;
  /** OKLCH hue (0..359) of the "custom" theme. */
  accentHue: number;
  /** Backdrop behind the hologram. */
  background: Background;
  /** Waybar-style bar along the top of the screen (on by default). */
  taskbar: boolean;
  apps: AppEntry[];
  /** Everything the voice understands besides the programs' keywords. */
  voiceCommands: VoiceCommand[];
}

export interface ModelStatus {
  id: string;
  label: string;
  description: string;
  size: number;
  downloaded: boolean;
  downloading: boolean;
}

/** Browser fallback (development and UI tests) — the desktop app keeps these in Rust. */
const DEFAULT_SETTINGS: Settings = {
  voiceEnabled: false,
  activation: "pushToTalk",
  model: "small",
  assistantModel: "sonnet",
  language: "pt",
  theme: "blue",
  accentHue: DEFAULT_HUE,
  background: "solid",
  taskbar: true,
  apps: [
    { id: "browser", name: "Browser", keywords: ["navegador", "browser", "internet"], command: "https://www.google.com", builtin: true },
    { id: "vscode", name: "VS Code", keywords: ["vs code", "visual studio code", "editor de código"], command: "code", builtin: true },
    // "terminal" itself opens jv_sh, the terminal inside JARVIS.
    { id: "terminal", name: "Windows Terminal", keywords: ["windows terminal"], command: "wt", builtin: true },
    { id: "claude", name: "Claude Code", keywords: ["claude code", "claude", "cloud code"], command: "wt claude", builtin: true },
  ],
  voiceCommands: DEFAULT_VOICE_COMMANDS,
};

const BROWSER_MODELS: ModelStatus[] = [
  { id: "small", label: "Small", description: "Rápido e preciso, recomendado", size: 190_085_487, downloaded: false, downloading: false },
  { id: "base", label: "Base", description: "O mais rápido, erra mais palavras", size: 59_707_625, downloaded: false, downloading: false },
  { id: "large-v3-turbo", label: "Large V3 Turbo", description: "O mais preciso, muito lento sem GPU", size: 574_041_195, downloaded: false, downloading: false },
];

const STORAGE_KEY = "jarvis.settings";

export async function loadSettings(): Promise<Settings> {
  if (isTauri()) return invoke<Settings>("get_settings");
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const saved = JSON.parse(stored) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...saved, voiceCommands: withBuiltinCommands(saved.voiceCommands) };
    }
  } catch {
    // Corrupt or unavailable storage — use the defaults.
  }
  return structuredClone(DEFAULT_SETTINGS);
}

/** Persists and returns the sanitised settings (the backend trims and validates them). */
export async function saveSettings(settings: Settings): Promise<Settings> {
  if (isTauri()) return invoke<Settings>("save_settings", { settings });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the change only lasts for this session.
  }
  return settings;
}

export async function loadModels(): Promise<ModelStatus[]> {
  return isTauri() ? invoke<ModelStatus[]>("models_status") : BROWSER_MODELS;
}

export function createAppId() {
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
