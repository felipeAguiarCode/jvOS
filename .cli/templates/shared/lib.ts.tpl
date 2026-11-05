/**
 * %%title%%: the entries and their rules, pure (no React, no storage), so the tests import them.
 * Spec: %%specPath%%
 */

/** One entry of the list. */
export interface %%pascal%%Item {
  /** Short number to say and to show ("#3"); the smallest free one. */
  id: number;
  text: string;
}

/** Most entries kept (`jarvis.%%kind%%`). */
export const MAX_%%CONST%%_ITEMS = 50;
/** Longest text of an entry. */
export const MAX_%%CONST%%_TEXT = 120;

/** "  um   texto " → "um texto", cut to `MAX_%%CONST%%_TEXT`. */
export const tidy%%pascal%%Text = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_%%CONST%%_TEXT);

/** The smallest id not in use: 1, 2, 4 → 3. */
export function next%%pascal%%Id(items: %%pascal%%Item[]) {
  const used = new Set(items.map((item) => item.id));
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

/** The stored list, tolerant: bad entries are dropped, repeated ids too, the list is capped. */
export function parse%%pascal%%(raw: unknown): %%pascal%%Item[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const items: %%pascal%%Item[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, text } = entry as Record<string, unknown>;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    if (typeof text !== "string" || !text.trim()) continue;
    seen.add(id);
    items.push({ id, text: tidy%%pascal%%Text(text) });
  }
  return items.slice(0, MAX_%%CONST%%_ITEMS);
}
