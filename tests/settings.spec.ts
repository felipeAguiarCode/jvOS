import { expect, test, type Page } from "@playwright/test";
import { hologramTint, PLAIN_SETTINGS, regionLevel, SCREENS, voiceStatus, waitForFrames } from "./helpers";

// In a browser the settings live in localStorage (the desktop app keeps them in Rust).
async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const panel = page.getByRole("dialog", { name: "Configurações" });
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => localStorage.setItem("jarvis.settings", settings), PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
});

test("opens from the dock and the keyboard, closes with Escape", async ({ page }) => {
  const panel = await openSettings(page);
  await expect(page.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENS}/settings-panel.png` });

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await page.keyboard.press("Control+,");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Fechar configurações" }).click();
  await expect(panel).toBeHidden();
});

test("activation mode and language persist", async ({ page }) => {
  const panel = await openSettings(page);
  const always = panel.getByRole("radio", { name: "Sempre ouvindo" });
  await expect(panel.getByRole("radio", { name: "Segurar para falar" })).toHaveAttribute("aria-checked", "true");
  await always.click();
  await expect(always).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByText("Qualquer frase com uma palavra-chave abre o programa.")).toBeVisible();
  await panel.getByRole("radio", { name: "Segurar para falar" }).click();
  await expect(panel.getByText(/Segure o botão Voice \(ou a tecla M\)/)).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/settings-push-to-talk.png` });
  await always.click();
  await panel.getByRole("radio", { name: "English" }).click();

  await page.waitForTimeout(700); // debounced save
  await page.reload();
  await waitForFrames(page);
  const reopened = await openSettings(page);
  await expect(reopened.getByRole("radio", { name: "Sempre ouvindo" })).toHaveAttribute("aria-checked", "true");
  await expect(reopened.getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
});

test("the JARVIS color recolours the hologram and the interface, and persists", async ({ page }) => {
  const cssColor = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-hud-cyan").trim().toLowerCase());
  const tint = async () => {
    await page.mouse.move(40, 40);
    await page.waitForTimeout(400);
    return hologramTint(page);
  };

  const blue = await tint();
  expect(blue.b).toBeGreaterThan(blue.r + 60); // cyan: green + blue, no red

  const panel = await openSettings(page);
  await expect(panel.getByRole("radio", { name: "Azul" })).toHaveAttribute("aria-checked", "true");

  await panel.getByRole("radio", { name: "Verde Matrix" }).click();
  await expect(panel.getByRole("radio", { name: "Verde Matrix" })).toHaveAttribute("aria-checked", "true");
  expect(await cssColor()).toBe("#00c238");
  await page.waitForTimeout(400); // color transitions
  await page.screenshot({ path: `${SCREENS}/theme-green.png` });
  await page.keyboard.press("Escape");
  const green = await tint();
  expect(green.g).toBeGreaterThan(green.b + 60);
  expect(green.g).toBeGreaterThan(green.r + 60);

  const reopened = await openSettings(page);
  await reopened.getByRole("radio", { name: "Amarelo digital" }).click();
  expect(await cssColor()).toBe("#e6ae00");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/theme-yellow.png` });
  await page.keyboard.press("Escape");
  const yellow = await tint();
  expect(yellow.r).toBeGreaterThan(yellow.b + 60);
  expect(yellow.g).toBeGreaterThan(yellow.b + 60);
  console.log(`hologram tint — blue ${JSON.stringify(blue)}, green ${JSON.stringify(green)}, yellow ${JSON.stringify(yellow)}`);

  await page.reload();
  await waitForFrames(page);
  await expect.poll(cssColor).toBe("#e6ae00");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));
  expect(saved.theme).toBe("yellow");
});

test("the background can be switched and persists", async ({ page }) => {
  // Left of the hologram, above the dock: only the backdrop shows there.
  const side = () => regionLevel(page, { x: 0, y: 0, width: 420, height: 800 });
  const choose = async (name: string) => {
    const panel = await openSettings(page);
    const option = panel.getByRole("radio", { name, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.mouse.move(40, 40);
    await page.waitForTimeout(500);
  };

  const panel = await openSettings(page);
  await expect(panel.getByRole("radio", { name: "Preto" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  const solid = await side();
  expect(solid.max).toBeLessThan(20);

  await choose("Grid côncavo");
  await page.screenshot({ path: `${SCREENS}/background-grid.png` });
  const grid = await side();
  expect(grid.max).toBeGreaterThan(solid.max + 25);
  // Faint enough to stay out of the hologram measurements (lit = brightest channel ≥ 120).
  expect(grid.max).toBeLessThan(120);

  await choose("Matrix");
  await page.screenshot({ path: `${SCREENS}/background-matrix.png` });
  const matrix = await side();
  expect(matrix.max).toBeGreaterThan(solid.max + 25);
  expect(matrix.mean).toBeGreaterThan(solid.mean);
  console.log(`backdrop level — solid ${JSON.stringify(solid)}, grid ${JSON.stringify(grid)}, matrix ${JSON.stringify(matrix)}`);

  const reopened = await openSettings(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENS}/settings-background.png` });
  await reopened.getByRole("button", { name: "Fechar configurações" }).click();

  await page.reload();
  await waitForFrames(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));
  expect(saved.background).toBe("matrix");
  const restored = await openSettings(page);
  await expect(restored.getByRole("radio", { name: "Matrix", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("keywords can be added and removed per program", async ({ page }) => {
  const panel = await openSettings(page);
  const browser = panel.getByTestId("app-browser");

  const input = browser.getByLabel("Nova palavra-chave para Browser");
  await input.fill("web");
  await input.press("Enter");
  await input.fill("google, ");
  await input.press(",");
  await expect(browser.getByText("web", { exact: true })).toBeVisible();
  await expect(browser.getByText("google", { exact: true })).toBeVisible();

  await browser.getByRole("button", { name: "Remover palavra-chave internet" }).click();
  await expect(browser.getByText("internet", { exact: true })).toBeHidden();

  // Typing "m" in a field must not toggle the microphone.
  await input.fill("música");
  await input.press("Enter");
  expect(await voiceStatus(page)).toBe("idle");

  await page.waitForTimeout(700);
  await page.reload();
  await waitForFrames(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));
  const keywords = saved.apps.find((app: { id: string }) => app.id === "browser").keywords;
  expect(keywords).toEqual(["navegador", "browser", "web", "google", "música"]);
});

test("custom programs can be added, edited and removed", async ({ page }) => {
  const panel = await openSettings(page);
  await panel.getByRole("button", { name: "Adicionar programa" }).click();

  const name = panel.getByLabel("Nome do programa");
  await expect(name).toHaveValue("Novo programa");
  await name.fill("Bloco de notas");
  const row = panel.locator("[data-testid^='app-app-']");
  await row.getByLabel("Nova palavra-chave para Bloco de notas").fill("notas");
  await row.getByLabel("Nova palavra-chave para Bloco de notas").press("Enter");
  await row.getByPlaceholder(/notepad/).fill("notepad");
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}/settings-custom-app.png` });

  await page.waitForTimeout(700);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));
  expect(saved.apps.at(-1)).toMatchObject({ name: "Bloco de notas", keywords: ["notas"], command: "notepad", builtin: false });

  await row.getByRole("button", { name: "Remover Bloco de notas" }).click();
  await expect(row).toHaveCount(0);
  // Dock programs cannot be removed.
  await expect(panel.getByRole("button", { name: "Remover Browser" })).toHaveCount(0);

  await page.waitForTimeout(700);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));
  expect(saved.apps).toHaveLength(4);
});
