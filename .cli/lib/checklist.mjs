// The registration checklist: what to add to which existing file, with the text to paste worked
// out from the file as it is now. The CLI never edits these files; it prints this list and
// writes it as `[ ]` tasks in the new spec.md (## Tarefas).
import { PATHS } from "./repo.mjs";
import { searchForm } from "./names.mjs";

/**
 * TSC: `tsc` fails without it · CARGO: the Rust build fails · CARGO-TEST: a Rust test fails ·
 * FUNC: nothing fails, but it does not work · DOC: specs and counts.
 * @typedef {"TSC" | "CARGO" | "CARGO-TEST" | "FUNC" | "DOC"} Tag
 * @typedef {{ where: string, code?: string[] }} Part
 * @typedef {{ tag: Tag, file: string, title: string, parts: Part[], warn?: string[] }} Step
 */

const quote = (items) => items.map((item) => JSON.stringify(item)).join(", ");

/** `|"a"|` in a regex alternation, or the whole list. */
const listItems = (text) => [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

/** Where a new kind goes in a kinds list: widgets before the first app, apps at the end. */
function insertKind(list, kind, group, specs) {
  const next = [...list];
  const firstApp = next.findIndex((item) => specs[item]?.group === "apps");
  if (group === "widgets" && firstApp >= 0) next.splice(firstApp, 0, kind);
  else next.push(kind);
  return next;
}

/** The last kind of `group` in `list` (where the new entry goes after). */
const lastOf = (list, group, specs) => [...list].reverse().find((item) => specs[item]?.group === group);

/** `"<kind>": voice window line` like the existing ones. */
export const voiceWindowLine = ({ kind, title, phrases }) =>
  `  { "id": "window:${kind}", "kind": "window", "target": "${kind}", "label": ${JSON.stringify(title)}, "phrases": [${quote(phrases)}] },`;

export const voiceShortcutLine = ({ target, title, phrases }) =>
  `  { "id": "shortcut:${target}", "kind": "shortcut", "target": "${target}", "label": ${JSON.stringify(title)}, "phrases": [${quote(phrases)}] },`;

/** Phrases another command already says (the matcher would have to pick between them). */
export function collisions(repo, phrases, ownId) {
  const found = [];
  for (const phrase of phrases) {
    const owners = (repo.phrases.get(searchForm(phrase)) ?? []).filter((id) => id !== ownId);
    if (owners.length) found.push(`"${phrase}" já é frase de ${owners.join(", ")}`);
  }
  return found;
}

/** `.specs/README.md`: the row for the new item. */
function indexStep(group, folder, about) {
  const table = { features: "Features", widgets: "Widgets", apps: "Apps" }[group];
  return {
    tag: "DOC",
    file: ".specs/README.md",
    title: `Linha na tabela ${table} do índice`,
    parts: [{ where: `no fim da tabela "${table}"`, code: [`| [${folder}](${group}/${folder}/spec.md) | ${about} | Em desenvolvimento |`] }],
  };
}

/** `playwright.config.ts`: the test's name in the `ui` project's regex. */
function testMatchStep(repo, testName) {
  const config = repo.text(PATHS.playwright);
  const line = config.split("\n").find((item) => /name: "ui", testMatch: \/\(/.test(item));
  const parts = line
    ? [{ where: "troque a linha do projeto `ui` por", code: [line.replace(/\)\\\.spec\\\.ts\//, `|${testName})\\.spec\\.ts/`)] }]
    : [{ where: `acrescente \`|${testName}\` ao regex \`testMatch\` do projeto \`ui\`` }];
  return { tag: "FUNC", file: PATHS.playwright, title: `\`tests/${testName}.spec.ts\` no \`testMatch\` do projeto \`ui\` (senão ele não roda)`, parts };
}

/**
 * A widget or an app: the window registration.
 * @param {import("./repo.mjs").Repo} repo
 * @param {{ kind: string, title: string, group: "widgets" | "apps", icon: string, size: {w:number,h:number}, min: {w:number,h:number},
 *   phrases: string[], keywords: string[], component: string, camel: string, pascal: string, data: boolean, menu: boolean,
 *   subtitle: string, folder: string, about: string, testName: string }} item
 * @returns {Step[]}
 */
export function windowSteps(repo, item) {
  const { kind, title, group, icon, size, min, phrases, keywords, component, camel, pascal, data } = item;
  const steps = [];
  const desktop = repo.text(PATHS.desktop);

  // src/lib/desktop.ts
  const lastMember = /^ {2}\| "([a-z0-9]+)";$/m.exec(desktop);
  const kinds = insertKind(repo.kinds, kind, group, repo.specs);
  const after = lastOf(repo.kinds, group, repo.specs);
  const desktopParts = [
    lastMember
      ? { where: `\`WindowKind\`: troque a última linha do union (\`| "${lastMember[1]}";\`) por`, code: [`  | "${lastMember[1]}"`, `  | "${kind}";`] }
      : { where: `\`WindowKind\`: acrescente \`| "${kind}"\` ao union` },
    { where: "`WINDOW_KINDS`: troque a linha por", code: [`export const WINDOW_KINDS: WindowKind[] = [${quote(kinds)}];`] },
    {
      where: `\`WINDOW_SPECS\`: ${after ? `depois de \`${after}:\`` : "no fim"}`,
      code: [`  ${kind}: { title: ${JSON.stringify(title)}, icon: ${icon}, size: { w: ${size.w}, h: ${size.h} }, min: { w: ${min.w}, h: ${min.h} }, group: "${group}" },`],
    },
  ];
  const importBlock = /import \{([^}]*)\} from "lucide-react";/.exec(desktop)?.[1] ?? "";
  if (!new RegExp(`\\b${icon}\\b`).test(importBlock)) desktopParts.push({ where: "no import de `lucide-react` (ordem alfabética)", code: [`  ${icon},`] });
  steps.push({ tag: "TSC", file: PATHS.desktop, title: "Kind no union, em `WINDOW_KINDS` (sem ele a janela não abre) e em `WINDOW_SPECS`", parts: desktopParts });

  // src/lib/commands.ts
  const commandParts = [{ where: "no fim de `WINDOW_KEYWORDS`", code: [`  ${kind}: [${quote(keywords)}],`] }];
  if (group === "apps") commandParts.push({ where: "no fim de `APP_SUBTITLES`", code: [`  ${kind}: ${JSON.stringify(`App · ${item.subtitle}`)},`] });
  steps.push({ tag: "TSC", file: PATHS.commands, title: "Palavras da busca", parts: commandParts });

  // src-tauri/src/settings.rs
  const rustLine = /^const WINDOW_KINDS: \[&str; (\d+)\] = \[(.*)\];$/m.exec(repo.text(PATHS.settingsRs));
  const rustKinds = rustLine ? insertKind(listItems(rustLine[2]), kind, group, repo.specs) : kinds;
  steps.push({
    tag: "CARGO",
    file: PATHS.settingsRs,
    title: "Kind no Rust (o tamanho do array muda junto)",
    parts: [{ where: "troque a linha `WINDOW_KINDS` por", code: [`const WINDOW_KINDS: [&str; ${rustKinds.length}] = [${quote(rustKinds)}];`] }],
  });

  // src-tauri/voice-commands.json
  const lastVoice = [...repo.voice].reverse().find((command) => command.kind === "window" && repo.specs[command.target]?.group === group);
  const clash = collisions(repo, phrases, `window:${kind}`);
  steps.push({
    tag: "CARGO-TEST",
    file: PATHS.voice,
    title: `Frases de voz \`window:${kind}\` (o teste \`default_voice_commands_are_valid\` exige)`,
    parts: [
      { where: lastVoice ? `depois da linha \`${lastVoice.id}\`` : "junto das entradas `window:`", code: [voiceWindowLine({ kind, title, phrases })] },
      { where: "depois, para o Vite recarregar o catálogo (ele não vê `src-tauri/`)", code: ["touch vite.config.ts"] },
    ],
    warn: clash.length ? clash : undefined,
  });

  // src/components/desktop/Desktop.tsx
  const view = repo.text(PATHS.desktopView);
  const lastCase = [...repo.kinds].reverse().find((other) => repo.specs[other]?.group === group && view.includes(`case "${other}":`));
  const viewParts = [];
  if (group === "widgets") {
    viewParts.push({ where: "junto dos imports de `./widgets/`", code: [`import { ${component} } from "./widgets/${component}";`] });
    viewParts.push({
      where: `no \`switch\` de \`WindowContent\`, ${lastCase ? `depois do \`case "${lastCase}":\`` : "com os outros widgets"}`,
      code: [`    case "${kind}":`, data ? `      return <${component} ${camel}={feeds.${camel}} />;` : `      return <${component} paused={paused} />;`],
    });
    if (data) {
      viewParts.push({ where: "junto dos `import type` dos hooks", code: [`import type { ${pascal} } from "../../hooks/use${pascal}";`] });
      viewParts.push({ where: "na `interface Feeds`", code: [`  ${camel}: ${pascal};`] });
    }
  } else {
    const lazyImport = view.split("\n").find((line) => /^import \{[^}]*\} from "\.\/lazyApps";$/.test(line));
    const names = lazyImport ? [...listNames(lazyImport), component].sort((a, b) => a.localeCompare(b)) : [component];
    viewParts.push({ where: lazyImport ? "troque o import de `./lazyApps` por" : "importe de `./lazyApps`", code: [`import { ${names.join(", ")} } from "./lazyApps";`] });
    viewParts.push({
      where: `no \`switch\` de \`WindowContent\`, ${lastCase ? `depois do \`case "${lastCase}":\`` : "no fim"}`,
      code: [`    case "${kind}":`, "      return (", "        <Suspense fallback={<Loading />}>", `          <${component} />`, "        </Suspense>", "      );"],
    });
  }
  steps.push({ tag: "FUNC", file: PATHS.desktopView, title: "Conteúdo da janela (sem o `case` ela abre vazia)", parts: viewParts });

  // src/components/desktop/lazyApps.tsx
  if (group === "apps") {
    steps.push({
      tag: "FUNC",
      file: PATHS.lazyApps,
      title: "App carregado sob demanda, com preload",
      parts: [
        { where: "junto dos outros `lazyApp`", code: [`export const ${component} = lazyApp(() => import("./apps/${kind}/${component}").then((module) => module.${component}));`] },
        { where: "no fim de `APPS`", code: [`  ${kind}: ${component},`] },
      ],
    });
  }

  // src/App.tsx: data that outlives the widget lives in App and goes down through `feeds`.
  if (group === "widgets" && data) {
    const app = repo.text(PATHS.app);
    const feedsLine = /feeds=\{\{ ([^}]*) \}\}/.exec(app);
    const anchor = /^ {2}const tasks = useTasks\(\);$/m.test(app) ? "depois de `const tasks = useTasks();`" : "junto dos outros feeds (`useWatchlist`, `useWeather`…)";
    const warn = new RegExp(`\\b(const|let|function) ${camel}\\b`).test(app) ? [`o nome \`${camel}\` já existe em App.tsx: renomeie a variável e a prop`] : undefined;
    steps.push({
      tag: "FUNC",
      file: PATHS.app,
      title: "Dados do widget vivos com a janela fechada (o JARVIS também os lê)",
      parts: [
        { where: "junto dos imports de `./hooks/`", code: [`import { use${pascal} } from "./hooks/use${pascal}";`] },
        { where: anchor, code: [`  const ${camel} = use${pascal}();`] },
        feedsLine ? { where: "troque a prop do `<Desktop>` por", code: [`feeds={{ ${feedsLine[1]}, ${camel} }}`] } : { where: `acrescente \`${camel}\` à prop \`feeds\` do \`<Desktop>\`` },
      ],
      warn,
    });
  }

  steps.push(testMatchStep(repo, item.testName));

  // Docs
  steps.push(indexStep(group, item.folder, item.about));
  const windows = repo.voice.filter((command) => command.kind === "window").length;
  steps.push({
    tag: "DOC",
    file: ".specs/domain/voice-intents.md",
    title: "Catálogo de voz",
    parts: [
      { where: `no fim da tabela de \`window\` e no título: \`window\` (${windows}) → (${windows + 1}); no topo: ${repo.voice.length} → ${repo.voice.length + 1} entradas`, code: [`| \`window:${kind}\` | ${title} | ${phrases.join(", ")} |`] },
    ],
  });
  if (data) {
    steps.push({
      tag: "DOC",
      file: ".specs/domain/persistence.md",
      title: "Chave nova no `localStorage`",
      parts: [{ where: "na tabela das chaves `jarvis.*`", code: [`| \`jarvis.${kind}\` | \`src/hooks/use${pascal}.ts\` | ${item.dataLabel} | **0** |`] }],
    });
  }
  const count = repo.kinds.length;
  steps.push({
    tag: "DOC",
    file: ".specs/domain/glossary.md",
    title: `Contagens de janelas (${count} → ${count + 1})`,
    parts: [{ where: "`WindowKind` em `glossary.md`; `0..N` em `domain/model.md`; os \"N tipos\" e `window:<kind>` (N) em `features/desktop-windows/spec.md`" }],
  });
  return steps;
}

const listNames = (importLine) =>
  /\{([^}]*)\}/
    .exec(importLine)[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * A feature: only what it touches.
 * @param {import("./repo.mjs").Repo} repo
 * @param {{ id: string, title: string, about: string, camel: string, snake: string, touches: string[], phrases: string[],
 *   needsText: boolean, command: string, tool: string, desc: string, storageKey: string, lib: string | null, testName: string | null }} item
 * @returns {Step[]}
 */
export function featureSteps(repo, item) {
  const { id, title, camel, touches } = item;
  const steps = [];

  if (touches.includes("voice")) {
    const shortcuts = repo.text(PATHS.shortcuts);
    const lastMember = /^ {2}\| "(\w+)";$/m.exec(shortcuts);
    steps.push({
      tag: "FUNC",
      file: PATHS.shortcuts,
      title: "Ação nova em `ShortcutAction` e `SHORTCUT_ACTIONS`",
      parts: [
        lastMember
          ? { where: `\`ShortcutAction\`: troque a última linha do union (\`| "${lastMember[1]}";\`) por`, code: [`  | "${lastMember[1]}"`, `  | "${camel}";`] }
          : { where: `acrescente \`| "${camel}"\` a \`ShortcutAction\`` },
        { where: "antes do `];` de `SHORTCUT_ACTIONS`", code: [`  "${camel}",`] },
      ],
    });
    const rust = repo.text(PATHS.settingsRs);
    const targets = /^pub const SHORTCUT_TARGETS: \[&str; (\d+)\] = \[$/m.exec(rust);
    steps.push({
      tag: "CARGO",
      file: PATHS.settingsRs,
      title: "Alvo do atalho no Rust (o tamanho do array muda junto)",
      parts: [
        targets ? { where: "troque o cabeçalho", code: [`pub const SHORTCUT_TARGETS: [&str; ${Number(targets[1]) + 1}] = [`] } : { where: "aumente o tamanho de `SHORTCUT_TARGETS`" },
        { where: "antes do `];` de `SHORTCUT_TARGETS`", code: [`    "${camel}",`] },
      ],
    });
    const shortcutLines = repo.text(PATHS.voice).split("\n").filter((line) => line.includes('"kind": "shortcut"'));
    const lastWithComma = [...shortcutLines].reverse().find((line) => line.trimEnd().endsWith("},"));
    const lastId = lastWithComma ? /"id": "([^"]+)"/.exec(lastWithComma)?.[1] : null;
    const clash = collisions(repo, item.phrases, `shortcut:${camel}`);
    steps.push({
      tag: "CARGO-TEST",
      file: PATHS.voice,
      title: `Frases do atalho \`shortcut:${camel}\``,
      parts: [
        { where: lastId ? `depois da linha \`${lastId}\`` : "junto das entradas `shortcut:`", code: [voiceShortcutLine({ target: camel, title, phrases: item.phrases })] },
        { where: "depois, para o Vite recarregar o catálogo", code: ["touch vite.config.ts"] },
      ],
      warn: clash.length ? clash : undefined,
    });
    if (item.needsText) {
      const needs = /^const NEEDS_TEXT: \[&str; (\d+)\] = \[(.*)\];$/m.exec(repo.text(PATHS.matcherRs));
      const list = needs ? [...listItems(needs[2]), camel] : [camel];
      steps.push({
        tag: "CARGO",
        file: PATHS.matcherRs,
        title: "O atalho só vale com texto depois da frase",
        parts: [{ where: "troque a linha `NEEDS_TEXT` por", code: [`const NEEDS_TEXT: [&str; ${list.length}] = [${quote(list)}];`] }],
      });
    }
    steps.push({
      tag: "FUNC",
      file: PATHS.app,
      title: "O que o JARVIS faz quando ouve o atalho",
      parts: [{ where: "no `switch` de `shortcutHandler.current`", code: [`      case "${camel}":`, `        return reply(said, "…");`] }],
    });
    const shortcutsCount = repo.voice.filter((command) => command.kind === "shortcut").length;
    steps.push({
      tag: "DOC",
      file: ".specs/domain/voice-intents.md",
      title: "Catálogo de voz",
      parts: [
        {
          where: `no fim da tabela de \`shortcut\` e no título: \`shortcut\` (${shortcutsCount}) → (${shortcutsCount + 1}); no topo: ${repo.voice.length} → ${repo.voice.length + 1} entradas`,
          code: [`| \`shortcut:${camel}\` | ${title} | "${item.phrases[0] ?? "…"}" | ${item.needsText ? "sim" : "não"} | [${id}](../features/${id}/spec.md) |`],
        },
      ],
    });
  }

  if (touches.includes("command")) {
    steps.push({
      tag: "FUNC",
      file: PATHS.libRs,
      title: `Comando Tauri \`${item.command}\` (o adaptador em \`${item.lib ?? "src/lib/…"}\` já o chama)`,
      parts: [
        {
          where: "junto dos outros `#[tauri::command]`",
          code: [`/// Feature ${id}: see .specs/features/${id}/spec.md.`, "#[tauri::command]", `async fn ${item.command}() -> Result<String, String> {`, "    blocking(move || Ok(String::new())).await", "}"],
        },
        { where: "em `tauri::generate_handler![`", code: [`            ${item.command},`] },
      ],
    });
    steps.push({
      tag: "DOC",
      file: ".specs/arch/ipc-contract.md",
      title: "Comando no contrato",
      parts: [{ where: "na seção do domínio (e o total em `## Comandos (N)`)", code: [`| \`${item.command}\` | — | \`String\` |`] }],
    });
  }

  if (touches.includes("tool")) {
    const mcp = repo.text(PATHS.mcpRs);
    const tools = /^const TOOLS: \[&str; (\d+)\] = \[$/m.exec(mcp);
    steps.push({
      tag: "CARGO-TEST",
      file: PATHS.mcpRs,
      title: `Ferramenta \`${item.tool}\` (o teste \`lists_every_tool_with_a_schema\` confere a ordem)`,
      parts: [
        tools ? { where: "troque o cabeçalho", code: [`const TOOLS: [&str; ${Number(tools[1]) + 1}] = [`] } : { where: "aumente o tamanho de `TOOLS`" },
        { where: "antes do `];` de `TOOLS`", code: [`    "${item.tool}",`] },
        {
          where: "no fim do `json!([` de `tools()`, antes do `])`",
          code: ["        {", `            "name": "${item.tool}",`, `            "description": ${JSON.stringify(item.desc)},`, '            "inputSchema": { "type": "object", "properties": {} },', "        },"],
        },
      ],
    });
    steps.push({
      tag: "FUNC",
      file: PATHS.assistantActions,
      title: "A UI executa a ferramenta",
      parts: [{ where: "no `switch` de `run`", code: [`        case "${item.tool}":`, `          return { ok: true, text: "…" };`] }],
    });
    steps.push({
      tag: "FUNC",
      file: PATHS.persona,
      title: "O JARVIS fica sabendo da ferramenta",
      parts: [{ where: 'em "O que você pode fazer", junto das ferramentas do servidor "jarvis"', code: [`  - ${item.tool}: ${item.desc}`] }],
    });
    steps.push({
      tag: "DOC",
      file: ".specs/arch/ipc-contract.md",
      title: "Ferramenta no contrato",
      parts: [{ where: "na tabela de `## Ferramentas MCP (N)` (e o total)", code: [`| \`${item.tool}\` | — | [${id}](../features/${id}/spec.md) |`] }],
    });
  }

  if (touches.includes("data")) {
    steps.push({
      tag: "DOC",
      file: ".specs/domain/persistence.md",
      title: "Chave nova no `localStorage`",
      parts: [{ where: "na tabela das chaves `jarvis.*`", code: [`| \`${item.storageKey}\` | \`${item.lib ?? "src/lib/…"}\` | <o que guarda> | 250 ms |`] }],
    });
  }

  if (item.testName) steps.push(testMatchStep(repo, item.testName));
  steps.push(indexStep("features", id, item.about));
  return steps;
}

/**
 * An ADR: the index and the links.
 * @param {import("./repo.mjs").Repo} repo
 * @param {{ number: string, file: string, title: string, status: string, replaces: { number: number, file: string } | null }} item
 * @returns {Step[]}
 */
export function adrSteps(repo, item) {
  const steps = [
    {
      tag: "DOC",
      file: ".specs/arch/adr/README.md",
      title: "Linha no índice dos ADRs",
      parts: [{ where: "no fim da tabela", code: [`| [${item.number}](${item.file}) | ${item.title} | ${item.status} |`] }],
    },
    {
      tag: "DOC",
      file: ".specs/README.md",
      title: "Contagem dos ADRs",
      parts: [{ where: `"as ${repo.adrs.length} decisões" → ${repo.adrs.length + 1}, e "ADR-0001 … ADR-${String(repo.adrs.at(-1)?.number ?? 0).padStart(4, "0")}" → ADR-${item.number}` }],
    },
    {
      tag: "DOC",
      file: ".specs/<grupo>/<pasta>/spec.md",
      title: "Specs afetadas citam o ADR",
      parts: [{ where: 'em "Entregáveis › Decisões relacionadas" de cada spec afetada', code: [`- [ADR-${item.number} — ${item.title}](../../arch/adr/${item.file})`] }],
    },
  ];
  if (item.replaces) {
    const old = String(item.replaces.number).padStart(4, "0");
    steps.push({
      tag: "DOC",
      file: `${PATHS.adr}/${item.replaces.file}`,
      title: `ADR-${old} passa a ser substituído`,
      parts: [
        { where: "troque a linha Status por", code: [`| **Status** | Substituído por [ADR-${item.number}](${item.file}) |`] },
        { where: `e, no índice, o status do ${old}`, code: [`Substituído por ADR-${item.number}`] },
      ],
    });
  }
  return steps;
}

/** The steps as `- [ ] T0nn …` lines for the spec's tasks, numbered from `first`. */
export function asTasks(steps, first) {
  // The spec-coding.dev Tasks Plan shape: the task, then the files it may touch.
  return steps.map((step, index) => `- [ ] T${String(first + index).padStart(3, "0")} ${step.title.replace(/\s*\([^)]*\)$/, "")}\n  - Arquivos permitidos: \`${step.file}\``);
}
