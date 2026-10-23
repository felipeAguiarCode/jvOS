import { expect, test, type Page } from "@playwright/test";
import { frames, PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

const coreSaved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.core") ?? "{}"));

async function start(page: Page) {
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.core"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
}

async function openCoreTab(page: Page) {
  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await menu.getByRole("tab", { name: "Núcleo" }).click();
  return menu;
}

/** Keeps JARVIS "listening for a command" with a voice, whatever the microphone does. */
const holdListening = (page: Page) =>
  page.evaluate(() => {
    const signals = window.__JARVIS__!.signals;
    const hold = () => {
      Object.assign(signals, { align: 1, voice: 0.8, level: 0.7 });
      requestAnimationFrame(hold);
    };
    hold();
  });

/** Per orbit of the 2D core: lying on the equator (tilt ~0, flattened)? */
const orbitsAligned = (page: Page) =>
  page.locator("[data-orbit]").evaluateAll((orbits) =>
    orbits.map((orbit) => {
      const [, tilt, , squash] = (orbit as HTMLElement).style.transform.match(/rotate\((-?[\d.]+)deg\) scale\(([\d.]+), ([\d.]+)\)/)!.map(Number);
      return Math.abs(tilt) < 3 && squash < 0.27;
    }),
  );

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
});

test("the Núcleo tab swaps the 3D hologram for the 2D rings live, and a restart never loads the 3D", async ({ page }) => {
  await start(page);
  await waitForFrames(page);
  await expect(page.locator("canvas")).toHaveCount(1);

  const menu = await openCoreTab(page);
  await expect(menu.getByRole("radio", { name: "Holograma 3D" })).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/advanced-core.png` });
  await menu.getByRole("radio", { name: "Anéis 2D" }).click();
  await expect(menu.getByText(/sem WebGL/)).toBeVisible();
  // The WebGL canvas is gone; the rings take its place.
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator('[data-core="2d"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await coreSaved(page)).mode).toBe("2d");

  // The rings still follow the voice: the signals keep being sampled.
  const before = await frames(page);
  await page.waitForTimeout(500);
  expect(await frames(page)).toBeGreaterThan(before + 10);
  await page.screenshot({ path: `${SCREENS}/core-2d.png` });

  // Listening, every orbit lies down on the equator, as the hologram's do.
  expect(await orbitsAligned(page)).toEqual([false, false, false]);
  await holdListening(page);
  await expect.poll(() => orbitsAligned(page)).toEqual([true, true, true]);
  await page.screenshot({ path: `${SCREENS}/core-2d-listening.png`, clip: { x: 610, y: 150, width: 700, height: 700 } });

  // Opened in 2D, the three.js scene is never even downloaded.
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.reload();
  await expect(page.locator('[data-core="2d"]')).toBeVisible();
  await waitForFrames(page, 20);
  expect(requested.filter((url) => /JarvisScene|react-three|three\.module|postprocessing/.test(url))).toEqual([]);
});

test("the core switched off leaves an empty, working desktop; the search turns the 3D back on", async ({ page }) => {
  await start(page);
  await waitForFrames(page);
  const menu = await openCoreTab(page);
  await menu.getByRole("radio", { name: "Desligado" }).click();
  await expect(menu.getByText(/o mínimo de memória/)).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator('[data-core="2d"]')).toHaveCount(0);

  // The backgrounds say why they no longer show.
  await menu.getByRole("tab", { name: "Cores" }).click();
  await expect(menu.getByText("Grid e Matrix aparecem só com o núcleo 3D (Menu avançado → Núcleo).")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/core-off.png` });

  // The empty desktop is still a surface: a click there leaves no window focused.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "clock", open: true }));
  const focused = page.locator("[data-window][data-focused]");
  await expect(focused).toHaveCount(1);
  await page.mouse.click(1500, 500);
  await expect(focused).toHaveCount(0);

  await page.keyboard.press("/");
  await page.keyboard.type("nucleo 3d");
  await expect(page.getByRole("option", { name: /Núcleo: Holograma 3D/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect.poll(async () => (await coreSaved(page)).mode).toBe("3d");
  const before = await frames(page);
  await page.waitForTimeout(500);
  expect(await frames(page)).toBeGreaterThan(before + 10);
});

test.describe("from a fresh start", () => {
  // As on a fresh install, the boot screen plays (the config turns it off for the other tests).
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const mode of ["2d", "off"] as const) {
    test(`with the core ${mode === "2d" ? "in 2D" : "off"}, the boot screen still plays and hands over`, async ({ page }) => {
      await page.addInitScript((core) => {
        localStorage.setItem("jarvis.boot", '{"enabled":true,"sound":false}');
        localStorage.setItem("jarvis.core", JSON.stringify({ mode: core }));
      }, mode);
      await page.goto("/");
      const boot = page.getByTestId("boot");
      await expect(boot).toBeVisible();
      // It types its POST: the first frame went out without any hologram.
      await expect(boot).toContainText(/BIOS v\d+\.\d+\.\d+/);
      await page.keyboard.press("Space");
      await expect(boot).toBeHidden({ timeout: 8000 });
      await expect(page.getByRole("navigation", { name: "Quick actions" })).toBeVisible();
      await expect(page.locator("canvas")).toHaveCount(0);
      if (mode === "2d") {
        // The rings power on after the boot.
        const core = page.locator('[data-core="2d"] > div');
        await expect
          .poll(() => core.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a), { timeout: 5000 })
          .toBeCloseTo(1, 2);
      }
    });
  }
});
