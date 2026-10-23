/**
 * jv_T4p3's cassette, drawn in text (48 × 14 cells). Only single-width glyphs that Consolas has:
 * the wider fallbacks (▶ ◉ ◆) would break the columns.
 *
 *   ╭──────────────────────────────────────────────╮
 *   │ ◦ ┌──────────────────────────────────────┐ ◦ │
 *   │   │ FLASH FM                   LADO A C90 │   │
 *   │   │     Billie Jean — Michael Jackson     │   │
 *   │   └──────────────────────────────────────┘   │
 *   │     ╭───────╮  ┌────────────┐  ╭───────╮     │
 *   │     │ ● · · │  │            │  │ ● · · │     │   ← teeth turning around each hub
 *   │     │ · ○ · │══│▓▓▓▓    ▓▓▓▓│══│ · ○ · │     │   ← tape packs: left shrinks, right grows
 *   │     │ · · ● │  │            │  │ · · ● │     │
 *   │     ╰───────╯  └────────────┘  ╰───────╯     │
 *   │ ◦   ╱ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ╲   ◦ │   ← tape running past the heads
 *   ╰──────────────────────────────────────────────╯
 */

export const CASSETTE_WIDTH = 48;
const INNER = CASSETTE_WIDTH - 2;
const LABEL = 36;
const WINDOW = 12;
const PATH = 34;
/** Positions of the hub's teeth, clockwise from the top left: [row, column] in a 3 × 3 grid. */
const RING: [number, number][] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [2, 1],
  [2, 0],
  [1, 0],
];

export interface CassetteState {
  /** Animation step: advances while playing, frozen when paused. */
  tick: number;
  /** 0..1 through the song: the tape moves from the left reel to the right one. */
  progress: number;
  /** First label line (the station). */
  label: string;
  /** Second label line ("Título — Artista"). */
  sublabel: string;
  side?: string;
}

/** `text` cut to `width` columns (with an ellipsis) or padded with spaces. */
export function fit(text: string, width: number, align: "left" | "center" | "right" = "left"): string {
  const chars = [...text];
  if (chars.length > width) return chars.slice(0, Math.max(0, width - 1)).join("") + "…";
  const room = width - chars.length;
  const left = align === "left" ? 0 : align === "right" ? room : Math.floor(room / 2);
  return " ".repeat(left) + text + " ".repeat(room - left);
}

/** One hub, three rows of seven: two opposite teeth lit, turning a notch per tick. */
function hub(tick: number): string[] {
  const lit = new Set([tick % 8, (tick + 4) % 8]);
  const grid = [
    ["·", "·", "·"],
    ["·", "○", "·"],
    ["·", "·", "·"],
  ];
  RING.forEach(([row, column], index) => {
    if (lit.has(index)) grid[row][column] = "●";
  });
  return grid.map((cells) => ` ${cells.join(" ")} `);
}

/** The tape seen through the window: the supply pack on the left, the take-up pack on the right. */
function packs(progress: number): string {
  const share = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const left = 1 + Math.round((1 - share) * 4);
  const right = 1 + Math.round(share * 4);
  return "▓".repeat(left) + " ".repeat(WINDOW - left - right) + "▓".repeat(right);
}

/** The tape between the heads: a dotted texture that runs left to right. */
function path(tick: number): string {
  const offset = tick % 3;
  return Array.from({ length: PATH }, (_, index) => ((index + 3 - offset) % 3 === 1 ? "·" : " ")).join("");
}

export function cassette({ tick, progress, label, sublabel, side = "LADO A C90" }: CassetteState): string[] {
  const row = (content: string) => `│${content}│`;
  const left = hub(tick);
  // The right reel turns the same way; a different phase keeps it from looking mirrored.
  const right = hub(tick + 2);
  const head = fit(label.toUpperCase(), LABEL - side.length - 1) + " " + side;
  const reels = (inner: (index: number) => string, link: string) => (index: number) =>
    row(`     │${left[index]}│${link}│${inner(index)}│${link}│${right[index]}│     `);

  return [
    `╭${"─".repeat(INNER)}╮`,
    row(` ◦ ┌${"─".repeat(LABEL + 2)}┐ ◦ `),
    row(`   │ ${head} │   `),
    row(`   │ ${fit(sublabel, LABEL, "center")} │   `),
    row(`   └${"─".repeat(LABEL + 2)}┘   `),
    row(`     ╭───────╮  ┌${"─".repeat(WINDOW)}┐  ╭───────╮     `),
    reels(() => " ".repeat(WINDOW), "  ")(0),
    reels(() => packs(progress), "══")(1),
    reels(() => " ".repeat(WINDOW), "  ")(2),
    row(`     ╰───────╯  └${"─".repeat(WINDOW)}┘  ╰───────╯     `),
    row(` ◦   ╱${path(tick)}╲   ◦ `),
    `╰${"─".repeat(INNER)}╯`,
  ];
}
