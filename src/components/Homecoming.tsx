import { useEffect } from "react";

/** How long the lights take to come on (the `lights-on` animation, a little slack included). */
const LIGHTS_MS = 1500;

/**
 * "Acorda, querido, papai chegou": the workshop in the dark for a moment, then the lights
 * flickering on over everything while the core powers up behind them.
 */
export function Homecoming({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, LIGHTS_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return <div data-testid="homecoming" aria-hidden className="lights-on pointer-events-none fixed inset-0 z-[30] bg-black" />;
}
