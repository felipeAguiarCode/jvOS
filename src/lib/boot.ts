import type { ModelStatus, Settings } from "./settings";
import { useStoredState } from "./storage";
import type { Theme } from "./theme";

/** Boot screen preferences (`jarvis.boot`), read synchronously so it shows from the first frame. */
export interface BootPrefs {
  /** The BIOS-style sequence plays when JARVIS starts. */
  enabled: boolean;
  /** POST beep and keyboard clicks. */
  sound: boolean;
}

const DEFAULT_BOOT: BootPrefs = { enabled: true, sound: true };

function parseBoot(raw: unknown): BootPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { enabled, sound } = raw as Record<string, unknown>;
  return {
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_BOOT.enabled,
    sound: typeof sound === "boolean" ? sound : DEFAULT_BOOT.sound,
  };
}

export function useBootPrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.boot", DEFAULT_BOOT, parseBoot);
  return [prefs, setPrefs] as const;
}

export type BootStatus = "ok" | "warn" | "skip";

/** What the POST reports about JARVIS itself (settings, voice model, session). */
export interface BootInfo {
  version: string;
  quality: string;
  voice: { value: string; status: BootStatus };
  activation: string;
  matrix: string;
  modules: number;
  windows: number;
}

const ACTIVATION_LABEL: Record<Settings["activation"], string> = {
  pushToTalk: "Segurar para falar",
  wakeWord: "Hey Jarvis",
  always: "Sempre ouvindo",
};

const THEME_LABEL: Record<Exclude<Theme, "custom">, string> = { blue: "Azul", green: "Verde Matrix", yellow: "Amarelo digital" };
const BACKGROUND_LABEL: Record<Settings["background"], string> = { solid: "Preto", grid: "Grid côncavo", matrix: "Matrix" };

export function describeBoot({
  settings,
  models,
  desktop,
  quality,
  modules,
  windows,
}: {
  settings: Settings | null;
  models: ModelStatus[];
  /** The Rust voice engine exists (desktop app). */
  desktop: boolean;
  quality: string;
  modules: number;
  windows: number;
}): BootInfo {
  const model = settings ? models.find((item) => item.id === settings.model) : undefined;
  const voice: BootInfo["voice"] = !desktop
    ? { value: "modo navegador · só visual", status: "skip" }
    : !model
      ? { value: "verificando…", status: "skip" }
      : model.downloaded
        ? { value: `Whisper ${model.label}`, status: "ok" }
        : { value: `Whisper ${model.label} · não baixado`, status: "warn" };
  const theme = !settings ? "…" : settings.theme === "custom" ? `Personalizada ${Math.round(settings.accentHue)}°` : THEME_LABEL[settings.theme];
  return {
    version: __APP_VERSION__,
    quality: quality.toUpperCase(),
    voice,
    activation: settings ? ACTIVATION_LABEL[settings.activation] : "…",
    matrix: settings ? `${theme} · ${BACKGROUND_LABEL[settings.background]}` : "…",
    modules,
    windows,
  };
}

/** What the POST reports about the machine. */
export interface SystemProbe {
  cpu: string;
  gpu: string;
  screen: string;
  memoryKb: number;
  audio: boolean;
}

/** The WebGL renderer, without ANGLE's wrapping ("ANGLE (Intel, Intel(R) UHD Graphics (0x…) Direct3D11…, D3D11)"). */
function gpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "sem WebGL";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    const angle = /^ANGLE \([^,]+, (.+), [^,]+\)$/.exec(raw);
    const name = (angle ? angle[1] : raw)
      .replace(/\s*\(0x[0-9a-f]+\)/i, "")
      .replace(/\s+(Direct3D|OpenGL|Vulkan).*$/i, "")
      .trim();
    return name.length > 46 ? `${name.slice(0, 45)}…` : name || "WebGL";
  } catch {
    return "WebGL";
  }
}

export function probeSystem(): SystemProbe {
  const threads = navigator.hardwareConcurrency || 4;
  // Chromium caps this at 8 GB for privacy.
  const gigabytes = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const ratio = Math.round(window.devicePixelRatio * 100) / 100;
  return {
    cpu: `${threads} núcleos lógicos`,
    gpu: gpuName(),
    screen: `${window.screen.width} × ${window.screen.height} @ ${ratio.toLocaleString("pt-BR")}x`,
    memoryKb: Math.round(gigabytes * 1024 * 1024),
    audio: typeof AudioContext !== "undefined",
  };
}
