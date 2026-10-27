import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSISTANT_KEY,
  assistantBackend,
  EMPTY_MEMORY,
  isBreak,
  MAX_ITEMS,
  parseMemory,
  type ConversationEntry,
} from "../lib/assistant";
import { useStoredState } from "../lib/storage";
import { MODEL_MISSING, type EngineState, type Heard } from "./useVoiceAssistant";

/** What the core is doing in the conversation. */
export type CorePhase = "idle" | "listening" | "transcribing" | "thinking" | "answering";

/** The question being answered (or the last one, while its answer is still on screen). */
export interface AssistantTurn {
  id: number;
  question: string;
  /** The answer so far (Markdown). */
  text: string;
  /** A tool in use ("WebSearch"), until the answer goes on. */
  tool: string | null;
  done: boolean;
  error: string | null;
  cancelled: boolean;
}

interface AssistantOptions {
  /** The desktop app's voice engine, for the core's microphone; null in a browser. */
  voice: {
    state: EngineState;
    /** The last question transcribed (empty text: nothing was said). */
    asked: Heard | null;
    record: (down: boolean, cancel?: boolean) => Promise<string | null>;
  } | null;
  /** Tells the user something (on the Voice dock item). */
  notify: (text: string, tone?: "info" | "error") => void;
  onModelMissing: () => void;
  /** A file JARVIS is writing (a note, an agent): its content so far, then `done`. */
  onFile?: (file: { path: string; content: string | null; done: boolean }) => void;
}

/** A shorter press on the core is a click (it toggles); a longer one is push-to-talk. */
const MIN_HOLD_MS = 350;
/** Whisper is done long before this; the core stops waiting anyway. */
const TRANSCRIBE_TIMEOUT_MS = 90_000;

/**
 * The conversation with JARVIS (Claude Code) through the core: a click opens the microphone,
 * the next sends the question; the answer streams in and lands in the history.
 */
export function useAssistant({ voice, notify, onModelMissing, onFile }: AssistantOptions) {
  const backend = useMemo(assistantBackend, []);
  const [memory, setMemory] = useStoredState(ASSISTANT_KEY, EMPTY_MEMORY, parseMemory);
  const [turn, setTurn] = useState<AssistantTurn | null>(null);
  /** The core's microphone is on: from the click until the question is sent or cancelled. */
  const [recording, setRecording] = useState(false);
  /** Sent: Whisper is working on the question. */
  const [transcribing, setTranscribing] = useState(false);
  const busy = turn !== null && !turn.done;
  const phase: CorePhase = recording ? "listening" : transcribing ? "transcribing" : busy ? (turn.text ? "answering" : "thinking") : "idle";

  const latest = useRef({ phase, busy, voice, sessionId: memory.sessionId, notify, onModelMissing, onFile });
  latest.current = { phase, busy, voice, sessionId: memory.sessionId, notify, onModelMissing, onFile };

  // Claude Code starts with JARVIS (~2 s saved on the first question), on the conversation it left.
  useEffect(() => {
    void backend?.warm(latest.current.sessionId).catch(() => undefined);
  }, [backend]);

  /**
   * Asks JARVIS. `question` is what the user said (shown, kept in the history); `prompt`, when
   * given, is what Claude Code gets instead (a shortcut's instructions around those words).
   */
  const ask = useCallback(
    (question: string, prompt?: string) => {
      const text = question.trim();
      if (!text) return;
      if (!backend) return latest.current.notify("Disponível no app desktop");
      if (latest.current.busy) return latest.current.notify("Ainda estou respondendo", "error");
      const id = Date.now();
      let streamed = "";
      /** Claude Code announced its session: the conversation goes on there. */
      let started = false;
      /** `lost`: the session is gone, the next question starts a new one. */
      const finish = (answer: string, error: string | null, cancelled: boolean, lost = false) => {
        setTurn((current) => (current?.id === id ? { ...current, text: answer, tool: null, done: true, error, cancelled } : current));
        const entry: ConversationEntry = { id, at: id, question: text, answer, ...(error ? { error } : {}), ...(cancelled ? { cancelled } : {}) };
        setMemory((current) => ({ sessionId: lost ? null : current.sessionId, items: [...current.items, entry].slice(-MAX_ITEMS) }));
      };
      setTurn({ id, question: text, text: "", tool: null, done: false, error: null, cancelled: false });
      backend
        .ask(prompt?.trim() || text, latest.current.sessionId, (event) => {
          switch (event.event) {
            case "session":
              started = true;
              setMemory((current) => (current.sessionId === event.id ? current : { ...current, sessionId: event.id }));
              break;
            case "delta":
              streamed += event.text;
              setTurn((current) => (current?.id === id ? { ...current, text: streamed, tool: null } : current));
              break;
            case "tool":
              setTurn((current) => (current?.id === id ? { ...current, tool: event.name } : current));
              break;
            case "file":
              latest.current.onFile?.(event);
              break;
            case "done":
              // Cancelled: what was already shown is what was said. Failed before Claude Code
              // announced a session (e.g. one that could not be resumed): that session is gone.
              finish(event.cancelled ? streamed : event.text || streamed, event.error, event.cancelled, event.error !== null && !started);
              break;
          }
        })
        .catch((error: unknown) => finish("", String(error), false));
    },
    [backend, setMemory],
  );

  /**
   * An answer JARVIS knows without Claude Code (the time, a reminder going off): shown and
   * spoken like any other, and kept in the history. False while he is busy answering.
   */
  const say = useCallback(
    (question: string, answer: string) => {
      if (latest.current.busy || latest.current.phase !== "idle") return false;
      const id = Date.now();
      setTurn({ id, question, text: answer, tool: null, done: true, error: null, cancelled: false });
      setMemory((current) => ({ ...current, items: [...current.items, { id, at: id, question, answer }].slice(-MAX_ITEMS) }));
      return true;
    },
    [setMemory],
  );

  /** Esc, or a click while JARVIS works: drops the question or stops the answer. */
  const cancel = useCallback(() => {
    const { phase, voice } = latest.current;
    if (phase === "listening") {
      setRecording(false);
      void voice?.record(false, true);
      latest.current.notify("Pergunta cancelada");
    } else if (phase === "transcribing") {
      // Whisper's text, when it comes, is dropped.
      setTranscribing(false);
      latest.current.notify("Pergunta cancelada");
    } else if (phase === "thinking" || phase === "answering") {
      // Claude Code stops with the answer: the next one is started right away, for the next question.
      void backend
        ?.cancel()
        .then(() => backend.warm(latest.current.sessionId))
        .catch(() => undefined);
    }
  }, [backend]);

  const listen = useCallback(async () => {
    const { voice, sessionId } = latest.current;
    if (!voice) return latest.current.notify("Disponível no app desktop");
    // The previous answer gives way to the new question.
    setTurn(null);
    setRecording(true);
    // Claude Code starts while the user talks.
    void backend?.warm(sessionId).catch(() => undefined);
    const error = await voice.record(true);
    if (!error) return;
    setRecording(false);
    if (error === MODEL_MISSING) latest.current.onModelMissing();
  }, [backend]);

  const send = useCallback(() => {
    const { voice } = latest.current;
    setRecording(false);
    if (!voice) return;
    // Sent before the microphone opened (the voice model was still loading): nothing to send.
    if (voice.state !== "asking") {
      void voice.record(false, true);
      return latest.current.notify("A voz ainda está carregando · tente de novo");
    }
    setTranscribing(true);
    void voice.record(false);
  }, []);

  // The core: a click toggles the microphone (or stops JARVIS); a long press is push-to-talk.
  const pressed = useRef<{ at: number; started: boolean } | null>(null);
  const press = useCallback(() => {
    const started = latest.current.phase === "idle";
    pressed.current = { at: performance.now(), started };
    if (started) void listen();
  }, [listen]);
  const release = useCallback(
    (cancelled = false) => {
      const press = pressed.current;
      pressed.current = null;
      if (!press) return;
      const listening = latest.current.phase === "listening";
      if (cancelled) {
        if (press.started && listening) cancel();
      } else if (press.started) {
        // Held: sent on release. A click keeps listening until the next one.
        if (listening && performance.now() - press.at >= MIN_HOLD_MS) send();
      } else if (listening) {
        send();
      } else {
        cancel();
      }
    },
    [cancel, send],
  );

  // Whisper's text: off to JARVIS.
  const asked = voice?.asked ?? null;
  useEffect(() => {
    if (!asked || latest.current.phase !== "transcribing") return;
    setTranscribing(false);
    if (asked.text.trim()) ask(asked.text);
    else latest.current.notify("Não ouvi nada");
  }, [asked, ask]);

  // The engine failed (or was turned off) under the question.
  const voiceState = voice?.state;
  useEffect(() => {
    if (voiceState === "error") {
      setRecording(false);
      setTranscribing(false);
    } else if (voiceState === "off") {
      setRecording(false);
    }
  }, [voiceState]);

  useEffect(() => {
    if (!transcribing) return;
    const timer = window.setTimeout(() => {
      setTranscribing(false);
      latest.current.notify("Não consegui entender a pergunta", "error");
    }, TRANSCRIBE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [transcribing]);

  /** The answer has been read: it leaves the screen (it stays in the history). */
  const dismiss = useCallback(() => setTurn((current) => (current?.done ? null : current)), []);

  // Esc cancels whatever the core is doing, or takes a finished answer off the screen.
  const showing = phase !== "idle" || turn !== null;
  useEffect(() => {
    if (!showing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (latest.current.phase === "idle") dismiss();
      else cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showing, cancel, dismiss]);

  /** "Nova conversa": JARVIS forgets what came before (the history keeps it, after a mark). */
  const reset = useCallback(() => {
    void backend
      ?.reset()
      .then(() => backend.warm(null))
      .catch(() => undefined);
    setTurn(null);
    setMemory(({ items }) => {
      const last = items[items.length - 1];
      const now = Date.now();
      return { sessionId: null, items: !last || isBreak(last) ? items : [...items, { id: now, at: now, newConversation: true as const }].slice(-MAX_ITEMS) };
    });
  }, [backend, setMemory]);

  /** Empties the history (and starts a new conversation). */
  const clear = useCallback(() => {
    void backend
      ?.reset()
      .then(() => backend.warm(null))
      .catch(() => undefined);
    setTurn(null);
    setMemory(EMPTY_MEMORY);
  }, [backend, setMemory]);

  return { available: backend !== null, phase, turn, busy, items: memory.items, ask, say, press, release, cancel, dismiss, reset, clear };
}
