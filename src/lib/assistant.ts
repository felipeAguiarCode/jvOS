import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `AssistantEvent` in `src-tauri/src/assistant.rs`. */
export type AssistantEvent =
  | { event: "session"; id: string }
  | { event: "delta"; text: string }
  | { event: "tool"; name: string }
  /** A file JARVIS writes: its content so far while it streams, then `done` once on disk. */
  | { event: "file"; path: string; content: string | null; done: boolean }
  | { event: "done"; text: string; error: string | null; cancelled: boolean };

/** JARVIS's folder (Documentos\JARVIS) and its parts. Mirrors `Folder` in `src-tauri/src/assistant.rs`. */
export interface AssistantFolder {
  root: string;
  notes: string;
  agents: string;
}

/** Where the scripted JARVIS of the browser tests "writes". */
const FAKE_FOLDER: AssistantFolder = { root: "C:\\JARVIS", notes: "C:\\JARVIS\\Notas", agents: "C:\\JARVIS\\Agentes" };

export async function assistantFolder(): Promise<AssistantFolder | null> {
  if (isTauri()) return invoke<AssistantFolder>("assistant_folder").catch(() => null);
  return import.meta.env.DEV && window.__JARVIS_ASSISTANT__ ? FAKE_FOLDER : null;
}

/** JARVIS's brain: Claude Code, run by the desktop app. */
export interface AssistantBackend {
  /** Sends a question; the answer streams to `onEvent` and always ends with a "done". Rejects when it cannot be sent. */
  ask: (text: string, sessionId: string | null, onEvent: (event: AssistantEvent) => void) => Promise<void>;
  /** Starts Claude Code ahead of the question, while the user is still talking. */
  warm: (sessionId: string | null) => Promise<void>;
  cancel: () => Promise<void>;
  /** Forgets the conversation: the next question starts a new session. */
  reset: () => Promise<void>;
}

interface FakeAssistantOptions {
  /** The answer, streamed a word at a time. */
  reply?: string;
  /** Between words (ms). */
  delayMs?: number;
  /** Ends the answer with this error instead. */
  error?: string;
  /** Files written before the answer, streamed in pieces of a few words. */
  files?: { path: string; content: string }[];
}

declare global {
  interface Window {
    /** Development-only: a scripted JARVIS for the browser tests (true, or options). */
    __JARVIS_ASSISTANT__?: boolean | FakeAssistantOptions;
    /** …and what it was asked to do, for the tests to check. */
    __JARVIS_ASSISTANT_LOG__?: { asks: { text: string; sessionId: string | null }[]; warms: number; cancels: number; resets: number };
  }
}

const tauriBackend: AssistantBackend = {
  async ask(text, sessionId, onEvent) {
    const channel = new Channel<AssistantEvent>();
    channel.onmessage = onEvent;
    await invoke("assistant_ask", { text, sessionId, onEvent: channel });
  },
  warm: (sessionId) => invoke("assistant_warm", { sessionId }),
  cancel: () => invoke("assistant_cancel"),
  reset: () => invoke("assistant_reset"),
};

const FAKE_REPLY = "Às suas ordens. Esta é uma resposta de teste do JARVIS, entregue palavra por palavra. Algo mais?";

function fakeBackend(): AssistantBackend {
  const log = (window.__JARVIS_ASSISTANT_LOG__ ??= { asks: [], warms: 0, cancels: 0, resets: 0 });
  let finish: ((cancelled: boolean) => void) | null = null;
  return {
    async ask(text, sessionId, onEvent) {
      log.asks.push({ text, sessionId });
      if (finish) throw new Error("Ainda estou respondendo.");
      const options = typeof window.__JARVIS_ASSISTANT__ === "object" ? window.__JARVIS_ASSISTANT__ : {};
      const words = (options.reply ?? FAKE_REPLY).match(/\S+\s*/g) ?? [];
      // Each file: its content growing a few words at a time, then on "disk".
      const writes: AssistantEvent[] = (options.files ?? []).flatMap(({ path, content }) => {
        const pieces = content.match(/(?:\S+\s*){1,4}/g) ?? [];
        const growing = pieces.map((_, index) => ({ event: "file" as const, path, content: pieces.slice(0, index + 1).join(""), done: false }));
        return [{ event: "tool" as const, name: "Write" }, ...growing, { event: "file" as const, path, content: null, done: true }];
      });
      let streamed = "";
      onEvent({ event: "session", id: sessionId ?? `fake-session-${log.asks.length}` });
      const timer = window.setInterval(() => {
        const write = writes.shift();
        if (write) return onEvent(write);
        const word = words.shift();
        if (word === undefined) return finish?.(false);
        streamed += word;
        onEvent({ event: "delta", text: word });
      }, options.delayMs ?? 40);
      finish = (cancelled) => {
        window.clearInterval(timer);
        finish = null;
        onEvent({ event: "done", text: cancelled ? "" : streamed, error: cancelled ? null : (options.error ?? null), cancelled });
      };
    },
    async warm() {
      log.warms++;
    },
    async cancel() {
      log.cancels++;
      finish?.(true);
    },
    async reset() {
      log.resets++;
      finish?.(true);
    },
  };
}

let fake: AssistantBackend | undefined;

/** The backend in use, or null where there is none (a browser, outside the tests). */
export function assistantBackend(): AssistantBackend | null {
  if (isTauri()) return tauriBackend;
  if (import.meta.env.DEV && window.__JARVIS_ASSISTANT__) return (fake ??= fakeBackend());
  return null;
}

/** One question and its answer, as kept in the history. */
export interface ConversationEntry {
  id: number;
  /** When it was asked (ms since the epoch). */
  at: number;
  question: string;
  answer: string;
  error?: string;
  cancelled?: boolean;
}

/** "Nova conversa": where JARVIS stopped remembering what came before. */
export interface ConversationBreak {
  id: number;
  at: number;
  newConversation: true;
}

export type HistoryItem = ConversationEntry | ConversationBreak;

export const isBreak = (item: HistoryItem): item is ConversationBreak => "newConversation" in item;

/** Stored in `jarvis.assistant`: the Claude Code session (to continue it) and the history. */
export interface AssistantMemory {
  sessionId: string | null;
  items: HistoryItem[];
}

export const ASSISTANT_KEY = "jarvis.assistant";
export const EMPTY_MEMORY: AssistantMemory = { sessionId: null, items: [] };
/** The history keeps the latest questions only. */
export const MAX_ITEMS = 200;

function parseItem(raw: unknown): HistoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, at, question, answer, error, cancelled, newConversation } = raw as Record<string, unknown>;
  if (typeof id !== "number" || typeof at !== "number") return null;
  if (newConversation === true) return { id, at, newConversation };
  if (typeof question !== "string" || typeof answer !== "string") return null;
  return {
    id,
    at,
    question,
    answer,
    ...(typeof error === "string" && { error }),
    ...(cancelled === true && { cancelled }),
  };
}

export function parseMemory(raw: unknown): AssistantMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const { sessionId, items } = raw as Record<string, unknown>;
  return {
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    items: Array.isArray(items)
      ? items
          .map(parseItem)
          .filter((item) => item !== null)
          .slice(-MAX_ITEMS)
      : [],
  };
}

/** What a tool in use means for the user ("WebSearch" → "Pesquisando na web"). */
export function describeTool(name: string) {
  if (name === "WebSearch") return "Pesquisando na web";
  if (name === "WebFetch") return "Lendo uma página";
  if (name === "Write" || name === "Edit") return "Escrevendo";
  if (name === "Read" || name === "Glob" || name === "Grep") return "Lendo suas notas";
  if (name === "mcp__jarvis__agent_review") return "Preparando o agente";
  if (name === "mcp__jarvis__agent_run") return "Rodando o agente";
  if (name.startsWith("mcp__jarvis__")) return "Executando no jvOS";
  return "Trabalhando";
}

/**
 * The answer as it is shown in big letters: Markdown marks, code and links out, the words in.
 * Paragraphs stay apart ("\n\n").
 */
export function speechText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)?/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
        .replace(/[*_~`|]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}
