import type { Text } from "@codemirror/state";
import type { OutlineSymbol, SymbolKind } from "./outline";

/**
 * Outline for the languages whose highlighting is a legacy stream mode (C#, Kotlin, Ruby, Shell…):
 * their syntax tree is a flat token list, so declarations are found line by line instead. Nesting
 * comes from the indentation (or, in TOML and Dockerfiles, from the last section header).
 */

interface RegexRule {
  re: RegExp;
  kind: SymbolKind | ((match: RegExpExecArray) => SymbolKind);
  /** The capture group holding the name (1 by default), or a reader. */
  name?: number | ((match: RegExpExecArray) => string | undefined);
  /** Variables and fields: only at the top level or directly inside a class, never locals. */
  variable?: boolean;
  /** Starts a section (TOML table, Dockerfile stage): what follows nests under it. */
  section?: boolean;
}

interface RegexLanguage {
  rules: RegexRule[];
  /** Lines never read (comments). */
  skip?: RegExp;
  /** "indent" (default): nesting from the indentation; "section": one level under the last section. */
  nesting?: "indent" | "section";
}

/** Minified or generated lines are not worth matching. */
const MAX_LINE = 2000;
/** Kinds that hold what is indented under them. */
const CONTAINERS = new Set<SymbolKind>(["c", "i", "t", "n", "f", "m"]);
/** Where a variable is a field or a global, not a local. */
const FIELD_HOLDERS = new Set<SymbolKind>(["c", "i", "t", "n"]);

const unquote = (value: string) => value.replace(/^(["'`[])(.*)["'`\]]$/, "$2");

const C_SHARP: RegexLanguage = {
  skip: /^\s*(\/\/|\/\*|\*)/,
  rules: [
    { re: /^\s*namespace\s+([\w.]+)/, kind: "n" },
    {
      re: /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|unsafe|new|file|ref)\s+)*(class|struct|record(?:\s+(?:class|struct))?|interface|enum)\s+(\w+)/,
      kind: (m) => (m[1] === "interface" ? "i" : m[1] === "enum" ? "t" : "c"),
      name: 2,
    },
    {
      re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|unsafe|new|partial|readonly)\s+)+(?:[\w<>[\],.?()]+\s+)?(\w+)\s*(?:<[^>()]*>)?\s*\(/,
      kind: "f",
    },
    {
      re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|required|readonly|const|volatile|new)\s+)+[\w<>[\],.?()]+\s+(\w+)\s*(?:\{|=>|=|;)/,
      kind: "v",
      variable: true,
    },
  ],
};

const KOTLIN: RegexLanguage = {
  skip: /^\s*(\/\/|\/\*|\*)/,
  rules: [
    {
      re: /^\s*(?:@\w+(?:\([^)]*\))?\s+)*((?:(?:public|private|protected|internal|abstract|open|final|sealed|data|enum|annotation|inner|value|inline|expect|actual)\s+)*)(class|interface|object)\s+(\w+)/,
      kind: (m) => (m[2] === "interface" ? "i" : /\benum\b/.test(m[1]) ? "t" : "c"),
      name: 3,
    },
    {
      re: /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|override|open|abstract|final|suspend|inline|operator|infix|tailrec|external|expect|actual)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\(/,
      kind: "f",
    },
    { re: /^\s*(?:(?:public|private|internal)\s+)*typealias\s+(\w+)/, kind: "t" },
    {
      re: /^\s*(?:(?:public|private|protected|internal|override|open|abstract|final|const|lateinit|lazy)\s+)*(?:val|var)\s+(\w+)/,
      kind: "v",
      variable: true,
    },
  ],
};

const RUBY: RegexLanguage = {
  skip: /^\s*#/,
  rules: [
    { re: /^\s*module\s+([\w:]+)/, kind: "n" },
    { re: /^\s*class\s+([A-Z][\w:]*)/, kind: "c" },
    { re: /^\s*def\s+((?:self\.)?(?:[\w]+[?!=]?|[[\]<>=+\-*/%~!]+))/, kind: "f" },
    { re: /^\s*attr_(?:reader|writer|accessor)\s+:(\w+)/, kind: "v", variable: true },
    { re: /^\s*([A-Z][A-Z0-9_]*)\s*=(?!=)/, kind: "v", variable: true },
  ],
};

const SHELL: RegexLanguage = {
  skip: /^\s*#/,
  rules: [
    { re: /^\s*function\s+([\w.:-]+)/, kind: "f" },
    { re: /^\s*([\w.:-]+)\s*\(\s*\)/, kind: "f" },
  ],
};

const POWERSHELL: RegexLanguage = {
  skip: /^\s*#/,
  rules: [
    { re: /^\s*(?:function|filter|workflow)\s+([\w-]+(?::[\w-]+)?)/i, kind: "f" },
    { re: /^\s*class\s+(\w+)/i, kind: "c" },
    { re: /^\s*enum\s+(\w+)/i, kind: "t" },
    { re: /^\s*(?:(?:hidden|static)\s+)*\[[^\]]+\]\s*(\w+)\s*\(/i, kind: "f" },
    { re: /^\s*(?:(?:hidden|static)\s+)*\[[^\]]+\]\s*\$(\w+)/i, kind: "v", variable: true },
  ],
};

const LUA: RegexLanguage = {
  skip: /^\s*--/,
  rules: [
    { re: /^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(/, kind: "f" },
    { re: /^\s*(?:local\s+)?([\w.:]+)\s*=\s*function\s*\(/, kind: "f" },
  ],
};

const SWIFT: RegexLanguage = {
  skip: /^\s*(\/\/|\/\*|\*)/,
  rules: [
    {
      re: /^\s*(?:@\w+\s+)*(?:(?:public|private|fileprivate|internal|open|final|static|class|override|mutating|nonmutating|convenience|required|dynamic|optional)\s+)*func\s+([^\s(<]+)/,
      kind: "f",
    },
    { re: /^\s*(?:(?:public|private|fileprivate|internal|open|override|convenience|required)\s+)*(init)[?!]?\s*[(<]/, kind: "f" },
    {
      re: /^\s*(?:@\w+\s+)*(?:(?:public|private|fileprivate|internal|open|final|indirect)\s+)*(class|struct|enum|protocol|extension|actor)\s+(?!(?:func|var|let)\b)(\w[\w.]*)/,
      kind: (m) => (m[1] === "protocol" ? "i" : m[1] === "enum" ? "t" : "c"),
      name: 2,
    },
    { re: /^\s*(?:(?:public|private|fileprivate|internal|open)\s+)*typealias\s+(\w+)/, kind: "t" },
    {
      re: /^\s*(?:@\w+\s+)*(?:(?:public|private|fileprivate|internal|open|final|static|class|override|lazy|weak|unowned)\s+)*(?:var|let)\s+(\w+)/,
      kind: "v",
      variable: true,
    },
  ],
};

const DART: RegexLanguage = {
  skip: /^\s*(\/\/|\/\*|\*)/,
  rules: [
    {
      re: /^\s*(?:(?:abstract|base|final|sealed|interface|mixin)\s+)*(class|mixin|enum|extension)\s+(?!on\b)(\w+)/,
      kind: (m) => (m[1] === "enum" ? "t" : "c"),
      name: 2,
    },
    { re: /^\s*(?:static\s+)?(?:[\w<>,?[\]]+\s+)?get\s+(\w+)/, kind: "f" },
    {
      re: /^\s*(?:(?:static|external|factory)\s+)*(?:[\w<>,?[\]]+\s+)?(?!(?:if|for|while|switch|catch|return|else|new|await|throw)\b)([\w.]+)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?:async\*?|sync\*)?\s*(?:\{|=>)/,
      kind: "f",
    },
    {
      re: /^\s*(?:(?:static|final|const|var|late)\s+)+(?:[\w<>?,[\]]+\s+)?(\w+)\s*[=;]/,
      kind: "v",
      variable: true,
    },
  ],
};

const SQL_KINDS: Record<string, SymbolKind> = {
  table: "c",
  view: "c",
  function: "f",
  procedure: "f",
  proc: "f",
  trigger: "f",
  index: "k",
  sequence: "k",
  type: "t",
  schema: "n",
  database: "n",
};

const SQL: RegexLanguage = {
  skip: /^\s*--/,
  rules: [
    {
      re: /^\s*create\s+(?:or\s+(?:replace|alter)\s+)?(?:(?:temp|temporary|unlogged|global|local)\s+)*(table|(?:materialized\s+)?view|function|procedure|proc|trigger|(?:unique\s+)?index|type|schema|sequence|database)\s+(?:if\s+not\s+exists\s+)?([\w."`[\]]+)/i,
      kind: (m) => SQL_KINDS[m[1].toLowerCase().split(/\s+/).pop()!] ?? "k",
      name: (m) => m[2].split(".").map(unquote).join("."),
    },
  ],
};

const TOML: RegexLanguage = {
  skip: /^\s*#/,
  nesting: "section",
  rules: [
    { re: /^\s*\[\[\s*([^\]]+?)\s*\]\]/, kind: "n", section: true },
    { re: /^\s*\[\s*([^\]]+?)\s*\]/, kind: "n", section: true },
    { re: /^\s*("[^"]*"|'[^']*'|[\w.-]+)\s*=/, kind: "k", name: (m) => unquote(m[1]) },
  ],
};

const DOCKERFILE: RegexLanguage = {
  skip: /^\s*#/,
  nesting: "section",
  rules: [
    { re: /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i, kind: "n", section: true, name: (m) => m[2] ?? m[1] },
    { re: /^\s*(?:ARG|ENV)\s+([A-Za-z_]\w*)/i, kind: "v" },
    { re: /^\s*(ENTRYPOINT|CMD|EXPOSE|WORKDIR)\b/i, kind: "k", name: (m) => m[1].toUpperCase() },
  ],
};

/** By `LanguageDescription.name`. */
export const REGEX_OUTLINES: Record<string, RegexLanguage> = {
  "C#": C_SHARP,
  Kotlin: KOTLIN,
  Ruby: RUBY,
  Shell: SHELL,
  PowerShell: POWERSHELL,
  Lua: LUA,
  Swift: SWIFT,
  Dart: DART,
  SQL,
  MySQL: SQL,
  PostgreSQL: SQL,
  SQLite: SQL,
  "MS SQL": SQL,
  "MariaDB SQL": SQL,
  PLSQL: SQL,
  TOML,
  Dockerfile: DOCKERFILE,
};

/** Columns of leading whitespace, a tab reaching the next multiple of 4. */
function indentOf(line: string) {
  let width = 0;
  for (const char of line) {
    if (char === " ") width++;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Declarations found line by line, or null when the language has no rules here. */
export function outlineByRegex(doc: Text, language: string, max: number): OutlineSymbol[] | null {
  const spec = REGEX_OUTLINES[language];
  if (!spec) return null;
  const symbols: OutlineSymbol[] = [];
  // What the following lines may nest under: the enclosing declarations, by indentation.
  const open: { indent: number; kind: SymbolKind }[] = [];
  let inSection = false;

  for (let number = 1; number <= doc.lines && symbols.length < max; number++) {
    const line = doc.line(number);
    if (line.length > MAX_LINE || !line.text.trim() || spec.skip?.test(line.text)) continue;
    for (const rule of spec.rules) {
      const match = rule.re.exec(line.text);
      if (!match) continue;
      const name = typeof rule.name === "function" ? rule.name(match) : match[rule.name ?? 1];
      if (!name) continue;
      let kind = typeof rule.kind === "function" ? rule.kind(match) : rule.kind;
      let depth: number;
      if (spec.nesting === "section") {
        depth = rule.section ? 0 : inSection ? 1 : 0;
        if (rule.section) inSection = true;
      } else {
        const indent = indentOf(line.text);
        while (open.length && open[open.length - 1].indent >= indent) open.pop();
        const outer = open[open.length - 1]?.kind;
        if (rule.variable && outer && !FIELD_HOLDERS.has(outer)) break;
        if (kind === "f" && (outer === "c" || outer === "i")) kind = "m";
        depth = open.length;
        if (CONTAINERS.has(kind)) open.push({ indent, kind });
      }
      const at = line.text.indexOf(name, match.index);
      symbols.push({ kind, name, line: number, from: line.from + (at < 0 ? match.index : at), depth });
      break;
    }
  }
  return symbols;
}
