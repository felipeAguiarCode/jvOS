import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { baseName } from "../../../../lib/paths";

/** Languages offered by "Linguagem…" (the language pack knows each), plus plain text. */
export const PICKER = [
  "JavaScript", "TypeScript", "JSX", "TSX", "JSON", "HTML", "CSS", "SCSS", "Markdown", "Python", "Rust", "Go", "Java", "C", "C++",
  "C#", "Shell", "PowerShell", "SQL", "YAML", "TOML", "XML", "PHP", "Ruby", "Kotlin", "Swift", "Dockerfile", "Lua", "Dart",
]
  .map((name) => LanguageDescription.matchLanguageName(languages, name, false))
  .filter((description): description is LanguageDescription => description !== null);

/** Git diffs and patches: a language of their own for the virtual tabs. */
export const DIFF = LanguageDescription.of({
  name: "Diff",
  extensions: ["diff", "patch"],
  load: async () => new LanguageSupport(StreamLanguage.define(diff)),
});

const SHEBANGS: [RegExp, string][] = [
  [/python/, "Python"],
  [/\b(bash|sh|zsh)\b/, "Shell"],
  [/\bnode\b|\bdeno\b|\bbun\b/, "JavaScript"],
  [/\bpwsh\b|powershell/, "PowerShell"],
  [/\bruby\b/, "Ruby"],
  [/\blua\b/, "Lua"],
];

/** The language of a file: picked by hand, else from its name, else from a `#!` line. */
export function describe(path: string | null, picked: string | null, firstLine = ""): LanguageDescription | null {
  if (picked) return picked === DIFF.name ? DIFF : LanguageDescription.matchLanguageName(languages, picked, false);
  if (!path) return null;
  const name = baseName(path);
  if (/\.(diff|patch)$/i.test(name)) return DIFF;
  const byName = LanguageDescription.matchFilename(languages, name);
  if (byName) return byName;
  if (firstLine.startsWith("#!")) {
    const hit = SHEBANGS.find(([pattern]) => pattern.test(firstLine));
    if (hit) return LanguageDescription.matchLanguageName(languages, hit[1], false);
  }
  return null;
}
