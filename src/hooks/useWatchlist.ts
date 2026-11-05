import { useCallback, useEffect, useRef, useState } from "react";
import { fetchQuotes, MAX_WATCHED, normalizeSymbol, type Quote } from "../lib/feeds";
import { useStoredState } from "../lib/storage";

/** "Me avisa se a PETR4 passar de 60": goes off once, then is gone. */
export interface PriceAlert {
  id: number;
  symbol: string;
  above: number | null;
  below: number | null;
}

interface WatchState {
  symbols: string[];
  alerts: PriceAlert[];
}

const WATCH_KEY = "jarvis.watchlist";
const MAX_ALERTS = 50;
/** With the widget open. */
const ACTIVE_MS = 60_000;
/** Closed, only to check the alerts. */
const ALERTS_MS = 120_000;

function parseWatch(raw: unknown): WatchState | null {
  if (!raw || typeof raw !== "object") return null;
  const { symbols, alerts } = raw as Partial<WatchState>;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    symbols: Array.isArray(symbols) ? symbols.flatMap((symbol) => (typeof symbol === "string" && normalizeSymbol(symbol) ? [normalizeSymbol(symbol)!] : [])).slice(0, MAX_WATCHED) : [],
    alerts: Array.isArray(alerts)
      ? alerts
          .filter((alert): alert is PriceAlert => !!alert && typeof alert.id === "number" && typeof alert.symbol === "string")
          .map((alert) => ({ id: alert.id, symbol: alert.symbol, above: number(alert.above), below: number(alert.below) }))
          .filter((alert) => alert.above !== null || alert.below !== null)
          .slice(0, MAX_ALERTS)
      : [],
  };
}

/** The alert `quote` sets off, if any. */
export const crossed = (alert: PriceAlert, quote: Quote) =>
  !quote.error && ((alert.above !== null && quote.price >= alert.above) || (alert.below !== null && quote.price <= alert.below));

/**
 * The stocks and FIIs the user follows (the Ações widget) and their price alerts, kept in
 * localStorage. Quotes refresh every minute with the widget open; closed, only while an alert waits.
 */
export function useWatchlist({ active, onAlert }: { active: boolean; onAlert: (alert: PriceAlert, quote: Quote) => void }) {
  const [state, setState] = useStoredState<WatchState>(WATCH_KEY, { symbols: [], alerts: [] }, parseWatch, 0);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [updated, setUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ state, onAlert });
  latest.current = { state, onAlert };

  /** Fresh quotes for `symbols` (all the watched ones by default); alerts are checked on the way. */
  const refresh = useCallback(
    async (symbols?: string[]): Promise<Quote[]> => {
      const wanted = symbols ?? latest.current.state.symbols;
      if (!wanted.length) return [];
      try {
        const found = await fetchQuotes(wanted);
        setQuotes((current) => ({ ...current, ...Object.fromEntries(found.map((quote) => [quote.symbol, quote])) }));
        setUpdated(Date.now());
        setError(null);
        const due = latest.current.state.alerts.flatMap((alert) => {
          const quote = found.find((item) => item.symbol === alert.symbol);
          return quote && crossed(alert, quote) ? [{ alert, quote }] : [];
        });
        if (due.length) {
          setState((current) => ({ ...current, alerts: current.alerts.filter((alert) => !due.some((item) => item.alert.id === alert.id)) }));
          due.forEach(({ alert, quote }) => latest.current.onAlert(alert, quote));
        }
        return found;
      } catch (failure) {
        setError(String(failure instanceof Error ? failure.message : failure));
        throw failure;
      }
    },
    [setState],
  );

  const watched = state.symbols.join(" ");
  const waiting = state.alerts.length > 0;
  useEffect(() => {
    if (!watched || (!active && !waiting)) return;
    const symbols = watched.split(" ");
    let last = 0;
    const tick = () => {
      // Hidden, nobody looks at the open widget: only the alerts keep their slower pace.
      if (document.hidden && Date.now() - last < ALERTS_MS - 1000) return;
      last = Date.now();
      void refresh(symbols).catch(() => undefined);
    };
    // Back on screen, stale quotes are fetched at once instead of at the next tick.
    const onVisible = () => {
      if (active && !document.hidden && Date.now() - last >= ACTIVE_MS) tick();
    };
    if (active) tick();
    const timer = window.setInterval(tick, active ? ACTIVE_MS : ALERTS_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watched, active, waiting, refresh]);

  /** Follows `symbol`; returns it normalized ("PETR4"), or null when it is not a ticker or the list is full. */
  const watch = useCallback(
    (symbol: string) => {
      const clean = normalizeSymbol(symbol);
      if (!clean) return null;
      const { symbols } = latest.current.state;
      if (!symbols.includes(clean) && symbols.length >= MAX_WATCHED) return null;
      setState((current) => (current.symbols.includes(clean) ? current : { ...current, symbols: [...current.symbols, clean] }));
      return clean;
    },
    [setState],
  );

  const unwatch = useCallback(
    (symbol: string) => {
      const clean = normalizeSymbol(symbol);
      setState((current) => ({ symbols: current.symbols.filter((item) => item !== clean), alerts: current.alerts.filter((alert) => alert.symbol !== clean) }));
    },
    [setState],
  );

  /** An alert above and/or below a price (the symbol is watched too); null when it cannot be set. */
  const addAlert = useCallback(
    (symbol: string, above: number | null, below: number | null): PriceAlert | null => {
      const clean = watch(symbol);
      const valid = (value: number | null) => value === null || (Number.isFinite(value) && value > 0);
      if (!clean || (above === null && below === null) || !valid(above) || !valid(below) || latest.current.state.alerts.length >= MAX_ALERTS) return null;
      const alert = { id: Date.now() + Math.random(), symbol: clean, above, below };
      setState((current) => ({ ...current, alerts: [...current.alerts, alert] }));
      // A refresh right after (is the price already past it?) must see it before React renders.
      latest.current = { ...latest.current, state: { ...latest.current.state, alerts: [...latest.current.state.alerts, alert] } };
      return alert;
    },
    [watch, setState],
  );

  const removeAlerts = useCallback(
    (symbol: string) => {
      const clean = normalizeSymbol(symbol);
      setState((current) => ({ ...current, alerts: current.alerts.filter((alert) => alert.symbol !== clean) }));
    },
    [setState],
  );

  return { symbols: state.symbols, alerts: state.alerts, quotes, updated, error, refresh, watch, unwatch, addAlert, removeAlerts };
}

export type Watchlist = ReturnType<typeof useWatchlist>;
