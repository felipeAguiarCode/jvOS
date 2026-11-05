import { expect, test } from "@playwright/test";

// Not recorded: opens every lazy app once so Vite has transformed their chunks (CodeMirror, xterm,
// the hologram) before the takes. A cold first open would otherwise show "Carregando…" on video.

const APPS = ["markdown", "ide", "music", "shell", "lab", "agent"] as const;

test("warm up Vite", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("jarvis.boot", '{"enabled":false,"sound":false}');
    localStorage.setItem("jarvis.core", '{"mode":"3d"}');
    Object.assign(window, { __JARVIS_FS__: true, __JARVIS_TERMINAL__: true, __JARVIS_ASSISTANT__: { reply: "Pronto.", delayMs: 10 } });
  });
  await page.goto("/?quality=high");
  await page.waitForFunction(() => (window.__JARVIS__?.signals.frames ?? 0) > 10, undefined, { timeout: 120_000 });
  for (const kind of APPS) {
    await page.evaluate((k) => window.__JARVIS__!.voiceWindow({ kind: k, open: true } as never), kind);
    await expect(page.locator(`[data-window="${kind}"]`)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(`[data-window="${kind}"]`).getByText("Carregando", { exact: false })).toHaveCount(0, { timeout: 60_000 });
  }
  // jv_agent's editor tab is a chunk of its own.
  await page.locator('[data-window="agent"]').click();
  await page.keyboard.press("2");
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__JARVIS__!.voiceCloseGroup("all"));
});
