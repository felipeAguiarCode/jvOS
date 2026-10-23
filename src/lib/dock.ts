import { useStoredState } from "./storage";

/** The dock's own preferences, set in the advanced menu. */
export interface DockPrefs {
  /** Off: the dock leaves the screen; its notices still show at the bottom. */
  visible: boolean;
  /** The icon under the pointer grows, macOS style. */
  magnify: boolean;
}

const DEFAULT_DOCK: DockPrefs = { visible: true, magnify: true };

function parseDock(raw: unknown): DockPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { visible, magnify } = raw as Record<string, unknown>;
  return {
    visible: typeof visible === "boolean" ? visible : DEFAULT_DOCK.visible,
    magnify: typeof magnify === "boolean" ? magnify : DEFAULT_DOCK.magnify,
  };
}

/** Stored in `jarvis.dock`. */
export function useDockPrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.dock", DEFAULT_DOCK, parseDock);
  return [prefs, setPrefs] as const;
}
