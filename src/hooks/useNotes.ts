import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assistantFolder } from "../lib/assistant";
import { isNoteFile, NEW_FOLDER, noteFileName, noteFolder, noteTitle, untitledName, type Note } from "../lib/notesArea";
import { samePath } from "../lib/paths";
import { loadWorkspaceBackend, type DirEntry, type Encoding, type Eol, type Stamp, type WorkspaceBackend } from "../lib/workspace";

/** Notes read at once while the list fills in. */
const READ_AT_ONCE = 4;
/** Folders listed, at most (the notes folder and what is under it). */
const MAX_FOLDERS = 200;

export type NotesStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

/** A note open in the editor: its text and what its file looked like when read. */
export interface NoteDocument {
  path: string;
  contents: string;
  encoding: Encoding;
  eol: Eol;
  stamp: Stamp;
}

export type RenameResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * `Documentos\JARVIS\Notas` as the chat's notes area sees it: the Markdown files in it and in
 * its folders, newest first, their text read in the background, and the folder watched so what JARVIS (or
 * anything else) writes shows up. Everything goes through the workspace commands, rooted there.
 * Nothing happens until `enabled` (the section is open).
 */
export function useNotes(enabled: boolean) {
  const [status, setStatus] = useState<NotesStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  /** Every folder under the notes folder (relative, with "/"), empty ones too. */
  const [folders, setFolders] = useState<string[]>([]);
  const known = useRef(folders);
  known.current = folders;
  /** The notes folder (absolute), once it is open. */
  const [folder, setFolder] = useState<string | null>(null);
  const session = useRef<{ backend: WorkspaceBackend; root: string } | null>(null);
  const latest = useRef(notes);
  latest.current = notes;
  /** Bumped by every listing: an older one that ends later is dropped. */
  const generation = useRef(0);

  /** Lists the folder again; `changed` paths (null: all of them) are read again. */
  const refresh = useCallback(async (changed: string[] | null = []) => {
    const current = session.current;
    if (!current) return;
    const { backend, root } = current;
    const turn = ++generation.current;
    // The folder and every folder under it, a level at a time.
    const files: DirEntry[] = [];
    const dirs: string[] = [];
    const queue = [""];
    for (let dir = queue.shift(); dir !== undefined && dirs.length <= MAX_FOLDERS; dir = queue.shift()) {
      const listing = await backend.list(root, dir);
      if (turn !== generation.current || session.current !== current) return;
      for (const entry of listing.entries) {
        if (entry.hidden) continue;
        if (entry.kind === "dir") {
          dirs.push(entry.path);
          queue.push(entry.path);
        } else if (isNoteFile(entry.name)) files.push(entry);
      }
    }
    setFolders(dirs.sort());
    const before = new Map(latest.current.map((note) => [note.path, note]));
    const next: Note[] = files
      .map((entry) => {
        const known = before.get(entry.path);
        // The same file as before keeps its text; a touched one is read again.
        const same = known && known.modified === entry.modified && known.size === entry.size && changed !== null && !changed.includes(entry.path);
        return same ? known : { path: entry.path, title: noteTitle(entry.path), modified: entry.modified, size: entry.size, content: null };
      })
      .sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
    setNotes(next);
    setStatus("ready");
    // The texts, for the excerpts and the search: a few at a time.
    const pending = next.filter((note) => note.content === null && !note.unreadable).map((note) => note.path);
    for (let index = 0; index < pending.length; index += READ_AT_ONCE) {
      const batch = pending.slice(index, index + READ_AT_ONCE);
      const read = await Promise.all(
        batch.map((path) =>
          backend.read(root, path).then(
            (file) => [path, file.kind === "text" ? file.contents : null] as const,
            () => [path, null] as const,
          ),
        ),
      );
      if (turn !== generation.current || session.current !== current) return;
      const texts = new Map(read);
      setNotes((list) =>
        list.map((note) => {
          if (!texts.has(note.path)) return note;
          const content = texts.get(note.path) ?? null;
          return content === null ? { ...note, unreadable: true } : { ...note, content };
        }),
      );
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void (async () => {
      const [place, backend] = await Promise.all([assistantFolder(), loadWorkspaceBackend()]);
      if (cancelled) return;
      if (!place || !backend) return setStatus("unavailable");
      try {
        const info = await backend.open(place.notes);
        if (cancelled) return void backend.close(info.root).catch(() => undefined);
        session.current = { backend, root: info.root };
        setFolder(info.root);
        stop = backend.onChanged((event) => {
          if (!samePath(event.root, info.root)) return;
          void refresh(event.rescan ? null : event.changes.map((change) => change.path)).catch(() => undefined);
        });
        await refresh(null);
      } catch (failure) {
        if (cancelled) return;
        setError(String(failure));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
      const current = session.current;
      session.current = null;
      generation.current++;
      if (current) void current.backend.close(current.root).catch(() => undefined);
    };
  }, [enabled, refresh]);

  /** A note's text and how its file is written; null when it is not text that can be edited here. */
  const read = useCallback(async (path: string): Promise<NoteDocument | null> => {
    const current = session.current;
    if (!current) return null;
    const file = await current.backend.read(current.root, path);
    return file.kind === "text" ? { path, contents: file.contents, encoding: file.encoding, eol: file.eol, stamp: file.stamp } : null;
  }, []);

  /**
   * Writes a note as its file is (encoding, line breaks). Rejects with "file-changed" when the
   * file is no longer at `expected`; null writes over whatever is there.
   */
  const save = useCallback(async (document: Pick<NoteDocument, "path" | "encoding" | "eol">, contents: string, expected: Stamp | null) => {
    const current = session.current;
    if (!current) throw new Error("Disponível no app desktop");
    const stamp = await current.backend.write(current.root, document.path, contents, document.encoding, document.eol, expected);
    // The list follows at once (the watcher's own news will find nothing new).
    setNotes((list) =>
      list
        .map((note) => (note.path === document.path ? { ...note, content: contents, modified: stamp.modified, size: stamp.size, unreadable: undefined } : note))
        .sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title)),
    );
    return stamp;
  }, []);

  /**
   * "Nova nota": an empty "Sem título" (2, 3…), or a note with the given name (a link to a note
   * not written yet); a name some note already has is that note. Returns its path.
   */
  const create = useCallback(
    async (name?: string, folder = "") => {
      const current = session.current;
      if (!current) throw new Error("Disponível no app desktop");
      const beside = latest.current.filter((note) => noteFolder(note.path) === folder).map((note) => note.title);
      const path = `${folder ? `${folder}/` : ""}${name ?? untitledName(beside)}.md`;
      const existing = latest.current.find((note) => note.path.toLowerCase() === path.toLowerCase());
      if (existing) return existing.path;
      await current.backend.create(current.root, path, false);
      await refresh([path]);
      return path;
    },
    [refresh],
  );

  /** The note's file takes the title's name. */
  const rename = useCallback(
    async (path: string, title: string): Promise<RenameResult> => {
      const current = session.current;
      if (!current) return { ok: false, reason: "Disponível no app desktop" };
      const name = noteFileName(title);
      if (!name) return { ok: false, reason: "Dê um nome à nota" };
      // It stays in its folder.
      const folder = noteFolder(path);
      const target = `${folder ? `${folder}/` : ""}${name}.md`;
      if (target === path) return { ok: true, path };
      // Windows names do not tell cases apart; changing only the case of this one is fine.
      const taken = latest.current.some((note) => note.path !== path && note.path.toLowerCase() === target.toLowerCase());
      if (taken) return { ok: false, reason: "Já existe uma nota com esse nome" };
      try {
        await current.backend.rename(current.root, path, target);
      } catch (failure) {
        return { ok: false, reason: String(failure) };
      }
      await refresh([target]);
      return { ok: true, path: target };
    },
    [refresh],
  );

  /** "Nova pasta" (2, 3…) in a folder ("" is the notes folder). Returns its path. */
  const createFolder = useCallback(
    async (parent = "") => {
      const current = session.current;
      if (!current) throw new Error("Disponível no app desktop");
      const beside = known.current.filter((folder) => noteFolder(folder) === parent).map((folder) => folder.slice(parent ? parent.length + 1 : 0));
      const path = `${parent ? `${parent}/` : ""}${untitledName(beside, NEW_FOLDER)}`;
      await current.backend.create(current.root, path, true);
      await refresh();
      return path;
    },
    [refresh],
  );

  /** A folder takes another name, where it is; its notes go with it. */
  const renameFolder = useCallback(
    async (path: string, title: string): Promise<RenameResult> => {
      const current = session.current;
      if (!current) return { ok: false, reason: "Disponível no app desktop" };
      const name = noteFileName(title);
      if (!name) return { ok: false, reason: "Dê um nome à pasta" };
      const parent = noteFolder(path);
      const target = `${parent ? `${parent}/` : ""}${name}`;
      if (target === path) return { ok: true, path };
      if (known.current.some((folder) => folder !== path && folder.toLowerCase() === target.toLowerCase())) return { ok: false, reason: "Já existe uma pasta com esse nome" };
      try {
        await current.backend.rename(current.root, path, target);
      } catch (failure) {
        return { ok: false, reason: String(failure) };
      }
      await refresh(null);
      return { ok: true, path: target };
    },
    [refresh],
  );

  /** To the Recycle Bin (a folder goes with what is in it). */
  const remove = useCallback(
    async (path: string) => {
      const current = session.current;
      if (!current) throw new Error("Disponível no app desktop");
      await current.backend.remove(current.root, [path], false);
      await refresh();
    },
    [refresh],
  );

  /** The folder read again, every note with it. */
  const reload = useCallback(() => refresh(null), [refresh]);

  /** Shown in the system's file manager, selected. */
  const reveal = useCallback(async (path: string) => {
    const current = session.current;
    if (!current) throw new Error("Disponível no app desktop");
    await current.backend.reveal(current.root, path);
  }, []);

  return useMemo(
    () => ({ status, error, notes, folders, folder, read, save, create, rename, remove, reveal, reload, createFolder, renameFolder }),
    [status, error, notes, folders, folder, read, save, create, rename, remove, reveal, reload, createFolder, renameFolder],
  );
}

export type Notes = ReturnType<typeof useNotes>;
