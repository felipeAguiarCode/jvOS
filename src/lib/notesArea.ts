import { normalize } from "./search";
import { useStoredState } from "./storage";

/** Área de notas (feature notes-area). What it does and why: .specs/features/notes-area/spec.md. */

/** A note of `Documentos\JARVIS\Notas`, as the list shows it. */
export interface Note {
  /** Relative to the notes folder: "2026-11-19 Fatura.md". */
  path: string;
  /** The file's name without ".md". */
  title: string;
  /** Milliseconds since the epoch. */
  modified: number;
  size: number;
  /** null until read, and for good when it cannot be (binary, too large). */
  content: string | null;
  /** Read and found not to be text that fits: listed, but not opened here. */
  unreadable?: boolean;
}

/** Autosave: this long after the last key. */
export const SAVE_DELAY_MS = 800;
export const TITLE_LENGTH = 80;
export const UNTITLED = "Sem título";
const EXCERPT_LENGTH = 80;

export const isNoteFile = (name: string) => /\.md$/i.test(name);

/** "2026-11-19 Fatura.md" → "2026-11-19 Fatura". */
export const noteTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/**
 * A title as a file name (without ".md"): what Windows refuses in a name goes, spaces are joined,
 * 80 characters at most, no dots or spaces at the end. null: nothing is left to name it.
 */
export function noteFileName(title: string): string | null {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_LENGTH)
    .replace(/[. ]+$/, "");
  return name || null;
}

/**
 * What the list shows under the title: the first line of text, without Markdown marks. Headings
 * are titles, so the text under them comes first; a note of headings only shows its first one,
 * unless that is the title again.
 */
export function noteExcerpt(content: string, title: string) {
  const wanted = normalize(title);
  let heading = "";
  for (const line of content.split("\n")) {
    const text = line
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
      .replace(/!?\[\[?([^\]|]*)[^\]]*\]\]?(\([^)]*\))?/g, "$1")
      .replace(/[*_~`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || /^[-=*_]{3,}$/.test(text)) continue;
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      if (!heading && normalize(text) !== wanted) heading = text;
      continue;
    }
    return text.slice(0, EXCERPT_LENGTH);
  }
  return heading.slice(0, EXCERPT_LENGTH);
}

/** The list's search: the title and the text, whatever the case or the accents. */
export function matchesNote(note: Pick<Note, "title" | "content">, query: string) {
  const wanted = normalize(query).trim();
  if (!wanted) return true;
  return normalize(note.title).includes(wanted) || (note.content !== null && normalize(note.content).includes(wanted));
}

/** "Sem título", then "Sem título 2", "Sem título 3"…: the first name none has (whatever the case). */
export function untitledName(titles: string[], base = UNTITLED) {
  const taken = new Set(titles.map((title) => title.toLowerCase()));
  for (let index = 1; ; index++) {
    const name = index === 1 ? base : `${base} ${index}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export const NEW_FOLDER = "Nova pasta";

/** A note made from an answer of the chat is named after its question, this long at most. */
const ANSWER_TITLE_LENGTH = 60;

/** The name of the note an answer is saved as: the question's first line, as a file name; one that is free. */
export function answerNoteName(question: string, titles: string[]) {
  const first = question.split("\n").find((line) => line.trim()) ?? "";
  const cut = first.trim().replace(/[?!.…:;,\s]+$/, "").slice(0, ANSWER_TITLE_LENGTH);
  return untitledName(titles, noteFileName(cut) ?? "Resposta do JARVIS");
}

/** A note with an answer at its end, a blank line after what was there. */
export function appendAnswer(contents: string, answer: string) {
  const before = contents.trimEnd();
  return `${before ? `${before}\n\n` : ""}${answer.trim()}\n`;
}

/** The folder a note (or a folder) is in, relative to the notes folder: "" right under it. */
export const noteFolder = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** A line of the notes list: a folder that folds, or a note. */
export type NoteRow = { kind: "folder"; path: string; name: string; depth: number; open: boolean } | { kind: "note"; note: Note; depth: number };

const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/**
 * The list as a code editor's explorer: at each level the folders, then the notes, by name;
 * what is inside a folded folder is left out. With a search, the notes found anywhere, flat.
 */
export function noteRows(notes: Note[], folders: string[], closed: string[], query: string): NoteRow[] {
  if (normalize(query).trim()) {
    return notes
      .filter((note) => matchesNote(note, query))
      .sort((a, b) => byName(a.title, b.title) || byName(a.path, b.path))
      .map((note) => ({ kind: "note", note, depth: 0 }));
  }
  // Every folder, and those only known by a note in them.
  const all = new Set(folders);
  for (const note of notes) for (let folder = noteFolder(note.path); folder; folder = noteFolder(folder)) all.add(folder);
  const shut = new Set(closed);
  const rows: NoteRow[] = [];
  const walk = (parent: string, depth: number) => {
    const inside = [...all].filter((folder) => noteFolder(folder) === parent).sort(byName);
    for (const folder of inside) {
      const open = !shut.has(folder);
      rows.push({ kind: "folder", path: folder, name: folder.slice(parent ? parent.length + 1 : 0), depth, open });
      if (open) walk(folder, depth + 1);
    }
    const here = notes.filter((note) => noteFolder(note.path) === parent).sort((a, b) => byName(a.title, b.title));
    for (const note of here) rows.push({ kind: "note", note, depth });
  };
  walk("", 0);
  return rows;
}

/** How a note is shown: only the editor, the editor and the rendered note, or only the rendered note. */
export type NoteView = "write" | "split" | "read";
export const NOTE_VIEWS: { view: NoteView; label: string }[] = [
  { view: "write", label: "Escrever" },
  { view: "split", label: "Dividir" },
  { view: "read", label: "Ler" },
];

/** The feature's preferences (`jarvis.notesArea`). */
export interface NotesAreaPrefs {
  view: NoteView;
  /** The folders folded shut in the list (relative paths, with "/"). */
  closed: string[];
}

const DEFAULT_NOTES_AREA: NotesAreaPrefs = { view: "split", closed: [] };
/** Folded folders kept, at most. */
const MAX_CLOSED = 200;

/** Tolerant: a bad field takes its default; anything but an object is null. */
export function parseNotesArea(raw: unknown): NotesAreaPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { view, closed } = raw as Record<string, unknown>;
  return {
    view: NOTE_VIEWS.some((item) => item.view === view) ? (view as NoteView) : DEFAULT_NOTES_AREA.view,
    closed: Array.isArray(closed) ? [...new Set(closed.filter((item): item is string => typeof item === "string" && item !== ""))].slice(0, MAX_CLOSED) : [],
  };
}

export function useNotesAreaPrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.notesArea", DEFAULT_NOTES_AREA, parseNotesArea);
  return [prefs, setPrefs] as const;
}
