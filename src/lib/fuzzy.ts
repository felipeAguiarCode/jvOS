/**
 * Fuzzy matching for quick open and the command palette: the query's characters in order,
 * anywhere in the candidate, scored so that runs, word starts and the file name win.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices of the matched characters, for highlighting. */
  positions: number[];
}

const isBoundary = (text: string, index: number) => {
  if (index === 0) return true;
  const previous = text[index - 1];
  const char = text[index];
  return /[\\/_\-. ]/.test(previous) || (previous === previous.toLowerCase() && char !== char.toLowerCase());
};

export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  if (!needle) return { score: 0, positions: [] };
  const haystack = candidate.toLowerCase();
  const nameStart = Math.max(candidate.lastIndexOf("/"), candidate.lastIndexOf("\\")) + 1;

  // Prefer matches inside the file name: try from the name first, then anywhere.
  const attempt = (from: number): FuzzyMatch | null => {
    const positions: number[] = [];
    let at = from;
    for (const char of needle) {
      const found = haystack.indexOf(char, at);
      if (found < 0) return null;
      positions.push(found);
      at = found + 1;
    }
    let score = 0;
    positions.forEach((position, index) => {
      score += 1;
      if (index > 0 && position === positions[index - 1] + 1) score += 5;
      if (isBoundary(candidate, position)) score += 4;
      if (position >= nameStart) score += 2;
    });
    if (haystack.slice(nameStart).startsWith(needle)) score += 10;
    score -= candidate.length * 0.02;
    return { score, positions };
  };

  const inName = nameStart > 0 ? attempt(nameStart) : null;
  const anywhere = attempt(0);
  if (inName && (!anywhere || inName.score >= anywhere.score)) return inName;
  return anywhere;
}

/** The candidates that match, best first (at most `limit`). */
export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string, limit = 50): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch }[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, text(item));
    if (match) out.push({ item, match });
  }
  out.sort((a, b) => b.match.score - a.match.score);
  return out.slice(0, limit);
}
