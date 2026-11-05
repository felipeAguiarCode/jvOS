// Questions in JARVIS's terminal: a line of text, a choice with the arrow keys, several choices
// with the space bar, yes or no. Only on a real terminal: piped runs take flags and defaults.
import process from "node:process";
import readline from "node:readline";
import { dim, paint } from "./ansi.mjs";

/** Ctrl+C (or the input closing) before the files were written. */
export class Cancelled extends Error {
  constructor() {
    super("Cancelado.");
  }
}

/** @typedef {{ input: NodeJS.ReadStream, output: NodeJS.WriteStream }} Io */
const defaultIo = () => ({ input: process.stdin, output: process.stdout });

/** Both ends are a terminal: questions can be asked. */
export const interactive = (io = defaultIo()) => Boolean(io.input.isTTY && io.output.isTTY);

const label = (question) => `  ${paint("holo", "▸")} ${paint("light", question)}`;
export const problemLine = (text) => `  [${paint("alert", "ERRO")}] ${paint("alert", text)}`;

function readLine(prompt, io) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: io.input, output: io.output, terminal: Boolean(io.input.isTTY) });
    let answered = false;
    rl.on("SIGINT", () => {
      answered = true;
      rl.close();
      reject(new Cancelled());
    });
    rl.on("close", () => {
      if (!answered) reject(new Cancelled());
    });
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * A line of text; Enter alone takes `initial`. `validate` returns what is wrong, or null.
 * @param {{ question: string, initial?: string, hint?: string, validate?: (answer: string) => string | null }} options
 */
export async function ask({ question, initial = "", hint, validate = () => null }, io = defaultIo()) {
  for (;;) {
    const shown = `${label(question)}${initial ? dim(` (${initial})`) : ""}${hint ? dim(`  ${hint}`) : ""}\n  ${paint("cyan", "❯")} `;
    const answer = (await readLine(shown, io)).trim() || initial;
    const problem = validate(answer);
    if (!problem) return answer;
    io.output.write(`${problemLine(problem)}\n`);
  }
}

/** Yes or no ("S/n"). */
export async function confirm({ question, initial = true }, io = defaultIo()) {
  const answer = await ask(
    {
      question: `${question} ${dim(initial ? "(S/n)" : "(s/N)")}`,
      validate: (text) => (!text || /^(s|sim|y|yes|n|nao|não|no)$/i.test(text) ? null : "Responda s ou n."),
    },
    io,
  );
  return answer ? /^(s|sim|y|yes)$/i.test(answer) : initial;
}

/**
 * Keys in raw mode until `onKey` returns a result. The option lines are redrawn in place.
 * @template T
 */
function keyLoop(io, lines, onKey) {
  const { input, output } = io;
  let drawn = 0;
  const draw = () => {
    if (drawn) output.write(`\x1b[${drawn}A\x1b[0J`);
    const shown = lines();
    output.write(`${shown.join("\n")}\n`);
    drawn = shown.length;
  };
  output.write("\x1b[?25l");
  draw();
  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(input);
    const wasRaw = Boolean(input.isRaw);
    input.setRawMode?.(true);
    input.resume();
    const finish = (error, value, summary) => {
      input.off("keypress", listener);
      input.setRawMode?.(wasRaw);
      input.pause();
      output.write(`\x1b[${drawn}A\x1b[0J\x1b[?25h`);
      if (error) return reject(error);
      output.write(`${summary}\n`);
      resolve(value);
    };
    const listener = (text, key = {}) => {
      if (key.ctrl && key.name === "c") return finish(new Cancelled());
      const result = onKey(text ?? "", key);
      if (result) return finish(null, result.value, result.summary);
      draw();
    };
    input.on("keypress", listener);
  });
}

const optionLine = (option, current, mark = "") =>
  current
    ? `    ${paint("holo", "❯")} ${mark}${paint("glow", option.label)}${option.hint ? `  ${dim(option.hint)}` : ""}`
    : `      ${mark}${paint("text", option.label)}${option.hint ? `  ${dim(option.hint)}` : ""}`;

const chosenLine = (text) => `    ${paint("cyan", "❯")} ${paint("light", text)}`;

/**
 * One of `options`, with ↑↓ (or j/k, or its number) and Enter.
 * @template T
 * @param {{ question: string, options: { value: T, label: string, hint?: string }[], initial?: number }} spec
 * @returns {Promise<T>}
 */
export function choose({ question, options, initial = 0 }, io = defaultIo()) {
  let index = initial;
  io.output.write(`${label(question)}${dim("  ↑↓ escolhe · Enter confirma")}\n`);
  return keyLoop(
    io,
    () => options.map((option, at) => optionLine(option, at === index)),
    (text, key) => {
      if (key.name === "up" || text === "k") index = (index + options.length - 1) % options.length;
      else if (key.name === "down" || text === "j") index = (index + 1) % options.length;
      else if (/^[1-9]$/.test(text) && Number(text) <= options.length) index = Number(text) - 1;
      else if (key.name === "return" || key.name === "enter") return { value: options[index].value, summary: chosenLine(options[index].label) };
      return null;
    },
  );
}

/**
 * Any of `options`: ↑↓ moves, space ticks, Enter confirms.
 * @template T
 * @param {{ question: string, options: { value: T, label: string, hint?: string, checked?: boolean }[] }} spec
 * @returns {Promise<T[]>}
 */
export function chooseMany({ question, options }, io = defaultIo()) {
  let index = 0;
  const ticked = options.map((option) => Boolean(option.checked));
  io.output.write(`${label(question)}${dim("  ↑↓ move · espaço marca · Enter confirma")}\n`);
  return keyLoop(
    io,
    () => options.map((option, at) => optionLine(option, at === index, ticked[at] ? `${paint("holo", "[x]")} ` : `${paint("line", "[ ]")} `)),
    (text, key) => {
      if (key.name === "up" || text === "k") index = (index + options.length - 1) % options.length;
      else if (key.name === "down" || text === "j") index = (index + 1) % options.length;
      else if (key.name === "space" || text === " ") ticked[index] = !ticked[index];
      else if (key.name === "return" || key.name === "enter") {
        const picked = options.filter((_, at) => ticked[at]);
        return { value: picked.map((option) => option.value), summary: chosenLine(picked.length ? picked.map((option) => option.label).join(" · ") : "nenhum") };
      }
      return null;
    },
  );
}
