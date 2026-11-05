import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWeather, type Weather } from "../lib/feeds";
import { useStoredState } from "../lib/storage";

const WEATHER_KEY = "jarvis.weather";
/** Open-Meteo's models update hourly; the widget asks twice as often. */
const REFRESH_MS = 30 * 60_000;
const MAX_CITY = 80;

const parsePrefs = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as { city?: unknown }).city === "string" ? { city: (raw as { city: string }).city.slice(0, MAX_CITY) } : null);

/**
 * The weather in the user's city (the Clima widget, JARVIS's forecasts). The city is kept in
 * localStorage; the forecast refreshes every half hour with the widget open.
 */
export function useWeather({ active }: { active: boolean }) {
  const [prefs, setPrefs] = useStoredState(WEATHER_KEY, { city: "" }, parsePrefs, 0);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const city = useRef(prefs.city);
  city.current = prefs.city;

  /**
   * The forecast for `place` (the user's city by default). The user's own city is shown in the
   * widget; with none set yet, the first city asked for becomes it.
   */
  const forecast = useCallback(
    async (place?: string): Promise<Weather> => {
      const wanted = (place ?? city.current).trim().slice(0, MAX_CITY);
      if (!wanted) throw new Error("Nenhuma cidade no widget Clima");
      const own = !city.current || wanted.toLowerCase() === city.current.toLowerCase();
      if (own) setLoading(true);
      try {
        const found = await fetchWeather(wanted);
        if (own) {
          setWeather(found);
          setError(null);
          if (!city.current) setPrefs({ city: wanted });
        }
        return found;
      } catch (failure) {
        if (own) setError(String(failure instanceof Error ? failure.message : failure));
        throw failure;
      } finally {
        if (own) setLoading(false);
      }
    },
    [setPrefs],
  );

  /** The widget's city ("Curitiba"); the open widget then asks for its forecast. */
  const setCity = useCallback(
    (next: string) => {
      const clean = next.trim().slice(0, MAX_CITY);
      city.current = clean;
      setPrefs({ city: clean });
      setWeather(null);
    },
    [setPrefs],
  );

  useEffect(() => {
    if (!active || !prefs.city) return;
    let last = 0;
    // Hidden, the forecast waits; back on screen, a stale one is fetched at once.
    const tick = () => {
      if (document.hidden) return;
      last = Date.now();
      void forecast().catch(() => undefined);
    };
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= REFRESH_MS) tick();
    };
    tick();
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, prefs.city, forecast]);

  return { city: prefs.city, weather, error, loading, forecast, setCity };
}

export type WeatherFeed = ReturnType<typeof useWeather>;
