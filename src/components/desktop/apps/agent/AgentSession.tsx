import { useEffect, useRef, useState } from "react";
import type { AssistantTurn, CorePhase } from "../../../../hooks/useAssistant";
import { describeTool, isBreak, speechText, type HistoryItem } from "../../../../lib/assistant";

/** What JARVIS and the user said, as the app keeps it (`useAssistant`). */
export interface AgentConversation {
  items: HistoryItem[];
  turn: AssistantTurn | null;
  phase: CorePhase;
}

/** Something that happened to the agent (written, reviewed, run). */
export interface SessionEvent {
  at: number;
  icon: "✎" | "✓" | "→" | "⚠" | "▶" | "✗";
  text: string;
}

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** A long answer is cut here (the whole one is in the history). */
const MAX_ANSWER = 420;

const ICON_TONE: Record<SessionEvent["icon"], string> = {
  "✎": "text-hud-cyan",
  "✓": "text-hud-light",
  "→": "text-hud-cyan",
  "⚠": "text-hud-amber",
  "▶": "text-hud-light",
  "✗": "text-hud-alert",
};

interface Line {
  key: string;
  at: number;
  who: "você" | "jarvis" | SessionEvent["icon"];
  text: string;
  /** Still being said or written. */
  live?: boolean;
}

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % SPINNER.length), 100);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="text-hud-amber">{SPINNER[frame]}</span>;
}

/** The conversation since `since` (and since the last "Nova conversa"), with the events, in time order. */
function sessionLines(conversation: AgentConversation | null, events: SessionEvent[], since: number): Line[] {
  const lines: Line[] = [];
  const items = conversation?.items ?? [];
  const lastBreak = items.reduce((at, item) => (isBreak(item) ? item.at : at), 0);
  for (const item of items) {
    if (isBreak(item) || item.at < since || item.at < lastBreak) continue;
    lines.push({ key: `q${item.id}`, at: item.at, who: "você", text: item.question });
    const answer = item.error ? `(${item.error})` : item.cancelled ? "(interrompida)" : speechText(item.answer);
    lines.push({ key: `a${item.id}`, at: item.at, who: "jarvis", text: answer.length > MAX_ANSWER ? `${answer.slice(0, MAX_ANSWER)}…` : answer });
  }
  events.forEach((event, index) => lines.push({ key: `e${index}`, at: event.at, who: event.icon, text: event.text }));
  const turn = conversation?.turn;
  if (turn && !turn.done && turn.id >= since) {
    lines.push({ key: `q${turn.id}`, at: turn.id, who: "você", text: turn.question });
    lines.push({ key: `a${turn.id}`, at: turn.id, who: "jarvis", text: turn.text ? speechText(turn.text) : turn.tool ? describeTool(turn.tool) : "pensando", live: true });
  }
  // Stable: a question stays before its answer.
  return lines.map((line, index) => ({ line, index })).sort((a, b) => a.line.at - b.line.at || a.index - b.index).map(({ line }) => line);
}

/**
 * jv_agent's terminal: the interview said to JARVIS (you › / jarvis ›) between what happened to
 * the agent, and a prompt line saying what to do next.
 */
export function AgentSession({ conversation, events, since, hint }: { conversation: AgentConversation | null; events: SessionEvent[]; since: number; hint: string }) {
  const lines = sessionLines(conversation, events, since);
  const phase = conversation?.phase ?? "idle";
  const scroller = useRef<HTMLDivElement>(null);
  const last = lines[lines.length - 1];
  const bottom = `${lines.length}:${last?.text.length ?? 0}:${phase}`;
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [bottom]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-6 shrink-0 items-center border-b border-hud-cyan/10 px-3 text-[10px] tracking-[0.24em] text-hud-text/45 uppercase">Sessão</div>
      <div ref={scroller} role="log" aria-label="Sessão do agente" className="hud-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2 select-text">
        {!lines.length && <p className="text-hud-text/40">Nada ainda nesta sessão. O que você e o JARVIS disserem sobre o agente aparece aqui.</p>}
        {lines.map((line) => (
          <div key={line.key} data-who={line.who} className="grid grid-cols-[5ch_8ch_1fr] gap-x-1 leading-snug">
            <span className="text-hud-text/30 tabular-nums">{TIME.format(line.at)}</span>
            {line.who === "você" || line.who === "jarvis" ? (
              <span className={line.who === "você" ? "text-hud-cyan" : "text-hud-light"}>{line.who} ›</span>
            ) : (
              <span className={`text-right ${ICON_TONE[line.who]}`}>{line.who}</span>
            )}
            <span className={`whitespace-pre-wrap break-words ${line.who === "você" ? "text-hud-text" : line.who === "jarvis" ? "text-hud-text/80" : "text-hud-text/60"}`}>
              {line.live && !line.text.length ? null : line.text}
              {line.live && (
                <>
                  {" "}
                  <Spinner />
                </>
              )}
            </span>
          </div>
        ))}
        {(phase === "listening" || phase === "transcribing") && (
          <div className="grid grid-cols-[5ch_8ch_1fr] gap-x-1 leading-snug">
            <span />
            <span className="text-hud-cyan">você ›</span>
            <span className="text-hud-amber">{phase === "listening" ? "● ouvindo…" : "transcrevendo…"}</span>
          </div>
        )}
      </div>
      <div data-testid="agent-prompt" className="flex h-7 shrink-0 items-center gap-1 truncate border-t border-hud-cyan/10 px-3 text-hud-text/60">
        <span className="text-hud-cyan">jarvis@agente</span>
        <span>:~$</span>
        <span className="truncate">{hint}</span>
        <span aria-hidden className="crt-cursor text-hud-light">
          ▌
        </span>
      </div>
    </div>
  );
}
