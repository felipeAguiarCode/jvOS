%%#command%%
import { invoke, isTauri } from "@tauri-apps/api/core";
%%/command%%
%%#data%%
import { useStoredState } from "./storage";
%%/data%%

/** %%title%% (feature %%id%%). What it does and why: .specs/features/%%id%%/spec.md. */

/** "  um   texto " → "um texto": the feature's first pure rule, tested in tests/%%id%%.spec.ts. */
export const tidy%%pascal%% = (text: string) => text.replace(/\s+/g, " ").trim();
%%#data%%

/** The feature's preferences (`%%storageKey%%`). */
export interface %%pascal%%Prefs {
  enabled: boolean;
}

const DEFAULT_%%CONST%%: %%pascal%%Prefs = { enabled: true };

/** Tolerant: a bad field takes its default; anything but an object is null. */
export function parse%%pascal%%(raw: unknown): %%pascal%%Prefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { enabled } = raw as Record<string, unknown>;
  return { enabled: typeof enabled === "boolean" ? enabled : DEFAULT_%%CONST%%.enabled };
}

export function use%%pascal%%Prefs() {
  const [prefs, setPrefs] = useStoredState("%%storageKey%%", DEFAULT_%%CONST%%, parse%%pascal%%);
  return [prefs, setPrefs] as const;
}
%%/data%%
%%#command%%

declare global {
  interface Window {
    /** Development-only stand-in for the Playwright checks (the browser has no Rust side). */
    __JARVIS_%%CONST%%__?: string;
  }
}

/** `%%command%%` in Rust; the DEV stand-in in a browser test; an error outside the app. */
export async function fetch%%pascal%%(): Promise<string> {
  const fake = import.meta.env.DEV ? window.__JARVIS_%%CONST%%__ : undefined;
  if (fake !== undefined) return fake;
  if (!isTauri()) throw new Error("Disponível no app desktop");
  return invoke<string>("%%command%%");
}
%%/command%%
