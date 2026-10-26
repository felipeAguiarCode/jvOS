import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { tauriGit, type GitBackend } from "./git";

/**
 * Mirrors src-tauri/src/workspace: a folder on disk as jv_ide sees it. Every call names a folder
 * (`root`, absolute) and a path inside it (relative, "/"); the backend refuses anything that
 * would leave the folder.
 */

export type Encoding = "utf8" | "utf8bom" | "utf16le" | "utf16be" | "windows1252";
export type Eol = "lf" | "crlf";

/** What a file looked like when last read or written: a save over a different stamp is a conflict. */
export interface Stamp {
  size: number;
  /** Milliseconds since the epoch. */
  modified: number;
}

export interface DirEntry {
  name: string;
  /** Relative to the listed root, with "/". */
  path: string;
  kind: "file" | "dir";
  link: boolean;
  size: number;
  modified: number;
  /** Hidden attribute or a leading dot. */
  hidden: boolean;
  /** Matched by a .gitignore. */
  ignored: boolean;
  readonly: boolean;
}

export interface Listing {
  path: string;
  entries: DirEntry[];
  truncated: boolean;
}

/** Text always arrives with "\n" line breaks; `eol` is what the file uses on disk. */
export type FileContent =
  | { kind: "text"; contents: string; encoding: Encoding; eol: Eol; mixedEol: boolean; stamp: Stamp; readonly: boolean }
  | { kind: "binary"; stamp: Stamp }
  | { kind: "tooLarge"; stamp: Stamp; max: number };

export interface WorkspaceInfo {
  root: string;
  name: string;
  repo: { root: string; prefix: string } | null;
  watching: boolean;
}

export interface Disk {
  /** "C:" */
  name: string;
  used: number;
  total: number;
}

export interface Change {
  /** Relative to the event's root. */
  path: string;
  kind: "created" | "modified" | "removed";
}

/** `workspace:changed`, debounced by the backend. `rescan`: too much at once, refresh everything. */
export interface ChangedEvent {
  root: string;
  changes: Change[];
  /** Something under .git moved (a commit, a checkout…). */
  git: boolean;
  rescan: boolean;
}

export interface SearchQuery {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string[];
  exclude: string[];
  maxResults?: number;
}

export interface SearchMatch {
  path: string;
  /** 1-based. */
  line: number;
  /** In UTF-16 units, as CodeMirror counts. */
  column: number;
  length: number;
  preview: string;
  previewColumn: number;
}

export type SearchEvent =
  | { event: "matches"; id: number; matches: SearchMatch[] }
  | { event: "done"; id: number; files: number; total: number; truncated: boolean; cancelled: boolean; millis: number };

export interface WorkspaceBackend {
  /** The native folder picker; null when cancelled. */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** Starts watching the folder (and finds its repository). */
  open(path: string): Promise<WorkspaceInfo>;
  close(root: string): Promise<void>;
  list(root: string, path: string): Promise<Listing>;
  read(root: string, path: string): Promise<FileContent>;
  /** Fails with "file-changed" when the file is no longer at `expected`. */
  write(root: string, path: string, contents: string, encoding: Encoding, eol: Eol, expected: Stamp | null): Promise<Stamp>;
  stat(root: string, paths: string[]): Promise<(Stamp | null)[]>;
  create(root: string, path: string, dir: boolean): Promise<void>;
  rename(root: string, from: string, to: string): Promise<void>;
  /** The copy's path ("name (2).ext" when taken). */
  copy(root: string, from: string, to: string): Promise<string>;
  /** To the Recycle Bin unless `permanent`. */
  remove(root: string, paths: string[], permanent: boolean): Promise<void>;
  reveal(root: string, path: string): Promise<void>;
  disk(root: string): Promise<Disk | null>;
  files(root: string): Promise<{ files: string[]; truncated: boolean }>;
  /** Streams the matches; resolves with the search's id. A new search cancels the previous one. */
  search(root: string, query: SearchQuery, onEvent: (event: SearchEvent) => void): Promise<number>;
  cancelSearch(): Promise<void>;
  onChanged(listener: (event: ChangedEvent) => void): () => void;
  git: GitBackend;
}

declare global {
  interface Window {
    /**
     * Development only: an in-memory project instead of the disk (the Playwright checks).
     * `true` loads the demo projects.
     */
    __JARVIS_FS__?: true | object;
  }
}

/** The backend's error for a save over a file that changed on disk. */
export const FILE_CHANGED = "file-changed";

const tauriBackend: WorkspaceBackend = {
  pickFolder: async (defaultPath) => {
    const picked = await open({ directory: true, multiple: false, defaultPath, title: "Abrir pasta" });
    return typeof picked === "string" ? picked : null;
  },
  open: (path) => invoke("workspace_open", { path }),
  close: (root) => invoke("workspace_close", { root }),
  list: (root, path) => invoke("workspace_list", { root, path }),
  read: (root, path) => invoke("workspace_read", { root, path }),
  write: (root, path, contents, encoding, eol, expected) => invoke("workspace_write", { root, path, contents, encoding, eol, expected }),
  stat: (root, paths) => invoke("workspace_stat", { root, paths }),
  create: (root, path, dir) => invoke("workspace_create", { root, path, dir }),
  rename: (root, from, to) => invoke("workspace_rename", { root, from, to }),
  copy: (root, from, to) => invoke("workspace_copy", { root, from, to }),
  remove: (root, paths, permanent) => invoke("workspace_delete", { root, paths, permanent }),
  reveal: (root, path) => invoke("workspace_reveal", { root, path }),
  disk: (root) => invoke("workspace_disk", { root }),
  files: (root) => invoke("workspace_files", { root }),
  search: (root, query, onEvent) => {
    const channel = new Channel<SearchEvent>();
    channel.onmessage = onEvent;
    return invoke("workspace_search", { root, query, onEvent: channel });
  },
  cancelSearch: () => invoke("workspace_search_cancel"),
  onChanged: (listener) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    void listen<ChangedEvent>("workspace:changed", (event) => listener(event.payload)).then((unlisten) => {
      if (stopped) unlisten();
      else stop = unlisten;
    });
    return () => {
      stopped = true;
      stop?.();
    };
  },
  git: tauriGit,
};

let fake: Promise<WorkspaceBackend> | null = null;

/** The desktop app's disk, the development fake, or null in a plain browser. */
export async function loadWorkspaceBackend(): Promise<WorkspaceBackend | null> {
  if (import.meta.env.DEV && window.__JARVIS_FS__) {
    fake ??= import("./workspaceFake").then((module) => module.createFakeWorkspace(window.__JARVIS_FS__!));
    return fake;
  }
  return isTauri() ? tauriBackend : null;
}

/** Display names of the encodings, as the status bar shows them. */
export const ENCODING_LABELS: Record<Encoding, string> = {
  utf8: "UTF-8",
  utf8bom: "UTF-8 BOM",
  utf16le: "UTF-16 LE",
  utf16be: "UTF-16 BE",
  windows1252: "Windows-1252",
};
