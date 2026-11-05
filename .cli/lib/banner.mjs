// The boot screen's look in the terminal: ANSI Shadow letters, POST lines and TUI boxes.
import process from "node:process";
import { dim, paint, pad, reverse, width } from "./ansi.mjs";

/** "ANSI Shadow" block letters (6 rows). Mirrors `GLYPHS` in src/lib/asciiFont.ts. */
const GLYPHS = {
  J: ["     ██╗", "     ██║", "     ██║", "██   ██║", "╚█████╔╝", " ╚════╝ "],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
  V: ["██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
};

/** The word as six rows of block characters (unknown letters are skipped). Mirrors `asciiWord`. */
export function asciiWord(word) {
  const letters = [...word.toUpperCase()].map((letter) => GLYPHS[letter]).filter(Boolean);
  return Array.from({ length: 6 }, (_, row) => letters.map((glyph) => glyph[row]).join(""));
}

/** Top to bottom: the hologram's glow fading into its line colour. */
const ROW_TONES = ["glow", "light", "holo", "holo", "cyan", "line"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes lines one by one (a short pause each when animated), like the BIOS screen. */
export async function typeLines(lines, { anim = false, delay = 28, out = process.stdout } = {}) {
  for (const line of lines) {
    out.write(`${line}\n`);
    if (anim) await sleep(delay);
  }
}

export const RULE_WIDTH = 46;
export const rule = (size = RULE_WIDTH) => paint("line", "─".repeat(size));

/** "JARVIS" in block letters, then the product line and a rule. */
export function banner(version) {
  const rows = asciiWord("JARVIS").map((row, index) => ` ${paint(ROW_TONES[index], row)}`);
  return [
    "",
    ...rows,
    `  ${paint("cyan", "jvOS")} ${paint("line", "//")} ${paint("light", "FORJA DE MÓDULOS")} ${dim(`· v${version}`)}`,
    ` ${rule()}`,
  ];
}

/** @typedef {"ok" | "warn" | "fail" | "skip"} PostStatus */

const STATUS = {
  ok: () => `[ ${paint("light", "OK")} ]`,
  warn: () => `[${paint("amber", "WARN")}]`,
  fail: () => `[${paint("alert", "ERRO")}]`,
  skip: () => dim("[ -- ]"),
};

/** One POST line: `[ OK ] templates carregados`. */
export const post = (status, text) => `  ${STATUS[status]()} ${status === "skip" ? dim(text) : paint("text", text)}`;

/** A section title in reverse video, like the TUI headers. */
export const heading = (text) => `\n ${reverse(paint("holo", ` ${text} `))}`;

/**
 * A TUI box: `┌─ title ───┐ │ line │ └───┘`, as wide as its longest line (at least `min` columns).
 * Lines are drawn as given (they may carry colour).
 */
export function box(title, lines, { min = RULE_WIDTH - 2, tone = "line" } = {}) {
  const inner = Math.max(min, width(title) + 3, ...lines.map((line) => width(line) + 2));
  const top = ` ${paint(tone, "┌─ ")}${paint("holo", title)}${paint(tone, ` ${"─".repeat(Math.max(0, inner - width(title) - 3))}┐`)}`;
  const body = lines.map((line) => ` ${paint(tone, "│")} ${pad(line, inner - 2)} ${paint(tone, "│")}`);
  return [top, ...body, ` ${paint(tone, `└${"─".repeat(inner)}┘`)}`];
}

/** A greeting for the hour, in JARVIS's voice. */
export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5) return "Trabalhando até tarde, senhor.";
  if (hour < 12) return "Bom dia, senhor.";
  if (hour < 18) return "Boa tarde, senhor.";
  return "Boa noite, senhor.";
}
