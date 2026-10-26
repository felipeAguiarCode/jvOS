import { isPlugged, LOW_BATTERY as LOW_LEVEL, useBattery } from "../../../hooks/useBattery";
import { useWidgetOptions } from "../../../hooks/useWidgetOptions";
import { BlockBar, KeyValue } from "./tui";
import { toggleItems, useWidgetMenu, WidgetMenu } from "./WidgetMenu";

const OPTIONS = { percent: true, bar: true, state: true, time: true };

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

/** Charge level of the machine's battery (Battery Status API), drawn like a terminal status. */
export function Battery() {
  const status = useBattery();
  const [options, toggle] = useWidgetOptions("battery", OPTIONS);
  const menu = useWidgetMenu();
  const settings = (
    <WidgetMenu
      menu={menu}
      label="Opções do widget Bateria"
      sections={[
        {
          title: "Exibir",
          items: toggleItems(options, toggle, [
            ["percent", "Porcentagem"],
            ["bar", "Barra de carga"],
            ["state", "Estado"],
            ["time", "Tempo restante"],
          ]),
        },
      ]}
    />
  );

  if (status.kind !== "ready") {
    return (
      <div tabIndex={0} onContextMenu={menu.open} className="flex h-full items-center px-4 font-mono text-[12px] text-hud-text/55 outline-none">
        <span className="mr-2 text-hud-cyan">$</span>
        {status.kind === "loading" ? "Lendo a bateria…" : "Indisponível neste ambiente"}
        {settings}
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
    <div tabIndex={0} onContextMenu={menu.open} className="flex h-full flex-col justify-center gap-1.5 px-4 pb-1 outline-none select-text">
      {options.percent && (
        <div className={`font-mono text-[clamp(26px,15cqw,72px)] leading-none tabular-nums ${low ? "text-hud-alert" : "text-hud-light"}`}>{percent}%</div>
      )}
      {options.bar && <BlockBar value={status.level} cells={18} tone={low ? "alert" : "normal"} label="Carga da bateria" />}
      {(options.state || (options.time && time)) && (
        <div>
          {options.state && <KeyValue name="estado">{low ? `${state} · baixa` : state}</KeyValue>}
          {options.time && time && <KeyValue name="tempo">{time}</KeyValue>}
        </div>
      )}
      {!options.percent && !options.bar && !options.state && !options.time && (
        <div className="font-mono text-[12px] text-hud-text/55">Tudo oculto · botão direito para escolher</div>
      )}
      {settings}
    </div>
  );
}
