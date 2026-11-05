// Terminal colours of the blue theme. Mirrors `PALETTES.blue` in src/lib/theme.ts, plus the amber
// and alert tokens of src/styles/globals.css. Plain text with NO_COLOR, FORCE_COLOR=0 or no TTY.
import process from "node:process";

/** @typedef {"void" | "abyss" | "cyan" | "holo" | "light" | "line" | "glow" | "text" | "amber" | "alert"} Token */

/** @type {Record<Token, string>} */
export const PALETTE = {
  void: "#000508",
  abyss: "#021017",
  cyan: "#00CAFD",
  holo: "#00E5FF",
  light: "#76F3FF",
  line: "#087B94",
  glow: "#B5FAFF",
  text: "#A8DBE5",
  amber: "#FFB02E",
  alert: "#FF5C6C",
};

let enabled = !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0" && Boolean(process.stdout.isTTY);

/** Turns colour on or off (tests, `--no-color`). */
export function setColor(on) {
  enabled = on;
}

export const colorEnabled = () => enabled;

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(";");

/** `text` in a palette colour (truecolor). */
export function paint(token, text) {
  return enabled ? `\x1b[38;2;${rgb(PALETTE[token])}m${text}\x1b[39m` : String(text);
}

export const bold = (text) => (enabled ? `\x1b[1m${text}\x1b[22m` : String(text));
export const dim = (text) => (enabled ? `\x1b[2m${text}\x1b[22m` : String(text));
/** Reverse video, like the TUI headers (`ReverseRow`). */
export const reverse = (text) => (enabled ? `\x1b[7m${text}\x1b[27m` : String(text));

/** The text without escape codes, to measure what shows on screen. */
export const plain = (text) => String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** Columns the text takes (escape codes and combining marks take none). */
export const width = (text) => [...plain(text).normalize("NFC")].length;

/** Pads `text` with spaces to `size` columns. */
export const pad = (text, size) => text + " ".repeat(Math.max(0, size - width(text)));
