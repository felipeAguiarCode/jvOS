import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, waitForFrames } from "./helpers";

// JARVIS's voice with a silent stand-in (src/lib/speech.ts): each sentence lasts `msPerWord`
// per word, so the tests can tell the voice's pace from the text's own.
const REPLY = "Às suas ordens. Os sistemas estão operacionais e prontos para o trabalho de hoje. Algo mais que eu possa fazer?";
const FIRST = "Às suas ordens. Os sistemas estão operacionais e prontos para o trabalho de hoje.";
const SECOND = "Algo mais que eu possa fazer?";

const reply = (page: Page) => page.getByTestId("jarvis-reply");
const shownWords = (page: Page) => reply(page).locator("[data-testid=jarvis-reply-words] .superhot-word").count();
const spoken = (page: Page) => page.evaluate(() => window.__JARVIS_SPEECH_LOG__ ?? { texts: [], deaf: [] });
const ask = (page: Page, text: string) => page.evaluate((question) => window.__JARVIS__!.ask(question), text);

async function start(page: Page, { msPerWord = 700, speech = null as null | Record<string, unknown> } = {}) {
  await page.addInitScript(
    ([words, prefs]) => {
      window.__JARVIS_ASSISTANT__ = { reply: "Às suas ordens. Os sistemas estão operacionais e prontos para o trabalho de hoje. Algo mais que eu possa fazer?", delayMs: 20 };
      window.__JARVIS_SPEECH__ = { msPerWord: words };
      if (prefs) localStorage.setItem("jarvis.speech", JSON.stringify(prefs));
    },
    [msPerWord, speech] as const,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.assistant");
    localStorage.removeItem("jarvis.conversations");
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page, 10);
  // A gesture, so the page may play sound (as the click on the core does in the app).
  await page.mouse.click(1500, 500);
}

test("each sentence is spoken, and stays on screen as long as JARVIS says it", async ({ page }) => {
  await start(page);
  await ask(page, "Status?");
  await expect.poll(async () => (await spoken(page)).texts).toEqual([FIRST, SECOND]);

  // 14 words × 700 ms: the first page lasts the ~10 s of speech, not the text's ~6.7 s.
  await expect.poll(() => shownWords(page)).toBeGreaterThan(0);
  const shownAt = Date.now();
  await expect(reply(page)).toHaveAttribute("data-page", "1", { timeout: 20_000 });
  expect(Date.now() - shownAt).toBeGreaterThan(8_500);
  // The microphone's commands were off while he spoke, and are back now.
  await expect(reply(page)).toBeHidden({ timeout: 20_000 });
  const { deaf } = await spoken(page);
  expect(deaf[0]).toBe(true);
  await expect.poll(async () => (await spoken(page)).deaf.at(-1)).toBe(false);
});

test("Esc silences him at once", async ({ page }) => {
  await start(page, { msPerWord: 900 });
  await ask(page, "Status?");
  await expect.poll(() => shownWords(page)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(reply(page)).toBeHidden({ timeout: 2_000 });
  await expect.poll(async () => (await spoken(page)).deaf.at(-1)).toBe(false);
});

test("with the voice off nothing is spoken and the text keeps its own pace", async ({ page }) => {
  await start(page, { speech: { enabled: false, voice: "miro", speed: 1 } });
  await ask(page, "Status?");
  await expect.poll(() => shownWords(page), { timeout: 10_000 }).toBe(14);
  await expect(reply(page)).toBeHidden({ timeout: 20_000 });
  expect((await spoken(page)).texts).toEqual([]);
});

test("Settings › Voz do JARVIS: the voice, its pace, a sample, on and off", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Configurações" });
  const voices = panel.getByRole("radiogroup", { name: "Voz do JARVIS" });
  await voices.scrollIntoViewIfNeeded();
  // A deep male voice by default.
  await expect(voices.getByRole("radio", { name: "Miro · masculina, grave" })).toHaveAttribute("aria-checked", "true");
  await voices.getByRole("radio", { name: "Dii · feminina" }).click();
  await panel.getByRole("button", { name: "Ouvir exemplo" }).click();
  await expect.poll(async () => (await spoken(page)).texts).toEqual(["Às suas ordens. É assim que eu soo agora."]);
  await panel.getByRole("switch", { name: "Falar as respostas" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.speech") ?? "{}"))).toMatchObject({ enabled: false, voice: "dii" });
});
