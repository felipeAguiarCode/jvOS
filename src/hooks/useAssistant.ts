import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSISTANT_KEY,
  assistantBackend,
  CONVERSATIONS_KEY,
  conversationTitle,
  emptyStore,
  MAX_ANSWERING,
  MAX_CONVERSATIONS,
  MAX_ITEMS,
  migrateMemory,
  newConversation,
  parseConversations,
  parseMemory,
  TOO_MANY,
  type Conversation,
  type ConversationEntry,
  type ConversationStore,
} from "../lib/assistant";
import { readJson, useStoredState } from "../lib/storage";
import { MODEL_MISSING, type EngineState, type Heard } from "./useVoiceAssistant";

/** What the core is doing in the conversation. */
export type CorePhase = "idle" | "listening" | "transcribing" | "thinking" | "answering";

/** The streamed answer is rendered at most this often (~30 times a second). */
const STREAM_STEP_MS = 32;

/** The question being answered (or the last one, while its answer is still on screen). */
export interface AssistantTurn {
  id: number;
  /** The conversation it was asked in (it lands there even if another one is on screen by then). */
  conversationId: string;
  question: string;
  /** The answer so far (Markdown). */
  text: string;
  /** A tool in use ("WebSearch"), until the answer goes on. */
  tool: string | null;
  /** Every tool used so far, in order, without repeating one in a row. */
  steps: string[];
  /** The files written so far. */
  files: string[];
  /** The files read so far (the notes consulted). */
  sources: string[];
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

/** What `useAssistant` hands out: the conversations, the answers in progress and what can be done with them. */
export type Assistant = ReturnType<typeof useAssistant>;

/** The conversation's items with one more, named after its first question unless the user named it. */
function withEntry(conversation: Conversation, entry: ConversationEntry, sessionId: string | null): Conversation {
  return {
    ...conversation,
    title: conversation.items.length === 0 && !conversation.renamed ? conversationTitle(entry.question) : conversation.title,
    sessionId,
    updatedAt: entry.at,
    items: [...conversation.items, entry].slice(-MAX_ITEMS),
  };
}

/** The conversation on screen; the store always has one. */
const activeOf = (store: ConversationStore) => store.conversations.find((conversation) => conversation.id === store.activeId) ?? store.conversations[0];

/** Where a conversation's questions go: its own Claude Code process, and the agent that answers there. */
const placeOf = (conversation: Conversation) => ({ conversationId: conversation.id, ...(conversation.agent ? { agent: conversation.agent } : {}) });

/**
 * The conversations with JARVIS (Claude Code) and with the agents he installed. Through the core,
 * a click opens the microphone and the next sends the question; in the chat it is typed. The
 * answer streams in and lands in the conversation it was asked in. Each conversation has its
 * own Claude Code process and session: several are answered at once (`MAX_ANSWERING`), one
 * answer at a time in each.
 */
export function useAssistant({ voice, notify, onModelMissing, onFile }: AssistantOptions) {
  const backend = useMemo(assistantBackend, []);
  // Before the conversations there was a single history (`jarvis.assistant`): it becomes them, once.
  const [initial] = useState(() => migrateMemory(readJson(ASSISTANT_KEY, parseMemory)));
  const [store, setStore] = useStoredState(CONVERSATIONS_KEY, initial, parseConversations);
  const active = activeOf(store);
  /** By conversation: its answer in progress, or its last one while still on screen. */
  const [turns, setTurns] = useState<Record<string, AssistantTurn>>({});
  /** The conversation on screen's: what the core and the chat show. */
  const turn = turns[active.id] ?? null;
  /** The core's microphone is on: from the click until the question is sent or cancelled. */
  const [recording, setRecording] = useState(false);
  /** Sent: Whisper is working on the question. */
  const [transcribing, setTranscribing] = useState(false);
  const busy = turn !== null && !turn.done;
  const phase: CorePhase = recording ? "listening" : transcribing ? "transcribing" : busy ? (turn.text ? "answering" : "thinking") : "idle";
  /** The conversations being answered now. */
  const answering = useMemo(
    () =>
      Object.values(turns)
        .filter((item) => !item.done)
        .map((item) => item.conversationId),
    [turns],
  );

  const latest = useRef({ phase, busy, voice, store, turns, answering, active, notify, onModelMissing, onFile });
  latest.current = { phase, busy, voice, store, turns, answering, active, notify, onModelMissing, onFile };

  /** Changes a conversation's turn, if it still is the one given. */
  const patchTurn = useCallback((conversationId: string, id: number, change: (turn: AssistantTurn) => AssistantTurn) => {
    setTurns((current) => (current[conversationId]?.id === id ? { ...current, [conversationId]: change(current[conversationId]) } : current));
  }, []);
  const dropTurn = useCallback((conversationId: string, only?: (turn: AssistantTurn) => boolean) => {
    setTurns((current) => {
      const found = current[conversationId];
      if (!found || (only && !only(found))) return current;
      const { [conversationId]: _gone, ...rest } = current;
      return rest;
    });
  }, []);

  /** Starts a conversation's Claude Code ahead of the question, on its session. */
  const warm = useCallback((conversation: Conversation) => backend?.warm(conversation.sessionId, placeOf(conversation)).catch(() => undefined), [backend]);

  // Claude Code starts with JARVIS (~2 s saved on the first question), on the conversation it left.
  useEffect(() => {
    void warm(latest.current.active);
  }, [warm]);

  /**
   * Asks, in the conversation on screen. `question` is what the user said (shown, kept in the
   * history); `prompt`, when given, is what Claude Code gets instead (a shortcut's instructions
   * around those words).
   */
  const ask = useCallback(
    (question: string, prompt?: string) => {
      const text = question.trim();
      if (!text) return;
      if (!backend) return latest.current.notify("Disponível no app desktop");
      // Where it was asked: the answer lands there, whatever is on screen when it ends.
      const conversation = latest.current.active;
      const conversationId = conversation.id;
      const there = latest.current.turns[conversationId];
      if (there && !there.done) return latest.current.notify("Ainda estou respondendo", "error");
      if (latest.current.answering.length >= MAX_ANSWERING) return latest.current.notify(TOO_MANY, "error");
      const id = Date.now();
      let streamed = "";
      const steps: string[] = [];
      const files: string[] = [];
      const sources: string[] = [];
      /** Claude Code announced its session: the conversation goes on there. */
      let started = false;
      // Deltas arrive a few characters at a time: the text is rendered (the reply, the history,
      // jv_agent) at most every STREAM_STEP_MS, not once per token.
      let pending = 0;
      const show = () => {
        window.clearTimeout(pending);
        pending = 0;
        patchTurn(conversationId, id, (current) => ({ ...current, text: streamed, tool: null }));
      };
      /** `lost`: the session is gone, the next question starts a new one. */
      const finish = (answer: string, error: string | null, cancelled: boolean, lost = false) => {
        window.clearTimeout(pending);
        pending = 0;
        // Out of sight (another conversation on screen): nothing to show there, the conversation
        // is marked instead and the user is told.
        const seen = latest.current.active.id === conversationId;
        if (seen) patchTurn(conversationId, id, (current) => ({ ...current, text: answer, tool: null, done: true, error, cancelled }));
        else dropTurn(conversationId, (current) => current.id === id);
        const entry: ConversationEntry = {
          id,
          at: id,
          question: text,
          answer,
          ...(error ? { error } : {}),
          ...(cancelled ? { cancelled } : {}),
          ...(steps.length ? { steps: [...steps] } : {}),
          ...(files.length ? { files: [...files] } : {}),
          ...(sources.length ? { sources: [...sources] } : {}),
        };
        const kept = latest.current.store.conversations.find((item) => item.id === conversationId);
        if (!seen && !cancelled && kept) latest.current.notify(`Resposta pronta em "${kept.items.length ? kept.title : conversationTitle(text)}"`, error ? "error" : "info");
        // A conversation deleted meanwhile takes its answer with it.
        setStore((current) => ({
          ...current,
          conversations: current.conversations.map((item) =>
            item.id === conversationId ? { ...withEntry(item, entry, lost ? null : item.sessionId), ...(current.activeId !== conversationId && !cancelled ? { unread: true } : {}) } : item,
          ),
        }));
      };
      setTurns((current) => ({ ...current, [conversationId]: { id, conversationId, question: text, text: "", tool: null, steps: [], files: [], sources: [], done: false, error: null, cancelled: false } }));
      // Named and moved to the top as it is asked: a long first answer is not a "Nova conversa" meanwhile.
      setStore((current) => ({
        ...current,
        conversations: current.conversations.map((item) =>
          item.id === conversationId ? { ...item, title: item.items.length === 0 && !item.renamed ? conversationTitle(text) : item.title, updatedAt: id } : item,
        ),
      }));
      backend
        .ask(
          prompt?.trim() || text,
          conversation.sessionId,
          (event) => {
            switch (event.event) {
              case "session":
                started = true;
                setStore((current) => ({
                  ...current,
                  conversations: current.conversations.map((item) => (item.id === conversationId && item.sessionId !== event.id ? { ...item, sessionId: event.id } : item)),
                }));
                break;
              case "delta":
                streamed += event.text;
                if (!pending) pending = window.setTimeout(show, STREAM_STEP_MS);
                break;
              case "tool":
                // The text before the tool shows first, as it was said.
                if (pending) show();
                if (steps[steps.length - 1] !== event.name) steps.push(event.name);
                patchTurn(conversationId, id, (current) => ({ ...current, tool: event.name, steps: [...steps] }));
                break;
              case "source":
                if (!sources.includes(event.path)) {
                  sources.push(event.path);
                  patchTurn(conversationId, id, (current) => ({ ...current, sources: [...sources] }));
                }
                break;
              case "file":
                latest.current.onFile?.(event);
                if (event.done && !files.includes(event.path)) {
                  files.push(event.path);
                  patchTurn(conversationId, id, (current) => ({ ...current, files: [...files] }));
                }
                break;
              case "done":
                // Cancelled: what was already shown is what was said. Failed before Claude Code
                // announced a session (e.g. one that could not be resumed): that session is gone.
                finish(event.cancelled ? streamed : event.text || streamed, event.error, event.cancelled, event.error !== null && !started);
                break;
            }
          },
          placeOf(conversation),
        )
        .catch((error: unknown) => finish("", String(error), false));
    },
    [backend, setStore, patchTurn, dropTurn],
  );

  /**
   * An answer JARVIS knows without Claude Code (the time, a reminder going off): shown and
   * spoken like any other, and kept in the conversation on screen. False while that one is busy.
   */
  const say = useCallback(
    (question: string, answer: string) => {
      if (latest.current.busy || latest.current.phase !== "idle") return false;
      const id = Date.now();
      const conversationId = latest.current.active.id;
      setTurns((current) => ({ ...current, [conversationId]: { id, conversationId, question, text: answer, tool: null, steps: [], files: [], sources: [], done: true, error: null, cancelled: false } }));
      setStore((current) => ({
        ...current,
        conversations: current.conversations.map((conversation) =>
          conversation.id === conversationId ? withEntry(conversation, { id, at: id, question, answer }, conversation.sessionId) : conversation,
        ),
      }));
      return true;
    },
    [setStore],
  );

  /** Esc, or a click while JARVIS works: drops the question or stops the answer of the conversation on screen. */
  const cancel = useCallback(() => {
    const { phase, voice, active } = latest.current;
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
        ?.cancel(active.id)
        .then(() => warm(latest.current.active))
        .catch(() => undefined);
    }
  }, [backend, warm]);

  const listen = useCallback(async () => {
    const { voice, active } = latest.current;
    if (!voice) return latest.current.notify("Disponível no app desktop");
    // The previous answer gives way to the new question.
    dropTurn(active.id, (current) => current.done);
    setRecording(true);
    // Claude Code starts while the user talks.
    void warm(active);
    const error = await voice.record(true);
    if (!error) return;
    setRecording(false);
    if (error === MODEL_MISSING) latest.current.onModelMissing();
  }, [warm, dropTurn]);

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

  /** The answer has been read: it leaves the screen (it stays in its conversation). */
  const dismiss = useCallback(() => dropTurn(latest.current.active.id, (current) => current.done), [dropTurn]);

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

  /** Claude Code's transcript of a conversation that is gone goes to the Recycle Bin. */
  const forget = useCallback(
    (sessionId: string | null) => {
      if (sessionId) void backend?.forget(sessionId).catch((error: unknown) => latest.current.notify(String(error), "error"));
    },
    [backend],
  );

  /**
   * "Nova conversa": an empty conversation becomes the one on screen (an empty one already
   * there, with the same one answering, is used again); its first question starts another Claude
   * Code session. `agent`: the contact that answers in it, instead of JARVIS. Answers in
   * progress elsewhere go on.
   */
  const create = useCallback(
    (agent?: string) => {
      const { store, active: current, answering } = latest.current;
      // Empty: nothing asked in it yet (one waiting for its first answer is not).
      const unused = (item: Conversation) => item.items.length === 0 && item.sessionId === null && item.agent === agent && !answering.includes(item.id);
      if (unused(current)) return current.id;
      // An empty one of this agent's, left behind earlier, is used again too.
      const empty = store.conversations.find(unused);
      const conversation = empty ?? newConversation(Date.now(), agent);
      // Over the limit, the oldest one not on screen goes, with its session.
      const others = [...store.conversations].sort((a, b) => a.updatedAt - b.updatedAt);
      const dropped = !empty && store.conversations.length >= MAX_CONVERSATIONS ? others.find((item) => item.id !== current.id) : undefined;
      if (dropped) forget(dropped.sessionId);
      dropTurn(current.id, (shown) => shown.done);
      setStore((before) => ({
        activeId: conversation.id,
        conversations: empty ? before.conversations : [...before.conversations.filter((item) => item.id !== dropped?.id), conversation],
      }));
      void warm(conversation);
      return conversation.id;
    },
    [forget, setStore, warm, dropTurn],
  );

  /** Another conversation on screen (read, from now on); Claude Code gets ready on its session. */
  const select = useCallback(
    (id: string) => {
      const { store, active: current } = latest.current;
      const conversation = store.conversations.find((item) => item.id === id);
      if (!conversation || id === store.activeId) return;
      // What was shown of the one left behind has been read.
      dropTurn(current.id, (shown) => shown.done);
      setStore((before) => ({ activeId: id, conversations: before.conversations.map((item) => (item.id === id && item.unread ? { ...item, unread: undefined } : item)) }));
      void warm(conversation);
    },
    [setStore, warm, dropTurn],
  );

  const rename = useCallback(
    (id: string, title: string) => {
      const name = title.replace(/\s+/g, " ").trim();
      if (!name) return;
      setStore((current) => ({
        ...current,
        conversations: current.conversations.map((conversation) => (conversation.id === id ? { ...conversation, title: name, renamed: true } : conversation)),
      }));
    },
    [setStore],
  );

  /** Deletes a conversation and its Claude Code session; one being answered is stopped first. The last one leaves an empty one. */
  const remove = useCallback(
    (id: string) => {
      const { store, answering } = latest.current;
      const conversation = store.conversations.find((item) => item.id === id);
      if (!conversation) return;
      if (answering.includes(id)) {
        void backend
          ?.cancel(id)
          .catch(() => undefined)
          .then(() => forget(conversation.sessionId));
      } else {
        // Its idle process, if it is the warm one, goes with the session.
        forget(conversation.sessionId);
      }
      dropTurn(id);
      setStore((current) => {
        const rest = current.conversations.filter((item) => item.id !== id);
        if (rest.length === 0) return emptyStore();
        const latestOne = rest.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        return { activeId: current.activeId === id ? latestOne.id : current.activeId, conversations: rest };
      });
    },
    [backend, forget, setStore, dropTurn],
  );

  /** "Limpar histórico": the conversation on screen goes, and an empty one takes its place. */
  const clear = useCallback(() => {
    const { active: current } = latest.current;
    const fresh = newConversation();
    setStore((before) => ({ activeId: fresh.id, conversations: [...before.conversations, fresh] }));
    remove(current.id);
    void warm(fresh);
  }, [remove, setStore, warm]);

  // Newest first, as the chat lists them.
  const conversations = useMemo(() => [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt), [store.conversations]);
  /** "Nova conversa", with JARVIS. */
  const reset = useCallback(() => void create(), [create]);
  /** A conversation with one of the agents: its empty one, or a new one. */
  const startWith = useCallback((agent: string) => create(agent), [create]);

  return {
    available: backend !== null,
    phase,
    turn,
    busy,
    items: active.items,
    conversations,
    activeId: active.id,
    /** The conversations being answered now. */
    answering,
    ask,
    say,
    press,
    release,
    cancel,
    dismiss,
    reset,
    create: reset,
    startWith,
    select,
    rename,
    remove,
    clear,
  };
}
