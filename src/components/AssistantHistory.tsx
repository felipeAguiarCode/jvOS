import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssistantTurn } from "../hooks/useAssistant";
import { describeTool, isBreak, type HistoryItem } from "../lib/assistant";
import { MARKDOWN_COMPONENTS } from "./desktop/apps/markdownComponents";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/** "14:32" today, "25/10 14:32" before. */
function when(at: number) {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? TIME.format(date) : `${DAY.format(date)} ${TIME.format(date)}`;
}

/** The conversation, oldest first, with the answer in progress at the end; follows the newest. */
export function AssistantHistory({ items, turn }: { items: HistoryItem[]; turn: AssistantTurn | null }) {
  const list = useRef<HTMLOListElement>(null);
  const live = turn && !turn.done ? turn : null;

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [items.length, live?.text, live?.tool]);

  return (
    <ol ref={list} data-testid="assistant-history" className="hud-scroll flex-1 space-y-4 overflow-y-auto px-5 pb-5">
      {items.map((item) =>
        isBreak(item) ? (
          <li key={item.id} className="flex items-center gap-3 text-[10px] tracking-[0.24em] text-hud-text/40 uppercase">
            <span aria-hidden className="h-px flex-1 bg-hud-cyan/15" />
            Nova conversa · {when(item.at)}
            <span aria-hidden className="h-px flex-1 bg-hud-cyan/15" />
          </li>
        ) : (
          <Entry key={item.id} at={item.at} question={item.question} answer={item.answer} error={item.error} cancelled={item.cancelled} />
        ),
      )}
      {live && <Entry at={live.id} question={live.question} answer={live.text} tool={live.tool} live />}
    </ol>
  );
}

interface EntryProps {
  at: number;
  question: string;
  answer: string;
  error?: string;
  cancelled?: boolean;
  tool?: string | null;
  /** Still being answered. */
  live?: boolean;
}

function Entry({ at, question, answer, error, cancelled, tool, live }: EntryProps) {
  return (
    <li data-testid="assistant-entry" className="space-y-1.5">
      <p className="flex gap-2 font-mono text-[12px] leading-relaxed text-hud-text/65">
        <span aria-hidden className="text-hud-cyan">›</span>
        <span className="flex-1">{question}</span>
        <time className="shrink-0 text-[10px] text-hud-text/35">{when(at)}</time>
      </p>
      <div className="border-l border-hud-cyan/20 pl-3 text-[13px] text-hud-text/90">
        {answer && (
          <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {answer}
          </Markdown>
        )}
        {live && (
          <p className="font-mono text-[11px] tracking-[0.12em] text-hud-amber/80 uppercase">
            {tool ? describeTool(tool) : answer ? "Respondendo" : "Pensando"}
            <span className="crt-cursor">…</span>
          </p>
        )}
        {cancelled && <p className="font-mono text-[10px] tracking-[0.18em] text-hud-text/40 uppercase">Interrompida</p>}
        {error && <p className="font-mono text-[11px] whitespace-pre-wrap text-hud-alert">{error}</p>}
      </div>
    </li>
  );
}
