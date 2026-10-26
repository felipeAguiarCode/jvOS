import { useCallback } from "react";
import { useStoredState } from "../lib/storage";

/** Parts of a widget that can be shown or hidden, by name. */
export type WidgetToggles = Record<string, boolean>;

function parseToggles<T extends WidgetToggles>(raw: unknown, defaults: T): T | null {
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as Record<string, unknown>;
  return Object.fromEntries(Object.entries(defaults).map(([name, on]) => [name, typeof stored[name] === "boolean" ? stored[name] : on])) as T;
}

/** A widget's on/off options (its right-click menu), kept in `jarvis.widget.<name>`. */
export function useWidgetOptions<T extends WidgetToggles>(name: string, defaults: T) {
  const [options, setOptions] = useStoredState(`jarvis.widget.${name}`, defaults, (raw) => parseToggles(raw, defaults));
  const toggle = useCallback((option: keyof T) => setOptions((current) => ({ ...current, [option]: !current[option] })), [setOptions]);
  return [options, toggle] as const;
}
