/** Terminal colours and layout helpers for the lab's output (xterm reads the ANSI codes). */

const sgr = (code: string) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;

export const dim = sgr("2");
export const bold = sgr("1");
export const red = sgr("31");
export const green = sgr("32");
export const yellow = sgr("33");
export const blue = sgr("34");
export const magenta = sgr("35");
export const cyan = sgr("36");
export const gray = sgr("90");

/** Clears the screen and the scrollback, cursor home. */
export const CLEAR = "\x1b[2J\x1b[3J\x1b[H";

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Columns a text takes on screen (colour codes take none). */
export const visibleLength = (text: string) => Array.from(text.replace(ANSI, "")).length;

export const padEnd = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleLength(text)));
export const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - visibleLength(text))) + text;

/** `████████░░░░` for a share in 0..1. */
export function bar(share: number, cells = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * cells);
  return cyan("█".repeat(filled)) + gray("░".repeat(cells - filled));
}

/** Rows in aligned columns, the header in bold; `right` lists the columns aligned to the right. */
export function table(header: string[], rows: string[][], right: number[] = []): string {
  const widths = header.map((title, column) => Math.max(visibleLength(title), ...rows.map((row) => visibleLength(row[column] ?? ""))));
  const line = (cells: string[]) =>
    cells.map((cell, column) => (right.includes(column) ? padStart(cell, widths[column]) : padEnd(cell, widths[column]))).join("  ").trimEnd();
  return [bold(line(header)), gray(widths.map((width) => "─".repeat(width)).join("  ")), ...rows.map(line)].join("\n");
}

/** Word-wraps prose to `width` columns, keeping its line breaks; `indent` starts every line. */
export function wrap(text: string, width: number, indent = ""): string {
  const room = Math.max(20, width - visibleLength(indent) - 1);
  return text
    .split("\n")
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(" ")) {
        if (line && visibleLength(line) + 1 + visibleLength(word) > room) {
          lines.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      lines.push(line);
      return lines.map((part) => indent + part).join("\n");
    })
    .join("\n");
}
