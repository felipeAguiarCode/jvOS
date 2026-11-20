import { expect, test, type Page } from "@playwright/test";
import { matchesNote, noteExcerpt, noteFileName, noteFolder, noteRows, noteTitle, parseNotesArea, untitledName, type Note } from "../src/lib/notesArea";
import { PLAIN_SETTINGS, waitForFrames } from "./helpers";

// The notes area (.specs/features/notes-area/spec.md): Documentos\JARVIS\Notas inside the chat.
// The folder is the in-memory one of src/lib/workspaceFake.ts, where the scripted JARVIS "lives".

const FOLDER = "C:\\JARVIS\\Notas";
// Later in the seed is newer on "disk".
const FILES: Record<string, string> = {
  "2026-11-17 Reunião.md": "# Reunião\n\n- pauta: orçamento\n- próximos passos\n",
  "lista.txt": "não é uma nota",
  "Arquivo/velha.md": "numa subpasta",
  "Ideias.md": "Ideias soltas\n\nUm café com a Ana para falar do projeto Órion.\n",
  "2026-11-19 Anotações.md": "# Anotações de 19/11/2026\n\n- **09:05** comprar café\n",
};

const items = (page: Page) => page.getByTestId("note-item");
const item = (page: Page, title: string) => items(page).filter({ hasText: title });
const titles = (page: Page) => page.locator("[data-testid=note-item] [data-note-title]");
const folders = (page: Page) => page.getByTestId("note-folder");
const folderNames = (page: Page) => page.locator("[data-testid=note-folder] [data-folder-name]");
const folder = (page: Page, name: string) => folders(page).filter({ has: page.locator("[data-folder-name]", { hasText: new RegExp(`^${name}$`) }) });
const titleField = (page: Page) => page.getByRole("textbox", { name: "Título da nota" });
const status = (page: Page) => page.getByTestId("note-status");
const editor = (page: Page) => page.locator("[data-testid=note-editor] .cm-content");
const preview = (page: Page) => page.getByTestId("note-preview");
const onDisk = (page: Page, name: string) => page.evaluate((path) => window.__JARVIS_FS_FAKE__!.read(path), `${FOLDER}\\${name}`);
const fromOutside = (page: Page, name: string, content: string) =>
  page.evaluate(([path, text]) => window.__JARVIS_FS_FAKE__!.external.write(path, text), [`${FOLDER}\\${name}`, content] as const);

async function start(page: Page, { files = FILES, fakes = true }: { files?: Record<string, string>; fakes?: boolean } = {}) {
  await page.addInitScript(
    ([folder, seed, on]) => {
      if (!on) return;
      window.__JARVIS_ASSISTANT__ = { reply: "Certamente.", delayMs: 20 };
      window.__JARVIS_FS__ = { projects: { [folder]: { files: seed, git: false } } };
    },
    [FOLDER, files, fakes] as const,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  // StrictMode writes the stored values back as the app mounts: the seeds go in after that.
  await waitForFrames(page, 10);
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.assistant", "jarvis.conversations", "jarvis.notesArea"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
    localStorage.setItem("jarvis.chatMode", JSON.stringify({ mode: "chat", section: "notes", speak: false }));
  }, PLAIN_SETTINGS);
  await page.reload();
  await expect(page.getByTestId("chat-view")).toBeVisible();
}

/** Types at the end of the note in the editor. */
async function type(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("notes-area helpers", () => {
  expect(noteTitle("2026-11-19 Fatura.md")).toBe("2026-11-19 Fatura");
  expect(noteTitle("Nota.MD")).toBe("Nota");

  expect(noteFileName("  Plano:   fase 2? ")).toBe("Plano fase 2");
  expect(noteFileName('a/b\\c*d"e<f>g|h')).toBe("a b c d e f g h");
  expect(noteFileName("Fim com ponto. ")).toBe("Fim com ponto");
  expect(noteFileName(" ?:* ")).toBeNull();
  expect(noteFileName("x".repeat(120))).toHaveLength(80);

  expect(noteExcerpt("# Reunião\n\n- pauta: **orçamento**\n", "Reunião")).toBe("pauta: orçamento");
  expect(noteExcerpt("\n---\nVer [o site](https://exemplo.com) e [[Outra nota]]\n", "x")).toBe("Ver o site e Outra nota");
  expect(noteExcerpt("# Só o título\n", "Só o título")).toBe("");
  expect(noteExcerpt("# Um\n\n## Dois\n", "x")).toBe("Um");
  expect(noteExcerpt("# Anotações de 19/11/2026\n\n- **09:05** comprar café\n", "2026-11-19 Anotações")).toBe("09:05 comprar café");

  const note = { title: "Ideias", content: "Um café com a Ana, projeto Órion." };
  expect(matchesNote(note, "")).toBe(true);
  expect(matchesNote(note, "IDEIA")).toBe(true);
  expect(matchesNote(note, "orion")).toBe(true);
  expect(matchesNote(note, "fatura")).toBe(false);
  expect(matchesNote({ title: "Sem texto", content: null }, "texto")).toBe(true);

  expect(untitledName([])).toBe("Sem título");
  expect(untitledName(["sem título", "Sem título 2", "Outra"])).toBe("Sem título 3");
  expect(untitledName(["Nova pasta"], "Nova pasta")).toBe("Nova pasta 2");

  expect(noteFolder("Ideias.md")).toBe("");
  expect(noteFolder("Arquivo/2025/antiga.md")).toBe("Arquivo/2025");
  // The list as an explorer: folders first, then notes, by name (numbers as numbers); folded folders hide theirs.
  const file = (path: string, content = ""): Note => ({ path, title: noteTitle(path), modified: 1, size: 0, content });
  const tree = [file("b.md"), file("Nota 10.md"), file("Nota 2.md"), file("Arquivo/velha.md"), file("Arquivo/2025/antiga.md", "bem antiga")];
  const shown = (rows: ReturnType<typeof noteRows>) => rows.map((row) => `${"  ".repeat(row.depth)}${row.kind === "folder" ? `${row.name}/${row.open ? "" : " (fechada)"}` : row.note.title}`);
  expect(shown(noteRows(tree, ["Arquivo", "Arquivo/2025", "Vazia"], [], ""))).toEqual(["Arquivo/", "  2025/", "    antiga", "  velha", "Vazia/", "b", "Nota 2", "Nota 10"]);
  expect(shown(noteRows(tree, ["Arquivo", "Arquivo/2025", "Vazia"], ["Arquivo"], ""))).toEqual(["Arquivo/ (fechada)", "Vazia/", "b", "Nota 2", "Nota 10"]);
  // A folder known only by its note still shows; a search is flat, across every folder.
  expect(shown(noteRows(tree, [], ["Arquivo/2025"], ""))).toEqual(["Arquivo/", "  2025/ (fechada)", "  velha", "b", "Nota 2", "Nota 10"]);
  expect(shown(noteRows(tree, ["Arquivo"], ["Arquivo"], "ANTIGA"))).toEqual(["antiga"]);

  expect(parseNotesArea(3)).toBeNull();
  expect(parseNotesArea({ view: "tudo" })).toEqual({ view: "split", closed: [] });
  expect(parseNotesArea({ view: "read", closed: ["Arquivo", 3, "Arquivo", ""] })).toEqual({ view: "read", closed: ["Arquivo"] });
});

test("the notes are listed as a tree, by name, and searched by title and text", async ({ page }) => {
  await start(page);
  // Only the Markdown files (no .txt): the folder first with what is in it, then the notes, by name.
  await expect(folderNames(page)).toHaveText(["Arquivo"]);
  await expect(titles(page)).toHaveText(["velha", "2026-11-17 Reunião", "2026-11-19 Anotações", "Ideias"]);
  // The latest one opens by itself.
  await expect(item(page, "2026-11-19 Anotações")).toHaveAttribute("data-active", "true");
  await expect(titleField(page)).toHaveValue("2026-11-19 Anotações");
  await expect(editor(page)).toContainText("comprar café");

  const search = page.getByRole("searchbox", { name: "Buscar notas" });
  await search.fill("orion");
  await expect(titles(page)).toHaveText(["Ideias"]);
  await search.fill("REUNI");
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião"]);
  await search.fill("nada disso");
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByTestId("notes-list")).toContainText("Nenhuma nota encontrada");
  await search.fill("");
  await expect(items(page)).toHaveCount(4);

  // The section is remembered; the conversations are one click away.
  await page.getByRole("tab", { name: "Conversas" }).click();
  await expect(page.getByRole("textbox", { name: "Mensagem para o JARVIS" })).toBeVisible();
  await expect(page.getByTestId("notes-panel")).toHaveCount(0);
  await page.getByRole("tab", { name: "Notas" }).click();
  await expect(items(page)).toHaveCount(4);
  await page.reload();
  await expect(items(page)).toHaveCount(4);
});

test("in a browser the notes say they need the desktop app", async ({ page }) => {
  await start(page, { fakes: false });
  await expect(page.getByTestId("notes-list")).toContainText("Disponível no app desktop");
  await expect(page.getByTestId("notes-empty")).toHaveText("Disponível no app desktop");
  await expect(page.getByRole("button", { name: "Nova nota" })).toBeDisabled();
});

test("a note opens, is edited and saves itself; the preview renders it", async ({ page }) => {
  await start(page);
  await item(page, "Ideias").getByRole("button").click();
  await expect(titleField(page)).toHaveValue("Ideias");
  await expect(editor(page)).toContainText("projeto Órion");

  // Typed, then left alone: it is on disk a moment later.
  await type(page, "Mais uma ideia.");
  await expect(status(page)).toHaveText("Salvando…");
  await expect(status(page)).toHaveText("Salvo");
  expect(await onDisk(page, "Ideias.md")).toBe(`${FILES["Ideias.md"]}Mais uma ideia.`);
  // The rendered side follows the text.
  await expect(preview(page)).toContainText("Mais uma ideia.");

  // Leaving at once saves first.
  await type(page, " E outra.");
  await item(page, "2026-11-17 Reunião").getByRole("button").click();
  await expect(titleField(page)).toHaveValue("2026-11-17 Reunião");
  await expect.poll(() => onDisk(page, "Ideias.md")).toBe(`${FILES["Ideias.md"]}Mais uma ideia. E outra.`);

  // Only reading: the Markdown rendered, no editor; the choice is kept.
  await page.getByRole("button", { name: "Ler", exact: true }).click();
  await expect(preview(page).getByRole("heading", { level: 1, name: "Reunião" })).toBeVisible();
  await expect(preview(page).getByRole("listitem")).toHaveText(["pauta: orçamento", "próximos passos"]);
  await expect(page.getByTestId("note-editor")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.notesArea") ?? "{}").view)).toBe("read");
  await page.reload();
  await expect(page.getByRole("button", { name: "Ler", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("note-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Escrever", exact: true }).click();
  await expect(page.getByTestId("note-preview")).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
});

test("notes are created, renamed by their title and deleted to the Recycle Bin", async ({ page }) => {
  await start(page, { files: { ...FILES, "Sem título.md": "" } });
  await expect(items(page)).toHaveCount(5);

  // The first free name; the title waits to be typed over.
  await page.getByRole("button", { name: "Nova nota" }).click();
  await expect(item(page, "Sem título 2")).toHaveAttribute("data-active", "true");
  await expect(titleField(page)).toHaveValue("Sem título 2");
  await expect(titleField(page)).toBeFocused();
  expect(await onDisk(page, "Sem título 2.md")).toBe("");

  // The title names the file, without what Windows refuses.
  await page.keyboard.type("Plano: fase 2?");
  await page.keyboard.press("Enter");
  await expect(titleField(page)).toHaveValue("Plano fase 2");
  await expect(item(page, "Plano fase 2")).toHaveAttribute("data-active", "true");
  expect(await onDisk(page, "Plano fase 2.md")).toBe("");
  expect(await onDisk(page, "Sem título 2.md")).toBeNull();
  await type(page, "Primeira linha do plano.");
  await expect(status(page)).toHaveText("Salvo");
  expect(await onDisk(page, "Plano fase 2.md")).toBe("Primeira linha do plano.");

  // A name another note has, or none at all: nothing is renamed, and Esc takes the name back.
  await titleField(page).fill("ideias");
  await titleField(page).press("Enter");
  await expect(status(page)).toHaveText("Já existe uma nota com esse nome");
  await titleField(page).fill(" ?? ");
  await titleField(page).press("Enter");
  await expect(status(page)).toHaveText("Dê um nome à nota");
  await titleField(page).press("Escape");
  await expect(titleField(page)).toHaveValue("Plano fase 2");
  expect(await onDisk(page, "Plano fase 2.md")).toBe("Primeira linha do plano.");

  // Deleted only after a yes, to the Recycle Bin; the next note takes its place.
  await page.getByRole("button", { name: "Apagar nota" }).click();
  await page.getByRole("group", { name: "Apagar nota?" }).getByRole("button", { name: "Não" }).click();
  await expect(items(page)).toHaveCount(6);
  await page.getByRole("button", { name: "Apagar nota" }).click();
  await page.getByRole("button", { name: "Sim, apagar" }).click();
  await expect(items(page)).toHaveCount(5);
  await expect(item(page, "Plano fase 2")).toHaveCount(0);
  expect(await page.evaluate(() => window.__JARVIS_FS_FAKE__!.log.trash)).toEqual([`${FOLDER}\\Plano fase 2.md`]);
  await expect(titleField(page)).not.toHaveValue("Plano fase 2");
});

test("what JARVIS writes shows up at once; an edit in progress is never overwritten", async ({ page }) => {
  await start(page);
  await item(page, "Ideias").getByRole("button").click();
  await expect(editor(page)).toContainText("projeto Órion");

  // A note written from outside (JARVIS, another editor) joins the list, in its place.
  await fromOutside(page, "2026-11-19 Pesquisa.md", "# Pesquisa\n\nO que achei sobre o assunto.\n");
  await expect(titles(page)).toHaveText(["velha", "2026-11-17 Reunião", "2026-11-19 Anotações", "2026-11-19 Pesquisa", "Ideias"]);
  await expect(titleField(page)).toHaveValue("Ideias");

  // The open note, untouched here, follows the disk.
  await fromOutside(page, "Ideias.md", "Reescrita pelo JARVIS.\n");
  await expect(editor(page)).toHaveText("Reescrita pelo JARVIS.");

  // Typed here and changed there: nothing is written over; the user decides.
  await type(page, "Minha linha.");
  await fromOutside(page, "Ideias.md", "Outra versão do JARVIS.\n");
  const conflict = page.getByRole("alert");
  await expect(conflict).toContainText("A nota mudou no disco.");
  expect(await onDisk(page, "Ideias.md")).toBe("Outra versão do JARVIS.\n");
  await conflict.getByRole("button", { name: "Manter a minha" }).click();
  await expect(conflict).toHaveCount(0);
  await expect.poll(() => onDisk(page, "Ideias.md")).toBe("Reescrita pelo JARVIS.\nMinha linha.");

  await type(page, " E mais.");
  await fromOutside(page, "Ideias.md", "A versão do disco.\n");
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Recarregar" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(editor(page)).toHaveText("A versão do disco.");
  expect(await onDisk(page, "Ideias.md")).toBe("A versão do disco.\n");

  // A note deleted from outside leaves the list and the editor.
  await page.evaluate((path) => window.__JARVIS_FS_FAKE__!.external.remove(path), `${FOLDER}\\Ideias.md`);
  await expect(item(page, "Ideias")).toHaveCount(0);
  await expect(titleField(page)).not.toHaveValue("Ideias");
});

test("dictated words land at the cursor of the open note and are saved", async ({ page }) => {
  await start(page);
  const dictate = (text: string) => page.evaluate((words) => window.__JARVIS__!.dictate(words), text);
  await item(page, "Ideias").getByRole("button").click();
  await expect(editor(page)).toContainText("projeto Órion");
  // No voice engine in a browser: the button says so. The words below stand in for Whisper's.
  await expect(page.getByRole("button", { name: "Ditar (segure para falar)" })).toBeDisabled();

  // At the cursor (the end of the note here), then saved like anything typed.
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await dictate("mais uma linha");
  await expect(editor(page)).toContainText("mais uma linha");
  await expect(status(page)).toHaveText("Salvo");
  expect(await onDisk(page, "Ideias.md")).toBe(`${FILES["Ideias.md"]}mais uma linha `);
  // In the middle of a line, a space comes before it too.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await dictate("e outras");
  await expect.poll(() => onDisk(page, "Ideias.md")).toBe(FILES["Ideias.md"].replace("Ideias soltas", "Ideias soltas e outras ") + "mais uma linha ");
  // Nothing said: nothing goes in.
  await dictate("   ");
  await page.waitForTimeout(300);
  expect(await editor(page).textContent()).not.toMatch(/outras\s{3,}/);

  // With only the rendered note on screen, it goes to the end.
  await page.getByRole("button", { name: "Ler", exact: true }).click();
  await dictate("fim da nota");
  await expect(preview(page)).toContainText("mais uma linha fim da nota");
  await expect.poll(() => onDisk(page, "Ideias.md")).toContain("mais uma linha fim da nota ");

  // Jarvis Mark, on the desktop under the chat, gets none of it; on the desktop, it is his.
  await page.keyboard.press("Control+Shift+J");
  await expect(page.getByTestId("chat-view")).toHaveCount(0);
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "markdown", open: true }));
  const mark = page.getByRole("dialog", { name: "Jarvis Mark" });
  await expect(mark.locator(".cm-content")).toBeVisible();
  expect(await mark.locator(".cm-content").textContent()).not.toContain("fim da nota");
  await mark.locator(".cm-content").click();
  await dictate("ditado no desktop");
  await expect(mark.locator(".cm-content")).toContainText("ditado no desktop");
  await page.keyboard.press("Control+Shift+J");
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await dictate("de volta ao chat");
  await expect(preview(page)).toContainText("de volta ao chat");
  await page.keyboard.press("Control+Shift+J");
  await expect(mark.locator(".cm-content")).not.toContainText("de volta ao chat");
});

test("folders fold, are made, renamed and deleted; a right click shows a note in the Explorer", async ({ page }) => {
  await start(page, { files: { ...FILES, "Arquivo/2025/antiga.md": "bem antiga" } });
  const log = () => page.evaluate(() => window.__JARVIS_FS_FAKE__!.log);
  const plain = (paths: string[]) => paths.map((path) => path.replace(/\//g, "\\"));
  await expect(folderNames(page)).toHaveText(["Arquivo", "2025"]);
  await expect(titles(page)).toHaveText(["antiga", "velha", "2026-11-17 Reunião", "2026-11-19 Anotações", "Ideias"]);

  // Folded: what is inside is out of the list, and it stays so.
  await folder(page, "Arquivo").getByRole("button").click();
  await expect(folderNames(page)).toHaveText(["Arquivo"]);
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião", "2026-11-19 Anotações", "Ideias"]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.notesArea") ?? "{}").closed)).toEqual(["Arquivo"]);
  await page.reload();
  await expect(items(page)).toHaveCount(3);
  // The search still looks inside, and says where each note is.
  const search = page.getByRole("searchbox", { name: "Buscar notas" });
  await search.fill("antiga");
  await expect(titles(page)).toHaveText(["antiga"]);
  await expect(item(page, "antiga").locator("[data-note-folder]")).toHaveText("Arquivo/2025");
  await expect(folders(page)).toHaveCount(0);
  await search.fill("");
  await folder(page, "Arquivo").getByRole("button").click();
  await expect(items(page)).toHaveCount(5);

  // A right click on a note: Esc closes the menu, the item shows the file in the system's explorer.
  await item(page, "velha").click({ button: "right" });
  const noteMenu = page.getByRole("menu", { name: "Ações da nota" });
  await expect(noteMenu.getByRole("menuitem")).toHaveText(["Renomear", "Abrir no Explorer"]);
  await page.keyboard.press("Escape");
  await expect(noteMenu).toHaveCount(0);
  expect((await log()).revealed).toEqual([]);
  await item(page, "velha").click({ button: "right" });
  await noteMenu.getByRole("menuitem", { name: "Abrir no Explorer" }).click();
  await expect(noteMenu).toHaveCount(0);
  expect(plain((await log()).revealed)).toEqual([`${FOLDER}\\Arquivo\\velha.md`]);

  // "Nova pasta" and "Nova nota" make theirs beside the open note; the folder waits for its name.
  await item(page, "velha").getByRole("button").click();
  await expect(titleField(page)).toHaveValue("velha");
  await page.getByRole("button", { name: "Nova pasta", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Nome da pasta" });
  await expect(name).toHaveValue("Nova pasta");
  await name.fill("Projetos");
  await name.press("Enter");
  await expect(folderNames(page)).toHaveText(["Arquivo", "2025", "Projetos"]);
  await page.getByRole("button", { name: "Nova nota", exact: true }).click();
  await expect(titleField(page)).toHaveValue("Sem título");
  expect(await onDisk(page, "Arquivo\\Sem título.md")).toBe("");
  // Renamed by its title, a note stays in its folder.
  await page.keyboard.type("Rascunho");
  await page.keyboard.press("Enter");
  await expect(titleField(page)).toHaveValue("Rascunho");
  expect(await onDisk(page, "Arquivo\\Rascunho.md")).toBe("");
  expect(await onDisk(page, "Rascunho.md")).toBeNull();

  // A folder's own menu; renamed, the note open inside it goes on from its new place.
  await item(page, "velha").getByRole("button").click();
  await expect(titleField(page)).toHaveValue("velha");
  await folder(page, "Arquivo").getByRole("button").click({ button: "right" });
  const folderMenu = page.getByRole("menu", { name: "Ações da pasta" });
  await expect(folderMenu.getByRole("menuitem")).toHaveText(["Nova nota aqui", "Nova pasta aqui", "Renomear", "Abrir no Explorer", "Apagar pasta"]);
  await folderMenu.getByRole("menuitem", { name: "Renomear" }).click();
  await name.fill("Guardado");
  await name.press("Enter");
  await expect(folderNames(page)).toHaveText(["Guardado", "2025", "Projetos"]);
  await expect(titleField(page)).toHaveValue("velha");
  await expect(item(page, "velha")).toHaveAttribute("data-active", "true");
  expect(await onDisk(page, "Guardado\\velha.md")).toBe("numa subpasta");
  expect(await onDisk(page, "Arquivo\\velha.md")).toBeNull();
  // A name another folder has: nothing is renamed, and the reason shows.
  await folder(page, "2025").getByRole("button").click({ button: "right" });
  await folderMenu.getByRole("menuitem", { name: "Renomear" }).click();
  await name.fill("projetos");
  await name.press("Enter");
  await expect(page.getByTestId("notes-list").getByRole("alert")).toHaveText("Já existe uma pasta com esse nome");
  await expect(folderNames(page)).toHaveText(["Guardado", "2025", "Projetos"]);

  // Deleted only when asked twice, with what is in it, to the Recycle Bin.
  await folder(page, "2025").getByRole("button").click({ button: "right" });
  await folderMenu.getByRole("menuitem", { name: "Apagar pasta" }).click();
  await expect(folders(page)).toHaveCount(3);
  await folderMenu.getByRole("menuitem", { name: "Sim, apagar a pasta" }).click();
  await expect(folderNames(page)).toHaveText(["Guardado", "Projetos"]);
  await expect(item(page, "antiga")).toHaveCount(0);
  expect(plain((await log()).trash)).toEqual([`${FOLDER}\\Guardado\\2025`]);

  // The explorer's own actions: every folder folded at once, and the folder read again.
  await expect(page.getByRole("heading", { name: "Notas" })).toBeVisible();
  await expect(items(page).first().locator("[data-note-mark]")).toHaveCount(1);
  await page.getByRole("button", { name: "Recolher pastas" }).click();
  await expect(folderNames(page)).toHaveText(["Guardado"]);
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião", "2026-11-19 Anotações", "Ideias"]);
  await folder(page, "Guardado").getByRole("button").click();
  await expect(folderNames(page)).toHaveText(["Guardado", "Projetos"]);
  await page.getByRole("button", { name: "Atualizar notas" }).click();
  await expect(titles(page)).toHaveText(["Rascunho", "velha", "2026-11-17 Reunião", "2026-11-19 Anotações", "Ideias"]);
});

test("a right click on an answer saves it as a new note or adds it to one", async ({ page }) => {
  await start(page);
  await page.getByRole("tab", { name: "Conversas" }).click();
  const field = page.getByRole("textbox", { name: "Mensagem para o JARVIS" });
  await field.fill("O que é RAG?");
  await field.press("Enter");
  const answer = page.locator("[data-testid=chat-message][data-role=jarvis]:not([data-live])");
  await expect(answer).toHaveCount(1);
  const menu = page.getByRole("menu", { name: "Resposta para as notas" });
  const notice = page.getByTestId("chat-notice");

  // The menu, and Esc: nothing is written.
  await answer.click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Adicionar à nota…", "Salvar como nova nota"]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await onDisk(page, "O que é RAG.md")).toBeNull();

  // A new note, named after the question; the chat stays on screen. Again: the next free name.
  await answer.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Salvar como nova nota" }).click();
  await expect(notice).toHaveText("Resposta salva em “O que é RAG”");
  await expect(menu).toHaveCount(0);
  expect(await onDisk(page, "O que é RAG.md")).toBe("# O que é RAG\n\nCertamente.\n");
  await expect(field).toBeVisible();
  await answer.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Salvar como nova nota" }).click();
  await expect(notice).toHaveText("Resposta salva em “O que é RAG 2”");
  expect(await onDisk(page, "O que é RAG 2.md")).toBe("# O que é RAG 2\n\nCertamente.\n");

  // Added to a note picked from the list, after what it had.
  await answer.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Adicionar à nota…" }).click();
  await menu.getByRole("searchbox", { name: "Filtrar notas" }).fill("idei");
  await expect(menu.getByRole("menuitem")).toHaveText(["Ideias"]);
  await menu.getByRole("menuitem", { name: "Ideias" }).click();
  await expect(notice).toHaveText("Resposta adicionada a “Ideias”");
  expect(await onDisk(page, "Ideias.md")).toBe(`${FILES["Ideias.md"].trimEnd()}\n\nCertamente.\n`);
  // A note in a folder says where it is.
  await answer.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Adicionar à nota…" }).click();
  await menu.getByRole("searchbox", { name: "Filtrar notas" }).fill("velha");
  await expect(menu.getByRole("menuitem")).toHaveText(["velhaArquivo"]);
  await page.keyboard.press("Escape");

  // They are notes like any other.
  await page.getByRole("tab", { name: "Notas" }).click();
  await expect(item(page, "O que é RAG 2")).toHaveCount(1);
});

test("a note is dragged to another folder, and renamed where it is", async ({ page }) => {
  await start(page, { files: { ...FILES, "Arquivo/2025/antiga.md": "bem antiga", "Arquivo/Ideias.md": "outra, com o mesmo nome" } });
  const alert = page.getByTestId("notes-list").getByRole("alert");
  const centre = async (target: ReturnType<typeof item>) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  /** Held and carried, as a person does it, in a few moves; letting go is the caller's. */
  const carry = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 4, from.y + 8, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
  };
  await expect(titles(page)).toHaveText(["antiga", "Ideias", "velha", "2026-11-17 Reunião", "2026-11-19 Anotações", "Ideias"]);

  // Carried over a folder: its name follows the pointer and the folder is lit; let go, it is there.
  await carry(await centre(item(page, "2026-11-17 Reunião")), await centre(folder(page, "2025")));
  await expect(page.getByTestId("note-drag")).toHaveText("2026-11-17 Reunião");
  await expect(folder(page, "2025")).toHaveAttribute("data-over", "true");
  await page.mouse.up();
  await expect(page.getByTestId("note-drag")).toHaveCount(0);
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião", "antiga", "Ideias", "velha", "2026-11-19 Anotações", "Ideias"]);
  expect(await onDisk(page, "Arquivo\\2025\\2026-11-17 Reunião.md")).toBe(FILES["2026-11-17 Reunião.md"]);
  expect(await onDisk(page, "2026-11-17 Reunião.md")).toBeNull();
  // The drag opened nothing: the note that was open (the newest, Arquivo/Ideias) still is.
  await expect(titleField(page)).toHaveValue("Ideias");

  // Let go over a note of another folder, it goes to that note's folder; the open note follows its file.
  await item(page, "antiga").getByRole("button").click();
  await expect(titleField(page)).toHaveValue("antiga");
  await carry(await centre(item(page, "antiga")), await centre(item(page, "velha")));
  await page.mouse.up();
  await expect.poll(() => onDisk(page, "Arquivo\\antiga.md")).toBe("bem antiga");
  expect(await onDisk(page, "Arquivo\\2025\\antiga.md")).toBeNull();
  await expect(item(page, "antiga")).toHaveAttribute("data-active", "true");
  await expect(titleField(page)).toHaveValue("antiga");

  // To the empty room of the list: the notes folder itself.
  const list = (await page.getByTestId("notes-list").boundingBox())!;
  await carry(await centre(item(page, "velha")), { x: list.x + list.width / 2, y: list.y + list.height - 30 });
  await expect(page.getByTestId("notes-list")).toHaveAttribute("data-over", "true");
  await page.mouse.up();
  await expect.poll(() => onDisk(page, "velha.md")).toBe("numa subpasta");
  expect(await onDisk(page, "Arquivo\\velha.md")).toBeNull();

  // A folder that already has a note of that name takes nothing, and says why; Esc lets go of a drag.
  await carry(await centre(items(page).filter({ hasText: /^Ideias$/ }).last()), await centre(folder(page, "Arquivo")));
  await page.mouse.up();
  await expect(alert).toHaveText("Já existe uma nota com esse nome nessa pasta");
  expect(await onDisk(page, "Ideias.md")).toBe(FILES["Ideias.md"]);
  expect(await onDisk(page, "Arquivo\\Ideias.md")).toBe("outra, com o mesmo nome");
  await carry(await centre(item(page, "velha")), await centre(folder(page, "Arquivo")));
  await expect(page.getByTestId("note-drag")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-drag")).toHaveCount(0);
  await page.mouse.up();
  expect(await onDisk(page, "velha.md")).toBe("numa subpasta");
  // A short press is still a click.
  await item(page, "velha").getByRole("button").click();
  await expect(titleField(page)).toHaveValue("velha");

  // Renamed where it is by a double click: it keeps its folder, and stays open.
  const name = page.getByRole("textbox", { name: "Nome da nota" });
  await item(page, "antiga").getByRole("button").dblclick();
  await expect(name).toHaveValue("antiga");
  await name.fill("Bem antiga: 2025?");
  await name.press("Enter");
  await expect(item(page, "Bem antiga 2025")).toHaveAttribute("data-active", "true");
  expect(await onDisk(page, "Arquivo\\Bem antiga 2025.md")).toBe("bem antiga");
  expect(await onDisk(page, "Arquivo\\antiga.md")).toBeNull();
  await expect(titleField(page)).toHaveValue("Bem antiga 2025");
  // …or by the menu; Esc gives up, and a name taken in that folder is refused.
  const noteMenu = page.getByRole("menu", { name: "Ações da nota" });
  await item(page, "velha").click({ button: "right" });
  await noteMenu.getByRole("menuitem", { name: "Renomear" }).click();
  await expect(name).toHaveValue("velha");
  await name.fill("Outro nome");
  await name.press("Escape");
  await expect(name).toHaveCount(0);
  expect(await onDisk(page, "velha.md")).toBe("numa subpasta");
  await item(page, "velha").click({ button: "right" });
  await noteMenu.getByRole("menuitem", { name: "Renomear" }).click();
  await name.fill("ideias");
  await name.press("Enter");
  await expect(alert).toHaveText("Já existe uma nota com esse nome");
  expect(await onDisk(page, "velha.md")).toBe("numa subpasta");
  // A folder's name opens with a double click too.
  await folder(page, "2025").getByRole("button").dblclick();
  const folderName = page.getByRole("textbox", { name: "Nome da pasta" });
  await expect(folderName).toHaveValue("2025");
  await folderName.fill("Antigas");
  await folderName.press("Enter");
  await expect(folderNames(page)).toHaveText(["Arquivo", "Antigas"]);
  expect(await onDisk(page, "Arquivo\\Antigas\\2026-11-17 Reunião.md")).toBe(FILES["2026-11-17 Reunião.md"]);
});
