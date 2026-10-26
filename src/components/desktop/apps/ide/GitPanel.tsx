import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { GitChange } from "../../../../lib/git";
import { baseName } from "../../../../lib/paths";
import { MenuPopup, type MenuSection } from "../../widgets/WidgetMenu";
import { useIde, useStore } from "./context";
import { formatDateTime } from "./format";
import { PanelFrame, usePanelFocus } from "./PanelFrame";

type Section = "unstaged" | "staged";

interface FileRow {
  kind: "file";
  section: Section;
  change: GitChange;
  /** The folder it is listed under ("" at the top). */
  folder: string;
  last: boolean;
}

type Row = { kind: "header"; section: Section; count: number } | { kind: "folder"; section: Section; folder: string } | FileRow;

const STATUS_COLOR: Record<string, string> = {
  M: "text-hud-amber",
  T: "text-hud-amber",
  R: "text-hud-amber",
  C: "text-hud-amber",
  A: "text-hud-light",
  "?": "text-hud-light",
  D: "text-hud-alert",
  U: "text-hud-alert",
};

/** The changes of one section grouped by folder, as termide shows them ("▼ /inventory", "├ models.py"). */
function sectionRows(section: Section, changes: GitChange[]): Row[] {
  const rows: Row[] = [{ kind: "header", section, count: changes.length }];
  const byFolder = new Map<string, GitChange[]>();
  for (const change of changes) {
    const slash = change.path.lastIndexOf("/");
    const folder = slash < 0 ? "" : change.path.slice(0, slash);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), change]);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  for (const folder of folders) {
    const items = byFolder.get(folder)!;
    if (folder) rows.push({ kind: "folder", section, folder });
    items.forEach((change, index) => rows.push({ kind: "file", section, change, folder, last: index === items.length - 1 }));
  }
  return rows;
}

/** Branch, ahead/behind, the changes in and out of the stage, and termide's row of buttons. */
export function GitPanel({ id }: { id: string }) {
  const store = useStore();
  const { git, root, info, layout } = useIde();
  const list = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "repo" | "branch" | "stash" | "file"; row?: FileRow } | null>(null);
  const status = git.status;
  const focused = layout.focus === id;
  usePanelFocus(id, () => list.current?.focus());

  // Fresh status when the panel shows up and when the window comes back to the front.
  useEffect(() => {
    void store.refreshGit();
    const onFocus = () => void store.refreshGit();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [store, root]);

  const rows = useMemo<Row[]>(() => {
    if (!status) return [];
    const unstaged = [...status.conflicted, ...status.unstaged, ...status.untracked];
    return [...sectionRows("unstaged", unstaged), ...sectionRows("staged", status.staged)];
  }, [status]);
  const files = rows.filter((row): row is FileRow => row.kind === "file");
  const selected = files[Math.min(cursor, files.length - 1)] ?? null;

  useEffect(() => {
    list.current?.querySelector(`[data-file="${Math.min(cursor, files.length - 1)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, files.length]);

  const toggleStage = (row: FileRow) => void (row.section === "staged" ? store.unstage([row.change.path]) : store.stage([row.change.path]));

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
    if (event.key in moves) {
      event.preventDefault();
      return setCursor((value) => Math.max(0, Math.min(files.length - 1, value + moves[event.key])));
    }
    if (!selected) return;
    if (event.key === " ") {
      event.preventDefault();
      toggleStage(selected);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void store.openDiff(selected.change, selected.section === "staged");
    } else if (event.key === "Delete" && selected.section === "unstaged") {
      event.preventDefault();
      store.discard([selected.change.path], baseName(selected.change.path));
    } else if (event.key.toLowerCase() === "o" && !event.ctrlKey) {
      event.preventDefault();
      void store.openFile(store.gitPath(selected.change), { focus: true });
    } else if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      event.preventDefault();
      const element = list.current?.querySelector(`[data-file="${files.indexOf(selected)}"]`)?.getBoundingClientRect();
      if (element) setMenu({ x: element.left + 24, y: element.bottom, kind: "file", row: selected });
    }
  };

  const openMenu = async (event: MouseEvent<HTMLButtonElement>, kind: "repo" | "branch" | "stash") => {
    const box = event.currentTarget.getBoundingClientRect();
    if (kind === "branch") await store.loadBranches();
    if (kind === "stash") await store.loadStashes();
    setMenu({ x: box.left, y: box.bottom, kind });
  };

  const menuSections = (): MenuSection[] => {
    if (!menu) return [];
    if (menu.kind === "repo") {
      return [
        {
          items: [
            { kind: "action", label: "Atualizar", onSelect: () => void store.refreshGit() },
            { kind: "action", label: "Fetch", onSelect: () => void store.fetch() },
            { kind: "action", label: "Pull", onSelect: () => void store.pull() },
            { kind: "action", label: "Terminal na raiz do repositório", onSelect: () => void store.openTerminal() },
            { kind: "action", label: "Copiar caminho do repositório", onSelect: () => status && void store.copyText(status.repoRoot, "Caminho") },
          ],
        },
      ];
    }
    if (menu.kind === "branch") {
      const local = git.branches.filter((branch) => !branch.remote);
      const remote = git.branches.filter((branch) => branch.remote);
      return [
        { title: "Branches", items: local.map((branch) => ({ kind: "radio" as const, label: branch.name, checked: branch.current, detail: branch.upstream ?? undefined, onSelect: () => (setMenu(null), void store.checkout(branch.name)) })) },
        ...(remote.length ? [{ title: "Remotos", items: remote.map((branch) => ({ kind: "action" as const, label: branch.name, disabled: true, onSelect: () => undefined })) }] : []),
        { items: [{ kind: "action", label: "Novo branch…", onSelect: () => store.askNewBranch() }] },
      ];
    }
    if (menu.kind === "stash") {
      return [
        { items: [{ kind: "action", label: "Guardar as alterações…", onSelect: () => store.stashPush() }] },
        ...git.stashes.map((stash) => ({
          title: `stash@{${stash.index}} · ${formatDateTime(stash.time)}`,
          items: [
            { kind: "action" as const, label: `Aplicar e remover: ${stash.message}`, onSelect: () => void store.stashPop(stash.index) },
            { kind: "action" as const, label: "Descartar este stash", onSelect: () => void store.stashDrop(stash.index) },
          ],
        })),
      ];
    }
    const row = menu.row!;
    return [
      {
        items: [
          { kind: "action", label: "Abrir o arquivo", detail: "o", onSelect: () => void store.openFile(store.gitPath(row.change), { focus: true }) },
          { kind: "action", label: "Ver o diff", detail: "Enter", onSelect: () => void store.openDiff(row.change, row.section === "staged") },
          { kind: "action", label: row.section === "staged" ? "Unstage" : "Stage", detail: "Espaço", onSelect: () => toggleStage(row) },
          ...(row.section === "unstaged" ? [{ kind: "action" as const, label: "Descartar as alterações", detail: "Delete", onSelect: () => store.discard([row.change.path], baseName(row.change.path)) }] : []),
        ],
      },
    ];
  };

  const repoName = status ? baseName(status.repoRoot) : info?.name;
  const changes = status ? status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length : 0;
  const busy = git.busy;

  return (
    <PanelFrame
      id={id}
      label="Git"
      title={status ? `${repoName} (${status.branch ?? (status.detached ? `detached ${status.head}` : "HEAD")})` : "Git"}
      aside={
        status && (
          <span data-testid="git-counts">
            <span className="text-hud-amber">✱{changes}</span> ↑{status.ahead} ↓{status.behind}
          </span>
        )
      }
    >
      {!root ? (
        <div className="p-2 text-hud-text/45">abra uma pasta</div>
      ) : git.error && !status ? (
        <div className="p-2 text-hud-alert">{git.error}</div>
      ) : !status ? (
        <div className="p-2 text-hud-text/45">{git.loading ? "lendo o git…" : "Não é um repositório git"}</div>
      ) : (
        <div className="flex h-full flex-col text-[12px] leading-[18px]">
          <div className="flex shrink-0 items-center gap-2 px-1">
            <button type="button" aria-haspopup="menu" onClick={(event) => void openMenu(event, "repo")} className="cursor-pointer text-hud-text outline-none hover:text-hud-light focus-visible:text-hud-light">
              [{repoName} ▶]
            </button>
            <button type="button" aria-haspopup="menu" aria-label="Branches" onClick={(event) => void openMenu(event, "branch")} className="cursor-pointer text-hud-text outline-none hover:text-hud-light focus-visible:text-hud-light">
              [{status.branch ?? "HEAD"} ▶]
            </button>
            {status.operation && <span className="text-hud-alert">{status.operation} em andamento</span>}
            {busy && <span className="ml-auto text-hud-text/45">{busy}…</span>}
          </div>
          <div
            ref={list}
            role="listbox"
            aria-label="Alterações do git"
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-testid="ide-git"
            className="min-h-0 flex-1 overflow-auto outline-none [scrollbar-width:thin]"
          >
            {rows.map((row) => {
              if (row.kind === "header") {
                return (
                  <div key={`h-${row.section}`} className="flex items-center gap-1 px-1 text-hud-text/55">
                    <span aria-hidden>─</span>
                    {row.section === "unstaged" ? "Alterações" : "Em stage"} ({row.count})
                    <span aria-hidden className="h-px flex-1 bg-hud-cyan/20" />
                  </div>
                );
              }
              if (row.kind === "folder") {
                return (
                  <div key={`f-${row.section}-${row.folder}`} className="truncate px-1 pl-3 text-hud-cyan">
                    ▼ /{row.folder}
                  </div>
                );
              }
              const index = files.indexOf(row);
              const isSelected = index === Math.min(cursor, files.length - 1);
              return (
                <div
                  key={`${row.section}-${row.change.path}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`${row.change.path} ${row.section === "staged" ? "em stage" : "alterado"}`}
                  data-file={index}
                  data-section={row.section}
                  data-status={row.change.status}
                  onClick={(event) => {
                    setCursor(index);
                    if (event.detail >= 2) void store.openDiff(row.change, row.section === "staged");
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setCursor(index);
                    setMenu({ x: event.clientX, y: event.clientY, kind: "file", row });
                  }}
                  className={`flex cursor-pointer items-center gap-1 pr-1 whitespace-pre ${row.folder ? "pl-5" : "pl-3"} ${isSelected && focused ? "bg-hud-light/85 text-hud-void" : isSelected ? "bg-hud-light/20" : "hover:bg-hud-light/10"}`}
                >
                  <span className={isSelected && focused ? "" : "text-hud-text/35"}>{row.last ? "└" : "├"}</span>
                  <span className={`min-w-0 flex-1 truncate ${isSelected && focused ? "" : (STATUS_COLOR[row.change.status] ?? "")}`}>
                    {baseName(row.change.path)}
                    {row.change.origPath && <span className="opacity-60"> ← {baseName(row.change.origPath)}</span>}
                  </span>
                  <span className={isSelected && focused ? "" : "text-hud-text/45"}>{row.change.status}</span>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-wrap gap-x-1.5 border-t border-hud-cyan/15 px-1 py-0.5">
            <GitButton label="Stage tudo" onClick={() => void store.stageAll()} disabled={!!busy} />
            <GitButton label="Unstage tudo" onClick={() => void store.unstageAll()} disabled={!!busy || !status.staged.length} />
            <GitButton label="Reverter tudo" onClick={() => store.discardAll()} disabled={!!busy || !changes} />
            <GitButton label="Log" onClick={() => void store.openLog()} disabled={!!busy} />
            <GitButton label="Diff" onClick={() => void store.openFullDiff()} disabled={!!busy || !changes} />
            <GitButton label="Push" onClick={() => void store.push()} disabled={!!busy} />
            <GitButton label="Commit" onClick={() => store.askCommit()} disabled={!!busy} />
            <button
              type="button"
              aria-haspopup="menu"
              onClick={(event) => void openMenu(event, "stash")}
              disabled={!!busy}
              className="cursor-pointer text-hud-text outline-none hover:text-hud-light focus-visible:text-hud-light disabled:opacity-40"
            >
              [Stash ({status.stash})]
            </button>
          </div>
        </div>
      )}
      {menu && (
        <MenuPopup
          at={menu}
          label={menu.kind === "branch" ? "Branches" : menu.kind === "stash" ? "Stash" : menu.kind === "repo" ? "Repositório" : "Arquivo alterado"}
          sections={menuSections()}
          container={store.container}
          onClose={() => setMenu(null)}
          onDismiss={() => {
            setMenu(null);
            list.current?.focus();
          }}
        />
      )}
    </PanelFrame>
  );
}

function GitButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="cursor-pointer text-hud-text outline-none hover:text-hud-light focus-visible:text-hud-light disabled:cursor-default disabled:opacity-40">
      [{label}]
    </button>
  );
}
