import { useEffect, useState } from "react";
import { useWidgetOptions } from "../../../hooks/useWidgetOptions";
import { KeyValue } from "./tui";
import { toggleItems, useWidgetMenu, WidgetMenu } from "./WidgetMenu";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const SECONDS = new Intl.DateTimeFormat("pt-BR", { second: "2-digit" });
const DATE = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");

const OPTIONS = { seconds: true, date: true, zone: true };

/** Wall clock, drawn like a terminal: the time big, then neofetch-style lines. Ticks on the second. */
export function Clock({ paused }: { paused: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [options, toggle] = useWidgetOptions("clock", OPTIONS);
  const menu = useWidgetMenu();

  useEffect(() => {
    if (paused) return;
    let timer = 0;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      timer = window.setTimeout(tick, 1000 - (time % 1000));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [paused]);

  const date = new Date(now);
  return (
    <div tabIndex={0} onContextMenu={menu.open} className="flex h-full flex-col justify-center gap-2 px-4 pb-1 outline-none select-text">
      <div className="font-mono text-[clamp(28px,17cqw,84px)] leading-none tabular-nums text-hud-light">
        {TIME.format(date)}
        {options.seconds && <span className="text-hud-text/45">:{SECONDS.format(date).padStart(2, "0")}</span>}
      </div>
      {(options.date || options.zone) && (
        <div>
          {options.date && <KeyValue name="data">{DATE.format(date)}</KeyValue>}
          {options.zone && <KeyValue name="fuso">{ZONE}</KeyValue>}
        </div>
      )}
      <WidgetMenu
        menu={menu}
        label="Opções do widget Relógio"
        sections={[{ title: "Exibir", items: toggleItems(options, toggle, [["seconds", "Segundos"], ["date", "Data"], ["zone", "Fuso horário"]]) }]}
      />
    </div>
  );
}
