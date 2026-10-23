import { expect, test, type Page } from "@playwright/test";
import { DOCK_CLIP, PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

const dockSaved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.dock") ?? "{}"));

/** Scale of the Settings icon, read from its computed transform. */
const settingsIconScale = (page: Page) =>
  page.evaluate(() => {
    const icon = document.querySelector('[data-dock-item="settings"] > span:nth-of-type(2)')!;
    return new DOMMatrix(getComputedStyle(icon).transform).a;
  });

async function openDockTab(page: Page) {
  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await menu.getByRole("tab", { name: "Dock" }).click();
  return menu;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.dock"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(1000); // dock entrance
});

test("the advanced menu's Dock tab turns the dock off; its notices still show, and it comes back", async ({ page }) => {
  const dock = page.getByRole("navigation", { name: "Quick actions" });
  await expect(dock).toBeVisible();

  const menu = await openDockTab(page);
  const show = menu.getByRole("switch", { name: "Mostrar a dock" });
  await expect(show).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/advanced-dock.png` });
  await show.click();
  await expect(show).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(dock).toBeHidden();
  // Not just invisible: its buttons are out of reach.
  await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
  await expect.poll(async () => (await dockSaved(page)).visible).toBe(false);

  // What the dock would say still shows at the bottom.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "clock", open: true }));
  const toast = page.getByTestId("dock-toast");
  await expect(toast).toHaveText("Abrindo Relógio");
  const t = (await toast.boundingBox())!;
  expect(Math.abs(t.x + t.width / 2 - 960)).toBeLessThan(2);
  expect(t.y).toBeGreaterThan(1080 - 100);
  await page.screenshot({ path: `${SCREENS}/dock-off.png`, clip: DOCK_CLIP });
  await expect(toast).toBeHidden({ timeout: 5000 });

  // The launchers live on the dock: the search leaves them out while it is off.
  await page.keyboard.press("/");
  await page.keyboard.type("menu de widgets");
  const search = page.getByRole("dialog", { name: "Busca" });
  await expect(search.getByRole("option", { name: /Menu de widgets/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Off survives a reload; the search turns it back on.
  await page.reload();
  await waitForFrames(page);
  await expect(dock).toBeHidden();
  await page.keyboard.press("/");
  await page.keyboard.type("mostrar a dock");
  await expect(search.locator('[role="option"][aria-selected="true"]')).toContainText("Mostrar a dock");
  await page.keyboard.press("Enter");
  await expect(dock).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect.poll(async () => (await dockSaved(page)).visible).toBe(true);
});

test("the icon magnification can be turned off", async ({ page }) => {
  const settings = page.getByRole("button", { name: "Settings" });
  const hover = async () => {
    const b = (await settings.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.waitForTimeout(500); // spring
    return settingsIconScale(page);
  };

  expect(await hover()).toBeGreaterThan(1.15);
  await page.mouse.move(200, 200);

  const menu = await openDockTab(page);
  await menu.getByRole("switch", { name: "Ampliar ícones" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  expect(await hover()).toBe(1);
  await expect.poll(async () => (await dockSaved(page)).magnify).toBe(false);
});
