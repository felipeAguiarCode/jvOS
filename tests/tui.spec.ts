import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

const windowRoot = (page: Page, kind: string) => page.locator(`[data-window="${kind}"]`);
const cssVar = (page: Page, kind: string, name: string) =>
  page.evaluate(([k, n]) => getComputedStyle(document.querySelector(`[data-window="${k}"]`)!).getPropertyValue(n).trim().toLowerCase(), [kind, name]);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.tui"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(800);
});

test("the TUI tab switches the editors' glow and aberration and sets their accent", async ({ page }) => {
  // Jarvis Code open, with a little text to look at.
  await page.keyboard.press("/");
  await page.keyboard.type("jarvis code");
  await page.keyboard.press("Enter");
  const code = page.getByRole("dialog", { name: "Jarvis Code" });
  await expect(code.locator(".cm-content")).toBeVisible({ timeout: 15_000 });
  await code.getByLabel("Linguagem").selectOption("Rust");
  await code.locator(".cm-content").click();
  await page.keyboard.type('fn main() {\nprintln!("Olá, Builder");\n}');

  // On by default: both effects; the accent follows JARVIS.
  await expect(windowRoot(page, "code")).toHaveClass(/tui-glow/);
  await expect(windowRoot(page, "code")).toHaveClass(/tui-aberration/);
  const jarvisLight = await cssVar(page, "code", "--color-hud-light");
  // Widgets are not terminals.
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await menu.getByRole("tab", { name: "TUI" }).click();
  await expect(menu.getByTestId("tui-preview")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/advanced-tui.png` });

  await menu.getByRole("switch", { name: "Aberração cromática" }).click();
  await expect(windowRoot(page, "code")).not.toHaveClass(/tui-aberration/);
  await menu.getByRole("switch", { name: "Brilho (glow)" }).click();
  await expect(windowRoot(page, "code")).not.toHaveClass(/tui-glow/);
  await menu.getByRole("switch", { name: "Brilho (glow)" }).click();

  await menu.getByRole("radio", { name: "Âmbar" }).click();
  await expect.poll(() => cssVar(page, "code", "--color-hud-light")).not.toBe(jarvisLight);
  const amber = await cssVar(page, "code", "--color-hud-light");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(amber.slice(i, i + 2), 16));
  expect(r).toBeGreaterThan(b + 40); // warm
  expect(g).toBeGreaterThan(b);
  // The rest of the interface keeps the JARVIS colour.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-hud-light").trim().toLowerCase())).toBe(jarvisLight);

  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.tui") ?? "{}")))
    .toEqual({ aberration: false, glow: true, accent: "amber" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/tui-amber.png` });

  // Survives a reload.
  await page.reload();
  await waitForFrames(page);
  await expect(windowRoot(page, "code")).toHaveClass(/tui-glow/);
  await expect(windowRoot(page, "code")).not.toHaveClass(/tui-aberration/);
  expect(await cssVar(page, "code", "--color-hud-light")).toBe(amber);
});
