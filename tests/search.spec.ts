import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, voiceStatus, waitForFrames } from "./helpers";

async function openSearch(page: Page) {
  await page.keyboard.press("/");
  const search = page.getByRole("dialog", { name: "Busca" });
  await expect(search).toBeVisible();
  await expect(search.getByRole("combobox", { name: "Buscar no JARVIS" })).toBeFocused();
  return search;
}

const selected = (page: Page) => page.getByRole("dialog", { name: "Busca" }).locator('[role="option"][aria-selected="true"]');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.desktop");
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(800);
});

test("/ opens the search; typing finds a widget and Enter opens it", async ({ page }) => {
  let search = await openSearch(page);
  // Without a query everything is listed by group.
  await expect(search.getByText("Widgets", { exact: true })).toBeVisible();
  await expect(search.getByText("Menus", { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SCREENS}/search-empty.png` });

  await page.keyboard.type("calc");
  await expect(selected(page)).toContainText("Calculadora");
  await page.screenshot({ path: `${SCREENS}/search-calc.png` });
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Calculadora" })).toBeVisible();

  // Accents and partial words: "relogio" finds Relógio, and an open window can be closed.
  search = await openSearch(page);
  await page.keyboard.type("fechar calcu");
  await expect(selected(page)).toContainText("Fechar Calculadora");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Calculadora" })).toBeHidden();

  search = await openSearch(page);
  await page.keyboard.type("relogio");
  await expect(selected(page)).toContainText("Relógio");
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.innerText.trim())).toBe("");
});

test("arrow keys move the selection; menus open at the right place", async ({ page }) => {
  let search = await openSearch(page);
  await page.keyboard.type("menu avançado");
  const first = (await selected(page).textContent()) ?? "";
  await page.keyboard.press("ArrowDown");
  expect(await selected(page).textContent()).not.toBe(first);
  await page.keyboard.press("ArrowUp");
  expect(await selected(page).textContent()).toBe(first);

  // A tab of the advanced menu.
  await page.keyboard.press("Control+a");
  await page.keyboard.type("encaixe");
  await expect(selected(page)).toContainText("Menu avançado › Janelas");
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("tab", { name: "Janelas" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // A section of the settings, scrolled into view.
  search = await openSearch(page);
  await page.keyboard.type("palavras-chave");
  await expect(selected(page)).toContainText("Programas e palavras-chave");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Configurações" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "Adicionar programa" })).toBeInViewport();
  // Esc in the search closes only the search, not the panel behind it.
  search = await openSearch(page);
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(settings).toBeVisible();
});

test("settings and layout actions run from the search; / inside a text field just types", async ({ page }) => {
  await openSearch(page);
  await page.keyboard.type("verde");
  await expect(selected(page)).toContainText("Cor do JARVIS: Verde Matrix");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-hud-cyan").trim().toLowerCase()))
    .toBe("#00c238");

  await openSearch(page);
  await page.keyboard.type("grid");
  await expect(selected(page)).toContainText("Fundo: Grid côncavo");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}").background)).toBe("grid");

  // Two windows, then "lado a lado".
  for (const name of ["relógio", "bateria"]) {
    await openSearch(page);
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
  }
  await openSearch(page);
  await page.keyboard.type("lado a lado");
  await expect(selected(page)).toContainText("Organizar janelas lado a lado");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await page.getByRole("dialog", { name: "Relógio" }).boundingBox())?.width ?? 0).toBeGreaterThan(600);

  // In the markdown editor "/" is just a character.
  await openSearch(page);
  await page.keyboard.type("jarvis mark");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Jarvis Mark" });
  await expect(editor.locator(".cm-content")).toBeVisible({ timeout: 15_000 });
  await editor.locator(".cm-content").click();
  await page.keyboard.type("a/b");
  await expect(editor.locator(".cm-content")).toContainText("a/b");
  await expect(page.getByRole("dialog", { name: "Busca" })).toHaveCount(0);
  expect(await voiceStatus(page)).toBe("idle");
});
