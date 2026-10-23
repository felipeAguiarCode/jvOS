import { expect, test } from "@playwright/test";
import { DOCK_CLIP, DOCK_RESERVE, frames, measureHologram, SCREENS, waitForFrames } from "./helpers";

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3440, height: 1440 },
];

for (const viewport of VIEWPORTS) {
  test(`composition at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?quality=high");
    await waitForFrames(page);
    await page.waitForTimeout(1800); // dock entrance animation

    const dock = page.getByRole("navigation", { name: "Quick actions" });
    await expect(dock).toBeVisible();
    const dockBox = (await dock.boundingBox())!;
    expect(Math.abs(dockBox.x + dockBox.width / 2 - viewport.width / 2)).toBeLessThan(2);
    const bottomGap = viewport.height - (dockBox.y + dockBox.height);
    expect(bottomGap).toBeGreaterThanOrEqual(20);
    expect(bottomGap).toBeLessThanOrEqual(32);

    // Nothing but the hologram and the dock: no visible text on screen.
    expect(await page.evaluate(() => document.body.innerText.trim())).toBe("");

    await page.screenshot({ path: `${SCREENS}/layout-${viewport.width}x${viewport.height}.png` });

    const box = await measureHologram(page);
    const side = Math.max(box.right - box.left, box.bottom - box.top) + 40;
    await page.screenshot({
      path: `${SCREENS}/core-${viewport.width}x${viewport.height}.png`,
      clip: { x: (box.left + box.right - side) / 2, y: (box.top + box.bottom - side) / 2, width: side, height: side },
    });
    const usable = viewport.height - DOCK_RESERVE;
    const share = (box.bottom - box.top) / usable;
    console.log(
      `${viewport.width}x${viewport.height}: hologram ${box.right - box.left}x${box.bottom - box.top}px, ` +
        `${(share * 100).toFixed(1)}% of usable height, lit pixels ${(box.litShare * 100).toFixed(1)}%`,
    );
    expect(Math.abs((box.left + box.right) / 2 - viewport.width / 2)).toBeLessThan(viewport.width * 0.03);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
    expect(box.bottom).toBeLessThan(dockBox.y - 8); // never reaches the dock
  });
}

test("renderer and frame rate", async ({ page }) => {
  await page.goto("/");
  await waitForFrames(page);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  const start = await frames(page);
  await page.waitForTimeout(3000);
  const fps = ((await frames(page)) - start) / 3;
  const quality = await page.evaluate(() => window.__JARVIS__?.quality);
  console.log(`renderer: ${renderer} — ~${fps.toFixed(0)} fps at 1280x720 (quality ${quality})`);
});

test("dock hover, tooltip and click feedback", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitForFrames(page);
  await page.waitForTimeout(1800);

  const vscode = page.getByRole("button", { name: "VS Code" });
  await vscode.hover();
  await expect(page.getByRole("status").filter({ hasText: "VS Code" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/dock-hover.png`, clip: DOCK_CLIP });

  // Launching programs needs the desktop app; in a browser the dock says so.
  await vscode.click();
  await expect(page.getByText("Disponível no app desktop")).toBeVisible();
  await expect(page.getByText("Disponível no app desktop")).toBeHidden({ timeout: 4000 });

  // Widgets (and Apps) open a launcher instead of a notice.
  const widgets = page.getByRole("button", { name: "Widgets", exact: true });
  await widgets.click();
  const launcher = page.getByRole("dialog", { name: "Menu de widgets" });
  await expect(launcher).toBeVisible();
  await expect(widgets).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/dock-launcher.png`, clip: { x: 560, y: 600, width: 800, height: 480 } });
  await page.keyboard.press("Escape");
  await expect(launcher).toBeHidden();
  await expect(widgets).toHaveAttribute("aria-pressed", "false");

  expect(page.context().pages()).toHaveLength(1);
});
