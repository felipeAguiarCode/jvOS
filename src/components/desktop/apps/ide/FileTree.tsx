import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { GitStatus } from "../../../../lib/git";
import { baseName, dirName, isInside, isVolumeRoot, joinPath, relativePath, samePath } from "../../../../lib/paths";
import type { DirEntry } from "../../../../lib/workspace";
import { MenuPopup, type MenuSection } from "../../widgets/WidgetMenu";
import { useIde, useStore } from "./context";
import { PanelFrame, usePanelFocus } from "./PanelFrame";
import type { IdeState } from "./types";

const ROW = 18;
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 12;
const TYPEAHEAD_MS = 600;

type Row =
  | { kind: "up"; key: string; path: string }
  | { kind: "entry"; key: string; path: string; entry: DirEntry; depth: number; expanded: boolean; loading: boolean };

function rowsOf({ tree, prefs }: IdeState): Row[] {
  const top = tree.viewRoot;
  if (!top) return [];
  const rows: Row[] = [];
  if (!isVolumeRoot(top)) rows.push({ kind: "up", key: "..", path: dirName(top) });
  const expanded = new Set(tree.expanded.map((dir) => dir.toLowerCase()));
  const walk = (dir: string, depth: number) => {
    for (const entry of tree.dirs[dir]?.entries ?? []) {
      if (!prefs.showHidden && entry.hidden) continue;
      if (prefs.hideIgnored && entry.ignored) continue;
      const path = joinPath(dir, entry.name);
      const open = entry.kind === "dir" && expanded.has(path.toLowerCase());
      rows.push({ kind: "entry", key: path, path, entry, depth, expanded: open, loading: open && !!tree.dirs[path]?.loading && !tree.dirs[path]?.entries });
      if (open) walk(path, depth + 1);
    }
  };
  walk(top, 0);
  return rows;
}

/** Git state by absolute path (lower case), plus the folders holding changes. */
function gitMarks(status: GitStatus | null) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  if (!status) return { files, dirs };
  const mark = (path: string, letter: string) => {
    const absolute = joinPath(status.repoRoot, path).toLowerCase();
    if (!files.has(absolute) || letter === "U") files.set(absolute, letter);
    for (let dir = dirName(absolute); isInside(status.repoRoot.toLowerCase(), dir); dir = dirName(dir)) dirs.add(dir);
  };
  for (const change of status.staged) mark(change.path, change.status === "A" ? "A" : "S");
  for (const change of status.unstaged) mark(change.path, change.status);
  for (const change of status.untracked) mark(change.path, "?");
  for (const change of status.conflicted) mark(change.path, "U");
  return { files, dirs };
}

const GIT_COLOR: Record<string, string> = {
  M: "text-hud-amber",
  T: "text-hud-amber",
  D: "text-hud-alert line-through",
  U: "text-hud-alert",
  A: "text-hud-light",
  "?": "text-hud-light",
  S: "text-hud-cyan",
  R: "text-hud-amber",
};

/** termide's file manager: "..", "▶ /folder", files; keyboard first, git colours, inline prompts. */
export function FileTree({ id }: { id: string }) {
  const store = useStore();
  const state = useIde();
  const { tree, layout, root, git } = state;
  const list = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string | null } | null>(null);
  /** The ".." row has no path of its own to select. */
  const [upSelected, setUpSelected] = useState(false);
  /** The entry whose name is being edited in place. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const typed = useRef({ text: "", at: 0 });
  /** The row the last click hit, so a double click is on one row. */
  const lastClick = useRef<string | null>(null);
  const rows = useMemo(() => rowsOf(state), [state]);
  const marks = useMemo(() => gitMarks(git.status), [git.status]);
  const focused = layout.focus === id;

  usePanelFocus(id, () => list.current?.focus());

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = rows.findIndex((row) => tree.selected && samePath(row.path, tree.selected) && row.kind === "entry");

  // The selection always has a row, and stays in sight.
  useEffect(() => {
    const element = list.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW - element.clientHeight;
  }, [selectedIndex]);

  const select = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    store.select(row.kind === "up" ? null : row.path);
    setUpSelected(row.kind === "up");
  };
  const cursor = upSelected ? 0 : selectedIndex;
  const current = rows[cursor] ?? null;

  const activate = (row: Row, pin: boolean) => {
    if (row.kind === "up") return store.setViewRoot(row.path);
    if (row.entry.kind === "dir") return store.toggleDir(row.path);
    void store.openFile(row.path, { preview: !pin, focus: pin });
  };

  const targetDir = (row: Row | null) => (!row || row.kind === "up" ? tree.viewRoot! : row.entry.kind === "dir" ? row.path : dirName(row.path));

  const askCreate = (dir: string, isDir: boolean) =>
    store.ask({ kind: "input", label: `${isDir ? "Nova pasta" : "Novo arquivo"} em ${baseName(dir)}/`, value: "", submit: (name) => store.createEntry(dir, name, isDir) });

  const finishRename = async (path: string, name: string, fromKey: boolean) => {
    const done = await store.renameEntry(path, name);
    // A refused name stays open for another try, unless the box was left by clicking elsewhere.
    if (!done && fromKey) return false;
    setRenaming(null);
    if (fromKey) list.current?.focus();
    return true;
  };

  const cancelRename = () => {
    setRenaming(null);
    list.current?.focus();
  };

  const renameIndex = renaming ? rows.findIndex((row) => row.kind === "entry" && samePath(row.path, renaming)) : -1;

  // Renamed, moved or deleted from outside while its name was being edited.
  useEffect(() => {
    if (!renaming || renameIndex >= 0) return;
    setRenaming(null);
    if (document.activeElement === document.body) list.current?.focus();
  }, [renaming, renameIndex]);

  const askDelete = (path: string) =>
    store.ask({
      kind: "confirm",
      label: `Mover ${baseName(path)} para a Lixeira?`,
      choices: [
        { key: "s", label: "sim", run: () => store.deleteEntry(path) },
        { key: "n", label: "não", run: () => undefined },
      ],
    });

  const onKeyDown = (event: KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const page = Math.max(1, Math.floor(height / ROW) - 1);
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (event.key in moves && !ctrl && !event.altKey) {
      event.preventDefault();
      return select((cursor < 0 ? -1 : cursor) + moves[event.key]);
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      return select(event.key === "Home" ? 0 : rows.length - 1);
    }
    if (event.key === "Backspace" && tree.viewRoot && !isVolumeRoot(tree.viewRoot)) {
      event.preventDefault();
      return store.setViewRoot(dirName(tree.viewRoot));
    }
    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      event.preventDefault();
      const box = list.current!.getBoundingClientRect();
      return setMenu({ x: box.left + 24, y: box.top + Math.max(0, cursor) * ROW - list.current!.scrollTop + ROW, path: current?.kind === "entry" ? current.path : null });
    }
    if (event.key === "Insert") {
      event.preventDefault();
      return askCreate(targetDir(current), event.shiftKey);
    }
    // Typing jumps to the next name starting with what was typed.
    if (event.key.length === 1 && !ctrl && !event.altKey && event.key !== " ") {
      event.preventDefault();
      const now = performance.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + event.key.toLowerCase();
      typed.current = { text, at: now };
      const from = cursor + (text.length === 1 ? 1 : 0);
      const order = [...rows.slice(Math.max(0, from)), ...rows.slice(0, Math.max(0, from))];
      const hit = order.find((row) => row.kind === "entry" && row.entry.name.toLowerCase().startsWith(text));
      if (hit) select(rows.indexOf(hit));
      return;
    }
    if (!current) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (ctrl && current.kind === "entry" && current.entry.kind === "dir") return void store.openProject(current.path);
      return activate(current, true);
    }
    if (current.kind === "up") return;
    const isDir = current.entry.kind === "dir";
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (isDir && !current.expanded) store.toggleDir(current.path, true);
      else if (isDir) select(cursor + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (isDir && current.expanded) return store.toggleDir(current.path, false);
      const parent = rows.findIndex((row) => row.kind === "entry" && samePath(row.path, dirName(current.path)));
      return select(parent >= 0 ? parent : 0);
    }
    if (event.key === " ") {
      event.preventDefault();
      return activate(current, false);
    }
    if (event.key === "F2") {
      event.preventDefault();
      return setRenaming(current.path);
    }
    if (event.key === "Delete") {
      event.preventDefault();
      return askDelete(current.path);
    }
    if (ctrl && event.key.toLowerCase() === "c") {
      event.preventDefault();
      const relative = root ? relativePath(root, current.path) : null;
      return void (event.shiftKey || relative === null ? store.copyText(current.path, "Caminho") : store.copyText(relative, "Caminho relativo"));
    }
  };

  const onRowClick = (event: MouseEvent, index: number) => {
    const row = rows[index];
    // Only on the row the first click hit: ".." moves the list under the pointer.
    const again = event.detail >= 2 && lastClick.current === row.key;
    lastClick.current = row.key;
    if (again) {
      // A double click renames; the folder the first click opened or closed goes back.
      if (event.detail === 2 && row.kind === "entry") {
        if (row.entry.kind === "dir") store.toggleDir(row.path);
        setRenaming(row.path);
      }
      return;
    }
    // A click opens a folder, goes up with "..", previews a file.
    select(index);
    activate(row, false);
  };

  const onContextMenu = (event: MouseEvent, index: number | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (index !== null) select(index);
    const row = index !== null ? rows[index] : null;
    setMenu({ x: event.clientX, y: event.clientY, path: row?.kind === "entry" ? row.path : null });
    list.current?.focus();
  };

  const menuSections = (path: string | null): MenuSection[] => {
    const row = path ? rows.find((item) => item.kind === "entry" && samePath(item.path, path)) : null;
    const isDir = row?.kind === "entry" ? row.entry.kind === "dir" : true;
    const dir = row ? targetDir(row) : (tree.viewRoot ?? "");
    const relative = path && root ? relativePath(root, path) : null;
    return [
      {
        items: [
          ...(path && !isDir ? [{ kind: "action" as const, label: "Abrir", detail: "Enter", onSelect: () => void store.openFile(path, { focus: true }) }] : []),
          { kind: "action", label: "Novo arquivo…", detail: "Insert", onSelect: () => askCreate(dir, false) },
          { kind: "action", label: "Nova pasta…", detail: "Shift+Insert", onSelect: () => askCreate(dir, true) },
        ],
      },
      ...(path
        ? [
            {
              items: [
                { kind: "action" as const, label: "Renomear", detail: "F2", onSelect: () => setRenaming(path) },
                { kind: "action" as const, label: "Mover para a Lixeira", detail: "Delete", onSelect: () => askDelete(path) },
                { kind: "action" as const, label: "Copiar caminho", detail: "Ctrl+Shift+C", onSelect: () => void store.copyText(path, "Caminho") },
                ...(relative !== null ? [{ kind: "action" as const, label: "Copiar caminho relativo", detail: "Ctrl+C", onSelect: () => void store.copyText(relative, "Caminho relativo") }] : []),
                { kind: "action" as const, label: "Mostrar no Explorer", onSelect: () => void store.revealInExplorer(path) },
                { kind: "action" as const, label: store.isBookmarked(path) ? "Remover dos favoritos" : "Adicionar aos favoritos", onSelect: () => store.toggleBookmark(path, isDir) },
              ],
            },
          ]
        : []),
      ...(isDir && path
        ? [
            {
              items: [
                { kind: "action" as const, label: "Abrir como projeto", detail: "Ctrl+Enter", onSelect: () => void store.openProject(path) },
                { kind: "action" as const, label: "Ver só esta pasta", onSelect: () => store.setViewRoot(path) },
              ],
            },
          ]
        : []),
    ];
  };

  const first = Math.max(0, Math.floor(scroll / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + OVERSCAN);
  const shown = Array.from({ length: Math.max(0, last - first) }, (_, offset) => first + offset);
  // The row being renamed keeps its box (and what was typed) when it scrolls away.
  if (renameIndex >= 0 && (renameIndex < first || renameIndex >= last)) shown.push(renameIndex);
  const listing = tree.viewRoot ? tree.dirs[tree.viewRoot] : null;

  return (
    <PanelFrame id={id} label="Arquivos" title={tree.viewRoot ?? "Arquivos"}>
      {!root && !tree.viewRoot ? (
        <div className="flex h-full flex-col items-start gap-1 p-2 text-hud-text/55">
          <span>Nenhuma pasta aberta.</span>
          <button type="button" onClick={() => void store.pickFolder()} className="cursor-pointer text-hud-cyan outline-none hover:text-hud-light focus-visible:text-hud-light">
            [Ctrl+O] abrir pasta
          </button>
        </div>
      ) : (
        <div
          ref={list}
          role="tree"
          aria-label="Arquivos do projeto"
          aria-activedescendant={current ? `tree-${cursor}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
          onContextMenu={(event) => onContextMenu(event, null)}
          data-testid="ide-tree"
          className="absolute inset-0 overflow-auto py-px text-[12px] leading-[18px] outline-none [scrollbar-color:var(--color-hud-light)_transparent] [scrollbar-width:thin]"
        >
          {listing?.error && <div className="px-2 text-hud-alert">{listing.error}</div>}
          <div style={{ height: rows.length * ROW, position: "relative" }}>
            {shown.map((index) => {
              const row = rows[index];
              const selected = index === cursor;
              const editing = index === renameIndex && row.kind === "entry";
              const mark = row.kind === "entry" ? (row.entry.kind === "dir" ? (marks.dirs.has(row.path.toLowerCase()) ? "M" : null) : (marks.files.get(row.path.toLowerCase()) ?? null)) : null;
              const ignored = row.kind === "entry" && row.entry.ignored;
              const color = editing
                ? "bg-hud-light/20 text-hud-text"
                : selected && focused
                  ? "bg-hud-light/85 text-hud-void"
                  : `${selected ? "bg-hud-light/20" : ""} ${mark ? GIT_COLOR[mark] : ignored ? "text-hud-text/35" : row.kind === "entry" && row.entry.kind === "dir" ? "text-hud-cyan" : "text-hud-text/85"}`;
              return (
                <div
                  key={row.key}
                  id={`tree-${index}`}
                  role="treeitem"
                  aria-level={row.kind === "entry" ? row.depth + 1 : 1}
                  aria-selected={selected}
                  aria-expanded={row.kind === "entry" && row.entry.kind === "dir" ? row.expanded : undefined}
                  aria-label={row.kind === "up" ? ".." : row.entry.name}
                  data-git={mark ?? undefined}
                  onClick={(event) => onRowClick(event, index)}
                  onContextMenu={(event) => onContextMenu(event, index)}
                  className={`absolute inset-x-0 flex cursor-pointer items-center truncate pr-2 whitespace-pre select-none ${color}`}
                  style={{ top: index * ROW, height: ROW, paddingLeft: 4 + (row.kind === "entry" ? row.depth : 0) * 14 }}
                >
                  {row.kind === "up" ? (
                    <span>↑ ..</span>
                  ) : editing ? (
                    <>
                      <span className="shrink-0">{row.entry.kind === "dir" ? `${row.loading ? "…" : row.expanded ? "▼" : "▶"} /` : "  "}</span>
                      <RenameInput name={row.entry.name} isDir={row.entry.kind === "dir"} onRename={(name, fromKey) => finishRename(row.path, name, fromKey)} onCancel={cancelRename} />
                    </>
                  ) : row.entry.kind === "dir" ? (
                    <span>
                      {row.loading ? "… " : row.expanded ? "▼ " : "▶ "}/{row.entry.name}
                      {row.entry.link && " ↗"}
                    </span>
                  ) : (
                    <span>
                      {"  "}
                      {row.entry.name}
                      {row.entry.link && " ↗"}
                      {store.isBookmarked(row.path) && <span className="text-hud-amber"> ★</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {menu && (
        <MenuPopup
          at={menu}
          label="Ações do arquivo"
          sections={menuSections(menu.path)}
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

/**
 * A row's name as a text box (F2, a double click, "Renomear"), as in Explorer: selected up to the extension; Enter
 * renames, Esc gives up, clicking elsewhere keeps what was typed.
 */
function RenameInput({ name, isDir, onRename, onCancel }: { name: string; isDir: boolean; onRename: (name: string, fromKey: boolean) => Promise<boolean>; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  /** Answered already (Enter, Esc): the blur that follows is not another answer. */
  const settled = useRef(false);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const dot = isDir ? -1 : name.lastIndexOf(".");
    element.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [name, isDir]);

  const onKeyDown = (event: KeyboardEvent) => {
    // The tree's keys (letters jump, Delete, F2…) stay out of the box.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      settled.current = true;
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (settled.current) return;
      settled.current = true;
      void onRename(value, true).then((done) => {
        if (done) return;
        settled.current = false;
        input.current?.focus();
      });
    }
  };

  return (
    <input
      ref={input}
      aria-label={`Novo nome de ${name}`}
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (settled.current) return;
        settled.current = true;
        void onRename(value, false);
      }}
      // Clicks in the box place the caret instead of opening the row.
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="h-[16px] min-w-0 flex-1 border border-hud-light/70 bg-hud-void px-0.5 text-hud-text outline-none select-text"
    />
  );
}
