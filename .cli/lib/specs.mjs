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

/** `- [x] T001 …` lines for the files the CLI wrote. */
const doneTasks = (files) => files.map((file, index) => `- [x] T${String(index + 1).padStart(3, "0")}${index ? " [P]" : ""} ${file.note} — \`${file.path}\``);

/** The paragraph between `## Código` and its table. */
const setCodeSummary = (md, text) => setRange(md, /^## Código$/, /^\| \| \|$/, `## Código\n\n${text}`);

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
  spec = setTitle(spec, name);
  spec = setLead(spec, desc);
  spec = setRow(spec, "ID", `\`${widget ? "widget" : "app"}/${folder}\``);
  spec = setRow(spec, "Status", "Em desenvolvimento");
  spec = setRow(spec, "Origem", `não commitado (${dayMonth(date)})`);
  spec = setRow(spec, "Window kind", `\`${kind}\` em \`src/lib/desktop.ts\` (${showSize(size)}, mínimo ${showSize(min)}, grupo \`${group}\`)`);
  spec = setRow(spec, "Voz", phrases.length ? `\`window:${kind}\` (${quoted(phrases)})` : null);
  spec = setSection(
    spec,
    "## Visão geral",
    `<Para quem é e por que existe.> A janela abre pela voz ("Jarvis, abre ${phrase}"), pela busca (\`/\`) e pelo Launcher.${data ? ` Os itens ficam em \`jarvis.${kind}\`${widget ? " e continuam lá com o widget fechado" : ""}.` : ""}`,
  );

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
  spec = setSection(spec, "## Casos de borda", null);

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
  const accept = [
    `1. **Dado** o desktop sem a janela ${windowTitle}, **quando** digo "Jarvis, abre ${phrase}" ou escolho "${windowTitle}" na busca, **então** a janela "${windowTitle}" abre com ${showSize(size)}.`,
  ];
  if (data) {
    accept.push(`${accept.length + 1}. **Dado** a janela aberta, **quando** digito um item em "Novo item" e aperto Enter, **então** ele aparece na lista como \`#1\` e fica salvo em \`jarvis.${kind}\`.`);
    accept.push(`${accept.length + 1}. **Dado** um item salvo, **quando** recarrego, **então** a janela volta aberta com ele; **quando** clico em "Apagar", **então** aparece "Nada por aqui ainda.".`);
  }
  if (menu) accept.push(`${accept.length + 1}. **Dado** o widget aberto, **quando** clico com o botão direito e desligo "${menuLabel}", **então** essa parte some e a escolha fica em \`jarvis.widget.${kind}\`.`);
  accept.push(`${accept.length + 1}. **Dado** …, **quando** …, **então** ….`);
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
      "**Aceite**",
      "",
      ...accept,
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
  spec = setRow(spec, "Dependências", "nenhuma nova");
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

  // Tarefas
  spec = setTasks(spec, files, steps, (number) => [
    `### Fase 3 — US1 ${us1} (P1)`,
    "",
    `- [ ] ${number()} [US1] Conteúdo de verdade no lugar do esqueleto — \`${componentPath}\``,
    `- [ ] ${number()} [US1] O aceite da spec coberto — \`tests/${testName}.spec.ts\``,
    "",
    "### Fase 4 — Testes",
    "",
    `- [ ] ${number()} Playwright \`tests/${testName}.spec.ts\` — "${windowTitle}: opens by voice and shows its content"`,
    `- [ ] ${number()} Rust \`src-tauri/src/settings.rs\` — \`default_voice_commands_are_valid\` com \`window:${kind}\``,
  ]);
  return tidyMarkdown(spec);
}

/**
 * A feature.
 * @param {import("./repo.mjs").Repo} repo
 * @param {object} item see kinds/feature.mjs
 * @returns {string} the spec.md
 */
export function featureSpecs(repo, item, files, steps) {
  const { id, title, desc, us1, touches, phrases, camel, pascal, CONST, testName, date, storageKey } = item;
  const voice = touches.includes("voice");

  let spec = dropComments(repo.templates.spec);
  spec = setTitle(spec, title);
  spec = setLead(spec, desc);
  spec = setRow(spec, "ID", `\`feature/${id}\``);
  spec = setRow(spec, "Status", "Em desenvolvimento");
  spec = setRow(spec, "Origem", `não commitado (${dayMonth(date)})`);
  spec = setRow(spec, "Window kind", null);
  spec = setRow(spec, "Voz", voice ? `\`shortcut:${camel}\` (${quoted(phrases)})` : null);

  spec = setSection(
    spec,
    "## Dados",
    touches.includes("data")
      ? `- \`$preferências\`: \`${pascal}Prefs\` (\`{ enabled }\`). Fica em \`${storageKey}\` (250 ms); \`parse${pascal}\` descarta o que não tiver esse formato. Ver [persistência](../../domain/persistence.md).`
      : null,
  );
  spec = setSection(spec, "## Telas", null);
  const parts = [];
  const rule = [`### Regra principal${item.lib ? ` (\`${item.lib}\`)` : ""}`, "", "<O que a regra decide, em uma frase.>", "", "- **Comportamento:**"];
  if (item.lib) rule.push(`  - \`tidy${pascal}\` junta os espaços e apara o texto.`);
  rule.push("  - **RF-001**: O sistema DEVE <comportamento verificável>.");
  parts.push(rule.join("\n"));
  if (touches.includes("command")) {
    parts.push(
      [`### Comando \`${item.command}\``, "", "- **Comportamento:**", "  - Devolve uma `String` (por enquanto vazia) pelo `blocking()`.", `  - Fora do Tauri, \`fetch${pascal}\` usa o fake \`window.__JARVIS_${CONST}__\` em DEV.`].join("\n"),
    );
  }
  if (touches.includes("tool")) parts.push([`### Tool \`${item.tool}\` do JARVIS`, "", "- **Comportamento:**", `  - ${desc}`].join("\n"));
  spec = setSection(spec, "## Componentes", `Uma seção \`###\` por parte do comportamento.\n\n${parts.join("\n\n")}`);
  spec = setSection(spec, "## Voz e teclado", voice ? `- Quando o usuário disser ${quoted(phrases)} (\`shortcut:${camel}\`)${item.needsText ? ", seguido do texto" : ""}, <ação>.` : null);

  const accept = [];
  if (voice) accept.push(`1. **Dado** o JARVIS ouvindo, **quando** digo "Jarvis, ${phrases[0] ?? "…"}"${item.needsText ? " seguido do texto" : ""}, **então** <resultado observável>.`);
  accept.push(`${accept.length + 1}. **Dado** <estado inicial>, **quando** <ação>, **então** <resultado observável>.`);
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
      `**Teste independente:** ${testName ? `\`tests/${testName}.spec.ts\` — "${id} helpers"` : "<como verificar só esta história>"}.`,
      "",
      "**Aceite**",
      "",
      ...accept,
    ].join("\n"),
  );

  const layers = [];
  if (item.lib) layers.push(`lib \`${item.lib}\``);
  if (touches.includes("command")) layers.push(`comando Tauri \`${item.command}\``);
  if (touches.includes("tool")) layers.push(`tool MCP \`${item.tool}\``);
  if (voice) layers.push(`atalho \`shortcut:${camel}\``);
  spec = setRow(spec, "Camadas", layers.length ? layers.join(" · ") : "<UI React · hook · lib · comando Tauri · módulo Rust>");
  spec = setRow(spec, "Testes", testName ? `\`tests/${testName}.spec.ts\` (Playwright, projeto \`ui\`)` : "<`tests/<x>.spec.ts`, testes Rust `mod tests`>");
  const structure = files.filter((file) => !file.path.startsWith(".specs/")).map((file) => [`\`${file.path}\``, `${file.note} (novo)`]);
  const touched = [...new Set(steps.filter((step) => !step.file.startsWith(".specs/") && step.file !== "playwright.config.ts").map((step) => step.file))];
  for (const file of touched) structure.push([`\`${file}\``, steps.filter((step) => step.file === file).map((step) => step.title.replace(/\s*\([^)]*\)$/, "")).join("; ")]);
  if (structure.length) spec = setSection(spec, "### Arquivos", table(["Arquivo", "Papel"], structure));
  const contracts = [];
  if (touches.includes("command")) contracts.push("#### Comandos Tauri", "", table(["Comando", "Entrada", "Saída", "Notas"], [[`\`${item.command}\``, "—", "`String`", `fake \`window.__JARVIS_${CONST}__\` em DEV`]]), "");
  if (touches.includes("tool")) contracts.push("#### Ferramentas MCP (JARVIS)", "", table(["Tool", "O que faz"], [[`\`${item.tool}\``, item.desc]]), "");
  spec = setSection(spec, "### Contratos", contracts.length ? contracts.join("\n") : null);
  const adrs = [9, 17];
  if (voice) adrs.push(4);
  if (touches.includes("data")) adrs.push(10);
  if (touches.includes("tool")) adrs.push(8);
  if (touches.includes("command")) adrs.push(11);
  spec = setSection(spec, "### Decisões relacionadas", adrLinks(repo, adrs.sort((a, b) => a - b)));

  spec = setTasks(spec, files, steps, (number) => {
    const rest = [`### Fase 3 — US1 ${us1} (P1)`, "", `- [ ] ${number()} [US1] A regra principal${item.lib ? ` — \`${item.lib}\`` : ""}`];
    if (testName) rest.push("", "### Fase 4 — Testes", "", `- [ ] ${number()} Playwright \`tests/${testName}.spec.ts\` — "${id} helpers"`);
    return rest;
  });
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
