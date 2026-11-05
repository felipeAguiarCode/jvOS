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
  await expect(panel.getByText("Qualquer frase com uma palavra-chave abre o programa; perguntas e atalhos começam com “Jarvis”.")).toBeVisible();
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

test("speech recognition runs on the CPU or a GPU, automatic by default, and the choice persists", async ({ page }) => {
  const panel = await openSettings(page);
  const devices = panel.getByRole("radiogroup", { name: "Processamento da voz" });
  await devices.scrollIntoViewIfNeeded();
  // The browser fake lists the development laptop's GPUs.
  await expect(devices.getByRole("radio", { name: "Automático" })).toHaveAttribute("aria-checked", "true");
  await expect(devices.getByRole("radio", { name: "Processador" })).toBeVisible();
  const nvidia = devices.getByRole("radio", { name: /NVIDIA GeForce MX570 A · 2 GB/ });
  await expect(nvidia).toBeVisible();
  await expect(devices.getByRole("radio", { name: /Intel\(R\) Graphics/ })).toBeVisible();
  await expect(panel.getByTestId("voice-device-hint")).toContainText("GPU");
  await nvidia.click();
  await expect(nvidia).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `${SCREENS}/settings-voice-device.png` });

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}").voiceDevice)).toBe("NVIDIA GeForce MX570 A");
  await page.reload();
  await waitForFrames(page);
  const reopened = await openSettings(page);
  await expect(reopened.getByRole("radiogroup", { name: "Processamento da voz" }).getByRole("radio", { name: /NVIDIA/ })).toHaveAttribute("aria-checked", "true");
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

test("the backdrop is always black: there is no background to pick", async ({ page }) => {
  const panel = await openSettings(page);
  await expect(panel.getByText("Fundo", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("radio", { name: "Matrix", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.move(40, 40);
  await page.waitForTimeout(500);
  // Left of the hologram, above the dock: only the backdrop shows there.
  const side = await regionLevel(page, { x: 0, y: 0, width: 420, height: 800 });
  expect(side.max).toBeLessThan(20);
});

test("the name JARVIS calls the user by persists", async ({ page }) => {
  const panel = await openSettings(page);
  const name = panel.getByLabel("Como ele te chama");
  await expect(name).toHaveValue("");
  await name.fill("Tony");
  await page.waitForTimeout(700); // debounced save
  await page.reload();
  await waitForFrames(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));
  expect(saved.assistantName).toBe("Tony");
  const reopened = await openSettings(page);
  await expect(reopened.getByLabel("Como ele te chama")).toHaveValue("Tony");
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

test("shortcuts: sites, folders and files open by voice like programs", async ({ page }) => {
  const panel = await openSettings(page);
  await panel.getByRole("button", { name: "Adicionar site" }).click();
  await expect(panel.getByLabel("Nome do programa")).toHaveValue("Novo site");
  const row = panel.locator("[data-testid^='app-app-']");
  const kind = row.getByTestId("shortcut-kind");
  await expect(kind).toHaveText("Site");
  // The kind follows the command.
  await row.getByPlaceholder(/notepad/).fill('"C:\\Users\\builder\\Documents"');
  await expect(kind).toHaveText("Pasta");
  await row.getByPlaceholder(/notepad/).fill('"C:\\Users\\builder\\Documents\\plano.pdf"');
  await expect(kind).toHaveText("Arquivo");
  await row.getByPlaceholder(/notepad/).fill('"C:\\Program Files\\App\\app.exe"');
  await expect(kind).toHaveText("Programa");
  // Picking a folder or a file needs the desktop app's dialog.
  await expect(panel.getByRole("button", { name: "Adicionar pasta" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Adicionar arquivo" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Escolher pasta para Novo site" })).toBeDisabled();
});
