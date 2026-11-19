import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrainCircuit, FileText, Square, Volume2 } from "lucide-react";
import type { AssistantTurn } from "../../hooks/useAssistant";
import type { ChatSpeech } from "../../hooks/useChatSpeech";
import { describeTool, type ConversationEntry } from "../../lib/assistant";
import { baseName } from "../../lib/files";
import { MARKDOWN_COMPONENTS } from "../desktop/apps/markdownComponents";
import { AgentAvatar } from "./AgentAvatar";
import { CoreAvatar } from "./CoreAvatar";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/** "14:32" today, "25/10 14:32" before. */
function when(at: number) {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? TIME.format(date) : `${DAY.format(date)} ${TIME.format(date)}`;
}

interface ChatThreadProps {
  items: ConversationEntry[];
  /** The answer in progress, when it belongs to this conversation. */
  live: AssistantTurn | null;
  speech: ChatSpeech;
  /** A file JARVIS wrote that an app of the desktop can show (a note, an agent). */
  canOpen: (path: string) => boolean;
  onOpenFile: (path: string) => void;
  /** The agent that answers in this conversation (absent: JARVIS). */
  agent?: string;
  /** A right click (or the menu key) on a finished answer: where, and what was asked and said. */
  onAnswerMenu: (at: { x: number; y: number }, entry: { question: string; answer: string }) => void;
}

/** The conversation in bubbles, oldest first, the answer in progress last; follows the newest. */
export function ChatThread({ items, live, speech, canOpen, onOpenFile, agent, onAnswerMenu }: ChatThreadProps) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items.length, live?.text, live?.tool, live?.files.length]);

  if (items.length === 0 && !live) {
    return (
      <div data-testid="chat-empty" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        {agent ? <AgentAvatar size={96} /> : <CoreAvatar size={96} />}
        <p className="text-lg text-hud-light/90">{agent ? `Agente ${agent}` : "Como posso ajudar?"}</p>
        <p className="max-w-sm text-[13px] leading-relaxed text-hud-text/50">
          {agent
            ? "Este agente responde aqui com as instruções dele e as mesmas travas do JARVIS: só a pasta Documentos\\JARVIS, sem rodar comandos. Para o resto, use Rodar no terminal."
            : "Escreva abaixo ou use o microfone. Eu pesquiso, anoto, organizo a agenda e as tarefas, e mostro aqui o que fiz."}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="chat-thread" className="hud-scroll flex-1 overflow-y-auto select-text">
      <ol className="mx-auto flex w-full max-w-[820px] flex-col gap-3 px-6 py-5">
        {items.map((item) => (
          <Exchange key={item.id} id={item.id} at={item.at} question={item.question} answer={item.answer} steps={item.steps ?? []} files={item.files ?? []} sources={item.sources ?? []} error={item.error} cancelled={item.cancelled} speech={speech} canOpen={canOpen} onOpenFile={onOpenFile} agent={agent} onAnswerMenu={onAnswerMenu} />
        ))}
        {live && (
          <Exchange id={live.id} at={live.id} question={live.question} answer={live.text} steps={live.steps} files={live.files} sources={live.sources} tool={live.tool} live speech={speech} canOpen={canOpen} onOpenFile={onOpenFile} agent={agent} />
        )}
      </ol>
      <div ref={end} aria-hidden className="h-px" />
    </div>
  );
}

interface ExchangeProps {
  id: number;
  at: number;
  question: string;
  answer: string;
  steps: string[];
  files: string[];
  /** The files read to answer: the notes it consulted. */
  sources: string[];
  error?: string;
  cancelled?: boolean;
  tool?: string | null;
  /** Still being answered. */
  live?: boolean;
  speech: ChatSpeech;
  canOpen: (path: string) => boolean;
  onOpenFile: (path: string) => void;
  onAnswerMenu?: ChatThreadProps["onAnswerMenu"];
  agent?: string;
}

/** A question (right) and its answer (left, by the avatar): what the agent did, said and wrote. */
function Exchange({ id, at, question, answer, steps, files, sources, error, cancelled, tool, live = false, speech, canOpen, onOpenFile, agent, onAnswerMenu }: ExchangeProps) {
  const speaking = speech.speakingId === id;
  return (
    <li className="flex flex-col gap-3">
      <div data-testid="chat-message" data-role="user" className="max-w-[75%] self-end rounded-2xl rounded-br-md bg-chat-mine px-3.5 py-2 shadow-sm">
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-hud-light">{question}</p>
        <time className="mt-0.5 block text-right text-[11px] text-hud-light/55">{when(at)}</time>
      </div>
      <div className="flex max-w-[85%] items-end gap-2.5 self-start">
        {agent ? <AgentAvatar size={34} active={live} /> : <CoreAvatar size={34} active={live} />}
        <div
          data-testid="chat-message"
          data-role="jarvis"
          data-live={live || undefined}
          onContextMenu={
            // A finished answer with something said can go to the notes.
            onAnswerMenu && !live && answer.trim()
              ? (event) => {
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  // From the keyboard (the menu key) there is no pointer: by the answer's corner.
                  const fromKeys = event.clientX === 0 && event.clientY === 0;
                  onAnswerMenu({ x: fromKeys ? box.left + 24 : event.clientX, y: fromKeys ? box.top + 24 : event.clientY }, { question, answer });
                }
              : undefined
          }
          className="min-w-0 rounded-2xl rounded-bl-md bg-chat-theirs px-3.5 py-2 shadow-sm"
        >
          {steps.length > 0 && (
            <ul data-testid="chat-steps" aria-label={agent ? "O que o agente fez" : "O que o JARVIS fez"} className="mb-2 space-y-0.5 border-l-2 border-hud-cyan/60 pl-2.5 text-[12px] text-hud-cyan">
              {steps.map((step, index) => (
                <li key={index}>{describeTool(step)}</li>
              ))}
            </ul>
          )}
          {answer && (
            <div className="text-[14px] text-hud-text">
              <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {answer}
              </Markdown>
            </div>
          )}
          {files.map((path) => (
            <div key={path} data-testid="chat-file" className="mt-2 flex items-center gap-3 rounded-xl bg-hud-void/50 px-2.5 py-2">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-hud-cyan text-hud-void">
                <FileText size={18} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-hud-light" title={path}>
                {baseName(path)}
              </span>
              {canOpen(path) && (
                <button
                  type="button"
                  aria-label={`Abrir ${baseName(path)}`}
                  onClick={() => onOpenFile(path)}
                  className="cursor-pointer rounded-md px-2 py-1 text-[13px] text-hud-cyan outline-none transition hover:underline focus-visible:ring-1 focus-visible:ring-hud-light/50"
                >
                  Abrir
                </button>
              )}
            </div>
          ))}
          {sources.some(canOpen) && (
            <p data-testid="chat-sources" className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-hud-text/60">
              <BrainCircuit aria-hidden size={13} strokeWidth={1.8} className="text-hud-cyan" />
              Consultou:
              {sources.filter(canOpen).map((path) => (
                <button
                  key={path}
                  type="button"
                  title={path}
                  onClick={() => onOpenFile(path)}
                  className="cursor-pointer rounded-full bg-hud-void/50 px-2 py-0.5 text-hud-cyan outline-none transition hover:underline focus-visible:ring-1 focus-visible:ring-hud-light/50"
                >
                  {baseName(path).replace(/\.md$/i, "")}
                </button>
              ))}
            </p>
          )}
          {live && (
            <p data-testid="chat-status" className="text-[12px] text-hud-cyan">
              {tool ? describeTool(tool) : answer ? "Respondendo" : "Pensando"}
              <span className="crt-cursor">…</span>
            </p>
          )}
          {cancelled && <p className="mt-1 font-mono text-[10px] tracking-[0.18em] text-hud-text/40 uppercase">Interrompida</p>}
          {error && (
            <p data-testid="chat-error" className="mt-1 font-mono text-[11px] whitespace-pre-wrap text-hud-alert">
              {error}
            </p>
          )}
          {!live && (
            <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-hud-text/45">
              <time>{when(at)}</time>
              {answer && speech.available && (
                <button
                  type="button"
                  aria-label={speaking ? "Parar de ouvir" : "Ouvir"}
                  title={speaking ? "Parar de ouvir" : "Ouvir"}
                  aria-pressed={speaking}
                  onClick={() => (speaking ? speech.stop() : speech.speak(id, answer))}
                  className={`grid size-5 cursor-pointer place-items-center rounded outline-none transition hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 ${speaking ? "text-hud-light" : ""}`}
                >
                  {speaking ? <Square size={10} strokeWidth={2.2} /> : <Volume2 size={12} strokeWidth={1.8} />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
