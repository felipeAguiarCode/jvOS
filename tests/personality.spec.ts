import { expect, test, type Page } from "@playwright/test";
import { greetingLines, GREETINGS, HOMECOMING } from "../src/lib/greetings";
import { fill, line, LINES, statusLine, timeLine, type LineKey, type LineValues } from "../src/lib/jarvisLines";
import { waitForFrames } from "./helpers";

// JARVIS's own lines (no Claude Code): the user's name as a vocative, his voice, and the
// confirmation of voice commands. Claude Code's side lives in src-tauri/assistant-persona.md.

const NAME = "Tony";
/** A value for every `{key}` the lines use. */
const SAMPLE: LineValues = {
  clock: "São 14 horas e 5 minutos",
  clockLower: "são 14 horas e 5 minutos",
  date: "terça-feira, 27 de outubro de 2026",
  warnings: "o disco C está quase cheio",
  when: "20 minutos",
  text: "beber água",
  minutes: 25,
  app: "VS Code",
  title: "Relógio",
  what: "3 widgets",
  station: "Flash FM",
  target: "rock",
  phase: "foco",
  place: "Curitiba",
  temperature: 15,
  condition: "nublado",
  min: 10,
  max: 19,
  rain: 76,
  when: "hoje",
  count: "2 compromissos",
  items: "às 15 horas, Reunião com a Ana",
  title: "Reunião com a Ana",
  symbol: "PETR4",
  price: "53 reais e 88",
  direction: "acima",
  limit: "50 reais",
  id: 3,
  problem: "a lista está cheia (100)",
  freed: "215 megabytes",
};

/** Typographic slips a template could leave once filled. */
function slips(text: string) {
  return [/\{|\}/, / {2}/, / [,.:;?!]/, /,[.:;?!]/, /^ | $/, /^[a-zà-ú]/].filter((slip) => slip.test(text));
}

test("every line reads cleanly with and without the name, which only ever comes before punctuation", () => {
  for (const [key, pool] of Object.entries(LINES)) {
    expect(pool.length, key).toBeGreaterThan(0);
    for (const template of pool) {
      expect(template, `${key}: {n} before punctuation`).not.toMatch(/\{n\}(?![.,:;?!])/);
      for (const name of [NAME, ""]) {
        const said = fill(template, name, SAMPLE);
        expect(slips(said), `${key} (${name || "sem nome"}): ${said}`).toEqual([]);
        expect(said.split(NAME).length - 1, said).toBeLessThanOrEqual(name ? 1 : 0);
      }
    }
  }
  for (const variant of [...GREETINGS, ...HOMECOMING]) {
    for (const name of [NAME, ""]) {
      const [first, second] = greetingLines(variant, name);
      expect(slips(`${first} ${second}`), `${first} ${second}`).toEqual([]);
    }
  }
  // The greetings use the name, but not all of them.
  const named = GREETINGS.filter((variant) => variant.lines.join(" ").includes("{n}")).length;
  expect(named).toBeGreaterThan(GREETINGS.length / 3);
  expect(named).toBeLessThan(GREETINGS.length);
});

test("he varies his words: never the same line twice in a row", () => {
  const picks = Array.from({ length: 12 }, () => line("noted", NAME, {}, () => 0));
  for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  expect(new Set(picks).size).toBeGreaterThan(1);
});

test("the time comes with a remark in the small hours, the status with what needs attention first", () => {
  const day = timeLine(new Date(2026, 9, 27, 14, 5), NAME, () => 0);
  expect(LINES.time.map((template) => fill(template, NAME, { clock: "São 14 horas e 5 minutos", clockLower: "são 14 horas e 5 minutos" }))).toContain(day);
  const late = timeLine(new Date(2026, 9, 27, 3, 10), NAME, () => 0);
  expect(late).toMatch(/^São 3 horas e 10 minutos/);
  expect(LINES.lateTime.map((template) => fill(template, NAME, { clock: "São 3 horas e 10 minutos" }))).toContain(late);

  const gb = 1024 ** 3;
  const stats = { cpu: 0.12, gpu: null, ram: { used: 8 * gb, total: 16 * gb }, memory: null, disks: [{ name: "C:", used: 470 * gb, total: 475 * gb }], wlan: null };
  const tight = statusLine({ stats, battery: null, music: null }, NAME, () => 0);
  expect(tight).toContain("o disco C está quase cheio");
  expect(tight).toMatch(/Processador em 12 por cento, memória em 50 por cento, 5 gigabytes livres no disco C\.$/);
  expect(statusLine({ stats: null, battery: null, music: null }, NAME, () => 0)).toMatch(/sensores/);
});

const stored = (page: Page, key: string) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);
const history = (page: Page) => stored(page, "jarvis.assistant").then((memory) => (memory?.items ?? []) as { question: string; answer: string }[]);
const variants = (key: LineKey, values: LineValues = {}) => LINES[key].map((template) => fill(template, NAME, values));

test("voice commands get a short spoken confirmation, under what was said, and the dock still says it", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.assistant"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
  }, JSON.stringify({ taskbar: false, assistantName: NAME }));
  await page.reload();
  await waitForFrames(page, 10);

  await page.evaluate(() => {
    window.__JARVIS__!.hear("abre o relógio");
    window.__JARVIS__!.voiceWindow({ kind: "clock", open: true });
  });
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeVisible();
  // The dock's notice; the core may say the same words with the name after them.
  await expect(page.getByText("Abrindo Relógio", { exact: true })).toBeVisible();
  await expect(page.getByTestId("jarvis-reply")).toBeVisible();
  await expect.poll(async () => (await history(page)).length).toBe(1);
  const [opened] = await history(page);
  expect(opened.question).toBe("abre o relógio");
  expect(variants("openWindow", { title: "Relógio" })).toContain(opened.answer);

  await page.evaluate(() => {
    window.__JARVIS__!.hear("fecha todos os widgets");
    window.__JARVIS__!.voiceCloseGroup("widgets");
  });
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeHidden();
  await expect.poll(async () => (await history(page)).length).toBe(2);
  const closed = (await history(page))[1];
  expect(closed.question).toBe("fecha todos os widgets");
  expect(variants("closeGroup", { what: "1 widget" })).toContain(closed.answer);

  await page.evaluate(() => {
    window.__JARVIS__!.hear("pausa o pomodoro");
    window.__JARVIS__!.voicePomodoro("pause");
  });
  await expect.poll(async () => (await history(page)).length).toBe(3);
  expect(variants("pomodoroPause", { phase: "foco" })).toContain((await history(page))[2].answer);
});
