// An architecture decision record, numbered after the last one.
import { adrSteps } from "../lib/checklist.mjs";
import { PATHS } from "../lib/repo.mjs";
import { adrSlug } from "../lib/names.mjs";
import { adrDoc } from "../lib/specs.mjs";

const STATUSES = [
  { value: "Proposto", label: "Proposto", hint: "ainda em discussão" },
  { value: "Aceito", label: "Aceito", hint: "já vale" },
];

async function collect(repo, q, date) {
  const number = String((repo.adrs.at(-1)?.number ?? 0) + 1).padStart(4, "0");
  const title = await q.text("title", {
    question: `A decisão do ADR-${number}, em uma frase`,
    hint: "ex.: Cache das cotações no Rust",
    validate: (answer) => (!answer ? "a decisão não pode ficar vazia" : answer.length > 120 ? "no máximo 120 caracteres" : !adrSlug(answer) ? "use ao menos uma palavra" : null),
  });
  const origin = await q.text("origin", { question: "Origem (commit, memória, conversa)", initial: "conversa" });
  const status = await q.one("status", { question: "Status", options: STATUSES });
  const replacesValue = await q.one("replaces", {
    question: "Substitui algum ADR?",
    options: [{ value: "", label: "Nenhum" }, ...repo.adrs.map((adr) => ({ value: String(adr.number), label: `ADR-${String(adr.number).padStart(4, "0")} ${adr.title}` }))],
    // Flags may say "15" or "0015".
    normalize: (text) => String(Number(text) || ""),
  });
  const replaces = replacesValue ? repo.adrs.find((adr) => adr.number === Number(replacesValue)) ?? null : null;
  const file = `${number}-${adrSlug(title)}.md`;
  if (repo.exists(`${PATHS.adr}/${file}`)) throw new q.UsageError(`já existe ${PATHS.adr}/${file}`);
  return { number, title, origin, status, replaces, file, date };
}

function build(repo, item) {
  const files = [{ path: `${PATHS.adr}/${item.file}`, note: "ADR", content: adrDoc(repo, item) }];
  const summary = [
    ["tipo", "ADR"],
    ["número", `ADR-${item.number}`],
    ["decisão", item.title],
    ["status", item.status],
    ["origem", item.origin],
  ];
  if (item.replaces) summary.push(["substitui", `ADR-${String(item.replaces.number).padStart(4, "0")}`]);
  return { files, steps: adrSteps(repo, item), summary };
}

export const adr = {
  value: "adr",
  label: "ADR",
  hint: "decisão de arquitetura numerada",
  collect,
  build,
};
