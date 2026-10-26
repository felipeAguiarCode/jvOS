import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useIde, useStore } from "./context";
import { PanelFrame, usePanelFocus } from "./PanelFrame";

/** Typing searches by itself after this pause (Enter searches at once). */
const SEARCH_DELAY = 300;
const MIN_LENGTH = 2;

/** Search across the project: options as TUI toggles, matches grouped by file; Enter opens one. */
export function SearchPanel({ id }: { id: string }) {
  const store = useStore();
  const { search, root, layout } = useIde();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(!!(search.options.include || search.options.exclude));
  const { options } = search;
  const focused = layout.focus === id;

  usePanelFocus(id, () => {
    input.current?.focus();
    input.current?.select();
  });

  // Searches again as the query or the options change.
  const key = JSON.stringify(options);
  const last = useRef(key);
  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    if (options.query.length < MIN_LENGTH) return;
    const timer = window.setTimeout(() => void store.runSearch(), SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [key, options.query.length, store]);

  const flat = search.results.flatMap((group, fileIndex) => group.matches.map((_, matchIndex) => [fileIndex, matchIndex] as const));
  const at = search.cursor ? flat.findIndex(([f, m]) => f === search.cursor![0] && m === search.cursor![1]) : -1;

  useEffect(() => {
    if (!search.cursor) return;
    list.current?.querySelector(`[data-match="${search.cursor[0]}:${search.cursor[1]}"]`)?.scrollIntoView({ block: "nearest" });
  }, [search.cursor]);

  const onInputKey = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      last.current = key;
      void store.runSearch();
    } else if (event.key === "ArrowDown" && flat.length) {
      event.preventDefault();
      list.current?.focus();
      if (at < 0) store.openMatch(flat[0][0], flat[0][1], false);
    } else if (event.key === "Escape" && search.running) {
      event.preventDefault();
      store.stopSearch();
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
    if (event.key in moves) {
      event.preventDefault();
      if (event.key === "ArrowUp" && at <= 0) return input.current?.focus();
      const next = flat[Math.max(0, Math.min(flat.length - 1, at + moves[event.key]))];
      if (next) store.openMatch(next[0], next[1], false);
    } else if ((event.key === "Enter" || event.key === " ") && at >= 0) {
      event.preventDefault();
      store.openMatch(flat[at][0], flat[at][1], event.key === "Enter");
    }
  };

  const summary = search.error
    ? search.error
    : search.running
      ? `buscando… ${search.total} resultados`
      : options.query.length >= MIN_LENGTH || search.results.length
        ? `${search.total} ${search.total === 1 ? "resultado" : "resultados"} em ${search.results.length} ${search.results.length === 1 ? "arquivo" : "arquivos"}${search.truncated ? " (limite)" : ""}`
        : "";

  return (
    <PanelFrame id={id} label="Busca" title="Busca no projeto">
      <div className="flex h-full flex-col text-[12px] leading-[18px]">
        <div className="flex shrink-0 items-center gap-1 px-1 pt-0.5">
          <span className="text-hud-cyan">/</span>
          <input
            ref={input}
            aria-label="Buscar no projeto"
            value={options.query}
            disabled={!root}
            placeholder={root ? "texto ou regex" : "abra uma pasta"}
            onChange={(event) => store.setSearchOptions({ query: event.target.value })}
            onKeyDown={onInputKey}
            spellCheck={false}
            className="min-w-0 flex-1 border-b border-hud-cyan/30 bg-transparent px-1 text-hud-text outline-none placeholder:text-hud-text/35 focus:border-hud-light/70"
          />
          <Toggle label="Diferenciar maiúsculas" text="Aa" on={options.caseSensitive} onClick={() => store.setSearchOptions({ caseSensitive: !options.caseSensitive })} />
          <Toggle label="Palavra inteira" text="ab" on={options.wholeWord} onClick={() => store.setSearchOptions({ wholeWord: !options.wholeWord })} />
          <Toggle label="Expressão regular" text=".*" on={options.regex} onClick={() => store.setSearchOptions({ regex: !options.regex })} />
          <Toggle label="Filtros de arquivos" text="⋯" on={showFilters} onClick={() => setShowFilters((value) => !value)} />
        </div>
        {showFilters && (
          <div className="flex shrink-0 flex-col gap-0.5 px-1 pt-0.5">
            <Filter label="incluir" value={options.include} placeholder="*.py, src/**" onChange={(include) => store.setSearchOptions({ include })} />
            <Filter label="excluir" value={options.exclude} placeholder="tests/**" onChange={(exclude) => store.setSearchOptions({ exclude })} />
          </div>
        )}
        <div role="status" className={`flex shrink-0 items-center gap-2 px-1 ${search.error ? "text-hud-alert" : "text-hud-text/50"}`}>
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          {search.running && (
            <button type="button" onClick={() => store.stopSearch()} className="cursor-pointer text-hud-text outline-none hover:text-hud-light">
              [Parar]
            </button>
          )}
        </div>
        <div
          ref={list}
          role="listbox"
          aria-label="Resultados da busca"
          tabIndex={flat.length ? 0 : -1}
          onKeyDown={onListKey}
          className="min-h-0 flex-1 overflow-auto outline-none [scrollbar-width:thin]"
        >
          {search.results.map((group, fileIndex) => (
            <div key={group.path} role="group" aria-label={group.rel}>
              <div className="truncate px-1 text-hud-cyan">
                {group.rel} <span className="text-hud-text/45">({group.matches.length})</span>
              </div>
              {group.matches.map((match, matchIndex) => {
                const selected = search.cursor?.[0] === fileIndex && search.cursor?.[1] === matchIndex;
                return (
                  <div
                    key={`${match.line}:${match.column}`}
                    role="option"
                    aria-selected={selected}
                    data-match={`${fileIndex}:${matchIndex}`}
                    onClick={(event) => store.openMatch(fileIndex, matchIndex, event.detail >= 2)}
                    className={`flex cursor-pointer gap-1.5 pr-1 pl-3 whitespace-pre ${selected ? (focused ? "bg-hud-light/85 text-hud-void" : "bg-hud-light/20") : "hover:bg-hud-light/10"}`}
                  >
                    <span className={selected && focused ? "" : "text-hud-text/45"}>{String(match.line).padStart(4)}:</span>
                    <span className="min-w-0 truncate">{highlight(match.preview, match.previewColumn, match.length, selected && focused)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </PanelFrame>
  );
}

function highlight(text: string, column: number, length: number, inverted: boolean): ReactNode {
  if (column < 0 || column >= text.length) return text;
  return (
    <>
      {text.slice(0, column)}
      <mark className={inverted ? "bg-hud-void text-hud-light" : "bg-hud-light/30 text-hud-light"}>{text.slice(column, column + length)}</mark>
      {text.slice(column + length)}
    </>
  );
}

function Toggle({ label, text, on, onClick }: { label: string; text: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={`shrink-0 cursor-pointer px-0.5 outline-none focus-visible:underline ${on ? "bg-hud-light/85 text-hud-void" : "text-hud-text/55 hover:text-hud-light"}`}
    >
      [{text}]
    </button>
  );
}

function Filter({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-hud-text/55">
      <span className="w-[7ch] shrink-0">{label}:</span>
      <input
        aria-label={`Arquivos para ${label}`}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-w-0 flex-1 border-b border-hud-cyan/20 bg-transparent px-1 text-hud-text outline-none placeholder:text-hud-text/30 focus:border-hud-light/70"
      />
    </label>
  );
}
