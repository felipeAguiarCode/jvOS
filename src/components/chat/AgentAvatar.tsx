import { Bot } from "lucide-react";

/** An agent's face in the chat: not the core (that is JARVIS), a robot in a ring. Pulses while it answers. */
export function AgentAvatar({ size = 28, active = false }: { size?: number; active?: boolean }) {
  return (
    <span
      aria-hidden
      data-testid="agent-avatar"
      data-active={active || undefined}
      className={`grid shrink-0 place-items-center rounded-full bg-hud-amber text-hud-void ${active ? "animate-pulse" : ""}`}
      style={{ width: size, height: size }}
    >
      <Bot size={Math.round(size * 0.58)} strokeWidth={1.7} />
    </span>
  );
}
