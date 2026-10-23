import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

// The browser has no shells: a fake echo one (src/lib/terminal.ts) stands in for ConPTY.
const shell = (page: Page) => page.getByRole("dialog", { name: "jv_sh" });
const tabs = (page: Page) => shell(page).getByRole("tab");
const activeScreen = (page: Page) => shell(page).locator('[role="tabpanel"]:not(.hidden) .xterm-rows');
const log = (page: Page) =>
  page.evaluate(() => window.__JARVIS_TERMINAL_LOG__ ?? { opens: [], writes: [], resizes: [], closes: [] });
const sessions = (page: Page) => shell(page).locator("[data-session]").evaluateAll((panels) => panels.map((panel) => Number(panel.getAttribute("data-session"))));

async function openShell(page: Page) {
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(shell(page)).toBeVisible();
  await expect(activeScreen(page)).toContainText("(simulado)", { timeout: 20_000 });
  // The keyboard goes to the terminal of the tab in front.
  await expect(shell(page).locator('[role="tabpanel"]:not(.hidden) textarea')).toBeFocused();
}

async function run(page: Page, command: string) {
  await page.keyboard.type(command, { delay: 15 });
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    window.__JARVIS_TERMINAL__ = true;
  });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.desktop");
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page);
  await page.waitForTimeout(800);
});

test("the dock's Terminal opens jv_sh on the default profile, and what is typed reaches the shell", async ({ page }) => {
  await openShell(page);
  await expect(page.getByText("Disponível no app desktop")).toHaveCount(0);
  await expect(tabs(page)).toHaveText(["Windows PowerShell"]);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  await run(page, "dir");
  await expect(activeScreen(page)).toContainText("eco: dir");
  await run(page, "git status");
  await expect(activeScreen(page)).toContainText("eco: git status");
  await page.waitForTimeout(300);
  await shell(page).screenshot({ path: `${SCREENS}/shell.png` });

  // The dock item opens it, it does not toggle it: clicked again it just stays in front.
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(shell(page)).toBeVisible();
  await expect(tabs(page)).toHaveCount(1);
});

test("tabs: + opens the default profile, the menu any other; Ctrl+Tab switches and Ctrl+Shift+W closes", async ({ page }) => {
  await openShell(page);
  await shell(page).getByRole("button", { name: "Nova aba" }).click();
  await expect(tabs(page)).toHaveText(["Windows PowerShell", "Windows PowerShell"]);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");

  await shell(page).getByRole("button", { name: "Escolher perfil" }).click();
  const menu = shell(page).getByRole("menu", { name: "Perfis" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Windows PowerShellpadrão", "Git Bash"]);
  await menu.getByRole("menuitem", { name: /Git Bash/ }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(activeScreen(page)).toContainText("Git Bash (simulado)");
  await run(page, "ls");
  await expect(activeScreen(page)).toContainText("eco: ls");

  // Ctrl+Tab wraps around; Ctrl+Shift+T opens another.
  await page.keyboard.press("Control+Tab");
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+Shift+T");
  await expect(tabs(page)).toHaveCount(4);

  // Closing a tab ends its shell.
  const before = await sessions(page);
  await page.keyboard.press("Control+Shift+W");
  await expect(tabs(page)).toHaveCount(3);
  const after = await sessions(page);
  const closed = before.filter((id) => !after.includes(id));
  expect(closed).toHaveLength(1);
  await expect.poll(async () => (await log(page)).closes).toContain(closed[0]);
});

test("maximised by its button or a double click, the shell learns its new size", async ({ page }) => {
  await openShell(page);
  const [session] = await sessions(page);
  const lastSize = async () => (await log(page)).resizes.filter(([id]) => id === session).at(-1)!;
  const [, cols] = await lastSize();

  await shell(page).getByRole("button", { name: "Maximizar jv_sh" }).click();
  await expect.poll(async () => (await lastSize())[1]).toBeGreaterThan(cols + 40);
  const box = (await shell(page).boundingBox())!;
  expect(box.width).toBe(1920);
  await page.screenshot({ path: `${SCREENS}/shell-maximized.png` });

  await shell(page).locator("header").dblclick();
  await expect.poll(async () => (await lastSize())[1]).toBe(cols);
});

test("the terminal keeps the keyboard; the × closes the window and every shell", async ({ page }) => {
  await openShell(page);
  // Ctrl+W deletes a word in a shell; "/" and "m" are just characters there.
  await page.keyboard.press("Control+w");
  await page.keyboard.type("/m");
  await expect(shell(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Busca" })).toHaveCount(0);
  const writes = (await log(page)).writes;
  expect(writes).toContain("\x17");
  expect(writes.join("")).toContain("/m");

  await shell(page).getByRole("button", { name: "Nova aba" }).click();
  await expect(tabs(page)).toHaveCount(2);
  const open = await sessions(page);
  await shell(page).getByRole("button", { name: "Fechar jv_sh" }).click();
  await expect(shell(page)).toHaveCount(0);
  await expect.poll(async () => (await log(page)).closes).toEqual(expect.arrayContaining(open));
});

test("exit closes its tab; an error code keeps it; the last tab closes the window", async ({ page }) => {
  await openShell(page);
  await shell(page).getByRole("button", { name: "Nova aba" }).click();
  await expect(tabs(page)).toHaveCount(2);
  await run(page, "exit");
  await expect(tabs(page)).toHaveCount(1);

  await shell(page).locator('[role="tabpanel"]:not(.hidden)').click();
  await run(page, "exit 3");
  await expect(tabs(page)).toHaveText(["Windows PowerShell (encerrado)"]);
  await expect(activeScreen(page)).toContainText("[processo encerrado: código 3]");
  await shell(page).getByRole("button", { name: /Fechar a aba/ }).click();
  await expect(shell(page)).toHaveCount(0);
});

test("voice and the search open it; the search opens a tab with any profile", async ({ page }) => {
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "shell", open: true }));
  await expect(shell(page)).toBeVisible();
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "shell", open: false }));
  await expect(shell(page)).toHaveCount(0);

  await page.keyboard.press("/");
  await page.keyboard.type("nova aba git bash");
  await expect(page.getByRole("dialog", { name: "Busca" }).locator('[role="option"][aria-selected="true"]')).toContainText("Nova aba: Git Bash");
  await page.keyboard.press("Enter");
  await expect(shell(page)).toBeVisible();
  await expect(tabs(page)).toHaveText(["Git Bash"]);
  await expect(activeScreen(page)).toContainText("Git Bash (simulado)", { timeout: 20_000 });
});
