import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createSession } from "../src/lib/lab/engine";
import { LESSONS } from "../src/lib/lab/lessons";
import { generate, joinWords, tokenize } from "../src/lib/lab/lessons/model";
import { parseLine } from "../src/lib/lab/parse";
import { DEFAULT_LAB, parseLab } from "../src/lib/lab/progress";
import type { Chunk } from "../src/lib/lab/types";

// Pure Node tests of jv_lab's engine and lessons: no browser. Output is read without colours.

const plain = (chunks: Chunk[]) => chunks.map((chunk) => chunk.text).join("").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const ia = LESSONS.find((lesson) => lesson.id === "ia")!;

test("parseLine: quotes keep phrases together, --flags take values", () => {
  expect(parseLine('llm gen "O céu é" --temperature 0')).toEqual({ name: "llm", args: ["gen", "O céu é"], flags: { temperature: "0" } });
  expect(parseLine("Harness run 'x y' --mode=plan --verbose")).toEqual({ name: "harness", args: ["run", "x y"], flags: { mode: "plan", verbose: true } });
  expect(parseLine("rules “Gr4tis!!!”")).toEqual({ name: "rules", args: ["Gr4tis!!!"], flags: {} });
  expect(parseLine("   ")).toBeNull();
  expect(() => parseLine('rules "sem fim')).toThrow("aspas sem fechar");
});

test("lessons and challenges have unique ids, a hint and a text", () => {
  expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length);
  for (const lesson of LESSONS) {
    expect(new Set(lesson.steps.map((step) => step.id)).size, lesson.id).toBe(lesson.steps.length);
    expect(lesson.steps.length, lesson.id).toBeGreaterThanOrEqual(4);
    expect(existsSync(`src/lib/lab/lessons/${lesson.id}.md`), `${lesson.id}.md`).toBe(true);
  }
});

for (const lesson of LESSONS) {
  test(`${lesson.id}: each challenge's hint completes it, in order`, () => {
    const completed: string[] = [];
    const session = createSession(lesson, [], (id) => completed.push(id), 100);
    expect(plain(session.welcome())).toContain(`Desafio 1/${lesson.steps.length}`);
    for (const step of lesson.steps) {
      const output = plain(session.run(step.hint));
      expect(completed, `${step.hint}\n${output}`).toContain(step.id);
      expect(output).toContain("concluído");
    }
    expect(completed).toEqual(lesson.steps.map((step) => step.id));
    expect(plain(session.run("hint"))).toContain("Lição concluída");
  });
}

test("built-ins: help lists the lesson's commands, unknown commands and bad usage say so", () => {
  const completed: string[] = [];
  const session = createSession(ia, [], (id) => completed.push(id));
  const help = plain(session.run("ajuda"));
  for (const name of ["rules", "dataset", "train", "predict", "hint", "clear"]) expect(help).toContain(name);
  expect(plain(session.run("help train"))).toContain("train [--epochs N]");
  expect(plain(session.run("ls -la"))).toContain("comando não encontrado: ls");
  // A usage error neither completes nor counts: the challenge is still the first one.
  expect(plain(session.run("rules"))).toContain("uso: rules");
  expect(plain(session.run("predict \"oi\""))).toContain("não foi treinado");
  expect(plain(session.run("dica"))).toContain("Desafio 1/5");
  expect(completed).toEqual([]);
  expect(session.run("clear")).toEqual([{ text: "\x1b[2J\x1b[3J\x1b[H" }]);
});

test("only the current challenge counts, and two misses at its command suggest the hint", () => {
  const completed: string[] = [];
  const session = createSession(ia, ["rules"], (id) => completed.push(id));
  expect(plain(session.welcome())).toContain("Desafio 2/5");
  // train is challenge 3: running it now completes nothing.
  session.run("train");
  expect(completed).toEqual([]);
  session.run("dataset");
  expect(completed).toEqual(["dataset"]);
  // Challenge 4 wants the disguised spam: a normal message is a miss, twice is a nudge.
  session.run("train");
  expect(plain(session.run('predict "Almoço amanhã"'))).not.toContain("hint");
  expect(plain(session.run('predict "Reunião amanhã"'))).toContain("digite hint");
});

test("Tab completes commands and subcommands", () => {
  const llm = LESSONS.find((lesson) => lesson.id === "llm")!;
  const session = createSession(llm, [], () => {});
  expect(session.complete("tok")).toEqual({ line: "tokenize ", options: ["tokenize"] });
  expect(session.complete("llm g")).toEqual({ line: "llm gen ", options: ["gen"] });
  expect(session.complete("llm ")).toEqual({ line: "llm ", options: ["next", "gen", "context"] });
  expect(session.complete("x").options).toEqual([]);
});

test("the toy model: temperature 0 is always the same, a seed reproduces a sample", () => {
  const greedy = joinWords(generate("O céu é", 0, 1).words);
  expect(greedy).toBe(" azul porque a luz do sol se espalha no ar.");
  expect(joinWords(generate("O céu é", 0, 999).words)).toBe(greedy);
  expect(joinWords(generate("Era uma vez", 1, 7).words)).toBe(joinWords(generate("Era uma vez", 1, 7).words));
  const samples = new Set(Array.from({ length: 12 }, (_, seed) => joinWords(generate("Era uma vez", 1.5, seed).words)));
  expect(samples.size).toBeGreaterThan(3);
  expect(tokenize("Olá, mundo!")).toEqual(["Ol", "á", ",", " mundo", "!"]);
});

test("parseLab keeps what is valid and falls back for the rest", () => {
  expect(parseLab(null)).toBeNull();
  expect(parseLab("lixo")).toBeNull();
  expect(parseLab({ done: { ia: ["rules", 3, null] }, split: 9 })).toEqual({ version: 1, done: { ia: ["rules"] }, split: 0.7 });
  expect(parseLab({ done: [1, 2], split: "x" })).toEqual(DEFAULT_LAB);
});
