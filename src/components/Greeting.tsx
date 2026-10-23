import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { createBootSound } from "../lib/bootSound";
import { pickGreeting } from "../lib/greetings";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";

/** The planet starts growing first. */
const START_MS = 450;
const WORD_MS = 210;
const HOLD_MS = 2600;
const OUT_MS = 280;

/**
 * SUPERHOT-style greeting inside the core after the boot: heavy capitals cutting in word by
 * word, each with a punchy digital hit, a little see-through so the hologram powering on shows
 * behind them, then a glitch out. The phrase varies (time of day, never twice in a row).
 */
export function Greeting({ sound, onDone }: { sound: boolean; onDone: () => void }) {
  const reduced = useReducedMotion() ?? false;
  // Picked once per boot (a lazy initialiser, so StrictMode does not burn two picks into memory).
  const [lines] = useState(() => pickGreeting().map((line) => line.split(" ")));
  const words = lines.flat();
  const [shown, setShown] = useState(reduced ? words.length : 0);
  const [leaving, setLeaving] = useState(false);
  const count = words.length;

  useEffect(() => {
    const audio = createBootSound(sound);
    const timers: number[] = [];
    const at = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    const typed = reduced ? 0 : START_MS + count * WORD_MS;
    if (reduced) at(0, audio.hit);
    else
      for (let index = 0; index < count; index++)
        at(START_MS + index * WORD_MS, () => {
          setShown(index + 1);
          audio.hit();
        });
    at(typed + HOLD_MS, () => {
      setLeaving(true);
      if (!reduced) audio.glitch();
    });
    at(typed + HOLD_MS + OUT_MS, onDone);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      audio.close();
    };
  }, [reduced, sound, onDone, count]);

  let index = 0;
  return (
    <div
      data-testid="greeting"
      className="pointer-events-none fixed left-1/2 z-[11] -translate-x-1/2 -translate-y-1/2 text-center"
      style={{ top: CORE_CENTER_Y_CSS, width: `calc(${COMPOSITION_CSS} * 0.96)` }}
    >
      <p role="status" className="sr-only">
        {lines.map((line) => line.join(" ")).join(" ")}
      </p>
      <p
        aria-hidden
        className={`crt-text superhot-text m-0 uppercase ${leaving ? (reduced ? "opacity-0 transition-opacity duration-300" : "superhot-out") : ""}`}
        style={{ fontSize: `clamp(22px, calc(${COMPOSITION_CSS} * 0.075), 64px)` }}
      >
        {lines.map((line, row) => (
          <span key={row} className="block">
            {line.map((word) => {
              const position = index++;
              // Words not yet cut in keep their place, so the lines never reflow.
              return (
                <span key={position} className={`mx-[0.12em] ${position < shown ? "superhot-word" : "invisible"}`}>
                  {word}
                </span>
              );
            })}
          </span>
        ))}
      </p>
    </div>
  );
}
