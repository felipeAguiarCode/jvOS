import { normalize } from "./search";

/** Something to do today, on the Tarefas widget ("comprar pão"); said and deleted by its number. */
export interface Task {
  id: number;
  text: string;
  /** The day it was done ("AAAA-MM-DD"); null: still to do. Done ones go the next day. */
  done: string | null;
}

/** The lowest number not taken, so ids stay short to say ("tarefa 2") and never change. */
export function smallestFreeId(ids: Iterable<number>) {
  const taken = new Set(ids);
  let id = 1;
  while (taken.has(id)) id++;
  return id;
}

/** "3", "#3", 3 → 3 (null: not a number). */
export function idOf(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim().replace(/^#/, "")) : NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** The task whose words best match `words` ("comprar pão" finds "Comprar pão e leite"), if any. */
export function findByWords(tasks: Task[], words: string) {
  const wanted = normalize(words).split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  if (!wanted.length) return null;
  let best: { task: Task; score: number } | null = null;
  for (const task of tasks) {
    const text = normalize(task.text);
    const score = wanted.filter((word) => text.includes(word)).length;
    if (score && (!best || score > best.score)) best = { task, score };
  }
  return best && best.score >= Math.ceil(wanted.length / 2) ? best.task : null;
}

/** The list as data for JARVIS (the `tasks_list` tool). */
export function tasksReport(tasks: Task[]) {
  if (!tasks.length) return "A lista de tarefas está vazia.";
  return tasks.map((task) => `${task.id}: [${task.done ? "x" : " "}] ${task.text}`).join("\n");
}
