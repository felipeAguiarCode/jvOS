import { bold, cyan, dim, gray, green, red, table, wrap, yellow } from "../ansi";
import { flagText, fold } from "../parse";
import { LabError, type Chunk, type LabContext, type Lesson, type ParsedLine } from "../types";

const EFFORTS = ["low", "medium", "high", "max"] as const;
type Effort = (typeof EFFORTS)[number];

interface Attempt {
  /** Reasoning tokens spent before answering. */
  tokens: number;
  answer: string;
  correct: boolean;
}

interface Problem {
  id: string;
  label: string;
  question: string;
  /** The model's thoughts, in order; each effort shows the first `depth[effort]` of them. */
  thoughts: string[];
  depth: Record<Effort, number>;
  attempts: Record<Effort, Attempt>;
}

const PROBLEMS: Problem[] = [
  {
    id: "bola",
    label: "armadilha de lógica",
    question: "Um bastão e uma bola custam R$ 1,10 juntos. O bastão custa R$ 1,00 a mais que a bola. Quanto custa a bola?",
    thoughts: [
      "bola = x; bastão = x + 1,00",
      "x + (x + 1,00) = 1,10",
      "2x = 0,10 → x = 0,05",
      "conferindo: 0,05 + 1,05 = 1,10 ✔",
      "e a resposta intuitiva, 0,10? 0,10 + 1,10 = 1,20 ✗ — descartada",
    ],
    depth: { low: 0, medium: 3, high: 4, max: 5 },
    attempts: {
      low: { tokens: 0, answer: "R$ 0,10", correct: false },
      medium: { tokens: 180, answer: "R$ 0,05", correct: true },
      high: { tokens: 900, answer: "R$ 0,05", correct: true },
      max: { tokens: 2_600, answer: "R$ 0,05", correct: true },
    },
  },
  {
    id: "agenda",
    label: "planejamento com restrições",
    question: "Marque 3 reuniões de 1 h entre 9h e 13h, com 30 min de intervalo entre elas, sem invadir o almoço (12h–13h).",
    thoughts: [
      "3 reuniões de 1 h = 3 h",
      "+ 2 intervalos de 30 min = 4 h no total",
      "janela livre: 9h–12h = 3 h (o almoço bloqueia 12h–13h)",
      "4 h não cabem em 3 h → impossível com 3 reuniões",
      "alternativas: sem intervalos cabem (9h, 10h, 11h), mas violam a regra; com intervalos, só 2",
    ],
    depth: { low: 0, medium: 1, high: 4, max: 5 },
    attempts: {
      low: { tokens: 0, answer: "9h, 10h30 e 12h", correct: false },
      medium: { tokens: 350, answer: "9h, 10h e 11h", correct: false },
      high: { tokens: 1_800, answer: "Impossível: com os intervalos só cabem 2 (9h e 10h30).", correct: true },
      max: { tokens: 4_800, answer: "Impossível: só cabem 2 (9h e 10h30); ou tire os intervalos, ou passe uma para depois das 13h.", correct: true },
    },
  },
  {
    id: "capital",
    label: "pergunta factual simples",
    question: "Qual é a capital da França?",
    thoughts: ["pergunta factual direta", "França → capital: Paris", "procurando pegadinha… não há"],
    depth: { low: 0, medium: 1, high: 2, max: 3 },
    attempts: {
      low: { tokens: 0, answer: "Paris", correct: true },
      medium: { tokens: 40, answer: "Paris", correct: true },
      high: { tokens: 300, answer: "Paris", correct: true },
      max: { tokens: 900, answer: "Paris", correct: true },
    },
  },
];

/** Tokens of the answer itself, the same at every effort. */
const ANSWER_TOKENS = 60;
const latency = (attempt: Attempt) => 0.4 + attempt.tokens / 400;
const cost = (attempt: Attempt) => (ANSWER_TOKENS + attempt.tokens) / ANSWER_TOKENS;
const seconds = (value: number) => `${value.toFixed(1).replace(".", ",")} s`;

function problemOf(line: ParsedLine): Problem {
  const id = fold(line.args[1] ?? "");
  if (!id) throw new LabError("falta o problema: bola, agenda ou capital (veja problems)");
  const problem = PROBLEMS.find((item) => item.id === id);
  if (!problem) throw new LabError(`não conheço o problema “${line.args[1]}”: use bola, agenda ou capital`);
  return problem;
}

function effortOf(line: ParsedLine): Effort {
  const effort = flagText(line, "effort", "medium").toLowerCase();
  if (!(EFFORTS as readonly string[]).includes(effort)) throw new LabError(`--effort aceita ${EFFORTS.join(", ")}`);
  return effort as Effort;
}

function problems(_line: ParsedLine, ctx: LabContext): string {
  return [
    bold("problemas de teste"),
    ...PROBLEMS.flatMap((problem) => [`  ${cyan(problem.id.padEnd(8))} ${gray(problem.label)}`, wrap(problem.question, ctx.cols, "           "), ""]),
    gray(`Pergunte com: ${cyan("llm ask <problema> --effort low|medium|high|max")}`),
  ].join("\n");
}

function ask(line: ParsedLine, ctx: LabContext): Chunk[] {
  const problem = problemOf(line);
  const effort = effortOf(line);
  const attempt = problem.attempts[effort];
  ctx.state.set("ask", { problem: problem.id, effort });
  const thoughts = problem.thoughts.slice(0, problem.depth[effort]);
  const pace = { low: 0, medium: 260, high: 380, max: 420 }[effort];
  return [
    { text: `${wrap(`${bold(`esforço ${effort}`)} ${gray(`· ${problem.question}`)}`, ctx.cols)}\n` },
    ...(thoughts.length
      ? [
          { text: `${dim("pensando…")}\n`, delay: 200 },
          ...thoughts.map((thought) => ({ text: `${dim(`  │ ${thought}`)}\n`, delay: pace })),
        ]
      : []),
    {
      text: [
        wrap(`${bold("resposta:")} ${attempt.answer}  ${attempt.correct ? green("✔ certa") : red("✗ errada")}`, ctx.cols),
        gray(`raciocínio ${attempt.tokens.toLocaleString("pt-BR")} tokens · latência ${seconds(latency(attempt))} · custo ${Math.round(cost(attempt))}× (simulado)`),
        "",
        gray(
          wrap(
            !thoughts.length && !attempt.correct
              ? "Sem pensar antes, o modelo respondeu o que “parece” certo. Problemas de várias etapas pedem mais esforço."
              : !attempt.correct
                ? "Pensou um pouco, mas parou cedo e deixou uma restrição de fora. Este problema pede mais esforço."
                : effort === "low"
                  ? "Pergunta simples, esforço baixo: resposta certa, rápida e barata."
                  : problem.id === "capital"
                    ? "Certa, mas o esforço extra só custou tempo e tokens: esta pergunta não precisava."
                    : "Com espaço para raciocinar, o modelo montou o problema passo a passo e conferiu a conta.",
            ctx.cols,
          ),
        ),
      ].join("\n"),
      delay: thoughts.length ? 300 : 350,
    },
  ];
}

function compare(line: ParsedLine, ctx: LabContext): string {
  const problem = problemOf(line);
  ctx.state.set("compared", problem.id);
  const cheapest = EFFORTS.find((effort) => problem.attempts[effort].correct);
  return [
    `${bold("effort compare")} ${gray(`· ${problem.id}: ${problem.label}`)}`,
    table(
      ["esforço", "raciocínio", "latência", "custo", "resposta"],
      EFFORTS.map((effort) => {
        const attempt = problem.attempts[effort];
        return [effort, `${attempt.tokens.toLocaleString("pt-BR")} tok`, seconds(latency(attempt)), `${Math.round(cost(attempt))}×`, attempt.correct ? green("✔") : red("✗")];
      }),
      [1, 2, 3],
    ),
    "",
    cheapest ? `${yellow("→")} o menor esforço que acerta: ${bold(cheapest)}` : red("nenhum esforço acertou"),
    gray(wrap("Mais esforço compra mais raciocínio, ao preço de tempo e tokens. Escolha o menor que resolve a tarefa.", ctx.cols)),
  ].join("\n");
}

const asked = (ctx: LabContext, problem: string, effort: Effort) => {
  const last = ctx.state.get("ask") as { problem: string; effort: Effort } | undefined;
  return last?.problem === problem && last.effort === effort;
};
const isAsk = (line: ParsedLine) => line.name === "llm" && line.args[0]?.toLowerCase() === "ask";

export const esforco: Lesson = {
  id: "esforco",
  title: "Nível de esforço",
  summary: "Quanto o modelo pensa antes de responder: acerto × latência × custo, de low a max.",
  minutes: 10,
  commands: {
    problems: { summary: "lista os problemas de teste", usage: "problems", run: problems },
    llm: {
      summary: "pergunta ao modelo com um nível de esforço",
      usage: "llm ask <problema> [--effort low|medium|high|max]",
      subcommands: ["ask"],
      run(line, ctx) {
        if (!isAsk(line)) throw new LabError(line.args[0] ? `llm não tem o subcomando “${line.args[0]}” nesta lição` : "falta o subcomando: ask");
        return ask(line, ctx);
      },
    },
    effort: {
      summary: "compara os níveis de esforço num problema",
      usage: "effort compare <problema>",
      subcommands: ["compare"],
      run(line, ctx) {
        if (line.args[0]?.toLowerCase() !== "compare") throw new LabError("use effort compare <problema>");
        return compare(line, ctx);
      },
    },
  },
  steps: [
    {
      id: "problems",
      goal: "Veja os problemas de teste.",
      hint: "problems",
      check: (line) => line.name === "problems",
    },
    {
      id: "low",
      goal: "Pergunte o problema da bola com esforço baixo.",
      hint: "llm ask bola --effort low",
      check: (line, ctx) => isAsk(line) && asked(ctx, "bola", "low"),
    },
    {
      id: "high",
      goal: "Agora o mesmo problema com esforço alto: veja o modelo pensar.",
      hint: "llm ask bola --effort high",
      check: (line, ctx) => isAsk(line) && asked(ctx, "bola", "high"),
    },
    {
      id: "compare",
      goal: "Compare todos os níveis no problema da agenda (planejamento com restrições).",
      hint: "effort compare agenda",
      check: (line, ctx) => line.name === "effort" && ctx.state.get("compared") === "agenda",
    },
    {
      id: "simple",
      goal: "Uma pergunta simples não pede esforço alto: pergunte a capital com esforço baixo.",
      hint: "llm ask capital --effort low",
      check: (line, ctx) => isAsk(line) && asked(ctx, "capital", "low"),
    },
  ],
};
