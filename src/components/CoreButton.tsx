import type { CorePhase } from "../hooks/useAssistant";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";

const LABEL: Record<CorePhase, string> = {
  idle: "Falar com o JARVIS",
  listening: "Enviar para o JARVIS",
  transcribing: "Cancelar a pergunta",
  thinking: "Interromper o JARVIS",
  answering: "Interromper o JARVIS",
};

const HINT: Record<CorePhase, string> = {
  idle: "Clique e fale (ou segure enquanto fala)",
  listening: "Clique para enviar · Esc cancela",
  transcribing: "Entendendo a pergunta… · clique ou Esc cancela",
  thinking: "Pensando… · clique ou Esc interrompe",
  answering: "Respondendo… · clique ou Esc interrompe",
};

interface CoreButtonProps {
  phase: CorePhase;
  onPress: () => void;
  /** `cancel`: the press was taken away (the pointer was lost), not released. */
  onRelease: (cancel?: boolean) => void;
}

/**
 * The heart of the hologram as a button: talk to JARVIS. Invisible over the inner rings of the
 * core (2D or 3D), under the windows; a ring breathes while the microphone is on.
 */
export function CoreButton({ phase, onPress, onRelease }: CoreButtonProps) {
  const listening = phase === "listening";
  return (
    <button
      type="button"
      // Still the desktop surface: a click here also leaves no window focused.
      data-desktop-surface
      data-core-button={phase}
      aria-label={LABEL[phase]}
      title={HINT[phase]}
      className="group fixed left-1/2 z-[12] -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-hud-light/40"
      style={{ top: CORE_CENTER_Y_CSS, width: `calc(${COMPOSITION_CSS} * 0.5)`, height: `calc(${COMPOSITION_CSS} * 0.5)` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress();
      }}
      onPointerUp={(event) => {
        if (event.button === 0) onRelease();
      }}
      onPointerCancel={() => onRelease(true)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (!event.repeat) onPress();
      }}
      onKeyUp={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onRelease();
      }}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-full border transition-[opacity,box-shadow] duration-300 ${
          listening
            ? "animate-pulse border-hud-holo/60 opacity-100 shadow-[0_0_40px_color-mix(in_oklab,var(--color-hud-holo)_45%,transparent),inset_0_0_30px_color-mix(in_oklab,var(--color-hud-holo)_30%,transparent)]"
            : "border-hud-cyan/25 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      />
    </button>
  );
}
