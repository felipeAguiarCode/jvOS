import type { LucideIcon } from "lucide-react";

/** Something the search bar (`/`) can find and run. */
export interface Command {
  id: string;
  title: string;
  /** Shown under the title: where it lives, what it does. */
  subtitle?: string;
  group: string;
  icon: LucideIcon;
  /** Extra words it answers to (synonyms, English). */
  keywords?: string[];
  /** Keyboard shortcut shown on the right. */
  shortcut?: string;
  /** Badge on the right: "aberto", "atual"… */
  badge?: string;
  run: () => void;
}

/** Lowercase, no accents. Keeps the length of Portuguese text, so match positions still line up. */
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Portuguese articles and prepositions, ignored when they are not the whole query. */
const LINKING_WORDS = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "na", "no", "um", "uma", "para", "pra"]);

/**
 * How well a command matches: every word of the query must appear somewhere (title, keywords,
 * group, subtitle); titles that start with the query rank first, then those with a word that
 * starts with it, then any other match. Null: no match.
 */
export function scoreCommand(command: Command, query: string): number | null {
  const q = normalize(query).trim();
  if (!q) return 0;
  const title = normalize(command.title);
  const haystack = [title, ...(command.keywords ?? []).map(normalize), normalize(command.group), normalize(command.subtitle ?? "")].join(" ");
  // Linking words say nothing ("comandos de voz" is "comandos voz"), unless that is all there is.
  const queryWords = q.split(/\s+/);
  const meaningful = queryWords.filter((word) => !LINKING_WORDS.has(word));
  const tokens = meaningful.length ? meaningful : queryWords;
  if (!tokens.every((token) => haystack.includes(token))) return null;

  let score = title.startsWith(q) ? 100 : title.includes(q) ? 55 : 10;
  const words = title.split(/[\s›·:,()]+/);
  if (score < 100 && words.some((word) => word.startsWith(tokens[0]))) score += 30;
  // The rest of the query in the title too, not only among the keywords: "ocultar barra" is the
  // top bar's "Ocultar a barra superior" rather than "Ocultar a dock" (keyword "barra inferior").
  score += tokens.slice(1).filter((token) => words.some((word) => word.startsWith(token))).length * 10;
  // Among equals, the shorter (more specific) title first.
  return score - title.length * 0.05;
}

/** Ranked matches; without a query, everything in its original (grouped) order. */
export function searchCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((item): item is { command: Command; index: number; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.command);
}

/** Where the query sits in the title, for highlighting. */
export function matchRange(title: string, query: string): [number, number] | null {
  const q = normalize(query).trim();
  if (!q) return null;
  const start = normalize(title).indexOf(q);
  return start < 0 ? null : [start, start + q.length];
}
