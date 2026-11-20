import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CopyMinus, FilePlus, FolderOpen, FolderPlus, Pencil, RotateCw, Search, Trash2, Waypoints } from "lucide-react";
import type { Notes } from "../../hooks/useNotes";
import { noteFolder, noteRows, TITLE_LENGTH } from "../../lib/notesArea";

interface NotesListProps {
  notes: Notes;
  /** The note open in the editor. */
  path: string | null;
  onOpen: (path: string) => void;
  /** "Nova nota", in a folder ("" is the notes folder itself). */
  onCreate: (folder: string) => void;
  /**
   * A note or a folder went somewhere else (`to`: renamed, moved) or is gone (`to` null, a folder
   * deleted): what is open follows it.
   */
  onMoved: (from: string, to: string | null) => void;
  /** The search, kept outside: a tag clicked in a note or in the graph fills it. */
  query: string;
  onQuery: (query: string) => void;
  /** The folders folded shut. */
  closed: string[];
  onClosed: (closed: string[]) => void;
  /** The graph is on screen instead of the editor. */
  graph: boolean;
  onGraph: (open: boolean) => void;
}

type Kind = "note" | "folder";
type Menu = { kind: Kind; path: string; x: number; y: number; confirming?: boolean };
/** A note held by the pointer: only once it has travelled is it being dragged (`over`: the folder it would land in, or null). */
type Drag = { path: string; title: string; x: number; y: number; over: string | null };

/** A press that travels less than this is a click on the note, not a drag. */
const DRAG_PX = 5;
const TOOL =
  "grid size-6 shrink-0 cursor-pointer place-items-center rounded text-hud-text/55 outline-none transition hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-35";
const MENU_ITEM = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-hud-light outline-none hover:bg-hud-light/8 focus-visible:bg-hud-light/8";
/** Off screen a row costs nothing to draw: with hundreds of notes the list weighed on every frame of the graph. */
const ROW = "[contain-intrinsic-size:auto_28px] [content-visibility:auto]";
const NAME_FIELD = "min-w-0 flex-1 rounded bg-chat-field px-1.5 py-0.5 text-[13px] text-hud-light ring-1 ring-hud-light/40 outline-none";

/**
 * The notes of `Documentos\JARVIS\Notas` as a code editor's explorer, in the manner of the
 * Origamid Next theme: an upper-case header with thin action icons, folders that fold with only a
 * chevron, each note marked by a short coloured dash, a search across all of it, and the
 * right-click menu of each. A note is dragged to another folder, and a note or a folder is renamed
 * where it is (the menu, or a double click).
 */
export function NotesList({ notes, path, onOpen, onCreate, onMoved, query, onQuery, closed, onClosed, graph, onGraph }: NotesListProps) {
  const rows = useMemo(() => noteRows(notes.notes, notes.folders, closed, query), [notes.notes, notes.folders, closed, query]);
  const ready = notes.status === "ready";
  const searching = query.trim() !== "";
  /** Where "Nova nota" and "Nova pasta" make theirs: beside the note that is open. */
  const here = path ? noteFolder(path) : "";
  const [menu, setMenu] = useState<Menu | null>(null);
  /** A note or a folder whose name is being typed. */
  const [naming, setNaming] = useState<{ kind: Kind; path: string; name: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The press a drag may come from, and the click to swallow once one has ended. */
  const held = useRef<{ path: string; title: string; x: number; y: number; dragging: boolean } | null>(null);
  const swallow = useRef(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only the menu closes: not the answer in progress, nor anything else Esc means.
      event.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  const fail = (error: unknown) => setProblem(error instanceof Error ? error.message : String(error));
  const openMenu = (event: React.MouseEvent<HTMLElement>, kind: Kind, target: string) => {
    event.preventDefault();
    setProblem(null);
    // From the keyboard (the menu key) there is no pointer: under the row.
    const box = event.currentTarget.getBoundingClientRect();
    const fromKeys = event.clientX === 0 && event.clientY === 0;
    setMenu({ kind, path: target, x: fromKeys ? box.left + 24 : event.clientX, y: fromKeys ? box.bottom - 4 : event.clientY });
  };
  const toggle = (folder: string) => onClosed(closed.includes(folder) ? closed.filter((item) => item !== folder) : [...closed, folder]);
  /** A folder and those it is in, open: what is made or put inside it shows. */
  const unfold = (folder: string) => onClosed(closed.filter((item) => item !== folder && !folder.startsWith(`${item}/`)));
  const newFolder = (parent: string) => {
    setProblem(null);
    if (parent) unfold(parent);
    void notes.createFolder(parent).then((made) => setNaming({ kind: "folder", path: made, name: made.split("/").pop() ?? made }), fail);
  };
  const startNaming = (kind: Kind, target: string) => {
    setProblem(null);
    const name = target.slice(target.lastIndexOf("/") + 1);
    setNaming({ kind, path: target, name: kind === "note" ? name.replace(/\.md$/i, "") : name });
  };
  const rename = () => {
    if (!naming) return;
    const { kind, path: from, name } = naming;
    setNaming(null);
    void (kind === "note" ? notes.rename(from, name) : notes.renameFolder(from, name)).then((result) => {
      if (!result.ok) return setProblem(result.reason);
      if (result.path === from) return;
      if (kind === "folder") onClosed(closed.map((item) => (item === from || item.startsWith(`${from}/`) ? result.path + item.slice(from.length) : item)));
      onMoved(from, result.path);
    }, fail);
  };
  /** The field a name is typed in: Enter or leaving it confirms, Esc gives up. */
  const nameField = (label: string) =>
    naming && (
      <input
        autoFocus
        aria-label={label}
        value={naming.name}
        maxLength={TITLE_LENGTH}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setNaming({ ...naming, name: event.target.value })}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setNaming(null);
        }}
        className={NAME_FIELD}
      />
    );

  // A note dragged to another folder, with the pointer (HTML's own drag and drop does not reach a
  // Tauri window on Windows). The folder under the pointer is the one of the row there.
  const folderAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;
  const drop = (from: string, folder: string) => {
    if (noteFolder(from) === folder) return;
    setProblem(null);
    void notes.move(from, folder).then((result) => {
      if (!result.ok) return setProblem(result.reason);
      if (folder) unfold(folder);
      onMoved(from, result.path);
    }, fail);
  };
  useEffect(() => {
    if (!drag) return;
    // Esc lets go of it, moving nothing.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      held.current = null;
      setDrag(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  return (
    <>
      <div className="mx-3 mb-1 flex h-7 items-center gap-1 pl-1.5">
        <h2 className="mr-auto text-[11px] font-medium tracking-[0.08em] text-hud-text/45 uppercase">Notas</h2>
        <button type="button" aria-label="Nova nota" title={here ? `Nova nota em ${here}` : "Nova nota"} disabled={!ready} onClick={() => onCreate(here)} className={TOOL}>
          <FilePlus size={15} strokeWidth={1.4} />
        </button>
        <button type="button" aria-label="Nova pasta" title={here ? `Nova pasta em ${here}` : "Nova pasta"} disabled={!ready} onClick={() => newFolder(here)} className={TOOL}>
          <FolderPlus size={15} strokeWidth={1.4} />
        </button>
        <button
          type="button"
          aria-label="Atualizar notas"
          title="Atualizar notas"
          disabled={!ready}
          onClick={() => {
            setProblem(null);
            void notes.reload().catch(fail);
          }}
          className={TOOL}
        >
          <RotateCw size={14} strokeWidth={1.4} />
        </button>
        <button type="button" aria-label="Recolher pastas" title="Recolher pastas" disabled={!ready || notes.folders.length === 0} onClick={() => onClosed([...notes.folders])} className={TOOL}>
          <CopyMinus size={14} strokeWidth={1.4} />
        </button>
      </div>
      <div className="mx-3 mb-2 flex items-center gap-1.5">
        <label className="relative block min-w-0 flex-1">
          <Search aria-hidden size={14} strokeWidth={1.8} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-hud-text/40" />
          <input type="search" aria-label="Buscar notas" placeholder="Buscar" value={query} onChange={(event) => onQuery(event.target.value)} className="chat-search" />
        </label>
        <button
          type="button"
          aria-label="Grafo"
          title="Grafo das notas"
          aria-pressed={graph}
          disabled={!ready}
          onClick={() => onGraph(!graph)}
          className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-35 ${
            graph ? "bg-hud-cyan/15 text-hud-light" : "text-hud-text/60 hover:bg-hud-cyan/10 hover:text-hud-light"
          }`}
        >
          <Waypoints size={15} strokeWidth={1.7} />
        </button>
      </div>
      {/* The empty room of the list is the notes folder itself: a note let go there goes to the root. */}
      <ul data-testid="notes-list" data-drop="" data-over={drag?.over === "" || undefined} className={`hud-scroll flex-1 overflow-y-auto px-2 pb-2 ${drag?.over === "" ? "bg-hud-light/[0.03]" : ""}`}>
        {problem && (
          <li role="alert" className="px-3 py-2 text-[12px] text-hud-alert">
            {problem}
          </li>
        )}
        {rows.map((row) => {
          const indent = 8 + row.depth * 14;
          if (row.kind === "folder") {
            // The folder a note let go here lands in; lit while one is over it or over anything in it.
            const over = drag?.over != null && drag.over !== "" && (drag.over === row.path || row.path.startsWith(`${drag.over}/`));
            return (
              <li
                key={`d:${row.path}`}
                data-testid="note-folder"
                data-path={row.path}
                data-drop={row.path}
                data-open={row.open || undefined}
                data-over={drag?.over === row.path || undefined}
                onContextMenu={(event) => openMenu(event, "folder", row.path)}
                className={`${ROW} ${over ? "bg-hud-cyan/10" : ""}`}
              >
                {naming?.kind === "folder" && naming.path === row.path ? (
                  <form
                    style={{ paddingLeft: indent }}
                    className="flex h-7 items-center gap-1.5 pr-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      rename();
                    }}
                  >
                    <ChevronRight aria-hidden size={15} strokeWidth={1.6} className="shrink-0 text-hud-text/45" />
                    {nameField("Nome da pasta")}
                  </form>
                ) : (
                  <button
                    type="button"
                    style={{ paddingLeft: indent }}
                    aria-expanded={row.open}
                    onClick={() => toggle(row.path)}
                    onDoubleClick={() => startNaming("folder", row.path)}
                    className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 text-left outline-none hover:bg-hud-light/5 focus-visible:ring-1 focus-visible:ring-hud-light/50"
                  >
                    <ChevronRight aria-hidden size={15} strokeWidth={1.6} className={`shrink-0 text-hud-text/60 transition-transform ${row.open ? "rotate-90" : ""}`} />
                    <span data-folder-name className="truncate text-[14px] text-hud-text/70">
                      {row.name}
                    </span>
                  </button>
                )}
              </li>
            );
          }
          const { note } = row;
          const active = note.path === path;
          const folder = noteFolder(note.path);
          const over = drag?.over != null && drag.over !== "" && (folder === drag.over || folder.startsWith(`${drag.over}/`));
          return (
            <li
              key={`n:${note.path}`}
              data-testid="note-item"
              data-path={note.path}
              data-drop={searching ? undefined : folder}
              data-active={active || undefined}
              data-dragged={drag?.path === note.path || undefined}
              onContextMenu={(event) => openMenu(event, "note", note.path)}
              className={`${ROW} ${over ? "bg-hud-cyan/10" : ""} ${drag?.path === note.path ? "opacity-45" : ""}`}
            >
              {naming?.kind === "note" && naming.path === note.path ? (
                <form
                  style={{ paddingLeft: indent + 4 }}
                  className="flex h-7 items-center gap-1.5 pr-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    rename();
                  }}
                >
                  <span aria-hidden className="mr-1 h-[3px] w-2 shrink-0 rounded-[1px] bg-hud-cyan" />
                  {nameField("Nome da nota")}
                </form>
              ) : (
                <button
                  type="button"
                  style={{ paddingLeft: indent + 4 }}
                  aria-current={active ? "true" : undefined}
                  title={note.path}
                  onClick={() => {
                    // The click that ends a drag opens nothing.
                    if (swallow.current) return void (swallow.current = false);
                    onOpen(note.path);
                  }}
                  onDoubleClick={() => startNaming("note", note.path)}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || searching || !ready) return;
                    swallow.current = false;
                    held.current = { path: note.path, title: note.title, x: event.clientX, y: event.clientY, dragging: false };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const press = held.current;
                    if (!press) return;
                    if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
                    press.dragging = true;
                    setDrag({ path: press.path, title: press.title, x: event.clientX, y: event.clientY, over: folderAt(event.clientX, event.clientY) });
                  }}
                  onPointerUp={(event) => {
                    const press = held.current;
                    held.current = null;
                    if (!press?.dragging) return;
                    swallow.current = true;
                    setDrag(null);
                    const target = folderAt(event.clientX, event.clientY);
                    if (target !== null) drop(press.path, target);
                  }}
                  onPointerCancel={() => {
                    held.current = null;
                    setDrag(null);
                  }}
                  className={`flex h-7 w-full cursor-pointer touch-none items-center gap-1.5 rounded-md pr-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-hud-light/50 ${active ? "bg-chat-active" : "hover:bg-hud-light/5"}`}
                >
                  {/* The file's mark: a short dash in the colour of its kind (Markdown, here). */}
                  <span aria-hidden data-note-mark className={`mr-1 h-[3px] w-2 shrink-0 rounded-[1px] ${active ? "bg-hud-light" : "bg-hud-cyan"}`} />
                  <span data-note-title className={`truncate text-[14px] ${active ? "text-hud-light" : "text-hud-text/80"}`}>
                    {note.title}
                  </span>
                  {searching && folder && (
                    <span data-note-folder className={`ml-auto max-w-[45%] shrink-0 truncate pl-2 text-[11px] ${active ? "text-hud-light/70" : "text-hud-text/40"}`}>
                      {folder}
                    </span>
                  )}
                </button>
              )}
            </li>
          );
        })}
        {notes.status === "loading" && <li className="px-3 py-6 text-center text-[12px] text-hud-text/40">Carregando notas…</li>}
        {notes.status === "unavailable" && <li className="px-3 py-6 text-center text-[12px] text-hud-text/40">Disponível no app desktop</li>}
        {notes.status === "error" && <li className="px-3 py-6 text-center text-[12px] text-hud-alert">{notes.error}</li>}
        {ready && rows.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-hud-text/40">{searching ? "Nenhuma nota encontrada" : "Nenhuma nota ainda"}</li>}
      </ul>
      {/* What is being dragged, by the pointer. */}
      {drag && (
        <div
          aria-hidden
          data-testid="note-drag"
          style={{ left: drag.x + 12, top: drag.y + 10 }}
          className="pointer-events-none fixed z-50 flex max-w-[220px] items-center gap-1.5 rounded-md border border-hud-line/50 bg-hud-panel px-2 py-1 text-[13px] text-hud-light shadow-xl"
        >
          <span className="h-[3px] w-2 shrink-0 rounded-[1px] bg-hud-cyan" />
          <span className="truncate">{drag.title}</span>
        </div>
      )}
      {menu && (
        <div
          role="menu"
          aria-label={menu.kind === "folder" ? "Ações da pasta" : "Ações da nota"}
          data-testid="note-menu"
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: Math.min(menu.x, window.innerWidth - 216), top: Math.min(menu.y, window.innerHeight - (menu.kind === "folder" ? 190 : 90)) }}
          className="fixed z-50 w-52 rounded-xl border border-hud-line/50 bg-hud-panel p-1 shadow-xl"
        >
          {menu.kind === "folder" && (
            <>
              <button
                type="button"
                role="menuitem"
                autoFocus
                onClick={() => {
                  setMenu(null);
                  unfold(menu.path);
                  onCreate(menu.path);
                }}
                className={MENU_ITEM}
              >
                <FilePlus aria-hidden size={14} strokeWidth={1.8} className="text-hud-cyan" />
                Nova nota aqui
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  newFolder(menu.path);
                }}
                className={MENU_ITEM}
              >
                <FolderPlus aria-hidden size={14} strokeWidth={1.8} className="text-hud-cyan" />
                Nova pasta aqui
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            autoFocus={menu.kind === "note"}
            onClick={() => {
              setMenu(null);
              startNaming(menu.kind, menu.path);
            }}
            className={MENU_ITEM}
          >
            <Pencil aria-hidden size={14} strokeWidth={1.8} className="text-hud-cyan" />
            Renomear
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              void notes.reveal(menu.path).catch(fail);
            }}
            className={MENU_ITEM}
          >
            <FolderOpen aria-hidden size={14} strokeWidth={1.8} className="text-hud-cyan" />
            Abrir no Explorer
          </button>
          {menu.kind === "folder" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // Asked twice: a folder goes with all that is in it (to the Recycle Bin).
                if (!menu.confirming) return setMenu({ ...menu, confirming: true });
                setMenu(null);
                void notes.remove(menu.path).then(() => {
                  onClosed(closed.filter((item) => item !== menu.path && !item.startsWith(`${menu.path}/`)));
                  onMoved(menu.path, null);
                }, fail);
              }}
              className={`${MENU_ITEM} ${menu.confirming ? "text-hud-alert" : ""}`}
            >
              <Trash2 aria-hidden size={14} strokeWidth={1.8} className="text-hud-alert" />
              {menu.confirming ? "Sim, apagar a pasta" : "Apagar pasta"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
