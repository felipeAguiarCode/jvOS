// Names derived from what the user types: ids, file names, identifiers and search words.

/** "Ações" → "Acoes". */
export const stripAccents = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** "Meu Humor-do dia", "meuHumor" → ["meu", "humor", "do", "dia"]. */
export const words = (text) =>
  stripAccents(String(text))
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export const kebab = (text) => words(text).join("-");
export const snake = (text) => words(text).join("_");
export const camel = (text) => words(text).map((word, index) => (index ? capital(word) : word)).join("");
export const pascal = (text) => words(text).map(capital).join("");
/** "quick-notes" → "QUICK_NOTES". */
export const constant = (text) => words(text).join("_").toUpperCase();

/** A lucide icon's file name: "CloudSun" → "cloud-sun", "Disc3" → "disc-3". */
export const iconFile = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();

/** Window kinds are one lowercase word, like the existing ones ("clock", "miniplayer"). */
export const KIND_PATTERN = /^[a-z][a-z0-9]{1,23}$/;
/** Feature folders are kebab-case ("quick-notes"). */
export const FEATURE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** "a, b ,, c" → ["a", "b", "c"], without repeats. */
export const splitList = (text) => [...new Set(String(text ?? "").split(",").map((item) => item.trim()).filter(Boolean))];

/** How the search and the voice matcher compare words: lowercase, no accents, single spaces. */
export const searchForm = (text) => stripAccents(text).toLowerCase().replace(/\s+/g, " ").trim();

/** "300x200", "300×200", "300 x 200" → { w: 300, h: 200 }; null when it is not a size. */
export function parseSize(text) {
  const match = /^\s*(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*$/i.exec(String(text));
  return match ? { w: Number(match[1]), h: Number(match[2]) } : null;
}

export const showSize = (size) => `${size.w} × ${size.h}`;

/** An ADR's file name from its title: at most 6 words, accents and articles kept out. */
export function adrSlug(title) {
  const skip = new Set(["o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos", "nas", "ao", "aos", "para", "por", "pelo", "pela", "com", "que"]);
  const kept = words(title).filter((word) => !skip.has(word));
  return (kept.length ? kept : words(title)).slice(0, 6).join("-");
}

/** "2026-11-03" → "03/11". */
export const dayMonth = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Today as "AAAA-MM-DD", in local time. */
export function today(now = new Date()) {
  const two = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
