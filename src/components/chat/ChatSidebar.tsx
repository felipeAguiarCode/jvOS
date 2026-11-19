import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Pencil, Search, Trash2, X } from "lucide-react";
import type { Conversation } from "../../lib/assistant";
import { conversationPreview, matchesConversation, type ChatSection } from "../../lib/chatMode";
import { AgentAvatar } from "./AgentAvatar";
import { CoreAvatar } from "./CoreAvatar";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/** "14:32" today, "25/10" before. */
function when(at: number) {
  const date = new Date(at);
  return new Date().toDateString() === date.toDateString() ? TIME.format(date) : DAY.format(date);
}

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string;
  /** The conversations being answered now. */
  answering: string[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  section: ChatSection;
  onSection: (section: ChatSection) => void;
  /** The notes list, shown in place of the conversations in the notes section. */
  notes: ReactNode;
  /** …and the agents to talk to, in theirs. */
  agents: ReactNode;
  /** Folded away: a narrow strip, and what is on screen takes the room. */
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}

const SECTIONS: { section: ChatSection; label: string }[] = [
  { section: "conversations", label: "Conversas" },
  { section: "notes", label: "Notas" },
  { section: "agents", label: "Agentes" },
];

/**
 * The chat's side bar: its sections on top (the conversations, the notes) and the one chosen
 * under them. The conversations come newest first, with a search, a new one, and each one's
 * rename and delete.
 */
export function ChatSidebar({ conversations, activeId, answering, onSelect, onCreate, onRename, onRemove, section, onSection, notes, agents, collapsed, onCollapsed }: ChatSidebarProps) {
  const [query, setQuery] = useState("");
  /** The conversation being renamed, and the name so far. */
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  /** The conversation asked to be deleted, waiting for the answer. */
  const [deleting, setDeleting] = useState<string | null>(null);
  const shown = useMemo(() => conversations.filter((conversation) => matchesConversation(conversation, query)), [conversations, query]);

  /** Esc gave the rename up: the field's blur, if it comes, must not save it. */
  const abandoned = useRef(false);
  const startRename = (conversation: Conversation) => {
    abandoned.current = false;
    setEditing({ id: conversation.id, title: conversation.title });
  };
  const commit = () => {
    if (editing && !abandoned.current) onRename(editing.id, editing.title);
    setEditing(null);
  };

  if (collapsed) {
    return (
      <nav aria-label="Barra lateral do chat" data-collapsed className="flex w-12 shrink-0 flex-col items-center border-r border-hud-line/60 bg-hud-panel pt-2.5">
        <button
          type="button"
          aria-label="Mostrar a barra lateral"
          title="Mostrar a barra lateral"
          aria-expanded={false}
          onClick={() => onCollapsed(false)}
          className="grid size-9 cursor-pointer place-items-center rounded-full text-hud-text/60 outline-none transition hover:bg-hud-light/8 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
        >
          <PanelLeftOpen size={18} strokeWidth={1.7} />
        </button>
        {/* Answers at work, or waiting to be read, still show with the list away. */}
        {(answering.length > 0 || conversations.some((conversation) => conversation.unread)) && (
          <span
            role="img"
            aria-label={answering.length > 0 ? "Respondendo" : "Resposta não lida"}
            className={`mt-3 size-2 rounded-full ${answering.length > 0 ? "animate-pulse bg-hud-amber" : "bg-hud-light"}`}
          />
        )}
      </nav>
    );
  }

  return (
    <nav aria-label="Barra lateral do chat" className="flex w-[320px] shrink-0 flex-col border-r border-hud-line/60 bg-hud-panel">
      <div className="flex h-14 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          aria-label="Recolher a barra lateral"
          title="Recolher a barra lateral"
          aria-expanded
          onClick={() => onCollapsed(true)}
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-hud-text/60 outline-none transition hover:bg-hud-light/8 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
        >
          <PanelLeftClose size={18} strokeWidth={1.7} />
        </button>
        <div role="tablist" aria-label="Seções do chat" className="flex flex-1 gap-0.5">
          {SECTIONS.map((item) => (
            <button
              key={item.section}
              type="button"
              role="tab"
              aria-selected={section === item.section}
              onClick={() => onSection(item.section)}
              className={`cursor-pointer rounded-full px-2.5 py-1.5 text-[13px] font-medium outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
                section === item.section ? "bg-chat-active text-hud-light" : "text-hud-text/55 hover:bg-hud-light/6 hover:text-hud-light"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {section === "conversations" && (
          <button
            type="button"
            aria-label="Nova conversa"
            title="Nova conversa"
            onClick={onCreate}
            className="grid size-9 cursor-pointer place-items-center rounded-full text-hud-cyan outline-none transition hover:bg-hud-light/8 focus-visible:ring-1 focus-visible:ring-hud-light/50"
          >
            <MessageSquarePlus size={18} strokeWidth={1.7} />
          </button>
        )}
      </div>
      {section === "notes" ? (
        notes
      ) : section === "agents" ? (
        agents
      ) : (
        <>
      <label className="relative mx-3 mb-2 block">
        <Search aria-hidden size={14} strokeWidth={1.8} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-hud-text/40" />
        <input
          type="search"
          aria-label="Buscar conversas"
          placeholder="Buscar"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="chat-search"
        />
      </label>
      <ul className="hud-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {shown.map((conversation) => {
          const active = conversation.id === activeId;
          const renaming = editing?.id === conversation.id;
          const confirming = deleting === conversation.id;
          return (
            <li
              key={conversation.id}
              data-testid="chat-conversation"
              data-active={active || undefined}
              data-unread={conversation.unread || undefined}
              data-agent={conversation.agent}
              className={`group relative rounded-xl ${active ? "bg-chat-active" : "hover:bg-hud-light/5"}`}
            >
              {renaming ? (
                <form
                  className="flex items-center gap-1 px-2 py-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commit();
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Nome da conversa"
                    value={editing.title}
                    maxLength={80}
                    onChange={(event) => setEditing({ id: conversation.id, title: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      // Esc gives the rename up; it is not for the answer in progress.
                      event.preventDefault();
                      abandoned.current = true;
                      setEditing(null);
                    }}
                    onBlur={commit}
                    className="hud-input min-w-0 flex-1 px-2 py-1 text-[12px]"
                  />
                  <button type="submit" aria-label="Salvar nome" title="Salvar nome" className="grid size-6 cursor-pointer place-items-center rounded text-hud-text/60 hover:text-hud-light">
                    <Check size={13} strokeWidth={2} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(conversation.id)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-hud-light/50"
                >
                  {conversation.agent ? <AgentAvatar size={46} /> : <CoreAvatar size={46} />}
                  <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {answering.includes(conversation.id) ? (
                      <span aria-label="Respondendo" role="img" className="size-1.5 shrink-0 animate-pulse rounded-full bg-hud-amber" />
                    ) : (
                      conversation.unread && <span aria-label="Resposta não lida" role="img" className="size-1.5 shrink-0 rounded-full bg-hud-light" />
                    )}
                    <span className={`flex-1 truncate text-[14px] ${conversation.unread ? "font-bold" : "font-semibold"} text-hud-light`}>{conversation.title}</span>
                    <time className={`shrink-0 text-[11px] group-hover:invisible group-focus-within:invisible ${active ? "text-hud-light/75" : "text-hud-text/40"}`}>{when(conversation.updatedAt)}</time>
                  </span>
                  <span className={`mt-0.5 flex items-center gap-1.5 text-[13px] ${active ? "text-hud-light/80" : "text-hud-text/50"}`}>
                    {conversation.agent && <span className="shrink-0 rounded bg-hud-amber/15 px-1 font-mono text-[10px] text-hud-amber">{conversation.agent}</span>}
                    <span className="truncate">{conversationPreview(conversation) || "Sem mensagens"}</span>
                  </span>
                  </span>
                </button>
              )}
              {!renaming && !confirming && (
                <span className="absolute top-2 right-2 hidden gap-0.5 group-focus-within:flex group-hover:flex">
                  <RowButton label={`Renomear ${conversation.title}`} onClick={() => startRename(conversation)}>
                    <Pencil size={12} strokeWidth={1.8} />
                  </RowButton>
                  <RowButton label={`Apagar ${conversation.title}`} onClick={() => setDeleting(conversation.id)}>
                    <Trash2 size={12} strokeWidth={1.8} />
                  </RowButton>
                </span>
              )}
              {confirming && (
                <span role="group" aria-label="Apagar conversa?" className="absolute inset-0 flex items-center gap-2 rounded-xl bg-chat-field px-3 text-[13px] text-hud-text/90">
                  <span className="flex-1 truncate">Apagar esta conversa?</span>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => {
                      setDeleting(null);
                      onRemove(conversation.id);
                    }}
                    className="cursor-pointer rounded px-2 py-1 text-hud-alert outline-none hover:bg-hud-alert/15 focus-visible:ring-1 focus-visible:ring-hud-alert/60"
                  >
                    Sim, apagar
                  </button>
                  <RowButton label="Não apagar" onClick={() => setDeleting(null)}>
                    <X size={13} strokeWidth={1.8} />
                  </RowButton>
                </span>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-hud-text/40">Nenhuma conversa encontrada</li>}
      </ul>
        </>
      )}
    </nav>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 cursor-pointer place-items-center rounded-full bg-chat-field text-hud-text/70 outline-none transition hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
    >
      {children}
    </button>
  );
}
