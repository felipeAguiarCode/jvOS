import { figureRows, litParts, type AgentSheet, type Part } from "../../../../lib/agentFigure";

/** Where the agent is: nothing open, a draft, being written, held back, under review, running. */
export type FigureState = "empty" | "draft" | "live" | "problem" | "review" | "running";

/** The colour of the parts built, by state. */
const TONE: Record<FigureState, string> = {
  empty: "text-hud-cyan",
  draft: "text-hud-cyan",
  live: "text-hud-cyan",
  problem: "text-hud-cyan",
  review: "text-hud-amber",
  running: "text-hud-light",
};

/** The antenna says the state at a glance (blinking while JARVIS writes). */
const ANTENNA: Record<FigureState, string> = {
  empty: "text-hud-text/20",
  draft: "text-hud-cyan",
  live: "crt-cursor text-hud-amber",
  problem: "text-hud-alert",
  review: "text-hud-amber",
  running: "animate-pulse text-hud-light",
};

/**
 * The agent in ASCII, built part by part as the interview fills the draft in (see
 * `lib/agentFigure`): what is not written yet stays a faint outline.
 */
export function AgentFigure({ sheet, state }: { sheet: AgentSheet; state: FigureState }) {
  const lit = new Set<Part>(state === "empty" ? [] : litParts(sheet));
  const tone = (part: Part) => {
    if (part === "antenna") return ANTENNA[state];
    if (!lit.has(part)) return "text-hud-text/20";
    // Being written: it looks around; running: its core works.
    const motion = (state === "live" && part === "eyes") || (state === "running" && part === "core") ? (part === "eyes" ? " crt-cursor" : " animate-pulse") : "";
    return `${TONE[state]} crt-text${motion}`;
  };
  const built = lit.size ? [...lit].filter((part) => part !== "antenna").length : 0;
  return (
    <pre
      role="img"
      aria-label={sheet.name ? `Agente ${sheet.name}: ${built} de 6 partes montadas` : "Agente ainda sem nome"}
      data-testid="agent-figure"
      data-state={state}
      data-lit={[...lit].join(" ")}
      // Line height 1: the box-drawing lines join from row to row.
      className="m-0 shrink-0 font-mono text-[14px] leading-none select-none"
    >
      {figureRows(sheet).map((row, index) => (
        <div key={index}>
          {row.map((segment, at) => (
            <span key={at} className={segment.part ? tone(segment.part) : undefined}>
              {segment.text}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}
