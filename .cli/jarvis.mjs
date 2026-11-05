#!/usr/bin/env node
// jvOS module forge: `npm run new` asks what to build (widget, app, feature, ADR), writes the spec
// folder from .specs/_templates and the code skeletons, and prints the registration checklist.
// It never edits a file that exists: what goes into desktop.ts, the voice catalogue, Rust and
// the docs is printed with the text to paste, and written as tasks in the new spec.md.
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { adr } from "./kinds/adr.mjs";
import { feature } from "./kinds/feature.mjs";
import { app, widget } from "./kinds/window.mjs";
import { bold, dim, paint, setColor, width } from "./lib/ansi.mjs";
import { banner, box, greeting, heading, post, typeLines } from "./lib/banner.mjs";
import { tree, taken, writeAll } from "./lib/files.mjs";
import { splitList, today } from "./lib/names.mjs";
import { ask, Cancelled, choose, chooseMany, confirm, interactive, problemLine } from "./lib/prompt.mjs";
import { readRepo, RepoError } from "./lib/repo.mjs";

const TYPES = [widget, feature, app, adr];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A flag or an answer that cannot be used: the message says which and why. */
export class UsageError extends Error {}

const HELP = `
  npm run new                                  assistente: pergunta tudo
  npm run new -- <tipo> [id] [--flags]         tipo: widget · app · feature · adr

  Widget e app
    --title "Humor"        título na janela (app: sempre jv_<kind>)
    --desc "…"             o que faz, em uma frase
    --size 300x200         tamanho; --min 220x120 o mínimo
    --icon Smile           ícone do lucide-react
    --voice "a, b"         frases de voz (window:<kind>)
    --keywords "a, b"      palavras da busca
    --data / --no-data     guarda uma lista no localStorage
    --menu / --no-menu     menu de opções no botão direito (só widget)
    --subtitle "…"         subtítulo na busca (só app)
    --us1 "…"              título da primeira história

  Feature
    --touches voice,data,command,tool
    --voice "a, b"  --text       frases do atalho; --text: precisa de texto depois
    --command nome_verbo         comando Tauri
    --tool nome                  ferramenta MCP
    --lib / --no-lib             módulo em src/lib com teste

  ADR
    --title "…"  --origin "…"  --status Proposto|Aceito  --replaces 15

  Gerais
    --yes          aceita os padrões e grava sem perguntar
    --dry-run      mostra o que faria, sem gravar
    --no-anim      sem a animação do boot      --no-color   sem cores
    --date AAAA-MM-DD   --root <pasta do repo>   --help
`;

/** Flags that never take a value (the next word stays a positional). */
const SWITCHES = new Set(["yes", "dry-run", "anim", "color", "help", "data", "menu", "text", "lib"]);

/** `--key value`, `--key=value`, `--flag`, `--no-flag`; the rest are positionals. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[key] = inline;
    else if (key.startsWith("no-")) flags[key.slice(3)] = false;
    else if (!SWITCHES.has(key) && argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) flags[key] = argv[++index];
    else flags[key] = true;
  }
  return { flags, positional };
}

/** `code` in markdown → highlighted, without the backticks. */
const inline = (text) => text.replace(/`([^`]+)`/g, (_, code) => paint("light", code));

/**
 * Answers from the flags, else from the user (on a terminal), else the defaults.
 * @returns the `q` object the kinds ask with
 */
function asker({ flags, positional, canAsk, io, out }) {
  const fromFlag = (key, spec) => {
    if (spec.positional && positional.length) return positional.shift();
    const value = flags[key];
    return value === undefined || typeof value === "boolean" ? undefined : String(value);
  };
  const echo = (question, value) => {
    if (canAsk) out(`  ${paint("holo", "▸")} ${paint("light", question)}  ${paint("cyan", "❯")} ${value}`);
  };
  return {
    UsageError,
    async text(key, spec) {
      const given = fromFlag(key, spec);
      if (given !== undefined) {
        const problem = spec.validate?.(given.trim());
        if (problem) throw new UsageError(`--${key}: ${problem}`);
        echo(spec.question, given.trim());
        return given.trim();
      }
      if (!canAsk) {
        if (spec.initial === undefined || spec.initial === "") throw new UsageError(`falta ${spec.positional ? "o id" : `--${key}`} (${spec.question})`);
        const problem = spec.validate?.(spec.initial);
        if (problem) throw new UsageError(`${spec.question}: ${problem}`);
        return spec.initial;
      }
      return ask(spec, io);
    },
    async yes(key, spec) {
      if (typeof flags[key] === "boolean") {
        echo(spec.question, flags[key] ? "sim" : "não");
        return flags[key];
      }
      if (typeof flags[key] === "string") return /^(s|sim|y|yes|true|1)$/i.test(flags[key]);
      return canAsk ? confirm(spec, io) : spec.initial;
    },
    async one(key, spec) {
      const given = fromFlag(key, spec);
      if (given !== undefined) {
        const value = spec.normalize ? spec.normalize(given) : given;
        const option = spec.options.find((item) => item.value.toLowerCase() === value.toLowerCase());
        if (!option) throw new UsageError(`--${key}: use ${spec.options.map((item) => item.value || '""').join(", ")}`);
        echo(spec.question, option.label);
        return option.value;
      }
      return canAsk ? choose(spec, io) : spec.options[spec.initial ?? 0].value;
    },
    async many(key, spec) {
      const given = fromFlag(key, spec);
      if (given !== undefined) {
        const list = splitList(given);
        const problem = spec.validate?.(list);
        if (problem) throw new UsageError(`--${key}: ${problem}`);
        echo(spec.question, list.join(", ") || "nenhum");
        return list;
      }
      return canAsk ? chooseMany(spec, io) : spec.options.filter((item) => item.checked).map((item) => item.value);
    },
  };
}

const TAG_TONE = { TSC: "alert", CARGO: "alert", "CARGO-TEST": "amber", FUNC: "amber", DOC: "line" };

/** The checklist, numbered, with the text to paste in a dim gutter. */
function checklistLines(steps, withTasks) {
  const intro = `O CLI não edita arquivos existentes. Cole estes trechos${withTasks ? " (estão também na seção Tarefas da spec)" : ""}.`;
  const lines = [heading("CHECKLIST DE REGISTRO"), `  ${dim(intro)}`, ""];
  const legend = [
    `${paint("alert", "TSC")}/${paint("alert", "CARGO")} quebra o build`,
    `${paint("amber", "CARGO-TEST")} quebra um teste`,
    `${paint("amber", "FUNC")} compila, mas não funciona`,
    `${paint("line", "DOC")} specs e contagens`,
  ];
  lines.push(`  ${legend.join(dim(" · "))}`, "");
  steps.forEach((step, index) => {
    const number = paint("holo", String(index + 1).padStart(2, "0"));
    lines.push(`  ${number} ${paint(TAG_TONE[step.tag], `[${step.tag}]`)} ${bold(paint("glow", step.file))}`);
    lines.push(`     ${inline(paint("text", step.title))}`);
    for (const part of step.parts) {
      lines.push(`     ${paint("cyan", "›")} ${inline(paint("text", part.where))}`);
      for (const code of part.code ?? []) lines.push(`       ${paint("line", "┆")} ${dim(code)}`);
    }
    for (const warn of step.warn ?? []) lines.push(`     ${post("warn", inline(warn)).trim()}`);
    lines.push("");
  });
  return lines;
}

/**
 * Runs the forge. Returns the exit code (0 done, 1 error, 130 cancelled).
 * @param {string[]} argv
 * @param {{ io?: import("./lib/prompt.mjs").Io, now?: Date }} [options]
 */
export async function main(argv, { io = { input: process.stdin, output: process.stdout }, now = new Date() } = {}) {
  const { flags, positional } = parseArgs(argv);
  if (flags.color === false) setColor(false);
  const out = (line = "") => io.output.write(`${line}\n`);
  const tty = interactive(io);
  const canAsk = tty && flags.yes !== true;
  const anim = tty && flags.anim !== false;

  if (flags.help) {
    await typeLines(banner(readVersion()), { out: io.output });
    out(paint("text", HELP));
    return 0;
  }

  let repo;
  try {
    repo = readRepo(resolve(typeof flags.root === "string" ? flags.root : REPO_ROOT));
  } catch (error) {
    out(problemLine(error instanceof RepoError ? error.message : String(error)));
    return 1;
  }

  await typeLines(banner(repo.version), { anim, out: io.output });
  const boot = [
    post("ok", "templates carregados (.specs/_templates)"),
    post("ok", `${repo.folders.features.length} features · ${repo.folders.widgets.length} widgets · ${repo.folders.apps.length} apps · ${repo.adrs.length} ADRs`),
    post("ok", `${repo.kinds.length} janelas em src/lib/desktop.ts · ${repo.voice.length} comandos de voz`),
    repo.git ? post("ok", `base ${repo.git.hash} (${repo.git.date})`) : post("warn", "fora de um repositório git"),
  ];
  if (!repo.hasIcon) boot.push(post("warn", "lucide-react não instalado: o ícone não é conferido"));
  await typeLines(boot, { anim, delay: 70, out: io.output });
  out("");
  out(`  ${paint("glow", greeting(now))}`);
  out("");

  const date = typeof flags.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(flags.date) ? flags.date : today(now);
  const q = asker({ flags, positional, canAsk, io, out });
  try {
    let kind = positional.length ? TYPES.find((type) => type.value === positional[0].toLowerCase()) : null;
    if (positional.length && !kind) throw new UsageError(`tipo "${positional[0]}" não existe: use ${TYPES.map((type) => type.value).join(", ")}`);
    if (kind) {
      positional.shift();
      if (canAsk) out(`  ${paint("holo", "▸")} ${paint("light", "O que vamos construir, senhor?")}  ${paint("cyan", "❯")} ${kind.label}`);
    } else if (canAsk) {
      const value = await choose({ question: "O que vamos construir, senhor?", options: TYPES }, io);
      kind = TYPES.find((type) => type.value === value);
    } else {
      throw new UsageError("diga o tipo: npm run new -- <widget|app|feature|adr> …");
    }

    const item = await kind.collect(repo, q, date);
    const { files, steps, summary } = kind.build(repo, item);
    const clash = taken(repo.root, files);
    if (clash.length) throw new UsageError(`já existe: ${clash.join(", ")}`);

    const label = Math.max(...summary.map(([key]) => width(key)));
    const lines = summary.map(([key, value]) => `${paint("cyan", key.padEnd(label))}  ${paint("text", value)}`);
    lines.push("", paint("light", "arquivos novos"), ...tree(files.map((file) => file.path)).map((line) => paint("text", line)));
    out("");
    for (const line of box("resumo", lines)) out(line);
    out("");

    if (flags["dry-run"]) {
      out(post("skip", "simulação (--dry-run): nada foi gravado"));
    } else {
      if (!flags.yes && !tty) throw new UsageError("sem terminal para confirmar: use --yes para gravar ou --dry-run para ver");
      if (canAsk && !(await confirm({ question: "Forjar?", initial: true }, io))) {
        out(post("skip", "Tudo bem. Nada foi gravado."));
        return 0;
      }
      out(heading("FORJANDO"));
      writeAll(repo.root, files, (file) => out(post("ok", file.path)));
    }

    const dry = Boolean(flags["dry-run"]);
    const tasks = files.find((file) => file.path.startsWith(".specs/") && file.path.endsWith("/spec.md"));
    for (const line of checklistLines(steps, Boolean(tasks))) out(line);
    const phase = tasks?.path.startsWith(".specs/features/") ? "(Implementation Plan, Phase 2)." : "(Tarefas, Fase 2).";
    if (tasks) out(`  ${dim(dry ? "As mesmas tarefas iriam para" : "As mesmas tarefas estão em")} ${paint("light", tasks.path)} ${dim(phase)}`);
    const test = files.find((file) => file.role === "test");
    if (test) out(`  ${dim("Depois de colar:")} ${paint("light", `npx tsc · npx playwright test ${test.path} · cargo test (src-tauri)`)}`);
    out("");
    const closing = dry ? "Simulação concluída, senhor. Nada foi gravado." : kind === adr ? "Decisão registrada. O índice fica com o senhor." : "Módulo forjado. O registro fica com o senhor.";
    out(`  ${paint("holo", "▸")} ${paint("glow", closing)}`);
    out("");
    return 0;
  } catch (error) {
    if (error instanceof Cancelled) {
      out("");
      out(post("skip", "Cancelado. Nada foi gravado."));
      return 130;
    }
    if (error instanceof UsageError || error instanceof RepoError) {
      out(problemLine(error.message));
      if (!tty) out(dim("  npm run new -- --help mostra as flags."));
      return 1;
    }
    throw error;
  }
}

function readVersion() {
  try {
    return readRepo(REPO_ROOT).version;
  } catch {
    return "0.0.0";
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stdout.write("\x1b[?25h");
      console.error(error);
      process.exitCode = 1;
    },
  );
}
