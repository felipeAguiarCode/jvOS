// Fills the spec templates (.specs/_templates, the single source) and the code skeletons
// (.cli/templates). Markdown is changed by header row and by section, so a template that gains
// text keeps it in every spec made afterwards.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Swaps the first `# …` line. */
export const setTitle = (md, title) => md.replace(/^# .*$/m, `# ${title}`);

/** Swaps the lead: the first paragraph after the title, when it is prose (not a table or a heading). */
export function setLead(md, lead) {
  const lines = md.split("\n");
  const title = lines.findIndex((line) => /^# /.test(line));
  const at = lines.findIndex((line, index) => index > title && line.trim() !== "");
  if (title < 0 || at < 0 || /^(\||#|<!--)/.test(lines[at])) return md;
  lines[at] = lead;
  return lines.join("\n");
}

/** Drops the `<!-- … -->` notes a template carries for its authors. */
export const dropComments = (md) => md.replace(/<!--[\s\S]*?-->\n*/g, "");

/** `| **Key** | value |` → the new value; `null` removes the row. */
export function setRow(md, key, value) {
  const row = new RegExp(`^\\| \\*\\*${escape(key)}\\*\\* \\|.*\\|\\n`, "m");
  if (!row.test(md)) return md;
  return md.replace(row, value === null ? "" : `| **${key}** | ${value.replace(/\$/g, "$$$$")} |\n`);
}

/**
 * Replaces what is under a heading (`## Estrutura`, `### Funcionais`) up to the next heading of
 * the same or a higher level. A missing heading is added at the end. `null` removes the section.
 */
export function setSection(md, heading, body) {
  const level = /^#+/.exec(heading)[0].length;
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start < 0) return body === null ? md : `${md.trimEnd()}\n\n${heading}\n\n${body.trim()}\n`;
  let end = lines.findIndex((line, at) => at > start && /^#+ /.test(line) && /^#+/.exec(line)[0].length <= level);
  if (end < 0) end = lines.length;
  const replacement = body === null ? [] : [lines[start], "", ...body.trim().split("\n"), ""];
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join("\n");
}

/** What is under a heading now (empty when there is no such heading). */
export function getSection(md, heading) {
  const level = /^#+/.exec(heading)[0].length;
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start < 0) return "";
  let end = lines.findIndex((line, at) => at > start && /^#+ /.test(line) && /^#+/.exec(line)[0].length <= level);
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** Replaces from the first line matching `from` up to (not including) the first matching `to`. */
export function setRange(md, from, to, body) {
  const lines = md.split("\n");
  const start = lines.findIndex((line) => from.test(line));
  if (start < 0) return md;
  let end = lines.findIndex((line, at) => at > start && to.test(line));
  if (end < 0) end = lines.length;
  return [...lines.slice(0, start), ...body.trim().split("\n"), "", ...lines.slice(end)].join("\n");
}

/** Removes every line matching `pattern`. */
export const dropLines = (md, pattern) =>
  md
    .split("\n")
    .filter((line) => !pattern.test(line))
    .join("\n");

/** One blank line between blocks, a single newline at the end. */
export const tidyMarkdown = (md) => `${md.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;

/** A markdown table. */
export const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

/**
 * A code skeleton from .cli/templates: `%%name%%` is a value; `%%#flag%%…%%/flag%%` stays when the
 * flag is on and `%%^flag%%…%%/flag%%` when it is off. A block tag alone on its line takes the line
 * with it. An unknown name is an error, so a typo never reaches a generated file.
 * @param {string} name path under .cli/templates
 * @param {Record<string, string | boolean>} values
 */
export function fillTemplate(name, values) {
  return fill(readFileSync(join(CODE_TEMPLATES, name), "utf8").replace(/\r\n/g, "\n"), values, name);
}

export function fill(text, values, name = "template") {
  const flag = (key) => {
    if (!(key in values)) throw new Error(`${name}: valor desconhecido "${key}"`);
    return Boolean(values[key]);
  };
  const pick = (_, sign, key, body) => ((sign === "#") === flag(key) ? body : "");
  // Blocks on lines of their own first (outer before inner), then the ones inside a line.
  const passes = (pattern) => {
    for (let pass = 0; pass < 10; pass++) {
      const before = out;
      out = out.replace(pattern, pick);
      if (out === before) return;
    }
  };
  let out = text;
  passes(/^[ \t]*%%([#^])(\w+)%%[ \t]*\n([\s\S]*?)^[ \t]*%%\/\2%%[ \t]*\n/gm);
  passes(/%%([#^])(\w+)%%([^\n]*?)%%\/\2%%/g);
  if (/%%[#^/]\w+%%/.test(out)) throw new Error(`${name}: bloco %%#…%% sem fechamento`);
  return out.replace(/%%(\w+)%%/g, (_, key) => {
    if (!(key in values) || typeof values[key] === "boolean") throw new Error(`${name}: valor desconhecido "${key}"`);
    return String(values[key]);
  });
}
