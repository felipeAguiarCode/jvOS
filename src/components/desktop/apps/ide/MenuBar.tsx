import { useEffect, useRef, useState } from "react";
import { useMinuteClock } from "../../../../hooks/useMinuteClock";
import { useSystemStats } from "../../../../hooks/useSystemStats";
import { baseName, dirName, samePath } from "../../../../lib/paths";
import { MenuPopup, type MenuItem, type MenuSection } from "../../widgets/WidgetMenu";
import { buildCommands, type Command } from "./commands";
import { useIde, useStore } from "./context";
import { formatRate, formatTime, formatUsage } from "./format";
import type { IdePrefs } from "./types";

/** The menus, with the letter Alt opens each by. */
export const MENUS = [
  { label: "Favoritos", letter: "f" },
  { label: "Comandos", letter: "c" },
  { label: "Projetos", letter: "p" },
  { label: "Janelas", letter: "j" },
  { label: "Opções", letter: "o" },
] as const;

/** How the IDE opens the menus from the keyboard (F10, Alt+letter). */
export interface MenuBarHandle {
  open: (index: number) => void;
  focus: () => void;
}

/** termide's top line: the menus on the left, network, CPU, RAM and the time on the right. */
export function MenuBar({ paused, handle }: { paused: boolean; handle: (value: MenuBarHandle | null) => void }) {
  const store = useStore();
  const state = useIde();
  const [open, setOpen] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const commands = buildCommands(store, state);

  const openAt = (index: number) => {
    const count = MENUS.length;
    const next = (index + count) % count;
    if (MENUS[next].label === "Janelas") void store.loadTerminalProfiles();
    setOpen(next);
    buttons.current[next]?.focus();
  };

  useEffect(() => {
    handle({ open: openAt, focus: () => buttons.current[0]?.focus() });
    return () => handle(null);
  });

  const command = (id: string): MenuItem => {
    const found: Command = commands.get(id)!;
    return { kind: found.checked === undefined ? "action" : "check", label: found.title, detail: found.keys, checked: found.checked, disabled: found.enabled === false, onSelect: found.run };
  };
  const pref = (key: keyof IdePrefs, label: string): MenuItem => ({
    kind: "check",
    label,
    checked: state.prefs[key] as boolean,
    onSelect: () => store.setPrefs({ [key]: !state.prefs[key] }),
  });

  const sections = (index: number): MenuSection[] => {
    switch (MENUS[index].label) {
      case "Favoritos":
        return [
          { items: [command("bookmark.toggle")] },
          {
            title: "Favoritos",
            items: state.bookmarks.length
              ? state.bookmarks.map((bookmark) => ({
                  kind: "action" as const,
                  label: bookmark.dir ? `▶ /${baseName(bookmark.path)}` : baseName(bookmark.path),
                  detail: dirName(bookmark.path),
                  onSelect: () => void store.openBookmark(bookmark.path, bookmark.dir),
                }))
              : [{ kind: "action" as const, label: "nenhum favorito ainda", disabled: true, onSelect: () => undefined }],
          },
        ];
      case "Comandos":
        return [
          { items: ["palette.commands", "palette.files", "palette.line", "palette.symbols", "search.focus"].map(command) },
          { items: ["file.new", "file.save", "file.saveAs", "file.saveAll", "tab.close", "tab.reopen", "file.reload"].map(command) },
          { items: ["file.eol", "file.encodingUtf8", "palette.language"].map(command) },
          { title: "Git", items: ["git.commit", "git.push", "git.pull", "git.log", "git.diff", "git.stash", "git.branch"].map(command) },
        ];
      case "Projetos":
        return [
          { items: ["project.open", "project.close"].map(command) },
          {
            title: "Recentes",
            items: state.recent.length
              ? state.recent.map((path) => ({
                  kind: "radio" as const,
                  label: baseName(path),
                  detail: dirName(path),
                  checked: !!state.root && samePath(state.root, path),
                  onSelect: () => {
                    setOpen(null);
                    void store.openProject(path);
                  },
                }))
              : [{ kind: "action" as const, label: "nenhum projeto ainda", disabled: true, onSelect: () => undefined }],
          },
          {
            items: [
              { kind: "action", label: "Limpar recentes", disabled: state.recent.length < 2, onSelect: () => store.forgetRecent() },
              command("project.reveal"),
              command("project.copyPath"),
              { ...command("terminal.new"), label: "Terminal na raiz do projeto" },
            ],
          },
        ];
      case "Janelas":
        return [
          { title: "Painéis", items: ["panel.editor", "panel.files", "panel.git", "panel.outline", "panel.search"].map(command) },
          {
            title: "Terminais",
            items: [
              command("terminal.toggle"),
              ...state.profiles.map((profile) => ({
                kind: "action" as const,
                label: `Novo terminal: ${profile.name}`,
                detail: profile.id === state.defaultProfile ? "padrão" : undefined,
                onSelect: () => void store.openTerminal(profile.id),
              })),
            ],
          },
          { items: ["panel.next", "panel.zoom", "layout.reset"].map(command) },
        ];
      default:
        return [
          {
            items: [
              command("view.wrap"),
              pref("showHidden", "Mostrar arquivos ocultos"),
              pref("hideIgnored", "Esconder os ignorados pelo git"),
              pref("effects", "Efeitos TUI no editor"),
              pref("blockCursor", "Cursor em bloco"),
              pref("autoSave", "Salvar automaticamente"),
            ],
          },
          {
            title: "Tab padrão",
            items: ([2, 4, 8] as const).map((size) => ({ kind: "radio" as const, label: `${size} espaços`, checked: state.prefs.defaultTab === size, onSelect: () => store.setPrefs({ defaultTab: size }) })),
          },
          {
            title: "Fonte",
            items: ([12, 13, 14, 15] as const).map((size) => ({ kind: "radio" as const, label: `${size} px`, checked: state.prefs.fontSize === size, onSelect: () => store.setPrefs({ fontSize: size }) })),
          },
        ];
    }
  };

  const anchor = open !== null ? buttons.current[open]?.getBoundingClientRect() : null;

  return (
    <div role="menubar" aria-label="Menu do jv_ide" className="flex h-[18px] shrink-0 items-center bg-hud-text/[0.06] px-1 text-[12px] leading-[18px] whitespace-nowrap">
      {MENUS.map((menu, index) => (
        <button
          key={menu.label}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open === index}
          onClick={() => (open === index ? setOpen(null) : openAt(index))}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              buttons.current[(index + (event.key === "ArrowRight" ? 1 : MENUS.length - 1)) % MENUS.length]?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              openAt(index);
            } else if (event.key === "Escape") {
              event.preventDefault();
              store.focusPanel(state.layout.focus ?? "editor");
            }
          }}
          className={`cursor-pointer px-1.5 outline-none ${open === index ? "bg-hud-light/85 text-hud-void" : "text-hud-text/80 hover:text-hud-light focus-visible:bg-hud-light/85 focus-visible:text-hud-void"}`}
        >
          <span className="underline decoration-hud-text/30 underline-offset-2">{menu.label[0]}</span>
          {menu.label.slice(1)}
        </button>
      ))}
      <span className="flex-1" />
      <SystemReadout paused={paused} />
      {open !== null && anchor && (
        <MenuPopup
          key={open}
          at={{ x: anchor.left, y: anchor.bottom }}
          label={MENUS[open].label}
          sections={sections(open)}
          container={store.container}
          onClose={() => setOpen(null)}
          onDismiss={() => {
            const index = open;
            setOpen(null);
            buttons.current[index]?.focus();
          }}
          onNavigate={(direction) => openAt(open + direction)}
        />
      )}
    </div>
  );
}

function SystemReadout({ paused }: { paused: boolean }) {
  const status = useSystemStats(paused);
  const now = useMinuteClock(paused);
  const stats = status.kind === "ready" ? status.stats : null;
  return (
    <span data-testid="ide-system" className="flex items-center gap-2 pr-1 text-[11px] text-hud-text/70">
      {stats?.net && (
        <span className="hidden @[640px]:inline">
          <span className="text-hud-light">↓</span>
          {formatRate(stats.net.down)} <span className="text-hud-light">↑</span>
          {formatRate(stats.net.up)}
        </span>
      )}
      <span>CPU {stats?.cpu != null ? `${Math.round(stats.cpu * 100)}%` : "—"}</span>
      <span>RAM {stats?.ram ? formatUsage(stats.ram) : "—"}</span>
      <span className="font-semibold text-hud-light">{formatTime(now)}</span>
    </span>
  );
}
