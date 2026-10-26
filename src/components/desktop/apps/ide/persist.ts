import { readJson, writeJson } from "../../../../lib/storage";
import type { Encoding, Eol } from "../../../../lib/workspace";
import { DEFAULT_LAYOUT, parseLayout } from "./layout";
import type { Bookmark, IdeLayout, IdePrefs, ProjectSession } from "./types";

/** `jarvis.ide`: the project, recents, favourites, options, layout and each project's tabs. */
export const IDE_KEY = "jarvis.ide";
/** `jarvis.ide.drafts`: unsaved edits, so closing the window loses nothing. */
export const DRAFTS_KEY = "jarvis.ide.drafts";
/** The old Jarvis Code's draft, moved into jv_ide once. */
const OLD_CODE_KEY = "jarvis.editor.code";

export const MAX_RECENT = 12;
export const MAX_BOOKMARKS = 50;
export const MAX_DRAFT = 512 * 1024;
export const MAX_DRAFTS = 2 * 1024 * 1024;

export const DEFAULT_PREFS: IdePrefs = {
  wrap: false,
  fontSize: 13,
  defaultTab: 4,
  showHidden: true,
  hideIgnored: false,
  effects: true,
  autoSave: false,
  blockCursor: false,
};

export interface PersistedIde {
  version: 1;
  root: string | null;
  recent: string[];
  bookmarks: Bookmark[];
  prefs: IdePrefs;
  layout: IdeLayout;
  sessions: Record<string, ProjectSession>;
}

export interface Draft {
  text: string;
  /** The file's modified time the edits were based on; null for untitled tabs. */
  base: number | null;
  eol: Eol;
  encoding: Encoding;
}

/** By project root ("-" without one), then by path or "untitled:N". */
export type Drafts = Record<string, Record<string, Draft>>;

const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max) : [];

function parsePrefs(raw: unknown): IdePrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof IdePrefs) => (typeof p[key] === "boolean" ? (p[key] as boolean) : (DEFAULT_PREFS[key] as boolean));
  return {
    wrap: bool("wrap"),
    fontSize: [12, 13, 14, 15].includes(p.fontSize as number) ? (p.fontSize as IdePrefs["fontSize"]) : DEFAULT_PREFS.fontSize,
    defaultTab: [2, 4, 8].includes(p.defaultTab as number) ? (p.defaultTab as IdePrefs["defaultTab"]) : DEFAULT_PREFS.defaultTab,
    showHidden: bool("showHidden"),
    hideIgnored: bool("hideIgnored"),
    effects: bool("effects"),
    autoSave: bool("autoSave"),
    blockCursor: bool("blockCursor"),
  };
}

function parseSession(raw: unknown): ProjectSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const tabs = Array.isArray(s.tabs)
    ? s.tabs
        .filter((tab): tab is { path: string; pinned?: unknown } => !!tab && typeof tab === "object" && typeof (tab as { path?: unknown }).path === "string")
        .slice(0, 50)
        .map((tab) => ({ path: tab.path, pinned: tab.pinned !== false }))
    : [];
  const cursors: ProjectSession["cursors"] = {};
  if (s.cursors && typeof s.cursors === "object") {
    for (const [path, cursor] of Object.entries(s.cursors as Record<string, unknown>)) {
      const { anchor, head } = (cursor ?? {}) as Record<string, unknown>;
      if (typeof anchor === "number" && typeof head === "number") cursors[path] = { anchor, head };
    }
  }
  return {
    tabs,
    active: typeof s.active === "string" ? s.active : null,
    cursors,
    expanded: strings(s.expanded, 200),
    viewRoot: typeof s.viewRoot === "string" ? s.viewRoot : null,
    mru: strings(s.mru, 50),
  };
}

function parseIde(raw: unknown): PersistedIde | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const recent = strings(r.recent, MAX_RECENT);
  const sessions: Record<string, ProjectSession> = {};
  if (r.sessions && typeof r.sessions === "object") {
    for (const [root, session] of Object.entries(r.sessions as Record<string, unknown>)) {
      const parsed = parseSession(session);
      if (parsed) sessions[root] = parsed;
    }
  }
  return {
    version: 1,
    root: typeof r.root === "string" ? r.root : null,
    recent,
    bookmarks: Array.isArray(r.bookmarks)
      ? r.bookmarks
          .filter((item): item is Bookmark => !!item && typeof item === "object" && typeof (item as Bookmark).path === "string")
          .slice(0, MAX_BOOKMARKS)
          .map((item) => ({ path: item.path, dir: item.dir === true }))
      : [],
    prefs: parsePrefs(r.prefs),
    layout: parseLayout(r.layout) ?? DEFAULT_LAYOUT,
    sessions,
  };
}

export const EMPTY_IDE: PersistedIde = { version: 1, root: null, recent: [], bookmarks: [], prefs: DEFAULT_PREFS, layout: DEFAULT_LAYOUT, sessions: {} };

export const readIde = () => readJson(IDE_KEY, parseIde);

export function writeIde(value: PersistedIde) {
  // Only the projects still in the recents keep their tabs.
  const sessions = Object.fromEntries(Object.entries(value.sessions).filter(([root]) => value.recent.includes(root) || root === value.root));
  return writeJson(IDE_KEY, { ...value, sessions });
}

function parseDrafts(raw: unknown): Drafts | null {
  if (!raw || typeof raw !== "object") return null;
  const drafts = (raw as { drafts?: unknown }).drafts;
  if (!drafts || typeof drafts !== "object") return null;
  const clean: Drafts = {};
  for (const [root, files] of Object.entries(drafts as Record<string, unknown>)) {
    if (!files || typeof files !== "object") continue;
    for (const [path, draft] of Object.entries(files as Record<string, unknown>)) {
      const d = (draft ?? {}) as Record<string, unknown>;
      if (typeof d.text !== "string") continue;
      (clean[root] ??= {})[path] = {
        text: d.text,
        base: typeof d.base === "number" ? d.base : null,
        eol: d.eol === "crlf" ? "crlf" : "lf",
        encoding: (["utf8", "utf8bom", "utf16le", "utf16be", "windows1252"] as const).includes(d.encoding as Encoding) ? (d.encoding as Encoding) : "utf8",
      };
    }
  }
  return clean;
}

export const readDrafts = (): Drafts => readJson(DRAFTS_KEY, parseDrafts) ?? {};

export const writeDrafts = (drafts: Drafts) => writeJson(DRAFTS_KEY, { version: 1, drafts });

/** The old Jarvis Code draft, if it had unsaved text; the key is removed either way. */
export function takeOldCodeDraft(): string | null {
  try {
    const raw = localStorage.getItem(OLD_CODE_KEY);
    if (raw === null) return null;
    localStorage.removeItem(OLD_CODE_KEY);
    const { content, savedContent } = JSON.parse(raw) as { content?: unknown; savedContent?: unknown };
    return typeof content === "string" && content.trim() && content !== savedContent ? content : null;
  } catch {
    return null;
  }
}
