import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Mirrors `VoiceState` in `src-tauri/src/voice/mod.rs`. */
export type EngineState = "off" | "loading" | "standby" | "awake" | "listening" | "ready" | "talking" | "dictating" | "error";

export interface EngineStatus {
  state: EngineState;
  message: string | null;
}

export interface CommandEvent {
  appId: string;
  name: string;
  error: string | null;
}

/** "abre o relógio" / "fecha a calculadora": a JARVIS window to open or close. */
export interface WindowCommandEvent {
  /** A `WindowKind` (checked by the receiver). */
  kind: string;
  open: boolean;
}

/** A transcribed phrase; `id` changes even when the same words are heard twice. */
export interface Heard {
  id: number;
  text: string;
}

/** "fecha todos os widgets" / "todas as aplicações" / "tudo". */
export type WindowGroup = "widgets" | "apps" | "all";

/** jv_T4p3 by voice: "próxima música", "para a música", "muda a playlist", "toca a Flash FM". */
export type MusicAction = "next" | "previous" | "pause" | "resume" | "play" | "nextPlaylist" | "previousPlaylist";

/** The Pomodoro by voice: "inicia o pomodoro", "pula a fase", "mais cinco minutos". */
export type PomodoroAction = "start" | "pause" | "reset" | "skip" | "longer" | "shorter";

export interface MusicCommandEvent {
  action: MusicAction;
  /** "play" only: the playlist named, as heard (the UI knows the user's playlists). */
  target: string | null;
}

interface Handlers {
  onWake?: () => void;
  onCommand?: (event: CommandEvent) => void;
  onWindow?: (event: WindowCommandEvent) => void;
  onCloseGroup?: (group: WindowGroup) => void;
  onMusic?: (event: MusicCommandEvent) => void;
  onPomodoro?: (action: PomodoroAction) => void;
}

/** Returned by `start()` when the selected Whisper model has not been downloaded yet. */
export const MODEL_MISSING = "model-missing";

const ACTIVE: EngineState[] = ["loading", "standby", "awake", "listening", "ready", "talking", "dictating"];
/** The engine's microphone is open (push-to-talk "ready" keeps it closed). */
const MIC_OPEN: EngineState[] = ["standby", "awake", "listening", "talking", "dictating"];

export const isEngineActive = (state: EngineState) => ACTIVE.includes(state);
export const isMicOpen = (state: EngineState) => MIC_OPEN.includes(state);

/**
 * The Rust speech engine (Whisper): wake word, keywords and launching apps.
 * Only exists in the desktop app; in a browser `available` is false.
 */
export function useVoiceAssistant({ onWake, onCommand, onWindow, onCloseGroup, onMusic, onPomodoro }: Handlers = {}) {
  const available = isTauri();
  const [status, setStatus] = useState<EngineStatus>({ state: "off", message: null });
  const [heard, setHeard] = useState<Heard | null>(null);
  /** Whisper is working on a phrase that was just heard. */
  const [transcribing, setTranscribing] = useState(false);
  /** Markdown dictation: the last text transcribed, and whether Whisper is still working on one. */
  const [dictation, setDictation] = useState<Heard | null>(null);
  const [dictationPending, setDictationPending] = useState(false);
  const handlers = useRef({ onWake, onCommand, onWindow, onCloseGroup, onMusic, onPomodoro });
  handlers.current = { onWake, onCommand, onWindow, onCloseGroup, onMusic, onPomodoro };

  const hear = useCallback((text: string) => setHeard((current) => ({ id: (current?.id ?? 0) + 1, text })), []);

  useEffect(() => {
    if (!available) return;
    void invoke<EngineStatus>("voice_status").then(setStatus);
    const subscriptions = [
      listen<EngineStatus>("voice:state", ({ payload }) => {
        setStatus(payload);
        if (!isEngineActive(payload.state)) setTranscribing(false);
      }),
      listen<boolean>("voice:transcribing", ({ payload }) => setTranscribing(payload)),
      listen<{ text: string }>("voice:transcript", ({ payload }) => hear(payload.text)),
      listen("voice:wake", () => handlers.current.onWake?.()),
      listen<CommandEvent>("voice:command", ({ payload }) => handlers.current.onCommand?.(payload)),
      listen<WindowCommandEvent>("voice:window", ({ payload }) => handlers.current.onWindow?.(payload)),
      listen<{ group: WindowGroup }>("voice:windows", ({ payload }) => handlers.current.onCloseGroup?.(payload.group)),
      listen<MusicCommandEvent>("voice:music", ({ payload }) => handlers.current.onMusic?.(payload)),
      listen<{ action: PomodoroAction }>("voice:pomodoro", ({ payload }) => handlers.current.onPomodoro?.(payload.action)),
      listen<{ text: string; pending: boolean }>("voice:dictation", ({ payload }) => {
        setDictationPending(payload.pending);
        if (!payload.pending && payload.text) setDictation((current) => ({ id: (current?.id ?? 0) + 1, text: payload.text }));
      }),
    ];
    return () => subscriptions.forEach((subscription) => void subscription.then((stop) => stop()));
  }, [available, hear]);

  /** Starts listening; resolves to an error code/message, or null on success. */
  const start = useCallback(async (): Promise<string | null> => {
    try {
      setStatus(await invoke<EngineStatus>("voice_start"));
      return null;
    } catch (error) {
      const message = String(error);
      if (message !== MODEL_MISSING) setStatus({ state: "error", message });
      return message;
    }
  }, []);

  const stop = useCallback(async () => {
    setStatus(await invoke<EngineStatus>("voice_stop"));
  }, []);

  // Press and release must reach the engine in order, or a quick tap could leave it recording.
  const pushQueue = useRef(Promise.resolve<string | null>(null));

  /**
   * Push-to-talk button down/up (`cancel` discards the recording); resolves to an error
   * code/message, or null. The state changes arrive as events (the first press may also have
   * to load the model).
   */
  const push = useCallback((down: boolean, cancel = false) => {
    pushQueue.current = pushQueue.current.then(() =>
      invoke("voice_push", { down, cancel }).then(
        () => null,
        (error) => {
          const message = String(error);
          if (message !== MODEL_MISSING) setStatus({ state: "error", message });
          return message;
        },
      ),
    );
    return pushQueue.current;
  }, []);

  /** Markdown microphone down/up; same queue as `push`, so presses and releases stay in order. */
  const dictate = useCallback((down: boolean) => {
    pushQueue.current = pushQueue.current.then(() =>
      invoke("voice_dictate", { down }).then(
        () => null,
        (error) => {
          const message = String(error);
          if (message !== MODEL_MISSING) setStatus({ state: "error", message });
          return message;
        },
      ),
    );
    return pushQueue.current;
  }, []);

  return {
    available,
    status,
    heard,
    transcript: heard?.text ?? null,
    transcribing,
    hear,
    start,
    stop,
    push,
    dictate,
    dictation,
    dictationPending,
  };
}
