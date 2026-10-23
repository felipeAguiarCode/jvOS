import { expect, test } from "@playwright/test";
import { GREETINGS } from "../src/lib/greetings";
import { SCREENS, voiceStatus, waitForFrames } from "./helpers";

// The config turns the boot screen off for every other test; here it plays, as on a fresh install.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
});

test("the BIOS boot types its POST, comes to life with the emblem and a welcome, and reveals the hologram", async ({ page }) => {
  // Watched from the very start: when the startup screen appears, whether the old JARVIS / ONLINE
  // flash ever does, and how far the CRT screen shrinks (switching a tube off collapses it).
  await page.addInitScript(() => {
    const win = window as unknown as { __bootStartup?: number; __bootFlash?: boolean; __minScale?: number };
    win.__minScale = 1;
    new MutationObserver(() => {
      if (!win.__bootStartup && document.querySelector('[data-testid="boot-startup"]')) win.__bootStartup = performance.now();
      if (document.querySelector('[data-testid="boot-flash"]')) win.__bootFlash = true;
    }).observe(document, { childList: true, subtree: true });
    const sample = () => {
      const screen = document.querySelector<HTMLElement>(".crt-screen");
      if (screen && win.__bootStartup) {
        const matrix = new DOMMatrix(getComputedStyle(screen).transform);
        win.__minScale = Math.min(win.__minScale ?? 1, Math.abs(matrix.d), Math.abs(matrix.a));
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/");
  const boot = page.getByTestId("boot");
  await expect(boot).toBeVisible();
  await expect(boot).toContainText(/BIOS v\d+\.\d+\.\d+/);
  await expect(boot).toContainText("Teste de memória");
  await expect(boot).toContainText("C:\\> post --completo", { timeout: 6000 });
  await expect(boot).toContainText("Motor de voz", { timeout: 6000 });
  await expect(boot).toContainText("modo navegador");
  // A plain BIOS: no JARVIS logo or name, no date and time in the corner.
  await expect(boot).not.toContainText(/jarvis|j\.a\.r\.v\.i\.s/i);
  await expect(boot).not.toContainText(/\d{2}\/\d{2}\/\d{4}/);
  await expect(boot.locator("svg")).toHaveCount(0);
  // The top bar waits for the boot to finish, like the dock.
  await expect(page.getByRole("navigation", { name: "Barra superior" })).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENS}/boot-post.png` });

  const startup = page.getByTestId("boot-startup");
  await expect(startup).toBeVisible({ timeout: 20_000 });
  await expect(startup).toHaveText("Bem-vindo");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SCREENS}/boot-startup.png` });

  await expect(boot).toBeHidden({ timeout: 8000 });
  const watched = await page.evaluate(() => {
    const win = window as unknown as { __bootFlash?: boolean; __minScale?: number };
    return { flash: win.__bootFlash ?? false, minScale: win.__minScale ?? 1 };
  });
  expect(watched.flash).toBe(false);
  // It fades out at full size: no tube switching off.
  expect(watched.minScale).toBeGreaterThan(0.9);

  // The planet powers on while JARVIS greets, word by word, inside it.
  const greeting = page.getByTestId("greeting");
  await expect(greeting).toBeVisible();
  // One of several phrases (by time of day, never twice in a row).
  const phrases = GREETINGS.map((variant) => variant.lines.join(" "));
  const first = (await greeting.getByRole("status").textContent()) ?? "";
  expect(phrases).toContain(first);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SCREENS}/boot-ignition.png` });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENS}/boot-greeting.png` });

  await expect(greeting).toBeHidden({ timeout: 8000 });
  await expect(page.getByRole("navigation", { name: "Quick actions" })).toBeVisible();
  // A fresh install has the top bar; apart from it, nothing is written on the screen.
  const bar = page.getByRole("navigation", { name: "Barra superior" });
  await expect(bar).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('nav[aria-label="Barra superior"]')!;
        element.style.display = "none";
        const text = document.body.innerText.trim();
        element.style.display = "";
        return text;
      }),
    )
    .toBe("");
  await page.screenshot({ path: `${SCREENS}/boot-done.png` });

  // The next boot says something else.
  await page.reload();
  await expect(page.getByTestId("boot")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(greeting.getByRole("status")).not.toHaveText(first, { timeout: 8000 });
  expect(phrases).toContain((await greeting.getByRole("status").textContent()) ?? "");
});

test("any key skips without leaking into shortcuts; DEL goes to the settings", async ({ page }) => {
  await page.goto("/");
  const boot = page.getByTestId("boot");
  await expect(boot).toBeVisible();
  await waitForFrames(page, 5);
  // M would toggle the microphone: during the boot it only skips.
  await page.keyboard.press("m");
  await expect(boot).toBeHidden({ timeout: 5000 });
  expect(await voiceStatus(page)).toBe("idle");

  await page.reload();
  await expect(boot).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(boot).toBeHidden({ timeout: 5000 });
  await expect(page.getByRole("dialog", { name: "Configurações" })).toBeVisible();
});

test("the advanced menu turns the boot off and replays it", async ({ page }) => {
  await page.goto("/");
  const boot = page.getByTestId("boot");
  await expect(boot).toBeVisible();
  await page.mouse.click(400, 400); // a click skips too
  await expect(boot).toBeHidden({ timeout: 5000 });

  await page.keyboard.press("Control+Shift+,");
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await menu.getByRole("switch", { name: "Tela de inicialização" }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.boot") ?? "{}").enabled))
    .toBe(false);

  await menu.getByRole("button", { name: "Ver agora" }).click();
  await expect(menu).toBeHidden();
  await expect(boot).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(boot).toBeHidden({ timeout: 5000 });

  await page.reload();
  await waitForFrames(page);
  await expect(boot).toHaveCount(0);
  // No boot, no greeting: the hologram is simply on.
  await expect(page.getByTestId("greeting")).toHaveCount(0);
});
