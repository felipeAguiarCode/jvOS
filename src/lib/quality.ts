import { useCallback, useState } from "react";

export type QualityLevel = "low" | "medium" | "high";

export interface QualityPreset {
  level: QualityLevel;
  /** Upper bound for the canvas device pixel ratio. */
  maxDpr: number;
  /** MSAA samples of the post-processing composer (the canvas itself is not antialiased). */
  msaa: number;
  particles: number;
  /** 0..1 multiplier for wireframe line counts. */
  wireDensity: number;
  bloomLevels: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { level: "low", maxDpr: 1, msaa: 2, particles: 350, wireDensity: 0.5, bloomLevels: 5 },
  medium: { level: "medium", maxDpr: 1.25, msaa: 4, particles: 800, wireDensity: 0.75, bloomLevels: 7 },
  high: { level: "high", maxDpr: 1.5, msaa: 4, particles: 1400, wireDensity: 1, bloomLevels: 8 },
};

const LEVELS: QualityLevel[] = ["low", "medium", "high"];
const STORAGE_KEY = "jarvis.quality";

function isLevel(value: unknown): value is QualityLevel {
  return typeof value === "string" && (LEVELS as string[]).includes(value);
}

function readStored(): QualityLevel | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLevel(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(level: QualityLevel) {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}

/** Guess a level from the WebGL renderer string (integrated / software GPUs get less). */
function detectFromGpu(): QualityLevel {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "low";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) return "low";
    if (/intel|uhd|iris|mali|adreno|apple m1/i.test(renderer)) return "medium";
    return "high";
  } catch {
    return "medium";
  }
}

/**
 * Resolution order: `?quality=` → persisted choice → GPU heuristic.
 * An explicit choice (URL or persisted) is "locked": the runtime FPS monitor won't downgrade it.
 */
function resolveInitial(): { level: QualityLevel; locked: boolean } {
  const fromUrl = new URLSearchParams(window.location.search).get("quality");
  if (isLevel(fromUrl)) return { level: fromUrl, locked: true };
  const stored = readStored();
  if (stored) return { level: stored, locked: true };
  return { level: detectFromGpu(), locked: false };
}

export function useQuality() {
  const [state, setState] = useState(resolveInitial);

  /** Manual cycle (Ctrl+Shift+Q): persists and locks the choice. */
  const cycle = useCallback(() => {
    setState(({ level }) => {
      const next = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
      writeStored(next);
      return { level: next, locked: true };
    });
  }, []);

  /** Automatic downgrade after sustained low FPS; ignored when the user picked a level. */
  const decline = useCallback(() => {
    setState((current) => {
      if (current.locked || current.level === "low") return current;
      return { level: LEVELS[LEVELS.indexOf(current.level) - 1], locked: false };
    });
  }, []);

  return { preset: QUALITY_PRESETS[state.level], cycle, decline };
}
