// The new spec.md (and ADRs), made from .specs/_templates. One file per item, in the SpecLang
// format (data, components with behaviour, layout and style, voice) with the ids, the acceptance,
// the code map and the tasks merged in. The header, the lead, the data, the components, the first
// story, the code map and the tasks come filled; the rest stays as the template has it, for the
// author to write.
import { asTasks } from "./checklist.mjs";
import { dayMonth, showSize } from "./names.mjs";
import { dropComments, getSection, setLead, setRange, setRow, setSection, setTitle, table, tidyMarkdown } from "./render.mjs";

const quoted = (phrases) => phrases.map((phrase) => `"${phrase}"`).join(", ");
const rfId = (number) => `RF-${String(number).padStart(3, "0")}`;

/** The ADRs a kind of item usually leans on, as links from .specs/<group>/<folder>/. */
function adrLinks(repo, numbers) {
  return repo.adrs
    .filter((adr) => numbers.includes(adr.number))
    .map((adr) => `- [ADR-${String(adr.number).padStart(4, "0")} — ${adr.title}](../../arch/adr/${adr.file})`)
    .join("\n");
}

/**
 * A task in the spec-coding.dev Tasks Plan shape: the line, then "Aceite", "Arquivos permitidos",
 * "Comando de teste" and "Evidência" (the ones given).
 * @param {{ done?: boolean, id: string, title: string, accept?: string, files?: string[], test?: string, evidence?: string }} task
 */
export function taskLines({ done = false, id, title, accept, files = [], test, evidence }) {
  const fields = [
    accept && `Aceite: ${accept}`,
    files.length && `Arquivos permitidos: ${files.map((file) => `\`${file}\``).join(", ")}`,
    test && `Comando de teste: \`${test}\``,
    evidence && `Evidência: ${evidence}`,
  ].filter(Boolean);
  return [`- [${done ? "x" : " "}] ${id} ${title}`, ...fields.map((field) => `  - ${field}`)].join("\n");
}

const taskId = (number) => `T${String(number).padStart(3, "0")}`;

/** The tasks for the files the CLI wrote, already done. */
const doneTasks = (files) =>
  files.map((file, index) => taskLines({ done: true, id: `${taskId(index + 1)}${index ? " [P]" : ""}`, title: file.note, files: [file.path], evidence: "criado por `npm run new`" }));

/** The Playwright command for one spec file of the `ui` project. */
const playwright = (testName) => `npx playwright test tests/${testName}.spec.ts --project ui`;

/**
 * The acceptance of the first story, in the spec-coding.dev format: `### Critério N (US1)` blocks
 * with **Dado** / **Quando** / **Então** under `## Critérios de aceite`, and the link the story
 * shows in their place. A criterion is `[given, when, then]`; `when` may be null (a state).
 * @param {string} md
 * @param {[string, string | null, string][]} criteria
 * @returns {{ md: string, link: string }}
 */
function setAcceptance(md, criteria) {
  const blocks = criteria.map(([given, when, then], index) =>
    [`### Critério ${index + 1} (US1)`, "", `- **Dado** ${given}`, ...(when ? [`- **Quando** ${when}`] : []), `- **Então** ${then}`].join("\n"),
  );
  const range = criteria.length === 1 ? "critério 1" : `critérios 1 a ${criteria.length}`;
  return { md: setSection(md, "## Critérios de aceite", blocks.join("\n\n")), link: `**Aceite:** [${range}](#critérios-de-aceite).` };
}

/** The paragraph between `## Entregáveis` and its table. */
const setCodeSummary = (md, text) => setRange(md, /^## Entregáveis$/, /^\| \| \|$/, `## Entregáveis\n\n${text}`);

/** `[label](path)` for a vendor spec, from .specs/<group>/<folder>/. */
const vendor = (id, label) => `[${label}](../../foundation/vendor/${id}/spec.md)`;

/** `## Tarefas` from the first phase on, and `## Pendências`. */
function setTasks(md, files, steps, rest) {
  const done = doneTasks(files);
  let next = done.length + 1;
  const registry = asTasks(steps, next);
  next += registry.length;
  const number = () => `T${String(next++).padStart(3, "0")}`;
  const phases = ["### Fase 1 — Esqueleto (gerado por `npm run new`)", "", ...done, "", "### Fase 2 — Registro (checklist do CLI)", "", ...registry, "", ...rest(number)];
  md = setRange(md, /^### Fase 1/, /^## Pendências/, phases.join("\n"));
  return setSection(md, "## Pendências", "Nenhuma por enquanto.");
}

/**
 * A window (widget or app).
 * @param {import("./repo.mjs").Repo} repo
 * @param {object} item see kinds/window.mjs
 * @param {{ path: string, note: string }[]} files
 * @param {import("./checklist.mjs").Step[]} steps
 * @returns {string} the spec.md
 */
export function windowSpecs(repo, item, files, steps) {
  const { kind, group, folder, name, windowTitle, title, desc, us1, size, min, phrases, keywords, data, menu, menuLabel, pascal, CONST, testName, date, component } = item;
  const widget = group === "widgets";
  const phrase = phrases[0] ?? windowTitle.toLowerCase();
  const componentPath = files.find((file) => file.role === "component").path;
  // A new spec numbers its RFs in reading order: Dados, Componentes, then Voz e teclado.
  let rf = 1;
  const rfData = data ? rfId(rf++) : null;
  const rfMenu = menu ? rfId(rf++) : null;
  const rfNext = rfId(rf++);
  const rfOpen = rfId(rf);

  let spec = dropComments(repo.templates.spec);
  spec = setTitle(spec, `${widget ? "Widget" : "App"}: ${name}`);
  spec = setLead(spec, desc);
  spec = setRow(spec, "ID", `\`${widget ? "widget" : "app"}/${folder}\``);
  spec = setRow(spec, "Status", "Em desenvolvimento");
  spec = setRow(spec, "Origem", `não commitado (${dayMonth(date)})`);
  spec = setRow(spec, "Window kind", `\`${kind}\` em \`src/lib/desktop.ts\` (${showSize(size)}, mínimo ${showSize(min)}, grupo \`${group}\`)`);
  spec = setRow(spec, "Voz", phrases.length ? `\`window:${kind}\` (${quoted(phrases)})` : null);
  spec = setSection(
    spec,
    "## Objetivo",
    `<O resultado para o usuário, em uma frase observável.> A janela abre pela voz ("Jarvis, abre ${phrase}"), pela busca (\`/\`) e pelo Launcher.${data ? ` Os itens ficam em \`jarvis.${kind}\`${widget ? " e continuam lá com o widget fechado" : ""}.` : ""}`,
  );
  spec = setSection(spec, "## Não-objetivos", `- Mais de uma janela "${windowTitle}" ao mesmo tempo.\n- <o que mais o item não faz de propósito>`);

  // Dados
  const values = [];
  if (data) {
    values.push(
      `- \`$itens\`: lista de **${pascal}Item** (\`{ id, text }\`), com até 50 itens de até 120 caracteres. Fica em \`jarvis.${kind}\`, gravada na hora (0 ms, é dado do usuário). Ver [persistência](../../domain/persistence.md).`,
      `  - **${rfData}**: O sistema DEVE gravar os itens em \`jarvis.${kind}\` na hora e descartar, ao ler, as entradas inválidas.`,
      `  - Se \`jarvis.${kind}\` estiver corrompido, \`parse${pascal}\` descarta as entradas ruins e os ids repetidos, e o resto fica.`,
    );
  }
  if (menu) values.push(`- \`$opções\`: \`{ details: boolean }\`, o menu de opções do widget. Fica em \`jarvis.widget.${kind}\` (250 ms).`);
  spec = setSection(spec, "## Dados", values.length ? values.join("\n") : null);

  // Telas (apps) and Componentes
  spec = setSection(spec, "## Telas", widget ? null : [`### ${windowTitle}`, "", "<O que a tela mostra, em uma frase.>", "", "- **Comportamento:** <o que a tela faz>.", `- **Layout:** contém \`${component}\`.`].join("\n"));
  const behaviour = [];
  if (data) {
    behaviour.push(
      `  - Quando o usuário digitar em "Novo item" e apertar Enter, adicione o texto ao fim de $itens com o próximo \`#id\`.`,
      "    - Se o texto estiver vazio ou só com espaços, nada é adicionado.",
      `    - Se a lista estiver cheia, mostre "A lista está cheia (50)." (\`MAX_${CONST}_ITEMS\`).`,
      `  - Quando o usuário clicar em "Apagar <texto>", remova o item.`,
      `  - Se $itens estiver vazia, mostre "Nada por aqui ainda. Digite abaixo.".`,
    );
  } else if (widget) behaviour.push(`  - Mostre "pausado" ou "ativo" conforme \`paused\` e, por enquanto, "${title} em construção.".`);
  else behaviour.push(`  - Mostre "${windowTitle}" e a descrição, por enquanto.`);
  if (menu) {
    behaviour.push(
      `  - **${rfMenu}**: O widget DEVE ligar e desligar "${menuLabel}" pelo menu do botão direito e lembrar a escolha.`,
      `    - O menu se chama "Opções do widget ${title}" e guarda a escolha em $opções.`,
    );
  }
  behaviour.push(`  - **${rfNext}**: …`);
  const layout = data
    ? `\`ReverseRow\` no topo, com "${widget ? title : windowTitle}" à esquerda e a contagem ("1 item", "3 itens") à direita${menu ? " quando \"" + menuLabel + "\" está ligada" : ""}; a lista \`#id texto\`, com o botão "Apagar" que aparece no hover; o campo "Novo item" no rodapé.`
    : widget
      ? `\`ReverseRow\` no topo, com "${title}" e o estado; no centro, o texto do esqueleto e \`KeyValue\` "spec"${menu ? ` (some quando "${menuLabel}" está desligado)` : ""}.`
      : `\`ReverseRow\` no topo, com "${windowTitle}" e "em desenvolvimento"; no centro, o título e a descrição.`;
  const style = data
    ? `\`font-mono\` ${widget ? "12 px" : "12,5 px"} do kit TUI; o \`#id\` em \`text-hud-text/45\` com números tabulares; o \`+\` do campo em \`text-hud-cyan\`, com a borda \`hud-cyan/10\` em cima; o erro em \`text-hud-alert/85\`; "Apagar" fica em \`hud-alert\` no hover.`
    : `\`font-mono\` ${widget ? "12 px" : "12,5 px"} do kit TUI; o título em \`text-hud-light\`.`;
  spec = setSection(
    spec,
    "## Componentes",
    [`### \`${component}\``, "", data ? `Mostra $itens e o campo "Novo item".` : "<O que mostra, em uma frase.>", "", "- **Comportamento:**", ...behaviour, `- **Layout:** ${layout}`, `- **Estilo:** ${style}`].join("\n"),
  );
  spec = setSection(
    spec,
    "## Casos de borda",
    [
      data
        ? `- **Vazio/nulo:** \`jarvis.${kind}\` vazio ou corrompido → \`parse${pascal}\` descarta o que não serve, e a lista mostra "Nada por aqui ainda. Digite abaixo.".`
        : "- **Vazio/nulo:** <nada salvo, valor ausente> → <o que acontece>.",
      `- **Duplicidade/idempotência:** "Jarvis, abre ${phrase}" com a janela já aberta → ela vem para a frente, e continua havendo uma só.`,
      data
        ? "- **Concorrência/corrida:** dois itens adicionados em seguida → cada um ganha o próximo `#id`, e a gravação é imediata (0 ms)."
        : "- **Concorrência/corrida:** <duas ações seguidas, eventos fora de ordem> → <o que acontece>.",
      "- **Permissões/visibilidade:** não se aplica: só UI e `localStorage`, sem rede nem arquivos.",
    ].join("\n"),
  );

  // Voz e teclado, Restrições
  const voice = [
    `- **${rfOpen}**: O sistema DEVE abrir e fechar a janela ${windowTitle} pela voz (\`window:${kind}\`), pela busca e pelo Launcher, com no máximo uma aberta.`,
    `  - "Jarvis, abre ${phrase}" ou "fecha ${phrase}": abre ou fecha a janela.`,
    `  - Na busca (\`/\`): ${keywords.slice(0, 6).join(", ")}.`,
  ];
  if (data) voice.push('- `Enter` no campo "Novo item": adiciona o item.');
  spec = setSection(spec, "## Voz e teclado", voice.join("\n"));
  spec = setSection(spec, "## Restrições", data ? `- **RNF-001**: No máximo 50 itens de até 120 caracteres (\`MAX_${CONST}_ITEMS\`, \`MAX_${CONST}_TEXT\` em \`src/lib/${kind}.ts\`).\n- **RNF-002**: …` : null);

  // Histórias de usuário
  const criteria = [[`o desktop sem a janela ${windowTitle}`, `digo "Jarvis, abre ${phrase}" ou escolho "${windowTitle}" na busca`, `a janela "${windowTitle}" abre com ${showSize(size)}.`]];
  if (data) {
    criteria.push(["a janela aberta", 'digito um item em "Novo item" e aperto Enter', `ele aparece na lista como \`#1\` e fica salvo em \`jarvis.${kind}\`.`]);
    criteria.push(["um item salvo", "recarrego", "a janela volta aberta com ele."]);
    criteria.push(["um item salvo", 'clico em "Apagar"', 'aparece "Nada por aqui ainda.".']);
  }
  if (menu) criteria.push(["o widget aberto", `clico com o botão direito e desligo "${menuLabel}"`, `essa parte some e a escolha fica em \`jarvis.widget.${kind}\`.`]);
  criteria.push(["…", "…", "…."]);
  const acceptance = setAcceptance(spec, criteria);
  spec = acceptance.md;
  spec = setRange(
    spec,
    /^### US1 /,
    /^### US2 /,
    [
      `### US1 — ${us1} (P1)`,
      "",
      "<Uma frase do ponto de vista do usuário.>",
      "",
      "**Por que P1:** <valor entregue>.",
      `**Teste independente:** \`tests/${testName}.spec.ts\` — "${windowTitle}: opens by voice and shows its content".`,
      "",
      acceptance.link,
    ].join("\n"),
  );

  // Código
  spec = setCodeSummary(
    spec,
    `${widget ? "Widget" : "App"} do grupo \`${group}\`, registrado em \`WINDOW_SPECS\`, com o conteúdo em \`${componentPath}\` no kit TUI.${data ? ` Os itens ficam em \`jarvis.${kind}\` pelo hook \`use${pascal}\`${widget ? ", criado no `App` e passado por `feeds` (vivo com a janela fechada)" : ", usado dentro do app"}.` : ""}${widget ? "" : " O app carrega sob demanda (`lazyApps.tsx`)."}`,
  );
  const layers = [`UI React (\`${component}\`)`];
  if (data) layers.push(`hook \`use${pascal}\``, `lib \`src/lib/${kind}.ts\``);
  spec = setRow(spec, "Camadas", layers.join(" · "));
  spec = setRow(spec, "Testes", `\`tests/${testName}.spec.ts\` (Playwright, projeto \`ui\`)`);
  spec = setRow(spec, "Plataforma", "Windows 11 · WebView2; no navegador funciona igual (só UI e `localStorage`)");
  const structure = files.filter((file) => !file.path.startsWith(".specs/")).map((file) => [`\`${file.path}\``, `${file.note} (novo)`]);
  structure.push(["`src/lib/desktop.ts`", "`WindowKind`, `WINDOW_KINDS`, `WINDOW_SPECS`"]);
  structure.push(["`src/lib/commands.ts`", `Palavras da busca${widget ? "" : " e subtítulo do app"}`]);
  structure.push(["`src/components/desktop/Desktop.tsx`", "`case` do `WindowContent`"]);
  if (!widget) structure.push(["`src/components/desktop/lazyApps.tsx`", "`lazyApp` e preload"]);
  if (widget && data) structure.push(["`src/App.tsx`", `\`use${pascal}()\` e \`feeds\``]);
  structure.push(["`src-tauri/src/settings.rs` · `src-tauri/voice-commands.json`", `Kind no Rust e frases \`window:${kind}\``]);
  spec = setSection(spec, "### Arquivos", table(["Arquivo", "Papel"], structure));
  spec = setSection(spec, "### Contratos", null);
  spec = setSection(
    spec,
    "### Fluxo",
    [
      "```mermaid",
      "sequenceDiagram",
      "  participant U as Usuário",
      "  participant V as Voz / busca",
      "  participant D as Desktop",
      `  participant W as ${component}`,
      `  U->>V: "Jarvis, abre ${phrase}"`,
      `  V->>D: openWindow("${kind}")`,
      "  D->>W: WindowContent",
      ...(data ? [`  W->>W: use${pascal} (jarvis.${kind})`] : []),
      "```",
    ].join("\n"),
  );
  const checks = [];
  if (data) checks.push(`- [x] P5 Persistência tolerante: \`parse${pascal}\` descarta entradas ruins, ids repetidos e corta em 50.`);
  checks.push("- [x] P6 Funciona fora do Tauri: só UI e `localStorage`.");
  checks.push(`- [x] P7 PT-BR: "${windowTitle}"${data ? ', "Novo item", "Nada por aqui ainda."' : ""} e as mensagens.`);
  checks.push("- [x] P8 Linguagem visual: `ReverseRow`" + (data ? " e a lista com `#N`" : " e `KeyValue`") + " do kit TUI.");
  if (!widget) checks.push("- [x] P9 Desktop leve: carregado só ao abrir (`lazyApps.tsx`).");
  checks.push(`- [ ] P11 Coberto por teste: \`tests/${testName}.spec.ts\`, depois de entrar no \`testMatch\`.`);
  spec = setSection(spec, "### Constituição", `Princípios de [constitution.md](../../arch/constitution.md) que se aplicam:\n\n${checks.join("\n")}`);
  spec = setSection(spec, "### Decisões relacionadas", adrLinks(repo, [4, 9, ...(data ? [10] : []), ...(widget ? [] : [12]), 14]));
  const range = criteria.length === 1 ? "critério 1" : `critérios 1 a ${criteria.length}`;
  spec = setSection(
    spec,
    "### Testes",
    [
      `- \`${playwright(testName)}\`: a janela abre pela voz e mostra o conteúdo (${range}). Só roda depois de \`${testName}\` entrar no \`testMatch\` do projeto \`ui\`.`,
      `- \`cargo test --lib default_voice_commands_are_valid\` (em \`src-tauri\`): o catálogo de voz aceita \`window:${kind}\`.`,
    ].join("\n"),
  );
  spec = setSection(
    spec,
    "### Reversão",
    [
      `- Desfaça o checklist da Fase 2 ao contrário: tire \`${kind}\` de \`WindowKind\`, \`WINDOW_KINDS\` e \`WINDOW_SPECS\`, o \`case\` do \`Desktop.tsx\`, as palavras da busca, as frases \`window:${kind}\` e o kind no Rust.`,
      "- Uma sessão do desktop salva com a janela aberta continua válida: `parseDesktop` descarta o kind desconhecido.",
      ...(data ? [`- A chave \`jarvis.${kind}\` fica órfã no \`localStorage\`, e ninguém mais a lê.`] : []),
    ].join("\n"),
  );
  spec = setSection(
    spec,
    "## Dependências",
    [
      `- **Vendor:** ${vendor("react", "React")}, ${vendor("tailwind", "Tailwind CSS")}`,
      `- **Specs:** [desktop-windows](../../features/desktop-windows/spec.md) (janela, busca e Launcher), [voice-commands](../../features/voice-commands/spec.md) (\`window:${kind}\`)`,
    ].join("\n"),
  );

  // Tarefas
  spec = setTasks(spec, files, steps, (number) => [
    `### Fase 3 — US1 ${us1} (P1)`,
    "",
    taskLines({ id: `${number()} [US1]`, title: "Conteúdo de verdade no lugar do esqueleto", accept: range, files: [componentPath], test: playwright(testName), evidence: "o teste passa" }),
    taskLines({ id: `${number()} [US1]`, title: "O aceite da spec coberto", accept: range, files: [`tests/${testName}.spec.ts`], test: playwright(testName), evidence: "um teste por critério passa" }),
    "",
    "### Fase 4 — Testes",
    "",
    taskLines({ id: number(), title: `Playwright "${windowTitle}: opens by voice and shows its content"`, accept: "critério 1", files: [`tests/${testName}.spec.ts`, "playwright.config.ts"], test: playwright(testName), evidence: "o teste passa" }),
    taskLines({ id: number(), title: `Rust \`default_voice_commands_are_valid\` com \`window:${kind}\``, accept: "Voz e teclado", files: ["src-tauri/src/settings.rs", "src-tauri/voice-commands.json"], test: "cargo test --lib default_voice_commands_are_valid", evidence: "o teste passa" }),
  ]);
  return tidyMarkdown(spec);
}

/** `| Key | value |` in a Field / Value table → the new value. */
function setField(md, key, value) {
  const row = new RegExp(`^\\| ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|.*\\|$`, "m");
  return md.replace(row, () => `| ${key} | ${value} |`);
}

/** `## Implementation Plan` from the first phase on, in English, for a Feature Specification. */
function setFeatureTasks(md, files, steps, rest) {
  const done = doneTasks(files);
  let next = done.length + 1;
  const registry = asTasks(steps, next);
  next += registry.length;
  const number = () => `T${String(next++).padStart(3, "0")}`;
  const phases = ["### Phase 1 — Skeleton (`npm run new`)", "", ...done, "", "### Phase 2 — Registration (CLI checklist)", "", ...registry, "", ...rest(number)];
  return setRange(md, /^### Phase 1/, /^## Rollback Plan/, phases.join("\n"));
}

/**
 * A feature, in the "Feature Specification" format (.specs/_templates/feature.md, ADR-0025).
 * @param {import("./repo.mjs").Repo} repo
 * @param {object} item see kinds/feature.mjs
 * @returns {string} the spec.md
 */
export function featureSpecs(repo, item, files, steps) {
  const { id, title, desc, us1, touches, phrases, camel, pascal, CONST, testName, date, storageKey } = item;
  const voice = touches.includes("voice");
  const data = touches.includes("data");
  const command = touches.includes("command");
  const tool = touches.includes("tool");
  const said = `"Jarvis, ${phrases[0] ?? "…"}"${item.needsText ? " seguido do texto" : ""}`;

  let spec = dropComments(repo.templates.feature);
  spec = setTitle(spec, `Feature Specification: ${title}`);
  spec = setField(spec, "Feature ID", `\`feature/${id}\``);
  spec = setField(spec, "Feature Status", "Em desenvolvimento");
  spec = setField(spec, "Document Status", `Criada em ${date} por \`npm run new\`; sem decisões em aberto`);
  spec = setField(spec, "Source Commit", "não commitado");
  spec = setField(spec, "Uncommitted Changes", "Tudo: feature nova");
  spec = setField(spec, "Voice Shortcut", voice ? `\`shortcut:${camel}\`` : "—");
  spec = setField(spec, "Assistant Tool", tool ? `\`${item.tool}\`` : "—");
  spec = setField(spec, "Target Platforms", command ? `Windows 11 com WebView2; no navegador (modo web), o comando usa o fake \`window.__JARVIS_${CONST}__\` em DEV` : "Windows 11 com WebView2; no navegador (modo web) funciona igual");
  spec = setField(spec, "Last Editorial Revision", date);
  spec = setField(spec, "Verification Scope", `Esqueleto gerado por \`npm run new\` em ${date}; nada conferido com o código ainda`);
  spec = setRange(
    spec,
    /^Especificação no formato/,
    /^## Overview$/,
    "Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os IDs começam em US1, RF-001, RNF-001, SC-001, AC-001 e T001. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.",
  );

  // Overview
  const path = [command ? `comando Tauri \`${item.command}\`` : null, tool ? `tool \`${item.tool}\`` : null].filter(Boolean).join(" e ") || "local";
  spec = setSection(
    spec,
    "## Overview",
    [desc, "", table(["Input", "Expected Behavior", "Execution Path"], [[voice ? said : "<o que o usuário faz>", "<o que acontece>", path]])].join("\n"),
  );

  // User Stories, Requirements, Acceptance Criteria
  const acs = [];
  if (voice) acs.push(["Trigger by Voice", "o JARVIS ouvindo", `o usuário diz ${said}`, "<resultado observável>."]);
  acs.push(["Happy Path", "<estado inicial>", "<ação>", "<resultado observável>."]);
  acs.push(["Failure Path", "<entrada inválida, sem rede ou no limite>", "<ação>", "<o que o usuário vê>."]);
  const acId = (index) => `AC-${String(index + 1).padStart(3, "0")}`;
  const acList = acs.map((_, index) => acId(index));
  spec = setSection(
    spec,
    "## User Stories",
    [
      `### US1 — ${us1}`,
      "",
      "**Priority:** P1.",
      "",
      "**User Story:** <Como usuário, quero … para …>",
      "",
      "**Why This Priority:** <valor entregue>.",
      "",
      `**Independent Test:** ${testName ? `\`tests/${testName}.spec.ts\` — "${id} helpers"` : "<o teste que cobre só esta história>"}.`,
      "",
      `**Acceptance Criteria:** ${acList.slice(0, -1).join(", ")} e ${acList.at(-1)}.`,
    ].join("\n"),
  );
  const rfs = [["RF-001", "O sistema DEVE <comportamento verificável>.", "US1"]];
  if (voice) rfs.push(["RF-002", `Quando o usuário disser ${quoted(phrases)} (\`shortcut:${camel}\`)${item.needsText ? ", seguido do texto" : ""}, o sistema DEVE <ação>.`, "US1"]);
  spec = setSection(
    spec,
    "## Requirements",
    [
      "### Functional Requirements",
      "",
      table(["ID", "Requirement", "Related Stories"], rfs),
      "",
      "### Non-Functional Requirements",
      "",
      table(["ID", "Requirement", "Scope"], [["RNF-001", "<limite, desempenho, offline, privacidade, com o número real>", "<onde vale>"]]),
      "",
      "### Operational Constraints",
      "",
      data ? `- Preferências em \`${storageKey}\`, gravadas com 250 ms de debounce.` : "- <limites do código: máximos, debounces, timeouts>",
    ].join("\n"),
  );
  spec = setSection(
    spec,
    "## Acceptance Criteria",
    acs.map(([name, given, when, then], index) => [`### ${acId(index)} — ${name}`, "", "**Related Story:** US1.", "", `- **Given** ${given}`, `- **When** ${when}`, `- **Then** ${then}`].join("\n")).join("\n\n"),
  );

  // Behavior and Flows
  const parts = [];
  const rule = [`### Regra principal${item.lib ? ` (\`${item.lib}\`)` : ""}`, "", "<O que a regra decide, em uma frase.>", ""];
  rule.push(item.lib ? `- **Behavior:** \`tidy${pascal}\` junta os espaços e apara o texto. <O resto da regra> (RF-001).` : "- **Behavior:** <regras> (RF-001).");
  parts.push(rule.join("\n"));
  if (command) parts.push([`### Comando \`${item.command}\``, "", `- **Behavior:** devolve uma \`String\` (por enquanto vazia) pelo \`blocking()\`. Fora do Tauri, \`fetch${pascal}\` usa o fake \`window.__JARVIS_${CONST}__\` em DEV.`].join("\n"));
  if (tool) parts.push([`### Tool \`${item.tool}\` do JARVIS`, "", `- **Behavior:** ${desc}`].join("\n"));
  if (voice) parts.push(["### Voice and Keyboard", "", `- \`shortcut:${camel}\` reconhece ${quoted(phrases)}${item.needsText ? ", seguido do texto" : ""} (RF-002).`].join("\n"));
  spec = setSection(spec, "## Behavior and Flows", parts.join("\n\n"));

  // Data Model and Persistence
  spec = setSection(
    spec,
    "## Data Model and Persistence",
    data
      ? [
          `### ${pascal}Prefs`,
          "",
          "```ts",
          `interface ${pascal}Prefs {`,
          "  enabled: boolean;",
          "}",
          "```",
          "",
          "### Storage Rules",
          "",
          table(
            ["Property", "Value"],
            [
              ["State", "`$preferências`"],
              ["Storage", "`localStorage`"],
              ["Key", `\`${storageKey}\``],
              ["Write Debounce", "250 ms"],
              ["Reader", `\`parse${pascal}\`: descarta o que não tiver esse formato`],
              ["Missing or Invalid Storage", `o padrão de \`${item.lib}\``],
            ],
          ),
          "",
          "Ver [persistência](../../domain/persistence.md).",
        ].join("\n")
      : null,
  );

  // Technical Design
  const structure = files.filter((file) => !file.path.startsWith(".specs/")).map((file) => [`\`${file.path}\``, `${file.note} (novo)`]);
  const touched = [...new Set(steps.filter((step) => !step.file.startsWith(".specs/") && step.file !== "playwright.config.ts").map((step) => step.file))];
  for (const file of touched) structure.push([`\`${file}\``, steps.filter((step) => step.file === file).map((step) => step.title.replace(/\s*\([^)]*\)$/, "")).join("; ")]);
  const adrs = [9, 17];
  if (voice) adrs.push(4);
  if (data) adrs.push(10);
  if (tool) adrs.push(8);
  if (command) adrs.push(11);
  spec = setSection(
    spec,
    "## Technical Design",
    ["### Component Responsibilities", "", table(["File or Component", "Responsibility"], structure), "", "### Related Architecture Decisions", "", adrLinks(repo, adrs.sort((a, b) => a - b))].join("\n"),
  );

  // Interfaces and Contracts
  const contracts = [];
  if (command) contracts.push("### Tauri Commands", "", table(["Command", "Input", "Output", "Notes"], [[`\`${item.command}\``, "—", "`String`", `fake \`window.__JARVIS_${CONST}__\` em DEV`]]), "");
  if (tool) contracts.push("### Assistant Tool", "", table(["Property", "Contract"], [["Tool Name", `\`${item.tool}\``], ["Purpose", desc], ["Input", "<campos do `inputSchema` em `src-tauri/src/mcp.rs`>"], ["Success", "<`ok: true` e o texto>"], ["Failure", "<`ok: false` e o texto>"]]), "");
  spec = setSection(spec, "## Interfaces and Contracts", contracts.length ? contracts.join("\n") : null);

  // Dependencies
  const features = [];
  if (voice) features.push(["[voice-shortcuts](../voice-shortcuts/spec.md)", "O atalho de voz e o `shortcutHandler`"]);
  if (tool) features.push(["[assistant-tools](../assistant-tools/spec.md)", "A tool no servidor MCP"]);
  const runtime = [];
  if (command) runtime.push(`- ${vendor("tauri", "Tauri")} (o comando)`);
  if (tool) runtime.push(`- ${vendor("http", "tiny_http")} (o servidor MCP)`);
  if (!runtime.length) runtime.push("- <libs de `foundation/vendor/` e recursos do sistema>");
  spec = setSection(
    spec,
    "## Dependencies",
    ["### Feature Dependencies", "", features.length ? table(["Dependency", "Purpose"], features) : table(["Dependency", "Purpose"], [["<spec>", "<por quê>"]]), "", "### Runtime Dependencies", "", ...runtime].join("\n"),
  );

  // Test Strategy and Coverage
  const acRange = `${acList[0]} a ${acList.at(-1)}`;
  const commands = [];
  if (testName) commands.push("Na raiz do repositório (o teste só roda depois de entrar no `testMatch` do projeto `ui`):", "", "```powershell", playwright(testName), "```");
  if (voice) commands.push(...(commands.length ? [""] : []), "Em `src-tauri`:", "", "```powershell", "cargo test --lib default_voice_commands_are_valid", "```");
  spec = setSection(
    spec,
    "## Test Strategy and Coverage",
    [
      "### Reported Tests",
      "",
      table(["Test Reference", "Coverage", "Acceptance Mapping"], [[testName ? `\`tests/${testName}.spec.ts\` — "${id} helpers"` : "<teste>", "<o que confere>", acRange]]),
      "",
      "### Verification Commands",
      "",
      ...(commands.length ? commands : ["<comandos>"]),
      "",
      "### Coverage Gaps",
      "",
      table(["Gap", "Evidence Status", "Suggested Verification"], [["<o que ainda não tem teste>", "<sem teste / parcial>", "<como conferir>"]]),
    ].join("\n"),
  );

  // Implementation Plan, Rollback Plan, Constitution, Known Limitations, Open Questions, References
  spec = setFeatureTasks(spec, files, steps, (number) => {
    const rest = [
      `### Phase 3 — ${us1} (US1)`,
      "",
      taskLines({ id: `${number()} [US1]`, title: "A regra principal", accept: acRange, files: item.lib ? [item.lib] : [], test: testName ? playwright(testName) : undefined, evidence: "o teste passa" }),
    ];
    if (testName) rest.push("", "### Phase 4 — Verification", "", taskLines({ id: number(), title: `Playwright "${id} helpers"`, accept: acRange, files: [`tests/${testName}.spec.ts`, "playwright.config.ts"], test: playwright(testName), evidence: "o teste passa" }));
    return rest;
  });
  spec = setSection(
    spec,
    "## Rollback Plan",
    ["1. Desfaça o checklist da Phase 2 ao contrário.", "2. Apague os arquivos novos da Phase 1.", ...(data ? [`3. A chave \`${storageKey}\` fica órfã no \`localStorage\` e é ignorada.`] : [])].join("\n"),
  );
  const principles = [["P7 — PT-BR", "Atendido", "Falas e mensagens em PT-BR"]];
  if (command) principles.unshift(["P4 — Contratos espelhados", "Pendente", `\`${item.command}\` nos dois lados e no \`ipc-contract\``]);
  if (data) principles.push(["P5 — Persistência tolerante", "Atendido", `\`parse${pascal}\` descarta o que não serve`]);
  principles.push(["P11 — Testes", "Pendente", testName ? `\`tests/${testName}.spec.ts\`, depois de entrar no \`testMatch\`` : "<o teste>"]);
  spec = setSection(spec, "## Constitution Compliance", table(["Principle", "Status", "Rationale"], principles));
  spec = setSection(spec, "## Known Limitations", "Nenhuma por enquanto.");
  spec = setSection(spec, "## Open Questions", "Nenhuma.");
  spec = setSection(spec, "## References", `- Esqueleto gerado por \`npm run new\` em ${date}.\n- Template: \`.specs/_templates/feature.md\`; modelo pronto: [reminders](../reminders/spec.md).`);
  return tidyMarkdown(spec);
}

/**
 * An ADR.
 * @param {import("./repo.mjs").Repo} repo
 * @param {{ number: string, title: string, status: string, date: string, origin: string, replaces: { number: number, file: string, title: string } | null }} item
 */
export function adrDoc(repo, item) {
  let md = setTitle(repo.templates.adr, `ADR-${item.number}: ${item.title}`);
  md = setRow(md, "Status", item.status);
  md = setRow(md, "Data", item.date);
  md = setRow(md, "Origem", item.origin);
  if (item.replaces) {
    const old = String(item.replaces.number).padStart(4, "0");
    md = setSection(md, "## Referências", `- Substitui o [ADR-${old} — ${item.replaces.title}](${item.replaces.file})\n${getSection(md, "## Referências")}`);
  }
  return tidyMarkdown(md);
}
