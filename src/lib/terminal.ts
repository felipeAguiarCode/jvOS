import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A shell the user can open: one of their Windows Terminal profiles. Mirrors src-tauri/src/terminal.rs. */
export interface TerminalProfile {
  id: string;
  name: string;
  commandline: string;
  cwd: string;
}

export interface TerminalProfiles {
  profiles: TerminalProfile[];
  /** The profile new tabs use (Windows Terminal's default). */
  default: string | null;
}

/** jv_sh's link to its shells: the real ones in the desktop app, a fake echo one in dev tests. */
export interface TerminalBackend {
  profiles(): Promise<TerminalProfiles>;
  open(profile: string, cols: number, rows: number): Promise<number>;
  write(id: number, data: string): void;
  resize(id: number, cols: number, rows: number): void;
  close(id: number): void;
  /** Output and exits of every session; returns the unsubscribe. */
  subscribe(onOutput: (id: number, data: string) => void, onExit: (id: number, code: number | null) => void): () => void;
}

declare global {
  interface Window {
    /** Development-only: a fake echo shell for the browser tests (set to true to use it). */
    __JARVIS_TERMINAL__?: boolean;
    /** …and what it was asked to do, for the tests to check. */
    __JARVIS_TERMINAL_LOG__?: { opens: string[]; writes: string[]; resizes: [number, number, number][]; closes: number[] };
  }
}

const tauriBackend: TerminalBackend = {
  profiles: () => invoke<TerminalProfiles>("terminal_profiles"),
  open: (profile, cols, rows) => invoke<number>("terminal_open", { profile, cols, rows }),
  write: (id, data) => void invoke("terminal_write", { id, data }).catch(() => {}),
  resize: (id, cols, rows) => void invoke("terminal_resize", { id, cols, rows }).catch(() => {}),
  close: (id) => void invoke("terminal_close", { id }).catch(() => {}),
  subscribe(onOutput, onExit) {
    const subscriptions = [
      listen<{ id: number; data: string }>("terminal:output", ({ payload }) => onOutput(payload.id, payload.data)),
      listen<{ id: number; code: number | null }>("terminal:exit", ({ payload }) => onExit(payload.id, payload.code)),
    ];
    return () => subscriptions.forEach((subscription) => void subscription.then((stop) => stop()));
  },
};

/**
 * A pretend shell for the browser tests: a prompt, echo of what is typed, "exit [code]".
 * Not a terminal emulator — just enough to drive the UI.
 */
function fakeBackend(): TerminalBackend {
  const log = (window.__JARVIS_TERMINAL_LOG__ ??= { opens: [], writes: [], resizes: [], closes: [] });
  const outputs = new Set<(id: number, data: string) => void>();
  const exits = new Set<(id: number, code: number | null) => void>();
  const lines = new Map<number, string>();
  const prompts = new Map<number, string>();
  let next = 0;
  const emit = (id: number, data: string) => setTimeout(() => outputs.forEach((listener) => listener(id, data)), 0);
  const end = (id: number, code: number | null) => {
    lines.delete(id);
    setTimeout(() => exits.forEach((listener) => listener(id, code)), 0);
  };
  const profiles: TerminalProfiles = {
    profiles: [
      { id: "fake-powershell", name: "Windows PowerShell", commandline: "powershell.exe", cwd: "C:\\Users\\builder" },
      { id: "fake-bash", name: "Git Bash", commandline: "bash.exe --login -i", cwd: "C:\\Users\\builder" },
    ],
    default: "fake-powershell",
  };
  return {
    profiles: async () => profiles,
    async open(profile, cols, rows) {
      const id = ++next;
      log.opens.push(profile);
      log.resizes.push([id, cols, rows]);
      prompts.set(id, profile === "fake-bash" ? "builder@jarvis ~ $ " : "PS C:\\Users\\builder> ");
      lines.set(id, "");
      emit(id, `${profiles.profiles.find((item) => item.id === profile)?.name ?? profile} (simulado)\r\n${prompts.get(id)}`);
      return id;
    },
    write(id, data) {
      log.writes.push(data);
      if (!lines.has(id)) return;
      for (const char of data) {
        const line = lines.get(id) ?? "";
        if (char === "\r") {
          const [command, code] = line.trim().split(/\s+/);
          if (command === "exit") return end(id, Number(code ?? 0));
          lines.set(id, "");
          emit(id, `\r\n${line.trim() ? `eco: ${line.trim()}\r\n` : ""}${prompts.get(id)}`);
        } else if (char === "\x7f") {
          if (line) emit(id, "\b \b");
          lines.set(id, line.slice(0, -1));
        } else if (char >= " ") {
          lines.set(id, line + char);
          emit(id, char);
        }
      }
    },
    resize: (id, cols, rows) => void log.resizes.push([id, cols, rows]),
    close(id) {
      log.closes.push(id);
      if (lines.has(id)) end(id, null);
    },
    subscribe(onOutput, onExit) {
      outputs.add(onOutput);
      exits.add(onExit);
      return () => {
        outputs.delete(onOutput);
        exits.delete(onExit);
      };
    },
  };
}

let fake: TerminalBackend | null = null;

/** The backend in use, or null where there are no shells (a browser, outside the tests). */
export function terminalBackend(): TerminalBackend | null {
  if (isTauri()) return tauriBackend;
  if (import.meta.env.DEV && window.__JARVIS_TERMINAL__) return (fake ??= fakeBackend());
  return null;
}

// "Nova aba: <perfil>" from the search reaches jv_sh even before its window is open.
let pendingProfile: string | null = null;
const tabRequests = new Set<(profile: string) => void>();

/** Asks jv_sh for a new tab with `profile` (taken by the window when it opens, if it is closed). */
export function requestTab(profile: string) {
  if (tabRequests.size) tabRequests.forEach((listener) => listener(profile));
  else pendingProfile = profile;
}

export function onTabRequest(listener: (profile: string) => void): () => void {
  tabRequests.add(listener);
  return () => tabRequests.delete(listener);
}

/** A tab asked for while the window was closed, once. */
export function takePendingProfile(): string | null {
  const profile = pendingProfile;
  pendingProfile = null;
  return profile;
}

let cachedProfiles: TerminalProfiles | null = null;

/** The profiles, fetched once (the search lists them without opening the window). */
export async function loadProfiles(): Promise<TerminalProfiles | null> {
  const backend = terminalBackend();
  if (!backend) return null;
  cachedProfiles ??= await backend.profiles().catch(() => null);
  return cachedProfiles;
}
