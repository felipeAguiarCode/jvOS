import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Heard } from "../hooks/useVoiceAssistant";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";

/** How long a phrase stays up: a base plus a little per word (ms). */
const HOLD_MS = 3200;
const HOLD_PER_WORD_MS = 220;
/** Long phrases keep only their tail. */
const MAX_WORDS = 18;
/** Delay between words as they materialise (s). */
const WORD_STAGGER = 0.07;
/** Dark, see-through backdrop: the hologram stays visible behind the words. */
const BACKDROP = "radial-gradient(closest-side, rgb(0 5 8 / 0.62), rgb(0 5 8 / 0.38) 55%, rgb(0 5 8 / 0))";
const GLOW = "0 0 18px rgb(0 229 255 / 0.55), 0 0 4px rgb(181 250 255 / 0.5)";
const DOT_GLOW = "0 0 10px rgb(0 229 255 / 0.8)";

interface VoiceCaptionProps {
  heard: Heard | null;
  /** Whisper is working on a phrase: three pulsing dots instead of text. */
  transcribing: boolean;
}

/** What the assistant heard, materialising word by word inside the hologram's core. */
export function VoiceCaption({ heard, transcribing }: VoiceCaptionProps) {
  const [expired, setExpired] = useState<number | null>(null);

  useEffect(() => {
    if (!heard) return;
    const words = Math.min(MAX_WORDS, heard.text.split(/\s+/).length);
    const timer = window.setTimeout(() => setExpired(heard.id), HOLD_MS + words * HOLD_PER_WORD_MS);
    return () => window.clearTimeout(timer);
  }, [heard]);

  const shown = heard && heard.id !== expired && !transcribing ? heard : null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      style={{
        top: CORE_CENTER_Y_CSS,
        width: `calc(${COMPOSITION_CSS} * 0.62)`,
        height: `calc(${COMPOSITION_CSS} * 0.62)`,
        fontSize: `clamp(14px, calc(${COMPOSITION_CSS} * 0.042), 30px)`,
      }}
    >
      <AnimatePresence>
        {transcribing && <Thinking key="thinking" />}
        {shown && <Caption key={shown.id} text={shown.text} />}
      </AnimatePresence>
    </div>
  );
}

function Caption({ text }: { text: string }) {
  const all = text.trim().split(/\s+/);
  const words = all.length > MAX_WORDS ? ["…", ...all.slice(-MAX_WORDS)] : all;

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.6 } }}
    >
      <motion.div
        aria-hidden
        className="absolute -inset-[12%]"
        style={{ background: BACKDROP }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      />
      <p
        className="relative text-center leading-snug font-light tracking-[0.02em] text-hud-glow"
        style={{ textShadow: GLOW }}
      >
        {words.map((word, index) => (
          <span key={index}>
            <motion.span
              className="inline-block"
              initial={{ opacity: 0, y: "0.35em", filter: "blur(8px)" }}
              animate={{ opacity: 0.92, y: 0, filter: "blur(0px)" }}
              transition={{ delay: index * WORD_STAGGER, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              {word}
            </motion.span>
            {index < words.length - 1 && " "}
          </span>
        ))}
      </p>
    </motion.div>
  );
}

function Thinking() {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center gap-[0.45em]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      <div className="absolute inset-[22%]" style={{ background: BACKDROP }} />
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="relative size-[0.32em] rounded-full bg-hud-glow"
          style={{ boxShadow: DOT_GLOW }}
          animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1.15, 0.8] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.18, ease: "easeInOut" }}
        />
      ))}
    </motion.div>
  );
}
