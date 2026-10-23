import { createContext, useContext } from "react";

export interface DictationText {
  /** Changes on every dictation, even when the same words come back. */
  id: number;
  text: string;
}

/** Markdown dictation, driven by the Rust voice engine; provided by App, used by the editor. */
export interface DictationApi {
  /** False in a browser: the engine only exists in the desktop app. */
  available: boolean;
  state: "idle" | "listening" | "transcribing";
  /** Microphone button down/up. */
  hold: (down: boolean) => void;
  text: DictationText | null;
}

export const DictationContext = createContext<DictationApi>({ available: false, state: "idle", hold: () => undefined, text: null });

export const useDictation = () => useContext(DictationContext);
