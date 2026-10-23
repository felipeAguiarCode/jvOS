import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, Plus, X } from "lucide-react";
import {
  onTabRequest,
  takePendingProfile,
  terminalBackend,
  type TerminalBackend,
  type TerminalProfile,
  type TerminalProfiles,
} from "../../../lib/terminal";

interface Tab {
  key: string;
  profile: TerminalProfile;
  title: string;
  /** The shell's session once it started. */
  session: number | null;
  /** Exit code of a shell that ended with an error (the tab stays to show why). */
  failed: number | null;
}

/** A shell asks for its title (OSC); a long one is cut in the tab, whole in the tooltip. */
const TITLE_CHARS = 22;
/** How long the terminal waits for a resize to settle before telling the shell. */
const RESIZE_DEBOUNCE_MS = 60;

let nextKey = 0;

/** The JARVIS palette, read from the CSS variables around the terminal (theme and TUI accent). */
function readTheme(element: HTMLElement): ITheme {
  const style = getComputedStyle(element);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const text = color("--color-hud-text", "#c8d6e0");
  const light = color("--color-hud-light", "#9fe8ff");
  const cyan = color("--color-hud-cyan", "#2fb8e6");
  const alert = color("--color-hud-alert", "#ff5d5d");
  return {
    background: "rgba(0, 0, 0, 0)",
    foreground: text,
    cursor: light,
    cursorAccent: "#000000",
    selectionBackground: `color-mix(in oklab, ${cyan} 35%, transparent)`,
    black: "#0b1014",
    red: alert,
    green: "#5fd38d",
    yellow: "#e5c07b",
    blue: cyan,
    magenta: "#c678dd",
    cyan: light,
    white: text,
    brightBlack: "#5c6873",
    brightRed: "#ff8080",
    brightGreen: "#8be8ad",
    brightYellow: "#f2d99a",
    brightBlue: light,
    brightMagenta: "#dda2ee",
    brightCyan: "#c8f4ff",
    brightWhite: "#ffffff",
  };
}

/**
 * jv_sh: the user's real shells (their Windows Terminal profiles) in tabs, inside a JARVIS
 * window. Closing the window ends them all; the last tab that exits closes the window.
 */
export function ShellApp({ onClose }: { onClose: () => void }) {
  const backend = useMemo(terminalBackend, []);
  const [profiles, setProfiles] = useState<TerminalProfiles | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Session id → its terminal; output for a session not shown yet waits in `pending`. */
  const views = useRef(new Map<number, Terminal>());
  const pending = useRef(new Map<number, string[]>());
  const opened = useRef(false);
  const latest = useRef({ tabs, active, profiles });
  latest.current = { tabs, active, profiles };

  const newTab = useCallback((profileId?: string | null) => {
    const list = latest.current.profiles;
    const profile = list?.profiles.find((item) => item.id === (profileId ?? list.default)) ?? list?.profiles[0];
    if (!profile) return;
    const key = `tab-${++nextKey}`;
    setTabs((current) => [...current, { key, profile, title: profile.name, session: null, failed: null }]);
    setActive(key);
    setMenu(false);
  }, []);

  const removeTab = useCallback((key: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.key === key);
      if (index < 0) return current;
      const rest = current.filter((tab) => tab.key !== key);
      if (latest.current.active === key) setActive(rest[Math.min(index, rest.length - 1)]?.key ?? null);
      return rest;
    });
  }, []);

  // The last tab gone (closed or exited) closes the window, as Windows Terminal does.
  useEffect(() => {
    if (opened.current && tabs.length === 0) onClose();
    if (tabs.length) opened.current = true;
  }, [tabs.length, onClose]);

  // The profiles, then the first tab: one asked for from the search, or the default.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    void backend.profiles().then(
      (found) => {
        if (cancelled) return;
        if (!found.profiles.length) return setError("Nenhum shell encontrado nesta máquina");
        latest.current.profiles = found;
        setProfiles(found);
        newTab(takePendingProfile());
      },
      (reason) => !cancelled && setError(String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [backend, newTab]);

  useEffect(() => onTabRequest((profile) => newTab(profile)), [newTab]);

  // Output goes to its terminal; an exit closes the tab (or, on an error, says why).
  useEffect(() => {
    if (!backend) return;
    return backend.subscribe(
      (id, data) => {
        const view = views.current.get(id);
        if (view) view.write(data);
        else pending.current.set(id, [...(pending.current.get(id) ?? []), data]);
      },
      (id, code) => {
        const tab = latest.current.tabs.find((item) => item.session === id);
        if (!tab) return;
        if (!code) return removeTab(tab.key);
        views.current.get(id)?.write(`\r\n\x1b[2m[processo encerrado: código ${code}]\x1b[0m\r\n`);
        setTabs((current) => current.map((item) => (item.key === tab.key ? { ...item, failed: code } : item)));
      },
    );
  }, [backend, removeTab]);

  const register = useCallback((id: number, view: Terminal | null) => {
    if (!view) return void views.current.delete(id);
    views.current.set(id, view);
    pending.current.get(id)?.forEach((data) => view.write(data));
    pending.current.delete(id);
  }, []);

  const setSession = useCallback((key: string, session: number) => setTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, session } : tab))), []);
  const setTitle = useCallback((key: string, title: string) => setTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, title: title || tab.profile.name } : tab))), []);

  const switchTab = useCallback((step: 1 | -1) => {
    const { tabs: list, active: current } = latest.current;
    if (list.length < 2) return;
    const index = list.findIndex((tab) => tab.key === current);
    setActive(list[(index + step + list.length) % list.length].key);
  }, []);

  // Shortcuts the terminal does not pass on to the shell; everything else is the shell's.
  const shortcut = useCallback(
    (event: KeyboardEvent, view: Terminal): boolean => {
      if (event.type !== "keydown") return true;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
        return false;
      };
      if (ctrl && event.shiftKey && key === "t") return run(() => newTab());
      if (ctrl && event.shiftKey && key === "w") return run(() => latest.current.active && removeTab(latest.current.active));
      if (ctrl && event.key === "Tab") return run(() => switchTab(event.shiftKey ? -1 : 1));
      if (ctrl && event.shiftKey && key === "c") return run(() => void navigator.clipboard?.writeText(view.getSelection()).catch(() => {}));
      if (ctrl && key === "v") return run(() => void navigator.clipboard?.readText().then((text) => text && view.paste(text), () => {}));
      return true;
    },
    [newTab, removeTab, switchTab],
  );

  if (!backend) {
    return <div className="grid h-full place-items-center font-mono text-sm text-hud-text/60">Disponível no app desktop</div>;
  }

  return (
    <div data-testid="shell-app" className="flex h-full flex-col font-mono text-[12px]">
      <div role="tablist" aria-label="Abas do terminal" className="flex h-6 shrink-0 items-stretch gap-px border-b border-hud-cyan/15 pr-1">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              title={tab.title}
              onClick={() => setActive(tab.key)}
              className={`group flex max-w-[24ch] cursor-pointer items-center gap-1.5 pr-1 pl-2.5 ${
                isActive ? "bg-hud-light/85 font-semibold text-hud-void" : "bg-hud-text/[0.07] text-hud-text/65 hover:text-hud-light"
              }`}
            >
              <span className="truncate">
                {tab.title.length > TITLE_CHARS ? `${tab.title.slice(0, TITLE_CHARS - 1)}…` : tab.title}
                {tab.failed !== null && " (encerrado)"}
              </span>
              <button
                type="button"
                aria-label={`Fechar a aba ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeTab(tab.key);
                }}
                className={`grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm outline-none ${isActive ? "hover:bg-hud-void/20" : "opacity-0 group-hover:opacity-100 hover:bg-hud-cyan/15 focus-visible:opacity-100"}`}
              >
                <X size={10} strokeWidth={2.2} />
              </button>
            </div>
          );
        })}
        <button type="button" aria-label="Nova aba" title="Nova aba (Ctrl+Shift+T)" onClick={() => newTab()} className="grid w-6 cursor-pointer place-items-center text-hud-text/60 outline-none hover:bg-hud-cyan/10 hover:text-hud-light">
          <Plus size={12} strokeWidth={2} />
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="Escolher perfil"
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
            className="grid h-full w-5 cursor-pointer place-items-center text-hud-text/60 outline-none hover:bg-hud-cyan/10 hover:text-hud-light"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          {menu && profiles && (
            <ProfileMenu
              profiles={profiles}
              onPick={(id) => newTab(id)}
              onClose={() => setMenu(false)}
            />
          )}
        </div>
      </div>
      {error && <p className="px-3 py-2 text-hud-alert">{error}</p>}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.key}
            tab={tab}
            active={tab.key === active}
            backend={backend}
            register={register}
            onSession={setSession}
            onTitle={setTitle}
            shortcut={shortcut}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileMenu({ profiles, onPick, onClose }: { profiles: TerminalProfiles; onPick: (id: string) => void; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointer = (event: PointerEvent) => !menu.current?.parentElement?.contains(event.target as Node) && onClose();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={menu} role="menu" aria-label="Perfis" className="absolute top-full left-0 z-10 mt-px min-w-[24ch] border border-hud-cyan/30 bg-hud-panel/95 py-1 shadow-[0_12px_30px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      {profiles.profiles.map((profile) => (
        <button
          key={profile.id}
          type="button"
          role="menuitem"
          onClick={() => onPick(profile.id)}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-1 text-left text-hud-text outline-none hover:bg-hud-light/85 hover:text-hud-void focus-visible:bg-hud-light/85 focus-visible:text-hud-void"
        >
          <span className="truncate">{profile.name}</span>
          {profile.id === profiles.default && <span className="text-[10px] opacity-60">padrão</span>}
        </button>
      ))}
    </div>
  );
}

interface TerminalViewProps {
  tab: Tab;
  active: boolean;
  backend: TerminalBackend;
  register: (id: number, view: Terminal | null) => void;
  onSession: (key: string, session: number) => void;
  onTitle: (key: string, title: string) => void;
  shortcut: (event: KeyboardEvent, view: Terminal) => boolean;
}

/** One tab: an xterm, sized to its box, talking to its shell's session. */
function TerminalView({ tab, active, backend, register, onSession, onTitle, shortcut }: TerminalViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const handlers = useRef({ register, onSession, onTitle, shortcut });
  handlers.current = { register, onSession, onTitle, shortcut };
  const { key, profile } = tab;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const font = getComputedStyle(element).getPropertyValue("--font-mono").trim() || "Consolas, monospace";
    const terminal = new Terminal({
      fontFamily: font,
      fontSize: 13,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: readTheme(element),
    });
    const fitter = new FitAddon();
    terminal.loadAddon(fitter);
    terminal.open(element);
    fitter.fit();
    view.current = terminal;
    fit.current = fitter;

    let session: number | null = null;
    let disposed = false;
    void backend.open(profile.id, terminal.cols, terminal.rows).then(
      (id) => {
        // StrictMode (dev) mounts twice: a shell that lost the race is closed at once.
        if (disposed) return backend.close(id);
        session = id;
        handlers.current.register(id, terminal);
        handlers.current.onSession(key, id);
      },
      (reason) => terminal.write(`\x1b[31m${String(reason)}\x1b[0m\r\n`),
    );
    const input = terminal.onData((data) => session !== null && backend.write(session, data));
    const title = terminal.onTitleChange((text) => handlers.current.onTitle(key, text));
    terminal.attachCustomKeyEventHandler((event) => handlers.current.shortcut(event, terminal));

    // The window resizes (or maximises): the terminal refits, and the shell learns its new size.
    let timer = 0;
    let size = `${terminal.cols}x${terminal.rows}`;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!element.offsetParent) return;
        fitter.fit();
        const next = `${terminal.cols}x${terminal.rows}`;
        if (next !== size && session !== null) backend.resize(session, terminal.cols, terminal.rows);
        size = next;
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);

    // A new theme or TUI accent recolours it.
    const recolor = new MutationObserver(() => (terminal.options.theme = readTheme(element)));
    recolor.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    const windowElement = element.closest("[data-window]");
    if (windowElement) recolor.observe(windowElement, { attributes: true, attributeFilter: ["style", "class"] });

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      recolor.disconnect();
      input.dispose();
      title.dispose();
      if (session !== null) {
        handlers.current.register(session, null);
        backend.close(session);
      }
      terminal.dispose();
      view.current = null;
    };
  }, [backend, key, profile.id]);

  // The tab in front gets the keyboard and its true size (hidden ones cannot measure).
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fit.current?.fit();
      view.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Right click copies the selection, or pastes, as in Windows Terminal.
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const terminal = view.current;
    if (!terminal) return;
    if (terminal.hasSelection()) {
      void navigator.clipboard?.writeText(terminal.getSelection()).catch(() => {});
      terminal.clearSelection();
    } else {
      void navigator.clipboard?.readText().then((text) => text && terminal.paste(text), () => {});
    }
  };

  return (
    <div
      ref={box}
      role="tabpanel"
      aria-label={tab.title}
      data-terminal
      data-session={tab.session ?? undefined}
      onContextMenu={onContextMenu}
      className={`absolute inset-0 py-1 pl-2 select-text ${active ? "" : "hidden"}`}
    />
  );
}
