/**
 * jv_agent's ASCII agent, assembled as the interview fills the draft in: the head is the name, the
 * eyes what it does, the arms its tools, the core its model and the legs its prompt.
 */
export type Part = "antenna" | "head" | "eyes" | "body" | "arms" | "core" | "legs";

/** Each row of the figure, and under it which part each character belongs to (17 columns). */
const TEMPLATE: [string, string][] = [
  ["        ●        ", "        a        "],
  ["    ┌───┴───┐    ", "    hhhhhhhhh    "],
  ["    │ ◉   ◉ │    ", "    h e   e h    "],
  ["    │  ───  │    ", "    h  hhh  h    "],
  ["    └───┬───┘    ", "    hhhhhhhhh    "],
  [" ╭──┬───┴───┬──╮ ", " rrrbbbbbbbbbrrr "],
  [" │  │MMMMMMM│  │ ", " r  bcccccccb  r "],
  [" ◘  │ ▓▓▓▓▓ │  ◘ ", " r  b ccccc b  r "],
  ["    └─┬───┬─┘    ", "    bbbbbbbbb    "],
  ["      │   │      ", "      l   l      "],
  ["     ═╧═ ═╧═     ", "     lll lll     "],
];

const PARTS: Record<string, Part> = { a: "antenna", h: "head", e: "eyes", b: "body", r: "arms", c: "core", l: "legs" };
const LABEL = 7;

/** A run of characters of one part (null: the space around the figure). */
export interface Segment {
  text: string;
  part: Part | null;
}

/** What the draft says so far, field by field. */
export interface AgentSheet {
  name: string | null;
  description: string | null;
  tools: string | null;
  model: string | null;
  /** The prompt after the header. */
  prompt: string | null;
}

/**
 * The draft's fields (null: not written yet), read as JARVIS writes it: a header still open
 * already has the lines it got.
 */
export function agentSheet(text: string): AgentSheet {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const fields: Record<string, string> = {};
  let prompt = "";
  if (lines[0]?.trim() === "---") {
    for (let at = 1; at < lines.length; at++) {
      const line = lines[at];
      if (line.trim() === "---") {
        prompt = lines.slice(at + 1).join("\n").trim();
        break;
      }
      const colon = line.indexOf(":");
      if (colon > 0 && !/^[\s-]/.test(line)) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  const field = (key: string) => fields[key] || null;
  return { name: field("name"), description: field("description"), tools: field("tools"), model: field("model"), prompt: prompt || null };
}

/** The parts the draft has built. */
export function litParts(sheet: AgentSheet): Part[] {
  const lit: Part[] = [];
  if (sheet.name) lit.push("antenna", "head", "body");
  if (sheet.description) lit.push("eyes");
  if (sheet.tools) lit.push("arms");
  if (sheet.model) lit.push("core");
  if (sheet.prompt) lit.push("legs");
  return lit;
}

/** "sonnet" → " SONNET", nothing → "  ···  " (seven columns, centred). */
function coreLabel(model: string | null) {
  const label = (model ?? "···").toUpperCase().slice(0, LABEL);
  const left = Math.ceil((LABEL - label.length) / 2);
  return `${" ".repeat(left)}${label}`.padEnd(LABEL);
}

/** The figure's rows as runs of parts; eyes not built yet are hollow. */
export function figureRows(sheet: AgentSheet): Segment[][] {
  const seeing = sheet.description !== null;
  return TEMPLATE.map(([row, mask]) => {
    const text = row.replace("MMMMMMM", coreLabel(sheet.model)).replace(/◉/g, seeing ? "◉" : "○");
    const segments: Segment[] = [];
    for (let at = 0; at < text.length; at++) {
      const part = PARTS[mask[at]] ?? null;
      const last = segments[segments.length - 1];
      if (last && last.part === part) last.text += text[at];
      else segments.push({ text: text[at], part });
    }
    return segments;
  });
}

/** The steps of the interview, in order; the last one is JARVIS showing it for review. */
export const STEPS = ["nome", "faz", "usa", "modelo", "prompt", "revisão"] as const;

/** Which steps are done. */
export function stepsDone(sheet: AgentSheet, reviewed: boolean): boolean[] {
  return [sheet.name !== null, sheet.description !== null, sheet.tools !== null, sheet.model !== null, sheet.prompt !== null, reviewed];
}

/** `[■■■■□□]` */
export const progressBar = (done: boolean[]) => `[${done.map((step) => (step ? "■" : "□")).join("")}]`;
