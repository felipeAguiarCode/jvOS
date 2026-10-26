/**
 * Path helpers for the IDE. Paths are absolute and in the platform's own form (Windows: "C:\…");
 * paths relative to a folder use "/" — that is what the workspace backend takes and returns.
 */

const windowsLike = (path: string) => /^[A-Za-z]:/.test(path) || path.startsWith("\\\\") || path.includes("\\");

export const separatorOf = (path: string) => (windowsLike(path) ? "\\" : "/");

/** Windows paths compare case-insensitively. */
const key = (path: string) => (windowsLike(path) ? path.toLowerCase() : path);

const trimEnd = (path: string) => (isVolumeRoot(path) ? path : path.replace(/[\\/]+$/, ""));

/** "C:\", "C:" or "/": nothing above it. */
export const isVolumeRoot = (path: string) => /^[A-Za-z]:[\\/]?$/.test(path) || path === "/";

/** An absolute folder plus a relative path ("" is the folder itself). */
export function joinPath(dir: string, rel: string): string {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (!parts.length) return dir;
  const separator = separatorOf(dir);
  const base = trimEnd(dir);
  return `${base.endsWith(separator) ? base : base + separator}${parts.join(separator)}`;
}

export function baseName(path: string): string {
  const trimmed = trimEnd(path);
  if (isVolumeRoot(trimmed)) return trimmed;
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

/** The folder holding `path`; a volume root is its own parent. */
export function dirName(path: string): string {
  const trimmed = trimEnd(path);
  if (isVolumeRoot(trimmed)) return trimmed;
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (index < 0) return trimmed;
  const head = trimmed.slice(0, index);
  if (/^[A-Za-z]:$/.test(head)) return `${head}\\`;
  return head || "/";
}

export const samePath = (a: string, b: string) => key(trimEnd(a)) === key(trimEnd(b));

/** `path` relative to `root` with "/" ("" for the root itself), or null when it is outside. */
export function relativePath(root: string, path: string): string | null {
  const base = trimEnd(root);
  if (samePath(base, path)) return "";
  const separator = separatorOf(base);
  const prefix = base.endsWith(separator) ? base : base + separator;
  if (!key(path).startsWith(key(prefix))) return null;
  return path.slice(prefix.length).split(/[\\/]/).filter(Boolean).join("/");
}

export const isInside = (root: string, path: string) => relativePath(root, path) !== null;

/** "C:" of "C:\projetos", or null (UNC, POSIX). */
export function driveOf(path: string): string | null {
  const match = /^([A-Za-z]:)/.exec(path);
  return match ? match[1].toUpperCase() : null;
}

/** File extension without the dot, lower case ("" when none; dotfiles have none). */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
