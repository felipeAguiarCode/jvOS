import { isPlugged, LOW_BATTERY as LOW_LEVEL, useBattery } from "../../../hooks/useBattery";
import { BlockBar, KeyValue } from "./tui";

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

/** Charge level of the machine's battery (Battery Status API), drawn like a terminal status. */
export function Battery() {
  const status = useBattery();

  if (status.kind !== "ready") {
    return (
      <div className="flex h-full items-center px-4 font-mono text-[12px] text-hud-text/55">
        <span className="mr-2 text-hud-cyan">$</span>
        {status.kind === "loading" ? "Lendo a bateria…" : "Indisponível neste ambiente"}
      </div>
    );
  }

  const percent = Math.round(status.level * 100);
  const plugged = isPlugged(status);
  const low = !status.charging && status.level <= LOW_LEVEL;
  const state = plugged ? "na tomada" : status.charging ? "carregando" : "na bateria";
  const time = plugged
    ? null
    : status.charging
      ? Number.isFinite(status.chargingTime) && status.chargingTime > 0
        ? `${formatDuration(status.chargingTime)} para 100%`
        : null
      : Number.isFinite(status.dischargingTime) && status.dischargingTime > 0
        ? `${formatDuration(status.dischargingTime)} restantes`
        : null;

  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-4 pb-1 select-text">
      <div className={`font-mono text-[clamp(26px,15cqw,72px)] leading-none tabular-nums ${low ? "text-hud-alert" : "text-hud-light"}`}>{percent}%</div>
      <BlockBar value={status.level} cells={18} tone={low ? "alert" : "normal"} label="Carga da bateria" />
      <div>
        <KeyValue name="estado">{low ? `${state} · baixa` : state}</KeyValue>
        {time && <KeyValue name="tempo">{time}</KeyValue>}
      </div>
    </div>
  );
}
