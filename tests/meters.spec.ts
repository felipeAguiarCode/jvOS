import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

const GB = 1024 ** 3;
/** What the Rust meters would report: stands in for `system_stats` in the browser. */
const STATS = {
  cpu: 0.1,
  gpu: 0.37,
  ram: { used: 17.2 * GB, total: 31.8 * GB },
  memory: { used: 41 * GB, total: 45 * GB },
  disks: [
    { name: "C:", used: 228 * GB, total: 476 * GB },
    { name: "D:", used: 523 * GB, total: 931 * GB },
  ],
  wlan: { signal: 0.72, ssid: "Casa-5G" },
};
const PREFS = { windowStyle: "tui", snap: true, snapDistance: 14, snapCenter: true, grid: false, opacity: 0.85 };
const WIDGET = { x: 1920 - 16 - 300, y: 300, w: 300, h: 290 };
/** The monitor open on the right, like a Rainmeter skin. */
const OPEN = JSON.stringify({ version: 1, rects: { system: WIDGET }, order: ["system"], maximized: [], prefs: PREFS });

const metersSaved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.meters") ?? "{}"));

async function start(page: Page, { fake = true, desktop = OPEN }: { fake?: boolean; desktop?: string | null } = {}) {
  if (fake) await page.addInitScript((stats) => (window.__JARVIS_SYSTEM__ = stats), STATS);
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.meters", "jarvis.desktop"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  // Before the app starts: it writes its own desktop back as the page unloads.
  if (desktop) await page.addInitScript((state) => localStorage.setItem("jarvis.desktop", state), desktop);
  await page.reload();
  await waitForFrames(page, 10);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
});

test("one widget holds every bar; right click picks the bars and the HDD's drive", async ({ page }) => {
  await start(page);
  const widget = page.getByRole("dialog", { name: "Sistema", exact: true });
  const bar = (name: string) => widget.getByRole("progressbar", { name });
  await expect(bar("Uso da CPU")).toHaveAttribute("aria-valuenow", "10");
  await expect(bar("Uso da GPU")).toHaveAttribute("aria-valuenow", "37");
  await expect(bar("Espaço usado em C:")).toHaveAttribute("aria-valuenow", "48");
  await expect(bar("Sinal do Wi-Fi")).toHaveAttribute("aria-valuenow", "72");
  await expect(bar("Uso da RAM")).toHaveAttribute("aria-valuenow", "54");
  await expect(bar("Memória virtual em uso")).toHaveAttribute("aria-valuenow", "91");
  await expect(widget).toContainText("17,2 / 31,8 GB");
  await expect(widget).toContainText("virtual · 41 / 45 GB");
  await expect(widget).toContainText("Casa-5G");
  await expect(widget).toContainText("228 / 476 GB");
  // Nearly full, the virtual memory turns to the alert colour.
  await expect(widget.getByText("91%")).toHaveClass(/text-hud-alert/);
  await expect(widget.getByText("10%")).toHaveClass(/text-hud-light/);
  await page.waitForTimeout(800); // bars filling
  await page.screenshot({ path: `${SCREENS}/system-meters.png`, clip: { x: WIDGET.x - 24, y: WIDGET.y - 24, width: WIDGET.w + 40, height: WIDGET.h + 48 } });

  // Right click: the settings, at the pointer.
  await widget.getByRole("progressbar", { name: "Uso da RAM" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Opções do widget Sistema" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("group", { name: "Barras" }).getByRole("menuitemcheckbox")).toHaveCount(6);
  await expect(menu.getByRole("menuitemcheckbox", { name: /GPU/ })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `${SCREENS}/system-meters-menu.png`, clip: { x: WIDGET.x - 260, y: WIDGET.y - 24, width: WIDGET.w + 276, height: WIDGET.h + 200 } });

  // Ticking boxes keeps the menu open.
  await menu.getByRole("menuitemcheckbox", { name: /GPU/ }).click();
  await menu.getByRole("menuitemcheckbox", { name: /Memória/ }).click();
  await expect(menu).toBeVisible();
  await expect(widget.getByRole("progressbar")).toHaveCount(4);
  await expect(bar("Uso da GPU")).toHaveCount(0);
  // The details beside the names can go too.
  await menu.getByRole("menuitemcheckbox", { name: /Detalhes/ }).click();
  await expect(widget).not.toContainText("17,2 / 31,8 GB");
  await menu.getByRole("menuitemcheckbox", { name: /Detalhes/ }).click();
  await expect(widget).toContainText("17,2 / 31,8 GB");
  await menu.getByRole("menuitemradio", { name: /D:/ }).click();
  await expect(bar("Espaço usado em D:")).toHaveAttribute("aria-valuenow", "56");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect.poll(() => metersSaved(page)).toEqual({ bars: ["cpu", "disk", "wlan", "ram"], disk: "D:", details: true });

  // A click elsewhere closes it too; the choice survives a reload.
  await widget.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.mouse.click(400, 400);
  await expect(menu).toBeHidden();
  await page.reload();
  await expect(widget.getByRole("progressbar")).toHaveCount(4);
  await expect(bar("Espaço usado em D:")).toHaveAttribute("aria-valuenow", "56");

  // With every bar off, the widget says how to bring them back.
  await widget.click({ button: "right" });
  for (const name of ["CPU", "HDD", "WLAN", "RAM"]) await menu.getByRole("menuitemcheckbox", { name: new RegExp(name) }).click();
  await expect(widget).toContainText("Nenhuma barra · botão direito para escolher");
});

test("the monitor is in the widgets launcher, and says so outside the desktop app", async ({ page }) => {
  await start(page, { fake: false, desktop: null });
  await page.getByRole("button", { name: "Widgets", exact: true }).click();
  const launcher = page.getByRole("dialog", { name: "Menu de widgets" });
  await launcher.getByRole("button", { name: "Sistema", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sistema", exact: true })).toContainText("Indisponível neste ambiente");
});
