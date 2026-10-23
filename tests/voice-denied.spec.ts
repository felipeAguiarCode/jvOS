import { expect, test } from "@playwright/test";
import { DOCK_CLIP, frames, SCREENS, useToggleMode, voiceStatus, waitForFrames } from "./helpers";

test("denied microphone shows a discreet error and keeps rendering", async ({ page }) => {
  await useToggleMode(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await waitForFrames(page);

  await page.getByRole("button", { name: /^Voice/ }).click();
  await expect.poll(() => voiceStatus(page)).toBe("error");
  await expect(page.getByText("Acesso ao microfone negado")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/voice-denied.png`, clip: DOCK_CLIP });

  const before = await frames(page);
  await page.waitForTimeout(1000);
  expect(await frames(page)).toBeGreaterThan(before + 10);
});
