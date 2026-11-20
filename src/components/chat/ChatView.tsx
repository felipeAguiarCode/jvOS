import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Monitor, Volume2, VolumeX } from "lucide-react";
import type { Assistant } from "../../hooks/useAssistant";
import type { ChatSpeech } from "../../hooks/useChatSpeech";
import { useNotes } from "../../hooks/useNotes";
import type { ChatSection } from "../../lib/chatMode";
import { baseName } from "../../lib/files";
import { useNotesAreaPrefs } from "../../lib/notesArea";
import { buildGraph, linkFileName, resolveLink, useNotesGraphPrefs, type GraphNode } from "../../lib/notesGraph";
import { SquareTerminal } from "lucide-react";
import type { DockNotice } from "../QuickDock";
import { AgentAvatar } from "./AgentAvatar";
import { AgentsList } from "./AgentsList";
import { ChatComposer } from "./ChatComposer";
import { ChatSidebar } from "./ChatSidebar";
import { AnswerMenu } from "./AnswerMenu";
import { ChatThread } from "./ChatThread";
import { CoreAvatar } from "./CoreAvatar";
import { NotesList } from "./NotesList";

// The notes' editor (CodeMirror) only loads with the notes section.
const NotesPanel = lazy(() => import("./NotesPanel").then((module) => ({ default: module.NotesPanel })));
// …and their graph (three.js) only with the graph itself.
const NotesGraph = lazy(() => import("./NotesGraph").then((module) => ({ default: module.NotesGraph })));

/** A note to show in the notes section (its absolute path); `key` tells one request from the next. */
export interface NoteRequest {
  path: string;
  key: number;
}

export interface ChatViewProps {
  assistant: Assistant;
  /** Pixels kept free at the top: the top bar's height while it shows. */
  top: number;
  /** Answers are spoken as they end. */
  speak: boolean;
  onSpeak: (speak: boolean) => void;
  speech: ChatSpeech;
  onDesktop: () => void;
  /** What the dock would say in the desktop (voice errors, reminders): shown on a line here. */
  notice: DockNotice | null;
  canOpen: (path: string) => boolean;
  onOpenFile: (path: string) => void;
  section: ChatSection;
  onSection: (section: ChatSection) => void;
  /** A note asked for from a conversation's file card. */
  noteRequest: NoteRequest | null;
  /** The app window is hidden, or another app has the focus: the notes graph follows the frame clock. */
  paused: boolean;
  focused: boolean;
  /** "Rodar no terminal": an agent run in the desktop's jv_sh, with all its own tools, on a task. */
  onRunAgent: (agent: string, task: string) => void;
  /** The side bar is folded away. */
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}

/**
 * The chat mode: JARVIS as a messenger, the agent's command centre. The conversations on the
 * left, the one on screen in bubbles (what he did, said and wrote) and the message field under
 * it. It covers the desktop, which stays as it was underneath.
 */
export function ChatView({ assistant, top, speak, onSpeak, speech, onDesktop, notice, canOpen, onOpenFile, section, onSection, noteRequest, paused, focused, onRunAgent, collapsed, onCollapsed }: ChatViewProps) {
  const { conversations, activeId, turn, phase } = assistant;
  // The notes: read and watched only while their section is open.
  const inNotes = section === "notes";
  /** The right-click menu of an answer (it writes to the notes, so they are opened for it too). */
  const [answerMenu, setAnswerMenu] = useState<{ x: number; y: number; question: string; answer: string } | null>(null);
  /** What the menu did, in the notice line, for a while. */
  const [told, setTold] = useState<{ text: string; tone?: "error" } | null>(null);
  useEffect(() => {
    if (!told) return;
    const timer = window.setTimeout(() => setTold(null), 6000);
    return () => window.clearTimeout(timer);
  }, [told]);
  const notes = useNotes(inNotes || answerMenu !== null);
  const [notePrefs, setNotePrefs] = useNotesAreaPrefs();
  const [notePath, setNotePath] = useState<string | null>(null);
  /** A note just made, waiting for its name. */
  const [naming, setNaming] = useState(false);
  const served = useRef(0);
  useEffect(() => {
    if (!inNotes || notes.status !== "ready") return;
    // A note asked for by a conversation's card, once; otherwise the latest one.
    if (noteRequest && noteRequest.key !== served.current) {
      // Where it is under the notes folder; a path from somewhere else is looked for by its name.
      const asked = noteRequest.path.replace(/\\/g, "/").toLowerCase();
      const base = notes.folder ? `${notes.folder.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()}/` : null;
      const wanted = base && asked.startsWith(base) ? asked.slice(base.length) : baseName(noteRequest.path).toLowerCase();
      const found = notes.notes.find((note) => note.path.toLowerCase() === wanted);
      if (found) {
        served.current = noteRequest.key;
        // Asked for by name: the note itself shows, not the graph.
        setGraphPrefs({ open: false });
        return setNotePath(found.path);
      }
    }
    if (notePath === null && notes.notes.length > 0) setNotePath(notes.notes[0].path);
  }, [inNotes, notes.status, notes.notes, notes.folder, noteRequest, notePath]);
  const createNote = (folder = "") =>
    void notes.create(undefined, folder).then(
      (path) => {
        setNotePath(path);
        setNaming(true);
        setGraphPrefs({ open: false });
      },
      () => undefined,
    );
  // The notes as a graph: their [[links]] and #tags, for the rendered note, the backlinks and the 3D view.
  const [noteQuery, setNoteQuery] = useState("");
  const [graphPrefs, setGraphPrefs] = useNotesGraphPrefs();
  const graph = useMemo(() => buildGraph(notes.notes), [notes.notes]);
  const { create: makeNote, notes: noteList } = notes;
  /** A link followed: its note opens in the editor; one not written yet is made first. */
  const openLink = useCallback(
    (target: string) => {
      const show = (path: string) => {
        setNotePath(path);
        setGraphPrefs({ open: false });
      };
      const path = resolveLink(target, noteList);
      if (path) return show(path);
      const name = linkFileName(target);
      if (name) void makeNote(name).then(show, () => undefined);
    },
    [noteList, makeNote, setGraphPrefs],
  );
  const searchTag = useCallback((tag: string) => setNoteQuery(`#${tag}`), []);
  const onGraphNode = (node: GraphNode) => {
    if (node.kind === "tag") return setNoteQuery(node.label);
    if (node.kind === "missing") return openLink(node.label);
    setNotePath(node.id);
    setGraphPrefs({ open: false });
  };
  const active = conversations.find((conversation) => conversation.id === activeId);
  const answering = assistant.answering.includes(activeId);
  /** Others at work while this one is on screen. */
  const elsewhere = assistant.answering.filter((id) => id !== activeId).length;
  const live = turn && !turn.done && turn.conversationId === activeId ? turn : null;
  const agent = active?.agent;
  /** The notes JARVIS read for the answer on its way, or for the latest one that read any: they fire in the graph. */
  const consulted = live?.sources.length ? live.sources : [...(active?.items ?? [])].reverse().find((item) => item.sources?.length)?.sources;
  const recalled = useMemo(() => {
    const folder = notes.folder?.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (!folder || !consulted) return [];
    return consulted.flatMap((path) => {
      const plain = path.replace(/\\/g, "/").toLowerCase();
      if (!plain.startsWith(`${folder}/`)) return [];
      const inside = plain.slice(folder.length + 1);
      const note = noteList.find((item) => item.path.toLowerCase() === inside);
      return note ? [note.path] : [];
    });
  }, [consulted, notes.folder, noteList]);

  return (
    <section data-testid="chat-view" aria-label="Modo chat" className="chat-skin fixed inset-x-0 bottom-0 z-[21] flex bg-hud-void font-hud text-hud-text" style={{ top }}>
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        answering={assistant.answering}
        onSelect={assistant.select}
        onCreate={assistant.create}
        onRename={assistant.rename}
        onRemove={assistant.remove}
        section={section}
        onSection={onSection}
        collapsed={collapsed}
        onCollapsed={onCollapsed}
        notes={
          <NotesList
            notes={notes}
            path={notePath}
            onOpen={(path) => {
              setNotePath(path);
              setGraphPrefs({ open: false });
            }}
            onCreate={createNote}
            onMoved={(from, to) => {
              // The open note renamed or moved, or in a folder renamed, goes on from its new place; in a folder deleted, it is gone.
              if (notePath === from) return setNotePath(to);
              if (notePath === null || !notePath.startsWith(`${from}/`)) return;
              setNotePath(to === null ? null : to + notePath.slice(from.length));
            }}
            closed={notePrefs.closed}
            onClosed={(closed) => setNotePrefs((current) => ({ ...current, closed }))}
            query={noteQuery}
            onQuery={setNoteQuery}
            graph={graphPrefs.open}
            onGraph={(open) => setGraphPrefs({ open })}
          />
        }
        agents={
          <AgentsList
            onPick={(name) => {
              assistant.startWith(name);
              onSection("conversations");
            }}
          />
        }
      />
      {inNotes ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={null}>
            {graphPrefs.open && notes.status === "ready" ? (
              <NotesGraph graph={graph} selected={notePath} recalled={recalled} paused={paused} focused={focused} onNode={onGraphNode} />
            ) : (
              <NotesPanel
                notes={notes}
                path={notePath}
                onPath={setNotePath}
                view={notePrefs.view}
                onView={(view) => setNotePrefs((current) => ({ ...current, view }))}
                naming={naming}
                onNamed={() => setNaming(false)}
                graph={graph}
                onLink={openLink}
                onTag={searchTag}
              />
            )}
          </Suspense>
          <button
            type="button"
            aria-label="Voltar ao desktop"
            title="Voltar ao desktop (Ctrl+Shift+J)"
            onClick={onDesktop}
            className="absolute right-3 bottom-3 grid size-8 cursor-pointer place-items-center rounded-lg border border-hud-line/40 bg-hud-panel text-hud-text/60 outline-none transition hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
          >
            <Monitor size={15} strokeWidth={1.7} />
          </button>
        </div>
      ) : (
      <div className="flex min-w-0 flex-1 flex-col">
        {/* With the top bar off this is the window's handle too. */}
        <header data-tauri-drag-region className="flex h-14 shrink-0 items-center gap-3 border-b border-hud-line/60 bg-hud-panel px-4">
          {agent ? <AgentAvatar size={38} active={answering} /> : <CoreAvatar size={38} active={answering} />}
          <div data-tauri-drag-region className="min-w-0 flex-1">
            <h1 data-testid="chat-title" className="truncate text-[14px] font-semibold text-hud-light">
              {active?.title ?? "JARVIS"}
            </h1>
            <p data-testid="chat-who" className="truncate text-[12px] text-hud-text/50">
              {agent ? `agente ${agent}` : "JARVIS"}
              {answering ? " · respondendo…" : ""}
              {elsewhere > 0 ? ` · ${elsewhere} ${elsewhere === 1 ? "outra conversa em andamento" : "outras conversas em andamento"}` : ""}
            </p>
          </div>
          {agent && (
            <HeaderButton
              label="Rodar no terminal"
              title="Rodar este agente no terminal do desktop, com todas as ferramentas dele"
              onClick={() => onRunAgent(agent, active?.items[active.items.length - 1]?.question ?? "")}
            >
              <SquareTerminal size={15} strokeWidth={1.7} />
            </HeaderButton>
          )}
          <HeaderButton
            label="Falar as respostas"
            title={speech.available ? "Falar as respostas" : "Falar as respostas (escolha e baixe uma voz nas Configurações)"}
            pressed={speak}
            disabled={!speech.available}
            onClick={() => {
              if (speak) speech.stop();
              onSpeak(!speak);
            }}
          >
            {speak && speech.available ? <Volume2 size={15} strokeWidth={1.7} /> : <VolumeX size={15} strokeWidth={1.7} />}
          </HeaderButton>
          <HeaderButton label="Voltar ao desktop" title="Voltar ao desktop (Ctrl+Shift+J)" onClick={onDesktop}>
            <Monitor size={15} strokeWidth={1.7} />
          </HeaderButton>
        </header>
        <ChatThread items={active?.items ?? []} live={live} speech={speech} canOpen={canOpen} onOpenFile={onOpenFile} agent={agent} onAnswerMenu={(at, entry) => setAnswerMenu({ ...at, ...entry })} />
        <p role="status" data-testid="chat-notice" data-tone={(told ?? notice)?.tone} className={`mx-auto h-5 w-full max-w-[820px] shrink-0 truncate px-6 text-[12px] ${(told ?? notice)?.tone === "error" ? "text-hud-alert" : "text-hud-text/55"}`}>
          {(told ?? notice)?.text ?? ""}
        </p>
        {answerMenu && <AnswerMenu at={answerMenu} question={answerMenu.question} answer={answerMenu.answer} notes={notes} onClose={() => setAnswerMenu(null)} onTold={setTold} />}
        <ChatComposer
          key={activeId}
          answering={answering}
          phase={phase}
          onSend={(text) => assistant.ask(text)}
          onStop={assistant.cancel}
          onMicPress={assistant.press}
          onMicRelease={() => assistant.release()}
        />
      </div>
      )}
    </section>
  );
}

function HeaderButton({
  label,
  title,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-9 shrink-0 cursor-pointer place-items-center rounded-full outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-35 ${
        pressed ? "bg-hud-cyan/20 text-hud-cyan" : "text-hud-text/55 hover:bg-hud-light/8 hover:text-hud-light"
      }`}
    >
      {children}
    </button>
  );
}
