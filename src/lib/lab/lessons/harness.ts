import { bar, bold, cyan, dim, gray, green, red, table, wrap, yellow } from "../ansi";
import { flagText } from "../parse";
import { LabError, type Chunk, type LabContext, type Lesson, type Output, type ParsedLine } from "../types";

const DIAGRAM = [
  "┌──────────────────────── harness ────────────────────────┐",
  "│  instruções (system)    ferramentas    permissões       │",
  "│                                                         │",
  "│  você ──► mensagem ──► ┌────────┐ ──► resposta ──► você │",
  "│                        │ modelo │                       │",
  "│      resultado ──────► └────────┘ ──► tool_use          │",
  "│          ▲                               │              │",
  "│          └──── o harness executa ◄───────┘              │",
  "│                                                         │",
  "│  contexto e compactação · hooks · memória · subagentes  │",
  "└─────────────────────────────────────────────────────────┘",
];

function inspect(_line: ParsedLine, ctx: LabContext): string {
  const drawing =
    ctx.cols >= DIAGRAM[0].length + 2
      ? DIAGRAM.map((row) => row.replace(/modelo|harness|tool_use/g, (word) => cyan(word))).join("\n")
      : ["harness = instruções + ferramentas + permissões + loop + contexto + hooks", "  você → modelo → (tool_use → harness executa → resultado → modelo)* → resposta"].join("\n");
  return [
    drawing,
    "",
    gray(
      wrap(
        "O modelo só recebe texto e devolve texto. Ler arquivos, rodar comandos, pedir permissão, guardar a conversa e decidir quando parar é trabalho do harness. O modelo é o motor; o harness é o resto do carro.",
        ctx.cols,
      ),
    ),
  ].join("\n");
}

const TOOLS: [name: string, does: string, permission: string][] = [
  ["read_file", "lê um arquivo", "livre"],
  ["search", "procura texto no projeto", "livre"],
  ["edit_file", "altera um arquivo", "pergunta"],
  ["run", "roda um comando no terminal", "pergunta"],
  ["web_fetch", "baixa uma página da web", "pergunta"],
];

function tools(_line: ParsedLine, ctx: LabContext): string {
  return [
    bold("ferramentas oferecidas ao modelo"),
    table(
      ["ferramenta", "o que faz", "permissão"],
      TOOLS.map(([name, does, permission]) => [cyan(name), does, permission === "livre" ? green(permission) : yellow(permission)]),
    ),
    "",
    gray("O modelo pede uma ferramenta assim (JSON), e quem executa é o harness:"),
    `  ${dim('{ "type": "tool_use", "name": "read_file", "input": { "path": "src/soma.ts" } }')}`,
    "",
    gray(wrap("Cada ferramenta vai para o modelo como nome, descrição e parâmetros (JSON Schema). As permissões são regras do harness, não do modelo.", ctx.cols)),
  ].join("\n");
}

type Mode = "default" | "plan";

type Event =
  | { kind: "turn"; context: number }
  | { kind: "think"; text: string }
  | { kind: "tool"; name: string; input: string; gate?: "asked" | "denied" }
  | { kind: "result"; text: string; failed?: boolean }
  | { kind: "done"; text: string };

const SCRIPTS: Record<Mode, Event[]> = {
  default: [
    { kind: "turn", context: 4_210 },
    { kind: "think", text: "Vou rodar os testes para ver o que falha." },
    { kind: "tool", name: "run", input: '{"command":"npm test"}', gate: "asked" },
    { kind: "result", text: "FAIL soma.test.ts — esperado 5, recebido -1", failed: true },
    { kind: "turn", context: 4_890 },
    { kind: "think", text: "O erro está em soma(). Vou ler o arquivo." },
    { kind: "tool", name: "read_file", input: '{"path":"src/soma.ts"}' },
    { kind: "result", text: "export const soma = (a, b) => a - b;" },
    { kind: "turn", context: 5_120 },
    { kind: "think", text: "Está subtraindo. Vou trocar - por +." },
    { kind: "tool", name: "edit_file", input: '{"path":"src/soma.ts","old":"a - b","new":"a + b"}', gate: "asked" },
    { kind: "result", text: "arquivo alterado" },
    { kind: "turn", context: 5_430 },
    { kind: "tool", name: "run", input: '{"command":"npm test"}', gate: "asked" },
    { kind: "result", text: "PASS 12 testes" },
    { kind: "turn", context: 5_610 },
    { kind: "done", text: "Corrigi soma() em src/soma.ts (subtraía em vez de somar). Os 12 testes passam." },
  ],
  plan: [
    { kind: "turn", context: 4_350 },
    { kind: "think", text: "Modo plan: só posso ler. Vou procurar o código e o teste." },
    { kind: "tool", name: "search", input: '{"query":"soma"}' },
    { kind: "result", text: "src/soma.ts, tests/soma.test.ts" },
    { kind: "turn", context: 4_720 },
    { kind: "tool", name: "read_file", input: '{"path":"src/soma.ts"}' },
    { kind: "result", text: "export const soma = (a, b) => a - b;" },
    { kind: "turn", context: 4_950 },
    { kind: "think", text: "Achei o erro. Vou tentar corrigir." },
    { kind: "tool", name: "edit_file", input: '{"path":"src/soma.ts","old":"a - b","new":"a + b"}', gate: "denied" },
    { kind: "result", text: "erro: permissão negada (modo plan é só leitura)", failed: true },
    { kind: "turn", context: 5_080 },
    { kind: "done", text: "Plano: 1) em src/soma.ts trocar a - b por a + b; 2) rodar npm test. Nada foi alterado." },
  ],
};

function render(event: Event): string {
  switch (event.kind) {
    case "turn":
      return gray(`── turno · contexto ${event.context.toLocaleString("pt-BR")} tokens`);
    case "think":
      return `${cyan("● modelo:")} ${event.text}`;
    case "tool": {
      const gate =
        event.gate === "denied"
          ? `\n  ${red("✗ negado pelo harness: o modo plan não deixa editar")}`
          : event.gate === "asked"
            ? `\n  ${green("✔ permitido")} ${gray("(a ferramenta pede permissão; aprovado na simulação)")}`
            : "";
      return `${yellow("⚙ tool_use")} ${event.name} ${dim(event.input)}${gate}`;
    }
    case "result":
      return `${gray("↳ resultado:")} ${event.failed ? red(event.text) : event.text}`;
    case "done":
      return `${green("★ resposta final:")} ${event.text}`;
  }
}

function run(line: ParsedLine, ctx: LabContext): Chunk[] {
  const task = line.args.slice(1).join(" ").trim();
  if (!task) throw new LabError("falta a tarefa, entre aspas");
  const mode = flagText(line, "mode", "default").toLowerCase();
  if (mode !== "default" && mode !== "plan") throw new LabError("--mode aceita default ou plan");
  ctx.state.set("ran", mode);
  const script = SCRIPTS[mode];
  const turns = script.filter((event) => event.kind === "turn").length;
  const calls = script.filter((event) => event.kind === "tool").length;
  return [
    { text: `${bold("harness run")} ${gray(`· “${task}” · modo ${mode}`)}\n` },
    ...script.map((event) => ({ text: `${wrap(render(event), ctx.cols, "")}\n`, delay: event.kind === "turn" ? 320 : 220 })),
    {
      text: `\n${gray(
        wrap(
          `${turns} chamadas ao modelo e ${calls} ferramentas pedidas. A cada turno o harness reenvia tudo (instruções, ferramentas, histórico e resultados): por isso o contexto cresce. ${
            mode === "plan" ? "No modo plan a mesma tarefa virou um plano: quem barrou a edição foi o harness, não o modelo." : "O loop para quando o modelo responde sem pedir ferramenta."
          }${task.toLowerCase().includes("teste") ? "" : " (A simulação sempre roda o cenário do teste que falha.)"}`,
          ctx.cols,
        ),
      )}\n`,
      delay: 200,
    },
  ];
}

const WINDOW = 200_000;

function context(_line: ParsedLine, ctx: LabContext): Chunk[] {
  const timeline: [turn: number, tokens: number][] = [
    [5, 21_000],
    [15, 64_000],
    [25, 118_000],
    [35, 167_000],
  ];
  const row = (turn: number, tokens: number, note = "") =>
    `  turno ${String(turn).padStart(2)}  ${bar(tokens / WINDOW, 24)} ${String(Math.round((tokens / WINDOW) * 100)).padStart(3)}%${note}`;
  ctx.state.set("context", true);
  return [
    { text: `${bold("harness context")} ${gray(`· uma sessão longa numa janela de ${WINDOW.toLocaleString("pt-BR")} tokens (simulado)`)}\n` },
    ...timeline.map(([turn, tokens], i) => ({
      text: `${row(turn, tokens, i === timeline.length - 1 ? yellow("  ← passou de 80%") : "")}\n`,
      delay: 300,
    })),
    { text: `${yellow("  compactando…")} ${gray("o modelo resume os turnos antigos")}\n`, delay: 500 },
    { text: `${wrap(`${gray("histórico:")} 167.000 → 14.000 tokens ${gray("(resumo + arquivos e decisões importantes)")}`, ctx.cols, "  ")}\n`, delay: 600 },
    { text: `${row(36, 26_000, green("  ← continua de onde parou"))}\n`, delay: 300 },
    {
      text: `\n${gray(
        wrap(
          "Detalhes antigos se perdem no resumo; o que precisa sobreviver sempre (regras do projeto, preferências) vai num arquivo de instruções que o harness recarrega a cada sessão.",
          ctx.cols,
        ),
      )}\n`,
      delay: 200,
    },
  ];
}

function hooks(_line: ParsedLine, ctx: LabContext): string {
  return [
    bold("hooks: código que o harness roda em eventos"),
    table(
      ["evento", "exemplo"],
      [
        ["antes de uma ferramenta", "bloquear run com “rm -rf”"],
        ["depois de edit_file", "rodar o formatador no arquivo"],
        ["ao terminar", "avisar no celular que acabou"],
      ],
    ),
    "",
    gray(wrap("Hooks são determinísticos: não dependem de o modelo lembrar de nada. Servem para garantir regras que um pedido no prompt só sugere.", ctx.cols)),
  ].join("\n");
}

const SUBCOMMANDS: Record<string, (line: ParsedLine, ctx: LabContext) => Output> = { inspect, tools, run, context, hooks };
const sub = (line: ParsedLine) => line.args[0]?.toLowerCase();
const TASK = '"corrija o teste que falha"';

export const harness: Lesson = {
  id: "harness",
  title: "Harness",
  summary: "O que transforma um modelo num agente: ferramentas, loop, permissões, contexto e hooks.",
  minutes: 12,
  commands: {
    harness: {
      summary: "inspect, tools, run, context e hooks de um harness de agente",
      usage: 'harness inspect|tools|context|hooks · harness run "<tarefa>" [--mode default|plan]',
      subcommands: Object.keys(SUBCOMMANDS),
      run(line, ctx) {
        const handler = SUBCOMMANDS[sub(line) ?? ""];
        if (!handler) throw new LabError(line.args[0] ? `harness não tem o subcomando “${line.args[0]}”` : "falta o subcomando: inspect, tools, run, context ou hooks");
        return handler(line, ctx);
      },
    },
  },
  steps: [
    {
      id: "inspect",
      goal: "Veja as peças de um harness em volta do modelo.",
      hint: "harness inspect",
      check: (line) => line.name === "harness" && sub(line) === "inspect",
    },
    {
      id: "tools",
      goal: "Liste as ferramentas que o harness oferece ao modelo.",
      hint: "harness tools",
      check: (line) => line.name === "harness" && sub(line) === "tools",
    },
    {
      id: "run",
      goal: "Dê uma tarefa ao agente e acompanhe o loop: modelo → ferramenta → resultado → modelo.",
      hint: `harness run ${TASK}`,
      check: (line, ctx) => line.name === "harness" && sub(line) === "run" && ctx.state.get("ran") === "default",
    },
    {
      id: "plan",
      goal: "Rode a mesma tarefa no modo plan (só leitura) e veja a permissão barrar a edição.",
      hint: `harness run ${TASK} --mode plan`,
      check: (line, ctx) => line.name === "harness" && sub(line) === "run" && ctx.state.get("ran") === "plan",
    },
    {
      id: "context",
      goal: "Veja o harness compactar o contexto de uma sessão longa.",
      hint: "harness context",
      check: (line) => line.name === "harness" && sub(line) === "context",
    },
  ],
};
