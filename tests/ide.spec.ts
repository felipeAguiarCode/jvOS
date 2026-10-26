import { expect, test, type Locator, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, voiceStatus, waitForFrames } from "./helpers";

// jv_ide on the in-memory demo projects (src/lib/workspaceFake.ts) and the echo shell.
const GB = 1024 ** 3;
const ROOT = "C:\\projetos\\inventory";
const STATS = {
  cpu: 0.07,
  gpu: 0.1,
  ram: { used: 1 * GB, total: 16 * GB },
  memory: { used: 4 * GB, total: 20 * GB },
  disks: [{ name: "C:", used: 475 * GB, total: 487 * GB }],
  wlan: null,
  net: { down: 12 * 1024, up: 3 * 1024 },
};

const ide = (page: Page) => page.getByRole("dialog", { name: "jv_ide", exact: true });
const panel = (page: Page, name: string) => ide(page).getByRole("region", { name, exact: true });
const tree = (page: Page) => ide(page).getByRole("tree", { name: "Arquivos do projeto" });
const row = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
const tabs = (page: Page) => ide(page).getByRole("tab");
/** A tab by its title; the name also carries "(excluído)" and the unsaved dot. */
const tab = (page: Page, name: string) =>
  ide(page).getByRole("tab", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(excluído\\))?( ●)?$`) });
const status = (page: Page) => ide(page).getByTestId("ide-status");
const content = (page: Page) => ide(page).locator(".cm-content");
const fake = <T>(page: Page, run: (fs: NonNullable<Window["__JARVIS_FS_FAKE__"]>) => T) => page.evaluate(run as never) as Promise<T>;
const read = (page: Page, path: string) => page.evaluate((p) => window.__JARVIS_FS_FAKE__!.read(p), path);
const log = (page: Page) => page.evaluate(() => window.__JARVIS_FS_FAKE__!.log);

async function openIde(page: Page) {
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "ide", open: true }));
  await expect(ide(page).getByTestId("ide-app")).toBeVisible({ timeout: 15_000 });
  await ide(page).getByRole("button", { name: "Maximizar jv_ide" }).click();
  await page.waitForTimeout(450);
  return ide(page);
}

async function openProject(page: Page) {
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+o");
  await expect(panel(page, "Arquivos")).toContainText(ROOT);
  await expect(row(page, "README.md")).toBeVisible();
}

/** Quick open (Ctrl+P) a file by its relative path. */
async function quickOpen(page: Page, rel: string) {
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+p");
  const palette = ide(page).getByRole("dialog", { name: "Abrir arquivo" });
  await expect(palette).toBeVisible();
  await page.keyboard.type(rel);
  await expect(palette.getByRole("option").first()).toHaveText(rel);
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(tab(page, rel.split("/").pop()!)).toHaveAttribute("aria-selected", "true");
}

const labels = (locator: Locator) => locator.evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript((stats) => {
    window.__JARVIS_FS__ = true;
    window.__JARVIS_TERMINAL__ = true;
    window.__JARVIS_SYSTEM__ = stats as never;
  }, STATS);
  await page.goto("/");
  await page.evaluate((settings) => {
    for (const key of ["jarvis.desktop", "jarvis.ide", "jarvis.ide.drafts", "jarvis.editor.code"]) localStorage.removeItem(key);
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page, 10);
});

test("jv_ide opens in termide's layout: menus, system line, panels and the welcome", async ({ page }) => {
  await openIde(page);
  const menubar = ide(page).getByRole("menubar", { name: "Menu do jv_ide" });
  await expect(menubar.getByRole("menuitem")).toHaveText(["Favoritos", "Comandos", "Projetos", "Janelas", "Opções"]);
  const system = ide(page).getByTestId("ide-system");
  await expect(system).toContainText("↓12kb/s ↑3kb/s");
  await expect(system).toContainText("CPU 7%");
  await expect(system).toContainText("RAM 1/16GB");
  await expect(system).toContainText(/\d\d:\d\d/);
  for (const name of ["Editor", "Arquivos", "Git", "Outline"]) await expect(panel(page, name)).toBeVisible();
  await expect(ide(page).getByTestId("ide-welcome")).toContainText("Ctrl+O");
  await expect(status(page)).toContainText("Modo: —");
});

test("Ctrl+O opens a folder: the tree in termide's order, the drive on the status bar, the project in the recents", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  const names = await labels(tree(page).getByRole("treeitem"));
  expect(names.slice(0, 4)).toEqual(["..", "assets", "cmd", "cpp"]);
  expect(names.indexOf("README.md")).toBeGreaterThan(names.indexOf("web"));
  await expect(row(page, "inventory")).toHaveAttribute("aria-expanded", "false");
  await expect(status(page)).toContainText("C: 475/487GB (98%)");
  await page.keyboard.press("Alt+p");
  const menu = ide(page).getByRole("menu", { name: "Projetos" });
  await expect(menu.getByRole("menuitemradio", { name: /inventory/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SCREENS}/app-ide.png` });
});

test("the tree goes by keyboard and mouse; / and m stay in the IDE", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await page.keyboard.press("Alt+2");
  await expect(tree(page)).toBeFocused();
  const voice = await voiceStatus(page);
  await page.keyboard.press("/");
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog", { name: "Busca" })).toHaveCount(0);
  expect(await voiceStatus(page)).toBe(voice);
  await page.waitForTimeout(700); // the type-ahead forgets "/m"

  await page.keyboard.type("inv");
  await expect(row(page, "inventory")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(row(page, "inventory")).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "report.py")).toBeVisible();
  await page.waitForTimeout(700); // the type-ahead forgets
  await page.keyboard.type("rep");
  await expect(row(page, "report.py")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(tab(page, "report.py")).toHaveAttribute("aria-selected", "true");
  await expect(content(page)).toBeFocused();
  await expect(status(page)).toContainText("Sintaxe: Python");

  // A click previews (the next click replaces it); a double click on the tab keeps it.
  await row(page, "models.py").click();
  await expect(tab(page, "models.py")).toBeVisible();
  await expect(ide(page).locator("[data-preview]")).toHaveCount(1);
  await row(page, "suppliers.py").click();
  await expect(tab(page, "models.py")).toHaveCount(0);
  await tab(page, "suppliers.py").dblclick();
  await expect(ide(page).locator("[data-preview]")).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2);

  // ".." walks above the project.
  await row(page, "..").click();
  await expect(row(page, "notas")).toBeVisible();
  await expect(panel(page, "Arquivos")).toContainText("C:\\projetos");
});

test("tabs cycle and close; with no tab left Ctrl+W closes the window", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "inventory/report.py");
  await quickOpen(page, "inventory/models.py");
  await page.keyboard.press("Control+Tab");
  await expect(tab(page, "report.py")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+w");
  await expect(tabs(page)).toHaveCount(1);
  await expect(ide(page)).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect(tabs(page)).toHaveCount(0);
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+Shift+t");
  await expect(tab(page, "models.py")).toBeVisible();
  await page.keyboard.press("Control+w");
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+w");
  await expect(ide(page)).toHaveCount(0);
});

test("each language gets its highlighter, indentation, line ending and encoding", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  const cases: [string, string[]][] = [
    ["inventory/report.py", ["Sintaxe: Python", "Tab: 4", "EOL: LF", "Codificação: UTF-8"]],
    ["web/app.tsx", ["Sintaxe: TSX", "Tab: 2"]],
    ["src/main.rs", ["Sintaxe: Rust", "Tab: 4"]],
    ["cmd/server.go", ["Sintaxe: Go", "Tab: tab"]],
    ["docs/guide.md", ["Sintaxe: Markdown"]],
    ["scripts/build.ps1", ["Sintaxe: PowerShell", "EOL: CRLF"]],
    ["legacy/latin1.txt", ["Sintaxe: Texto", "Codificação: Windows-1252"]],
    ["cs/Program.cs", ["Sintaxe: C#"]],
  ];
  for (const [rel, expected] of cases) {
    await quickOpen(page, rel);
    for (const text of expected) await expect(status(page)).toContainText(text);
  }
  await quickOpen(page, "inventory/report.py");
  await expect.poll(() => content(page).locator(".cm-line span").count()).toBeGreaterThan(20);
  await content(page).click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  await expect(status(page)).toContainText("Pos: 13:1");
  await expect(status(page)).toContainText(/Modo: Texto\s*\|\s*Edição: Sim/);
});

test("binary and huge files are not opened as text", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "assets/logo.png");
  await expect(ide(page).getByTestId("ide-buffer-message")).toContainText("arquivo binário (2 KB)");
  await expect(status(page)).toContainText(/Modo: Binário\s*\|\s*Edição: Não/);
  await row(page, "logs").click();
  await row(page, "big.log").click();
  await expect(ide(page).getByTestId("ide-buffer-message")).toContainText("grande demais (12.0 MB)");
});

test("saving keeps each file's line endings and encoding", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "scripts/build.ps1");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Write-Host 'ok'");
  await expect(ide(page).locator("[data-dirty]")).toHaveCount(1);
  await page.keyboard.press("Control+s");
  await expect(ide(page).locator("[data-dirty]")).toHaveCount(0);
  await expect(status(page)).toContainText("Salvo às");
  const written = (await log(page)).writes.at(-1)!;
  expect(written.path).toBe(`${ROOT}\\scripts\\build.ps1`);
  expect(written.content).toContain("Write-Host 'ok'");
  expect(written.content.replace(/\r\n/g, "")).not.toContain("\n");
  expect(await read(page, `${ROOT}\\scripts\\build.ps1`)).toContain("Write-Host 'ok'");

  await quickOpen(page, "legacy/latin1.txt");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Conclusão: ok");
  await page.keyboard.press("Control+s");
  await expect(ide(page).locator("[data-dirty]")).toHaveCount(0);
  expect((await log(page)).writes.at(-1)!.encoding).toBe("windows1252");
  // Our own save coming back from the watcher is no conflict.
  await page.waitForTimeout(300);
  await expect(ide(page).getByRole("alertdialog", { name: "Conflito com o disco" })).toHaveCount(0);
});

test("each tab keeps its own undo history", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "inventory/report.py");
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("# A");
  await quickOpen(page, "inventory/models.py");
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("# B");
  await tab(page, "report.py").click();
  await expect(content(page)).toContainText("# A");
  await content(page).click();
  await page.keyboard.press("Control+z");
  await expect(content(page)).not.toContainText("# A");
  await tab(page, "models.py").click();
  await expect(content(page)).toContainText("# B");
});

test("panels close with [x], come back from Janelas, take Alt+N and resize", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await panel(page, "Outline").getByRole("button", { name: "Fechar o painel Outline" }).click();
  await expect(panel(page, "Outline")).toHaveCount(0);
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Alt+j");
  const menu = ide(page).getByRole("menu", { name: "Janelas" });
  const outline = menu.getByRole("menuitemcheckbox", { name: /Outline/ });
  await expect(outline).toHaveAttribute("aria-checked", "false");
  await outline.click();
  await expect(panel(page, "Outline")).toBeVisible();
  await page.keyboard.press("Escape");

  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+b");
  await expect(panel(page, "Arquivos")).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await expect(panel(page, "Arquivos")).toBeVisible();
  await page.keyboard.press("Alt+3");
  await expect(panel(page, "Git")).toHaveAttribute("data-focused", "true");

  const before = (await panel(page, "Editor").boundingBox())!;
  const splitter = (await ide(page).getByTestId("ide-split-col-0").boundingBox())!;
  await page.mouse.move(splitter.x + 2, splitter.y + 200);
  await page.mouse.down();
  await page.mouse.move(splitter.x + 160, splitter.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = (await panel(page, "Editor").boundingBox())!;
  expect(after.width - before.width).toBeGreaterThan(140);
});

test("the session comes back after a reload: tabs, cursor, folders, panels and unsaved edits", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "inventory/report.py");
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
  await quickOpen(page, "inventory/models.py");
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("# rascunho ");
  await panel(page, "Outline").getByRole("button", { name: "Fechar o painel Outline" }).click();
  await row(page, "docs").click();
  await expect(row(page, "docs")).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(1300); // drafts and layout are written after a pause

  await page.reload();
  await waitForFrames(page, 0);
  await expect(tab(page, "models.py")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  await expect(tab(page, "report.py")).toBeVisible();
  await expect(ide(page).locator("[data-dirty]")).toHaveCount(1);
  await expect(content(page)).toContainText("# rascunho");
  await expect(panel(page, "Outline")).toHaveCount(0);
  await expect(row(page, "docs")).toHaveAttribute("aria-expanded", "true");
  await tab(page, "report.py").click();
  await expect(status(page)).toContainText("Pos: 9:1");
});

test("changes made outside reload clean tabs and raise a conflict on edited ones", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "inventory/report.py");
  await page.evaluate((path) => window.__JARVIS_FS_FAKE__!.external.write(path, "# reescrito por fora\n"), `${ROOT}\\inventory\\report.py`);
  await expect(content(page)).toHaveText("# reescrito por fora");

  await quickOpen(page, "inventory/models.py");
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("# minha ");
  await page.evaluate((path) => window.__JARVIS_FS_FAKE__!.external.write(path, "# a versão de fora\n"), `${ROOT}\\inventory\\models.py`);
  const conflict = ide(page).getByRole("alertdialog", { name: "Conflito com o disco" });
  await expect(conflict).toContainText("models.py mudou fora do jv_ide");
  await conflict.getByRole("button", { name: "[Comparar]" }).click();
  await expect(tab(page, "models.py (disco ↔ aba)")).toBeVisible();
  await expect(status(page)).toContainText("Sintaxe: Diff");
  await tab(page, "models.py").first().click();
  await conflict.getByRole("button", { name: "[Recarregar]" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(content(page)).toHaveText("# a versão de fora");

  // Deleted under the tab: Ctrl+S puts it back.
  await page.evaluate((path) => window.__JARVIS_FS_FAKE__!.external.remove(path), `${ROOT}\\inventory\\models.py`);
  await expect(tab(page, "models.py")).toContainText("(excluído)");
  await content(page).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate((path) => window.__JARVIS_FS_FAKE__!.exists(path), `${ROOT}\\inventory\\models.py`)).toBe(true);
  await expect(tab(page, "models.py")).not.toContainText("(excluído)");
});

test("the tree creates, renames and sends files to the Recycle Bin", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await row(page, "inventory").click();
  await tree(page).focus();
  await page.keyboard.press("Insert");
  const prompt = ide(page).getByRole("dialog", { name: /Novo arquivo em inventory/ });
  await expect(prompt).toBeVisible();
  await page.keyboard.type("novo.py");
  await page.keyboard.press("Enter");
  await expect(tab(page, "novo.py")).toHaveAttribute("aria-selected", "true");
  expect((await log(page)).created).toContain(`${ROOT}\\inventory\\novo.py`);

  // F2 turns the name into a box on its own row, selected up to the extension.
  await row(page, "novo.py").click();
  await page.keyboard.press("F2");
  const name = row(page, "novo.py").getByRole("textbox", { name: "Novo nome de novo.py" });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("novo.py");
  expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 4]);
  await expect(ide(page).getByRole("dialog", { name: /Renomear/ })).toHaveCount(0);
  await page.keyboard.type("outro");
  await page.keyboard.press("Enter");
  await expect(tab(page, "outro.py")).toBeVisible();
  await expect(row(page, "outro.py")).toHaveAttribute("aria-selected", "true");
  await expect(tree(page)).toBeFocused();
  expect((await log(page)).renames).toContainEqual([`${ROOT}\\inventory\\novo.py`, `${ROOT}\\inventory\\outro.py`]);

  await row(page, "outro.py").click();
  await page.keyboard.press("Delete");
  await expect(ide(page).getByRole("alertdialog", { name: /Mover outro.py para a Lixeira/ })).toBeVisible();
  await page.keyboard.press("s");
  await expect(row(page, "outro.py")).toHaveCount(0);
  expect((await log(page)).trash).toContain(`${ROOT}\\inventory\\outro.py`);
  await expect(tab(page, "outro.py")).toContainText("(excluído)");
});

test("names are edited in place in the tree: Esc, a taken name, clicking away, the menu", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await row(page, "inventory").click();
  await row(page, "models.py").click();

  // Esc gives up and hands the keyboard back to the tree.
  await page.keyboard.press("F2");
  const models = row(page, "models.py").getByRole("textbox");
  await expect(models).toBeFocused();
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await expect(models).toHaveCount(0);
  await expect(row(page, "models.py")).toHaveAttribute("aria-selected", "true");
  await expect(tree(page)).toBeFocused();
  expect((await log(page)).renames).toEqual([]);

  // A taken name is refused and the box stays open for another try.
  await page.keyboard.press("F2");
  await page.keyboard.type("report");
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Já existe um item com esse nome");
  await expect(models).toBeFocused();
  await expect(models).toHaveValue("report.py");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("modelos.py");
  await page.keyboard.press("Enter");
  await expect(row(page, "modelos.py")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "modelos.py")).toBeVisible();

  // Clicking elsewhere keeps what was typed, and the focus stays where it went.
  await row(page, "suppliers.py").click();
  await page.keyboard.press("F2");
  await page.keyboard.type("fornecedores");
  await content(page).click();
  await expect(row(page, "fornecedores.py")).toBeVisible();
  await expect(content(page)).toBeFocused();

  // The right-click menu edits the name the same way.
  await row(page, "README.md").click({ button: "right" });
  await ide(page).getByRole("menu", { name: "Ações do arquivo" }).getByRole("menuitem", { name: /^Renomear/ }).click();
  await expect(row(page, "README.md").getByRole("textbox")).toBeFocused();
  await page.keyboard.type("LEIAME");
  await page.keyboard.press("Enter");
  await expect(row(page, "LEIAME.md")).toBeVisible();

  // So does a double click, on a file or on a folder (which stays as it was).
  await row(page, "LEIAME.md").dblclick();
  const leiame = row(page, "LEIAME.md").getByRole("textbox", { name: "Novo nome de LEIAME.md" });
  await expect(leiame).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(leiame).toHaveCount(0);
  await row(page, "logs").dblclick();
  const logs = row(page, "logs").getByRole("textbox", { name: "Novo nome de logs" });
  await expect(logs).toBeFocused();
  await expect(row(page, "logs")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.type("registros");
  await page.keyboard.press("Enter");
  await expect(row(page, "registros")).toHaveAttribute("aria-selected", "true");

  expect((await log(page)).renames).toEqual([
    [`${ROOT}\\inventory\\models.py`, `${ROOT}\\inventory\\modelos.py`],
    [`${ROOT}\\inventory\\suppliers.py`, `${ROOT}\\inventory\\fornecedores.py`],
    [`${ROOT}\\README.md`, `${ROOT}\\LEIAME.md`],
    [`${ROOT}\\logs`, `${ROOT}\\registros`],
  ]);
});

test("Jarvis Code's open window and unsaved draft move into jv_ide", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("jarvis.desktop", JSON.stringify({ version: 1, rects: {}, order: ["code"], maximized: [], prefs: {} }));
    localStorage.setItem("jarvis.editor.code", JSON.stringify({ version: 1, content: "print('do Jarvis Code')", path: null, language: "Python", savedContent: null }));
  });
  await page.reload();
  await waitForFrames(page, 10);
  await expect(ide(page)).toBeVisible({ timeout: 15_000 });
  await expect(tab(page, "sem título 1")).toBeVisible();
  await expect(content(page)).toContainText("print('do Jarvis Code')");
  expect(await page.evaluate(() => localStorage.getItem("jarvis.editor.code"))).toBeNull();
});

test("the terminal panel opens a shell in the project, keeps its keys and never mixes with jv_sh", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await page.keyboard.press("Control+Backquote");
  const terminal = panel(page, "Terminal 1");
  await expect(terminal).toContainText("Windows PowerShell");
  const screen = terminal.locator(".xterm-rows");
  await expect(screen).toContainText(`PS ${ROOT}>`, { timeout: 15_000 });
  await expect(terminal.locator("textarea")).toBeFocused();
  expect(await page.evaluate(() => window.__JARVIS_TERMINAL_LOG__!.cwds)).toContain(ROOT);
  await page.keyboard.type("dir", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(screen).toContainText("eco: dir");
  // Ctrl+W is the shell's (delete a word), not the tab's or the window's.
  await page.keyboard.press("Control+w");
  await expect(ide(page)).toBeVisible();
  expect(await page.evaluate(() => window.__JARVIS_TERMINAL_LOG__!.writes.join(""))).toContain("\u0017");

  // jv_sh at the same time: each screen shows only its own shell.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "shell", open: true }));
  const shell = page.getByRole("dialog", { name: "jv_sh" });
  const shellScreen = shell.locator('[role="tabpanel"]:not(.hidden) .xterm-rows');
  await expect(shellScreen).toContainText("(simulado)", { timeout: 15_000 });
  await page.keyboard.type("echo do jv_sh", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(shellScreen).toContainText("eco: echo do jv_sh");
  await expect(screen).not.toContainText("do jv_sh");
  await expect(shellScreen).not.toContainText(ROOT);
  await page.keyboard.press("Control+Shift+w");

  // exit closes the panel.
  await terminal.locator(".xterm-screen").click();
  await page.keyboard.type("exit", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(panel(page, "Terminal 1")).toHaveCount(0);
});

test("Ctrl+P finds files fuzzily and opens at a line; Ctrl+Shift+P runs commands", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await page.keyboard.press("Control+p");
  const files = ide(page).getByRole("dialog", { name: "Abrir arquivo" });
  await page.keyboard.type("rprt");
  await expect(files.getByRole("option").first()).toHaveText("inventory/report.py");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("models.py:5");
  await page.keyboard.press("Enter");
  await expect(tab(page, "models.py")).toHaveAttribute("aria-selected", "true");
  await expect(status(page)).toContainText("Pos: 5:1");

  // Recent files first when nothing is typed.
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+p");
  await expect(files.getByRole("option").first()).toContainText("inventory/models.py");
  await expect(files.getByRole("option").first()).toContainText("recente");
  // ">" switches to the commands.
  await page.keyboard.type(">arquivos");
  const commands = ide(page).getByRole("dialog", { name: "Comandos" });
  await expect(commands.getByRole("option").first()).toContainText("Arquivos");
  await expect(commands.getByRole("option").first()).toContainText("Ctrl+B");
  await page.keyboard.press("Enter");
  await expect(panel(page, "Arquivos")).toHaveCount(0);

  await page.keyboard.press("Control+Shift+p");
  await expect(commands).toBeVisible();
  await page.keyboard.type("linha");
  await page.keyboard.press("Enter");
  await expect(ide(page).getByRole("dialog", { name: "Ir para linha" })).toBeVisible();
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Pos: 12:1");
});

test("Ctrl+Shift+F searches the project and opens a match where it is", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await page.keyboard.press("Control+Shift+f");
  const search = panel(page, "Busca");
  const input = search.getByRole("textbox", { name: "Buscar no projeto" });
  await expect(input).toBeFocused();
  await page.keyboard.type("reorder_rows");
  const results = search.getByRole("listbox", { name: "Resultados da busca" });
  await expect(results.getByRole("group", { name: "inventory/report.py" })).toBeVisible();
  await expect(search).toContainText("resultados em 2 arquivos");
  await page.keyboard.press("ArrowDown");
  await expect(tab(page, "report.py")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(content(page)).toBeFocused();
  await expect(status(page)).toContainText("Pos: 9:");

  await input.click();
  await search.getByRole("button", { name: "Expressão regular" }).click();
  await input.fill("def \\w+\\(store");
  await expect(search).toContainText(/\d+ resultados? em 1 arquivo/);
  const last = (await log(page)).searches.at(-1)!;
  expect(last.regex).toBe(true);
});

test("the outline lists the file's symbols, follows the cursor and jumps", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await quickOpen(page, "inventory/report.py");
  const outline = panel(page, "Outline");
  await expect(outline).toContainText("Outline report.py");
  const symbols = outline.getByRole("option");
  await expect(symbols).toHaveText([/f\s*reorder_rows\s*:9/, /f\s*to_csv\s*:18/, /f\s*render\s*:26/]);
  await outline.getByRole("option", { name: "render linha 26" }).click();
  await expect(status(page)).toContainText("Pos: 26:5");
  await expect(outline.getByRole("option", { name: "render linha 26" })).toHaveAttribute("data-current", "true");
  await quickOpen(page, "inventory/models.py");
  await expect(outline.getByRole("option", { name: "Store linha 17" })).toBeVisible();
  await expect(outline.getByRole("option", { name: "total linha 21" })).toContainText("m");
});

test("git: status, stage, commit, push, log and diff", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  const git = panel(page, "Git");
  await expect(git).toContainText("inventory (main)");
  await expect(git.getByTestId("git-counts")).toHaveText("✱3 ↑8 ↓0");
  const changes = git.getByRole("listbox", { name: "Alterações do git" });
  await expect(changes).toContainText("Alterações (2)");
  await expect(changes).toContainText("Em stage (1)");

  await changes.focus();
  await page.keyboard.press("Space");
  await expect(changes).toContainText("Em stage (2)");
  await row(page, "inventory").click();
  await expect(row(page, "suppliers.py")).toHaveAttribute("data-git", "M");

  await git.getByRole("button", { name: "[Stage tudo]" }).click();
  await expect(changes).toContainText("Em stage (3)");
  await git.getByRole("button", { name: "[Commit]" }).click();
  await expect(ide(page).getByRole("dialog", { name: /Commit em main/ })).toBeVisible();
  await page.keyboard.type("Relatório de reposição revisto");
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Commit ");
  await expect(git.getByTestId("git-counts")).toHaveText("✱0 ↑9 ↓0");
  await git.getByRole("button", { name: "[Push]" }).click();
  await expect(git.getByTestId("git-counts")).toHaveText("✱0 ↑0 ↓0");
  expect((await page.evaluate((root) => window.__JARVIS_FS_FAKE__!.repo(root), ROOT))!.pushes).toBe(1);

  await git.getByRole("button", { name: "[Log]" }).click();
  await expect(tab(page, "git log")).toHaveAttribute("aria-selected", "true");
  await expect(content(page)).toContainText("Relatório de reposição revisto");

  await page.evaluate((path) => window.__JARVIS_FS_FAKE__!.external.write(path, "# mudou\n"), `${ROOT}\\config.json`);
  await expect(git.getByTestId("git-counts")).toHaveText("✱1 ↑0 ↓0");
  await git.getByRole("button", { name: "[Diff]" }).click();
  await expect(tab(page, "diff (tudo)")).toHaveAttribute("aria-selected", "true");
  await expect(status(page)).toContainText("Sintaxe: Diff");
  await expect(content(page)).toContainText("+# mudou");
});

test("git: revert, stash and switching branches", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  const git = panel(page, "Git");
  await expect(git.getByTestId("git-counts")).toHaveText("✱3 ↑8 ↓0");

  await git.getByRole("button", { name: "[Stash (0)]" }).click();
  await ide(page).getByRole("menu", { name: "Stash" }).getByRole("menuitem", { name: "Guardar as alterações…" }).click();
  await expect(ide(page).getByRole("dialog", { name: /stash/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(git.getByRole("button", { name: "[Stash (1)]" })).toBeVisible();
  await expect(git.getByTestId("git-counts")).toHaveText("✱0 ↑8 ↓0");
  await git.getByRole("button", { name: "[Stash (1)]" }).click();
  await ide(page).getByRole("menu", { name: "Stash" }).getByRole("menuitem", { name: /Aplicar e remover/ }).click();
  await expect(git.getByTestId("git-counts")).toHaveText("✱3 ↑8 ↓0");

  await git.getByRole("button", { name: "[Reverter tudo]" }).click();
  await expect(ide(page).getByRole("alertdialog", { name: /Reverter tudo/ })).toBeVisible();
  await page.keyboard.press("s");
  await expect(git.getByTestId("git-counts")).toHaveText("✱1 ↑8 ↓0"); // the staged README stays

  await git.getByRole("button", { name: "Branches" }).click();
  await ide(page).getByRole("menu", { name: "Branches" }).getByRole("menuitemradio", { name: /feature\/csv-export/ }).click();
  await expect(git).toContainText("inventory (feature/csv-export)");
});

test("favourites and recent projects", async ({ page }) => {
  await openIde(page);
  await openProject(page);
  await row(page, "docs").click({ button: "right" });
  await ide(page).getByRole("menu", { name: "Ações do arquivo" }).getByRole("menuitem", { name: "Adicionar aos favoritos" }).click();
  await quickOpen(page, "inventory/report.py");
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Alt+f");
  const favourites = ide(page).getByRole("menu", { name: "Favoritos" });
  await expect(favourites.getByRole("menuitem", { name: /▶ \/docs/ })).toBeVisible();
  await favourites.getByRole("menuitem", { name: "Adicionar aos favoritos" }).click();

  // Another project, then back: each keeps its own tabs.
  await page.evaluate(() => window.__JARVIS_FS_FAKE__!.picks.push("C:\\projetos\\notas"));
  await ide(page).getByTestId("ide-app").focus();
  await page.keyboard.press("Control+o");
  await expect(panel(page, "Arquivos")).toContainText("C:\\projetos\\notas");
  await expect(tabs(page)).toHaveCount(0);
  await expect(panel(page, "Git")).toContainText("Não é um repositório git");
  await page.keyboard.press("Alt+p");
  await ide(page).getByRole("menu", { name: "Projetos" }).getByRole("menuitemradio", { name: /inventory/ }).click();
  await expect(panel(page, "Arquivos")).toContainText(ROOT);
  await expect(tab(page, "report.py")).toBeVisible();
  await page.keyboard.press("Alt+f");
  await expect(ide(page).getByRole("menu", { name: "Favoritos" }).getByRole("menuitem", { name: /report\.py/ })).toBeVisible();
});
