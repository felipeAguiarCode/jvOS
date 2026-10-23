import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStoredState } from "../lib/storage";

export type PomodoroPhase = "focus" | "short" | "long";

/** Minutes per phase. */
export type PomodoroDurations = Record<PomodoroPhase, number>;

interface PomodoroState {
  version: 1;
  phase: PomodoroPhase;
  /** Wall-clock end of the running phase; null while paused. */
  endsAt: number | null;
  /** Time left (ms) while paused. */
  remaining: number;
  /** Focus phases completed; every fourth earns the long break. */
  cycles: number;
  durations: PomodoroDurations;
}

export const PHASE_LABEL: Record<PomodoroPhase, string> = { focus: "Foco", short: "Pausa curta", long: "Pausa longa" };
export const CYCLES_PER_SET = 4;
const MIN_MINUTES = 1;
const MAX_MINUTES = 90;
const PHASES: PomodoroPhase[] = ["focus", "short", "long"];
const DEFAULT_DURATIONS: PomodoroDurations = { focus: 25, short: 5, long: 15 };
const DEFAULT_STATE: PomodoroState = {
  version: 1,
  phase: "focus",
  endsAt: null,
  remaining: DEFAULT_DURATIONS.focus * 60_000,
  cycles: 0,
  durations: DEFAULT_DURATIONS,
};
/** A phase that ended this long ago (the app was closed) completes quietly, without the alarm. */
const STALE_MS = 2000;

const minutes = (value: number) => value * 60_000;
const isPhase = (value: unknown): value is PomodoroPhase => typeof value === "string" && (PHASES as string[]).includes(value);
const isMinutes = (value: unknown): value is number => typeof value === "number" && value >= MIN_MINUTES && value <= MAX_MINUTES;

function parsePomodoro(raw: unknown): PomodoroState | null {
  if (!raw || typeof raw !== "object") return null;
  const { phase, endsAt, remaining, cycles, durations } = raw as Record<string, unknown>;
  const d = (durations && typeof durations === "object" ? durations : {}) as Partial<Record<PomodoroPhase, unknown>>;
  const cleanDurations: PomodoroDurations = {
    focus: isMinutes(d.focus) ? d.focus : DEFAULT_DURATIONS.focus,
    short: isMinutes(d.short) ? d.short : DEFAULT_DURATIONS.short,
    long: isMinutes(d.long) ? d.long : DEFAULT_DURATIONS.long,
  };
  const cleanPhase = isPhase(phase) ? phase : "focus";
  return {
    version: 1,
    phase: cleanPhase,
    endsAt: typeof endsAt === "number" && Number.isFinite(endsAt) ? endsAt : null,
    remaining: typeof remaining === "number" && remaining >= 0 ? remaining : minutes(cleanDurations[cleanPhase]),
    cycles: typeof cycles === "number" && cycles >= 0 ? Math.floor(cycles) : 0,
    durations: cleanDurations,
  };
}

function nextPhase(phase: PomodoroPhase, cycles: number): PomodoroPhase {
  if (phase !== "focus") return "focus";
  return (cycles + 1) % CYCLES_PER_SET === 0 ? "long" : "short";
}

export interface Pomodoro {
  phase: PomodoroPhase;
  running: boolean;
  /** Wall-clock end of the running phase; null while paused. */
  endsAt: number | null;
  /** Milliseconds left as of the last change; `usePomodoroRemaining` gives the live value. */
  remaining: number;
  cycles: number;
  durations: PomodoroDurations;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  /** Changes a phase's length by whole minutes. */
  adjust: (phase: PomodoroPhase, deltaMinutes: number) => void;
}

/**
 * Pomodoro timer kept in localStorage (`jarvis.pomodoro`) and timed by the wall clock, so it
 * survives reloads and keeps counting while the window is hidden.
 */
export function usePomodoro(onFinish: (finished: PomodoroPhase, next: PomodoroPhase) => void): Pomodoro {
  const [state, setState] = useStoredState("jarvis.pomodoro", DEFAULT_STATE, parsePomodoro);
  const finish = useRef(onFinish);
  finish.current = onFinish;

  const running = state.endsAt !== null;

  // The phase ends on time even if the display interval was throttled.
  useEffect(() => {
    if (state.endsAt === null) return;
    const delay = state.endsAt - Date.now();
    const timer = window.setTimeout(
      () => {
        const next = nextPhase(state.phase, state.cycles);
        setState((current) => ({
          ...current,
          phase: next,
          endsAt: null,
          remaining: minutes(current.durations[next]),
          cycles: current.phase === "focus" ? current.cycles + 1 : current.cycles,
        }));
        if (delay > -STALE_MS) finish.current(state.phase, next);
      },
      Math.max(0, delay),
    );
    return () => window.clearTimeout(timer);
  }, [state.endsAt, state.phase, state.cycles, setState]);

  const start = useCallback(
    () => setState((current) => (current.endsAt === null ? { ...current, endsAt: Date.now() + current.remaining } : current)),
    [setState],
  );
  const pause = useCallback(
    () =>
      setState((current) =>
        current.endsAt === null ? current : { ...current, endsAt: null, remaining: Math.max(0, current.endsAt - Date.now()) },
      ),
    [setState],
  );
  const reset = useCallback(
    () => setState((current) => ({ ...current, endsAt: null, remaining: minutes(current.durations[current.phase]) })),
    [setState],
  );
  const skip = useCallback(
    () =>
      setState((current) => {
        const next = nextPhase(current.phase, current.cycles);
        return { ...current, phase: next, endsAt: null, remaining: minutes(current.durations[next]) };
      }),
    [setState],
  );
  const adjust = useCallback(
    (phase: PomodoroPhase, deltaMinutes: number) =>
      setState((current) => {
        const value = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, current.durations[phase] + deltaMinutes));
        const durations = { ...current.durations, [phase]: value };
        // A paused phase that has not started yet follows its new length.
        const untouched = current.endsAt === null && current.remaining === minutes(current.durations[current.phase]);
        const remaining = untouched && phase === current.phase ? minutes(value) : current.remaining;
        return { ...current, durations, remaining };
      }),
    [setState],
  );

  // No ticking here: the timer lives in App, and a clock there would re-render everything.
  return useMemo(
    () => ({
      phase: state.phase,
      running,
      endsAt: state.endsAt,
      remaining: state.endsAt === null ? state.remaining : Math.max(0, state.endsAt - Date.now()),
      cycles: state.cycles,
      durations: state.durations,
      start,
      pause,
      reset,
      skip,
      adjust,
    }),
    [state.phase, running, state.endsAt, state.remaining, state.cycles, state.durations, start, pause, reset, skip, adjust],
  );
}

/**
 * Time left, live: re-renders only the component that shows it, once a second (on the second)
 * while the timer runs, and at once when the window comes back into view.
 */
export function usePomodoroRemaining(timer: Pomodoro): number {
  const { endsAt, remaining } = timer;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    let timeout = 0;
    const tick = () => {
      window.clearTimeout(timeout);
      const time = Date.now();
      setNow(time);
      const left = endsAt - time;
      timeout = window.setTimeout(tick, left > 0 ? (left % 1000 || 1000) + 15 : 1000);
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [endsAt]);
  return endsAt === null ? remaining : Math.max(0, endsAt - now);
}
