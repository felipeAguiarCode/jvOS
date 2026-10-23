import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { Search } from "lucide-react";
import { matchRange, searchCommands, type Command } from "../lib/search";

interface SpotlightProps {
  open: boolean;
  /** Changes on every opening: reopening during the closing animation mounts a fresh panel. */
  session: number;
  onClose: () => void;
  commands: Command[];
}

/** macOS-style search bar (`/`): finds widgets, apps, programs and every menu, and runs them. */
export function Spotlight({ open, session, onClose, commands }: SpotlightProps) {
  return <AnimatePresence>{open && <SpotlightPanel key={session} onClose={onClose} commands={commands} />}</AnimatePresence>;
}

function SpotlightPanel({ onClose, commands }: Omit<SpotlightProps, "open" | "session">) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // While fading out (a new search may already be open on top) it is gone for keyboard and screen readers.
  const present = useIsPresent();
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCommands(commands, query), [commands, query]);
  const searching = query.trim().length > 0;
  const selected = results[Math.min(active, results.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  // The field must not keep the focus while the panel fades out, or the next "/" lands in it.
  const close = () => {
    input.current?.blur();
    onClose();
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = (delta: number) => {
      event.preventDefault();
      if (results.length) setActive((current) => (current + delta + results.length) % results.length);
    };
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") {
      event.preventDefault();
      run(selected);
    } else if (event.key === "Escape") {
      // Only the search closes, not a panel open behind it.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <>
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        onPointerDown={close}
        className="fixed inset-0 z-50 bg-black/30"
      />
      <motion.div
        role="dialog"
        aria-label="Busca"
        aria-hidden={!present || undefined}
        inert={!present}
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="fixed top-[16vh] left-1/2 z-50 w-[640px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-hud-cyan/25 bg-hud-panel/88 text-hud-text shadow-[0_24px_70px_rgba(0,0,0,0.75),inset_0_0_30px_color-mix(in_oklab,var(--color-hud-cyan)_5%,transparent)] backdrop-blur-xl"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-12 top-0 h-px bg-linear-to-r from-transparent via-hud-light/45 to-transparent"
        />
        <div className="flex items-center gap-3 border-b border-hud-cyan/12 px-5">
          <Search size={20} strokeWidth={1.6} aria-hidden className="shrink-0 text-hud-light/80" />
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
            aria-label="Buscar no JARVIS"
            value={query}
            spellCheck={false}
            placeholder="Buscar widgets, apps, programas e menus…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-lg text-hud-light outline-none placeholder:text-hud-text/35"
          />
          <kbd className="rounded-md border border-hud-cyan/20 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] text-hud-text/50 uppercase">esc</kbd>
        </div>

        <div ref={list} id={listId} role="listbox" aria-label="Resultados" className="hud-scroll max-h-[min(52vh,460px)] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-hud-text/50">Nada encontrado para “{query.trim()}”.</p>}
          {results.map((command, index) => {
            const header = !searching && (index === 0 || results[index - 1].group !== command.group);
            const isActive = command === selected;
            return (
              <div key={command.id}>
                {header && (
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.28em] text-hud-cyan/75 uppercase first:pt-1">{command.group}</div>
                )}
                <div
                  id={`${listId}-${command.id}`}
                  role="option"
                  aria-selected={isActive}
                  onPointerMove={() => setActive(index)}
                  onClick={() => run(command)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                    isActive ? "bg-hud-cyan/[0.12] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-hud-cyan)_30%,transparent)]" : ""
                  }`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg border ${
                      isActive ? "border-hud-cyan/40 text-hud-light" : "border-hud-cyan/12 text-hud-text/60"
                    }`}
                  >
                    <command.icon size={16} strokeWidth={1.6} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${isActive ? "text-hud-light" : "text-hud-text"}`}>
                      <Highlighted text={command.title} query={query} />
                    </span>
                    {(command.subtitle || searching) && (
                      <span className="block truncate text-xs text-hud-text/45">
                        {searching ? [command.group, command.subtitle].filter(Boolean).join(" · ") : command.subtitle}
                      </span>
                    )}
                  </span>
                  {command.badge && (
                    <span className="rounded-full border border-hud-cyan/25 px-2 py-0.5 text-[10px] tracking-[0.14em] text-hud-light/80 uppercase">
                      {command.badge}
                    </span>
                  )}
                  {command.shortcut && (
                    <kbd className="font-mono text-[10px] tracking-[0.1em] whitespace-nowrap text-hud-text/40 uppercase">{command.shortcut}</kbd>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex items-center gap-4 border-t border-hud-cyan/10 px-5 py-2.5 text-[10px] tracking-[0.16em] text-hud-text/40 uppercase">
          <span>
            <kbd className="text-hud-text/70">↑↓</kbd> navegar
          </span>
          <span>
            <kbd className="text-hud-text/70">enter</kbd> abrir
          </span>
          <span>
            <kbd className="text-hud-text/70">esc</kbd> fechar
          </span>
          <span className="ml-auto">
            {results.length} {results.length === 1 ? "resultado" : "resultados"}
          </span>
        </footer>
      </motion.div>
    </>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const range = matchRange(text, query);
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <span className="font-semibold text-hud-light underline decoration-hud-cyan/50 underline-offset-2">{text.slice(range[0], range[1])}</span>
      {text.slice(range[1])}
    </>
  );
}
