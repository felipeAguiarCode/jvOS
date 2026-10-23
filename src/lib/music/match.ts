import { normalize } from "../search";

/** Words that say "a station" rather than which one. */
const GENERIC = new Set(["fm", "radio", "playlist", "the", "de", "da", "do", "a", "o"]);

const tokens = (text: string) => normalize(text).split(/[^a-z0-9]+/).filter(Boolean);

/** Equal, or one edit apart for words long enough that a slip is not another word. */
function similar(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let edits = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length; ) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return true;
}

/**
 * The playlist a spoken name points at ("flash", "wild style", "treino pesado"): the share of
 * the name's distinctive words heard wins, then the longest match. Whisper may split or join
 * words ("wildstyle" / "wild style"), so the names are also compared run together.
 */
export function matchPlaylist<T extends { name: string }>(spoken: string, playlists: T[]): T | null {
  const heard = tokens(spoken);
  if (!heard.length) return null;
  const joined = heard.join("");
  let best: { playlist: T; share: number; length: number } | null = null;
  for (const playlist of playlists) {
    const all = tokens(playlist.name);
    const words = all.filter((word) => !GENERIC.has(word) && !/^\d+$/.test(word));
    const distinctive = words.length ? words : all;
    const found = distinctive.filter((word) => heard.some((token) => similar(token, word)));
    const together = distinctive.join("");
    const share = together.length >= 5 && joined.includes(together) ? 1 : found.length / distinctive.length;
    const length = found.join("").length || (share ? together.length : 0);
    if (share > 0 && (!best || share > best.share || (share === best.share && length > best.length))) best = { playlist, share, length };
  }
  return best?.playlist ?? null;
}
