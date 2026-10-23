import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

interface StoredCommand {
  id: string;
  kind: string;
  target: string;
  label: string;
  phrases: string[];
  builtin: boolean;
}

const storedCommands = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}").voiceCommands ?? []) as StoredCommand[]);
const phrasesOf = async (page: Page, id: string) => (await storedCommands(page)).find((command) => command.id === id)?.phrases;

async function openVoiceTab(page: Page) {
  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await menu.getByRole("tab", { name: "Voz" }).click();
  await expect(menu.getByRole("heading", { name: "Como falar" })).toBeVisible();
  return menu;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.pomodoro"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(600);
});

test("the Voz tab gathers every voice interaction, and its phrases can be edited and restored", async ({ page }) => {
  const menu = await openVoiceTab(page);
  for (const section of ["Janelas", "Verbos", "Fechar em grupo", "Música · jv_T4p3", "Pomodoro", "Programas", "Suas interações"]) {
    await expect(menu.getByRole("heading", { name: section })).toBeAttached();
  }
  // A few of the built-in ones, as chips.
  await expect(menu.getByRole("button", { name: "Remover frase “relógio” de Relógio" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Remover frase “dá play” de Tocar / continuar" })).toBeAttached();
  await expect(menu.getByRole("button", { name: "Remover frase “pausa” de Pausar" })).toBeAttached();
  await expect(menu.getByRole("button", { name: "Remover frase “volta a música” de Música anterior" })).toBeAttached();
  await expect(menu.getByRole("button", { name: "Remover frase “inicia o pomodoro” de Iniciar / continuar" })).toBeAttached();
  await page.screenshot({ path: `${SCREENS}/advanced-voice.png` });

  // Add and remove phrases; the change is saved with the settings.
  const add = menu.getByRole("textbox", { name: "Nova frase para Próxima música" });
  await add.scrollIntoViewIfNeeded();
  await add.fill("bora pra próxima");
  await add.press("Enter");
  await menu.getByRole("button", { name: "Remover frase “next song” de Próxima música" }).click();
  await expect.poll(() => phrasesOf(page, "music:next")).toContain("bora pra próxima");
  expect(await phrasesOf(page, "music:next")).not.toContain("next song");

  // Back to the default.
  await menu.getByRole("button", { name: "Restaurar Próxima música" }).click();
  await expect.poll(() => phrasesOf(page, "music:next")).toContain("next song");
  expect(await phrasesOf(page, "music:next")).not.toContain("bora pra próxima");
  await expect(menu.getByRole("button", { name: "Restaurar Próxima música" })).toBeDisabled();

  // Program keywords are here too.
  const browser = menu.getByRole("textbox", { name: "Nova frase para Browser" });
  await browser.fill("chrome");
  await browser.press("Enter");
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}").apps?.find((app: { id: string }) => app.id === "browser")?.keywords))
    .toContain("chrome");

  // The search finds the tab (the field that had the focus lets go of it as the menu closes).
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await page.keyboard.type("comandos de voz");
  await expect(page.getByRole("dialog", { name: "Busca" }).locator('[role="option"][aria-selected="true"]')).toContainText("Menu avançado › Voz");
});

test("new interactions pick any action, are kept and can be removed", async ({ page }) => {
  let menu = await openVoiceTab(page);
  await menu.getByRole("button", { name: "Nova interação" }).click();
  const custom = menu.getByTestId("custom-voice-command");
  await custom.getByRole("textbox", { name: "Nome da interação" }).fill("Hora de treinar");
  await custom.getByRole("combobox", { name: "Ação de Hora de treinar" }).selectOption({ label: "Tocar uma playlist…" });
  await custom.getByRole("combobox", { name: "Playlist de Hora de treinar" }).selectOption("Wave 103");
  const phrase = custom.getByRole("textbox", { name: "Nova frase para Hora de treinar" });
  await phrase.fill("hora de treinar");
  await phrase.press("Enter");
  await expect
    .poll(async () => (await storedCommands(page)).filter((command) => !command.builtin))
    .toMatchObject([{ kind: "playlist", target: "Wave 103", label: "Hora de treinar", phrases: ["hora de treinar"] }]);
  await custom.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}/advanced-voice-custom.png` });

  // Another action: the Pomodoro.
  await custom.getByRole("combobox", { name: "Ação de Hora de treinar" }).selectOption({ label: "Pomodoro: iniciar / continuar" });
  await expect.poll(async () => (await storedCommands(page)).find((command) => !command.builtin)).toMatchObject({ kind: "pomodoro", target: "start" });

  await page.reload();
  await waitForFrames(page);
  menu = await openVoiceTab(page);
  await expect(menu.getByTestId("custom-voice-command").getByRole("textbox", { name: "Nome da interação" })).toHaveValue("Hora de treinar");
  await menu.getByRole("button", { name: "Remover Hora de treinar" }).click();
  await expect(menu.getByTestId("custom-voice-command")).toHaveCount(0);
  await expect.poll(async () => (await storedCommands(page)).filter((command) => !command.builtin)).toEqual([]);
});

test("the Pomodoro answers to voice (engine event stand-in)", async ({ page }) => {
  const voice = (action: string) => page.evaluate((a) => window.__JARVIS__!.voicePomodoro(a as "start"), action);
  const notice = (text: string) => page.getByRole("status").filter({ hasText: text });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.pomodoro") ?? "{}"));

  await voice("start");
  await expect(notice("Pomodoro: foco em andamento")).toBeVisible();
  await expect.poll(async () => (await stored()).endsAt).not.toBeNull();
  await voice("pause");
  await expect(notice("Pomodoro: pausado")).toBeVisible();
  await expect.poll(async () => (await stored()).endsAt).toBeNull();
  await voice("longer");
  await expect(notice("Pomodoro: +5 min de foco")).toBeVisible();
  await expect.poll(async () => (await stored()).durations?.focus).toBe(30);
  await voice("shorter");
  await expect.poll(async () => (await stored()).durations?.focus).toBe(25);
  await voice("skip");
  await expect(notice("Pomodoro: fase pulada")).toBeVisible();
  await expect.poll(async () => (await stored()).phase).toBe("short");
  await voice("reset");
  await expect(notice("Pomodoro: pausa curta reiniciado")).toBeVisible();

  // With its widget open, it shows what the voice did.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "pomodoro", open: true }));
  await voice("start");
  await expect(page.getByRole("dialog", { name: "Pomodoro" }).getByRole("button", { name: /Pausar/ })).toBeVisible();
});
