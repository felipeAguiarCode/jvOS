import { expect, test, type Locator, type Page } from "@playwright/test";
import { DOCK_RESERVE, frames, PLAIN_SETTINGS, SCREENS, voiceStatus, waitForFrames } from "./helpers";

/** The drag strip at the top of the frameless window: windows never go under it. */
const TOP_SAFE = 28;

const APPS = ["Jarvis Mark", "Jarvis Code", "jv_T4p3", "jv_sh"];

/** Widgets and apps each have a dock item with its own launcher. */
async function openLauncher(page: Page, item: "Widgets" | "Apps" = "Widgets") {
  await page.getByRole("button", { name: item, exact: true }).click();
  const launcher = page.getByRole("dialog", { name: `Menu de ${item.toLowerCase()}` });
  await expect(launcher).toBeVisible();
  return launcher;
}

async function openWindow(page: Page, name: string) {
  const launcher = await openLauncher(page, APPS.includes(name) ? "Apps" : "Widgets");
  await launcher.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();
  await expect(launcher).toBeHidden();
  await page.waitForTimeout(350); // entrance animation
  return dialog;
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Presses on the locator's centre and moves by (dx, dy); the caller releases the mouse. */
async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  const b = await box(locator);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 4 });
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.desktop") ?? "null"));

const zIndex = (page: Page, kind: string) =>
  page.evaluate((k) => Number(getComputedStyle(document.querySelector(`[data-window="${k}"]`)!).zIndex), kind);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.desktop");
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(1000); // dock entrance
});

test("Widgets and Apps open their own launchers, which close with Escape or a click outside", async ({ page }) => {
  const widgets = page.getByRole("button", { name: "Widgets", exact: true });
  const apps = page.getByRole("button", { name: "Apps", exact: true });
  const launcher = await openLauncher(page);
  await expect(page.getByText("Disponível em breve")).toHaveCount(0);
  await page.waitForTimeout(300);
  const l = await box(launcher);
  const w = await box(widgets);
  expect(Math.abs(l.x + l.width / 2 - (w.x + w.width / 2))).toBeLessThan(2);
  expect(l.y + l.height).toBeLessThan((await box(page.getByRole("navigation", { name: "Quick actions" }))).y);
  for (const name of ["Relógio", "Pomodoro", "Bateria", "Calculadora"]) await expect(launcher.getByRole("button", { name })).toBeVisible();
  await expect(launcher.getByRole("button", { name: "Jarvis Code" })).toHaveCount(0);
  await page.screenshot({ path: `${SCREENS}/launcher.png`, clip: { x: 560, y: 600, width: 800, height: 480 } });

  // Apps swaps it for the apps' own menu, above the Apps item.
  await apps.click();
  const appsMenu = page.getByRole("dialog", { name: "Menu de apps" });
  await expect(appsMenu).toBeVisible();
  await expect(launcher).toBeHidden();
  await expect(apps).toHaveAttribute("aria-pressed", "true");
  await expect(widgets).toHaveAttribute("aria-pressed", "false");
  for (const name of APPS) await expect(appsMenu.getByRole("button", { name })).toBeVisible();
  await expect(appsMenu.getByRole("button", { name: "Relógio" })).toHaveCount(0);
  await page.waitForTimeout(300);
  const m = await box(appsMenu);
  const a = await box(apps);
  expect(Math.abs(m.x + m.width / 2 - (a.x + a.width / 2))).toBeLessThan(2);
  await page.screenshot({ path: `${SCREENS}/launcher-apps.png`, clip: { x: 560, y: 600, width: 800, height: 480 } });
  await apps.click();
  await expect(appsMenu).toBeHidden();
  await expect(apps).toHaveAttribute("aria-pressed", "false");

  await openLauncher(page);
  await page.keyboard.press("Escape");
  await expect(launcher).toBeHidden();
  await openLauncher(page);
  await page.mouse.click(200, 200);
  await expect(launcher).toBeHidden();
});

test("a widget opens once, shows the time and closes", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  await expect(clock).toHaveText(/\d{2}:\d{2}:\d{2}/);

  // Picking it again just brings it to the front.
  const launcher = await openLauncher(page);
  await expect(launcher.getByRole("button", { name: "Relógio" })).toHaveAttribute("aria-pressed", "true");
  await launcher.getByRole("button", { name: "Relógio" }).click();
  await expect(page.getByRole("dialog", { name: "Relógio" })).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/widget-clock.png` });

  await clock.getByRole("button", { name: "Fechar Relógio" }).click();
  await expect(clock).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.innerText.trim())).toBe("");
  await expect.poll(async () => (await stored(page)).order).toEqual([]); // debounced save
});

test("windows snap to the edges while dragged and never leave the screen", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  const header = clock.locator("header");
  const start = await box(clock);
  expect(start.y).toBeGreaterThanOrEqual(TOP_SAFE);

  // Released 6 px from the left margin: sticks to it, with a guide while held.
  await dragBy(page, header, 22 - start.x, 120);
  await expect(page.getByTestId("snap-guide")).toHaveCount(1);
  await page.screenshot({ path: `${SCREENS}/window-snap.png` });
  await page.mouse.up();
  await expect(page.getByTestId("snap-guide")).toHaveCount(0);
  const snapped = await box(clock);
  expect(Math.abs(snapped.x - 16)).toBeLessThanOrEqual(1);
  expect(Math.abs(snapped.y - (start.y + 120))).toBeLessThanOrEqual(1);

  // Thrown off the top-left corner: the title bar stays reachable.
  await dragBy(page, header, -600, -600);
  await page.mouse.up();
  const clamped = await box(clock);
  expect(clamped.y).toBeGreaterThanOrEqual(TOP_SAFE);
  expect(clamped.x + clamped.width).toBeGreaterThanOrEqual(48);
});

test("windows resize from the corner down to their minimum size", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  const start = await box(clock);
  await dragBy(page, page.getByTestId("resize-se"), 120, 60);
  await page.mouse.up();
  const grown = await box(clock);
  expect(Math.abs(grown.width - (start.width + 120))).toBeLessThanOrEqual(1);
  expect(Math.abs(grown.height - (start.height + 60))).toBeLessThanOrEqual(1);

  await dragBy(page, page.getByTestId("resize-se"), -900, -900);
  await page.mouse.up();
  const shrunk = await box(clock);
  expect(shrunk.width).toBe(220);
  expect(shrunk.height).toBe(120);
});

test("open windows and their positions survive a reload", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  await dragBy(page, clock.locator("header"), 276, 260);
  await page.mouse.up();
  await openWindow(page, "Bateria");
  const moved = await box(clock);

  await page.waitForTimeout(500); // debounced save
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(400);
  const restored = page.getByRole("dialog", { name: "Relógio" });
  await expect(restored).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Bateria" })).toBeVisible();
  const after = await box(restored);
  expect(Math.abs(after.x - moved.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - moved.y)).toBeLessThanOrEqual(1);
  const saved = await stored(page);
  expect(saved.order).toEqual(["clock", "battery"]);
  expect(saved.rects.clock).toMatchObject({ x: Math.round(after.x), y: Math.round(after.y) });
});

test("the calculator computes from the buttons and from the keyboard", async ({ page }) => {
  const calc = await openWindow(page, "Calculadora");
  const display = calc.getByTestId("calc-display");
  for (const name of ["7", "×", "8", "Igual"]) await calc.getByRole("button", { name, exact: true }).click();
  await expect(display).toHaveText("56");
  await page.screenshot({ path: `${SCREENS}/widget-calculator.png` });
  await calc.getByRole("button", { name: "Limpar" }).click();
  await expect(display).toHaveText("0");

  await display.click(); // focuses the calculator
  await page.keyboard.type("12+3");
  await expect(display).toHaveText("12+3");
  await page.keyboard.press("Enter");
  await expect(display).toHaveText("15");
  await page.keyboard.type("*2");
  await page.keyboard.press("Enter");
  await expect(display).toHaveText("30");
  await page.keyboard.press("Escape");
  await expect(display).toHaveText("0");
  expect(await voiceStatus(page)).toBe("idle");
});

test("the pomodoro counts down, pauses across a reload and rings when a phase ends", async ({ page }) => {
  const pomodoro = await openWindow(page, "Pomodoro");
  const timer = pomodoro.getByRole("timer");
  await expect(timer).toHaveText("25:00");
  await pomodoro.getByRole("button", { name: "Iniciar", exact: true }).click();
  await expect(timer).toHaveText(/24:5\d/, { timeout: 3000 });
  await page.screenshot({ path: `${SCREENS}/widget-pomodoro.png` });
  await pomodoro.getByRole("button", { name: "Pausar", exact: true }).click();
  const paused = (await timer.textContent())!;
  await page.waitForTimeout(1200);
  expect(await timer.textContent()).toBe(paused);

  await page.waitForTimeout(400); // debounced save
  await page.reload();
  await waitForFrames(page);
  await expect(page.getByRole("dialog", { name: "Pomodoro" }).getByRole("timer")).toHaveText(paused);

  // A focus phase ending while the app runs: dock notice, next phase, hologram pulse.
  await page.evaluate(() =>
    localStorage.setItem(
      "jarvis.pomodoro",
      JSON.stringify({ version: 1, phase: "focus", endsAt: Date.now() + 4000, remaining: 0, cycles: 0, durations: { focus: 25, short: 5, long: 15 } }),
    ),
  );
  await page.reload();
  await waitForFrames(page);
  await expect(page.getByText(/Pomodoro: fim do foco/)).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => window.__JARVIS__?.signals.pulse ?? 0)).toBeGreaterThan(0.2);
  await expect(page.getByRole("dialog", { name: "Pomodoro" })).toContainText("Pausa curta");
  await expect(page.getByRole("dialog", { name: "Pomodoro" }).getByRole("timer")).toHaveText("05:00");
});

test("the battery widget shows a level or says it is unavailable", async ({ page }) => {
  const battery = await openWindow(page, "Bateria");
  await expect(battery).toHaveText(/\d{1,3}%|Indisponível neste ambiente/, { timeout: 5000 });
  await page.screenshot({ path: `${SCREENS}/widget-battery.png` });
});

test("the markdown editor previews what is typed, formats with Ctrl+B and keeps the draft", async ({ page }) => {
  const editor = await openWindow(page, "Jarvis Mark");
  const content = editor.locator(".cm-content");
  await expect(content).toBeVisible({ timeout: 15_000 }); // lazy chunk
  await content.click();
  await page.keyboard.type("# Olá JARVIS");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- item");

  const preview = editor.getByTestId("markdown-preview");
  await expect(preview.getByRole("heading", { level: 1, name: "Olá JARVIS" })).toBeVisible();
  await expect(preview.getByRole("listitem")).toHaveText("item");
  const status = editor.getByRole("status");
  await expect(status).toContainText("Ln 3");
  await expect(status).toContainText("●");

  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Control+b");
  await expect(preview.locator("strong")).toHaveText("item");
  await expect(editor.getByRole("button", { name: "Abrir" })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Salvar" })).toHaveAttribute("title", "Disponível no app desktop");
  // Dictation needs the Rust engine: present, but off in a browser.
  await expect(editor.getByRole("button", { name: "Ditar (segure para falar)" })).toBeDisabled();
  await page.screenshot({ path: `${SCREENS}/app-markdown.png` });

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.editor.markdown") ?? "{}").content)).toContain("- **item**");
  await page.reload();
  await waitForFrames(page);
  const reopened = page.getByRole("dialog", { name: "Jarvis Mark" });
  await expect(reopened.getByTestId("markdown-preview").getByRole("heading", { level: 1, name: "Olá JARVIS" })).toBeVisible({ timeout: 15_000 });
  await expect(reopened.getByRole("status")).toContainText("●");
});

test("the code editor highlights the chosen language and remembers it", async ({ page }) => {
  const editor = await openWindow(page, "Jarvis Code");
  const content = editor.locator(".cm-content");
  await expect(content).toBeVisible({ timeout: 15_000 });
  await editor.getByLabel("Linguagem").selectOption("Python");
  const status = editor.getByRole("status");
  await expect(status).toContainText("Python");

  await content.click();
  await page.keyboard.type("def soma(a, b):");
  await page.keyboard.press("Enter");
  await page.keyboard.type("return a + b  # ok");
  await expect.poll(() => editor.locator(".cm-line span").count()).toBeGreaterThan(2); // highlighted tokens
  await expect(status).toContainText("Ln 2");
  await page.screenshot({ path: `${SCREENS}/app-code.png` });

  await page.waitForTimeout(600); // debounced drafts
  await page.reload();
  await waitForFrames(page);
  const reopened = page.getByRole("dialog", { name: "Jarvis Code" });
  await expect(reopened.getByRole("status")).toContainText("Python", { timeout: 15_000 });
  await expect(reopened.locator(".cm-content")).toContainText("def soma");
});

test("the advanced menu tunes snapping, arranges windows and sets a custom hue", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Configurações" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Menu avançado" }).click();
  const menu = page.getByRole("dialog", { name: "Menu avançado" });
  await expect(menu).toBeVisible();
  await expect(settings).toBeHidden();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/advanced-colors.png` });

  // Janelas: snapping off → the window stays exactly where it is dropped.
  await menu.getByRole("tab", { name: "Janelas" }).click();
  await menu.getByRole("switch", { name: "Encaixar nas bordas" }).click();
  await expect.poll(async () => (await stored(page)).prefs.snap).toBe(false);
  await page.screenshot({ path: `${SCREENS}/advanced-windows.png` });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  const start = await box(clock);
  await dragBy(page, clock.locator("header"), 22 - start.x, 100);
  await page.mouse.up();
  expect(Math.abs((await box(clock)).x - 22)).toBeLessThanOrEqual(1);

  // Layout: side by side, then centred — reopened with the shortcut.
  await openWindow(page, "Calculadora");
  await page.keyboard.press("Control+Shift+,");
  await expect(menu).toBeVisible();
  await menu.getByRole("tab", { name: "Layout" }).click();
  await menu.getByRole("button", { name: "Lado a lado" }).click();
  await page.waitForTimeout(450); // eases into place
  const a = await box(page.getByRole("dialog", { name: "Relógio" }));
  const b = await box(page.getByRole("dialog", { name: "Calculadora" }));
  const apart = a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
  expect(apart).toBe(true);
  expect(Math.max(a.y + a.height, b.y + b.height)).toBeLessThanOrEqual(1080 - DOCK_RESERVE - 16 + 1);
  await page.screenshot({ path: `${SCREENS}/advanced-layout.png` });
  await menu.getByRole("button", { name: "Centralizar" }).click();
  await page.waitForTimeout(450);
  const centred = await box(page.getByRole("dialog", { name: "Relógio" }));
  expect(Math.abs(centred.x + centred.width / 2 - 960)).toBeLessThanOrEqual(2);
  expect(Math.abs(centred.y + centred.height / 2 - (TOP_SAFE + 1080 - DOCK_RESERVE) / 2)).toBeLessThanOrEqual(2);

  // Cores: a custom hue recolours the interface and is saved with the settings.
  await menu.getByRole("tab", { name: "Cores" }).click();
  await menu.getByRole("slider", { name: "Matiz" }).evaluate((element: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, "120");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(menu.getByRole("radio", { name: "Personalizada" })).toHaveAttribute("aria-checked", "true");
  const cyan = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-hud-cyan").trim());
  const [r, g, bl] = [1, 3, 5].map((i) => parseInt(cyan.slice(i, i + 2), 16));
  expect(g).toBeGreaterThan(bl); // hue 120 is green
  expect(g).toBeGreaterThan(r);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/advanced-hue.png` });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.settings") ?? "{}"))).toMatchObject({ theme: "custom", accentHue: 120 });
});

test("voice commands open and close windows (engine event stand-in)", async ({ page }) => {
  const voiceWindow = (kind: string, open: boolean) => page.evaluate(([k, o]) => window.__JARVIS__!.voiceWindow({ kind: k as string, open: o as boolean }), [kind, open] as const);
  const notice = page.getByRole("status").filter({ hasText: /Abrindo|Fechando|não está aberto/ });

  await voiceWindow("clock", true);
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeVisible();
  await expect(notice).toHaveText("Abrindo Relógio");
  expect(await page.evaluate(() => window.__JARVIS__!.signals.pulse)).toBeGreaterThan(0.2);

  await voiceWindow("calculator", true);
  await expect(page.getByRole("dialog", { name: "Calculadora" })).toBeVisible();
  // Opening an open window brings it to the front.
  await voiceWindow("clock", true);
  await expect.poll(async () => (await zIndex(page, "clock")) - (await zIndex(page, "calculator"))).toBeGreaterThan(0);

  await voiceWindow("clock", false);
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeHidden();
  await expect(notice).toHaveText("Fechando Relógio");
  await voiceWindow("clock", false);
  await expect(notice).toHaveText("Relógio não está aberto");

  await voiceWindow("calculator", false);
  await expect(page.getByRole("dialog", { name: "Calculadora" })).toBeHidden();
  await voiceWindow("unknown", true); // ignored
  await expect.poll(async () => (await stored(page)).order).toEqual([]);
});

test("voice closes every widget, every app or everything (engine event stand-in)", async ({ page }) => {
  const closeGroup = (group: string) => page.evaluate((g) => window.__JARVIS__!.voiceCloseGroup(g as "widgets" | "apps" | "all"), group);
  const voiceWindow = (kind: string) => page.evaluate((k) => window.__JARVIS__!.voiceWindow({ kind: k, open: true }), kind);
  const notice = page.getByRole("status").filter({ hasText: /Fechando|Nenhum/ });
  const open = async () => ((await stored(page)) ?? { order: [] }).order as string[];

  for (const kind of ["clock", "calculator", "battery", "markdown", "code"]) await voiceWindow(kind);
  await expect.poll(open).toHaveLength(5);

  await closeGroup("widgets");
  await expect(notice).toHaveText("Fechando 3 widgets");
  await expect.poll(open).toEqual(["markdown", "code"]);
  await expect(page.getByRole("dialog", { name: "Jarvis Mark" })).toBeVisible();

  await closeGroup("widgets");
  await expect(notice).toHaveText("Nenhum widget aberto");

  // Said above the Apps item, while the widgets' notice fades out above Widgets.
  await closeGroup("apps");
  const appsNotice = page.getByRole("status").filter({ hasText: "Fechando 2 apps" });
  await expect(appsNotice).toBeVisible();
  const said = await box(appsNotice);
  const appsItem = await box(page.getByRole("button", { name: "Apps", exact: true }));
  expect(Math.abs(said.x + said.width / 2 - (appsItem.x + appsItem.width / 2))).toBeLessThan(2);
  await expect.poll(open).toEqual([]);

  await voiceWindow("clock");
  await voiceWindow("code");
  await expect.poll(open).toHaveLength(2); // spoken commands are seconds apart
  await closeGroup("all");
  await expect(page.getByRole("status").filter({ hasText: "Fechando 2 janelas" })).toBeVisible();
  await expect.poll(open).toEqual([]);
});

test("apps maximise from their button or a double click on the title bar; widgets don't", async ({ page }) => {
  // Fullscreen: the whole viewport, over the dock and the drag strip (no top bar by default).
  const full = { x: 0, y: 0, width: 1920, height: 1080 };
  const windowAt = (x: number, y: number) =>
    page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest("[data-window]")?.getAttribute("data-window") ?? null, [x, y]);
  const expectBox = async (locator: Locator, expected: { x: number; y: number; width: number; height: number }) => {
    await page.waitForTimeout(450); // eases into place
    const actual = await box(locator);
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(1);
  };

  const mark = await openWindow(page, "Jarvis Mark");
  const own = await box(mark);
  await mark.getByRole("button", { name: "Maximizar Jarvis Mark" }).click();
  await expectBox(mark, full);
  await expect(mark.getByTestId("resize-se")).toHaveCount(0);
  // It covers the dock (center bottom) and the top strip.
  expect(await windowAt(960, 1050)).toBe("markdown");
  expect(await windowAt(960, 10)).toBe("markdown");
  await page.screenshot({ path: `${SCREENS}/app-maximized.png` });
  await mark.getByRole("button", { name: "Restaurar Jarvis Mark" }).click();
  await expectBox(mark, own);

  // Double click on the title bar, both ways; it survives a reload.
  await mark.locator("header").dblclick();
  await expectBox(mark, full);
  await expect.poll(async () => (await stored(page)).maximized).toEqual(["markdown"]);
  await page.reload();
  // Behind the maximised app the hologram draws its first frame (which reveals the window) and
  // then rests; it comes back as soon as the app is restored.
  await waitForFrames(page, 0);
  const reloaded = page.getByRole("dialog", { name: "Jarvis Mark" });
  await expectBox(reloaded, full);
  const resting = await frames(page);
  await page.waitForTimeout(800);
  expect(await frames(page)).toBeLessThanOrEqual(resting + 2);
  await reloaded.locator("header").dblclick();
  await expectBox(reloaded, own);
  await expect.poll(() => frames(page)).toBeGreaterThan(resting + 20);

  // Dragging a maximised window brings it back to its own size, under the pointer.
  await reloaded.locator("header").dblclick();
  await expectBox(reloaded, full);
  await page.mouse.move(960, 12); // the title bar, now at the very top
  await page.mouse.down();
  await page.mouse.move(980, 300, { steps: 6 });
  await page.mouse.up();
  const dragged = await box(reloaded);
  expect(Math.abs(dragged.width - own.width)).toBeLessThanOrEqual(1);
  expect(dragged.x).toBeLessThan(980);
  expect(dragged.x + dragged.width).toBeGreaterThan(980);
  await expect.poll(async () => (await stored(page)).maximized).toEqual([]); // debounced save

  // Jarvis Code has the button too; the clock has neither.
  const code = await openWindow(page, "Jarvis Code");
  await expect(code.getByRole("button", { name: "Maximizar Jarvis Code" })).toBeVisible();
  const clock = await openWindow(page, "Relógio");
  await expect(clock.getByRole("button", { name: /Maximizar/ })).toHaveCount(0);
  const clockBox = await box(clock);
  await clock.locator("header").dblclick();
  await expectBox(clock, clockBox);
});

test("a click on the empty desktop leaves no window focused, without moving any", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  const battery = await openWindow(page, "Bateria");
  const focused = page.locator("[data-window][data-focused]");
  await expect(battery).toHaveAttribute("data-focused", "true");
  await expect(focused).toHaveCount(1);

  // Beside the hologram, away from the windows and the dock.
  await page.mouse.click(1500, 500);
  await expect(focused).toHaveCount(0);
  expect(await zIndex(page, "battery")).toBeGreaterThan(await zIndex(page, "clock"));
  await expect(clock).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/desktop-unfocused.png` });

  // Pressing the dock is not pressing the desktop: focus stays where it is.
  await clock.locator("header").click();
  await expect(clock).toHaveAttribute("data-focused", "true");
  await page.getByRole("button", { name: "Widgets", exact: true }).click();
  await expect(clock).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("Escape");

  // A click focuses again; so does opening a window.
  await page.mouse.click(1500, 500);
  await expect(focused).toHaveCount(0);
  // Its lower right corner: the clock now covers its title bar.
  const b = await box(battery);
  await battery.click({ position: { x: b.width - 12, y: b.height - 12 } });
  await expect(battery).toHaveAttribute("data-focused", "true");
  await page.mouse.click(1500, 500);
  const calc = await openWindow(page, "Calculadora");
  await expect(calc).toHaveAttribute("data-focused", "true");
  await expect(focused).toHaveCount(1);
});

test("clicking a window raises it; the dock stays above the windows", async ({ page }) => {
  const clock = await openWindow(page, "Relógio");
  await openWindow(page, "Bateria");
  expect(await zIndex(page, "battery")).toBeGreaterThan(await zIndex(page, "clock"));
  await expect(page.getByRole("button", { name: "Widgets", exact: true })).toHaveAttribute("aria-pressed", "false");

  await clock.locator("header").click();
  expect(await zIndex(page, "clock")).toBeGreaterThan(await zIndex(page, "battery"));

  // Parked over the dock, the window goes under it and the dock keeps working.
  const b = await box(clock);
  await dragBy(page, clock.locator("header"), 810 - b.x, 1000 - 48 - b.y);
  await page.mouse.up();
  const parked = await box(clock);
  expect(parked.y + parked.height).toBeGreaterThan(1080 - DOCK_RESERVE + 20);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Configurações" })).toBeVisible();
  await page.keyboard.press("Escape");
});
