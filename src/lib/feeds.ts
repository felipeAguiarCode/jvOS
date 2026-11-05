import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LucideIcon } from "lucide-react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun } from "lucide-react";

/** Mirrors `Quote` in src-tauri/src/feeds.rs. */
export interface Quote {
  /** As the user knows it ("PETR4"). */
  symbol: string;
  name: string;
  price: number;
  /** Since the previous close, as a fraction. */
  change: number;
  currency: string;
  /** Seconds since the epoch. */
  time: number;
  /** Today's prices, oldest first. */
  points: number[];
  error: string | null;
}

/** Mirrors `Weather` in src-tauri/src/feeds.rs. */
export interface Weather {
  place: string;
  current: { temperature: number; apparent: number; humidity: number; code: number; wind: number; day: boolean };
  /** Today first ("AAAA-MM-DD"). */
  days: { date: string; code: number; max: number; min: number; rain: number }[];
}

declare global {
  interface Window {
    /** Development-only stand-ins for the Playwright checks (the browser has no Rust side). */
    __JARVIS_QUOTES__?: Record<string, Omit<Quote, "symbol" | "error">>;
    __JARVIS_WEATHER__?: Weather;
  }
}

export const MAX_WATCHED = 20;
const UNAVAILABLE = "Disponível no app desktop";

/** "petr4", "PETR4.SA" → "PETR4"; null when it cannot be a ticker. */
export function normalizeSymbol(symbol: string) {
  const clean = symbol.trim().toUpperCase().replace(/\.SA$/, "");
  return /^[A-Z0-9^.=-]{1,16}$/.test(clean) ? clean : null;
}

/** Today's quotes, in order (Yahoo Finance, through Rust). */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const fake = import.meta.env.DEV ? window.__JARVIS_QUOTES__ : undefined;
  if (fake) return symbols.map((symbol) => (fake[symbol] ? { ...fake[symbol], symbol, error: null } : { symbol, name: "", price: 0, change: 0, currency: "", time: 0, points: [], error: `${symbol}: não encontrado` }));
  if (!isTauri()) throw new Error(UNAVAILABLE);
  return invoke<Quote[]>("stock_quotes", { symbols });
}

/** The weather now and the next days in `city` (Open-Meteo, through Rust). */
export async function fetchWeather(city: string): Promise<Weather> {
  const fake = import.meta.env.DEV ? window.__JARVIS_WEATHER__ : undefined;
  if (fake) return { ...fake, place: city.trim() ? `${city.trim().charAt(0).toUpperCase()}${city.trim().slice(1)}` : fake.place };
  if (!isTauri()) throw new Error(UNAVAILABLE);
  return invoke<Weather>("weather_forecast", { city });
}

/** WMO weather codes in words ("chuva fraca") and as an icon. */
export function describeWeather(code: number, day = true): { text: string; icon: LucideIcon } {
  if (code === 0) return { text: "céu limpo", icon: day ? Sun : Moon };
  if (code === 1) return { text: "predominantemente limpo", icon: day ? Sun : Moon };
  if (code === 2) return { text: "parcialmente nublado", icon: day ? CloudSun : CloudMoon };
  if (code === 3) return { text: "nublado", icon: Cloud };
  if (code === 45 || code === 48) return { text: "neblina", icon: CloudFog };
  if (code >= 51 && code <= 57) return { text: code === 51 ? "garoa fraca" : code === 55 ? "garoa forte" : "garoa", icon: CloudDrizzle };
  if (code >= 61 && code <= 67) return { text: code === 61 ? "chuva fraca" : code === 65 ? "chuva forte" : "chuva", icon: CloudRain };
  if (code >= 71 && code <= 77) return { text: "neve", icon: CloudSnow };
  if (code >= 80 && code <= 82) return { text: code === 82 ? "pancadas de chuva fortes" : "pancadas de chuva", icon: CloudRain };
  if (code === 85 || code === 86) return { text: "pancadas de neve", icon: CloudSnow };
  if (code >= 95) return { text: code === 95 ? "trovoadas" : "trovoadas com granizo", icon: CloudLightning };
  return { text: "tempo indefinido", icon: Cloud };
}

const CURRENCY_WORD: Record<string, [string, string]> = { BRL: ["real", "reais"], USD: ["dólar", "dólares"], EUR: ["euro", "euros"] };

/** "R$ 53,88", "US$ 1.234,50". */
export function formatPrice(value: number, currency: string) {
  const symbol = currency === "BRL" ? "R$" : currency === "USD" ? "US$" : currency === "EUR" ? "€" : currency;
  return `${symbol} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

/** "+1,52%", "−8,18%". */
export const formatChange = (change: number) => `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** "53 reais e 88", as the voice reads it. */
export function spokenPrice(value: number, currency: string) {
  const [one, many] = CURRENCY_WORD[currency] ?? ["", ""];
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100);
  const unit = one ? ` ${whole === 1 ? one : many}` : "";
  return cents ? `${whole.toLocaleString("pt-BR")}${unit} e ${cents}` : `${whole.toLocaleString("pt-BR")}${unit}`;
}

/** "alta de 1,5 por cento", "queda de 8,2 por cento", "estável". */
export function spokenChange(change: number) {
  const percent = Math.abs(change * 100);
  if (percent < 0.05) return "estável no dia";
  return `${change > 0 ? "alta" : "queda"} de ${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por cento`;
}

/** The quotes as data for JARVIS (the `stocks_quote` tool). */
export function quotesReport(quotes: Quote[]) {
  return quotes
    .map((quote) =>
      quote.error
        ? `${quote.symbol}: erro (${quote.error})`
        : `${quote.symbol} (${quote.name}): ${formatPrice(quote.price, quote.currency)}, ${formatChange(quote.change)} no dia, às ${new Date(quote.time * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    )
    .join("\n");
}

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });

/** "AAAA-MM-DD" at local midnight. */
export const localDay = (date: string) => new Date(`${date}T00:00:00`);

/** The forecast as data for JARVIS (the `weather` tool). */
export function weatherReport({ place, current, days }: Weather) {
  const lines = [
    `${place}, agora: ${Math.round(current.temperature)}°C (sensação ${Math.round(current.apparent)}°C), ${describeWeather(current.code, current.day).text}, umidade ${Math.round(current.humidity)}%, vento ${Math.round(current.wind)} km/h`,
  ];
  for (const day of days) {
    lines.push(`${WEEKDAY.format(localDay(day.date))} ${day.date}: ${describeWeather(day.code).text}, mínima ${Math.round(day.min)}°C, máxima ${Math.round(day.max)}°C, chuva ${Math.round(day.rain)}%`);
  }
  return lines.join("\n");
}
