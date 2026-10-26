import { LanguageDescription } from "@codemirror/language";
import { EditorSelection, EditorState, Text, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { GitChange } from "../../../../lib/git";
import { baseName, dirName, isInside, joinPath, relativePath, samePath } from "../../../../lib/paths";
import { loadProfiles } from "../../../../lib/terminal";
import { ENCODING_LABELS, FILE_CHANGED, type ChangedEvent, type Encoding, type Eol, type FileContent, type SearchEvent, type WorkspaceBackend } from "../../../../lib/workspace";
import {
  bufferExtensions,
  bufferId,
  cursorOf,
  detectIndent,
  idSlot,
  indentExtension,
  indentSlot,
  languageSlot,
  minimalChange,
  prefsExtension,
  prefsSlot,
  type CursorInfo,
} from "./editorRuntime";
import { formatDateTime, formatTime } from "./format";
import { describe, DIFF } from "./languages";
import { closePanel, DEFAULT_LAYOUT, findPanel, hasKind, nextTerminalId, openPanel, orderedPanels, panelsOf } from "./layout";
import {
  EMPTY_IDE,
  MAX_BOOKMARKS,
  MAX_DRAFT,
  MAX_DRAFTS,
  MAX_RECENT,
  readDrafts,
  readIde,
  takeOldCodeDraft,
  writeDrafts,
  writeIde,
  type Draft,
  type PersistedIde,
} from "./persist";
import type { BufferMeta, GitState, IdeLayout, IdePrefs, IdeState, PaletteMode, PanelKind, Prompt, ProjectSession, SearchOptions, SearchState } from "./types";

/** A tiny observable value for `useSyncExternalStore` (the cursor, the edit counter). */
export class ValueStore<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set(value: T) {
    if (Object.is(value, this.value)) return;
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

interface BufferRuntime {
  state: EditorState | null;
  /** The text on disk (as last read or written); null for untitled tabs. */
  saved: Text | null;
  savedEol: Eol;
  savedEncoding: Encoding;
  /** Scroll position while the tab is in the background. */
  scroll: StateEffect<unknown> | null;
  loading: Promise<void> | null;
  autoSave: number;
}

interface OpenOptions {
  /** Single click: replaces the previous preview tab. */
  preview?: boolean;
  focus?: boolean;
  line?: number;
  column?: number;
  /** Selects this many characters from `column` (a search match). */
  length?: number;
}

const NOTICE_MS = 4000;
const PERSIST_MS = 400;
const DRAFTS_MS = 1000;
const AUTOSAVE_MS = 1000;
const GIT_REFRESH_MS = 400;
const DIR_REFRESH_MS = 100;

const EMPTY_CURSOR: CursorInfo = { line: 1, col: 1, selected: 0, lines: 1 };

export const EMPTY_SEARCH_OPTIONS: SearchOptions = { query: "", regex: false, caseSensitive: false, wholeWord: false, include: "", exclude: "" };
const EMPTY_SEARCH: SearchState = { options: EMPTY_SEARCH_OPTIONS, running: false, results: [], total: 0, files: 0, truncated: false, error: null, cursor: null };
const EMPTY_GIT: GitState = { status: null, loading: false, error: null, branches: [], stashes: [], busy: null, log: [] };

const message = (error: unknown) => (typeof error === "string" ? error : error instanceof Error ? error.message : String(error));

/** Where a file is, as the backend wants it: its folder and its name. */
const where = (path: string) => ({ root: dirName(path), rel: baseName(path) });

/** All of jv_ide's state and what can be done to it. Components read it through `useIde`. */
export class IdeStore {
  state: IdeState;
  readonly cursor = new ValueStore<CursorInfo>(EMPTY_CURSOR);
  /** Bumped on every edit of the active tab (the outline listens). */
  readonly docTick = new ValueStore(0);
  /** The IDE's root element: menus and the palette are placed inside it. */
  container: HTMLElement | null = null;
  /** How each panel takes the keyboard (registered by the panels). */
  readonly panelFocus = new Map<string, () => void>();
  /** A panel about to take the keyboard, once the render under way has landed. */
  private focusTimer = 0;
  private view: EditorView | null = null;
  private readonly runtime = new Map<string, BufferRuntime>();
  private readonly listeners = new Set<() => void>();
  private sessions: Record<string, ProjectSession>;
  private drafts = readDrafts();
  private noticeTimer = 0;
  private persistTimer = 0;
  private draftsTimer = 0;
  private gitTimer = 0;
  private dirTimer = 0;
  private dirsToRefresh = new Set<string>();
  private untitled = 0;
  private searchToken = 0;
  private searchFlush = 0;
  private fileList: { root: string; files: string[]; truncated: boolean } | null = null;
  private stopWatching: (() => void) | null = null;
  private disposed = false;

  constructor(readonly backend: WorkspaceBackend) {
    const stored = readIde();
    const persisted: PersistedIde = stored ?? EMPTY_IDE;
    this.sessions = persisted.sessions;
    this.state = {
      root: null,
      info: null,
      recent: persisted.recent,
      bookmarks: persisted.bookmarks,
      prefs: persisted.prefs,
      layout: persisted.layout,
      tree: { viewRoot: null, dirs: {}, expanded: [], selected: null },
      buffers: [],
      active: null,
      closed: [],
      notice: null,
      prompt: null,
      promptKey: 0,
      palette: null,
      search: EMPTY_SEARCH,
      git: EMPTY_GIT,
      disk: null,
      profiles: [],
      defaultProfile: null,
    };
    this.startRoot = persisted.root;
    this.firstRun = stored === null;
  }

  private readonly startRoot: string | null;
  private readonly firstRun: boolean;

  // ── store plumbing ─────────────────────────────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<IdeState> | ((state: IdeState) => Partial<IdeState>)) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.schedulePersist();
    this.listeners.forEach((listener) => listener());
  }

  private patchBuffer(id: string, patch: Partial<BufferMeta>) {
    this.set((state) => ({ buffers: state.buffers.map((buffer) => (buffer.id === id ? { ...buffer, ...patch } : buffer)) }));
  }

  buffer = (id: string | null) => (id ? (this.state.buffers.find((buffer) => buffer.id === id) ?? null) : null);

  /** The active tab's editor state (the live one when it is on screen). */
  activeState(): EditorState | null {
    const id = this.state.active;
    if (!id) return null;
    if (this.view && this.view.state.facet(bufferId) === id) return this.view.state;
    return this.runtime.get(id)?.state ?? null;
  }

  private async init() {
    this.stopWatching = this.backend.onChanged((event) => this.onChanged(event));
    for (const [id, draft] of Object.entries(this.drafts["-"] ?? {})) if (id.startsWith("untitled:")) this.newUntitled(draft.text);
    if (this.firstRun) {
      const old = takeOldCodeDraft();
      if (old) this.newUntitled(old);
    }
    if (this.startRoot) await this.openProject(this.startRoot, { restore: true });
  }

  private started = false;
  private disposeTimer = 0;

  /** On mount. StrictMode's unmount-and-mount in a row keeps the same store running. */
  mount() {
    window.clearTimeout(this.disposeTimer);
    this.disposed = false;
    if (this.started) return;
    this.started = true;
    void this.init();
  }

  unmount() {
    this.disposeTimer = window.setTimeout(() => this.dispose(), 0);
  }

  private dispose() {
    this.disposed = true;
    this.flush();
    this.stopWatching?.();
    if (this.state.root) void this.backend.close(this.state.root).catch(() => {});
    for (const timer of [this.noticeTimer, this.persistTimer, this.draftsTimer, this.gitTimer, this.dirTimer, this.searchFlush]) window.clearTimeout(timer);
    for (const runtime of this.runtime.values()) window.clearTimeout(runtime.autoSave);
  }

  /** Writes everything pending now (the window is closing or the page unloading). */
  flush = () => {
    this.stash(this.state.active);
    window.clearTimeout(this.persistTimer);
    window.clearTimeout(this.draftsTimer);
    this.persistNow();
    this.writeDraftsNow();
  };

  notify(text: string, tone: "info" | "error" = "info") {
    window.clearTimeout(this.noticeTimer);
    this.set({ notice: { id: Date.now(), text, tone } });
    this.noticeTimer = window.setTimeout(() => this.set({ notice: null }), NOTICE_MS);
  }

  ask(prompt: Prompt) {
    this.set((state) => ({ prompt, promptKey: state.promptKey + 1 }));
  }

  closePrompt() {
    if (this.state.prompt) this.set({ prompt: null });
  }

  // ── persistence ────────────────────────────────────────────────────────

  private schedulePersist() {
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.persistNow(), PERSIST_MS);
  }

  private persistNow() {
    if (this.state.root) this.sessions[this.state.root] = this.sessionOf();
    writeIde({
      version: 1,
      root: this.state.root,
      recent: this.state.recent,
      bookmarks: this.state.bookmarks,
      prefs: this.state.prefs,
      layout: this.state.layout,
      sessions: this.sessions,
    });
  }

  private sessionOf(): ProjectSession {
    const { buffers, active, tree } = this.state;
    const files = buffers.filter((buffer) => buffer.kind === "file" && buffer.path);
    const cursors: ProjectSession["cursors"] = {};
    for (const buffer of files) {
      const state = buffer.id === active ? this.activeState() : this.runtime.get(buffer.id)?.state;
      if (state) cursors[buffer.path!] = { anchor: state.selection.main.anchor, head: state.selection.main.head };
      else if (this.sessions[this.state.root!]?.cursors[buffer.path!]) cursors[buffer.path!] = this.sessions[this.state.root!].cursors[buffer.path!];
    }
    return {
      tabs: files.map((buffer) => ({ path: buffer.path!, pinned: !buffer.preview })),
      active: this.buffer(active)?.kind === "file" ? active : null,
      cursors,
      expanded: tree.expanded,
      viewRoot: tree.viewRoot,
      mru: this.sessions[this.state.root!]?.mru ?? [],
    };
  }

  private touchMru(path: string) {
    const root = this.state.root;
    if (!root) return;
    const session = (this.sessions[root] ??= this.sessionOf());
    session.mru = [path, ...session.mru.filter((item) => !samePath(item, path))].slice(0, 50);
  }

  /** Files opened lately in this project, newest first. */
  recentFiles = () => (this.state.root ? (this.sessions[this.state.root]?.mru ?? []) : []);

  private scheduleDrafts() {
    window.clearTimeout(this.draftsTimer);
    this.draftsTimer = window.setTimeout(() => this.writeDraftsNow(), DRAFTS_MS);
  }

  private writeDraftsNow() {
    const key = this.state.root ?? "-";
    const mine: Record<string, Draft> = {};
    let total = 0;
    let skipped = false;
    for (const buffer of this.state.buffers) {
      if (!buffer.dirty || buffer.kind === "virtual") continue;
      const state = buffer.id === this.state.active ? this.activeState() : this.runtime.get(buffer.id)?.state;
      if (!state) continue;
      const text = state.doc.toString();
      if (text.length > MAX_DRAFT || total + text.length > MAX_DRAFTS) {
        skipped = true;
        continue;
      }
      total += text.length;
      const draftKey = buffer.kind === "file" ? buffer.path! : buffer.id;
      const draftRoot = buffer.kind === "untitled" ? "-" : key;
      if (draftRoot === key) mine[draftKey] = { text, base: buffer.stamp?.modified ?? null, eol: buffer.eol, encoding: buffer.encoding };
      else (this.drafts["-"] ??= {})[draftKey] = { text, base: null, eol: buffer.eol, encoding: buffer.encoding };
    }
    // Untitled drafts belong to no project.
    const untitled: Record<string, Draft> = {};
    for (const buffer of this.state.buffers) {
      if (buffer.kind !== "untitled" || !buffer.dirty) continue;
      const state = buffer.id === this.state.active ? this.activeState() : this.runtime.get(buffer.id)?.state;
      if (state && state.doc.length <= MAX_DRAFT) untitled[buffer.id] = { text: state.doc.toString(), base: null, eol: buffer.eol, encoding: buffer.encoding };
    }
    this.drafts["-"] = untitled;
    if (key !== "-") {
      const files = Object.fromEntries(Object.entries(mine).filter(([path]) => !path.startsWith("untitled:")));
      if (Object.keys(files).length) this.drafts[key] = files;
      else delete this.drafts[key];
    }
    if (!writeDrafts(this.drafts) || skipped) this.notify("Rascunho grande demais para guardar automaticamente", "error");
  }

  // ── project ────────────────────────────────────────────────────────────

  async pickFolder() {
    let picked: string | null;
    try {
      picked = await this.backend.pickFolder(this.state.root ?? undefined);
    } catch (error) {
      return this.notify(message(error), "error");
    }
    if (picked) await this.openProject(picked);
  }

  async openProject(path: string, { restore = false } = {}) {
    let info;
    try {
      info = await this.backend.open(path);
    } catch (error) {
      if (restore) this.set({ root: null });
      return this.notify(message(error), "error");
    }
    if (this.disposed) return;
    const previous = this.state.root;
    if (previous && !samePath(previous, info.root)) {
      this.stash(this.state.active);
      this.persistNow();
      this.writeDraftsNow();
      for (const buffer of this.state.buffers.filter((item) => item.kind !== "untitled")) this.dropBuffer(buffer.id);
      void this.backend.close(previous).catch(() => {});
    } else if (previous) {
      return this.notify(`${info.name} já está aberto`);
    }
    this.fileList = null;
    const session = this.sessions[info.root];
    this.set((state) => ({
      root: info.root,
      info,
      recent: [info.root, ...state.recent.filter((item) => !samePath(item, info.root))].slice(0, MAX_RECENT),
      tree: { viewRoot: session?.viewRoot ?? info.root, dirs: {}, expanded: session?.expanded ?? [], selected: null },
      git: EMPTY_GIT,
      search: { ...EMPTY_SEARCH, options: state.search.options },
      disk: null,
    }));
    await this.loadDir(this.state.tree.viewRoot!);
    for (const dir of this.state.tree.expanded) void this.loadDir(dir);
    void this.refreshDisk();
    void this.refreshGit();
    this.restoreSession(info.root, session);
  }

  private restoreSession(root: string, session: ProjectSession | undefined) {
    const drafts = this.drafts[root] ?? {};
    const paths = [...(session?.tabs ?? [])];
    for (const path of Object.keys(drafts)) if (!paths.some((tab) => samePath(tab.path, path))) paths.push({ path, pinned: true });
    if (!paths.length) return;
    const buffers = paths.map((tab) => this.fileMeta(tab.path, !tab.pinned));
    this.set((state) => ({ buffers: [...state.buffers, ...buffers] }));
    const active = session?.active && buffers.some((buffer) => samePath(buffer.id, session.active!)) ? session.active : buffers[0].id;
    void this.activate(active, { focus: false });
    // Drafted tabs load now, so their dot shows without visiting them.
    for (const buffer of buffers) if (drafts[buffer.id] && buffer.id !== active) void this.load(buffer.id);
  }

  closeProject() {
    const root = this.state.root;
    if (!root) return;
    if (this.state.buffers.some((buffer) => buffer.dirty && buffer.kind === "file")) this.writeDraftsNow();
    this.stash(this.state.active);
    this.persistNow();
    for (const buffer of this.state.buffers.filter((item) => item.kind !== "untitled")) this.dropBuffer(buffer.id);
    void this.backend.close(root).catch(() => {});
    this.fileList = null;
    this.set({ root: null, info: null, tree: { viewRoot: null, dirs: {}, expanded: [], selected: null }, git: EMPTY_GIT, disk: null, search: EMPTY_SEARCH });
  }

  forgetRecent(path?: string) {
    this.set((state) => ({ recent: path ? state.recent.filter((item) => !samePath(item, path)) : state.recent.filter((item) => state.root && samePath(item, state.root)) }));
  }

  async refreshDisk() {
    const root = this.state.root;
    if (!root) return;
    try {
      const disk = await this.backend.disk(root);
      if (this.state.root === root) this.set({ disk });
    } catch {
      // The status bar just leaves it out.
    }
  }

  // ── file manager ───────────────────────────────────────────────────────

  async loadDir(dir: string) {
    this.set((state) => ({
      tree: { ...state.tree, dirs: { ...state.tree.dirs, [dir]: { entries: state.tree.dirs[dir]?.entries ?? null, loading: true, error: null } } },
    }));
    try {
      const listing = await this.backend.list(dir, "");
      this.set((state) => ({ tree: { ...state.tree, dirs: { ...state.tree.dirs, [dir]: { entries: listing.entries, loading: false, error: null } } } }));
    } catch (error) {
      this.set((state) => ({ tree: { ...state.tree, dirs: { ...state.tree.dirs, [dir]: { entries: null, loading: false, error: message(error) } } } }));
    }
  }

  toggleDir(dir: string, open?: boolean) {
    const expanded = this.state.tree.expanded.some((item) => samePath(item, dir));
    const next = open ?? !expanded;
    if (next === expanded) return;
    this.set((state) => ({
      tree: { ...state.tree, expanded: next ? [...state.tree.expanded, dir] : state.tree.expanded.filter((item) => !samePath(item, dir)) },
    }));
    if (next && !this.state.tree.dirs[dir]?.entries) void this.loadDir(dir);
  }

  select(path: string | null) {
    if (this.state.tree.selected !== path) this.set((state) => ({ tree: { ...state.tree, selected: path } }));
  }

  /** The folder at the top of the file manager (".." goes up, even above the project). */
  setViewRoot(dir: string) {
    this.set((state) => ({ tree: { ...state.tree, viewRoot: dir, selected: null } }));
    if (!this.state.tree.dirs[dir]?.entries) void this.loadDir(dir);
  }

  /** Expands the folders down to `path` and selects it (Ctrl+Shift+E). */
  reveal(path: string) {
    const root = this.state.tree.viewRoot;
    if (!root || !isInside(root, path)) {
      if (this.state.root && isInside(this.state.root, path)) this.setViewRoot(this.state.root);
      else return;
    }
    const top = this.state.tree.viewRoot!;
    const chain: string[] = [];
    for (let dir = dirName(path); !samePath(dir, top) && isInside(top, dir); dir = dirName(dir)) chain.unshift(dir);
    for (const dir of chain) this.toggleDir(dir, true);
    this.select(path);
    if (!hasKind(this.state.layout, "files")) this.togglePanel("files");
  }

  private scheduleDirRefresh(dir: string) {
    this.dirsToRefresh.add(dir);
    window.clearTimeout(this.dirTimer);
    this.dirTimer = window.setTimeout(() => {
      const dirs = [...this.dirsToRefresh];
      this.dirsToRefresh.clear();
      for (const item of dirs) if (this.state.tree.dirs[item]) void this.loadDir(item);
    }, DIR_REFRESH_MS);
  }

  async createEntry(dir: string, name: string, isDir: boolean) {
    const clean = name.trim().replace(/\\/g, "/");
    if (!clean) return;
    try {
      await this.backend.create(dir, clean, isDir);
    } catch (error) {
      return this.notify(message(error), "error");
    }
    const path = joinPath(dir, clean);
    this.toggleDir(dir, true);
    await this.loadDir(dirName(path));
    this.fileList = null;
    this.select(path);
    if (!isDir) await this.openFile(path, { focus: true });
  }

  /** False when the name was refused (the notice says why), so the name being edited stays open. */
  async renameEntry(path: string, name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean || clean === baseName(path)) return true;
    const parent = dirName(path);
    try {
      await this.backend.rename(parent, baseName(path), clean);
    } catch (error) {
      this.notify(message(error), "error");
      return false;
    }
    const target = joinPath(parent, clean);
    // Open tabs follow the file (or everything under the folder).
    for (const buffer of this.state.buffers) {
      if (buffer.kind !== "file" || !buffer.path) continue;
      const rel = relativePath(path, buffer.path);
      if (rel !== null) this.retarget(buffer.id, joinPath(target, rel));
    }
    this.set((state) => ({ tree: { ...state.tree, expanded: state.tree.expanded.map((dir) => (isInside(path, dir) || samePath(path, dir) ? joinPath(target, relativePath(path, dir) ?? "") : dir)) } }));
    this.fileList = null;
    await this.loadDir(parent);
    this.select(target);
    return true;
  }

  async deleteEntry(path: string) {
    try {
      await this.backend.remove(dirName(path), [baseName(path)], false);
    } catch (error) {
      return this.notify(message(error), "error");
    }
    for (const buffer of this.state.buffers) {
      if (buffer.kind === "file" && buffer.path && (samePath(buffer.path, path) || isInside(path, buffer.path))) this.patchBuffer(buffer.id, { disk: "deleted", stamp: null });
    }
    this.fileList = null;
    await this.loadDir(dirName(path));
    this.notify(`${baseName(path)} foi para a Lixeira`);
  }

  async revealInExplorer(path: string) {
    try {
      await this.backend.reveal(dirName(path), baseName(path));
    } catch (error) {
      this.notify(message(error), "error");
    }
  }

  async copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.notify(`${what} copiado`);
    } catch {
      this.notify("Não foi possível copiar", "error");
    }
  }

  toggleBookmark(path: string, dir: boolean) {
    const has = this.state.bookmarks.some((item) => samePath(item.path, path));
    this.set((state) => ({
      bookmarks: has ? state.bookmarks.filter((item) => !samePath(item.path, path)) : [...state.bookmarks, { path, dir }].slice(-MAX_BOOKMARKS),
    }));
    this.notify(has ? `${baseName(path)} saiu dos favoritos` : `${baseName(path)} nos favoritos`);
  }

  isBookmarked = (path: string) => this.state.bookmarks.some((item) => samePath(item.path, path));

  /** A favourite: a file opens; a folder inside the project shows in the tree, one outside opens as the project. */
  async openBookmark(path: string, dir: boolean) {
    if (!dir) return this.openFile(path, { focus: true });
    if (this.state.root && (samePath(this.state.root, path) || isInside(this.state.root, path))) {
      this.reveal(path);
      this.toggleDir(path, true);
      return;
    }
    await this.openProject(path);
  }

  // ── tabs ───────────────────────────────────────────────────────────────

  private fileMeta(path: string, preview: boolean): BufferMeta {
    return {
      id: path,
      kind: "file",
      path,
      title: baseName(path),
      view: "unloaded",
      language: null,
      highlight: null,
      encoding: "utf8",
      eol: "lf",
      mixedEol: false,
      tabSize: this.state.prefs.defaultTab,
      useTabs: false,
      readOnly: false,
      dirty: false,
      preview,
      saving: false,
      stamp: null,
      disk: "ok",
      size: 0,
    };
  }

  private runtimeOf(id: string): BufferRuntime {
    let runtime = this.runtime.get(id);
    if (!runtime) {
      runtime = { state: null, saved: null, savedEol: "lf", savedEncoding: "utf8", scroll: null, loading: null, autoSave: 0 };
      this.runtime.set(id, runtime);
    }
    return runtime;
  }

  async openFile(path: string, options: OpenOptions = {}) {
    const existing = this.state.buffers.find((buffer) => buffer.kind === "file" && buffer.path && samePath(buffer.path, path));
    if (existing) {
      if (!options.preview && existing.preview) this.patchBuffer(existing.id, { preview: false });
      return this.activate(existing.id, options);
    }
    const meta = this.fileMeta(path, options.preview ?? false);
    this.set((state) => {
      const buffers = [...state.buffers];
      const previewAt = options.preview ? buffers.findIndex((buffer) => buffer.preview && !buffer.dirty) : -1;
      if (previewAt >= 0) {
        this.runtime.delete(buffers[previewAt].id);
        buffers[previewAt] = meta;
      } else {
        const at = buffers.findIndex((buffer) => buffer.id === state.active);
        buffers.splice(at < 0 ? buffers.length : at + 1, 0, meta);
      }
      return { buffers };
    });
    this.touchMru(path);
    await this.activate(meta.id, options);
  }

  newUntitled(text = "") {
    const id = `untitled:${++this.untitled}`;
    const meta: BufferMeta = { ...this.fileMeta("", false), id, kind: "untitled", path: null, title: `sem título ${this.untitled}`, view: "text", dirty: text.length > 0 };
    const runtime = this.runtimeOf(id);
    runtime.saved = Text.empty;
    runtime.state = this.createState(meta, text);
    this.set((state) => ({ buffers: [...state.buffers, meta] }));
    void this.activate(id, { focus: !text });
    return id;
  }

  /** A read-only tab with generated text (a diff, the git log). Reopening replaces its text. */
  openVirtual(id: string, title: string, text: string, language: string | null) {
    const existing = this.buffer(id);
    const meta: BufferMeta = { ...this.fileMeta("", false), id, kind: "virtual", path: null, title, view: "text", readOnly: true, language, highlight: language };
    const runtime = this.runtimeOf(id);
    runtime.saved = Text.of(text.split("\n"));
    runtime.state = this.createState(meta, text);
    runtime.scroll = null;
    if (existing) this.patchBuffer(id, meta);
    else
      this.set((state) => {
        const buffers = [...state.buffers];
        const at = buffers.findIndex((buffer) => buffer.id === state.active);
        buffers.splice(at < 0 ? buffers.length : at + 1, 0, meta);
        return { buffers };
      });
    if (this.view && this.state.active === id) this.show(id);
    else void this.activate(id, { focus: false });
  }

  /** Keeps the live state of the tab leaving the screen. */
  private stash(id: string | null) {
    if (!id || !this.view || this.view.state.facet(bufferId) !== id) return;
    const runtime = this.runtime.get(id);
    if (!runtime) return;
    runtime.state = this.view.state;
    runtime.scroll = this.view.scrollSnapshot();
  }

  async activate(id: string, options: OpenOptions = {}) {
    const meta = this.buffer(id);
    if (!meta) return;
    if (this.state.active !== id) {
      this.stash(this.state.active);
      this.set({ active: id });
    }
    if (meta.path) this.touchMru(meta.path);
    if (meta.view === "unloaded" || meta.view === "loading") await this.load(id);
    if (this.state.active !== id) return;
    this.show(id);
    if (options.line) this.goTo(options.line, options.column ?? 0, options.length ?? 0);
    if (options.focus !== false && this.view && this.buffer(id)?.view === "text") {
      this.focusPanel("editor", false);
      this.view.focus();
    }
  }

  /** Puts the tab's state into the view. */
  private show(id: string) {
    const runtime = this.runtime.get(id);
    if (!this.view || !runtime?.state) {
      this.cursor.set(EMPTY_CURSOR);
      return;
    }
    if (this.view.state !== runtime.state) this.view.setState(runtime.state);
    if (runtime.scroll) this.view.dispatch({ effects: runtime.scroll });
    this.cursor.set(cursorOf(runtime.state));
    this.docTick.set(this.docTick.get() + 1);
  }

  attachView(view: EditorView) {
    this.view = view;
    if (this.state.active) this.show(this.state.active);
  }

  detachView(view: EditorView) {
    if (this.view !== view) return;
    this.stash(this.state.active);
    this.view = null;
  }

  focusEditor() {
    if (this.view && this.buffer(this.state.active)?.view === "text") this.view.focus();
  }

  private load(id: string): Promise<void> {
    const runtime = this.runtimeOf(id);
    runtime.loading ??= this.read(id).finally(() => {
      runtime.loading = null;
    });
    return runtime.loading;
  }

  private async read(id: string) {
    const meta = this.buffer(id);
    if (!meta?.path) return;
    this.patchBuffer(id, { view: "loading" });
    let content: FileContent;
    try {
      const { root, rel } = where(meta.path);
      content = await this.backend.read(root, rel);
    } catch (error) {
      this.patchBuffer(id, { view: "error", message: message(error) });
      return;
    }
    if (!this.buffer(id)) return;
    if (content.kind !== "text") {
      this.patchBuffer(id, { view: content.kind === "binary" ? "binary" : "large", size: content.stamp.size, stamp: content.stamp, readOnly: true });
      return;
    }
    const draft = this.drafts[this.state.root ?? "-"]?.[meta.path];
    const runtime = this.runtimeOf(id);
    runtime.saved = Text.of(content.contents.split("\n"));
    runtime.savedEol = content.eol;
    runtime.savedEncoding = content.encoding;
    const indent = detectIndent(content.contents, this.state.prefs.defaultTab);
    const next: BufferMeta = {
      ...this.buffer(id)!,
      view: "text",
      encoding: draft?.encoding ?? content.encoding,
      eol: draft?.eol ?? content.eol,
      mixedEol: content.mixedEol,
      readOnly: content.readonly,
      stamp: content.stamp,
      size: content.stamp.size,
      tabSize: indent.tabSize,
      useTabs: indent.useTabs,
      dirty: false,
      disk: "ok",
    };
    const text = draft ? draft.text : content.contents;
    if (draft) {
      next.dirty = text !== content.contents || next.eol !== content.eol || next.encoding !== content.encoding;
      // The file moved on under the draft: show the conflict instead of guessing.
      if (next.dirty && draft.base !== null && draft.base !== content.stamp.modified) next.disk = "changed";
    }
    runtime.state = this.createState(next, text, this.sessions[this.state.root ?? ""]?.cursors[meta.path]);
    this.patchBuffer(id, next);
    if (this.state.active === id) this.show(id);
  }

  private createState(meta: BufferMeta, text: string, cursor?: { anchor: number; head: number }): EditorState {
    const description = describe(meta.path, meta.language, text.slice(0, text.indexOf("\n") >>> 0));
    const ready = description?.support ?? null;
    const length = text.length;
    const state = EditorState.create({
      doc: text,
      selection: cursor && cursor.anchor <= length && cursor.head <= length ? EditorSelection.single(cursor.anchor, cursor.head) : undefined,
      extensions: bufferExtensions({
        id: meta.id,
        language: ready ?? [],
        tabSize: meta.tabSize,
        useTabs: meta.useTabs,
        readOnly: meta.readOnly,
        prefs: this.state.prefs,
        onUpdate: this.onUpdate,
      }),
    });
    meta.highlight = description?.name ?? null;
    if (description && !ready) void this.loadLanguage(meta.id, description);
    return state;
  }

  private async loadLanguage(id: string, description: LanguageDescription) {
    const support = await description.load();
    this.reconfigure(id, languageSlot.reconfigure(support));
  }

  private reconfigure(id: string, effects: StateEffect<unknown> | StateEffect<unknown>[]) {
    if (this.view && this.view.state.facet(bufferId) === id) {
      this.view.dispatch({ effects });
      return;
    }
    const runtime = this.runtime.get(id);
    if (runtime?.state) runtime.state = runtime.state.update({ effects }).state;
  }

  private onUpdate = (update: ViewUpdate) => {
    const id = update.state.facet(bufferId);
    const runtime = this.runtime.get(id);
    const meta = this.buffer(id);
    if (!runtime || !meta) return;
    runtime.state = update.state;
    if (update.docChanged) {
      const dirty = this.isDirty(meta, runtime, update.state.doc);
      if (dirty !== meta.dirty || (meta.preview && dirty)) this.patchBuffer(id, { dirty, preview: meta.preview && !dirty });
      if (meta.kind !== "virtual") this.scheduleDrafts();
      if (this.state.prefs.autoSave && meta.kind === "file" && dirty) {
        window.clearTimeout(runtime.autoSave);
        runtime.autoSave = window.setTimeout(() => void this.save(id), AUTOSAVE_MS);
      }
      if (id === this.state.active) this.docTick.set(this.docTick.get() + 1);
    }
    if ((update.docChanged || update.selectionSet) && id === this.state.active) this.cursor.set(cursorOf(update.state));
  };

  private isDirty(meta: BufferMeta, runtime: BufferRuntime, doc: Text) {
    if (meta.kind === "virtual") return false;
    if (meta.kind === "untitled") return doc.length > 0;
    const saved = runtime.saved;
    const same = !!saved && doc.length === saved.length && doc.eq(saved);
    return !same || meta.eol !== runtime.savedEol || meta.encoding !== runtime.savedEncoding || meta.disk === "deleted";
  }

  /** Closes a tab; one with unsaved edits asks first. */
  closeBuffer(id: string | null = this.state.active, force = false): void {
    const meta = this.buffer(id);
    if (!meta) return;
    if (meta.dirty && !force) {
      this.ask({
        kind: "confirm",
        label: `${meta.title} tem alterações não salvas.`,
        choices: [
          {
            key: "s",
            label: "salvar",
            run: async () => {
              if (await this.save(meta.id)) this.closeBuffer(meta.id, true);
            },
          },
          { key: "d", label: "descartar", run: () => this.closeBuffer(meta.id, true) },
          { key: "c", label: "cancelar", run: () => undefined },
        ],
      });
      return;
    }
    const index = this.state.buffers.findIndex((buffer) => buffer.id === id);
    const wasActive = this.state.active === id;
    this.dropBuffer(meta.id);
    if (meta.kind === "file" && meta.path) this.set((state) => ({ closed: [meta.path!, ...state.closed.filter((path) => !samePath(path, meta.path!))].slice(0, 20) }));
    if (wasActive) {
      const next = this.state.buffers[Math.min(index, this.state.buffers.length - 1)];
      if (next) void this.activate(next.id, { focus: true });
      else this.cursor.set(EMPTY_CURSOR);
    }
    if (meta.dirty) this.scheduleDrafts();
  }

  private dropBuffer(id: string) {
    const runtime = this.runtime.get(id);
    if (runtime) window.clearTimeout(runtime.autoSave);
    this.runtime.delete(id);
    this.set((state) => ({ buffers: state.buffers.filter((buffer) => buffer.id !== id), active: state.active === id ? null : state.active }));
  }

  closeOthers(keep: string) {
    for (const buffer of this.state.buffers) if (buffer.id !== keep && !buffer.dirty) this.dropBuffer(buffer.id);
    if (this.state.active !== keep) void this.activate(keep);
  }

  closeSaved() {
    const active = this.state.active;
    for (const buffer of this.state.buffers) if (!buffer.dirty) this.dropBuffer(buffer.id);
    if (active && !this.buffer(active) && this.state.buffers[0]) void this.activate(this.state.buffers[0].id);
  }

  reopenClosed() {
    const [path, ...rest] = this.state.closed;
    if (!path) return this.notify("Nenhuma aba fechada");
    this.set({ closed: rest });
    void this.openFile(path, { focus: true });
  }

  cycleTab(step: 1 | -1) {
    const { buffers, active } = this.state;
    if (buffers.length < 2) return;
    const index = buffers.findIndex((buffer) => buffer.id === active);
    void this.activate(buffers[(index + step + buffers.length) % buffers.length].id, { focus: true });
  }

  pin(id: string) {
    if (this.buffer(id)?.preview) this.patchBuffer(id, { preview: false });
  }

  /** The file behind a tab changed its path (a rename in the tree, a "save as"). */
  private retarget(id: string, path: string) {
    const runtime = this.runtime.get(id);
    if (runtime) {
      this.runtime.delete(id);
      this.runtime.set(path, runtime);
    }
    const meta = this.buffer(id)!;
    const description = describe(path, meta.language);
    this.set((state) => ({
      buffers: state.buffers.map((buffer) =>
        buffer.id === id ? { ...buffer, id: path, kind: "file", path, title: baseName(path), highlight: description?.name ?? null } : buffer,
      ),
      active: state.active === id ? path : state.active,
    }));
    this.reconfigure(id, idSlot.reconfigure(bufferId.of(path)));
    if (description) void this.loadLanguage(path, description);
    else this.reconfigure(path, languageSlot.reconfigure([]));
  }

  // ── save, reload, conflicts ────────────────────────────────────────────

  /** Saves a tab; true when it is on disk afterwards. */
  async save(id: string | null = this.state.active): Promise<boolean> {
    const meta = this.buffer(id);
    if (!meta || meta.kind === "virtual" || meta.view !== "text") return false;
    if (meta.kind === "untitled" || !meta.path) {
      this.saveAs(meta.id);
      return false;
    }
    const state = meta.id === this.state.active ? this.activeState() : this.runtime.get(meta.id)?.state;
    if (!state) return false;
    const runtime = this.runtimeOf(meta.id);
    window.clearTimeout(runtime.autoSave);
    const doc = state.doc;
    this.patchBuffer(meta.id, { saving: true });
    try {
      const { root, rel } = where(meta.path);
      const stamp = await this.backend.write(root, rel, doc.toString(), meta.encoding, meta.eol, meta.disk === "deleted" ? null : meta.stamp);
      runtime.saved = doc;
      runtime.savedEol = meta.eol;
      runtime.savedEncoding = meta.encoding;
      const current = this.buffer(meta.id);
      const live = meta.id === this.state.active ? this.activeState() : runtime.state;
      this.patchBuffer(meta.id, { saving: false, stamp, disk: "ok", mixedEol: false, dirty: live ? !live.doc.eq(doc) : false, preview: false });
      if (current?.disk === "deleted") this.scheduleDirRefresh(dirName(meta.path));
      this.scheduleDrafts();
      this.notify(`Salvo às ${formatTime(new Date())}`);
      return true;
    } catch (error) {
      this.patchBuffer(meta.id, { saving: false });
      if (message(error) === FILE_CHANGED) {
        this.patchBuffer(meta.id, { disk: "changed" });
        this.notify(`${meta.title} mudou no disco: recarregue, mantenha as suas ou compare`, "error");
      } else this.notify(message(error), "error");
      return false;
    }
  }

  saveAs(id: string | null = this.state.active) {
    const meta = this.buffer(id);
    if (!meta || meta.kind === "virtual") return;
    const root = this.state.root;
    if (!root) return this.notify("Abra uma pasta (Ctrl+O) para salvar dentro dela", "error");
    const suggestion = meta.path ? (relativePath(root, meta.path) ?? meta.title) : "sem-titulo.txt";
    this.ask({
      kind: "input",
      label: "Salvar como (dentro do projeto):",
      value: suggestion,
      submit: async (value) => {
        const rel = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
        if (!rel) return;
        const state = meta.id === this.state.active ? this.activeState() : this.runtime.get(meta.id)?.state;
        if (!state) return;
        const path = joinPath(root, rel);
        const parent = dirName(path);
        try {
          if (relativePath(root, parent)) await this.backend.create(root, relativePath(root, parent)!, true).catch(() => undefined);
          const stamp = await this.backend.write(parent, baseName(path), state.doc.toString(), meta.encoding, meta.eol, null);
          const runtime = this.runtimeOf(meta.id);
          runtime.saved = state.doc;
          runtime.savedEol = meta.eol;
          runtime.savedEncoding = meta.encoding;
          const other = this.state.buffers.find((buffer) => buffer.id !== meta.id && buffer.path && samePath(buffer.path, path));
          if (other) this.dropBuffer(other.id);
          this.retarget(meta.id, path);
          this.patchBuffer(path, { stamp, dirty: false, disk: "ok", preview: false });
          this.fileList = null;
          this.scheduleDirRefresh(parent);
          this.scheduleDrafts();
          this.notify(`Salvo como ${rel}`);
        } catch (error) {
          this.notify(message(error), "error");
        }
      },
    });
  }

  async saveAll() {
    const dirty = this.state.buffers.filter((buffer) => buffer.dirty && buffer.kind === "file");
    for (const buffer of dirty) await this.save(buffer.id);
    if (!dirty.length) this.notify("Nada para salvar");
  }

  /** Replaces the tab's text with the file's (one undoable change; the cursor stays). */
  async reloadFromDisk(id: string | null = this.state.active) {
    const meta = this.buffer(id);
    if (!meta?.path) return;
    let content: FileContent;
    try {
      const { root, rel } = where(meta.path);
      content = await this.backend.read(root, rel);
    } catch (error) {
      return this.notify(message(error), "error");
    }
    if (content.kind !== "text") {
      this.runtime.delete(meta.id);
      return this.patchBuffer(meta.id, { view: "unloaded" }), void this.load(meta.id);
    }
    const runtime = this.runtimeOf(meta.id);
    runtime.saved = Text.of(content.contents.split("\n"));
    runtime.savedEol = content.eol;
    runtime.savedEncoding = content.encoding;
    this.patchBuffer(meta.id, { stamp: content.stamp, disk: "ok", eol: content.eol, encoding: content.encoding, mixedEol: content.mixedEol, dirty: false });
    this.replaceText(meta.id, content.contents);
  }

  private replaceText(id: string, text: string) {
    const state = id === this.state.active ? this.activeState() : this.runtime.get(id)?.state;
    if (!state) return;
    const changes = minimalChange(state.doc, text);
    if (!changes) return;
    if (this.view && this.view.state.facet(bufferId) === id) this.view.dispatch({ changes, userEvent: "external" });
    else {
      const runtime = this.runtime.get(id)!;
      runtime.state = state.update({ changes, userEvent: "external" }).state;
      this.patchBuffer(id, { dirty: this.isDirty(this.buffer(id)!, runtime, runtime.state.doc) });
    }
  }

  /** Conflict: keep the edits in the tab; the next save overwrites the file. */
  async keepMine(id: string | null = this.state.active) {
    const meta = this.buffer(id);
    if (!meta?.path) return;
    try {
      const { root, rel } = where(meta.path);
      const [stamp] = await this.backend.stat(root, [rel]);
      this.patchBuffer(meta.id, { disk: stamp ? "ok" : "deleted", stamp: stamp ?? null });
    } catch (error) {
      this.notify(message(error), "error");
    }
  }

  /** Conflict: the file on disk against the tab, as a diff. */
  async compareWithDisk(id: string | null = this.state.active) {
    const meta = this.buffer(id);
    const state = meta && (meta.id === this.state.active ? this.activeState() : this.runtime.get(meta.id)?.state);
    if (!meta?.path || !state) return;
    try {
      const { root, rel } = where(meta.path);
      const content = await this.backend.read(root, rel);
      if (content.kind !== "text") return this.notify("O arquivo no disco não é texto", "error");
      const { unifiedDiff } = await import("../../../../lib/lineDiff");
      const text = unifiedDiff(meta.title, content.contents, state.doc.toString()) || "Sem diferenças.";
      this.openVirtual(`virtual:compare:${meta.id}`, `${meta.title} (disco ↔ aba)`, text, DIFF.name);
    } catch (error) {
      this.notify(message(error), "error");
    }
  }

  setEol(id: string | null, eol: Eol) {
    const meta = this.buffer(id);
    const runtime = meta && this.runtime.get(meta.id);
    if (!meta || !runtime?.state || meta.eol === eol) return;
    const state = meta.id === this.state.active ? this.activeState()! : runtime.state;
    this.patchBuffer(meta.id, { eol, dirty: this.isDirty({ ...meta, eol }, runtime, state.doc) });
    this.scheduleDrafts();
  }

  setEncoding(id: string | null, encoding: Encoding) {
    const meta = this.buffer(id);
    const runtime = meta && this.runtime.get(meta.id);
    if (!meta || !runtime?.state || meta.encoding === encoding) return;
    const state = meta.id === this.state.active ? this.activeState()! : runtime.state;
    this.patchBuffer(meta.id, { encoding, dirty: this.isDirty({ ...meta, encoding }, runtime, state.doc) });
    this.notify(`Será salvo em ${ENCODING_LABELS[encoding]}`);
  }

  setLanguage(id: string | null, name: string | null) {
    const meta = this.buffer(id);
    if (!meta) return;
    const description = describe(meta.path, name);
    this.patchBuffer(meta.id, { language: name, highlight: description?.name ?? null });
    if (description) void this.loadLanguage(meta.id, description);
    else this.reconfigure(meta.id, languageSlot.reconfigure([]));
  }

  setIndent(id: string | null, tabSize: number, useTabs: boolean) {
    const meta = this.buffer(id);
    if (!meta) return;
    this.patchBuffer(meta.id, { tabSize, useTabs });
    this.reconfigure(meta.id, indentSlot.reconfigure(indentExtension(tabSize, useTabs)));
  }

  /** Ln/Col of the active tab (1-based line; 0-based column), selecting `length` characters. */
  goTo(line: number, column = 0, length = 0) {
    const view = this.view;
    if (!view || view.state.facet(bufferId) !== this.state.active) return;
    const doc = view.state.doc;
    const target = doc.line(Math.min(Math.max(1, line), doc.lines));
    const from = Math.min(target.from + Math.max(0, column), target.to);
    const to = Math.min(from + length, target.to);
    view.dispatch({ selection: EditorSelection.single(to, from), effects: EditorView.scrollIntoView(from, { y: "center" }) });
  }

  // ── options ────────────────────────────────────────────────────────────

  setPrefs(patch: Partial<IdePrefs>) {
    const prefs = { ...this.state.prefs, ...patch };
    this.set({ prefs });
    const effect = prefsSlot.reconfigure(prefsExtension(prefs));
    for (const [id, runtime] of this.runtime) {
      if (this.view && this.view.state.facet(bufferId) === id) this.view.dispatch({ effects: effect });
      else if (runtime.state) runtime.state = runtime.state.update({ effects: effect }).state;
    }
  }

  // ── external changes ───────────────────────────────────────────────────

  private onChanged(event: ChangedEvent) {
    const root = this.state.root;
    if (!root || !samePath(event.root, root)) return;
    if (event.rescan) {
      for (const dir of Object.keys(this.state.tree.dirs)) this.scheduleDirRefresh(dir);
      for (const buffer of this.state.buffers) if (buffer.kind === "file" && buffer.view === "text") void this.checkExternal(buffer.id);
      this.fileList = null;
    }
    for (const change of event.changes) {
      const path = joinPath(root, change.path);
      this.scheduleDirRefresh(dirName(path));
      if (change.kind !== "modified") this.fileList = null;
      if (change.kind === "removed") {
        this.set((state) => ({
          tree: {
            ...state.tree,
            dirs: Object.fromEntries(Object.entries(state.tree.dirs).filter(([dir]) => !samePath(dir, path) && !isInside(path, dir))),
            expanded: state.tree.expanded.filter((dir) => !samePath(dir, path) && !isInside(path, dir)),
          },
        }));
      }
      for (const buffer of this.state.buffers) {
        if (buffer.kind !== "file" || !buffer.path) continue;
        if (samePath(buffer.path, path) || (change.kind === "removed" && isInside(path, buffer.path))) {
          if (change.kind === "removed") this.patchBuffer(buffer.id, { disk: "deleted", stamp: null, dirty: true });
          else void this.checkExternal(buffer.id);
        }
      }
    }
    if (event.git || event.changes.length) this.scheduleGitRefresh();
  }

  private async checkExternal(id: string) {
    const meta = this.buffer(id);
    if (!meta?.path || meta.view === "unloaded" || meta.saving) return;
    let content: FileContent;
    try {
      const { root, rel } = where(meta.path);
      content = await this.backend.read(root, rel);
    } catch {
      return;
    }
    const current = this.buffer(id);
    if (!current) return;
    if (content.kind !== "text") {
      if (current.view === "binary" || current.view === "large") this.patchBuffer(id, { stamp: content.stamp, size: content.stamp.size });
      return;
    }
    const runtime = this.runtimeOf(id);
    const disk = Text.of(content.contents.split("\n"));
    // Our own save coming back, or nothing that matters.
    if (runtime.saved && runtime.saved.eq(disk)) {
      this.patchBuffer(id, { stamp: content.stamp, disk: "ok", dirty: current.disk === "deleted" ? this.isDirty({ ...current, disk: "ok" }, runtime, (id === this.state.active ? this.activeState() : runtime.state)?.doc ?? disk) : current.dirty });
      return;
    }
    if (!current.dirty || current.disk === "deleted") {
      runtime.saved = disk;
      runtime.savedEol = content.eol;
      runtime.savedEncoding = content.encoding;
      this.patchBuffer(id, { stamp: content.stamp, disk: "ok", eol: content.eol, encoding: content.encoding, dirty: false });
      this.replaceText(id, content.contents);
      return;
    }
    this.patchBuffer(id, { disk: "changed" });
  }

  // ── layout ─────────────────────────────────────────────────────────────

  private setLayout(layout: IdeLayout) {
    this.set({ layout });
  }

  togglePanel(kind: Exclude<PanelKind, "terminal">) {
    const existing = panelsOf(this.state.layout, kind)[0];
    if (existing) this.setLayout(closePanel(this.state.layout, existing.id));
    else {
      this.setLayout(openPanel(this.state.layout, { id: kind, kind }));
      this.focusSoon(kind);
    }
  }

  /** Shows the panel (opening it if needed) and gives it the keyboard. */
  showPanel(kind: Exclude<PanelKind, "terminal">) {
    if (!hasKind(this.state.layout, kind)) this.setLayout(openPanel(this.state.layout, { id: kind, kind }));
    this.focusSoon(kind);
  }

  /** A panel just opened (or just changed) takes the keyboard once it has rendered. */
  private focusSoon(id: string) {
    window.clearTimeout(this.focusTimer);
    this.focusTimer = window.setTimeout(() => this.focusPanel(id), 0);
  }

  closePanel(id: string) {
    this.setLayout(closePanel(this.state.layout, id));
    const next = this.state.layout.focus;
    if (next) this.focusSoon(next);
  }

  focusPanel(id: string, takeKeyboard = true) {
    if (!findPanel(this.state.layout, id)) return;
    if (this.state.layout.focus !== id) this.setLayout({ ...this.state.layout, focus: id });
    if (!takeKeyboard) return;
    // Asked for since (Alt+N, F6): wins over a panel still rendering.
    window.clearTimeout(this.focusTimer);
    this.panelFocus.get(id)?.();
  }

  cyclePanel(step: 1 | -1) {
    const panels = orderedPanels(this.state.layout);
    if (!panels.length) return;
    const index = panels.findIndex((panel) => panel.id === this.state.layout.focus);
    this.focusPanel(panels[(index + step + panels.length) % panels.length].id);
  }

  focusNth(n: number) {
    const panel = orderedPanels(this.state.layout)[n - 1];
    if (panel) this.focusPanel(panel.id);
  }

  toggleZoom(id: string | null = this.state.layout.focus) {
    if (!id) return;
    this.setLayout({ ...this.state.layout, zoom: this.state.layout.zoom === id ? null : id });
  }

  resetLayout() {
    const terminals = panelsOf(this.state.layout, "terminal");
    let layout = DEFAULT_LAYOUT;
    for (const terminal of terminals) layout = openPanel(layout, { id: terminal.id, kind: "terminal", profile: terminal.profile });
    this.setLayout({ ...layout, focus: "editor" });
  }

  setLayoutSizes(layout: IdeLayout) {
    this.setLayout(layout);
  }

  // ── terminals ──────────────────────────────────────────────────────────

  async loadTerminalProfiles() {
    if (this.state.profiles.length) return;
    const profiles = await loadProfiles();
    if (profiles) this.set({ profiles: profiles.profiles.map(({ id, name }) => ({ id, name })), defaultProfile: profiles.default });
  }

  async openTerminal(profile?: string) {
    await this.loadTerminalProfiles();
    const chosen = profile ?? this.state.defaultProfile ?? this.state.profiles[0]?.id;
    if (!chosen) return this.notify("Nenhum terminal disponível neste ambiente", "error");
    const id = nextTerminalId(this.state.layout);
    this.setLayout(openPanel(this.state.layout, { id, kind: "terminal", profile: chosen }));
    this.focusSoon(id);
  }

  /** Ctrl+`: a terminal (opening one), or back to the editor from it. */
  async toggleTerminal() {
    const terminals = panelsOf(this.state.layout, "terminal");
    if (!terminals.length) return this.openTerminal();
    const focused = this.state.layout.focus;
    if (focused && terminals.some((panel) => panel.id === focused)) {
      this.focusPanel("editor", false);
      this.focusEditor();
    } else this.focusPanel(terminals[terminals.length - 1].id);
  }

  // ── palette ────────────────────────────────────────────────────────────

  openPalette(mode: PaletteMode, query = "") {
    this.set({ palette: { mode, query } });
  }

  closePalette() {
    if (this.state.palette) this.set({ palette: null });
  }

  /** The project's files for quick open (cached until something is created or removed). */
  async projectFiles(): Promise<{ files: string[]; truncated: boolean }> {
    const root = this.state.root;
    if (!root) return { files: [], truncated: false };
    if (this.fileList && samePath(this.fileList.root, root)) return this.fileList;
    try {
      const list = await this.backend.files(root);
      this.fileList = { root, ...list };
      return list;
    } catch (error) {
      this.notify(message(error), "error");
      return { files: [], truncated: false };
    }
  }

  // ── project search ─────────────────────────────────────────────────────

  /** Ctrl+Shift+F: the search panel, with the editor's selection as the query. */
  focusSearch() {
    const state = this.activeState();
    if (state) {
      const { from, to } = state.selection.main;
      const text = state.sliceDoc(from, to);
      if (text && !/[\r\n]/.test(text) && text.length <= 200) this.setSearchOptions({ query: text });
    }
    this.showPanel("search");
  }

  setSearchOptions(patch: Partial<SearchOptions>) {
    this.set((state) => ({ search: { ...state.search, options: { ...state.search.options, ...patch } } }));
  }

  async runSearch() {
    const root = this.state.root;
    const options = this.state.search.options;
    const token = ++this.searchToken;
    if (!root || options.query.length < 1) {
      this.set((state) => ({ search: { ...EMPTY_SEARCH, options: state.search.options } }));
      return;
    }
    const split = (value: string) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    this.set({ search: { ...EMPTY_SEARCH, options, running: true } });
    const pending: SearchState["results"] = [];
    let total = 0;
    const flush = () => {
      window.clearTimeout(this.searchFlush);
      this.searchFlush = 0;
      if (token !== this.searchToken) return;
      this.set((state) => ({ search: { ...state.search, results: [...pending], total } }));
    };
    const onEvent = (event: SearchEvent) => {
      if (token !== this.searchToken) return;
      if (event.event === "matches") {
        for (const match of event.matches) {
          let group = pending.find((item) => item.rel === match.path);
          if (!group) {
            group = { path: joinPath(root, match.path), rel: match.path, matches: [] };
            pending.push(group);
          }
          group.matches.push(match);
          total++;
        }
        if (!this.searchFlush) this.searchFlush = window.setTimeout(flush, 50);
      } else {
        flush();
        this.set((state) => ({ search: { ...state.search, running: false, files: event.files, truncated: event.truncated, total: event.total } }));
      }
    };
    try {
      await this.backend.search(root, { pattern: options.query, regex: options.regex, caseSensitive: options.caseSensitive, wholeWord: options.wholeWord, include: split(options.include), exclude: split(options.exclude), maxResults: 5000 }, onEvent);
    } catch (error) {
      if (token === this.searchToken) this.set((state) => ({ search: { ...state.search, running: false, error: message(error) } }));
    }
  }

  stopSearch() {
    void this.backend.cancelSearch().catch(() => {});
    this.searchToken++;
    this.set((state) => ({ search: { ...state.search, running: false } }));
  }

  openMatch(fileIndex: number, matchIndex: number, focus = true) {
    const group = this.state.search.results[fileIndex];
    const match = group?.matches[matchIndex];
    if (!group || !match) return;
    this.set((state) => ({ search: { ...state.search, cursor: [fileIndex, matchIndex] } }));
    void this.openFile(group.path, { line: match.line, column: match.column, length: match.length, focus, preview: !focus });
  }

  /** F4 / Shift+F4: the next or previous match. */
  stepMatch(step: 1 | -1) {
    const { results, cursor } = this.state.search;
    const flat = results.flatMap((group, fileIndex) => group.matches.map((_, matchIndex) => [fileIndex, matchIndex] as [number, number]));
    if (!flat.length) return;
    const at = cursor ? flat.findIndex(([f, m]) => f === cursor[0] && m === cursor[1]) : -1;
    const [f, m] = flat[(at + step + flat.length) % flat.length];
    this.openMatch(f, m);
  }

  // ── git ────────────────────────────────────────────────────────────────

  private scheduleGitRefresh() {
    window.clearTimeout(this.gitTimer);
    this.gitTimer = window.setTimeout(() => void this.refreshGit(), GIT_REFRESH_MS);
  }

  async refreshGit() {
    const root = this.state.root;
    if (!root) return;
    this.set((state) => ({ git: { ...state.git, loading: true } }));
    try {
      const status = await this.backend.git.status(root);
      if (this.state.root === root) this.set((state) => ({ git: { ...state.git, status, loading: false, error: null } }));
    } catch (error) {
      if (this.state.root === root) this.set((state) => ({ git: { ...state.git, loading: false, error: message(error) } }));
    }
  }

  /** Absolute path of a change from `git status`. */
  gitPath(change: GitChange) {
    const status = this.state.git.status;
    return status ? joinPath(status.repoRoot, change.path) : change.path;
  }

  private async git<T>(busy: string, run: (root: string) => Promise<T>, done?: (result: T) => string | null): Promise<T | null> {
    const root = this.state.root;
    if (!root || this.state.git.busy) return null;
    this.set((state) => ({ git: { ...state.git, busy } }));
    try {
      const result = await run(root);
      const text = done?.(result);
      if (text) this.notify(text);
      return result;
    } catch (error) {
      this.notify(message(error), "error");
      return null;
    } finally {
      this.set((state) => ({ git: { ...state.git, busy: null } }));
      void this.refreshGit();
    }
  }

  stage = (paths: string[]) => this.git("stage", (root) => this.backend.git.stage(root, paths));
  unstage = (paths: string[]) => this.git("unstage", (root) => this.backend.git.unstage(root, paths));
  stageAll = () => this.git("stage", (root) => this.backend.git.stageAll(root));
  unstageAll = () => this.git("unstage", (root) => this.backend.git.unstageAll(root));

  discard(paths: string[], label: string) {
    this.ask({
      kind: "confirm",
      label: `Descartar as alterações de ${label}? (arquivos novos vão para a Lixeira)`,
      choices: [
        { key: "s", label: "descartar", run: () => void this.git("discard", (root) => this.backend.git.discard(root, paths), () => "Alterações descartadas") },
        { key: "n", label: "cancelar", run: () => undefined },
      ],
    });
  }

  discardAll() {
    this.ask({
      kind: "confirm",
      label: "Reverter tudo para o último commit?",
      choices: [
        { key: "s", label: "só os rastreados", run: () => void this.git("discard", (root) => this.backend.git.discardAll(root, false), () => "Alterações revertidas") },
        { key: "t", label: "também os novos (Lixeira)", run: () => void this.git("discard", (root) => this.backend.git.discardAll(root, true), () => "Tudo revertido") },
        { key: "n", label: "cancelar", run: () => undefined },
      ],
    });
  }

  askCommit() {
    const status = this.state.git.status;
    if (!status) return;
    if (!status.staged.length) return this.notify("Nenhuma alteração em stage: use [Stage tudo] ou espaço num arquivo", "error");
    this.ask({
      kind: "input",
      label: `Commit em ${status.branch ?? "HEAD"} (${status.staged.length} ${status.staged.length === 1 ? "arquivo" : "arquivos"}):`,
      value: "",
      submit: (text) => {
        if (!text.trim()) return this.notify("Escreva a mensagem do commit", "error");
        void this.git("commit", (root) => this.backend.git.commit(root, text.trim(), false), (hash) => `Commit ${hash}`);
      },
    });
  }

  push = () => this.git("push", (root) => this.backend.git.push(root), (text) => text || "Push concluído");
  pull = () => this.git("pull", (root) => this.backend.git.pull(root), (text) => text || "Pull concluído");
  fetch = () => this.git("fetch", (root) => this.backend.git.fetch(root), () => "Fetch concluído");

  async openDiff(change: GitChange, staged: boolean) {
    const result = await this.git("diff", (root) => this.backend.git.diff(root, change.path, staged));
    if (!result) return;
    const text = result.binary ? "Arquivo binário: sem diff de texto." : result.text || "Sem diferenças.";
    this.openVirtual(`virtual:diff:${staged ? "staged" : "work"}:${change.path}`, `${baseName(change.path)} (${staged ? "stage" : "diff"})`, text + (result.truncated ? "\n… (cortado)" : ""), DIFF.name);
  }

  /** The whole working tree against the last commit, in one tab. */
  async openFullDiff() {
    const status = this.state.git.status;
    if (!status) return;
    const changes = [...status.staged.map((change) => [change, true] as const), ...status.unstaged.map((change) => [change, false] as const)];
    if (!changes.length && !status.untracked.length) return this.notify("Nada mudou desde o último commit");
    const parts: string[] = [];
    for (const [change, staged] of [...changes, ...status.untracked.map((change) => [change, false] as const)]) {
      const result = await this.git("diff", (root) => this.backend.git.diff(root, change.path, staged));
      if (result?.text) parts.push(result.text.trimEnd());
    }
    this.openVirtual("virtual:diff:all", "diff (tudo)", parts.join("\n\n") || "Sem diferenças.", DIFF.name);
  }

  async openLog() {
    const commits = await this.git("log", (root) => this.backend.git.log(root, 200, 0));
    if (!commits) return;
    const text = commits.length
      ? commits.map((commit) => `${commit.short}  ${formatDateTime(commit.time)}  ${commit.author.padEnd(14)}  ${commit.subject}${commit.refs ? `  (${commit.refs})` : ""}`).join("\n")
      : "Nenhum commit ainda.";
    this.set((state) => ({ git: { ...state.git, log: commits } }));
    this.openVirtual("virtual:log", "git log", text, null);
  }

  async loadStashes() {
    const stashes = await this.git("stash", (root) => this.backend.git.stashList(root));
    if (stashes) this.set((state) => ({ git: { ...state.git, stashes } }));
    return stashes ?? [];
  }

  stashPush() {
    this.ask({
      kind: "input",
      label: "Guardar as alterações no stash (mensagem opcional):",
      value: "",
      submit: (text) => void this.git("stash", (root) => this.backend.git.stashPush(root, text.trim() || null, true), () => "Alterações guardadas no stash"),
    });
  }

  stashPop = (index: number) => this.git("stash", (root) => this.backend.git.stashPop(root, index), () => "Stash aplicado");
  stashDrop = (index: number) => this.git("stash", (root) => this.backend.git.stashDrop(root, index), () => "Stash descartado");

  async loadBranches() {
    const branches = await this.git("branches", (root) => this.backend.git.branches(root));
    if (branches) this.set((state) => ({ git: { ...state.git, branches } }));
    return branches ?? [];
  }

  checkout = (branch: string) => this.git("checkout", (root) => this.backend.git.checkout(root, branch, false), () => `No branch ${branch}`);

  askNewBranch() {
    this.ask({
      kind: "input",
      label: "Novo branch (a partir do atual):",
      value: "",
      submit: (name) => {
        if (name.trim()) void this.git("checkout", (root) => this.backend.git.checkout(root, name.trim(), true), () => `Branch ${name.trim()} criado`);
      },
    });
  }
}

/** Language extension for code that needs one outside a tab (tests, previews). */
export type { Extension };
