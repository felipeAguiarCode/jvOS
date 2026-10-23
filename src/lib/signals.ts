import { createContext, useContext } from "react";

/** Number of log-spaced frequency bands in `HoloSignals.spectrum`. */
export const SPECTRUM_BANDS = 32;

/**
 * Per-frame values shared by every layer of the hologram. Mutated in place by the
 * audio driver inside the render loop — never stored in React state.
 */
export interface HoloSignals {
  /** Scene time in seconds (paused while the window is hidden, delta-clamped). */
  time: number;
  frames: number;
  /** Smoothed, normalised audio features, 0..1. They decay to 0 in silence or when the mic is off. */
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** 0..1 while someone speaks: the level rises above the background noise. Holds between syllables. */
  voice: number;
  /** Smoothed energy of each band, 0..1, from low to high frequencies (voice range). */
  spectrum: Float32Array;
  /** 0 → 1 while the microphone is open (eases in/out). */
  active: number;
  /** How closely the hologram follows the voice: low while waiting for "Hey Jarvis". */
  attention: number;
  /** Jumps to 1 on an event (wake word, command) and decays. */
  pulse: number;
  /** 0 → 1 while JARVIS listens for a command: particles and rings align on the core's equator. */
  align: number;
}

export function createSignals(): HoloSignals {
  return {
    time: 0,
    frames: 0,
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    voice: 0,
    spectrum: new Float32Array(SPECTRUM_BANDS),
    active: 0,
    attention: 1,
    pulse: 0,
    align: 0,
  };
}

export const SignalsContext = createContext<HoloSignals>(createSignals());

export const useSignals = () => useContext(SignalsContext);

/** Frame-rate independent exponential approach toward `target` with time constant `tau` (s). */
export function approach(current: number, target: number, delta: number, tau: number) {
  return current + (target - current) * (1 - Math.exp(-delta / tau));
}
