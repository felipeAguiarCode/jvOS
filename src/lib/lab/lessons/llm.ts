import { bar, bold, cyan, dim, gray, padEnd, red, table, wrap, yellow } from "../ansi";
import { flagNumber } from "../parse";
import { LabError, type Chunk, type LabContext, type Lesson, type Output, type ParsedLine } from "../types";
import { generate, nextWords, tokenId, tokenize } from "./model";

/** Black text on alternating backgrounds, like the tokenizer playgrounds. */
const BACKGROUNDS = ["46", "45", "43", "42", "44"];
const shown = (token: string) => token.replace(/ /g, "␣");

function tokenizeCommand(line: ParsedLine, ctx: LabContext): string {
  const text = line.args.join(" ");
  if (!text.trim()) throw new LabError("falta o texto, entre aspas");
  const tokens = tokenize(text);
  const chars = Array.from(text).length;
  const rows = tokens.slice(0, 16).map((token, i) => [String(i + 1), `"${shown(token)}"`, String(tokenId(token))]);
  return [
    `${bold("tokenize")} ${gray(`· ${chars} caracteres → ${tokens.length} tokens`)}`,
    `  ${tokens.map((token, i) => `\x1b[30;${BACKGROUNDS[i % BACKGROUNDS.length]}m${token}\x1b[0m`).join("")}`,
    "",
    table(["#", "token", "id"], rows, [2]),
    tokens.length > rows.length ? gray(`… e mais ${tokens.length - rows.length}`) : "",
    "",
    gray(
      wrap(
        `~${(chars / tokens.length).toFixed(1).replace(".", ",")} caracteres por token. O modelo não vê letras, vê esses números. Palavras frequentes viram um token só; palavras raras e acentos gastam mais. (Tokenizador de brinquedo: os reais aprendem os pedaços dos dados, com BPE.)`,
        ctx.cols,
      ),
    ),
  ]
    .filter((part, i, parts) => part !== "" || parts[i - 1] !== "")
    .join("\n");
}

const promptOf = (line: ParsedLine) => {
  const prompt = line.args.slice(1).join(" ").trim();
  if (!prompt) throw new LabError("falta o texto, entre aspas");
  return prompt;
};

function next(line: ParsedLine, ctx: LabContext): string {
  const prompt = promptOf(line);
  const { candidates, known } = nextWords(prompt);
  const top = candidates.slice(0, 5);
  return [
    `${bold("próximo token")} ${gray(`depois de “${prompt}”`)}`,
    ...top.map(({ word, probability }, i) => {
      const name = padEnd(` ${word}`, 12);
      return `  ${i ? name : cyan(name)} ${probability.toFixed(2)}  ${bar(probability, 24)}`;
    }),
    ...(known ? [] : [gray("  (palavra desconhecida para o brinquedo: estas são as genéricas)")]),
    "",
    gray(wrap("Um LLM é treinado para uma coisa só: dado o texto até aqui, dar uma probabilidade a cada token possível para vir em seguida. Gerar texto é repetir essa escolha, token a token.", ctx.cols)),
  ].join("\n");
}

/** A word chosen with less than this chance shows in yellow. */
const UNLIKELY = 0.15;

function gen(line: ParsedLine, ctx: LabContext): Chunk[] {
  const prompt = promptOf(line);
  const temperature = flagNumber(line, "temperature", 1, 0, 2);
  const fixed = line.flags.seed !== undefined;
  let seed = fixed ? Math.round(flagNumber(line, "seed", 0, 0, 1_000_000)) : Math.floor(Math.random() * 10_000);
  let result = generate(prompt, temperature, seed);
  const countUnlikely = () => result.words.filter((word) => word.probability < UNLIKELY).length;
  // A random seed at a high temperature should show what it does: a few more draws if it did not.
  for (let tries = 0; !fixed && temperature >= 1.2 && countUnlikely() === 0 && tries < 8; tries++) {
    seed = (seed + 7919) % 10_000;
    result = generate(prompt, temperature, seed);
  }
  const { words, known } = result;
  const unlikely = countUnlikely();
  ctx.state.set("temperature", temperature);
  let note: string;
  if (temperature === 0) note = "Temperatura 0: sempre o token mais provável. Rode de novo e sai igual — bom para extrair dados, código, respostas exatas.";
  else if (temperature >= 1.2)
    note = unlikely
      ? `Temperatura alta achata as probabilidades: escolhas improváveis (em amarelo, ${unlikely} aqui) entram no texto. Mais variedade… e mais chance de besteira.`
      : "Temperatura alta achata as probabilidades, mas desta vez o sorteio ficou no provável. Rode de novo para ver escolhas estranhas.";
  else note = "Temperatura perto de 1 sorteia seguindo as probabilidades do modelo: variado, mas ainda coerente.";
  return [
    { text: dim(prompt) },
    ...words.map((word) => {
      const text = /^[.,!?]$/.test(word.word) ? word.word : ` ${word.word}`;
      return { text: word.probability < UNLIKELY ? yellow(text) : cyan(text), delay: 70 };
    }),
    {
      text: `\n${gray(`temperatura ${temperature} · seed ${seed}${fixed ? " (fixa)" : ""} · ${words.length} tokens`)}\n${known ? "" : `${gray("(o brinquedo conhece poucas palavras; tente “O céu é” ou “Era uma vez”)")}\n`}\n${gray(wrap(note, ctx.cols))}\n`,
      delay: 120,
    },
  ];
}

const WINDOW = 200_000;

function context(line: ParsedLine, ctx: LabContext): string {
  const history = Math.round(flagNumber(line, "history", 112_000, 0, 1_000_000));
  const parts: [string, number][] = [
    ["instruções (system)", 3_000],
    ["ferramentas", 9_000],
    ["conversa até aqui", history],
    ["sua mensagem", 1_200],
  ];
  const used = parts.reduce((sum, [, tokens]) => sum + tokens, 0);
  const free = WINDOW - used;
  const format = (tokens: number) => tokens.toLocaleString("pt-BR");
  ctx.state.set("context", true);
  return [
    `${bold("janela de contexto")} ${gray(`· ${format(WINDOW)} tokens (simulado)`)}`,
    ...parts.map(([name, tokens]) => `  ${padEnd(name, 20)} ${format(tokens).padStart(9)}  ${bar(tokens / WINDOW, 30)}`),
    free >= 0
      ? `  ${padEnd("livre", 20)} ${format(free).padStart(9)}  ${bar(free / WINDOW, 30)}`
      : `  ${red(padEnd("estourou", 20))} ${red(format(-free).padStart(9))}  ${red("não cabe")}`,
    "",
    gray(
      wrap(
        free >= 0
          ? "Tudo o que o modelo “sabe” da conversa precisa caber aqui, a cada chamada: ele não tem memória entre chamadas. Tente --history 250000 para ver estourar."
          : "Passou do limite: alguém (o harness) precisa cortar ou resumir a conversa antiga antes de chamar o modelo. Isso se chama compactação.",
        ctx.cols,
      ),
    ),
  ].join("\n");
}

function llm(line: ParsedLine, ctx: LabContext): Output {
  switch (line.args[0]?.toLowerCase()) {
    case "next":
      return next(line, ctx);
    case "gen":
      return gen(line, ctx);
    case "context":
      return context(line, ctx);
    default:
      throw new LabError(line.args[0] ? `llm não tem o subcomando “${line.args[0]}”` : "falta o subcomando: next, gen ou context");
  }
}

const isGen = (line: ParsedLine) => line.name === "llm" && line.args[0]?.toLowerCase() === "gen";

export const llmLesson: Lesson = {
  id: "llm",
  title: "LLM por dentro",
  summary: "Tokens, previsão do próximo token, temperatura e janela de contexto num modelo de brinquedo.",
  minutes: 12,
  commands: {
    tokenize: { summary: "quebra um texto em tokens, como o modelo vê", usage: 'tokenize "<texto>"', run: tokenizeCommand },
    llm: {
      summary: "o modelo: next (próximo token), gen (gerar) e context (janela)",
      usage: 'llm next|gen "<texto>" [--temperature T] [--seed N] · llm context [--history N]',
      subcommands: ["next", "gen", "context"],
      run: llm,
    },
  },
  steps: [
    {
      id: "tokenize",
      goal: "Veja como o modelo enxerga um texto: em tokens.",
      hint: 'tokenize "Olá, mundo! A inteligência artificial é incrível."',
      check: (line) => line.name === "tokenize",
    },
    {
      id: "next",
      goal: "Peça as probabilidades do próximo token depois de “O céu é”.",
      hint: 'llm next "O céu é"',
      check: (line) => line.name === "llm" && line.args[0]?.toLowerCase() === "next",
    },
    {
      id: "temperature-0",
      goal: "Gere um texto com temperatura 0 (sempre o mais provável).",
      hint: 'llm gen "O céu é" --temperature 0',
      check: (line, ctx) => isGen(line) && ctx.state.get("temperature") === 0,
    },
    {
      id: "temperature-high",
      goal: "Agora com temperatura alta (1.5) e compare.",
      hint: 'llm gen "O céu é" --temperature 1.5',
      check: (line, ctx) => isGen(line) && (ctx.state.get("temperature") as number) >= 1.2,
    },
    {
      id: "context",
      goal: "Veja o que ocupa a janela de contexto do modelo.",
      hint: "llm context",
      check: (line) => line.name === "llm" && line.args[0]?.toLowerCase() === "context",
    },
  ],
};
