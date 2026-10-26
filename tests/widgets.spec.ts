import { expect, test, type Locator, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

type Check = (widget: Locator) => Promise<void>;

interface Case {
  kind: string;
  title: string;
  /** The option turned off, and what must be gone after it. */
  option: string;
  key: string;
  gone: Check;
  /** The same thing, there by default. */
  shown: Check;
}

const CASES: Case[] = [
  {
    kind: "clock",
    title: "Relógio",
    option: "Fuso horário",
    key: "zone",
    shown: (widget) => expect(widget).toContainText("fuso"),
    gone: (widget) => expect(widget).not.toContainText("fuso"),
  },
  {
    kind: "pomodoro",
    title: "Pomodoro",
    option: "Atalhos",
    key: "hints",
    shown: (widget) => expect(widget.getByRole("button", { name: "Reiniciar", exact: true })).toBeVisible(),
    gone: (widget) => expect(widget.getByRole("button", { name: "Reiniciar", exact: true })).toBeHidden(),
  },
  {
    kind: "calculator",
    title: "Calculadora",
    option: "Teclado",
    key: "keypad",
    shown: (widget) => expect(widget.getByRole("button", { name: "Limpar" })).toBeVisible(),
    gone: (widget) => expect(widget.getByRole("button", { name: "Limpar" })).toBeHidden(),
  },
  {
    kind: "tape",
    title: "Fita",
    option: "Nome da playlist",
    key: "label",
    shown: (widget) => expect(widget.getByTestId("tape-widget")).toContainText("LADO A"),
    gone: async (widget) => {
      // The station's name leaves the label; the side stays.
      const label = (await widget.getByTestId("tape-widget").textContent())!.split("\n")[2];
      expect(label.replace(/[│ ]/g, "")).toBe("LADOAC90");
    },
  },
  {
    kind: "miniplayer",
    title: "Mini player",
    option: "Controles",
    key: "controls",
    shown: (widget) => expect(widget.getByRole("button", { name: "Música anterior" })).toBeVisible(),
    gone: (widget) => expect(widget.getByRole("button", { name: "Música anterior" })).toHaveCount(0),
  },
  {
    kind: "battery",
    title: "Bateria",
    option: "Porcentagem",
    key: "percent",
    // Headless browsers may have no Battery API: then only the menu itself is checked. The big
    // number, not the bar's own label (which reads "100%" too on a full battery).
    shown: async (widget) => {
      if (!(await widget.textContent())?.includes("Indisponível")) await expect(widget.locator("div", { hasText: /^\d+%$/ })).toBeVisible();
    },
    gone: (widget) => expect(widget.locator("div", { hasText: /^\d+%$/ })).toHaveCount(0),
  },
];

const saved = (page: Page, kind: string) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), `jarvis.widget.${kind}`);

async function open(page: Page, kind: string, title: string) {
  await page.evaluate((target) => window.__JARVIS__!.voiceWindow({ kind: target as never, open: true }), kind);
  const widget = page.getByRole("dialog", { name: title, exact: true });
  await expect(widget).toBeVisible();
  await page.waitForTimeout(350); // entrance animation
  return widget;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("jarvis.widget.") || key === "jarvis.desktop") localStorage.removeItem(key);
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page, 10);
});

for (const item of CASES) {
  test(`${item.title}: right click turns parts of the widget off, and it stays so`, async ({ page }) => {
    const widget = await open(page, item.kind, item.title);
    await item.shown(widget);

    await widget.click({ button: "right" });
    const menu = page.getByRole("menu", { name: `Opções do widget ${item.title}` });
    await expect(menu).toBeVisible();
    const option = menu.getByRole("menuitemcheckbox", { name: item.option });
    await expect(option).toHaveAttribute("aria-checked", "true");
    if (item.kind === "clock") await page.screenshot({ path: `${SCREENS}/widget-menu.png` });
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "false");
    await item.gone(widget);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect.poll(async () => (await saved(page, item.kind))[item.key]).toBe(false);

    await page.reload();
    const reopened = page.getByRole("dialog", { name: item.title, exact: true });
    await expect(reopened).toBeVisible();
    await item.gone(reopened);
    await reopened.click({ button: "right" });
    await expect(menu.getByRole("menuitemcheckbox", { name: item.option })).toHaveAttribute("aria-checked", "false");
  });
}

test("keys pressed in a widget's menu stay in the menu", async ({ page }) => {
  const widget = await open(page, "pomodoro", "Pomodoro");
  await widget.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Opções do widget Pomodoro" });
  await expect(menu.getByRole("menuitemcheckbox", { name: "Fase" })).toBeFocused();
  // Arrows walk the items; Space ticks one and must not start the timer (Space's shortcut there).
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Barra de progresso" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Barra de progresso" })).toHaveAttribute("aria-checked", "false");
  await expect(widget.getByRole("progressbar", { name: "Progresso da fase" })).toHaveCount(0);
  await expect(widget.getByRole("button", { name: "Iniciar", exact: true })).toBeVisible();
  // Esc closes the menu and gives the focus back to the widget.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(widget.locator("[tabindex='0']").first()).toBeFocused();
});

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Presses at (x, y), moves by (dx, dy) in small steps and lets go. */
async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350); // the snap release eases into place
}

/** Moved by about (dx, dy): the edges and the centre may pull it a few pixels. */
async function expectMoved(widget: Locator, from: { x: number; y: number }, dx: number, dy: number) {
  const to = await box(widget);
  expect(Math.abs(to.x - (from.x + dx))).toBeLessThanOrEqual(24);
  expect(Math.abs(to.y - (from.y + dy))).toBeLessThanOrEqual(24);
}

test("a widget drags from anywhere on it, and its buttons still click", async ({ page }) => {
  const widget = await open(page, "pomodoro", "Pomodoro");
  const start = widget.getByRole("button", { name: "Iniciar", exact: true });

  // The body, below the bar: it moves, and keeps the focus the press gave it (its keys still work).
  let from = await box(widget);
  await dragFrom(page, from.x + from.width / 2, from.y + 60, 420, 200);
  await expectMoved(widget, from, 420, 200);
  await expect(widget.locator("[tabindex='0']").first()).toBeFocused();

  // Grabbed by a button: it moves, and the button is not pressed on the way out.
  from = await box(widget);
  const button = await box(start);
  await dragFrom(page, button.x + button.width / 2, button.y + button.height / 2, 140, -90);
  await expectMoved(widget, from, 140, -90);
  await expect(start).toBeVisible();

  // A press that stays put is a click.
  from = await box(widget);
  await start.click();
  await expect(widget.getByRole("button", { name: "Pausar", exact: true })).toBeVisible();
  expect(await box(widget)).toEqual(from);
});

test("sliders inside a widget, and the apps' content, keep the pointer", async ({ page }) => {
  const player = await open(page, "miniplayer", "Mini player");
  let from = await box(player);
  const slider = await box(player.getByRole("slider", { name: "Posição na música" }));
  await dragFrom(page, slider.x + slider.width / 2, slider.y + slider.height / 2, 120, 120);
  expect(await box(player)).toEqual(from);

  const app = await open(page, "markdown", "Jarvis Mark");
  from = await box(app);
  await dragFrom(page, from.x + from.width / 2, from.y + from.height / 2, -200, 100);
  expect(await box(app)).toEqual(from);
});
