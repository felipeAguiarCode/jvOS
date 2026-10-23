import { expect, test, type Page } from "@playwright/test";
import { SCREENS, waitForFrames } from "./helpers";

const settingsSaved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate(() => ["jarvis.desktop", "jarvis.settings"].forEach((key) => localStorage.removeItem(key)));
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(800);
});

test("the top bar is on by default, turns off and on in the settings and drives the windows", async ({ page }) => {
  // beforeEach cleared the settings: a fresh install.
  const bar = page.getByRole("navigation", { name: "Barra superior" });
  await expect(bar).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Configurações" });
  const toggle = settings.getByRole("switch", { name: "Barra superior" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(bar).toHaveCount(0);
  await expect.poll(async () => (await settingsSaved(page)).taskbar).toBe(false);
  await toggle.click();
  await expect(bar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await settingsSaved(page)).taskbar).toBe(true);

  await expect.poll(async () => Math.round((await bar.boundingBox())?.y ?? -1)).toBe(0); // slides in
  const box = (await bar.boundingBox())!;
  expect(box.height).toBe(28);
  expect(box.width).toBe(1920);
  // Minimal: the time alone, the microphone as an icon (its state in the tooltip), no quality.
  await expect(bar.getByRole("button", { name: "Data e hora" })).toHaveText(/^\d{2}:\d{2}$/);
  await expect(bar.getByRole("button", { name: /^Voice/ })).toHaveText("");
  await expect(bar.getByRole("button", { name: "Qualidade gráfica (Ctrl+Shift+Q)" })).toHaveCount(0);
  await page.screenshot({ path: `${SCREENS}/taskbar-minimal.png`, clip: { x: 0, y: 0, width: 1920, height: 40 } });

  // Only open windows show up: one icon each, the focused one lit.
  await expect(bar.getByRole("button", { name: "Calculadora" })).toHaveCount(0);
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "calculator", open: true }));
  await expect(page.getByRole("dialog", { name: "Calculadora" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Calculadora" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar).toContainText("Calculadora"); // the focused window's title, in the middle
  // Nothing focused (a click on the empty desktop): the bar shows the system's name.
  await page.mouse.click(1500, 500);
  await expect(bar.getByTestId("taskbar-title")).toHaveText("JARVIS OS");
  await bar.getByRole("button", { name: "Data e hora" }).click();
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeVisible();

  // A maximised app stops below the bar, which stays usable.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "code", open: true }));
  await expect(bar.getByRole("button", { name: "Jarvis Code" })).toBeVisible();
  const code = page.getByRole("dialog", { name: "Jarvis Code" });
  await code.getByRole("button", { name: "Maximizar Jarvis Code" }).click();
  await page.waitForTimeout(450);
  const max = (await code.boundingBox())!;
  expect(max.y).toBe(28);
  expect(max.height).toBe(1080 - 28);
  await page.screenshot({ path: `${SCREENS}/taskbar.png` });
  await bar.getByRole("button", { name: "Calculadora" }).click();
  await expect(bar).toContainText("Calculadora");

  // Off again from the search bar.
  await page.keyboard.press("/");
  await page.keyboard.type("ocultar barra");
  await expect(page.getByRole("dialog", { name: "Busca" }).locator('[role="option"][aria-selected="true"]')).toContainText(
    "Ocultar a barra superior",
  );
  await page.keyboard.press("Enter");
  await expect(bar).toHaveCount(0);
  await expect.poll(async () => (await settingsSaved(page)).taskbar).toBe(false);
});

test("the advanced menu has a tab of its own for the top bar and its modules", async ({ page }) => {
  const bar = page.getByRole("navigation", { name: "Barra superior" });
  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await menu.getByRole("tab", { name: "Barra superior" }).click();
  const show = menu.getByRole("switch", { name: "Mostrar a barra superior" });
  await expect(show).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByText("Mudam na barra, ao vivo.")).toBeVisible();

  await show.click();
  await expect(bar).toHaveCount(0);
  await expect(menu.getByText("Ligue a barra para ver os módulos.")).toBeVisible();
  await show.click();
  await expect(bar).toBeVisible();
  await expect.poll(async () => (await settingsSaved(page)).taskbar).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/advanced-taskbar.png` });

  // Each module comes and goes live (quality and date start off: the bar is minimal).
  await expect(bar.getByRole("button", { name: "Qualidade gráfica (Ctrl+Shift+Q)" })).toHaveCount(0);
  await menu.getByRole("switch", { name: "Qualidade gráfica" }).click();
  await expect(bar.getByRole("button", { name: "Qualidade gráfica (Ctrl+Shift+Q)" })).toBeVisible();

  await expect(bar.getByTestId("taskbar-title")).toBeVisible();
  await menu.getByRole("switch", { name: "Título da janela" }).click();
  await expect(bar.getByTestId("taskbar-title")).toHaveCount(0);

  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "calculator", open: true }));
  await expect(bar.getByRole("button", { name: "Calculadora" })).toBeVisible();
  await menu.getByRole("switch", { name: "Janelas abertas" }).click();
  await expect(bar.getByRole("button", { name: "Calculadora" })).toHaveCount(0);

  await expect(bar.getByRole("button", { name: "Data e hora" })).toHaveText(/^\d{2}:\d{2}$/);
  await menu.getByRole("switch", { name: "Data", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Data e hora" })).not.toHaveText(/^\d{2}:\d{2}$/);

  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.taskbar") ?? "{}")))
    .toMatchObject({ quality: true, title: false, windows: false, date: true, clock: true });

  // The search finds the tab too.
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await page.keyboard.type("modulos");
  await expect(page.getByRole("dialog", { name: "Busca" }).locator('[role="option"][aria-selected="true"]')).toContainText(
    "Menu avançado › Barra superior",
  );
});

test("windows default to borderless TUIs; the advanced menu switches back to holographic", async ({ page }) => {
  for (const name of ["relogio", "calculadora", "pomodoro", "bateria"]) {
    await page.keyboard.press("/");
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Control+Shift+,");
  const advanced = page.getByRole("dialog", { name: "Menu avançado" });
  await advanced.getByRole("tab", { name: "Layout" }).click();
  await advanced.getByRole("button", { name: "Lado a lado" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await expect(page.locator('[data-window="clock"]')).toHaveAttribute("data-chrome", "tui");
  const clock = page.locator('[data-window="clock"] > div').first();
  const border = await clock.evaluate((element) => getComputedStyle(element).borderTopWidth);
  expect(border).toBe("0px");
  await page.screenshot({ path: `${SCREENS}/windows-tui.png` });

  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await menu.getByRole("tab", { name: "Janelas" }).click();
  await menu.getByRole("radio", { name: "Holográfico" }).click();
  await page.keyboard.press("Escape");
  await expect(clock).toHaveClass(/rounded-xl/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.desktop") ?? "{}").prefs?.windowStyle)).toBe("holo");
});
