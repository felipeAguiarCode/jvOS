import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Watchlist } from "../../../hooks/useWatchlist";
import { formatChange, formatPrice } from "../../../lib/feeds";
import { ReverseRow } from "./tui";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Today's prices as a little line. */
function Sparkline({ points, down }: { points: number[]; down: boolean }) {
  if (points.length < 2) return <span className="w-12 shrink-0" />;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const path = points.map((point, i) => `${((i / (points.length - 1)) * 48).toFixed(1)},${(13 - ((point - min) / span) * 12).toFixed(1)}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 48 14" className="h-3.5 w-12 shrink-0">
      <polyline points={path} fill="none" strokeWidth={1} className={down ? "stroke-hud-alert/80" : "stroke-hud-light/80"} />
    </svg>
  );
}

/**
 * The stocks and FIIs the user follows ("Jarvis, monitora a Petrobras"): price, the day's change
 * and line, and the price alerts waiting. Yahoo Finance, about 15 minutes late for the B3.
 */
export function Stocks({ watchlist }: { watchlist: Watchlist }) {
  const { symbols, quotes, alerts, updated, error } = watchlist;
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const symbol = watchlist.watch(draft);
    if (!symbol) return setProblem(symbols.length >= 20 ? "A lista está cheia (20)" : `Código inválido: ${draft.trim()}`);
    setDraft("");
    setProblem(null);
    void watchlist.refresh([symbol]).catch(() => undefined);
  };

  return (
    <div className="flex h-full flex-col font-mono text-[12px] outline-none select-text">
      <ReverseRow left="Ações e FIIs" right={error ? "sem conexão" : updated ? `às ${TIME.format(updated)}` : symbols.length ? "…" : undefined} />
      {symbols.length ? (
        <ul aria-label="Ações acompanhadas" className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {symbols.map((symbol) => {
            const quote = quotes[symbol];
            const waiting = alerts.filter((alert) => alert.symbol === symbol);
            const down = (quote?.change ?? 0) < 0;
            return (
              <li key={symbol} data-symbol={symbol} className="group py-0.5" title={quote?.name || undefined}>
                <div className="flex items-center gap-2">
                  <span className="w-[7ch] shrink-0 truncate text-hud-cyan">{symbol}</span>
                  <Sparkline points={quote?.points ?? []} down={down} />
                  <span className="ml-auto tabular-nums text-hud-light">
                    {!quote ? "…" : quote.error ? <span className="text-hud-alert/80">erro</span> : formatPrice(quote.price, quote.currency)}
                  </span>
                  <span className={`w-[8ch] shrink-0 text-right tabular-nums ${down ? "text-hud-alert" : "text-hud-text/80"}`}>{quote && !quote.error ? formatChange(quote.change) : ""}</span>
                  <button
                    type="button"
                    aria-label={`Parar de acompanhar ${symbol}`}
                    onClick={() => watchlist.unwatch(symbol)}
                    className="grid size-4 shrink-0 cursor-pointer place-items-center text-hud-text/40 opacity-0 outline-none group-hover:opacity-100 hover:text-hud-alert focus-visible:opacity-100"
                  >
                    <X size={11} strokeWidth={1.8} />
                  </button>
                </div>
                {waiting.map((alert) => (
                  <div key={alert.id} className="pl-[8ch] text-[10px] text-hud-amber/90">
                    ⚑ avisar {[alert.above !== null && `acima de ${formatPrice(alert.above, quote?.currency ?? "BRL")}`, alert.below !== null && `abaixo de ${formatPrice(alert.below, quote?.currency ?? "BRL")}`].filter(Boolean).join(" ou ")}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex-1 px-3 py-2 leading-relaxed text-hud-text/55">Nenhum código ainda. Diga “Jarvis, monitora a Petrobras” ou digite abaixo.</p>
      )}
      {(problem || error) && <p className="px-2 text-[11px] text-hud-alert/85">{problem ?? error}</p>}
      <form onSubmit={add} className="flex items-center gap-2 border-t border-hud-cyan/10 px-2 py-1">
        <span className="text-hud-cyan">+</span>
        <input
          value={draft}
          aria-label="Adicionar código"
          placeholder="PETR4, HGLG11…"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-hud-text uppercase outline-none placeholder:normal-case placeholder:text-hud-text/30"
        />
      </form>
    </div>
  );
}
