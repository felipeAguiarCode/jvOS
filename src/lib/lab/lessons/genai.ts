import { bar, bold, cyan, dim, gray, green, red, wrap, yellow } from "../ansi";
import { flagNumber, fold } from "../parse";
import { LabError, type Chunk, type LabContext, type Lesson, type ParsedLine } from "../types";
import { generate, joinWords, random } from "./model";

const POSITIVE = ["adorei", "amei", "otimo", "gostei", "incrivel", "bom", "lindo", "perfeito"];
const NEGATIVE = ["odiei", "ruim", "pessimo", "chato", "horrivel", "detestei", "fraco"];

function classify(line: ParsedLine, ctx: LabContext): string {
  const text = line.args.join(" ").trim();
  if (!text) throw new LabError("falta o texto, entre aspas");
  const words = fold(text).split(/[^a-z0-9]+/);
  const score = words.filter((word) => POSITIVE.includes(word)).length - words.filter((word) => NEGATIVE.includes(word)).length;
  const raw = { positivo: Math.exp(score * 1.6), neutro: 1.2, negativo: Math.exp(-score * 1.6) };
  const total = raw.positivo + raw.neutro + raw.negativo;
  const rows = Object.entries(raw).map(([label, weight]) => [label, weight / total] as const);
  const [best] = [...rows].sort((a, b) => b[1] - a[1]);
  return [
    `${bold("modelo discriminativo")} ${gray("· classificador de sentimento")}`,
    ...rows.map(([label, share]) => `  ${label.padEnd(9)} ${share.toFixed(2)}  ${bar(share, 20)}`),
    `  → ${best[0] === "negativo" ? red(best[0]) : best[0] === "positivo" ? green(best[0]) : yellow(best[0])}`,
    "",
    gray(wrap("Ele só escolhe entre rótulos que já existem: aprende P(rótulo | texto). Não cria nada novo.", ctx.cols)),
  ].join("\n");
}

/** A random seed, or the one asked for. */
const seedOf = (line: ParsedLine) => (line.flags.seed === undefined ? Math.floor(Math.random() * 10_000) : Math.round(flagNumber(line, "seed", 0, 0, 1_000_000)));

interface LastText {
  prompt: string;
  seed: number;
  text: string;
}

function genText(line: ParsedLine, ctx: LabContext): Chunk[] {
  const prompt = line.args.slice(1).join(" ").trim();
  if (!prompt) throw new LabError("falta o começo do texto, entre aspas");
  const temperature = flagNumber(line, "temperature", 1, 0, 2);
  const fixed = line.flags.seed !== undefined;
  const last = ctx.state.get("lastText") as LastText | undefined;
  let seed = seedOf(line);
  let result = generate(prompt, temperature, seed);
  // A fresh seed that lands on the same text as last time would hide the point: roll again.
  for (let tries = 0; !fixed && last?.prompt === prompt && joinWords(result.words) === last.text && tries < 8; tries++) {
    seed = (seed + 7919) % 10_000;
    result = generate(prompt, temperature, seed);
  }
  const text = joinWords(result.words);
  const runs = ((ctx.state.get("textRuns") as number | undefined) ?? 0) + 1;
  ctx.state.set("textRuns", runs);
  ctx.state.set("lastText", { prompt, seed, text } satisfies LastText);

  let note = "Cada palavra foi sorteada entre as prováveis: rode de novo e o texto muda.";
  if (fixed && last?.prompt === prompt && last.seed === seed) note = "Mesma seed e mesmo prompt → exatamente o mesmo texto. É assim que se torna a amostragem reprodutível.";
  else if (fixed) note = "Com a seed fixa, este texto se repete toda vez que você rodar o mesmo comando.";
  else if (runs > 1 && last?.prompt === prompt) note = "Mesmo prompt, outro texto: o modelo aprendeu uma distribuição e cada execução é uma nova amostra dela.";
  return [
    { text: `${dim(prompt)}` },
    ...result.words.map((word) => ({ text: cyan(/^[.,!?]$/.test(word.word) ? word.word : ` ${word.word}`), delay: 70 })),
    {
      text: `\n${gray(`temperatura ${temperature} · seed ${seed}${fixed ? " (fixa)" : " (aleatória)"} · ${result.words.length} palavras amostradas`)}\n${
        result.known ? "" : `${gray("(o modelo de brinquedo conhece poucas palavras; tente “Era uma vez” ou “O céu é”)")}\n`
      }\n${gray(wrap(note, ctx.cols))}\n`,
      delay: 120,
    },
  ];
}

const ART: { keys: string[]; name: string; rows: string[] }[] = [
  {
    keys: ["gato", "gata", "gatinho", "cat"],
    name: "gato",
    rows: ["    /\\_____/\\", "   /  o   o  \\", "  ( ==  ^  == )", "   )         (", "  (           )", " ( (  )   (  ) )", "(__(__)___(__)__)"],
  },
  {
    keys: ["foguete", "nave", "rocket", "espaco"],
    name: "foguete",
    rows: ["       /\\", "      /  \\", "     |    |", "     | jv |", "     |    |", "    /|    |\\", "   /_|____|_\\", "      ''''", "      ' '"],
  },
  {
    keys: ["montanha", "montanhas", "serra", "mountain"],
    name: "montanha",
    rows: ["          /\\", "    /\\   /  \\    /\\", "   /  \\ /    \\  /  \\", "  /    \\/  /\\ \\/    \\", " /     /  /  \\ \\     \\", "/_____/__/____\\_\\_____\\"],
  },
  {
    keys: [],
    name: "flor",
    rows: ["     _ _", "   _{ ' }_", "  { `.!.` }", "  ',_/Y\\_,'", "    {_,_}", "      |", "    (\\|  /)", "     \\| //", "      |//", "   ___|/___"],
  },
];

const NOISE = " .:-=+*#%@";
const LEVELS = [1, 0.7, 0.4, 0.15, 0];

function genImage(line: ParsedLine, ctx: LabContext): Chunk[] {
  const prompt = line.args.slice(1).join(" ").trim();
  if (!prompt) throw new LabError("falta a descrição da imagem, entre aspas");
  const words = fold(prompt).split(/[^a-z0-9]+/);
  const art = ART.find((item) => item.keys.some((key) => words.includes(key))) ?? ART[ART.length - 1];
  const seed = seedOf(line);
  const roll = random(seed);
  const width = Math.max(...art.rows.map((row) => row.length));
  const rows = art.rows.map((row) => row.padEnd(width));
  const height = rows.length + 1;

  const frame = (level: number, step: number) => {
    const label = gray(`passo ${step}/${LEVELS.length} · ruído ${Math.round(level * 100)}%`);
    const drawn = rows.map((row) =>
      Array.from(row)
        .map((char) => (roll() < level ? gray(NOISE[Math.floor(roll() * NOISE.length)]) : cyan(char)))
        .join(""),
    );
    return [label, ...drawn].map((text) => `\r${text}\x1b[K`).join("\n") + "\n";
  };
  return [
    { text: `${bold("modelo de difusão")} ${gray(`· “${prompt}” · seed ${seed}`)}\n` },
    ...LEVELS.map((level, i) => ({ text: (i ? `\x1b[${height}A` : "") + frame(level, i + 1), delay: i ? 380 : 0 })),
    {
      text: `\n${gray(
        wrap(
          `Começou com ruído puro e, a cada passo, o modelo removeu um pouco do ruído na direção do que o prompt descreve${
            art.keys.length ? "" : " (este brinquedo só desenha gato, foguete, montanha e, para o resto, uma flor)"
          }. Geradores de imagem de difusão funcionam assim, com milhões de pixels.`,
          ctx.cols,
        ),
      )}\n`,
      delay: 200,
    },
  ];
}

function gen(line: ParsedLine, ctx: LabContext): Chunk[] {
  const kind = line.args[0]?.toLowerCase();
  if (kind === "text" || kind === "texto") return genText(line, ctx);
  if (kind === "image" || kind === "imagem") return genImage(line, ctx);
  throw new LabError(kind ? `gen não sabe gerar “${kind}”: use text ou image` : "diga o que gerar: text ou image");
}

const isText = (line: ParsedLine) => line.name === "gen" && ["text", "texto"].includes(line.args[0]?.toLowerCase());

export const genai: Lesson = {
  id: "genai",
  title: "IA generativa",
  summary: "Discriminativo × generativo: amostrar de uma distribuição, seeds e um gerador de imagem por difusão.",
  minutes: 10,
  commands: {
    classify: { summary: "modelo discriminativo: escolhe um rótulo de sentimento", usage: 'classify "<texto>"', run: classify },
    gen: {
      summary: "modelo generativo: cria texto ou imagem novos",
      usage: 'gen text|image "<prompt>" [--seed N] [--temperature T]',
      subcommands: ["text", "image"],
      run: gen,
    },
  },
  steps: [
    {
      id: "classify",
      goal: "Rode um modelo discriminativo: ele só escolhe entre rótulos que já existem.",
      hint: 'classify "Adorei o filme"',
      check: (line) => line.name === "classify",
    },
    {
      id: "gen-text",
      goal: "Agora um modelo generativo: peça para ele continuar um texto.",
      hint: 'gen text "Era uma vez"',
      check: isText,
    },
    {
      id: "gen-again",
      goal: "Rode exatamente o mesmo comando de novo e compare os dois textos.",
      hint: 'gen text "Era uma vez"',
      check: (line, ctx) => isText(line) && line.flags.seed === undefined && (ctx.state.get("textRuns") as number) >= 2,
    },
    {
      id: "gen-seed",
      goal: "Fixe a semente (seed) para tornar a amostragem reprodutível.",
      hint: 'gen text "Era uma vez" --seed 7',
      check: (line) => isText(line) && line.flags.seed !== undefined,
    },
    {
      id: "gen-image",
      goal: "Gere uma imagem e veja o ruído virar desenho, como num modelo de difusão.",
      hint: 'gen image "um gato"',
      check: (line) => line.name === "gen" && ["image", "imagem"].includes(line.args[0]?.toLowerCase()),
    },
  ],
};
