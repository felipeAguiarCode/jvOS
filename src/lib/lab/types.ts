/** One piece of terminal output; `delay` (ms) waits before it, to stream tokens or "think". */
export interface Chunk {
  text: string;
  delay?: number;
}

/** What a command returns: text printed at once, or chunks played in order. */
export type Output = string | Chunk[];

/** `llm gen "O céu é" --temperature 0` → name "llm", args ["gen", "O céu é"], flags { temperature: "0" }. */
export interface ParsedLine {
  name: string;
  args: string[];
  /** `--k v` and `--k=v` give "v"; a bare `--k` gives true. */
  flags: Record<string, string | true>;
}

export interface LabContext {
  /** What the lesson's commands remember during one terminal session (a trained model, runs so far…). */
  state: Map<string, unknown>;
  /** Terminal width, to wrap long lines. */
  cols: number;
}

export interface LabCommand {
  /** One line for `help`. */
  summary: string;
  /** Shown by `help <name>` and after a usage error. */
  usage: string;
  /** Words Tab completes after the command (`llm g` → `llm gen`). */
  subcommands?: string[];
  /** Throws `LabError` for bad arguments; the step check is then skipped. */
  run(line: ParsedLine, ctx: LabContext): Output;
}

/** A challenge: the terminal waits for a command that passes `check`. */
export interface Step {
  id: string;
  /** What to do, in Portuguese. */
  goal: string;
  /** The exact command that completes it. */
  hint: string;
  /** Called after the command ran without errors. */
  check(line: ParsedLine, ctx: LabContext): boolean;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  commands: Record<string, LabCommand>;
  steps: Step[];
}

/** A command's arguments were wrong: printed in red, followed by its usage. */
export class LabError extends Error {}
