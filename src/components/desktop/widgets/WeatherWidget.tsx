import { useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import type { WeatherFeed } from "../../../hooks/useWeather";
import { describeWeather, localDay } from "../../../lib/feeds";
import { ReverseRow } from "./tui";

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

/** The weather in the user's city now and the next days (Open-Meteo); "Jarvis, como está o tempo?" says it. */
export function WeatherWidget({ feed }: { feed: WeatherFeed }) {
  const { city, weather, error, loading } = feed;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(city);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    feed.setCity(draft);
    setEditing(false);
  };

  if (!city || editing) {
    return (
      <form onSubmit={save} className="flex h-full flex-col justify-center gap-2 px-4 font-mono text-[12px]">
        <label className="text-hud-text/60" htmlFor="weather-city">
          Sua cidade
        </label>
        <div className="flex items-center gap-2 border-b border-hud-cyan/25 pb-1">
          <span className="text-hud-cyan">$</span>
          <input
            id="weather-city"
            value={draft}
            autoFocus={editing}
            placeholder="Curitiba"
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-hud-text outline-none placeholder:text-hud-text/30"
          />
        </div>
        <p className="text-[11px] text-hud-text/45">Enter para consultar. O JARVIS usa essa cidade quando você pergunta do tempo.</p>
      </form>
    );
  }

  const now = weather && describeWeather(weather.current.code, weather.current.day);
  const Icon = now?.icon;
  return (
    <div className="flex h-full flex-col font-mono text-[12px] select-text">
      <ReverseRow
        left={weather?.place ?? city}
        right={
          <button
            type="button"
            aria-label="Trocar a cidade"
            onClick={() => {
              setDraft(city);
              setEditing(true);
            }}
            className="grid cursor-pointer place-items-center outline-none"
          >
            <Pencil size={11} strokeWidth={2} />
          </button>
        }
      />
      {weather && now && Icon ? (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-3">
            <Icon aria-hidden size={34} strokeWidth={1.3} className="shrink-0 text-hud-light" />
            <div>
              <div data-testid="weather-now" className="text-[clamp(26px,13cqw,52px)] leading-none tabular-nums text-hud-light">
                {Math.round(weather.current.temperature)}°
              </div>
              <div className="text-hud-text/80">{now.text}</div>
            </div>
            <dl className="ml-auto grid grid-cols-[auto_auto] gap-x-2 text-[11px] leading-snug">
              {[
                ["sensação", `${Math.round(weather.current.apparent)}°`],
                ["umidade", `${Math.round(weather.current.humidity)}%`],
                ["vento", `${Math.round(weather.current.wind)} km/h`],
              ].map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-right text-hud-cyan">{name}</dt>
                  <dd className="tabular-nums text-hud-text">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ol aria-label="Próximos dias" className="grid grid-cols-5 gap-1 text-center text-[11px]">
            {weather.days.map((day, index) => {
              const DayIcon = describeWeather(day.code).icon;
              return (
                <li key={day.date} title={describeWeather(day.code).text} className="flex flex-col items-center gap-0.5">
                  <span className="text-hud-text/60">{index === 0 ? "hoje" : WEEKDAY.format(localDay(day.date)).replace(".", "")}</span>
                  <DayIcon aria-hidden size={15} strokeWidth={1.5} className="text-hud-cyan" />
                  <span className="tabular-nums text-hud-light">{Math.round(day.max)}°</span>
                  <span className="tabular-nums text-hud-text/55">{Math.round(day.min)}°</span>
                  <span className={`tabular-nums ${day.rain >= 60 ? "text-hud-amber" : "text-hud-text/40"}`}>{Math.round(day.rain)}%</span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <p className={`flex-1 px-3 py-2 ${error ? "text-hud-alert/85" : "text-hud-text/55"}`}>{error ?? (loading ? "Consultando o tempo…" : "…")}</p>
      )}
    </div>
  );
}
