import { LabError, type ParsedLine } from "./types";

const QUOTES: Record<string, string> = { '"': '"', "'": "'", "“": "”", "”": "”" };

/** Splits a command line into words: spaces separate them, quotes keep phrases together. */
export function splitWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let closing: string | null = null;
  for (const char of line) {
    if (closing) {
      if (char === closing) closing = null;
      else word += char;
    } else if (char in QUOTES) {
      closing = QUOTES[char];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (closing) throw new LabError("aspas sem fechar");
  if (started) words.push(word);
  return words;
}

/** The command, its positional arguments and its `--flags`; null for an empty line. */
export function parseLine(line: string): ParsedLine | null {
  const words = splitWords(line);
  if (!words.length) return null;
  const [name, ...rest] = words;
  const args: string[] = [];
  const flags: ParsedLine["flags"] = {};
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith("--") || word.length < 3) {
      args.push(word);
      continue;
    }
    const equals = word.indexOf("=");
    if (equals > 0) flags[word.slice(2, equals).toLowerCase()] = word.slice(equals + 1);
    else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) flags[word.slice(2).toLowerCase()] = rest[++i];
    else flags[word.slice(2).toLowerCase()] = true;
  }
  return { name: name.toLowerCase(), args, flags };
}

/** A flag's text, or `fallback` when missing; a bare `--flag` is an error. */
export function flagText(line: ParsedLine, name: string, fallback: string): string {
  const value = line.flags[name];
  if (value === true) throw new LabError(`--${name} precisa de um valor`);
  return value ?? fallback;
}

/** A numeric flag within [min, max], or `fallback` when missing. */
export function flagNumber(line: ParsedLine, name: string, fallback: number, min: number, max: number): number {
  const text = flagText(line, name, String(fallback)).replace(",", ".");
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) throw new LabError(`--${name} deve ser um número entre ${min} e ${max}`);
  return value;
}

/** Folds case and accents, so "Bastão" matches "bastao". */
export const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
