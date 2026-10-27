import type { TerminalBackend, TerminalProfile } from "../terminal";
import { CLEAR, cyan, green } from "./ansi";
import { createSession, type LabSession } from "./engine";
import type { Chunk, Lesson } from "./types";

/** The lab's only "shell", for TerminalView. */
export const LAB_PROFILE: TerminalProfile = { id: "jv-lab", name: "jv_lab", commandline: "jv_lab", cwd: "~" };

interface Shell {
  session: LabSession;
  /** What is typed at the prompt. */
  line: string;
  history: string[];
  /** Where ↑/↓ are in the history; `history.length` is the line being typed. */
  browsing: number;
  /** The line being typed, kept while browsing the history. */
  draft: string;
  /** Output still playing: meanwhile, typing waits in `ahead` and only Ctrl+C acts. */
  timers: number[];
  /** Typed ahead while a command was playing; read once the prompt is back. */
  ahead: string;
}

export interface LabBackendOptions {
  /** The lesson's challenges already completed, read when a terminal opens. */
  done: () => readonly string[];
  onStep: (stepId: string) => void;
}

/** ↑ and ↓ in normal and application cursor mode; any other escape sequence is ignored. */
const ESCAPE = /^\x1b(?:\[[0-9;?]*[@-~]|O[@-~])?/;
const UP = new Set(["\x1b[A", "\x1bOA"]);
const DOWN = new Set(["\x1b[B", "\x1bOB"]);

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

/**
 * A pretend shell for one lesson, in the shape of the real terminals' backend: a line editor
 * (history, Tab, Ctrl+C, Ctrl+L) over `createSession`, whose output plays with its delays.
 */
export function labBackend(lesson: Lesson, options: LabBackendOptions): TerminalBackend {
  const outputs = new Set<(id: number, data: string) => void>();
  const exits = new Set<(id: number, code: number | null) => void>();
  const shells = new Map<number, Shell>();
  const prompt = `${green("aluno@jv-lab")} ${cyan(`~/${lesson.id}`)} $ `;
  let next = 0;

  const emit = (id: number, data: string) => data && outputs.forEach((listener) => listener(id, data));
  const redraw = (shell: Shell) => `\r\x1b[K${prompt}${shell.line}`;

  const play = (id: number, shell: Shell, chunks: Chunk[]) => {
    let at = 0;
    for (const chunk of chunks) {
      at += chunk.delay ?? 0;
      shell.timers.push(window.setTimeout(() => emit(id, crlf(chunk.text)), at));
    }
    shell.timers.push(
      window.setTimeout(() => {
        shell.timers = [];
        emit(id, prompt + shell.line);
        const ahead = shell.ahead;
        shell.ahead = "";
        if (ahead) type(id, shell, ahead);
      }, at),
    );
  };

  const stop = (shell: Shell) => {
    shell.timers.forEach((timer) => window.clearTimeout(timer));
    shell.timers = [];
  };

  const browse = (shell: Shell, step: number) => {
    const target = shell.browsing + step;
    if (target < 0 || target > shell.history.length) return "";
    if (shell.browsing === shell.history.length) shell.draft = shell.line;
    shell.browsing = target;
    shell.line = target === shell.history.length ? shell.draft : shell.history[target];
    return redraw(shell);
  };

  const complete = (shell: Shell) => {
    const { line, options } = shell.session.complete(shell.line);
    if (line !== shell.line) {
      shell.line = line;
      return redraw(shell);
    }
    return options.length > 1 ? `\r\n${options.join("  ")}\r\n${prompt}${shell.line}` : "";
  };

  /** The line editor: keys and pasted text at the prompt. */
  function type(id: number, shell: Shell, data: string) {
    const chars = Array.from(data);
    let out = "";
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (char === "\x1b") {
        const sequence = ESCAPE.exec(chars.slice(i, i + 12).join(""))![0];
        i += Array.from(sequence).length - 1;
        if (UP.has(sequence)) out += browse(shell, -1);
        else if (DOWN.has(sequence)) out += browse(shell, 1);
      } else if (char === "\r") {
        const text = shell.line;
        shell.line = "";
        shell.draft = "";
        if (text.trim() && shell.history[shell.history.length - 1] !== text) shell.history.push(text);
        shell.browsing = shell.history.length;
        emit(id, `${out}\r\n`);
        // What comes after the Enter (a paste of several lines) waits for this command.
        shell.ahead = chars.slice(i + 1).join("") + shell.ahead;
        play(id, shell, shell.session.run(text));
        return;
      } else if (char === "\x7f" || char === "\b") {
        if (shell.line) out += "\b \b";
        shell.line = Array.from(shell.line).slice(0, -1).join("");
      } else if (char === "\t") {
        out += complete(shell);
      } else if (char === "\x03") {
        shell.line = "";
        out += `^C\r\n${prompt}`;
      } else if (char === "\x0c") {
        out += CLEAR + prompt + shell.line;
      } else if (char === "\x15") {
        shell.line = "";
        out += redraw(shell);
      } else if (char >= " ") {
        shell.line += char;
        out += char;
      }
    }
    emit(id, out);
  }

  return {
    profiles: async () => ({ profiles: [LAB_PROFILE], default: LAB_PROFILE.id }),

    async open(_profile, cols) {
      const id = ++next;
      const session = createSession(lesson, options.done(), (stepId) => options.onStep(stepId), cols);
      shells.set(id, { session, line: "", history: [], browsing: 0, draft: "", timers: [], ahead: "" });
      // After `open` answers: the session router holds output that comes before its id.
      window.setTimeout(() => shells.has(id) && emit(id, crlf(session.welcome().map((chunk) => chunk.text).join("")) + prompt), 0);
      return id;
    },

    write(id, data) {
      const shell = shells.get(id);
      if (!shell) return;
      if (!shell.timers.length) return type(id, shell, data);
      if (!data.includes("\x03")) {
        shell.ahead += data;
        return;
      }
      // Ctrl+C stops the command and drops what was typed ahead.
      stop(shell);
      shell.line = "";
      shell.ahead = "";
      emit(id, `\x1b[0m^C\r\n${prompt}`);
    },

    resize: (id, cols) => shells.get(id)?.session.resize(cols),

    close(id) {
      const shell = shells.get(id);
      if (shell) stop(shell);
      shells.delete(id);
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
