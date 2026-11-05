// A widget or an app: a window kind with its component, optional data, test and spec folder.
import { windowSteps } from "../lib/checklist.mjs";
import { constant, KIND_PATTERN, parseSize, pascal, searchForm, showSize, splitList } from "../lib/names.mjs";
import { fillTemplate } from "../lib/render.mjs";
import { windowSpecs } from "../lib/specs.mjs";

const DEFAULTS = {
  widgets: { size: "300x200", min: "220x120", icon: "Box" },
  apps: { size: "900x560", min: "480x300", icon: "AppWindow" },
};

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Paths a window kind would take; any that exists rules the kind out. */
function kindPaths(kind, group) {
  const name = pascal(kind);
  return group === "widgets"
    ? [`src/components/desktop/widgets/${name}Widget.tsx`, `tests/${kind}.spec.ts`]
    : [`src/components/desktop/apps/${kind}/${name}App.tsx`, `tests/${kind}.spec.ts`];
}

function sizeProblem(text, { at, max } = {}) {
  const size = parseSize(text);
  if (!size) return 'use largura x altura, como "300x200"';
  if (size.w < (at?.w ?? 120) || size.h < (at?.h ?? 80)) return `pequeno demais (mínimo ${at ? showSize(at) : "120 × 80"})`;
  if (max && (size.w > max.w || size.h > max.h)) return `o mínimo não pode passar do tamanho (${showSize(max)})`;
  return null;
}

const phrasesProblem = (text) => {
  const phrases = splitList(text);
  if (!phrases.length) return "diga ao menos uma frase";
  if (phrases.length > 30) return "no máximo 30 frases";
  const long = phrases.find((phrase) => phrase.length > 60);
  return long ? `"${long}" passa de 60 caracteres` : null;
};

/**
 * The questions. `q` asks only what no flag answered (see jarvis.mjs).
 * @param {"widgets" | "apps"} group
 */
async function collect(group, repo, q, date) {
  const widget = group === "widgets";
  const kind = await q.text("kind", {
    question: widget ? "Kind do widget (uma palavra, minúsculas)" : "Kind do app (uma palavra, minúsculas; o nome vira jv_<kind>)",
    hint: widget ? "ex.: humor" : "ex.: notes",
    positional: true,
    validate: (answer) => {
      if (!KIND_PATTERN.test(answer)) return "use uma palavra em minúsculas, de 2 a 24 letras ou números";
      if (repo.kinds.includes(answer)) return `já existe a janela "${answer}" em src/lib/desktop.ts`;
      if (repo.folders.widgets.includes(answer) || repo.folders.apps.includes(`jv_${answer}`)) return `já existe uma spec para "${answer}"`;
      const taken = kindPaths(answer, group).find((path) => repo.exists(path));
      return taken ? `já existe ${taken}` : null;
    },
  });
  const titles = Object.values(repo.specs).map((spec) => spec.title.toLowerCase());
  const title = widget
    ? await q.text("title", {
        question: "Título na janela (PT-BR)",
        initial: capital(kind),
        validate: (answer) => (!answer ? "o título não pode ficar vazio" : answer.length > 40 ? "no máximo 40 caracteres" : titles.includes(answer.toLowerCase()) ? `já existe uma janela "${answer}"` : null),
      })
    : `jv_${kind}`;
  const desc = await q.text("desc", { question: "O que faz, em uma frase", initial: `${title}: <o que faz>.` });
  const subtitle = widget ? "" : await q.text("subtitle", { question: 'Subtítulo na busca (depois de "App · ")', initial: "em desenvolvimento" });
  const sizeText = await q.text("size", { question: "Tamanho (largura x altura)", initial: DEFAULTS[group].size, validate: (answer) => sizeProblem(answer) });
  const size = parseSize(sizeText);
  const minInitial = parseSize(DEFAULTS[group].min);
  const minText = await q.text("min", {
    question: "Tamanho mínimo",
    initial: `${Math.min(size.w, minInitial.w)}x${Math.min(size.h, minInitial.h)}`,
    validate: (answer) => sizeProblem(answer, { max: size }),
  });
  const icon = await q.text("icon", {
    question: "Ícone do lucide-react (PascalCase)",
    initial: DEFAULTS[group].icon,
    hint: "lucide.dev/icons",
    validate: (answer) => {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(answer)) return 'use o nome do componente, como "CloudSun"';
      return repo.hasIcon && !repo.hasIcon(answer) ? `não achei "${answer}" em node_modules/lucide-react` : null;
    },
  });
  const phrases = splitList(await q.text("voice", { question: "Frases de voz, separadas por vírgula", initial: widget ? title.toLowerCase() : `jv ${kind}`, validate: phrasesProblem }));
  const keywordInitial = [...new Set([...phrases.map(searchForm), kind, ...(widget ? ["widget"] : [])])].join(", ");
  const keywords = splitList(await q.text("keywords", { question: "Palavras da busca (sem acento, vírgula)", initial: keywordInitial })).map(searchForm);
  const data = await q.yes("data", { question: "Guarda dados (uma lista salva no localStorage)?", initial: false });
  const name = pascal(kind);
  if (data) {
    const clash = [`src/lib/${kind}.ts`, `src/hooks/use${name}.ts`].find((path) => repo.exists(path));
    if (clash) throw new q.UsageError(`já existe ${clash}: escolha outro kind ou crie sem dados`);
  }
  const menu = widget ? await q.yes("menu", { question: "Tem menu de opções no botão direito?", initial: true }) : false;
  const us1 = await q.text("us1", { question: "Título da primeira história (US1)", initial: data ? `${title}: anotar e apagar itens` : `${title} na tela` });
  const menuLabel = data ? "Contagem" : "Detalhes";
  return {
    group,
    kind,
    folder: widget ? kind : `jv_${kind}`,
    name: title,
    windowTitle: title,
    title,
    desc,
    subtitle,
    about: widget ? title : desc,
    us1,
    size,
    min: parseSize(minText),
    icon,
    phrases,
    keywords,
    data,
    menu,
    menuLabel,
    component: `${name}${widget ? "Widget" : "App"}`,
    pascal: name,
    camel: kind,
    CONST: constant(kind),
    testName: kind,
    dataLabel: "Itens da lista (até 50)",
    date,
  };
}

function build(repo, item) {
  const widget = item.group === "widgets";
  const values = {
    kind: item.kind,
    title: item.title,
    windowTitle: item.windowTitle,
    desc: item.desc,
    pascal: item.pascal,
    camel: item.camel,
    CONST: item.CONST,
    component: item.component,
    data: item.data,
    menu: item.menu,
    app: !widget,
    menuLabel: item.menuLabel,
    menuLabelLower: item.menuLabel.toLowerCase(),
    groupLabel: widget ? "widget" : "app",
    specFolder: `${item.group}/${item.folder}`,
    specPath: `.specs/${item.group}/${item.folder}/spec.md`,
  };
  const code = [
    {
      role: "component",
      path: widget ? `src/components/desktop/widgets/${item.component}.tsx` : `src/components/desktop/apps/${item.kind}/${item.component}.tsx`,
      note: widget ? "Componente do widget com o kit TUI" : "Componente do app com o kit TUI",
      content: fillTemplate(widget ? "widget/Widget.tsx.tpl" : "app/App.tsx.tpl", values),
    },
  ];
  if (item.data) {
    code.push({ role: "lib", path: `src/lib/${item.kind}.ts`, note: "Tipos, limites e parser tolerante", content: fillTemplate("shared/lib.ts.tpl", values) });
    code.push({ role: "hook", path: `src/hooks/use${item.pascal}.ts`, note: "Hook com `useStoredState`", content: fillTemplate("shared/hook.ts.tpl", values) });
  }
  code.push({ role: "test", path: `tests/${item.kind}.spec.ts`, note: "Teste Playwright", content: fillTemplate("shared/window.spec.ts.tpl", values) });

  const steps = windowSteps(repo, item);
  const dir = `.specs/${item.group}/${item.folder}`;
  const spec = windowSpecs(repo, item, [{ path: `${dir}/spec.md`, note: "Spec (dados, componentes, aceite, código e tarefas)" }, ...code], steps);
  const files = [
    { path: `${dir}/spec.md`, note: "spec", content: spec },
    ...code,
  ];
  const summary = [
    ["tipo", widget ? "widget" : "app"],
    ["kind", item.kind],
    ["título", item.windowTitle],
    ["tamanho", `${showSize(item.size)} · mín. ${showSize(item.min)}`],
    ["ícone", item.icon],
    ["voz", `window:${item.kind} · ${item.phrases.join(", ")}`],
    ["busca", item.keywords.join(", ")],
    ["dados", item.data ? `jarvis.${item.kind}` : "não"],
  ];
  if (widget) summary.push(["menu", item.menu ? `"${item.menuLabel}" · jarvis.widget.${item.kind}` : "não"]);
  return { files, steps, summary };
}

export const widget = {
  value: "widget",
  label: "Widget",
  hint: "janela pequena do grupo widgets",
  collect: (repo, q, date) => collect("widgets", repo, q, date),
  build,
};

export const app = {
  value: "app",
  label: "App",
  hint: "janela jv_* carregada sob demanda",
  collect: (repo, q, date) => collect("apps", repo, q, date),
  build,
};
