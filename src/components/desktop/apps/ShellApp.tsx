import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { ChevronDown, Plus, X } from "lucide-react";
import { onTabRequest, takePendingProfile, terminalBackend, type TabRequest, type TerminalProfile, type TerminalProfiles } from "../../../lib/terminal";
import { copySelection, pasteClipboard, TerminalView } from "./terminal/TerminalView";

interface Tab {
  key: string;
  profile: TerminalProfile;
  title: string;
  /** Exit code of a shell that ended with an error (the tab stays to show why). */
  failed: number | null;
}

/** A shell asks for its title (OSC); a long one is cut in the tab, whole in the tooltip. */
const TITLE_CHARS = 22;

let nextKey = 0;

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
  const opened = useRef(false);
  const latest = useRef({ tabs, active, profiles });
  latest.current = { tabs, active, profiles };

  /** A tab with one of the profiles (by id, or the default), or a whole profile (an agent JARVIS runs). */
  const newTab = useCallback((request?: TabRequest | null) => {
    const list = latest.current.profiles;
    const profile =
      typeof request === "object" && request !== null
        ? request
        : (list?.profiles.find((item) => item.id === (request ?? list.default)) ?? list?.profiles[0]);
    if (!profile) return;
    const key = `tab-${++nextKey}`;
    setTabs((current) => [...current, { key, profile, title: profile.name, failed: null }]);
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

  // An exit closes the tab; on an error it stays (the terminal says why).
  const exited = useCallback(
    (key: string, code: number | null) => {
      if (!code) return removeTab(key);
      setTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, failed: code } : tab)));
    },
    [removeTab],
  );

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
      if (ctrl && event.shiftKey && key === "c") return run(() => copySelection(view));
      if (ctrl && key === "v") return run(() => pasteClipboard(view));
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
            profile={tab.profile}
            label={tab.title}
            active={tab.key === active}
            backend={backend}
            onTitle={(title) => setTitle(tab.key, title)}
            onExit={(code) => exited(tab.key, code)}
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
    <div ref={menu} role="menu" aria-label="Perfis" className="absolute top-full left-0 z-10 mt-px min-w-[24ch] border border-hud-cyan/30 bg-hud-panel/95 py-1 shadow-[0_12px_30px_rgba(0,0,0,0.6)]">
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
