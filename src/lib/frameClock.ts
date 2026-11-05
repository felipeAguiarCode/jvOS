/**
 * The core's animation clock: one requestAnimationFrame loop that hands out frames at a capped
 * rate, so a 120/144 Hz screen does not double the cost of the hologram, and a window behind other
 * apps draws at half the rate. Nothing runs while the window is hidden (rate 0).
 */

/** Frames per second in front, and while another app has the focus. */
export const FOREGROUND_FPS = 60;
export const BACKGROUND_FPS = 30;

/** The rate for the window's state: 0 hidden (or covered), half behind other apps, full in front. */
export function frameRate(paused: boolean, focused: boolean) {
  return paused ? 0 : focused ? FOREGROUND_FPS : BACKGROUND_FPS;
}

/**
 * Calls `frame(now)` at most `fps` times per second, on animation frames (`now` in ms, as rAF).
 * Returns the stop function. A rate of 0 or less runs nothing.
 */
export function runFrames(fps: number, frame: (now: number) => void): () => void {
  if (!(fps > 0)) return () => undefined;
  const interval = 1000 / fps;
  // rAF timestamps jitter by a fraction of a millisecond: a 60 Hz screen must not drop to 30.
  const slack = Math.min(2, interval * 0.1);
  let next = -Infinity;
  let id = requestAnimationFrame(function tick(now) {
    id = requestAnimationFrame(tick);
    if (now < next - slack) return;
    // The deadlines keep a steady cadence; after a stall the clock starts over from now.
    next = now - next > interval ? now + interval : next + interval;
    frame(now);
  });
  return () => cancelAnimationFrame(id);
}
