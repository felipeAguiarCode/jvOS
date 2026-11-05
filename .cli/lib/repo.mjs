// What the CLI reads from the repo before asking anything: the window kinds, the specs that exist,
// the voice catalogue, the ADRs, git and the templates. Read only: nothing here writes.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { iconFile, searchForm } from "./names.mjs";

export const PATHS = {
  desktop: "src/lib/desktop.ts",
  commands: "src/lib/commands.ts",
  desktopView: "src/components/desktop/Desktop.tsx",
  lazyApps: "src/components/desktop/lazyApps.tsx",
  app: "src/App.tsx",
  shortcuts: "src/lib/shortcuts.ts",
  assistantActions: "src/hooks/useAssistantActions.ts",
  settingsRs: "src-tauri/src/settings.rs",
  matcherRs: "src-tauri/src/voice/matcher.rs",
  libRs: "src-tauri/src/lib.rs",
  mcpRs: "src-tauri/src/mcp.rs",
  persona: "src-tauri/assistant-persona.md",
  voice: "src-tauri/voice-commands.json",
  playwright: "playwright.config.ts",
  specs: ".specs",
  templates: ".specs/_templates",
  adr: ".specs/arch/adr",
};

/** Read failures say which file and why, in the user's language. */
export class RepoError extends Error {}

const dirs = (path) => (existsSync(path) ? readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory()) : []);

/** Repo files with LF line ends (some files here are CRLF). */
export function readText(root, path) {
  const full = join(root, path);
  if (!existsSync(full)) throw new RepoError(`não encontrei ${path}`);
  return readFileSync(full, "utf8").replace(/\r\n/g, "\n");
}

const optionalText = (root, path) => (existsSync(join(root, path)) ? readText(root, path) : null);

function gitBase(root) {
  try {
    const [hash, date] = execFileSync("git", ["log", "-1", "--format=%h|%ad", "--date=short"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split("|");
    return hash ? { hash, date } : null;
  } catch {
    return null;
  }
}

/** `kind: { title: "Relógio", icon: Clock, size: …, group: "widgets" }` lines of `WINDOW_SPECS`. */
function windowSpecs(desktop) {
  const specs = {};
  for (const match of desktop.matchAll(/^ {2}(\w+): \{ title: "([^"]*)", icon: (\w+), size: \{ w: (\d+), h: (\d+) \}, min: \{ w: (\d+), h: (\d+) \}, group: "(widgets|apps)" \},$/gm)) {
    specs[match[1]] = { title: match[2], icon: match[3], size: { w: Number(match[4]), h: Number(match[5]) }, min: { w: Number(match[6]), h: Number(match[7]) }, group: match[8] };
  }
  return specs;
}

function adrs(root) {
  const folder = join(root, PATHS.adr);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort()
    .map((file) => {
      const first = readFileSync(join(folder, file), "utf8").split(/\r?\n/, 1)[0];
      return { number: Number(file.slice(0, 4)), file, title: first.replace(/^# ADR-\d{4}:\s*/, "").trim() };
    });
}

/**
 * Everything the questions and the checklist need.
 * @param {string} root the repo's folder
 */
export function readRepo(root) {
  const desktop = readText(root, PATHS.desktop);
  const kindsLine = /^export const WINDOW_KINDS: WindowKind\[\] = \[(.*)\];$/m.exec(desktop);
  if (!kindsLine) throw new RepoError(`não achei a linha de WINDOW_KINDS em ${PATHS.desktop}`);
  const kinds = [...kindsLine[1].matchAll(/"([a-z0-9]+)"/g)].map((match) => match[1]);
  const specs = windowSpecs(desktop);

  let voice;
  try {
    voice = JSON.parse(readText(root, PATHS.voice));
  } catch (error) {
    throw error instanceof RepoError ? error : new RepoError(`${PATHS.voice} não é um JSON válido`);
  }
  /** Each phrase (search form) and the commands that say it. */
  const phrases = new Map();
  for (const command of voice) for (const phrase of command.phrases ?? []) phrases.set(searchForm(phrase), [...(phrases.get(searchForm(phrase)) ?? []), command.id]);

  const templates = {};
  for (const name of ["spec", "adr"]) templates[name] = readText(root, `${PATHS.templates}/${name}.md`);

  const pkg = JSON.parse(readText(root, "package.json"));
  const lucide = join(root, "node_modules", "lucide-react", "dist", "esm", "icons");
  return {
    root,
    version: pkg.version ?? "0.0.0",
    kinds,
    specs,
    voice,
    phrases,
    folders: { features: dirs(join(root, PATHS.specs, "features")), widgets: dirs(join(root, PATHS.specs, "widgets")), apps: dirs(join(root, PATHS.specs, "apps")) },
    adrs: adrs(root),
    templates,
    git: gitBase(root),
    /** null when lucide-react is not installed (then any name is taken). */
    hasIcon: existsSync(lucide) ? (name) => existsSync(join(lucide, `${iconFile(name)}.mjs`)) || existsSync(join(lucide, `${iconFile(name)}.js`)) : null,
    exists: (path) => existsSync(join(root, path)),
    text: (path) => readText(root, path),
    optionalText: (path) => optionalText(root, path),
  };
}

/** @typedef {ReturnType<typeof readRepo>} Repo */
