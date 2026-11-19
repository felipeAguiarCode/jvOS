import { expect, test, type Page } from "@playwright/test";
import { activeConversation, PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

// JARVIS is Claude Code in the desktop app; here a scripted stand-in streams the answers
// (src/lib/assistant.ts), and `__JARVIS__.ask` stands in for a question said to the core.
const REPLY = "Às suas ordens. Os sistemas estão operacionais e prontos para o trabalho de hoje. Algo mais que eu possa fazer?";

const reply = (page: Page) => page.getByTestId("jarvis-reply");
const shownWords = (page: Page) => reply(page).locator("[data-testid=jarvis-reply-words] .superhot-word").count();
const stored = activeConversation;
const log = (page: Page) => page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!);
const ask = (page: Page, text: string) => page.evaluate((question) => window.__JARVIS__!.ask(question), text);
const history = (page: Page) => page.getByRole("dialog", { name: "Histórico do JARVIS" });

async function start(page: Page, assistant: unknown = { reply: REPLY, delayMs: 30 }) {
  await page.addInitScript((options) => {
    window.__JARVIS_ASSISTANT__ = options as never;
  }, assistant);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.desktop");
    localStorage.removeItem("jarvis.assistant");
    localStorage.removeItem("jarvis.conversations");
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page, 10);
}

/** Waits for the answer on screen to be over. */
const answered = (page: Page) => expect(reply(page)).toBeHidden({ timeout: 30_000 });

test("the core answers SUPERHOT style, word by word, and the answer lands in the history", async ({ page }) => {
  await start(page);
  const core = page.getByRole("button", { name: "Falar com o JARVIS" });
  await expect(core).toBeVisible();

  await ask(page, "Status dos sistemas?");
  await expect(reply(page)).toBeVisible();
  // The words cut in one at a time, a sentence (or 14 words) per page.
  await expect.poll(() => shownWords(page)).toBeGreaterThan(0);
  const early = await shownWords(page);
  await expect.poll(() => shownWords(page)).toBeGreaterThan(early);
  await expect(page.getByRole("button", { name: "Interromper o JARVIS" })).toBeVisible();
  await expect.poll(() => shownWords(page), { timeout: 10_000 }).toBe(14);
  await expect(reply(page).locator("[data-testid=jarvis-reply-words] span")).toHaveText(REPLY.split(" ").slice(0, 14));
  await page.screenshot({ path: `${SCREENS}/assistant-reply.png` });

  // The next page (the last sentence) comes after the first glitches out.
  await expect(reply(page)).toHaveAttribute("data-page", "1", { timeout: 15_000 });
  await answered(page);
  await expect(page.getByRole("button", { name: "Falar com o JARVIS" })).toBeVisible();

  await expect.poll(async () => (await stored(page))?.items.length).toBe(1);
  const memory = await stored(page);
  expect(memory!.sessionId).toBe("fake-session-1");
  expect(memory!.items[0]).toMatchObject({ question: "Status dos sistemas?", answer: REPLY });

  await page.getByRole("button", { name: "Histórico do JARVIS" }).click();
  await expect(history(page)).toBeVisible();
  await expect(history(page).getByText("Status dos sistemas?")).toBeVisible();
  await expect(history(page).getByText("Os sistemas estão operacionais")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/assistant-history.png` });
  await page.keyboard.press("Escape");
  await expect(history(page)).toBeHidden();
});

test("a follow-up continues the conversation; Nova conversa starts another", async ({ page }) => {
  await start(page, { reply: "Certamente.", delayMs: 20 });
  await ask(page, "Primeira pergunta");
  await answered(page);
  await ask(page, "Segunda pergunta");
  await answered(page);
  expect((await log(page)).asks.map((item) => item.sessionId)).toEqual([null, "fake-session-1"]);

  await page.getByRole("button", { name: "Histórico do JARVIS" }).click();
  await expect(history(page).getByTestId("assistant-entry")).toHaveCount(2);
  // Another conversation takes the screen, empty; the first one is kept (the chat lists them).
  await history(page).getByRole("button", { name: "Nova conversa" }).click();
  await expect(history(page).getByTestId("assistant-entry")).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.sessionId).toBeNull();
  // It has a Claude Code of its own from now on: the first one's is left as it was.
  expect((await log(page)).resets).toBe(0);

  await ask(page, "Terceira pergunta");
  await expect(history(page).getByTestId("assistant-entry")).toHaveCount(1, { timeout: 15_000 });
  expect((await log(page)).asks[2].sessionId).toBeNull();
  await expect.poll(async () => (await stored(page))?.sessionId).toBe("fake-session-3");

  // Limpar deletes the conversation on screen, with its session; an empty one takes its place.
  await answered(page);
  await history(page).getByRole("button", { name: "Limpar histórico" }).click();
  await expect(history(page).getByText("Clique no núcleo e fale com o JARVIS.", { exact: false })).toBeVisible();
  await expect.poll(async () => (await stored(page))?.items).toEqual([]);
  expect((await log(page)).forgets).toEqual(["fake-session-3"]);
});

test("a click on the core or Esc interrupts the answer, which is kept as interrupted", async ({ page }) => {
  await start(page, { reply: REPLY, delayMs: 250 });
  await ask(page, "Conte uma longa história");
  await expect.poll(() => shownWords(page)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Interromper o JARVIS" }).click();
  await answered(page);
  expect((await log(page)).cancels).toBe(1);

  await ask(page, "Outra longa história");
  await expect.poll(() => shownWords(page)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await answered(page);
  expect((await log(page)).cancels).toBe(2);

  await expect.poll(async () => (await stored(page))?.items.length).toBe(2);
  const { items } = await stored(page);
  expect(items.every((item: { cancelled?: boolean; answer: string }) => item.cancelled && item.answer.length > 0)).toBe(true);
  await page.getByRole("button", { name: "Histórico do JARVIS" }).click();
  await expect(history(page).getByText("Interrompida")).toHaveCount(2);
});

test("a failure shows inside the core and in the history", async ({ page }) => {
  await start(page, { reply: "", error: "Not logged in · Please run /login", delayMs: 20 });
  await ask(page, "Olá?");
  await expect(reply(page).getByTestId("jarvis-reply-error")).toHaveText("Not logged in · Please run /login");
  await page.getByRole("button", { name: "Histórico do JARVIS" }).click();
  await expect(history(page).getByText("Not logged in · Please run /login")).toBeVisible();
});

test("a note JARVIS writes opens in Jarvis Mark, its text arriving as it is written", async ({ page }) => {
  const note = "# Reunião de hoje\n\n- O núcleo virou a ponte com o Claude Code.\n- As respostas aparecem em estilo SUPERHOT.\n- Próximo passo: agentes criados por voz, revisados antes de rodar.\n";
  const path = "C:\\JARVIS\\Notas\\2026-10-26 Reunião de hoje.md";
  await start(page, { reply: "Salvo nas notas.", delayMs: 120, files: [{ path, content: note }] });
  // How long the editor's text is, frame by frame, from the question on.
  await page.evaluate(() => {
    const lengths: number[] = [];
    Object.assign(window, { noteLengths: lengths });
    const sample = () => {
      lengths.push(document.querySelector("[data-window='markdown'] .cm-content")?.textContent?.length ?? 0);
      if (lengths.length < 3000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await ask(page, "Salve o que conversamos nas notas");

  const mark = page.getByRole("dialog", { name: "Jarvis Mark", exact: true });
  await expect(mark).toBeVisible();
  const editor = mark.locator(".cm-content");
  await expect(editor).toContainText("revisados antes de rodar", { timeout: 15_000 });
  // The note grew a few words at a time before it was complete.
  const lengths = await page.evaluate(() => (window as unknown as { noteLengths: number[] }).noteLengths);
  const final = Math.max(...lengths);
  expect(lengths.some((length) => length > 0 && length < final)).toBe(true);
  await expect(mark.getByText("Nota salva pelo JARVIS")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/assistant-note.png` });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.editor.markdown") ?? "{}").path)).toBe(path);
});

test("JARVIS runs jvOS actions: windows, menus, and says what it could not find", async ({ page }) => {
  await start(page);
  const action = (tool: string, args: Record<string, unknown>) => page.evaluate(([name, input]) => window.__JARVIS__!.action(name, input), [tool, args] as const);

  expect(await action("jvos_run", { query: "abre o relógio" })).toEqual({ ok: true, text: "Feito: Relógio" });
  await expect(page.getByRole("dialog", { name: "Relógio", exact: true })).toBeVisible();
  await expect(page.getByText("JARVIS: Relógio")).toBeVisible();
  expect((await action("jvos_run", { query: "fechar relógio" })).ok).toBe(true);
  await expect(page.getByRole("dialog", { name: "Relógio", exact: true })).toBeHidden();

  expect((await action("jvos_run", { id: "settings:voice" })).ok).toBe(true);
  await expect(page.getByRole("dialog", { name: "Configurações" })).toBeVisible();
  await page.keyboard.press("Escape");

  const missing = await action("jvos_run", { query: "teletransporte quântico" });
  expect(missing.ok).toBe(false);
  const catalog = await action("jvos_commands", {});
  expect(catalog.text).toContain("window:clock — Relógio (Widgets)");
  expect(catalog.text).toContain("window:agent — jv_agent (Apps)");
});

test("in a browser the core says the conversation needs the desktop app", async ({ page }) => {
  await start(page, false);
  await page.getByRole("button", { name: "Falar com o JARVIS" }).click();
  await expect(page.getByText("Disponível no app desktop")).toBeVisible();
  // With the core off there is nothing to click.
  await page.evaluate(() => localStorage.setItem("jarvis.core", JSON.stringify({ mode: "off" })));
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Quick actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Falar com o JARVIS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Histórico do JARVIS" })).toHaveCount(0);
});
