import type { CSSProperties } from "react";
import { useStoredState } from "./storage";
import { paletteFromHue } from "./theme";

/** The look of the terminal-style apps (Jarvis Mark, Jarvis Code), like an old phosphor terminal. */
export interface TuiPrefs {
  /** Red/blue fringes on the text, as on a misconverged CRT. */
  aberration: boolean;
  /** Phosphor glow around the text. */
  glow: boolean;
  /** "jarvis": the JARVIS colour; otherwise a preset accent. */
  accent: TuiAccent;
}

export type TuiAccent = "jarvis" | "phosphor" | "amber" | "cyan" | "magenta" | "red";

/** OKLCH hues of the preset accents (the whole palette is rotated, like the custom theme). */
export const TUI_ACCENTS: { value: TuiAccent; label: string; hue: number | null }[] = [
  { value: "jarvis", label: "Cor do JARVIS", hue: null },
  { value: "phosphor", label: "Fósforo verde", hue: 145 },
  { value: "amber", label: "Âmbar", hue: 75 },
  { value: "cyan", label: "Ciano", hue: 205 },
  { value: "magenta", label: "Magenta", hue: 330 },
  { value: "red", label: "Vermelho", hue: 25 },
];

const DEFAULT_TUI: TuiPrefs = { aberration: true, glow: true, accent: "jarvis" };

function parseTui(raw: unknown): TuiPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { aberration, glow, accent } = raw as Record<string, unknown>;
  return {
    aberration: typeof aberration === "boolean" ? aberration : DEFAULT_TUI.aberration,
    glow: typeof glow === "boolean" ? glow : DEFAULT_TUI.glow,
    accent: TUI_ACCENTS.some((item) => item.value === accent) ? (accent as TuiAccent) : DEFAULT_TUI.accent,
  };
}

/** Stored in `jarvis.tui`. */
export function useTuiPrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.tui", DEFAULT_TUI, parseTui);
  return [prefs, setPrefs] as const;
}

export interface TuiSurface {
  className: string;
  /** The accent's palette as `--color-hud-*` overrides: everything inside follows it. */
  style?: CSSProperties;
}

export function tuiSurface(prefs: TuiPrefs): TuiSurface {
  const hue = TUI_ACCENTS.find((item) => item.value === prefs.accent)?.hue ?? null;
  const style =
    hue === null
      ? undefined
      : (Object.fromEntries(Object.entries(paletteFromHue(hue)).map(([token, hex]) => [`--color-hud-${token}`, hex])) as CSSProperties);
  return {
    className: ["tui-surface", prefs.glow ? "tui-glow" : "", prefs.aberration ? "tui-aberration" : ""].filter(Boolean).join(" "),
    style,
  };
}
