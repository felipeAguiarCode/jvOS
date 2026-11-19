import type { Conversation } from "./assistant";
import { normalize } from "./search";
import { useStoredState } from "./storage";

/** Modo chat (feature chat-mode). What it does and why: .specs/features/chat-mode/spec.md. */

/** The two faces of the app: the holographic desktop, or the agent's chat. */
export type AppMode = "desktop" | "chat";

/** What the chat shows: the conversations, the notes JARVIS and the user keep, or the agents to talk to. */
export type ChatSection = "conversations" | "notes" | "agents";

/** Stored in `jarvis.chatMode`. */
export interface ChatModePrefs {
  mode: AppMode;
  section: ChatSection;
  /** Answers are spoken as they end, in the chat. */
  speak: boolean;
  /** The side bar is folded away: only a narrow strip with the button that brings it back. */
  collapsed: boolean;
}

const DEFAULT_CHAT_MODE: ChatModePrefs = { mode: "desktop", section: "conversations", speak: false, collapsed: false };

/** Tolerant: a bad field takes its default; anything but an object is null. */
export function parseChatMode(raw: unknown): ChatModePrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { mode, section, speak, collapsed } = raw as Record<string, unknown>;
  return {
    mode: mode === "chat" ? "chat" : DEFAULT_CHAT_MODE.mode,
    section: section === "notes" || section === "agents" ? section : DEFAULT_CHAT_MODE.section,
    speak: typeof speak === "boolean" ? speak : DEFAULT_CHAT_MODE.speak,
    collapsed: typeof collapsed === "boolean" ? collapsed : DEFAULT_CHAT_MODE.collapsed,
  };
}

export function useChatModePrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.chatMode", DEFAULT_CHAT_MODE, parseChatMode);
  return [prefs, setPrefs] as const;
}

/** The list's search: the title, the questions and the answers, whatever the case or the accents. */
export function matchesConversation(conversation: Conversation, query: string) {
  const wanted = normalize(query);
  if (!wanted) return true;
  return normalize(conversation.title).includes(wanted) || conversation.items.some((item) => normalize(item.question).includes(wanted) || normalize(item.answer).includes(wanted));
}

/** What the list shows under the title: the last thing said, on one line. */
export function conversationPreview(conversation: Conversation) {
  const last = conversation.items[conversation.items.length - 1];
  if (!last) return "";
  return (last.answer || last.error || last.question).replace(/[#*_`>~]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}
