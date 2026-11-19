import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** Mirrors `AssistantEvent` in `src-tauri/src/assistant.rs`. */
export type AssistantEvent =
  | { event: "session"; id: string }
  | { event: "delta"; text: string }
  | { event: "tool"; name: string }
  /** A file JARVIS read to answer (a note of its knowledge base). */
  | { event: "source"; path: string }
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

/** Where a question goes: the conversation (each has a Claude Code process of its own) and who answers in it. */
export interface AskPlace {
  conversationId: string;
  /** The agent that answers there, with JARVIS's confinement (absent: JARVIS). */
  agent?: string;
}

/** How many conversations can be answered at once. Mirrors `MAX_ANSWERING` in src-tauri/src/assistant.rs. */
export const MAX_ANSWERING = 5;
/** …and what the sixth is told. Mirrors `TOO_MANY` there. */
export const TOO_MANY = "Já estou respondendo em 5 conversas. Espere uma terminar.";

/** JARVIS's brain: Claude Code, run by the desktop app. */
export interface AssistantBackend {
  /** Sends a question; the answer streams to `onEvent` and always ends with a "done". Rejects when it cannot be sent. */
  ask: (text: string, sessionId: string | null, onEvent: (event: AssistantEvent) => void, place: AskPlace) => Promise<void>;
  /** Starts a conversation's Claude Code ahead of the question (the idle ones of the others stop). */
  warm: (sessionId: string | null, place: AskPlace) => Promise<void>;
  /** Stops the conversation's answer. */
  cancel: (conversationId: string) => Promise<void>;
  /** The conversation forgets its session: its next question starts a new one. */
  reset: (conversationId: string) => Promise<void>;
  /** A deleted conversation: Claude Code's transcript of that session goes to the Recycle Bin. */
  forget: (sessionId: string) => Promise<void>;
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
  /** Files read before the answer (absolute paths). */
  sources?: string[];
  /** The agents installed, as the chat's contacts (src/lib/agentContacts.ts). */
  agents?: { name: string; description: string }[];
}

declare global {
  interface Window {
    /** Development-only: a scripted JARVIS for the browser tests (true, or options). */
    __JARVIS_ASSISTANT__?: boolean | FakeAssistantOptions;
    /** …and what it was asked to do, for the tests to check. */
    __JARVIS_ASSISTANT_LOG__?: { asks: { text: string; sessionId: string | null; agent?: string }[]; warms: number; cancels: number; resets: number; forgets: string[] };
  }
}

const tauriBackend: AssistantBackend = {
  async ask(text, sessionId, onEvent, { conversationId, agent }) {
    const channel = new Channel<AssistantEvent>();
    channel.onmessage = onEvent;
    await invoke("assistant_ask", { text, sessionId, conversationId, agent: agent ?? null, onEvent: channel });
  },
  warm: (sessionId, { conversationId, agent }) => invoke("assistant_warm", { sessionId, conversationId, agent: agent ?? null }),
  cancel: (conversationId) => invoke("assistant_cancel", { conversationId }),
  reset: (conversationId) => invoke("assistant_reset", { conversationId }),
  forget: async (sessionId) => void (await invoke<boolean>("assistant_forget", { sessionId })),
};

const FAKE_REPLY = "Às suas ordens. Esta é uma resposta de teste do JARVIS, entregue palavra por palavra. Algo mais?";

function fakeBackend(): AssistantBackend {
  const log = (window.__JARVIS_ASSISTANT_LOG__ ??= { asks: [], warms: 0, cancels: 0, resets: 0, forgets: [] });
  /** By conversation: how its answer in progress ends. */
  const answers = new Map<string, (cancelled: boolean) => void>();
  return {
    async ask(text, sessionId, onEvent, { conversationId, agent }) {
      log.asks.push({ text, sessionId, ...(agent ? { agent } : {}) });
      if (answers.has(conversationId)) throw new Error("Ainda estou respondendo.");
      if (answers.size >= MAX_ANSWERING) throw new Error(TOO_MANY);
      const options = typeof window.__JARVIS_ASSISTANT__ === "object" ? window.__JARVIS_ASSISTANT__ : {};
      const words = (options.reply ?? FAKE_REPLY).match(/\S+\s*/g) ?? [];
      // Each file: its content growing a few words at a time, then on "disk".
      const writes: AssistantEvent[] = (options.files ?? []).flatMap(({ path, content }) => {
        const pieces = content.match(/(?:\S+\s*){1,4}/g) ?? [];
        const growing = pieces.map((_, index) => ({ event: "file" as const, path, content: pieces.slice(0, index + 1).join(""), done: false }));
        return [{ event: "tool" as const, name: "Write" }, ...growing, { event: "file" as const, path, content: null, done: true }];
      });
      writes.unshift(...(options.sources ?? []).flatMap((path) => [{ event: "tool" as const, name: "Read" }, { event: "source" as const, path }]));
      let streamed = "";
      onEvent({ event: "session", id: sessionId ?? `fake-session-${log.asks.length}` });
      const finish = (cancelled: boolean) => {
        window.clearInterval(timer);
        answers.delete(conversationId);
        onEvent({ event: "done", text: cancelled ? "" : streamed, error: cancelled ? null : (options.error ?? null), cancelled });
      };
      const timer = window.setInterval(() => {
        const write = writes.shift();
        if (write) return onEvent(write);
        const word = words.shift();
        if (word === undefined) return finish(false);
        streamed += word;
        onEvent({ event: "delta", text: word });
      }, options.delayMs ?? 40);
      answers.set(conversationId, finish);
    },
    async warm() {
      log.warms++;
    },
    async cancel(conversationId) {
      log.cancels++;
      answers.get(conversationId)?.(true);
    },
    async reset(conversationId) {
      log.resets++;
      answers.get(conversationId)?.(true);
    },
    async forget(sessionId) {
      log.forgets.push(sessionId);
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
  /** The tools the agent used, in order ("WebSearch", "Write"). */
  steps?: string[];
  /** The files it wrote (absolute paths). */
  files?: string[];
  /** The files it read to answer (absolute paths): the notes it consulted. */
  sources?: string[];
}

/** "Nova conversa" in the single history of before the conversations: where one ended. */
export interface ConversationBreak {
  id: number;
  at: number;
  newConversation: true;
}

export type HistoryItem = ConversationEntry | ConversationBreak;

export const isBreak = (item: HistoryItem): item is ConversationBreak => "newConversation" in item;

/** `jarvis.assistant`, the single history of before the conversations: only read, to migrate it. */
export interface AssistantMemory {
  sessionId: string | null;
  items: HistoryItem[];
}

export const ASSISTANT_KEY = "jarvis.assistant";
export const EMPTY_MEMORY: AssistantMemory = { sessionId: null, items: [] };
/** The history keeps the latest questions only. */
export const MAX_ITEMS = 200;

const strings = (raw: unknown) => (Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item !== "") : []);

function parseItem(raw: unknown): HistoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, at, question, answer, error, cancelled, newConversation, steps, files, sources } = raw as Record<string, unknown>;
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
    ...(strings(steps).length > 0 && { steps: strings(steps) }),
    ...(strings(files).length > 0 && { files: strings(files) }),
    ...(strings(sources).length > 0 && { sources: strings(sources) }),
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

/** One conversation with JARVIS: its questions and answers, and the Claude Code session that remembers them. */
export interface Conversation {
  id: string;
  title: string;
  /** The user named it: the first question no longer does. */
  renamed?: boolean;
  /** Claude Code's session, to continue it (null: none yet, or lost). */
  sessionId: string | null;
  createdAt: number;
  /** The last question, or when it was made: the list's order. */
  updatedAt: number;
  items: ConversationEntry[];
  /** The agent that answers here, one of the chat's contacts (absent: JARVIS). */
  agent?: string;
  /** An answer ended here while it was out of sight. */
  unread?: boolean;
}

/** Stored in `jarvis.conversations`: every conversation and the one on screen. */
export interface ConversationStore {
  activeId: string;
  conversations: Conversation[];
}

export const CONVERSATIONS_KEY = "jarvis.conversations";
/** The list keeps the latest conversations only. */
export const MAX_CONVERSATIONS = 50;
export const NEW_TITLE = "Nova conversa";
/** A conversation is named after its first question, cut here. */
const TITLE_LENGTH = 48;

/** "  como   está o tempo em Curitiba amanhã de manhã, por favor? " → the first 48 characters, on a word. */
export function conversationTitle(question: string) {
  const text = question.replace(/\s+/g, " ").trim();
  if (text.length <= TITLE_LENGTH) return text || NEW_TITLE;
  const cut = text.slice(0, TITLE_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function newConversation(now = Date.now(), agent?: string): Conversation {
  return { id: `c${now}`, title: NEW_TITLE, sessionId: null, createdAt: now, updatedAt: now, items: [], ...(agent ? { agent } : {}) };
}

/** A name Claude Code takes for a subagent (as `agents::valid_name`). */
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The store is never empty, and its active conversation is one of them. */
export function emptyStore(now = Date.now()): ConversationStore {
  const conversation = newConversation(now);
  return { activeId: conversation.id, conversations: [conversation] };
}

/**
 * The single history of before the conversations, as conversations: each stretch between
 * "Nova conversa" marks becomes one, named after its first question; only the last one goes on
 * in the Claude Code session. Ids come from the items, so migrating twice gives the same result.
 */
export function migrateMemory(memory: AssistantMemory | null, now = Date.now()): ConversationStore {
  const stretches: ConversationEntry[][] = [[]];
  for (const item of memory?.items ?? []) {
    if (isBreak(item)) stretches.push([]);
    else stretches[stretches.length - 1].push(item);
  }
  const conversations = stretches
    .filter((items) => items.length > 0)
    .map((items): Conversation => ({
      id: `c${items[0].id}`,
      title: conversationTitle(items[0].question),
      sessionId: null,
      createdAt: items[0].at,
      updatedAt: items[items.length - 1].at,
      items,
    }))
    .slice(-MAX_CONVERSATIONS);
  if (!memory || conversations.length === 0) return emptyStore(now);
  const last = conversations[conversations.length - 1];
  // The history ended on a "Nova conversa" mark: the session was already left behind.
  const open = stretches[stretches.length - 1].length > 0;
  if (open) last.sessionId = memory.sessionId;
  return { activeId: last.id, conversations };
}

function parseConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, title, renamed, sessionId, createdAt, updatedAt, items, agent, unread } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  const entries = Array.isArray(items)
    ? items
        .map(parseItem)
        .filter((item): item is ConversationEntry => item !== null && !isBreak(item))
        .slice(-MAX_ITEMS)
    : [];
  const created = typeof createdAt === "number" ? createdAt : (entries[0]?.at ?? 0);
  return {
    id,
    title: typeof title === "string" && title.trim() ? title.trim() : entries[0] ? conversationTitle(entries[0].question) : NEW_TITLE,
    ...(renamed === true && { renamed }),
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    createdAt: created,
    updatedAt: typeof updatedAt === "number" ? updatedAt : (entries[entries.length - 1]?.at ?? created),
    items: entries,
    ...(typeof agent === "string" && AGENT_NAME.test(agent) && { agent }),
    ...(unread === true && { unread }),
  };
}

/** Tolerant: a conversation without an id is dropped, a bad `activeId` becomes the latest one; none left is null. */
export function parseConversations(raw: unknown): ConversationStore | null {
  if (!raw || typeof raw !== "object") return null;
  const { activeId, conversations } = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const list = (Array.isArray(conversations) ? conversations : [])
    .map(parseConversation)
    .filter((conversation): conversation is Conversation => conversation !== null && !seen.has(conversation.id) && seen.add(conversation.id) !== undefined);
  if (list.length === 0) return null;
  const latest = list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return { activeId: list.some((conversation) => conversation.id === activeId) ? (activeId as string) : latest.id, conversations: list };
}

/** What a tool in use means for the user ("WebSearch" → "Pesquisando na web"). */
export function describeTool(name: string) {
  if (name === "WebSearch") return "Pesquisando na web";
  if (name === "WebFetch") return "Lendo uma página";
  if (name === "Write" || name === "Edit") return "Escrevendo";
  if (name === "Read" || name === "Glob" || name === "Grep") return "Lendo suas notas";
  if (name === "mcp__jarvis__agent_review") return "Preparando o agente";
  if (name === "mcp__jarvis__agent_run") return "Rodando o agente";
  if (name === "mcp__jarvis__system_status") return "Verificando o sistema";
  if (name === "mcp__jarvis__reminder_set") return "Agendando o lembrete";
  if (name === "mcp__jarvis__stocks_quote") return "Consultando a bolsa";
  if (name === "mcp__jarvis__stocks_watch") return "Atualizando suas ações";
  if (name === "mcp__jarvis__stocks_alert") return "Criando o alerta de preço";
  if (name === "mcp__jarvis__weather") return "Consultando o tempo";
  if (name === "mcp__jarvis__agenda_add") return "Marcando na agenda";
  if (name === "mcp__jarvis__agenda_list") return "Lendo a agenda";
  if (name === "mcp__jarvis__agenda_remove") return "Apagando da agenda";
  if (name === "mcp__jarvis__tasks_add") return "Anotando na lista";
  if (name === "mcp__jarvis__tasks_list") return "Lendo a lista de tarefas";
  if (name === "mcp__jarvis__tasks_done") return "Riscando da lista";
  if (name === "mcp__jarvis__tasks_remove") return "Apagando da lista";
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
