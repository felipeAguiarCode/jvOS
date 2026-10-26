import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { baseName } from "../../../../lib/paths";
import { useCursor, useDocTick, useIde, useStore } from "./context";
import { outlineOf, symbolAt, type OutlineSymbol } from "./outline";
import { PanelFrame, usePanelFocus } from "./PanelFrame";

/** Re-reading the symbols waits for a pause in typing. */
const OUTLINE_DELAY = 200;
const TYPEAHEAD_MS = 600;

const KIND_COLOR: Record<string, string> = {
  f: "text-hud-cyan",
  m: "text-hud-cyan",
  c: "text-hud-light",
  i: "text-hud-light",
  t: "text-hud-light",
  n: "text-hud-amber",
  h: "text-hud-light",
  v: "text-hud-text/60",
  k: "text-hud-text/60",
};

/** termide's outline: "f reorder_rows :9", the symbol under the cursor lit; Enter or a click jumps there. */
export function OutlinePanel({ id }: { id: string }) {
  const store = useStore();
  const { active, layout, buffers } = useIde();
  const tick = useDocTick();
  const { line } = useCursor();
  const list = useRef<HTMLDivElement>(null);
  const [symbols, setSymbols] = useState<OutlineSymbol[]>([]);
  const [cursor, setCursor] = useState(0);
  const typed = useRef({ text: "", at: 0 });
  const meta = buffers.find((buffer) => buffer.id === active) ?? null;
  const focused = layout.focus === id;
  usePanelFocus(id, () => list.current?.focus());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const state = store.activeState();
      setSymbols(state && meta?.view === "text" ? outlineOf(state, meta.highlight) : []);
    }, OUTLINE_DELAY);
    return () => window.clearTimeout(timer);
  }, [store, tick, active, meta?.view, meta?.highlight]);

  const current = useMemo(() => symbolAt(symbols, line), [symbols, line]);
  const currentIndex = current ? symbols.indexOf(current) : -1;

  // Following the editor while the outline itself is not being browsed.
  useEffect(() => {
    if (!focused && currentIndex >= 0) setCursor(currentIndex);
  }, [currentIndex, focused]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const jump = (symbol: OutlineSymbol, focusEditor: boolean) => {
    const state = store.activeState();
    if (!state) return;
    const at = state.doc.line(symbol.line);
    store.goTo(symbol.line, Math.max(0, symbol.from - at.from));
    if (focusEditor) store.focusEditor();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10, Home: -Infinity, End: Infinity };
    if (event.key in moves) {
      event.preventDefault();
      return setCursor((value) => Math.max(0, Math.min(symbols.length - 1, value + moves[event.key])));
    }
    const symbol = symbols[cursor];
    if ((event.key === "Enter" || event.key === " ") && symbol) {
      event.preventDefault();
      return jump(symbol, event.key === "Enter");
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const now = performance.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + event.key.toLowerCase();
      typed.current = { text, at: now };
      const order = [...symbols.slice(cursor + 1), ...symbols.slice(0, cursor + 1)];
      const hit = order.find((item) => item.name.toLowerCase().startsWith(text));
      if (hit) setCursor(symbols.indexOf(hit));
      event.preventDefault();
    }
  };

  const title = meta ? `Outline ${meta.path ? baseName(meta.path) : meta.title}` : "Outline";

  return (
    <PanelFrame id={id} label="Outline" title={title}>
      <div
        ref={list}
        role="listbox"
        aria-label="Símbolos do arquivo"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="ide-outline"
        className="absolute inset-0 overflow-auto py-px text-[12px] leading-[18px] outline-none [scrollbar-width:thin]"
      >
        {!symbols.length && <div className="px-2 text-hud-text/45">{meta?.view === "text" ? "nenhum símbolo" : "abra um arquivo"}</div>}
        {symbols.map((symbol, index) => {
          // The last of its siblings gets "└".
          const next = symbols.slice(index + 1).find((other) => other.depth <= symbol.depth);
          const last = !next || next.depth < symbol.depth;
          const lit = index === currentIndex;
          const selected = index === cursor && focused;
          return (
            <div
              key={`${symbol.line}:${symbol.from}:${symbol.name}`}
              role="option"
              aria-selected={selected}
              aria-label={`${symbol.name} linha ${symbol.line}`}
              data-index={index}
              data-current={lit || undefined}
              onClick={() => {
                setCursor(index);
                jump(symbol, true);
              }}
              className={`flex cursor-pointer items-center gap-1 pr-2 pl-1 whitespace-pre ${selected ? "bg-hud-light/85 text-hud-void" : lit ? "bg-hud-light/15" : "hover:bg-hud-light/10"}`}
            >
              <span className={selected ? "" : "text-hud-text/35"}>{"  ".repeat(symbol.depth)}{last ? "└ " : "├ "}</span>
              <span className={selected ? "" : KIND_COLOR[symbol.kind]}>{symbol.kind}</span>
              <span className="min-w-0 flex-1 truncate">{symbol.name}</span>
              <span className={selected ? "" : "text-hud-text/45"}>:{symbol.line}</span>
            </div>
          );
        })}
      </div>
    </PanelFrame>
  );
}
