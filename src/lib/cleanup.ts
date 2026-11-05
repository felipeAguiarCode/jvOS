import { invoke, isTauri } from "@tauri-apps/api/core";
import { line } from "./jarvisLines";

/** What the memory cleanup did with Claude Code. Mirrors `Sleep` in `src-tauri/src/assistant.rs`. */
export type Cleanup = { outcome: "stopped"; freed: number } | { outcome: "busy" } | { outcome: "idle" };

declare global {
  interface Window {
    /** Development-only: what the memory cleanup reports in the browser tests. */
    __JARVIS_CLEANUP__?: Cleanup;
  }
}

/**
 * "Limpa a memória", "ativa o garbage collector": Claude Code, when idle, stops and gives its RAM
 * back; it comes back on the next question, on the same conversation. Null outside the desktop app.
 */
export async function cleanMemory(): Promise<Cleanup | null> {
  if (isTauri()) return invoke<Cleanup>("assistant_sleep");
  return (import.meta.env.DEV && window.__JARVIS_CLEANUP__) || null;
}

/** "215 MB", "1,2 GB". */
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** "215 megabytes", "1,2 gigabytes": as JARVIS says it. */
export const spokenBytes = (bytes: number) => formatBytes(bytes).replace(/MB$/, "megabytes").replace(/GB$/, "gigabytes");

/** What JARVIS says about it. */
export function cleanupLine(result: Cleanup, name: string) {
  if (result.outcome === "busy") return line("cleanupBusy", name);
  if (result.outcome === "idle") return line("cleanupIdle", name);
  // Its RAM could not be read: stopped all the same.
  if (!(result.freed > 0)) return line("cleanupStopped", name);
  return line("cleanupDone", name, { freed: spokenBytes(result.freed) });
}

/** …and what the settings show under the button. */
export function cleanupSummary(result: Cleanup) {
  if (result.outcome === "busy") return "O Claude Code está respondendo agora. Tente de novo quando ele terminar.";
  if (result.outcome === "idle") return "Nada a liberar: o Claude Code já estava parado.";
  const freed = result.freed > 0 ? `${formatBytes(result.freed)} de RAM liberados` : "Claude Code encerrado";
  return `${freed}. Ele volta na próxima pergunta, na mesma conversa.`;
}
