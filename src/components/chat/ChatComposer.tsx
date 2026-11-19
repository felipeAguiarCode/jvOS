import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import type { CorePhase } from "../../hooks/useAssistant";

/** The field grows with the text up to this many lines. */
const MAX_LINES = 6;
const LINE_PX = 20;

const MIC_LABEL: Record<CorePhase, string> = {
  idle: "Falar com o JARVIS",
  listening: "Ouvindo · clique para enviar",
  transcribing: "Transcrevendo…",
  thinking: "Falar com o JARVIS",
  answering: "Falar com o JARVIS",
};

interface ChatComposerProps {
  /** The conversation on screen is the one being answered: the send button stops it. */
  answering: boolean;
  phase: CorePhase;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The core's microphone, by its two halves (a click toggles, a hold is push-to-talk). */
  onMicPress: () => void;
  onMicRelease: () => void;
}

/** Where the question is written: Enter sends, Shift+Enter breaks the line, Esc stops the answer. */
export function ChatComposer({ answering, phase, onSend, onStop, onMicPress, onMicRelease }: ChatComposerProps) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const micBusy = phase === "listening" || phase === "transcribing";

  // As tall as its text, within its limit.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_LINES * LINE_PX + 18)}px`;
  }, [text]);

  // Ready to type as the chat comes in.
  useEffect(() => field.current?.focus({ preventScroll: true }), []);

  const send = () => {
    const question = text.trim();
    if (!question || answering) return;
    onSend(question);
    setText("");
  };

  return (
    <form
      data-testid="chat-composer"
      className="mx-auto mb-4 flex w-[calc(100%-3rem)] max-w-[772px] shrink-0 items-end gap-1 rounded-2xl bg-hud-panel px-2 py-1.5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={field}
        rows={1}
        aria-label="Mensagem para o JARVIS"
        placeholder="Escreva uma mensagem…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          } else if (event.key === "Escape" && answering) {
            // Stopped here: the window's own Esc (the core's) does not get it twice.
            event.preventDefault();
            onStop();
          }
        }}
        className="hud-scroll min-h-[38px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-[14px] leading-5 text-hud-light outline-none select-text placeholder:text-hud-text/40 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        aria-label={MIC_LABEL[phase]}
        title={MIC_LABEL[phase]}
        aria-pressed={micBusy}
        disabled={answering || phase === "transcribing"}
        onPointerDown={(event) => {
          if (event.button === 0) onMicPress();
        }}
        onPointerUp={(event) => {
          if (event.button === 0) onMicRelease();
        }}
        className={`grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-full outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-40 ${
          micBusy ? "bg-hud-alert/20 text-hud-alert" : "text-hud-text/55 hover:bg-hud-light/8 hover:text-hud-light"
        }`}
      >
        <Mic size={19} strokeWidth={1.7} className={phase === "listening" ? "animate-pulse" : ""} />
      </button>
      {answering ? (
        <button
          type="button"
          aria-label="Parar"
          title="Parar (Esc)"
          onClick={onStop}
          className="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-full bg-hud-alert/20 text-hud-alert outline-none transition hover:bg-hud-alert/30 focus-visible:ring-1 focus-visible:ring-hud-alert/60"
        >
          <Square size={13} strokeWidth={2.4} />
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Enviar"
          title="Enviar (Enter)"
          disabled={!text.trim()}
          className="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-full bg-hud-cyan text-hud-void outline-none transition hover:brightness-110 focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-hud-text/30"
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      )}
    </form>
  );
}
