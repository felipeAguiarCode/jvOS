import { useEffect, useState } from "react";

/** The current time, updated on each new minute (not every second); paused, it stops. */
export function useMinuteClock(paused: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (paused) return;
    let timer = 0;
    const tick = () => {
      const date = new Date();
      setNow(date);
      timer = window.setTimeout(tick, 60_000 - (date.getTime() % 60_000) + 50);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [paused]);
  return now;
}
