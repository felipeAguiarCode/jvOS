import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A shell the user can open: one of their Windows Terminal profiles. Mirrors src-tauri/src/terminal.rs. */
export interface TerminalProfile {
  id: string;
  name: string;
  commandline: string;
  cwd: string;
  /** Not a shell: one of the user's Claude Code agents run once (`claude --agent <name> "<task>"` in `cwd`). */
  agent?: { name: string; task: string };
}

export interface TerminalProfiles {
  profiles: TerminalProfile[];
  /** The profile new tabs use (Windows Terminal's default). */
  default: string | null;
}

/** The link to the shells: the real ones in the desktop app, a fake echo one in dev tests. */
export interface TerminalBackend {
  profiles(): Promise<TerminalProfiles>;
  /** Starts a shell; `cwd` (absolute) replaces the profile's starting folder. With `agent`, runs that agent in `cwd` instead. */
  open(profile: string, cols: number, rows: number, cwd?: string | null, agent?: TerminalProfile["agent"]): Promise<number>;
  write(id: number, data: string): void;
  resize(id: number, cols: number, rows: number): void;
  close(id: number): void;
  /** Output and exits of every session; only the session router (`openSession`) listens. */
  subscribe(onOutput: (id: number, data: string) => void, onExit: (id: number, code: number | null) => void): TerminalSubscription;
}

export interface TerminalSubscription {
  /** Resolves once events flow (Tauri registers its listeners asynchronously). */
  ready: Promise<void>;
  stop(): void;
}

declare global {
  interface Window {
    /** Development-only: a fake echo shell for the browser tests (set to true to use it). */
    __JARVIS_TERMINAL__?: boolean;
    /** …and what it was asked to do, for the tests to check. */
    __JARVIS_TERMINAL_LOG__?: { opens: string[]; cwds: (string | null)[]; writes: string[]; resizes: [number, number, number][]; closes: number[] };
  }
}

const tauriBackend: TerminalBackend = {
  profiles: () => invoke<TerminalProfiles>("terminal_profiles"),
  open: (profile, cols, rows, cwd, agent) =>
    agent
      ? invoke<number>("terminal_open_agent", { name: agent.name, task: agent.task, cwd: cwd ?? "", cols, rows })
      : invoke<number>("terminal_open", { profile, cols, rows, cwd: cwd ?? null }),
  write: (id, data) => void invoke("terminal_write", { id, data }).catch(() => {}),
  resize: (id, cols, rows) => void invoke("terminal_resize", { id, cols, rows }).catch(() => {}),
  close: (id) => void invoke("terminal_close", { id }).catch(() => {}),
  subscribe(onOutput, onExit) {
    const subscriptions = [
      listen<{ id: number; data: string }>("terminal:output", ({ payload }) => onOutput(payload.id, payload.data)),
      listen<{ id: number; code: number | null }>("terminal:exit", ({ payload }) => onExit(payload.id, payload.code)),
    ];
    return {
      ready: Promise.all(subscriptions).then(() => undefined),
      stop: () => subscriptions.forEach((subscription) => void subscription.then((stop) => stop())),
    };
  },
};

/** What the profile's shell shows in `cwd` (its home when there is none). */
function fakePrompt(profile: string, cwd?: string | null) {
  if (profile === "fake-bash") return `builder@jarvis ${cwd ? `/${cwd[0].toLowerCase()}${cwd.slice(2).replace(/\\/g, "/")}` : "~"} $ `;
  return `PS ${cwd ?? "C:\\Users\\builder"}> `;
}

/**
 * A pretend shell for the browser tests: a prompt, echo of what is typed, "exit [code]".
 * Not a terminal emulator — just enough to drive the UI.
 */
function fakeBackend(): TerminalBackend {
  const log = (window.__JARVIS_TERMINAL_LOG__ ??= { opens: [], cwds: [], writes: [], resizes: [], closes: [] });
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
    async open(profile, cols, rows, cwd, agent) {
      const id = ++next;
      log.opens.push(agent ? `agent:${agent.name}` : profile);
      log.cwds.push(cwd ?? null);
      log.resizes.push([id, cols, rows]);
      prompts.set(id, agent ? "> " : fakePrompt(profile, cwd));
      lines.set(id, "");
      const banner = agent ? `claude --agent ${agent.name} "${agent.task}"` : (profiles.profiles.find((item) => item.id === profile)?.name ?? profile);
      emit(id, `${banner} (simulado)\r\n${prompts.get(id)}`);
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
      return {
        ready: Promise.resolve(),
        stop: () => {
          outputs.delete(onOutput);
          exits.delete(onExit);
        },
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

/** Output for a session nobody claimed yet waits this long, and keeps at most this much. */
const HOLD_MS = 10_000;
const HOLD_CHARS = 256 * 1024;

/** Where one session's events go. */
export interface SessionSink {
  output(data: string): void;
  exit(code: number | null): void;
}

export interface TerminalSession {
  id: number;
  /** Stops listening, then ends the shell. */
  close(): void;
}

interface Held {
  chunks: string[];
  size: number;
  exit?: { code: number | null };
  timer: number;
}

/** One listener per backend that hands each session's events to whoever opened it. */
function createRouter(backend: TerminalBackend) {
  const sinks = new Map<number, SessionSink>();
  // Output can come before `open` answers with the id: it waits a little to be claimed.
  const held = new Map<number, Held>();
  const hold = (id: number) => {
    let entry = held.get(id);
    if (!entry) held.set(id, (entry = { chunks: [], size: 0, timer: window.setTimeout(() => held.delete(id), HOLD_MS) }));
    return entry;
  };
  const { ready } = backend.subscribe(
    (id, data) => {
      const sink = sinks.get(id);
      if (sink) return sink.output(data);
      const entry = hold(id);
      entry.chunks.push(data);
      entry.size += data.length;
      while (entry.size > HOLD_CHARS && entry.chunks.length > 1) entry.size -= entry.chunks.shift()!.length;
    },
    (id, code) => {
      const sink = sinks.get(id);
      sinks.delete(id);
      if (sink) sink.exit(code);
      else hold(id).exit = { code };
    },
  );
  return {
    ready,
    attach(id: number, sink: SessionSink) {
      const entry = held.get(id);
      held.delete(id);
      if (entry) window.clearTimeout(entry.timer);
      if (!entry?.exit) sinks.set(id, sink);
      entry?.chunks.forEach((data) => sink.output(data));
      if (entry?.exit) sink.exit(entry.exit.code);
    },
    detach: (id: number) => void sinks.delete(id),
  };
}

const routers = new WeakMap<TerminalBackend, ReturnType<typeof createRouter>>();

function routerFor(backend: TerminalBackend) {
  let router = routers.get(backend);
  if (!router) routers.set(backend, (router = createRouter(backend)));
  return router;
}

/**
 * Starts a shell whose output and exit reach `sink` only: jv_sh's tabs and jv_ide's panels
 * share one backend without seeing each other's sessions.
 */
export async function openSession(
  backend: TerminalBackend,
  profile: string,
  cols: number,
  rows: number,
  cwd: string | null | undefined,
  sink: SessionSink,
  agent?: TerminalProfile["agent"],
): Promise<TerminalSession> {
  const router = routerFor(backend);
  // Listening first: the shell's first words (banner, prompt) must not be lost.
  await router.ready;
  const id = await backend.open(profile, cols, rows, cwd, agent);
  router.attach(id, sink);
  return {
    id,
    close() {
      router.detach(id);
      backend.close(id);
    },
  };
}

/** A tab to open: a profile id, or a whole profile (an agent run by JARVIS). */
export type TabRequest = string | TerminalProfile;

// "Nova aba: <perfil>" from the search reaches jv_sh even before its window is open.
let pendingProfile: TabRequest | null = null;
const tabRequests = new Set<(profile: TabRequest) => void>();

/** Asks jv_sh for a new tab with `profile` (taken by the window when it opens, if it is closed). */
export function requestTab(profile: TabRequest) {
  if (tabRequests.size) tabRequests.forEach((listener) => listener(profile));
  else pendingProfile = profile;
}

export function onTabRequest(listener: (profile: TabRequest) => void): () => void {
  tabRequests.add(listener);
  return () => tabRequests.delete(listener);
}

/** A tab asked for while the window was closed, once. */
export function takePendingProfile(): TabRequest | null {
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
