// The forge's own checks (node:test): names, the template filler, the markdown edits, the prompts
// with a fake terminal, and whole runs against a copy of the repo files it reads, which must come
// out untouched.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { main, parseArgs } from "../jarvis.mjs";
import { setColor } from "../lib/ansi.mjs";
import { asciiWord, box } from "../lib/banner.mjs";
import { tree } from "../lib/files.mjs";
import { adrSlug, camel, constant, iconFile, kebab, parseSize, pascal, searchForm, splitList, stripAccents } from "../lib/names.mjs";
import { Cancelled, choose, chooseMany } from "../lib/prompt.mjs";
import { fill, fillTemplate, getSection, setRange, setRow, setSection } from "../lib/render.mjs";

setColor(false);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("names", () => {
  test("ids, identifiers and search words", () => {
    assert.equal(stripAccents("Ações e previsão"), "Acoes e previsao");
    assert.equal(kebab("Frase do Dia"), "frase-do-dia");
    assert.equal(camel("daily-quote"), "dailyQuote");
    assert.equal(pascal("daily-quote"), "DailyQuote");
    assert.equal(constant("daily-quote"), "DAILY_QUOTE");
    assert.equal(searchForm("  Previsão   do Tempo "), "previsao do tempo");
    assert.deepEqual(splitList("a, b ,, a , c"), ["a", "b", "c"]);
  });

  test("lucide file names, sizes and ADR slugs", () => {
    assert.equal(iconFile("CloudSun"), "cloud-sun");
    assert.equal(iconFile("Disc3"), "disc-3");
    assert.equal(iconFile("AppWindow"), "app-window");
    assert.deepEqual(parseSize("300x200"), { w: 300, h: 200 });
    assert.deepEqual(parseSize(" 300 × 200 "), { w: 300, h: 200 });
    assert.equal(parseSize("300"), null);
    assert.equal(adrSlug("Cache das cotações no Rust por 60 segundos"), "cache-cotacoes-rust-60-segundos");
  });
});

describe("template filler", () => {
  test("values, blocks on their own lines, inverted and inline blocks", () => {
    const text = "a %%x%%\n%%#on%%\nyes\n%%^off%%\n  nested\n%%/off%%\n%%/on%%\n%%^on%%\nno\n%%/on%%\n<div %%#on%%id=\"1\" %%/on%%/>\n";
    assert.equal(fill(text, { x: "1", on: true, off: false }), 'a 1\nyes\n  nested\n<div id="1" />\n');
    assert.equal(fill(text, { x: "1", on: false, off: false }), "a 1\nno\n<div />\n");
  });

  test("a typo is an error, not a broken file", () => {
    assert.throws(() => fill("%%nope%%", {}), /desconhecido "nope"/);
    assert.throws(() => fill("%%#flag%%\nx\n", { flag: true }), /sem fechamento/);
  });

  test("every code template fills cleanly with every combination", () => {
    const base = { kind: "demo", title: "Demo", windowTitle: "Demo", desc: "Uma descrição.", pascal: "Demo", camel: "demo", CONST: "DEMO", component: "DemoWidget", menuLabel: "Detalhes", menuLabelLower: "detalhes", groupLabel: "widget", specFolder: "widgets/demo", specPath: ".specs/widgets/demo/spec.md", id: "demo", storageKey: "jarvis.demo" };
    for (const data of [true, false])
      for (const menu of [true, false])
        for (const app of [true, false]) {
          for (const name of ["widget/Widget.tsx.tpl", "app/App.tsx.tpl", "shared/lib.ts.tpl", "shared/hook.ts.tpl", "shared/window.spec.ts.tpl"]) {
            const out = fillTemplate(name, { ...base, data, menu, app });
            assert.ok(!out.includes("%%"), `${name} left a tag`);
            assert.ok(!/\n\n\n/.test(out), `${name} left a double blank line (data=${data}, menu=${menu})`);
          }
          for (const name of ["feature/lib.ts.tpl", "feature/test.spec.ts.tpl"]) {
            const out = fillTemplate(name, { ...base, data, command: menu ? "demo_get" : "" });
            assert.ok(!out.includes("%%"), `${name} left a tag`);
          }
        }
  });
});

describe("markdown edits", () => {
  const md = "# T\n\n| | |\n|---|---|\n| **ID** | x |\n| **Voz** | y |\n\n## A\n\nold\n\n### A1\n\nsub\n\n## B\n\nb\n";
  test("rows are replaced or removed by key", () => {
    assert.match(setRow(md, "ID", "`widget/demo`"), /\| \*\*ID\*\* \| `widget\/demo` \|/);
    assert.doesNotMatch(setRow(md, "Voz", null), /Voz/);
    assert.equal(setRow(md, "Nada", "x"), md);
  });
  test("sections are replaced up to the next heading of their level, or added", () => {
    const out = setSection(md, "## A", "new");
    assert.match(out, /## A\n\nnew\n\n## B/);
    assert.doesNotMatch(out, /A1/);
    assert.match(setSection(md, "### A1", "x"), /### A1\n\nx\n\n## B/);
    assert.match(setSection(md, "## C", "c"), /## B\n\nb\n\n## C\n\nc\n$/);
    assert.equal(getSection(md, "## B"), "b");
  });
  test("ranges are replaced between two headings", () => {
    assert.match(setRange(md, /^## A/, /^## B/, "## Z\n\nz"), /## Z\n\nz\n\n## B/);
  });
});

describe("terminal look", () => {
  test("the banner spells JARVIS like the boot screen", () => {
    const rows = asciiWord("JARVIS");
    assert.equal(rows.length, 6);
    assert.equal(rows[0], "     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗");
  });
  test("boxes fit their widest line; trees fold single folders", () => {
    const lines = box("resumo", ["curto", "uma linha mais comprida"]);
    assert.equal(new Set(lines.map((line) => [...line].length)).size, 1);
    assert.deepEqual(tree(["src/lib/a.ts", "src/lib/b.ts", "tests/a.spec.ts"]), ["├─ src/lib/", "│  ├─ a.ts", "│  └─ b.ts", "└─ tests/", "   └─ a.spec.ts"]);
  });
});

/** A fake terminal: keys go in, the drawing is collected. */
function fakeTerminal() {
  const input = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: (on) => ((input.isRaw = on), input) });
  const chunks = [];
  const output = { isTTY: true, write: (text) => (chunks.push(String(text)), true) };
  return { io: { input, output }, chunks, press: (keys) => setImmediate(() => input.write(keys)) };
}

describe("prompts", () => {
  test("arrow down and Enter pick the second option", async () => {
    const term = fakeTerminal();
    term.press("\x1b[B\r");
    const picked = await choose({ question: "Tipo", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, term.io);
    assert.equal(picked, "b");
    assert.ok(term.chunks.join("").includes("❯ B"));
  });
  test("space ticks, Enter confirms several", async () => {
    const term = fakeTerminal();
    term.press(" \x1b[B\x1b[B \r");
    const picked = await chooseMany({ question: "Toca", options: ["a", "b", "c"].map((value) => ({ value, label: value })) }, term.io);
    assert.deepEqual(picked, ["a", "c"]);
  });
  test("Ctrl+C cancels", async () => {
    const term = fakeTerminal();
    term.press("\x03");
    await assert.rejects(choose({ question: "Tipo", options: [{ value: "a", label: "A" }] }, term.io), Cancelled);
  });
});

test("flags: values, switches, negatives and positionals", () => {
  assert.deepEqual(parseArgs(["widget", "humor", "--title", "Humor", "--data", "extra", "--no-menu", "--size=300x200"]), {
    flags: { title: "Humor", data: true, menu: false, size: "300x200" },
    positional: ["widget", "humor", "extra"],
  });
});

// --- whole runs on a copy of what the forge reads ---

const READS = [
  ".specs/_templates",
  ".specs/arch/adr",
  "src/lib/desktop.ts",
  "src/lib/commands.ts",
  "src/lib/shortcuts.ts",
  "src/components/desktop/Desktop.tsx",
  "src/components/desktop/lazyApps.tsx",
  "src/App.tsx",
  "src/hooks/useAssistantActions.ts",
  "src-tauri/src/settings.rs",
  "src-tauri/src/voice/matcher.rs",
  "src-tauri/src/lib.rs",
  "src-tauri/src/mcp.rs",
  "src-tauri/assistant-persona.md",
  "src-tauri/voice-commands.json",
  "playwright.config.ts",
  "package.json",
];

const scratch = mkdtempSync(join(tmpdir(), "jvos-forge-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(name) {
  const root = join(scratch, name);
  for (const path of READS) cpSync(join(REPO, path), join(root, path), { recursive: true });
  // The spec folders only need to exist (their names are listed).
  for (const group of ["features", "widgets", "apps"])
    for (const folder of readdirSync(join(REPO, ".specs", group))) mkdirSync(join(root, ".specs", group, folder), { recursive: true });
  return root;
}

function hashes(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root);
  return out;
}

async function run(root, args) {
  const chunks = [];
  const io = { input: { isTTY: false }, output: { isTTY: false, write: (text) => (chunks.push(String(text)), true) } };
  const code = await main([...args, "--root", root, "--no-color", "--date", "2026-11-03"], { io, now: new Date(2026, 10, 3, 15) });
  return { code, out: chunks.join("") };
}

describe("whole runs", () => {
  test("a widget with data and a menu: new files only, and the snippets add up", async () => {
    const root = fixture("widget");
    const before = hashes(root);
    const { code, out } = await run(root, ["widget", "humor", "--title", "Humor", "--icon", "Smile", "--voice", "humor, meu humor", "--data", "--yes"]);
    assert.equal(code, 0, out);
    for (const path of [".specs/widgets/humor/spec.md", "src/components/desktop/widgets/HumorWidget.tsx", "src/lib/humor.ts", "src/hooks/useHumor.ts", "tests/humor.spec.ts"])
      assert.ok(existsSync(join(root, path)), `${path} missing`);
    assert.deepEqual(readdirSync(join(root, ".specs/widgets/humor")), ["spec.md"], "one file per item");
    const afterRun = hashes(root);
    for (const [path, hash] of before) assert.equal(afterRun.get(path), hash, `${path} changed`);

    const rust = /const WINDOW_KINDS: \[&str; (\d+)\] = \[(.*)\];/.exec(out);
    assert.equal(Number(rust[1]), rust[2].split(",").length);
    assert.ok(rust[2].includes('"tasks", "humor", "markdown"'), "widgets go before the first app");
    const voiceLine = out.split("\n").find((line) => line.includes('{ "id": "window:humor"'));
    assert.deepEqual(JSON.parse(voiceLine.replace(/^.*?┆ /, "").replace(/,\s*$/, "")).phrases, ["humor", "meu humor"]);
    assert.ok(out.includes("feeds={{ stocks, weather, agenda, tasks, humor }}"));
    assert.ok(out.includes("|tasks|humor)\\.spec\\.ts/"));

    const spec = readFileSync(join(root, ".specs/widgets/humor/spec.md"), "utf8");
    assert.match(spec, /\| \*\*ID\*\* \| `widget\/humor` \|/);
    assert.match(spec, /\| \*\*Status\*\* \| Em desenvolvimento \|/);
    assert.match(spec, /\| \*\*Origem\*\* \| não commitado \(03\/11\) \|/);
    assert.match(spec, /\(300 × 200, mínimo 220 × 120, grupo `widgets`\)/);
    assert.match(spec, /^# Humor\n\n[^<|#\n]/, "title and lead");
    const headings = spec.split("\n").filter((line) => /^## /.test(line));
    assert.deepEqual(headings, ["## Visão geral", "## Dados", "## Componentes", "## Voz e teclado", "## Restrições", "## Histórias de usuário", "## Critérios de sucesso", "## Fora de escopo e limitações", "## Código", "## Tarefas", "## Pendências"]);
    assert.match(spec, /^### `HumorWidget`$/m);
    for (const label of ["**Comportamento:**", "**Layout:**", "**Estilo:**"]) assert.ok(spec.includes(`- ${label}`), label);
    for (const id of ["RF-001", "RF-002", "RF-003", "RNF-001"]) assert.equal(spec.split(`**${id}**`).length - 1, 1, `${id} defined once`);
    assert.match(spec, /- \[ \] T\d{3} Kind no Rust — `src-tauri\/src\/settings.rs`/);
    assert.doesNotMatch(spec, /retroativas|<!--|plan\.md|tasks\.md|^### Contratos/m);
  });

  test("an app goes at the end of the kinds and loads lazily", async () => {
    const root = fixture("app");
    const { code, out } = await run(root, ["app", "notes", "--yes"]);
    assert.equal(code, 0, out);
    assert.ok(existsSync(join(root, "src/components/desktop/apps/notes/NotesApp.tsx")));
    const spec = readFileSync(join(root, ".specs/apps/jv_notes/spec.md"), "utf8");
    assert.match(spec, /^## Telas\n\n### jv_notes\n/m);
    assert.match(spec, /^### `NotesApp`$/m);
    assert.match(out, /"agent", "notes"\];/);
    assert.ok(out.includes('export const NotesApp = lazyApp(() => import("./apps/notes/NotesApp")'));
  });

  test("a feature touching everything: shortcut, command, tool and data", async () => {
    const root = fixture("feature");
    const { code, out } = await run(root, ["feature", "daily-quote", "--touches", "voice,data,command,tool", "--voice", "frase do dia", "--text", "--yes"]);
    assert.equal(code, 0, out);
    assert.ok(existsSync(join(root, "src/lib/dailyQuote.ts")));
    assert.ok(existsSync(join(root, "tests/daily-quote.spec.ts")));
    assert.match(out, /pub const SHORTCUT_TARGETS: \[&str; 19\] = \[/);
    assert.match(out, /const TOOLS: \[&str; 19\] = \[/);
    const needs = /const NEEDS_TEXT: \[&str; (\d+)\] = \[(.*)\];/.exec(out);
    assert.equal(Number(needs[1]), needs[2].split(",").length);
    assert.ok(out.includes("async fn daily_quote_get() -> Result<String, String> {"));
    const spec = readFileSync(join(root, ".specs/features/daily-quote/spec.md"), "utf8");
    assert.deepEqual(readdirSync(join(root, ".specs/features/daily-quote")), ["spec.md"]);
    for (const heading of ["## Dados", "### Comando `daily_quote_get`", "### Tool `daily_quote` do JARVIS", "## Voz e teclado", "#### Comandos Tauri", "#### Ferramentas MCP (JARVIS)"]) assert.ok(spec.split("\n").includes(heading), heading);
    assert.doesNotMatch(spec, /^## Telas$/m);
  });

  test("an ADR takes the next number", async () => {
    const root = fixture("adr");
    const last = Math.max(...readdirSync(join(REPO, ".specs/arch/adr")).filter((name) => /^\d{4}-/.test(name)).map((name) => Number(name.slice(0, 4))));
    const { code, out } = await run(root, ["adr", "--title", "Cache das cotações no Rust", "--yes"]);
    assert.equal(code, 0, out);
    const file = `${String(last + 1).padStart(4, "0")}-cache-cotacoes-rust.md`;
    const doc = readFileSync(join(root, ".specs/arch/adr", file), "utf8");
    assert.match(doc, new RegExp(`^# ADR-${String(last + 1).padStart(4, "0")}: Cache das cotações no Rust`));
    assert.match(doc, /\| \*\*Status\*\* \| Proposto \|/);
    assert.match(doc, /\| \*\*Data\*\* \| 2026-11-03 \|/);
  });

  test("refusals: an existing kind, no terminal without --yes, and --dry-run writes nothing", async () => {
    const root = fixture("refusals");
    const before = hashes(root);
    let result = await run(root, ["widget", "clock", "--yes"]);
    assert.equal(result.code, 1);
    assert.match(result.out, /já existe a janela "clock"/);
    result = await run(root, ["widget", "demo"]);
    assert.equal(result.code, 1);
    assert.match(result.out, /use --yes/);
    result = await run(root, ["widget", "demo", "--dry-run"]);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /nada foi gravado/);
    assert.deepEqual([...hashes(root).keys()].sort(), [...before.keys()].sort());
    result = await run(root, ["gadget", "x", "--yes"]);
    assert.equal(result.code, 1);
    assert.match(result.out, /tipo "gadget" não existe/);
  });
});
