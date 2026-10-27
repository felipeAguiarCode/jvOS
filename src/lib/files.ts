import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Real files need the desktop app; the browser keeps drafts only. */
export const canUseFiles = isTauri();

export const UNAVAILABLE = "Disponível no app desktop";

/** Native "open" dialog, then the file's text through the backend (absolute path, UTF-8, ≤ 2 MB). */
export async function pickAndRead(filters: FileFilter[], title: string): Promise<{ path: string; contents: string } | null> {
  const path = await open({ multiple: false, directory: false, filters, title });
  if (typeof path !== "string") return null;
  const contents = await invoke<string>("read_text_file", { path });
  return { path, contents };
}

/** Writes to `path`, or asks where to save when there is none. Returns the path written, or null if cancelled. */
export async function pickAndWrite(
  path: string | null,
  contents: string,
  filters: FileFilter[],
  defaultPath: string,
  title: string,
): Promise<string | null> {
  const target = path ?? (await save({ filters, defaultPath, title }));
  if (!target) return null;
  await invoke("write_text_file", { path: target, contents });
  return target;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** A file's text through the backend (absolute path, UTF-8, ≤ 2 MB). */
export const readText = (path: string) => invoke<string>("read_text_file", { path });

/** Writes a file through the backend (atomically). */
export const writeText = (path: string, contents: string) => invoke<void>("write_text_file", { path, contents });

/** Native "choose a folder" dialog. */
export async function pickFolder(title: string): Promise<string | null> {
  const path = await open({ multiple: false, directory: true, title });
  return typeof path === "string" ? path : null;
}

/** Native "choose a file" dialog (any file). */
export async function pickAnyFile(title: string): Promise<string | null> {
  const path = await open({ multiple: false, directory: false, title });
  return typeof path === "string" ? path : null;
}

const windowsPath = (path: string) => path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** The same file on Windows, whatever the slashes and the letter case. */
export const samePath = (a: string, b: string) => windowsPath(a) === windowsPath(b);

/** Whether `path` lies inside `folder` (Windows rules). */
export const isInside = (path: string, folder: string) => windowsPath(path).startsWith(`${windowsPath(folder)}\\`);
