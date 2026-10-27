import { useEffect, useMemo, useReducer, useRef } from "react";
import { useReducedMotion } from "motion/react";
import type { AssistantTurn } from "../hooks/useAssistant";
import { describeTool, speechText } from "../lib/assistant";
import { createBootSound } from "../lib/bootSound";
import { createSpeechPlayer } from "../lib/speech";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";
import { BACKDROP, Thinking } from "./VoiceCaption";

/** A page holds a sentence, or this many words of a long one. */
const PAGE_WORDS = 14;
/** A sentence shorter than this shares its page with the next. */
const MIN_PAGE_WORDS = 4;
/** Between words cutting in (ms). */
const WORD_MS = 170;
/** A complete page stays up for a base plus a little per word (ms). */
const HOLD_MS = 1100;
const HOLD_PER_WORD_MS = 230;
/** The glitch out (matches `superhot-out`). */
const OUT_MS = 280;
/** An error stays up this long. */
const ERROR_MS = 5000;
const TICK_MS = 40;

const SENTENCE_END = /[.!?…:;]["”'’)\]]*$/;

/**
 * The answer cut into pages of big words. Pages never change once complete, so the answer can
 * keep streaming in; the word still being written is held back. `complete` is how many pages
 * are final (the last one may still grow).
 */
export function paginate(markdown: string, done: boolean) {
  const paragraphs = speechText(markdown)
    .split("\n\n")
    .map((paragraph) => paragraph.split(" ").filter(Boolean));
  if (!done && !/\s$/.test(markdown)) paragraphs[paragraphs.length - 1]?.pop();
  const pages: string[][] = [];
  let open = false;
  for (const words of paragraphs) {
    let page: string[] = [];
    for (const word of words) {
      page.push(word);
      if (page.length >= PAGE_WORDS || (page.length >= MIN_PAGE_WORDS && SENTENCE_END.test(word))) {
        pages.push(page);
        page = [];
      }
    }
    open = page.length > 0;
    if (open) pages.push(page);
  }
  return { pages, complete: done || !open ? pages.length : pages.length - 1 };
}

/** The page's sentence being spoken. */
interface Spoken {
  /** When the voice started (performance.now()). */
  start: number;
  /** Milliseconds. */
  duration: number;
  /** When it finished, once it has. */
  endedAt: number | null;
}

interface Stage {
  page: number;
  /** Words of the page cut in so far. */
  shown: number;
  mode: "typing" | "holding" | "leaving";
  until: number;
  /** Cancelled: the page on screen glitches out and that is all. */
  stopping: boolean;
  /** A failed answer: its error stays up until then. */
  errorUntil: number | null;
  /** This page's voice is being made (the page waits for it). */
  voicing: boolean;
  spoken: Spoken | null;
  /** This page could not be spoken: it keeps the text's own pace. */
  silent: boolean;
}

/** The voice JARVIS speaks with (null: he only writes). */
export interface ReplyVoice {
  voice: string;
  speed: number;
}

interface JarvisReplyProps {
  turn: AssistantTurn;
  /** The boot sound preference: word hits and glitches. */
  sound: boolean;
  speech: ReplyVoice | null;
  /** His voice as it plays, for the hologram to follow (null when silent again). */
  onVoice: (analyser: AnalyserNode | null) => void;
  /** Everything was shown (or the answer was cancelled). */
  onFinished: () => void;
}

/** After a spoken sentence, a beat before the next. */
const SPOKEN_GAP_MS = 250;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * JARVIS's answer inside the core, SUPERHOT style: heavy capitals cutting in word by word, a
 * sentence at a time, each page glitching out for the next — while the answer still streams.
 * With his voice on, each sentence shows as he starts saying it, its words spread over his
 * speech, and leaves when he is done. Before the first word, the question and three pulsing
 * dots; during a web search, a status line.
 */
export function JarvisReply({ turn, sound, speech, onVoice, onFinished }: JarvisReplyProps) {
  const reduced = useReducedMotion() ?? false;
  const { pages, complete } = useMemo(() => paginate(turn.text, turn.done), [turn.text, turn.done]);
  const stage = useRef<Stage>({ page: 0, shown: 0, mode: "typing", until: 0, stopping: false, errorUntil: null, voicing: false, spoken: null, silent: false });
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const latest = useRef({ pages, complete, turn, onFinished });
  latest.current = { pages, complete, turn, onFinished };
  // Chosen when the answer starts; one player per answer (silenced when it goes).
  const voice = useRef({ speech, onVoice });
  /** He speaks this answer (a voice was chosen and can be played here). */
  const speaking = useRef(false);

  useEffect(() => {
    const audio = createBootSound(sound);
    const player = voice.current.speech ? createSpeechPlayer(voice.current.speech, voice.current.onVoice) : null;
    speaking.current = player !== null;
    /** Pages handed to the voice so far (each one complete, in order). */
    let prepared = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      latest.current.onFinished();
    };
    /** Starts saying page `page` once its voice is ready; a page that cannot be said goes silent. */
    const speak = (page: number) => {
      void player!.ready(page).then(async (buffer) => {
        const playback = buffer && (await player!.play(buffer));
        const at = stage.current;
        if (at.page !== page || at.stopping) return;
        at.voicing = false;
        if (!playback) at.silent = true;
        else {
          const spoken: Spoken = { start: performance.now(), duration: playback.duration * 1000, endedAt: null };
          at.spoken = spoken;
          void playback.ended.then(() => (spoken.endedAt = performance.now()));
        }
      });
    };
    const timer = window.setInterval(() => {
      const { pages, complete, turn } = latest.current;
      const now = performance.now();
      const at = stage.current;
      const words = pages[at.page];
      // Every complete sentence starts being made ahead, so the next one is ready in time.
      if (player) for (; prepared < complete; prepared++) player.prepare(prepared, pages[prepared].join(" "));
      const voiced = player !== null && !at.silent;
      let changed = false;
      if (turn.cancelled && !at.stopping) {
        at.stopping = true;
        at.mode = "leaving";
        at.until = now + OUT_MS;
        player?.close();
        changed = true;
      } else if (at.mode === "leaving") {
        if (now >= at.until) {
          if (at.stopping) return finish();
          at.page++;
          at.shown = 0;
          at.mode = "typing";
          at.until = now;
          at.voicing = false;
          at.spoken = null;
          at.silent = false;
          changed = true;
        }
      } else if (!words) {
        // Everything shown: an error stays up a while, a complete answer is over.
        if (turn.done && turn.error && at.errorUntil === null) {
          at.errorUntil = now + ERROR_MS;
          changed = true;
        } else if (turn.done && (at.errorUntil === null || now >= at.errorUntil)) {
          return finish();
        }
      } else if (at.mode === "typing" && voiced) {
        // Spoken: whole sentences only, shown as he says them, words spread over his speech.
        if (!at.spoken) {
          if (!at.voicing && at.page < complete) {
            at.voicing = true;
            speak(at.page);
            changed = true;
          }
        } else {
          const step = clamp((at.spoken.duration * 0.85) / words.length, 90, 400);
          const due = reduced ? words.length : Math.min(words.length, Math.floor((now - at.spoken.start) / step) + 1);
          if (due > at.shown) {
            at.shown = due;
            changed = true;
          }
          if (at.shown >= words.length) at.mode = "holding";
        }
      } else if (at.mode === "typing" && now >= at.until) {
        if (at.shown < words.length) {
          if (at.shown === 0) audio.hit();
          at.shown = reduced ? words.length : at.shown + 1;
          at.until = now + WORD_MS;
          changed = true;
        } else if (at.page < complete) {
          at.mode = "holding";
          at.until = now + HOLD_MS + words.length * HOLD_PER_WORD_MS;
        }
      } else if (at.mode === "holding" && (at.spoken ? at.spoken.endedAt !== null && now >= at.spoken.endedAt + SPOKEN_GAP_MS : now >= at.until)) {
        at.mode = "leaving";
        at.until = now + OUT_MS;
        // His voice is the sound; without it, the glitch's zaps.
        if (!reduced && !at.spoken) audio.glitch();
        changed = true;
      }
      if (changed) rerender();
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      audio.close();
      player?.close();
    };
  }, [sound, reduced]);

  const at = stage.current;
  const words = pages[at.page] ?? [];
  // Nothing to show yet: the first words (or the next ones) are still being written — or said.
  const unspoken = speaking.current && !at.silent && !at.spoken && at.mode === "typing" && words.length > 0;
  const waiting = (!turn.done && words.length === 0) || unspoken;
  const leaving = at.mode === "leaving";
  const failed = turn.done && turn.error && !pages[at.page] ? turn.error : null;

  return (
    <div
      data-testid="jarvis-reply"
      data-page={at.page}
      className="pointer-events-none fixed left-1/2 z-[11] -translate-x-1/2 -translate-y-1/2 text-center"
      style={{ top: CORE_CENTER_Y_CSS, width: `calc(${COMPOSITION_CSS} * 1.1)` }}
    >
      <p role="status" className="sr-only">
        {turn.done && !turn.cancelled ? (turn.error ?? speechText(turn.text)) : ""}
      </p>
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -z-10 -translate-x-1/2 -translate-y-1/2"
        style={{ width: `calc(${COMPOSITION_CSS} * 0.95)`, height: `calc(${COMPOSITION_CSS} * 0.95)`, background: BACKDROP }}
      />
      {((waiting && at.page === 0) || turn.tool) && (
        <p
          data-testid="jarvis-reply-question"
          className="absolute inset-x-0 bottom-full mb-[0.6em] truncate font-mono tracking-[0.08em] text-hud-text/60 uppercase"
          style={{ fontSize: `clamp(10px, calc(${COMPOSITION_CSS} * 0.024), 14px)` }}
        >
          › {turn.question}
        </p>
      )}
      {waiting && !turn.tool && (
        <div aria-hidden className="relative mx-auto" style={{ width: `calc(${COMPOSITION_CSS} * 0.3)`, height: `calc(${COMPOSITION_CSS} * 0.16)`, fontSize: `clamp(14px, calc(${COMPOSITION_CSS} * 0.042), 30px)` }}>
          <Thinking />
        </div>
      )}
      {turn.tool && (
        <p
          data-testid="jarvis-reply-tool"
          className="font-mono tracking-[0.14em] text-hud-amber uppercase"
          style={{ fontSize: `clamp(11px, calc(${COMPOSITION_CSS} * 0.028), 16px)` }}
        >
          {describeTool(turn.tool)}
          <span className="crt-cursor">…</span>
        </p>
      )}
      {failed ? (
        <p data-testid="jarvis-reply-error" className="mx-auto max-w-[80%] font-mono text-sm text-hud-alert">
          {failed}
        </p>
      ) : unspoken ? null : (
        <p
          key={at.page}
          aria-hidden
          data-testid="jarvis-reply-words"
          className={`crt-text superhot-text m-0 uppercase ${leaving ? (reduced ? "opacity-0 transition-opacity duration-300" : "superhot-out") : ""}`}
          style={{ fontSize: `clamp(18px, calc(${COMPOSITION_CSS} * 0.052), 42px)` }}
        >
          {words.map((word, index) => (
            // Words not cut in yet keep their place, so the lines never reflow.
            <span key={index} className={`mx-[0.12em] ${index < at.shown ? (reduced ? "inline-block" : "superhot-word") : "invisible"}`}>
              {word}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
