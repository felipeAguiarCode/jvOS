import { bar, bold, dim, gray, green, red, table, wrap } from "../ansi";
import { flagNumber, fold } from "../parse";
import { LabError, type Chunk, type LabContext, type Lesson, type ParsedLine } from "../types";

const DATASET: [text: string, spam: boolean][] = [
  ["Ganhe dinheiro rápido, clique aqui!", true],
  ["Reunião amanhã às 10h", false],
  ["PROMOÇÃO imperdível: prêmio grátis", true],
  ["Segue o relatório do mês", false],
  ["Você foi sorteado! Resgate já", true],
  ["Almoço na sexta?", false],
  ["Oferta exclusiva, só hoje!!!", true],
  ["Fatura de outubro em anexo", false],
];

/** The hand-written filter: the "traditional programming" way. */
const RULES = ["grátis", "dinheiro", "promoção", "clique aqui"];

/** What training "finds" in the dataset: a weight per clue (spam > 0, normal < 0). */
const WEIGHTS: [clue: string, weight: number][] = [
  ["gratis", 2.2],
  ["dinheiro", 1.9],
  ["ganhe", 1.6],
  ["premio", 1.6],
  ["clique", 1.5],
  ["oferta", 1.3],
  ["sorteado", 1.3],
  ["!!!", 1.1],
  ["reuniao", -1.8],
  ["relatorio", -1.6],
  ["fatura", -1.0],
  ["amanha", -0.8],
];
const BIAS = -0.6;

/** How far training got: 0 untrained, near 1 after many epochs. */
const fitted = (epochs: number) => 1 - Math.exp(-epochs / 4);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** Undoes the usual disguises (gr4tis, d1nheiro) and accents. */
const normalize = (text: string) => fold(text).replace(/4|@/g, "a").replace(/1/g, "i").replace(/3/g, "e").replace(/0/g, "o").replace(/\$/g, "s");

const textArg = (line: ParsedLine) => {
  const text = line.args.join(" ").trim();
  if (!text) throw new LabError("falta a mensagem, entre aspas");
  return text;
};

function rules(line: ParsedLine, ctx: LabContext): string {
  const text = textArg(line);
  const folded = fold(text);
  const hits = RULES.filter((rule) => folded.includes(fold(rule)));
  return [
    `${bold("filtro por regras")} ${gray("(escrito à mão)")}`,
    ...RULES.map((rule) => `  ${hits.includes(rule) ? green("✔") : gray("✗")} contém “${rule}”`),
    "",
    hits.length ? `→ ${red("SPAM")} (${hits.length} regra${hits.length > 1 ? "s" : ""} disparou)` : `→ ${green("NÃO É SPAM")} (nenhuma regra disparou)`,
    "",
    gray(
      wrap(
        hits.length
          ? "Funcionou desta vez. Agora tente uma variação: basta trocar uma letra por um número para a regra não reconhecer."
          : "Parece spam, mas escapou: regras escritas à mão só pegam o que alguém previu. Cada variação (gr4tis, d1nheiro…) exigiria uma regra nova.",
        ctx.cols,
      ),
    ),
  ].join("\n");
}

function dataset(_line: ParsedLine, ctx: LabContext): string {
  return [
    bold(`dataset · ${DATASET.length} exemplos rotulados`),
    table(
      ["#", "mensagem", "rótulo"],
      DATASET.map(([text, spam], i) => [String(i + 1), text, spam ? red("spam") : green("normal")]),
    ),
    "",
    gray(wrap("Cada exemplo traz a resposta certa (o rótulo): isso é aprendizado supervisionado. Ninguém escreve regras: o modelo vai procurar, sozinho, os padrões que separam um rótulo do outro.", ctx.cols)),
  ].join("\n");
}

function train(line: ParsedLine, ctx: LabContext): Chunk[] {
  const epochs = Math.round(flagNumber(line, "epochs", 5, 1, 50));
  ctx.state.set("epochs", epochs);
  const shown = epochs <= 8 ? Array.from({ length: epochs }, (_, i) => i + 1) : [1, 2, 3, 4, Math.round(epochs / 2), epochs - 1, epochs];
  const loss = (epoch: number) => 0.06 + 0.63 * Math.exp(-epoch / 2.2);
  const learnt = fitted(epochs);
  return [
    { text: `${bold("treinando")} com ${DATASET.length} exemplos ${gray("(simulado)")}\n` },
    ...shown.map((epoch) => ({
      text: `  época ${String(epoch).padStart(2)}/${epochs}  loss ${loss(epoch).toFixed(3)}  ${bar(loss(epoch) / 0.69, 24)}\n`,
      delay: 260,
    })),
    {
      text: [
        "",
        `${green("pronto:")} ${WEIGHTS.length + 1} parâmetros ajustados (um peso por pista + o viés)`,
        table(
          ["pista", "peso"],
          WEIGHTS.slice(0, 6).map(([clue, weight]) => [clue, (weight * learnt >= 0 ? "+" : "") + (weight * learnt).toFixed(2)]),
          [1],
        ),
        gray("…e mais pistas com peso negativo, como “reuniao” e “relatorio”."),
        "",
        gray(wrap("Loss é o erro do modelo nos exemplos: cada época passa pelos dados e ajusta os pesos para errar menos. Agora o modelo pode fazer inferência com predict.", ctx.cols)),
      ].join("\n"),
      delay: 200,
    },
  ];
}

function predict(line: ParsedLine, ctx: LabContext): string {
  const text = textArg(line);
  const epochs = ctx.state.get("epochs");
  if (typeof epochs !== "number") throw new LabError("o modelo ainda não foi treinado: rode train primeiro");
  const clean = normalize(text);
  const learnt = fitted(epochs);
  const shouting = text.replace(/[^\p{L}]/gu, "").length > 4 && text === text.toUpperCase() ? 0.8 : 0;
  const clues = WEIGHTS.filter(([clue]) => clean.includes(clue));
  const score = BIAS + shouting + clues.reduce((sum, [, weight]) => sum + weight * learnt, 0);
  const probability = sigmoid(score);
  ctx.state.set("lastProbability", probability);
  const spam = probability >= 0.5;
  return [
    `${bold("inferência")} ${gray(`(modelo treinado por ${epochs} época${epochs > 1 ? "s" : ""})`)}`,
    `  P(spam) = ${probability.toFixed(2)}  ${bar(probability, 24)}`,
    `  → ${spam ? red("SPAM") : green("NORMAL")}`,
    clues.length
      ? `  pistas: ${clues.map(([clue, weight]) => `${clue} ${weight > 0 ? red(`+${(weight * learnt).toFixed(1)}`) : green((weight * learnt).toFixed(1))}`).join(", ")}`
      : `  pistas: ${dim("nenhuma conhecida")}`,
    "",
    gray(
      wrap(
        clean !== fold(text)
          ? "O modelo não depende da grafia exata: aqui “gr4tis” conta como “gratis” (simulado com uma normalização; modelos reais aprendem isso dos dados)."
          : "Inferência é usar o modelo já treinado numa mensagem que ele nunca viu.",
        ctx.cols,
      ),
    ),
  ].join("\n");
}

const DISGUISED = '"Gr4tis!!! Ganhe d1nheiro"';

export const ia: Lesson = {
  id: "ia",
  title: "O que é IA",
  summary: "Regras escritas à mão × aprendizado com dados; treino, loss e inferência num filtro de spam.",
  minutes: 10,
  commands: {
    rules: { summary: "classifica uma mensagem com regras escritas à mão", usage: 'rules "<mensagem>"', run: rules },
    dataset: { summary: "mostra os exemplos rotulados para o treino", usage: "dataset", run: dataset },
    train: { summary: "treina o classificador de spam", usage: "train [--epochs N]", run: train },
    predict: { summary: "usa o modelo treinado numa mensagem nova (inferência)", usage: 'predict "<mensagem>"', run: predict },
  },
  steps: [
    {
      id: "rules",
      goal: `Teste o filtro feito à mão com uma mensagem disfarçada: rules ${DISGUISED}`,
      hint: `rules ${DISGUISED}`,
      check: (line) => line.name === "rules",
    },
    {
      id: "dataset",
      goal: "Veja os exemplos rotulados de onde o modelo vai aprender.",
      hint: "dataset",
      check: (line) => line.name === "dataset",
    },
    {
      id: "train",
      goal: "Treine o modelo por 5 épocas e veja o erro (loss) cair.",
      hint: "train --epochs 5",
      check: (line, ctx) => line.name === "train" && ctx.state.has("epochs"),
    },
    {
      id: "predict-spam",
      goal: `Faça inferência com a mesma mensagem disfarçada: predict ${DISGUISED}`,
      hint: `predict ${DISGUISED}`,
      check: (line, ctx) => line.name === "predict" && (ctx.state.get("lastProbability") as number) >= 0.5,
    },
    {
      id: "predict-normal",
      goal: "Agora uma mensagem normal, que o modelo deve deixar passar.",
      hint: 'predict "Reunião do projeto amanhã"',
      check: (line, ctx) => line.name === "predict" && (ctx.state.get("lastProbability") as number) < 0.5,
    },
  ],
};
