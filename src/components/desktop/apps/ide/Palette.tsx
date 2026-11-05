import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fuzzyFilter, type FuzzyMatch } from "../../../../lib/fuzzy";
import { joinPath, relativePath } from "../../../../lib/paths";
import { buildCommands } from "./commands";
import { useIde, useStore } from "./context";
import { PICKER } from "./languages";
import { outlineOf } from "./outline";
import type { PaletteMode } from "./types";

interface Entry {
  key: string;
  label: string;
  detail?: string;
  match?: FuzzyMatch;
  run: () => void;
}

const LIMIT = 60;

const PREFIXES: [string, PaletteMode][] = [
  [">", "commands"],
  [":", "line"],
  ["@", "symbols"],
];

const TITLES: Record<PaletteMode, string> = {
  files: "Abrir arquivo",
  commands: "Comandos",
  line: "Ir para linha",
  symbols: "Ir para símbolo",
  language: "Linguagem do arquivo",
};

const HINTS: Record<PaletteMode, string> = {
  files: "nome do arquivo · nome:linha · > comandos · : linha · @ símbolo",
  commands: "o que fazer",
  line: "número da linha (e :coluna)",
  symbols: "nome da função, classe…",
  language: "Python, Rust, Texto…",
};

/** Ctrl+P and friends: one box at the top of the IDE, the mode picked by the first character. */
export function Palette() {
  const store = useStore();
  const state = useIde();
  const palette = state.palette!;
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [query, setQuery] = useState(() => (palette.mode === "commands" ? ">" : palette.mode === "line" ? ":" : palette.mode === "symbols" ? "@" : "") + palette.query);
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<string[] | null>(null);

  const prefix = PREFIXES.find(([char]) => query.startsWith(char));
  const mode: PaletteMode = palette.mode === "language" ? "language" : (prefix?.[1] ?? "files");
  const text = prefix && palette.mode !== "language" ? query.slice(1).trim() : query.trim();

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (mode !== "files" || files) return;
    let alive = true;
    void store.projectFiles().then((list) => alive && setFiles(list.files));
    return () => {
      alive = false;
    };
  }, [mode, files, store]);

  /** Back to where the keyboard was (or the IDE itself); `refocus` false when the choice moves it. */
  const close = (refocus = true) => {
    store.closePalette();
    if (refocus) (previous.current?.isConnected && previous.current !== document.body ? previous.current : store.container)?.focus();
  };

  const entries = useMemo<Entry[]>(() => {
    if (mode === "commands") {
      const commands = [...buildCommands(store, state).values()].filter((command) => command.enabled !== false);
      return fuzzyFilter(text, commands, (command) => command.title, LIMIT).map(({ item, match }) => ({
        key: item.id,
        label: item.title,
        detail: item.keys,
        match,
        run: () => {
          // Commands that move the keyboard do it after this (panels focus on the next tick).
          close();
          item.run();
        },
      }));
    }
    if (mode === "language") {
      const options = [{ name: "Texto", value: null as string | null }, ...PICKER.map((description) => ({ name: description.name, value: description.name }))];
      return fuzzyFilter(text, options, (option) => option.name, LIMIT).map(({ item, match }) => ({
        key: item.name,
        label: item.name,
        match,
        run: () => {
          store.setLanguage(state.active, item.value);
          close();
        },
      }));
    }
    if (mode === "line") {
      const [line, column] = text.split(/[:,]/).map((part) => Number.parseInt(part, 10));
      const total = store.activeState()?.doc.lines ?? 0;
      return [
        {
          key: "line",
          label: Number.isFinite(line) ? `Ir para a linha ${line}${Number.isFinite(column) ? `, coluna ${column}` : ""}` : `Digite um número entre 1 e ${total}`,
          run: () => {
            if (!Number.isFinite(line)) return;
            close();
            store.goTo(line, Number.isFinite(column) ? column - 1 : 0);
          },
        },
      ];
    }
    if (mode === "symbols") {
      const editor = store.activeState();
      const meta = store.buffer(state.active);
      const symbols = editor && meta ? outlineOf(editor, meta.highlight) : [];
      return fuzzyFilter(text, symbols, (symbol) => symbol.name, LIMIT).map(({ item, match }) => ({
        key: `${item.line}:${item.from}`,
        label: `${item.kind} ${item.name}`,
        detail: `:${item.line}`,
        match: { ...match, positions: match.positions.map((position) => position + 2) },
        run: () => {
          close(false);
          const at = editor!.doc.line(item.line);
          store.goTo(item.line, item.from - at.from);
          store.focusEditor();
        },
      }));
    }
    // Files: "name:12" opens at line 12; with no query, the recent files come first.
    const root = state.root;
    if (!root) return [];
    const [name, lineText] = text.split(/:(?=\d+$)/);
    const line = lineText ? Number.parseInt(lineText, 10) : undefined;
    const list = files ?? [];
    const recent = store
      .recentFiles()
      .map((path) => relativePath(root, path))
      .filter((rel): rel is string => rel !== null && list.includes(rel));
    const candidates = name ? list : [...recent, ...list.filter((rel) => !recent.includes(rel))];
    const ranked = name ? fuzzyFilter(name, candidates, (rel) => rel, LIMIT) : candidates.slice(0, LIMIT).map((item) => ({ item, match: undefined }));
    return ranked.map(({ item, match }) => ({
      key: item,
      label: item,
      detail: recent.includes(item) && !name ? "recente" : undefined,
      match,
      run: () => {
        close(false);
        void store.openFile(joinPath(root, item), { focus: true, line });
      },
    }));
  }, [mode, text, files, state, store]);

  useEffect(() => setIndex(0), [mode, text]);

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      return close();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      return setIndex((value) => (entries.length ? (value + step + entries.length) % entries.length : 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      entries[index]?.run();
    }
  };

  return (
    <div
      role="dialog"
      aria-label={TITLES[mode]}
      className="absolute top-6 left-1/2 z-[80] flex max-h-[70%] w-[min(640px,90%)] -translate-x-1/2 flex-col border border-hud-light/60 bg-hud-panel/95 text-[12px] shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && close(false)}
    >
      <div className="bg-hud-light/85 px-2 leading-[18px] font-semibold text-hud-void">{TITLES[mode]}</div>
      <input
        ref={input}
        role="combobox"
        aria-expanded
        aria-controls="ide-palette-list"
        aria-activedescendant={entries[index] ? `ide-palette-${index}` : undefined}
        aria-label={TITLES[mode]}
        value={query}
        placeholder={HINTS[mode]}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        className="border-b border-hud-cyan/25 bg-transparent px-2 py-1 text-hud-text outline-none placeholder:text-hud-text/35"
      />
      <div id="ide-palette-list" role="listbox" aria-label="Resultados" className="min-h-0 overflow-auto py-0.5 [scrollbar-width:thin]">
        {mode === "files" && !files && <div className="px-2 text-hud-text/45">lendo os arquivos…</div>}
        {entries.map((entry, entryIndex) => (
          <div
            key={entry.key}
            id={`ide-palette-${entryIndex}`}
            role="option"
            aria-selected={entryIndex === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => entry.run()}
            onMouseMove={() => setIndex(entryIndex)}
            className={`flex cursor-pointer gap-2 px-2 leading-[18px] ${entryIndex === index ? "bg-hud-light/85 text-hud-void" : "text-hud-text"}`}
          >
            <span className="min-w-0 flex-1 truncate">{mark(entry.label, entry.match, entryIndex === index)}</span>
            {entry.detail && <span className="shrink-0 opacity-60">{entry.detail}</span>}
          </div>
        ))}
        {!entries.length && (mode !== "files" || files) && <div className="px-2 text-hud-text/45">nada encontrado</div>}
      </div>
    </div>
  );
}

function mark(text: string, match: FuzzyMatch | undefined, inverted: boolean): ReactNode {
  if (!match?.positions.length) return text;
  const set = new Set(match.positions);
  return [...text].map((char, index) =>
    set.has(index) ? (
      <span key={index} className={inverted ? "underline" : "text-hud-light"}>
        {char}
      </span>
    ) : (
      char
    ),
  );
}
