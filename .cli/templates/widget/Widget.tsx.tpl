%%#data%%
import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
%%/data%%
%%#menu%%
import { useWidgetOptions } from "../../../hooks/useWidgetOptions";
%%/menu%%
%%#data%%
import type { %%pascal%% } from "../../../hooks/use%%pascal%%";
import { MAX_%%CONST%%_TEXT } from "../../../lib/%%kind%%";
import { ReverseRow } from "./tui";
%%/data%%
%%^data%%
import { KeyValue, ReverseRow } from "./tui";
%%/data%%
%%#menu%%
import { toggleItems, useWidgetMenu, WidgetMenu } from "./WidgetMenu";

const OPTIONS = { details: true };
%%/menu%%
%%#data%%

const ROW_BUTTON = "grid size-4 shrink-0 cursor-pointer place-items-center text-hud-text/40 opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 hover:text-hud-alert";
%%/data%%

/** The %%title%% widget. What it shows and why: .specs/widgets/%%kind%%/spec.md. */
%%#data%%
export function %%component%%({ %%camel%% }: { %%camel%%: %%pascal%% }) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
%%#menu%%
  const [options, toggle] = useWidgetOptions("%%kind%%", OPTIONS);
  const menu = useWidgetMenu();
%%/menu%%

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const added = %%camel%%.add(draft);
    if (typeof added === "string") return setProblem(added);
    setDraft("");
    setProblem(null);
  };

  return (
    <div %%#menu%%tabIndex={0} onContextMenu={menu.open} %%/menu%%className="flex h-full flex-col font-mono text-[12px] outline-none select-text">
      <ReverseRow left="%%title%%" right={%%#menu%%options.details ? %%/menu%%`${%%camel%%.items.length} ${%%camel%%.items.length === 1 ? "item" : "itens"}`%%#menu%% : undefined%%/menu%%} />
      {%%camel%%.items.length ? (
        <ul aria-label="%%title%%" className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {%%camel%%.items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 py-0.5">
              <span className="w-[3ch] shrink-0 text-right tabular-nums text-hud-text/45">#{item.id}</span>
              <span className="min-w-0 flex-1 truncate text-hud-text">{item.text}</span>
              <button type="button" aria-label={`Apagar ${item.text}`} onClick={() => %%camel%%.remove(item.id)} className={ROW_BUTTON}>
                <X size={11} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex-1 px-3 py-2 leading-relaxed text-hud-text/55">Nada por aqui ainda. Digite abaixo.</p>
      )}
      {problem && <p className="px-2 text-[11px] text-hud-alert/85">{problem}</p>}
      <form onSubmit={add} className="flex items-center gap-2 border-t border-hud-cyan/10 px-2 py-1">
        <span className="text-hud-cyan">+</span>
        <input
          value={draft}
          aria-label="Novo item"
          placeholder="Novo item"
          maxLength={MAX_%%CONST%%_TEXT}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-hud-text outline-none placeholder:text-hud-text/30"
        />
      </form>
%%#menu%%
      <WidgetMenu menu={menu} label="Opções do widget %%title%%" sections={[{ title: "Exibir", items: toggleItems(options, toggle, [["details", "%%menuLabel%%"]]) }]} />
%%/menu%%
    </div>
  );
}
%%/data%%
%%^data%%
export function %%component%%({ paused }: { paused: boolean }) {
%%#menu%%
  const [options, toggle] = useWidgetOptions("%%kind%%", OPTIONS);
  const menu = useWidgetMenu();

%%/menu%%
  return (
    <div %%#menu%%tabIndex={0} onContextMenu={menu.open} %%/menu%%className="flex h-full flex-col font-mono text-[12px] outline-none select-text">
      <ReverseRow left="%%title%%" right={paused ? "pausado" : "ativo"} />
      <div className="flex flex-1 flex-col justify-center gap-1 px-4">
        <p className="text-hud-light">%%title%% em construção.</p>
%%#menu%%
        {options.details && <KeyValue name="spec">.specs/widgets/%%kind%%</KeyValue>}
%%/menu%%
%%^menu%%
        <KeyValue name="spec">.specs/widgets/%%kind%%</KeyValue>
%%/menu%%
      </div>
%%#menu%%
      <WidgetMenu menu={menu} label="Opções do widget %%title%%" sections={[{ title: "Exibir", items: toggleItems(options, toggle, [["details", "%%menuLabel%%"]]) }]} />
%%/menu%%
    </div>
  );
}
%%/data%%
