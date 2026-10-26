import type { KeyboardEvent } from "react";
import { CYCLES_PER_SET, PHASE_LABEL, usePomodoroRemaining, type Pomodoro as PomodoroTimer } from "../../../hooks/usePomodoro";
import { useWidgetOptions } from "../../../hooks/useWidgetOptions";
import { BlockBar, KeyHint, ReverseRow } from "./tui";
import { toggleItems, useWidgetMenu, WidgetMenu } from "./WidgetMenu";

const OPTIONS = { header: true, cycles: true, bar: true, hints: true };

/** mm:ss, rounding up so the display reaches 00:00 exactly when the phase ends. */
export function formatRemaining(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Focus / break timer as a little TUI: phase header, the countdown, a block progress bar and
 * key hints that work from the keyboard too. The timer itself lives in App, so it finishes
 * even when this window is closed.
 */
export function Pomodoro({ timer }: { timer: PomodoroTimer }) {
  const { phase, running, cycles, durations } = timer;
  const remaining = usePomodoroRemaining(timer);
  const total = durations[phase] * 60_000;
  const progress = total ? 1 - remaining / total : 0;
  const inSet = cycles % CYCLES_PER_SET;
  const phaseName = PHASE_LABEL[phase].toLowerCase();
  const [options, toggle] = useWidgetOptions("pomodoro", OPTIONS);
  const menu = useWidgetMenu();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const actions: Record<string, () => void> = {
      " ": running ? timer.pause : timer.start,
      r: timer.reset,
      s: timer.skip,
      "-": () => timer.adjust(phase, -5),
      "+": () => timer.adjust(phase, 5),
      "=": () => timer.adjust(phase, 5),
    };
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div tabIndex={0} onKeyDown={onKeyDown} onContextMenu={menu.open} className="flex h-full flex-col outline-none">
      {options.header && (
        <ReverseRow
          left={`${PHASE_LABEL[phase]}${running ? "" : " · pausado"}`}
          right={
            options.cycles && (
              <span aria-label={`${inSet} de ${CYCLES_PER_SET} ciclos`}>
                {"●".repeat(inSet)}
                {"○".repeat(CYCLES_PER_SET - inSet)}
              </span>
            )
          }
        />
      )}
      <div className="flex flex-1 flex-col justify-center gap-1.5 px-3">
        <div role="timer" aria-live="off" className={`font-mono text-[clamp(28px,19cqw,84px)] leading-none tabular-nums select-text ${running ? "text-hud-light" : "text-hud-text/75"}`}>
          {formatRemaining(remaining)}
        </div>
        {options.bar && <BlockBar value={progress} cells={18} label="Progresso da fase" />}
      </div>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 ${options.hints ? "" : "hidden"}`}>
        <KeyHint hotkey="espaço" label={running ? "Pausar" : "Iniciar"} action={running ? "pausar" : "iniciar"} onClick={running ? timer.pause : timer.start} />
        <KeyHint hotkey="r" label="Reiniciar" action="reiniciar" onClick={timer.reset} />
        <KeyHint hotkey="s" label="Pular" action="pular" onClick={timer.skip} />
        <span className="flex items-center gap-1">
          <KeyHint hotkey="-" label={`Menos tempo de ${phaseName}`} action="" onClick={() => timer.adjust(phase, -5)} />
          <span className="font-mono text-[11px] tabular-nums text-hud-text/70">{durations[phase]} min</span>
          <KeyHint hotkey="+" label={`Mais tempo de ${phaseName}`} action="" onClick={() => timer.adjust(phase, 5)} />
        </span>
      </div>
      <WidgetMenu
        menu={menu}
        label="Opções do widget Pomodoro"
        sections={[
          {
            title: "Exibir",
            items: toggleItems(options, toggle, [
              ["header", "Fase"],
              ["cycles", "Ciclos"],
              ["bar", "Barra de progresso"],
              ["hints", "Atalhos"],
            ]),
          },
        ]}
      />
    </div>
  );
}
