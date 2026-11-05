import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dateKey, isDate } from "../lib/agenda";
import { useStoredState } from "../lib/storage";
import { findByWords, idOf, smallestFreeId, type Task } from "../lib/tasks";

const TASKS_KEY = "jarvis.tasks";
const MAX_TASKS = 100;
const MAX_TEXT = 160;

/** What is left on `today`: done the day before or earlier is gone, still to do stays. */
const leftOn = (tasks: Task[], today: string) => tasks.filter((task) => !task.done || task.done >= today);

function parseTasks(raw: unknown): Task[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const tasks: Task[] = [];
  for (const item of raw) {
    if (!item || typeof item.text !== "string" || !(item.done === null || (typeof item.done === "string" && isDate(item.done)))) continue;
    const id = idOf(item.id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    tasks.push({ id, text: item.text, done: item.done });
  }
  return leftOn(tasks, dateKey(new Date())).slice(0, MAX_TASKS);
}

/** "  comprar   pão " → "comprar pão". */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

/**
 * The day's to-do list (the Tarefas widget; JARVIS adds, ticks and deletes by voice), kept in
 * localStorage. Each task has a short number to say; done ones go at midnight.
 */
export function useTasks() {
  const [tasks, setTasks] = useStoredState<Task[]>(TASKS_KEY, [], parseTasks, 0);
  const [today, setToday] = useState(() => dateKey(new Date()));
  const latest = useRef(tasks);
  latest.current = tasks;

  // Midnight: yesterday's done tasks leave the list.
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const timer = window.setTimeout(() => setToday(dateKey(new Date())), midnight - now.getTime() + 1000);
    return () => window.clearTimeout(timer);
  }, [today]);
  useEffect(() => {
    setTasks((list) => {
      const left = leftOn(list, today);
      return left.length === list.length ? list : left;
    });
  }, [today, setTasks]);

  const save = useCallback(
    (next: Task[]) => {
      // Read by the next call right away (two said in a row get two numbers).
      latest.current = next;
      setTasks(next);
    },
    [setTasks],
  );

  /** Adds one at the end; returns it, or what is wrong. */
  const add = useCallback(
    (input: string): Task | string => {
      const text = tidy(input);
      if (!text) return "Falta a tarefa";
      if (latest.current.length >= MAX_TASKS) return `A lista está cheia (${MAX_TASKS})`;
      const task: Task = { id: smallestFreeId(latest.current.map((item) => item.id)), text, done: null };
      save([...latest.current, task]);
      return task;
    },
    [save],
  );

  /** Done (today) or back to do; returns it (null when there was none). */
  const setDone = useCallback(
    (id: number, done = true) => {
      const found = latest.current.find((task) => task.id === id);
      if (!found) return null;
      const task = { ...found, done: done ? dateKey(new Date()) : null };
      save(latest.current.map((item) => (item.id === id ? task : item)));
      return task;
    },
    [save],
  );

  /** New words for one (the widget's inline edit); returns it, or what is wrong. */
  const update = useCallback(
    (id: number, input: string): Task | string => {
      const text = tidy(input);
      if (!text) return "Falta a tarefa";
      const found = latest.current.find((task) => task.id === id);
      if (!found) return "Essa tarefa não existe mais";
      const task = { ...found, text };
      save(latest.current.map((item) => (item.id === id ? task : item)));
      return task;
    },
    [save],
  );

  /** Removes one; returns it (null when there was none). */
  const remove = useCallback(
    (id: number) => {
      const found = latest.current.find((task) => task.id === id) ?? null;
      if (found) save(latest.current.filter((task) => task.id !== id));
      return found;
    },
    [save],
  );

  /** The task with that number, or whose words match ("a de comprar pão"). */
  const find = useCallback((said: number | string) => (typeof said === "number" ? (latest.current.find((task) => task.id === said) ?? null) : findByWords(latest.current, said)), []);

  /** The list right now (a call right after a change sees it). */
  const list = useCallback(() => latest.current, []);

  const pending = useMemo(() => tasks.filter((task) => !task.done), [tasks]);

  return { tasks, pending, list, add, setDone, update, remove, find };
}

export type Tasks = ReturnType<typeof useTasks>;
