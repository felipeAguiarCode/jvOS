/**
 * A toy language model for the lessons: a tokenizer, a word chain with scores (logits) for the
 * next word, and sampling with temperature and seed. Nothing is learnt — it only shows the moves.
 */

/** Deterministic random numbers in [0, 1) from a seed (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: the same text always gets the same number. */
export function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return value;
}

/** Frequent words are whole tokens; the rest breaks into pieces. */
const WHOLE = new Set(
  "o a os as e é de do da dos das em no na um uma que para com não por se mas como mais ser ter foi era vez céu azul mundo modelo modelos texto token tokens dados ia ai the is of and to in hello world".split(" "),
);

/** Leading space + word, a run of punctuation, or spaces: the usual pre-split before BPE. */
const PRE_SPLIT = / ?[\p{L}\p{N}]+| ?[^\s\p{L}\p{N}]|\s+/gu;
const ASCII_ALNUM = /^[A-Za-z0-9]$/;

/** Breaks text into tokens the way subword tokenizers tend to (a toy version, not real BPE). */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const piece of text.match(PRE_SPLIT) ?? []) {
    const word = piece.trim();
    if (!word || WHOLE.has(word.toLowerCase()) || !/\p{L}|\p{N}/u.test(word)) {
      tokens.push(piece);
      continue;
    }
    // Rare words: ASCII runs of up to 4 characters; accented letters, being rarer, alone.
    let chunk = piece.startsWith(" ") ? " " : "";
    for (const char of Array.from(word)) {
      if (!ASCII_ALNUM.test(char)) {
        if (chunk.trim()) tokens.push(chunk);
        tokens.push(chunk.trim() ? char : chunk + char);
        chunk = "";
      } else if (chunk.trim().length === 4) {
        tokens.push(chunk);
        chunk = char;
      } else chunk += char;
    }
    if (chunk) tokens.push(chunk);
  }
  return tokens;
}

/** A token's number in the vocabulary (stable, like a real tokenizer's). */
export const tokenId = (token: string) => 256 + (hash(token) % 49_744);

type Choices = [word: string, logit: number][];

/** The toy's whole "knowledge": the score of each next word, given the last one. */
const CHAIN: Record<string, Choices> = {
  é: [["azul", 3.1], ["lindo", 1.4], ["o", 0.9], ["cinza", 0.8], ["infinito", 0.4], ["feito", -0.5], ["de", -0.9]],
  azul: [["porque", 2.4], [".", 2.0], ["e", 1.4], ["como", 0.6], ["hoje", 0.4]],
  porque: [["a", 1.8], ["o", 1.0]],
  a: [["luz", 2.0], ["atmosfera", 1.2], ["noite", 0.5], ["lua", 0.4]],
  luz: [["do", 2.0], ["se", 1.2], ["azul", 0.2]],
  do: [["sol", 2.2], ["dia", 0.8], ["mar", 0.6]],
  sol: [["se", 1.6], [".", 1.5], ["brilha", 1.2], ["e", 0.6]],
  se: [["espalha", 2.0], ["espelha", 0.8], ["esconde", 0.6]],
  espalha: [["no", 1.6], [".", 1.0]],
  espelha: [["no", 1.5], [".", 0.6]],
  esconde: [[".", 1.0], ["no", 1.0]],
  no: [["ar", 2.0], ["céu", 1.0], ["mar", 0.6]],
  ar: [[".", 2.0], ["e", 0.6]],
  atmosfera: [["espalha", 1.5], [".", 1.0]],
  lindo: [[".", 2.0], ["e", 1.2], ["hoje", 0.8]],
  cinza: [[".", 1.8], ["e", 1.0], ["hoje", 0.9]],
  infinito: [[".", 1.8], ["e", 1.0]],
  hoje: [[".", 2.0], ["e", 0.8]],
  o: [["mar", 1.6], ["sol", 1.4], ["céu", 1.0], ["oceano", 0.5], ["limite", 0.3]],
  e: [["o", 1.4], ["as", 1.0], ["cheio", 0.9], ["sem", 0.6], ["dança", -0.6], ["canta", -0.8]],
  cheio: [["de", 2.4]],
  feito: [["de", 3.0]],
  de: [["nuvens", 2.0], ["estrelas", 1.6], ["pássaros", 1.0], ["queijo", -1.2], ["boletos", -1.6]],
  sem: [["nuvens", 2.4], ["fim", 1.2]],
  como: [["o", 2.0], ["um", 1.0]],
  céu: [["azul", 1.2], [".", 1.0], ["é", 0.5]],
  // "Era uma vez…"
  vez: [["um", 1.8], ["uma", 1.4]],
  um: [["robô", 1.6], ["oceano", 1.2], ["sonho", 1.0], ["dragão", 1.0], ["teclado", -1.0], ["abacaxi", -1.4]],
  uma: [["menina", 1.6], ["cidade", 1.2], ["ideia", 0.8]],
  robô: [["que", 2.0], ["curioso", 1.2]],
  dragão: [["que", 1.6], ["azul", 1.0]],
  menina: [["que", 2.0], ["curiosa", 1.0]],
  curioso: [["que", 1.6], [".", 1.2]],
  curiosa: [["que", 1.6], [".", 1.2]],
  cidade: [["que", 1.2], ["de", 1.0], [".", 1.0]],
  ideia: [["que", 1.4], [".", 1.2]],
  que: [["sonhava", 1.6], ["aprendia", 1.4], ["contava", 0.8]],
  sonhava: [["com", 2.0]],
  aprendia: [["com", 1.8], ["sozinho", 0.6]],
  contava: [["histórias", 2.0]],
  com: [["as", 1.5], ["o", 1.2], ["dados", 1.0]],
  as: [["estrelas", 1.6], ["nuvens", 1.4], ["ondas", 0.8]],
};

/** Ends that close a sentence; anything unknown continues with common words. */
const ENDS = ["nuvens", "estrelas", "pássaros", "queijo", "boletos", "fim", "mar", "oceano", "limite", "dia", "lua", "noite", "dados", "histórias", "ondas", "sonho", "teclado", "abacaxi", "sozinho", "dança", "canta", "brilha"];
const CLOSING: Choices = [[".", 1.8], ["e", 0.8]];
const FALLBACK: Choices = [["e", 1.2], ["de", 1.0], ["que", 0.8], [".", 0.7], ["o", 0.5]];

/** The last word of a text (what the chain looks at). */
const lastWord = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).pop() ?? "";

const choicesAfter = (word: string): { choices: Choices; known: boolean } => {
  if (CHAIN[word]) return { choices: CHAIN[word], known: true };
  if (ENDS.includes(word)) return { choices: CLOSING, known: true };
  return { choices: FALLBACK, known: false };
};

export interface Candidate {
  word: string;
  probability: number;
}

/** Turns scores into probabilities; a higher temperature flattens them, a lower one sharpens them. */
export function softmax(choices: Choices, temperature = 1): Candidate[] {
  const t = Math.max(temperature, 0.05);
  const top = Math.max(...choices.map(([, logit]) => logit));
  const weights = choices.map(([, logit]) => Math.exp((logit - top) / t));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return choices.map(([word], i) => ({ word, probability: weights[i] / total }));
}

/** The candidates for the next word of `prompt`, most likely first. */
export function nextWords(prompt: string, temperature = 1): { candidates: Candidate[]; known: boolean } {
  const { choices, known } = choicesAfter(lastWord(prompt));
  return { candidates: softmax(choices, temperature).sort((a, b) => b.probability - a.probability), known };
}

export interface Generation {
  /** The chosen words, each with the probability it had when chosen. */
  words: Candidate[];
  /** The prompt ended in a word the toy does not know. */
  known: boolean;
}

/** Continues `prompt` word by word: temperature 0 always takes the most likely one. */
export function generate(prompt: string, temperature: number, seed: number, max = 14): Generation {
  const roll = random(seed);
  const words: Candidate[] = [];
  let word = lastWord(prompt);
  const known = choicesAfter(word).known;
  while (words.length < max && word !== ".") {
    const candidates = softmax(choicesAfter(word).choices, temperature);
    let chosen = candidates.reduce((best, candidate) => (candidate.probability > best.probability ? candidate : best));
    if (temperature > 0) {
      let left = roll();
      chosen = candidates.find((candidate) => (left -= candidate.probability) < 0) ?? candidates[candidates.length - 1];
    }
    words.push(chosen);
    word = chosen.word;
  }
  return { words, known };
}

/** The words as text: a space before each one, none before punctuation. */
export const joinWords = (words: Candidate[]) => words.map(({ word }) => (/^[.,!?]$/.test(word) ? word : ` ${word}`)).join("");
