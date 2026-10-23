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
