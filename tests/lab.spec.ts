import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

// jv_lab's terminal is simulated in the page itself (src/lib/lab/backend.ts): no fake flag needed.
const lab = (page: Page) => page.getByRole("dialog", { name: "jv_lab", exact: true });
const screen = (page: Page) => lab(page).locator("[data-terminal] .xterm-rows");
const challenges = (page: Page) => lab(page).getByRole("region", { name: "Desafios" });
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.lab") ?? "null"));
const card = (page: Page, title: string) => lab(page).getByRole("button", { name: title, exact: true });

async function openLab(page: Page) {
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "lab", open: true }));
  await expect(lab(page).getByTestId("lab-app")).toBeVisible({ timeout: 15_000 });
  await lab(page).getByRole("button", { name: "Maximizar jv_lab" }).click();
  await page.waitForTimeout(450);
}

async function run(page: Page, command: string) {
  await page.keyboard.type(command, { delay: 10 });
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.desktop");
    localStorage.removeItem("jarvis.lab");
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page, 10);
});

test("the catalog lists five lessons; a lesson shows its text beside a terminal that checks its challenges", async ({ page }) => {
  await openLab(page);
  await expect(lab(page).getByRole("list", { name: "Lições" }).getByRole("button")).toHaveCount(5);
  for (const title of ["O que é IA", "IA generativa", "LLM por dentro", "Nível de esforço", "Harness"]) await expect(card(page, title)).toBeVisible();
  await lab(page).screenshot({ path: `${SCREENS}/lab-catalog.png` });

  await card(page, "LLM por dentro").click();
  await expect(lab(page).getByRole("article", { name: "Conteúdo da lição" }).getByRole("heading", { name: "LLM por dentro", level: 1 })).toBeVisible();
  await expect(screen(page)).toContainText("Desafio 1/5", { timeout: 20_000 });
  // The keyboard goes straight to the terminal.
  await expect(lab(page).locator("[data-terminal] textarea")).toBeFocused();

  await run(page, "help");
  await expect(screen(page)).toContainText("tokenize");
  await run(page, 'tokenize "Olá, mundo!"');
  await expect(screen(page)).toContainText("Desafio 1/5 concluído");
  const steps = challenges(page).getByRole("listitem");
  await expect(steps.nth(0)).toHaveAttribute("data-done", "true");
  await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(lab(page).getByTestId("lab-progress")).toHaveText("1/5 desafios");

  // The hint of the current challenge, on the left.
  await challenges(page).getByRole("button", { name: "Mostrar dica" }).click();
  await expect(challenges(page).getByText('llm next "O céu é"', { exact: true })).toBeVisible();

  // A wrong command says so; ↑ brings the last line back.
  await lab(page).locator("[data-terminal]").click();
  await run(page, "ls");
  await expect(screen(page)).toContainText("comando não encontrado: ls");
  await run(page, 'llm next "O céu é"');
  await expect(screen(page)).toContainText("Desafio 2/5 concluído");
  await expect(steps.nth(1)).toHaveAttribute("data-done", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  const answers = async () => ((await screen(page).textContent()) ?? "").split("próximo token depois").length - 1;
  await expect.poll(answers).toBe(2);
  await page.waitForTimeout(300);
  await lab(page).screenshot({ path: `${SCREENS}/lab-lesson.png` });

  // Kept in jarvis.lab (written after a short pause).
  await expect.poll(async () => (await stored(page))?.done?.llm).toEqual(["tokenize", "next"]);
});

test("progress comes back from storage, Tab completes, Reiniciar clears the lesson and Voltar returns to its card", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("jarvis.lab", JSON.stringify({ version: 1, done: { ia: ["rules", "dataset"] }, split: 0.5 })));
  await openLab(page);
  await expect(card(page, "O que é IA").getByTestId("lesson-progress")).toHaveText("2/5 desafios");
  await card(page, "O que é IA").click();
  await expect(screen(page)).toContainText("Desafio 3/5", { timeout: 20_000 });
  await expect(challenges(page).locator("[data-done]")).toHaveCount(2);

  // "tra" + Tab → "train ".
  await page.keyboard.type("tra");
  await page.keyboard.press("Tab");
  await expect(screen(page)).toContainText("$ train");
  await page.keyboard.press("Enter");
  await expect(screen(page)).toContainText("Desafio 3/5 concluído", { timeout: 10_000 });
  await expect(challenges(page).locator("[data-done]")).toHaveCount(3);

  await lab(page).getByRole("button", { name: "Reiniciar lição" }).click();
  await expect(challenges(page).locator("[data-done]")).toHaveCount(0);
  await expect(screen(page)).toContainText("Desafio 1/5", { timeout: 20_000 });
  await expect(screen(page)).not.toContainText("concluído");
  await expect.poll(async () => (await stored(page))?.done?.ia ?? null).toBeNull();

  await lab(page).getByRole("button", { name: "Voltar às lições" }).click();
  await expect(card(page, "O que é IA")).toBeFocused();
  await expect(card(page, "O que é IA").getByTestId("lesson-progress")).toHaveText("0/5 desafios");
});

test("the divider moves with the keyboard and the split is remembered", async ({ page }) => {
  await openLab(page);
  await card(page, "Harness").click();
  // The terminal takes the keyboard once it starts: only then is the divider's focus its own.
  await expect(screen(page)).toContainText("Desafio 1/5", { timeout: 20_000 });
  const divider = lab(page).getByRole("separator", { name: "Redimensionar conteúdo e terminal" });
  const content = lab(page).getByRole("article", { name: "Conteúdo da lição" });
  const before = (await content.boundingBox())!.width;
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "60");
  expect((await content.boundingBox())!.width).toBeGreaterThan(before + 50);
  await expect.poll(async () => (await stored(page))?.split).toBeCloseTo(0.6);
});

test("what is typed while a command still prints waits for the prompt, and Ctrl+C stops a command", async ({ page }) => {
  await openLab(page);
  await card(page, "Harness").click();
  await expect(screen(page)).toContainText("Desafio 1/5", { timeout: 20_000 });
  // The second command is typed during the first one's output (its "concluído" comes after a pause).
  await page.keyboard.type("harness inspect\rharness tools\r", { delay: 5 });
  await expect(screen(page)).toContainText("ferramentas oferecidas ao modelo");
  await expect(screen(page)).toContainText("Desafio 2/5 concluído");
  await expect(screen(page)).not.toContainText("comando não encontrado");

  await run(page, 'harness run "corrija o teste que falha"');
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+c");
  await expect(screen(page)).toContainText("^C");
  await page.waitForTimeout(1_500);
  await expect(screen(page)).not.toContainText("resposta final");
});
