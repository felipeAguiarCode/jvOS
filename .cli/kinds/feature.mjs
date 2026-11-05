// A feature: behaviour without a window of its own (a voice shortcut, a JARVIS tool, a rule).
import { featureSteps } from "../lib/checklist.mjs";
import { PATHS } from "../lib/repo.mjs";
import { camel, constant, FEATURE_PATTERN, pascal, snake, splitList, words } from "../lib/names.mjs";
import { fillTemplate } from "../lib/render.mjs";
import { featureSpecs } from "../lib/specs.mjs";

const TOUCHES = [
  { value: "voice", label: "Atalho de voz do JARVIS", hint: "shortcut:<id>" },
  { value: "data", label: "Dados salvos", hint: "localStorage jarvis.*" },
  { value: "command", label: "Comando Tauri", hint: "Rust, com fake em DEV" },
  { value: "tool", label: "Ferramenta MCP do JARVIS", hint: "o Claude chama" },
];

async function collect(repo, q, date) {
  const id = await q.text("id", {
    question: "Id da feature (kebab-case)",
    hint: "ex.: daily-quote",
    positional: true,
    validate: (answer) => {
      if (!FEATURE_PATTERN.test(answer) || answer.length < 2 || answer.length > 40) return "use kebab-case: minúsculas, números e hífens (2 a 40)";
      if (repo.folders.features.includes(answer)) return `já existe .specs/features/${answer}`;
      if (repo.exists(`tests/${answer}.spec.ts`)) return `já existe tests/${answer}.spec.ts`;
      return null;
    },
  });
  const title = await q.text("title", { question: "Nome legível (PT-BR)", initial: words(id).map((word, index) => (index ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(" ") });
  const desc = await q.text("desc", { question: "O que faz, em uma frase", initial: `${title}: <o que faz>.` });
  const us1 = await q.text("us1", { question: "Título da primeira história (US1)", initial: title });
  const known = TOUCHES.map((touch) => touch.value);
  const touches = await q.many("touches", {
    question: "O que a feature toca?",
    options: TOUCHES,
    validate: (list) => {
      const unknown = list.find((value) => !known.includes(value));
      return unknown ? `"${unknown}" não é ${known.join(", ")}` : null;
    },
  });
  const name = camel(id);
  const rust = repo.optionalText(PATHS.libRs) ?? "";
  const mcp = repo.optionalText(PATHS.mcpRs) ?? "";
  let phrases = [];
  let needsText = false;
  if (touches.includes("voice")) {
    if (repo.voice.some((command) => command.id === `shortcut:${name}`)) throw new q.UsageError(`já existe o atalho shortcut:${name}`);
    phrases = splitList(await q.text("voice", { question: "Frases do atalho, separadas por vírgula", initial: title.toLowerCase(), validate: (answer) => (splitList(answer).length ? null : "diga ao menos uma frase") }));
    needsText = await q.yes("text", { question: 'Precisa de texto depois da frase? ("anota que …")', initial: false });
  }
  const command = touches.includes("command")
    ? await q.text("command", {
        question: "Nome do comando Tauri (<domínio>_<verbo>)",
        initial: `${snake(id)}_get`,
        validate: (answer) =>
          !/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(answer) ? "use <domínio>_<verbo> em snake_case" : new RegExp(`fn ${answer}\\(`).test(rust) ? `já existe fn ${answer} em src-tauri/src/lib.rs` : null,
      })
    : "";
  const tool = touches.includes("tool")
    ? await q.text("tool", {
        question: "Nome da ferramenta MCP (snake_case)",
        initial: snake(id),
        validate: (answer) => (!/^[a-z][a-z0-9_]{1,39}$/.test(answer) ? "use snake_case" : mcp.includes(`"${answer}",`) ? `já existe a ferramenta ${answer}` : null),
      })
    : "";
  // A command's adapter and a parser live in the lib, so those always get one.
  const lib = touches.includes("command") || touches.includes("data") ? true : await q.yes("lib", { question: "Cria um módulo TS em src/lib, com teste?", initial: true });
  const libPath = lib ? `src/lib/${name}.ts` : null;
  if (libPath && repo.exists(libPath)) throw new q.UsageError(`já existe ${libPath}`);
  return {
    id,
    title,
    desc,
    us1,
    touches,
    phrases,
    needsText,
    command,
    tool,
    camel: name,
    pascal: pascal(id),
    snake: snake(id),
    CONST: constant(id),
    storageKey: `jarvis.${name}`,
    lib: libPath,
    testName: lib ? id : null,
    about: title,
    date,
  };
}

function build(repo, item) {
  const values = {
    id: item.id,
    title: item.title,
    desc: item.desc,
    pascal: item.pascal,
    camel: item.camel,
    CONST: item.CONST,
    storageKey: item.storageKey,
    data: item.touches.includes("data"),
    command: item.command,
  };
  const code = [];
  if (item.lib) {
    code.push({ role: "lib", path: item.lib, note: "Módulo da feature (regra pura" + (item.command ? ", adaptador do comando" : "") + (values.data ? ", preferências" : "") + ")", content: fillTemplate("feature/lib.ts.tpl", values) });
    code.push({ role: "test", path: `tests/${item.id}.spec.ts`, note: "Teste Playwright dos helpers", content: fillTemplate("feature/test.spec.ts.tpl", values) });
  }
  const steps = featureSteps(repo, item);
  const dir = `.specs/features/${item.id}`;
  const spec = featureSpecs(repo, item, [{ path: `${dir}/spec.md`, note: "Spec (dados, componentes, aceite, código e tarefas)" }, ...code], steps);
  const files = [
    { path: `${dir}/spec.md`, note: "spec", content: spec },
    ...code,
  ];
  const summary = [
    ["tipo", "feature"],
    ["id", item.id],
    ["nome", item.title],
    ["toca", item.touches.length ? item.touches.map((value) => TOUCHES.find((touch) => touch.value === value).label).join(" · ") : "só a regra"],
  ];
  if (item.phrases.length) summary.push(["voz", `shortcut:${item.camel} · ${item.phrases.join(", ")}${item.needsText ? " (+ texto)" : ""}`]);
  if (item.command) summary.push(["comando", item.command]);
  if (item.tool) summary.push(["tool", item.tool]);
  if (values.data) summary.push(["dados", item.storageKey]);
  return { files, steps, summary };
}

export const feature = {
  value: "feature",
  label: "Feature",
  hint: "comportamento sem janela própria",
  collect,
  build,
};
