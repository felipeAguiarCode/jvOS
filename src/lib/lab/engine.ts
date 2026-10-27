import { CLEAR, bold, cyan, gray, green, padEnd, red, yellow, wrap } from "./ansi";
import { parseLine } from "./parse";
import { LabError, type Chunk, type LabContext, type Lesson, type Output, type ParsedLine, type Step } from "./types";

/** Commands every lesson has, with their Portuguese aliases. */
const BUILTINS: { name: string; aliases: string[]; usage: string; summary: string }[] = [
  { name: "help", aliases: ["ajuda"], usage: "help [comando]", summary: "esta ajuda, ou o uso de um comando" },
  { name: "hint", aliases: ["dica"], usage: "hint", summary: "a dica do desafio atual" },
  { name: "status", aliases: ["progresso"], usage: "status", summary: "seus desafios nesta lição" },
  { name: "clear", aliases: ["limpar", "cls"], usage: "clear", summary: "limpa a tela" },
];

const builtinNamed = (name: string) => BUILTINS.find((builtin) => builtin.name === name || builtin.aliases.includes(name));

/** The command word of a step's hint ("llm" in `llm next "O céu é"`). */
const commandOf = (hint: string) => hint.split(" ")[0].toLowerCase();

/** Two wrong tries at the current challenge's command suggest `hint`. */
const MISSES_BEFORE_NUDGE = 2;

export interface Completion {
  /** The line after completing (unchanged when nothing or several things match). */
  line: string;
  /** Every match, listed when there are several. */
  options: string[];
}

export interface LabSession {
  /** The banner and the current challenge, shown when the terminal opens. */
  welcome(): Chunk[];
  /** Runs one line typed at the prompt; the output always ends with a line break. */
  run(text: string): Chunk[];
  /** Tab: the command (or its subcommand) being typed. */
  complete(text: string): Completion;
  resize(cols: number): void;
}

/**
 * One terminal session of a lesson: runs its commands and the built-ins, and checks each command
 * against the current challenge (the first one not done yet). `done` lists the challenges already
 * completed; `onStep` hears each new one.
 */
export function createSession(lesson: Lesson, done: readonly string[], onStep: (stepId: string) => void, cols = 80): LabSession {
  const completed = new Set(done.filter((id) => lesson.steps.some((step) => step.id === id)));
  const context: LabContext = { state: new Map(), cols };
  let misses = 0;

  const current = (): Step | null => lesson.steps.find((step) => !completed.has(step.id)) ?? null;
  const position = (step: Step) => `${lesson.steps.indexOf(step) + 1}/${lesson.steps.length}`;
  const goalLine = (step: Step) => wrap(`${cyan("→")} Desafio ${position(step)}: ${step.goal}`, context.cols);
  const finished = () =>
    wrap(`${bold(yellow("★ Lição concluída!"))} Os comandos continuam aqui para você praticar; escolha a próxima em “Lições”.`, context.cols);

  const help = (line: ParsedLine): string => {
    const topic = line.args[0]?.toLowerCase();
    if (topic) {
      const command = lesson.commands[topic];
      if (command) return `${bold(command.usage)}\n${wrap(command.summary, context.cols, "  ")}`;
      const builtin = builtinNamed(topic);
      if (builtin) return `${bold(builtin.usage)}\n  ${builtin.summary}`;
      throw new LabError(`não há o comando ${topic}`);
    }
    const names = [...Object.keys(lesson.commands), ...BUILTINS.map((builtin) => builtin.usage)];
    const width = Math.min(18, Math.max(...names.map((name) => name.length))) + 2;
    const row = (name: string, summary: string) => `  ${cyan(padEnd(name, width))}${summary}`;
    return [
      bold(`Comandos de “${lesson.title}”`),
      ...Object.entries(lesson.commands).map(([name, command]) => row(name, command.summary)),
      "",
      bold("Sempre disponíveis"),
      ...BUILTINS.map((builtin) => row(builtin.usage, builtin.summary)),
      "",
      gray(`${cyan("help <comando>")} mostra como usar cada um.`),
    ].join("\n");
  };

  const status = (): string =>
    [
      bold(`${lesson.title} · ${completed.size}/${lesson.steps.length} desafios`),
      ...lesson.steps.map((step) => {
        const mark = completed.has(step.id) ? green("✔") : step === current() ? cyan("▶") : gray("○");
        return wrap(`${mark} ${step.goal}`, context.cols, "  ");
      }),
    ].join("\n");

  const builtin = (line: ParsedLine): Output | null => {
    switch (builtinNamed(line.name)?.name) {
      case "help":
        return help(line);
      case "hint": {
        const step = current();
        if (!step) return finished();
        return `${goalLine(step)}\n${yellow("dica:")} ${cyan(step.hint)}`;
      }
      case "status":
        return status();
      case "clear":
        return [{ text: CLEAR }];
      default:
        return null;
    }
  };

  /** Marks the current challenge when `line` passes it, or nudges after repeated misses. */
  const progress = (line: ParsedLine): Chunk[] => {
    const step = current();
    if (!step) return [];
    if (step.check(line, context)) {
      completed.add(step.id);
      misses = 0;
      onStep(step.id);
      const next = current();
      return [{ text: `\n${green(`✔ Desafio ${position(step)} concluído`)}\n${next ? goalLine(next) : finished()}\n`, delay: 150 }];
    }
    if (line.name === commandOf(step.hint) && ++misses >= MISSES_BEFORE_NUDGE) {
      return [{ text: gray(`(o desafio atual ainda não foi cumprido: digite ${cyan("hint")} para ver a dica)\n`) }];
    }
    return [];
  };

  const toChunks = (output: Output): Chunk[] => (typeof output === "string" ? [{ text: output }] : output);

  /** The prompt must start on a new line. */
  const endLine = (chunks: Chunk[]): Chunk[] => {
    const last = [...chunks].reverse().find((chunk) => chunk.text);
    if (last && last.text !== CLEAR && !last.text.endsWith("\n")) chunks.push({ text: "\n" });
    return chunks;
  };

  return {
    welcome() {
      const step = current();
      return [
        {
          text: [
            `${bold(cyan("jv_lab"))} · ${bold(lesson.title)}`,
            gray(wrap("Terminal simulado: nenhum modelo de verdade roda aqui e os números são ilustrativos.", context.cols)),
            `Digite ${cyan("help")} para ver os comandos e ${cyan("hint")} para a dica do desafio.`,
            "",
            step ? goalLine(step) : finished(),
            "",
          ].join("\n"),
        },
      ];
    },

    run(text) {
      let line: ParsedLine | null;
      try {
        line = parseLine(text);
      } catch (error) {
        if (error instanceof LabError) return [{ text: `${red(error.message)}\n` }];
        throw error;
      }
      if (!line) return [];
      try {
        const own = builtin(line);
        if (own !== null) return endLine(toChunks(own));
      } catch (error) {
        if (error instanceof LabError) return [{ text: `${red(error.message)}\n` }];
        throw error;
      }
      const command = lesson.commands[line.name];
      if (!command) return [{ text: `${red("comando não encontrado:")} ${line.name} — digite ${cyan("help")} para ver os desta lição\n` }];
      let output: Output;
      try {
        output = command.run(line, context);
      } catch (error) {
        if (!(error instanceof LabError)) throw error;
        return [{ text: `${red(error.message)}\n${gray(`uso: ${command.usage}`)}\n` }];
      }
      return endLine([...endLine(toChunks(output)), ...progress(line)]);
    },

    complete(text) {
      const words = text.split(" ");
      if (words.length === 1) {
        const names = [...Object.keys(lesson.commands), ...BUILTINS.map((builtin) => builtin.name)];
        return completeWord(text, "", names);
      }
      const subcommands = lesson.commands[words[0].toLowerCase()]?.subcommands;
      if (words.length === 2 && subcommands) return completeWord(words[1], `${words[0]} `, subcommands);
      return { line: text, options: [] };
    },

    resize(next) {
      context.cols = next;
    },
  };
}

/** Completes `word` (after `before`) to its only match, or to what all the matches share. */
function completeWord(word: string, before: string, candidates: string[]): Completion {
  const options = candidates.filter((candidate) => candidate.startsWith(word.toLowerCase()));
  if (options.length === 1) return { line: `${before}${options[0]} `, options };
  let shared = word;
  if (options.length) {
    shared = options[0];
    for (const option of options) while (!option.startsWith(shared)) shared = shared.slice(0, -1);
    if (shared.length < word.length) shared = word;
  }
  return { line: `${before}${shared}`, options };
}
