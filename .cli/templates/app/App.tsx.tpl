%%#data%%
import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { use%%pascal%% } from "../../../../hooks/use%%pascal%%";
import { MAX_%%CONST%%_TEXT } from "../../../../lib/%%kind%%";
%%/data%%
import { ReverseRow } from "../../widgets/tui";
%%#data%%

const ROW_BUTTON = "grid size-4 shrink-0 cursor-pointer place-items-center text-hud-text/40 opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 hover:text-hud-alert";
%%/data%%

/** The %%title%% app. What it does and why: .specs/apps/jv_%%kind%%/spec.md. */
export function %%component%%() {
%%#data%%
  const %%camel%% = use%%pascal%%();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const added = %%camel%%.add(draft);
    if (typeof added === "string") return setProblem(added);
    setDraft("");
    setProblem(null);
  };

%%/data%%
  return (
    <div data-testid="%%kind%%-app" className="flex h-full flex-col font-mono text-[12.5px] text-hud-text">
%%#data%%
      <ReverseRow left="jv_%%kind%%" right={`${%%camel%%.items.length} ${%%camel%%.items.length === 1 ? "item" : "itens"}`} />
      {%%camel%%.items.length ? (
        <ul aria-label="%%title%%" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {%%camel%%.items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 py-0.5">
              <span className="w-[3ch] shrink-0 text-right tabular-nums text-hud-text/45">#{item.id}</span>
              <span className="min-w-0 flex-1 truncate">{item.text}</span>
              <button type="button" aria-label={`Apagar ${item.text}`} onClick={() => %%camel%%.remove(item.id)} className={ROW_BUTTON}>
                <X size={11} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex-1 px-4 py-3 leading-relaxed text-hud-text/55">Nada por aqui ainda. Digite abaixo.</p>
      )}
      {problem && <p className="px-3 text-[11px] text-hud-alert/85">{problem}</p>}
      <form onSubmit={add} className="flex items-center gap-2 border-t border-hud-cyan/10 px-3 py-1.5">
        <span className="text-hud-cyan">+</span>
        <input
          value={draft}
          aria-label="Novo item"
          placeholder="Novo item"
          maxLength={MAX_%%CONST%%_TEXT}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-hud-text/30"
        />
      </form>
%%/data%%
%%^data%%
      <ReverseRow left="jv_%%kind%%" right="em desenvolvimento" />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-hud-light">%%title%%</p>
        <p className="max-w-[60ch] text-hud-text/60">%%desc%%</p>
      </div>
%%/data%%
    </div>
  );
}
