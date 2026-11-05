import { expect, test } from "./lib/demo";

// 07:30 · Ligando o JARVIS: the BIOS screen, "Bem-vindo", the Wednesday-morning greeting, the dock
// coming in and the 3D hologram at rest.

test("01 · Ligando o JARVIS", async ({ demo, page }) => {
  await demo.start({ at: "2026-11-04T07:30", boot: true, core: "3d" });

  await expect(page.getByTestId("boot")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("boot-startup")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("greeting")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("greeting")).toBeHidden({ timeout: 30_000 });

  // How smooth is the hologram here? (Picks headed vs headless.)
  const before = await page.evaluate(() => window.__JARVIS__!.signals.frames);
  await demo.beat(2000);
  const after = await page.evaluate(() => window.__JARVIS__!.signals.frames);
  console.log(`hologram: ${((after - before) / 2).toFixed(0)} fps`);

  await demo.beat(3000);
});
