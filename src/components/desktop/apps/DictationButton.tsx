import { useRef, type PointerEvent } from "react";
import { Mic } from "lucide-react";
import type { DictationApi } from "../../../lib/dictation";
import { UNAVAILABLE } from "../../../lib/files";

const HOLD_KEYS = [" ", "Enter"];

/**
 * An editor's own microphone (Jarvis Mark, and the notes of the chat): held like the dock's
 * Voice button (pointer capture keeps the release coming), the text arrives through the
 * dictation context when Whisper is done.
 */
export function DictationButton({ dictation }: { dictation: DictationApi }) {
  const holding = useRef(false);
  const listening = dictation.state === "listening";

  const hold = (down: boolean) => {
    if (!dictation.available || holding.current === down) return;
    holding.current = down;
    dictation.hold(down);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Keeps the editor's selection, so the text lands where the cursor was.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    hold(true);
  };

  return (
    <button
      type="button"
      aria-label="Ditar (segure para falar)"
      aria-pressed={listening}
      title={dictation.available ? "Ditar: segure para falar, solte para inserir no cursor" : UNAVAILABLE}
      disabled={!dictation.available}
      onPointerDown={onPointerDown}
      onPointerUp={() => hold(false)}
      onPointerCancel={() => hold(false)}
      onLostPointerCapture={() => hold(false)}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!HOLD_KEYS.includes(event.key)) return;
        event.preventDefault();
        if (!event.repeat) hold(true);
      }}
      onKeyUp={(event) => {
        if (!HOLD_KEYS.includes(event.key)) return;
        event.preventDefault();
        hold(false);
      }}
      onBlur={() => hold(false)}
      className={`relative grid size-7 cursor-pointer touch-none place-items-center rounded-lg outline-none transition select-none focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-30 ${
        listening
          ? "bg-hud-alert/15 text-hud-alert"
          : dictation.state === "transcribing"
            ? "bg-hud-cyan/[0.12] text-hud-light"
            : "text-hud-text/60 hover:bg-hud-cyan/10 hover:text-hud-light"
      }`}
    >
      <Mic size={14} strokeWidth={1.7} />
      {listening && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 size-1.5 animate-pulse rounded-full bg-hud-alert shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-alert)_80%,transparent)]"
        />
      )}
    </button>
  );
}
