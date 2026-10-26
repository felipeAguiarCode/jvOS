/** A line-level diff (Myers), for the "Comparar" view and the development git. */

export interface DiffLine {
  kind: "equal" | "insert" | "delete";
  text: string;
}

/** Above this many edit steps the diff gives up and replaces everything (keeps huge files cheap). */
const MAX_STEPS = 4000;

export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const max = Math.min(n + m, MAX_STEPS);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;

  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }

  if (!found) {
    return [...before.map((text): DiffLine => ({ kind: "delete", text })), ...after.map((text): DiffLine => ({ kind: "insert", text }))];
  }

  // Walk the trace backwards from the end.
  const out: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const row = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && row[offset + k - 1] < row[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = row[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ kind: "equal", text: before[--x] });
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ kind: "insert", text: after[--y] });
      else out.push({ kind: "delete", text: before[--x] });
    }
  }
  return out.reverse();
}

const splitLines = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** `git diff`-style text with hunks of `context` lines; "" when both sides are equal. */
export function unifiedDiff(path: string, before: string | null, after: string | null, context = 3): string {
  const lines = diffLines(splitLines(before ?? ""), splitLines(after ?? ""));
  if (lines.every((line) => line.kind === "equal")) return "";
  const header = [`diff --git a/${path} b/${path}`, `--- ${before === null ? "/dev/null" : `a/${path}`}`, `+++ ${after === null ? "/dev/null" : `b/${path}`}`];

  const hunks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind === "equal") {
      index++;
      continue;
    }
    let start = Math.max(0, index - context);
    let end = index;
    // Extend over changes separated by at most 2 × context equal lines.
    for (;;) {
      while (end < lines.length && lines[end].kind !== "equal") end++;
      let gap = end;
      while (gap < lines.length && lines[gap].kind === "equal" && gap - end < context * 2) gap++;
      if (gap < lines.length && lines[gap].kind !== "equal") end = gap;
      else break;
    }
    const stop = Math.min(lines.length, end + context);
    const slice = lines.slice(start, stop);
    const oldStart = lines.slice(0, start).filter((line) => line.kind !== "insert").length + 1;
    const newStart = lines.slice(0, start).filter((line) => line.kind !== "delete").length + 1;
    const oldCount = slice.filter((line) => line.kind !== "insert").length;
    const newCount = slice.filter((line) => line.kind !== "delete").length;
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const line of slice) hunks.push(`${line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : " "}${line.text}`);
    index = stop;
    start = stop;
  }
  return `${[...header, ...hunks].join("\n")}\n`;
}
