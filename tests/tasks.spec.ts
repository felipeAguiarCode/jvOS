import { expect, test, type Page } from "@playwright/test";
import { addDays, dateKey } from "../src/lib/agenda";
import { greetingLines, HOMECOMING } from "../src/lib/greetings";
import { dayLine, fill, LINES, tasksLine, type LineKey, type LineValues } from "../src/lib/jarvisLines";
import { cleanTask, leadingNumber, mentionsWhen, type ShortcutEvent } from "../src/lib/shortcuts";
import { findByWords, idOf, smallestFreeId, tasksReport, type Task } from "../src/lib/tasks";
import { SCREENS, waitForFrames } from "./helpers";

// The day's to-do list (the Tarefas widget), the agenda read back with it, and "acorda, querido,
// papai chegou". The engine (Rust, tested by cargo) decides what was said; here
// `__JARVIS__.voiceShortcut` stands in for its event and `__JARVIS__.action` for Claude Code's tools.

const NAME = "Tony";
const variants = (key: LineKey, values: LineValues = {}) => LINES[key].map((template) => fill(template, NAME, values));

test("task helpers: numbers said, appointments spotted, words tidied, the lowest free id", () => {
  expect(leadingNumber("2")).toBe(2);
  expect(leadingNumber("dois.")).toBe(2);
  expect(leadingNumber("número três")).toBe(3);
  expect(leadingNumber("#4 como feita")).toBe(4);
  expect(leadingNumber("o item 12")).toBe(12);
  // A number inside the task's words is no id.
  expect(leadingNumber("de comprar um pão")).toBeNull();
  expect(leadingNumber("comprar pão")).toBeNull();

  expect(mentionsWhen("que tenho dentista sexta às 10")).toBe(true);
  expect(mentionsWhen("da reunião amanhã")).toBe(true);
  expect(mentionsWhen("consulta dia 12")).toBe(true);
  expect(mentionsWhen("call às 14:30")).toBe(true);
  expect(mentionsWhen("pegar o carro à tarde")).toBe(true);
  expect(mentionsWhen("comprar pão")).toBe(false);
  expect(mentionsWhen("ligar para a Ana hoje")).toBe(false);

  expect(cleanTask("que preciso comprar pão.")).toBe("Preciso comprar pão");
  expect(cleanTask("de ligar para a Ana!")).toBe("Ligar para a Ana");
  expect(cleanTask(": pagar a luz")).toBe("Pagar a luz");

  expect(smallestFreeId([])).toBe(1);
  expect(smallestFreeId([1, 2, 4])).toBe(3);
  expect(idOf("#3")).toBe(3);
  expect(idOf(5)).toBe(5);
  expect(idOf("ev-abc")).toBeNull();

  const tasks: Task[] = [
    { id: 1, text: "Comprar pão e leite", done: null },
    { id: 2, text: "Ligar para a Ana", done: "2026-10-27" },
  ];
  expect(findByWords(tasks, "comprar pão")?.id).toBe(1);
  expect(findByWords(tasks, "a de ligar pra Ana")?.id).toBe(2);
  expect(findByWords(tasks, "lavar o carro")).toBeNull();
  expect(tasksReport(tasks)).toBe("1: [ ] Comprar pão e leite\n2: [x] Ligar para a Ana");
  expect(variants("tasksList", { count: "1 tarefa pendente", items: "número 1, Comprar pão e leite" })).toContain(tasksLine(tasks, NAME, () => 0));
  // The day: the agenda, then the list, the name said once.
  const day = dayLine([], tasks, NAME, () => 0);
  expect(day).toMatch(/número 1, Comprar pão e leite\.$/);
  expect(day.split(NAME).length - 1).toBeLessThanOrEqual(1);
});

const stored = (page: Page, key: string) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);
const lastAnswer = (page: Page) => stored(page, "jarvis.assistant").then((memory) => (memory?.items.at(-1)?.answer as string | undefined) ?? "");
const say = (page: Page, event: ShortcutEvent) => page.evaluate((shortcut) => window.__JARVIS__!.voiceShortcut(shortcut), event);
const action = (page: Page, tool: string, args: Record<string, unknown>) => page.evaluate(([name, input]) => window.__JARVIS__!.action(name, input), [tool, args] as const);
const answered = (page: Page) => expect(page.getByTestId("jarvis-reply")).toBeHidden({ timeout: 30_000 });
/** Waits for the history (saved after a pause) to end with one of JARVIS's ways to say it. */
const saidOneOf = (page: Page, lines: string[]) => expect.poll(async () => lines.includes(await lastAnswer(page))).toBe(true);
const savedTasks = (page: Page) => stored(page, "jarvis.tasks").then((tasks) => ((tasks ?? []) as Task[]).map((task) => `${task.id} ${task.done ? "x" : "-"} ${task.text}`));

async function start(page: Page, tasks?: Task[]) {
  await page.addInitScript(() => {
    window.__JARVIS_ASSISTANT__ = { reply: "Feito.", delayMs: 20 };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  // Settled first: the page writes its (empty) list back once it is up.
  await waitForFrames(page, 10);
  await page.evaluate(
    ([settings, list]) => {
      ["jarvis.desktop", "jarvis.assistant", "jarvis.tasks", "jarvis.agenda", "jarvis.reminders"].forEach((key) => localStorage.removeItem(key));
      if (list) localStorage.setItem("jarvis.tasks", list);
      localStorage.setItem("jarvis.settings", settings);
      localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
    },
    [JSON.stringify({ taskbar: false, assistantName: NAME }), tasks ? JSON.stringify(tasks) : null] as const,
  );
  await page.reload();
  await waitForFrames(page, 10);
}

test("the list by hand: added, ticked, edited and deleted, kept, and open by itself while something is pending", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "tasks", open: true }));
  const widget = page.getByRole("dialog", { name: "Tarefas" });
  await expect(widget.getByText("Nada para hoje.", { exact: false })).toBeVisible();

  for (const text of ["Comprar pão", "Ligar para a Ana", "Pagar a luz"]) {
    await widget.getByLabel("Nova tarefa").fill(text);
    await widget.getByLabel("Nova tarefa").press("Enter");
  }
  const list = widget.getByRole("list", { name: "Tarefas do dia" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.locator('[data-task="2"]')).toContainText("#2");

  await list.getByRole("checkbox", { name: "Comprar pão" }).click();
  await expect(list.getByRole("checkbox", { name: "Comprar pão" })).toHaveAttribute("aria-checked", "true");
  await expect(widget).toContainText("1 de 3");

  await list.getByText("Ligar para a Ana").dblclick();
  await widget.getByLabel("Editar tarefa 2").fill("Ligar para a Ana às 5");
  await widget.getByLabel("Editar tarefa 2").press("Enter");
  await expect(list.locator('[data-task="2"]')).toContainText("Ligar para a Ana às 5");
  // Esc leaves it as it was.
  await list.locator('[data-task="3"]').hover();
  await widget.getByRole("button", { name: "Editar Pagar a luz" }).click();
  await widget.getByLabel("Editar tarefa 3").fill("nada disso");
  await widget.getByLabel("Editar tarefa 3").press("Escape");
  await expect(list.locator('[data-task="3"]')).toContainText("Pagar a luz");
  await page.screenshot({ path: `${SCREENS}/widget-tasks.png` });

  await list.locator('[data-task="3"]').hover();
  await widget.getByRole("button", { name: "Apagar Pagar a luz" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect.poll(() => savedTasks(page)).toEqual(["1 x Comprar pão", "2 - Ligar para a Ana às 5"]);

  // Closed, it comes back on the next start: something is still to do.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "tasks", open: false }));
  await expect(widget).toBeHidden();
  await page.reload();
  await waitForFrames(page, 10);
  await expect(widget).toBeVisible();
  // A new number fills the gap.
  await widget.getByLabel("Nova tarefa").fill("Regar as plantas");
  await widget.getByLabel("Nova tarefa").press("Enter");
  await expect(list.locator('[data-task="3"]')).toContainText("Regar as plantas");
});

test("the next day: what was done yesterday is gone, what is still to do stays", async ({ page }) => {
  const today = dateKey(new Date());
  await start(page, [
    { id: 1, text: "Feita ontem", done: addDays(today, -1) },
    { id: 2, text: "Pendente de ontem", done: null },
    { id: 3, text: "Feita hoje", done: today },
  ]);
  const widget = page.getByRole("dialog", { name: "Tarefas" });
  await expect(widget).toBeVisible();
  await expect(widget.getByRole("list", { name: "Tarefas do dia" }).getByRole("listitem")).toHaveCount(2);
  await expect(widget).not.toContainText("Feita ontem");
});

test("nothing pending, nothing opens", async ({ page }) => {
  await start(page, [{ id: 1, text: "Feita hoje", done: dateKey(new Date()) }]);
  await expect(page.getByRole("dialog", { name: "Tarefas" })).toBeHidden();
});

test("by voice: added, ticked by number, deleted by its words, read back; a reminder without a when is a task", async ({ page }) => {
  await start(page);
  await say(page, { action: "taskAdd", text: "comprar pão.", said: "Adiciona tarefa comprar pão." });
  const widget = page.getByRole("dialog", { name: "Tarefas" });
  await expect(widget).toBeVisible();
  await saidOneOf(page, variants("taskAdded", { id: 1, text: "Comprar pão" }));
  await answered(page);

  await say(page, { action: "reminder", text: "de ligar para a Ana", said: "Me lembra de ligar para a Ana" });
  await expect.poll(() => savedTasks(page)).toEqual(["1 - Comprar pão", "2 - Ligar para a Ana"]);
  await saidOneOf(page, variants("taskAdded", { id: 2, text: "Ligar para a Ana" }));
  await answered(page);

  await say(page, { action: "taskDone", text: "dois.", said: "Conclui a tarefa dois." });
  await expect.poll(() => savedTasks(page)).toEqual(["1 - Comprar pão", "2 x Ligar para a Ana"]);
  await saidOneOf(page, variants("taskDone", { id: 2, text: "Ligar para a Ana" }));
  await answered(page);

  await say(page, { action: "tasks", text: "", said: "Quais são minhas tarefas?" });
  await saidOneOf(page, variants("tasksList", { count: "1 tarefa pendente", items: "número 1, Comprar pão" }));
  await answered(page);

  await say(page, { action: "taskRemove", text: "de comprar pão", said: "Apaga a tarefa de comprar pão" });
  await expect.poll(() => savedTasks(page)).toEqual(["2 x Ligar para a Ana"]);
  await saidOneOf(page, variants("taskRemoved", { id: 1, text: "Comprar pão" }));
  await answered(page);

  await say(page, { action: "taskRemove", text: "7", said: "Remove a tarefa 7" });
  await saidOneOf(page, variants("taskNotFound", { what: "número 7" }));
  await answered(page);
  // None of it needed Claude Code.
  expect(await page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__?.asks.length ?? 0)).toBe(0);

  // An appointment said as a note goes to JARVIS, for the agenda.
  await say(page, { action: "note", text: "que tenho dentista sexta às 10", said: "Anota que tenho dentista sexta às 10" });
  await answered(page);
  const prompt = (await page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!.asks.at(-1)?.text)) ?? "";
  expect(prompt).toMatch(/^\[Atalho: anotação\] O usuário disse: "Anota que tenho dentista sexta às 10"\./);
  expect(prompt).toContain("agenda_add");
});

test("JARVIS's tools for the list: add (the widget opens), list, done, remove", async ({ page }) => {
  await start(page);
  expect(await action(page, "tasks_add", { text: "Renovar o passaporte" })).toEqual({ ok: true, text: "Na lista como tarefa 1: Renovar o passaporte" });
  await expect(page.getByRole("dialog", { name: "Tarefas" })).toBeVisible();
  expect((await action(page, "tasks_add", { text: "  " })).ok).toBe(false);
  await action(page, "tasks_add", { text: "Levar o carro na revisão" });
  expect((await action(page, "tasks_done", { id: 2 })).text).toBe("Feita: 2, Levar o carro na revisão");
  expect((await action(page, "tasks_list", {})).text).toBe("1: [ ] Renovar o passaporte\n2: [x] Levar o carro na revisão");
  expect((await action(page, "tasks_done", { id: "2", done: false })).text).toBe("De volta a pendente: 2, Levar o carro na revisão");
  expect((await action(page, "tasks_remove", { id: 1 })).text).toBe("Apagada: 1, Renovar o passaporte");
  expect((await action(page, "tasks_remove", { id: 9 })).ok).toBe(false);
  await expect.poll(() => savedTasks(page)).toEqual(["2 - Levar o carro na revisão"]);
});

test("\"repassa minha agenda\": today's events and what is left on the list", async ({ page }) => {
  await start(page, [{ id: 1, text: "Comprar pão", done: null }]);
  await action(page, "agenda_add", { title: "Reunião com a Ana", date: dateKey(new Date()), time: "23:59" });
  await say(page, { action: "agenda", text: "do dia.", said: "Repassa minha agenda do dia." });
  await expect.poll(() => lastAnswer(page)).toContain("número 1, Comprar pão");
  const answer = await lastAnswer(page);
  expect(answer).toContain("às 23 e 59, Reunião com a Ana");
  expect(answer.split(NAME).length - 1).toBeLessThanOrEqual(1);
  await expect(page.getByRole("dialog", { name: "Agenda" })).toBeVisible();
});

test("\"acorda, querido, papai chegou\": the lights come on, the widgets light up, JARVIS welcomes him home", async ({ page }) => {
  await start(page, [{ id: 1, text: "Comprar pão", done: null }]);
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "tasks", open: false }));
  await say(page, { action: "homecoming", text: "", said: "Acorda, querido, papai chegou!" });
  await expect(page.getByTestId("homecoming")).toBeVisible();
  for (const name of ["Relógio", "Agenda", "Tarefas"]) await expect(page.getByRole("dialog", { name })).toBeVisible();
  await expect(page.getByTestId("homecoming")).toBeHidden();

  const greeting = page.getByTestId("greeting");
  await expect(greeting).toBeVisible();
  const said = HOMECOMING.map((variant) => greetingLines(variant, NAME).join(" "));
  expect(said).toContain(await greeting.getByRole("status").textContent());
  await page.screenshot({ path: `${SCREENS}/homecoming.png` });

  // Then, in his voice: welcome home, and the day.
  await expect(greeting).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => lastAnswer(page), { timeout: 10_000 }).toContain("número 1, Comprar pão");
  const answer = await lastAnswer(page);
  expect(variants("homecoming").some((welcome) => answer.startsWith(`${welcome} `))).toBe(true);
  expect(answer.split(NAME).length - 1).toBe(1);
  // Said once: a second time while the scene runs is ignored.
  await answered(page);
});
