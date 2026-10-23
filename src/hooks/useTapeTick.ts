import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Reels turn at this rate while a song plays. */
const TICK_MS = 125;

/**
 * The cassette's animation step: it advances only while music plays and the app is visible.
 * With reduced motion the reels stay still (the tape still moves with the song).
 */
export function useTapeTick(running: boolean, paused: boolean) {
  const [tick, setTick] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!running || paused || reduced) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, paused, reduced]);
  return tick;
}
