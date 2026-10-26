import type { Branch, Commit, GitStatus, Stash } from "../../../../lib/git";
import type { DirEntry, Disk, Encoding, Eol, SearchMatch, Stamp, WorkspaceInfo } from "../../../../lib/workspace";

export type PanelKind = "editor" | "files" | "git" | "outline" | "search" | "terminal";

export interface PanelSlot {
  /** The kind for the single panels; "term-N" for terminals. */
  id: string;
  kind: PanelKind;
  /** Share of the column's height, 0..1. */
  size: number;
  /** Terminals: the Windows Terminal profile. */
  profile?: string;
}

export interface ColumnSlot {
  id: string;
  /** Share of the width, 0..1. */
  size: number;
  panels: PanelSlot[];
}

export interface IdeLayout {
  version: 1;
  columns: ColumnSlot[];
  /** The panel with the keyboard. */
  focus: string | null;
  /** One panel filling the whole IDE (the others stay mounted, hidden). */
  zoom: string | null;
}

export type BufferView = "unloaded" | "loading" | "text" | "binary" | "large" | "error";

/** An open tab. Its text lives in the store's runtime (an EditorState), not here. */
export interface BufferMeta {
  /** The absolute path for files; "untitled:N"; "virtual:…" for read-only views (diff, log). */
  id: string;
  kind: "file" | "untitled" | "virtual";
  path: string | null;
  title: string;
  view: BufferView;
  /** Why it is not editable (binary, too large, error). */
  message?: string;
  /** Language picked by hand (a LanguageDescription name); null = from the file name. */
  language: string | null;
  /** What the highlighter uses, for the status bar ("Python", or null = plain text). */
  highlight: string | null;
  encoding: Encoding;
  eol: Eol;
  mixedEol: boolean;
  tabSize: number;
  useTabs: boolean;
  readOnly: boolean;
  dirty: boolean;
  /** Opened with a single click: the next single click replaces it. */
  preview: boolean;
  saving: boolean;
  stamp: Stamp | null;
  /** "changed": the file moved on disk under unsaved edits (conflict); "deleted": it is gone. */
  disk: "ok" | "changed" | "deleted";
  size: number;
}

export interface DirState {
  entries: DirEntry[] | null;
  loading: boolean;
  error: string | null;
}

export interface TreeState {
  /** The folder at the top of the file manager (".." walks above the project). */
  viewRoot: string | null;
  /** Listings by absolute folder path. */
  dirs: Record<string, DirState>;
  expanded: string[];
  /** Absolute path of the row under the cursor. */
  selected: string | null;
}

export interface IdePrefs {
  wrap: boolean;
  fontSize: 12 | 13 | 14 | 15;
  /** Indentation of new files and files without any. */
  defaultTab: 2 | 4 | 8;
  showHidden: boolean;
  hideIgnored: boolean;
  /** Glow and colour fringes on the editor's text (the window's TUI effects). */
  effects: boolean;
  /** Saves a second after the last edit. */
  autoSave: boolean;
  blockCursor: boolean;
}

export interface Bookmark {
  path: string;
  dir: boolean;
}

export interface Notice {
  id: number;
  text: string;
  tone: "info" | "error";
}

/** The minibuffer above the status bar: a question with an input or with lettered choices. */
export type Prompt =
  | { kind: "input"; label: string; value: string; submit: (value: string) => void | Promise<void> }
  | { kind: "confirm"; label: string; choices: { key: string; label: string; run: () => void | Promise<void> }[] };

export interface ProjectSession {
  tabs: { path: string; pinned: boolean }[];
  active: string | null;
  cursors: Record<string, { anchor: number; head: number }>;
  expanded: string[];
  viewRoot: string | null;
  /** Files opened lately, newest first (quick open lists them first). */
  mru: string[];
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
}

export interface SearchState {
  options: SearchOptions;
  running: boolean;
  /** Matches grouped by file (absolute path), in arrival order. */
  results: { path: string; rel: string; matches: SearchMatch[] }[];
  total: number;
  files: number;
  truncated: boolean;
  error: string | null;
  /** The match the cursor is on: [file index, match index]. */
  cursor: [number, number] | null;
}

export interface GitState {
  status: GitStatus | null;
  loading: boolean;
  error: string | null;
  branches: Branch[];
  stashes: Stash[];
  /** The command running ("push", "commit"…), for the buttons. */
  busy: string | null;
  log: Commit[];
}

export type PaletteMode = "files" | "commands" | "line" | "symbols" | "language";

export interface IdeState {
  root: string | null;
  info: WorkspaceInfo | null;
  recent: string[];
  bookmarks: Bookmark[];
  prefs: IdePrefs;
  layout: IdeLayout;
  tree: TreeState;
  buffers: BufferMeta[];
  active: string | null;
  /** Paths of closed tabs, newest first (Ctrl+Shift+T). */
  closed: string[];
  notice: Notice | null;
  prompt: Prompt | null;
  /** Changes with every new question, so the minibuffer starts afresh. */
  promptKey: number;
  palette: { mode: PaletteMode; query: string } | null;
  search: SearchState;
  git: GitState;
  disk: Disk | null;
  /** Terminal profiles (Windows Terminal), loaded on first use. */
  profiles: { id: string; name: string }[];
  defaultProfile: string | null;
}
