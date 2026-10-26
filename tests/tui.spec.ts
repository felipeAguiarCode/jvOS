import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

const windowRoot = (page: Page, kind: string) => page.locator(`[data-window="${kind}"]`);
const cssVar = (page: Page, kind: string, name: string) =>
  page.evaluate(([k, n]) => getComputedStyle(document.querySelector(`[data-window="${k}"]`)!).getPropertyValue(n).trim().toLowerCase(), [kind, name]);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  // jv_ide on the in-memory demo project.
  await page.addInitScript(() => {
    window.__JARVIS_FS__ = true;
  });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.tui", "jarvis.ide", "jarvis.ide.drafts"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(800);
});

test("the TUI tab switches the editors' glow and aberration and sets their accent", async ({ page }) => {
  // jv_ide open on a Rust file, to look at.
  await page.keyboard.press("/");
  await page.keyboard.type("jv_ide");
  await page.keyboard.press("Enter");
  const ide = page.getByRole("dialog", { name: "jv_ide" });
  await expect(ide.getByTestId("ide-welcome")).toBeVisible({ timeout: 15_000 });
  await ide.getByTestId("ide-welcome").click();
  await page.keyboard.press("Control+o");
  await expect(ide.getByRole("tree", { name: "Arquivos do projeto" })).toBeVisible();
  await page.keyboard.press("Control+p");
  await page.keyboard.type("main.rs");
  await expect(ide.getByRole("option", { name: "src/main.rs" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(ide.locator(".cm-content")).toContainText("fn main", { timeout: 15_000 });

  // On by default: both effects; the accent follows JARVIS.
  await expect(windowRoot(page, "ide")).toHaveClass(/tui-glow/);
  await expect(windowRoot(page, "ide")).toHaveClass(/tui-aberration/);
  const jarvisLight = await cssVar(page, "ide", "--color-hud-light");
  // Widgets are not terminals.
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await menu.getByRole("tab", { name: "TUI" }).click();
  await expect(menu.getByTestId("tui-preview")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/advanced-tui.png` });

  await menu.getByRole("switch", { name: "Aberração cromática" }).click();
  await expect(windowRoot(page, "ide")).not.toHaveClass(/tui-aberration/);
  await menu.getByRole("switch", { name: "Brilho (glow)" }).click();
  await expect(windowRoot(page, "ide")).not.toHaveClass(/tui-glow/);
  await menu.getByRole("switch", { name: "Brilho (glow)" }).click();

  await menu.getByRole("radio", { name: "Âmbar" }).click();
  await expect.poll(() => cssVar(page, "ide", "--color-hud-light")).not.toBe(jarvisLight);
  const amber = await cssVar(page, "ide", "--color-hud-light");
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
  await expect(windowRoot(page, "ide")).toHaveClass(/tui-glow/);
  await expect(windowRoot(page, "ide")).not.toHaveClass(/tui-aberration/);
  expect(await cssVar(page, "ide", "--color-hud-light")).toBe(amber);
});
