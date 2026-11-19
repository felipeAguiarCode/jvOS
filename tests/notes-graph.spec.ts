import { expect, test, type Page } from "@playwright/test";
import type { Note } from "../src/lib/notesArea";
import { backlinks, buildGraph, createSimulation, linkedMarkdown, neighbours, parseLinks, parseNotesGraph, parseTags, readHref, resolveLink } from "../src/lib/notesGraph";
import { PLAIN_SETTINGS, waitForFrames } from "./helpers";

// The notes graph (.specs/features/notes-graph/spec.md): [[links]], #tags, backlinks and the 3D
// view, over the in-memory notes folder of notes-area.spec.ts.

const FOLDER = "C:\\JARVIS\\Notas";
// Later in the seed is newer on "disk".
const FILES: Record<string, string> = {
  "Ideias.md": "Ideias soltas\n\nFalar com a Ana sobre o [[Projeto Órion]]. #projeto\n",
  "2026-11-17 Reunião.md": "# Reunião\n\nVer [[Ideias]] e `[[código]]`.\n\n#projeto #trabalho\n",
  "Plano.md": "Baseado em [[reuniao|a reunião de segunda]] e em [[Ideias]].\n\n```\n[[nada]] #nada\n```\n",
};

const note = (path: string, content: string | null, modified: number): Note => ({ path, title: path.replace(/\.md$/, ""), modified, size: content?.length ?? 0, content });
const NOTES = Object.entries(FILES).map(([path, content], index) => note(path, content, 1000 + index));

const titles = (page: Page) => page.locator("[data-testid=note-item] [data-note-title]");
const titleField = (page: Page) => page.getByRole("textbox", { name: "Título da nota" });
const preview = (page: Page) => page.getByTestId("note-preview");
const graph = (page: Page) => page.getByTestId("notes-graph");
const graphButton = (page: Page) => page.getByRole("button", { name: "Grafo", exact: true });
const search = (page: Page) => page.getByRole("searchbox", { name: "Buscar notas" });
const onDisk = (page: Page, name: string) => page.evaluate((path) => window.__JARVIS_FS_FAKE__!.read(path), `${FOLDER}\\${name}`);
const frames = (page: Page) => page.evaluate(() => window.__JARVIS_GRAPH__?.frames ?? 0);
const spots = (page: Page) => page.evaluate(() => window.__JARVIS_GRAPH__?.nodes() ?? []);
const sent = (page: Page) => page.evaluate(() => window.__JARVIS_GRAPH__?.sent ?? 0);
const travelling = (page: Page) => page.evaluate(() => window.__JARVIS_GRAPH__?.impulses() ?? 0);
/** The list of every node is built when asked for, from the keyboard. */
async function listNodes(page: Page) {
  const list = page.getByRole("navigation", { name: "Nós do grafo" });
  await list.getByRole("button", { name: "Listar os nós do grafo" }).focus();
  await page.keyboard.press("Enter");
  await expect(list.getByRole("button", { name: "Esconder a lista de nós" })).toBeVisible();
  return list.getByRole("listitem").getByRole("button");
}

async function start(page: Page, sources: string[] = []) {
  await page.addInitScript(
    ([folder, seed, read]) => {
      window.__JARVIS_ASSISTANT__ = { reply: "Está nas suas notas.", delayMs: 20, sources: read };
      window.__JARVIS_FS__ = { projects: { [folder]: { files: seed, git: false } } };
    },
    [FOLDER, FILES, sources] as const,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  // StrictMode writes the stored values back as the app mounts: the seeds go in after that.
  await waitForFrames(page, 10);
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.assistant", "jarvis.conversations", "jarvis.notesArea", "jarvis.notesGraph"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
    localStorage.setItem("jarvis.chatMode", JSON.stringify({ mode: "chat", section: "notes", speak: false }));
  }, PLAIN_SETTINGS);
  await page.reload();
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião", "Ideias", "Plano"]);
}

test("notes-graph helpers", () => {
  expect(parseLinks("Ver [[Ideias]], [[ Plano  B |o plano]] e [[Reunião#pauta]]. [[ ]] [[aberto")).toEqual([
    { target: "Ideias", text: "Ideias" },
    { target: "Plano B", text: "o plano" },
    { target: "Reunião", text: "Reunião" },
  ]);
  expect(parseLinks("`[[em código]]`\n```\n[[num bloco]]\n```\n[[fora]]")).toEqual([{ target: "fora", text: "fora" }]);

  expect(parseTags("#Projeto no começo, #trabalho/2026 e #projeto de novo.\n# Título\n#123 texto#ancora https://x.dev/#a [link](#secao)\n`#codigo`")).toEqual(["projeto", "trabalho/2026"]);

  expect(resolveLink("ideias", NOTES)).toBe("Ideias.md");
  expect(resolveLink("REUNIAO", NOTES)).toBe("2026-11-17 Reunião.md");
  expect(resolveLink("2026-11-17 reunião", NOTES)).toBe("2026-11-17 Reunião.md");
  expect(resolveLink("nada", NOTES)).toBeNull();
  expect(resolveLink("  ", NOTES)).toBeNull();
  // Of two notes the name fits, the latest.
  expect(resolveLink("reunião", [...NOTES, note("2026-11-18 Reunião.md", "", 5000)])).toBe("2026-11-18 Reunião.md");

  const built = buildGraph(NOTES);
  expect(built.nodes.map((node) => `${node.kind} ${node.label} ${node.degree}`)).toEqual([
    "note Plano 2",
    "note 2026-11-17 Reunião 4",
    "note Ideias 4",
    "tag #projeto 2",
    "tag #trabalho 1",
    "missing Projeto Órion 1",
  ]);
  expect(built.edges.map((edge) => `${built.nodes[edge.source].label} ${edge.kind} ${built.nodes[edge.target].label}`)).toEqual([
    "Plano link 2026-11-17 Reunião",
    "Plano link Ideias",
    "2026-11-17 Reunião link Ideias",
    "2026-11-17 Reunião tag #projeto",
    "2026-11-17 Reunião tag #trabalho",
    "Ideias link Projeto Órion",
    "Ideias tag #projeto",
  ]);
  expect(built.hidden).toBe(0);
  expect(backlinks(built, "Ideias.md").map((node) => node.label)).toEqual(["Plano", "2026-11-17 Reunião"]);
  expect(backlinks(built, "Plano.md")).toEqual([]);
  expect(neighbours(built)[3]).toEqual([1, 2]);
  // A note not read yet has no edges; a link to itself and a repeated one draw nothing more.
  expect(buildGraph([note("A.md", "[[A]] [[B]] [[B]] #x #x", 2), note("B.md", null, 1)]).edges).toHaveLength(2);
  // Over the limit the latest notes stay.
  const limited = buildGraph(NOTES, 2);
  expect(limited.nodes.map((node) => node.label)).toEqual(["Plano", "2026-11-17 Reunião"]);
  expect(limited.hidden).toBe(1);
  expect(limited.edges).toHaveLength(1);

  const linked = linkedMarkdown(FILES["Plano.md"], NOTES);
  expect(linked).toContain("[a reunião de segunda](#note=reuniao)");
  expect(linked).toContain("[Ideias](#note=Ideias)");
  expect(linked).toContain("```\n[[nada]] #nada\n```");
  expect(linkedMarkdown("Ver [[Projeto Órion]] #Projeto e `#tag`", NOTES)).toBe("Ver [Projeto Órion](#note=?Projeto%20%C3%93rion) [#Projeto](#tag=projeto) e `#tag`");
  expect(readHref("#note=?Projeto%20%C3%93rion")).toEqual({ kind: "note", target: "Projeto Órion", missing: true });
  expect(readHref("#note=Ideias")).toEqual({ kind: "note", target: "Ideias", missing: false });
  expect(readHref("#tag=projeto")).toEqual({ kind: "tag", tag: "projeto" });
  expect(readHref("https://exemplo.com")).toBeNull();
  expect(readHref(undefined)).toBeNull();

  // The layout: always the same for the same graph, finite, and it settles.
  const simulation = createSimulation(built.nodes.length, built.edges);
  let steps = 0;
  while (simulation.step() && steps < 1000) steps++;
  expect(steps).toBeLessThan(400);
  expect([...simulation.positions].every(Number.isFinite)).toBe(true);
  const again = createSimulation(built.nodes.length, built.edges);
  while (again.step());
  expect([...again.positions]).toEqual([...simulation.positions]);
  // Linked notes end up closer than unlinked ones (Plano–Reunião against #trabalho–Projeto Órion).
  const distance = (a: number, b: number) => Math.hypot(...[0, 1, 2].map((axis) => simulation.positions[a * 3 + axis] - simulation.positions[b * 3 + axis]));
  expect(distance(0, 1)).toBeLessThan(distance(4, 5));
  expect(createSimulation(1, []).step()).toBe(false);
  expect(createSimulation(0, []).positions).toHaveLength(0);

  expect(parseNotesGraph(1)).toBeNull();
  expect(parseNotesGraph({ open: "sim" })).toEqual({ open: false });
  expect(parseNotesGraph({ open: true })).toEqual({ open: true });
});

test("links and tags are clickable in the rendered note, and backlinks are listed", async ({ page }) => {
  await start(page);
  // The latest note opens: its link with another text leads to the dated note.
  await expect(titleField(page)).toHaveValue("Plano");
  await expect(preview(page).locator("[data-note-link=note]")).toHaveText(["a reunião de segunda", "Ideias"]);
  // What is in a code block stays as written.
  await expect(preview(page).locator("pre")).toContainText("[[nada]] #nada");
  await preview(page).getByRole("link", { name: "a reunião de segunda" }).click();
  await expect(titleField(page)).toHaveValue("2026-11-17 Reunião");
  await expect(preview(page).locator("code")).toHaveText("[[código]]");
  await expect(preview(page).locator("[data-note-tag]")).toHaveText(["#projeto", "#trabalho"]);
  await expect(page.getByTestId("note-backlinks")).toContainText("Plano");

  await preview(page).getByRole("link", { name: "Ideias" }).click();
  await expect(titleField(page)).toHaveValue("Ideias");
  // Who mentions it, each one click away.
  const mentions = page.getByTestId("note-backlinks");
  await expect(mentions.getByRole("button")).toHaveText(["Plano", "2026-11-17 Reunião"]);
  await mentions.getByRole("button", { name: "Plano" }).click();
  await expect(titleField(page)).toHaveValue("Plano");
  await expect(page.getByTestId("note-backlinks")).toHaveCount(0);

  // A tag searches the list for it.
  await titles(page).filter({ hasText: /^Ideias$/ }).click();
  await expect(titleField(page)).toHaveValue("Ideias");
  await preview(page).locator("[data-note-tag=projeto]").click();
  await expect(search(page)).toHaveValue("#projeto");
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião", "Ideias"]);
  await search(page).fill("");

  // A link to a note not written yet makes it.
  const missing = preview(page).locator("[data-note-link=missing]");
  await expect(missing).toHaveText("Projeto Órion");
  expect(await onDisk(page, "Projeto Órion.md")).toBeNull();
  await missing.click();
  await expect(titleField(page)).toHaveValue("Projeto Órion");
  expect(await onDisk(page, "Projeto Órion.md")).toBe("");
  // Now that it exists, the note that named it is its backlink, and the link is a plain one.
  await expect(page.getByTestId("note-backlinks").getByRole("button")).toHaveText(["Ideias"]);
  await page.getByTestId("note-backlinks").getByRole("button", { name: "Ideias" }).click();
  await expect(preview(page).locator("[data-note-link=note]")).toHaveText(["Projeto Órion"]);
});

test("the graph draws the notes and their links in 3D, and a node opens its note", async ({ page }) => {
  await start(page);
  await expect(page.locator("canvas")).toHaveCount(0);

  await graphButton(page).click();
  await expect(graphButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(graph(page)).toBeVisible();
  await expect(page.getByTestId("notes-panel")).toHaveCount(0);
  await expect(page.getByTestId("notes-graph-count")).toHaveText("3 notas · 7 ligações");
  // One WebGL canvas, drawing.
  await expect(page.getByTestId("notes-graph-canvas")).toHaveCount(1);
  expect(await page.getByTestId("notes-graph-canvas").evaluate((canvas: HTMLCanvasElement) => canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null)).toBe(true);
  await expect.poll(() => frames(page)).toBeGreaterThan(5);
  // A node per note, tag and link with no note yet; every one also a button for the keyboard.
  const list = page.getByRole("navigation", { name: "Nós do grafo" });
  await expect(list.getByRole("listitem")).toHaveCount(0);
  await expect(await listNodes(page)).toHaveText([
    "Plano · nota · 2 ligações",
    "2026-11-17 Reunião · nota · 4 ligações",
    "Ideias · nota · 4 ligações",
    "#projeto · tag · 2 ligações",
    "#trabalho · tag · 1 ligação",
    "Projeto Órion · nota a criar · 1 ligação",
  ]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // The busiest nodes are named on the graph.
  await expect(graph(page).locator("[data-index]")).toHaveCount(6);

  // Once the layout settles, a click on a note's node opens it in the editor.
  const where = async () => (await spots(page)).find((spot) => spot.id === "Ideias.md")!;
  await expect
    .poll(async () => {
      const before = await where();
      await page.waitForTimeout(250);
      const after = await where();
      return Math.hypot(after.x - before.x, after.y - before.y);
    }, { timeout: 20_000 })
    .toBeLessThan(6);
  const spot = await where();
  await page.mouse.move(spot.x, spot.y);
  // Under the pointer its name lights up, and the graph holds still.
  await expect(graph(page).locator("[data-index][data-hovered]")).toHaveText(["Ideias"]);
  const held = await where();
  await page.mouse.click(held.x, held.y);
  await expect(page.getByTestId("notes-panel")).toBeVisible();
  await expect(titleField(page)).toHaveValue("Ideias");
  // Out of the graph, its WebGL context goes with it.
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(graphButton(page)).toHaveAttribute("aria-pressed", "false");

  // A tag's node searches the list; the graph stays.
  await graphButton(page).click();
  await (await listNodes(page)).filter({ hasText: /^#trabalho/ }).focus();
  await page.keyboard.press("Enter");
  await expect(search(page)).toHaveValue("#trabalho");
  await expect(titles(page)).toHaveText(["2026-11-17 Reunião"]);
  await expect(graph(page)).toBeVisible();
  await search(page).fill("");

  // Dragging turns it: the nodes move on screen; the wheel zooms.
  const box = (await graph(page).boundingBox())!;
  const before = await where();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2 + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 500, box.y + box.height / 2 + 300, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await where()).x - before.x)).toBeGreaterThan(20);
  // The drag was not a click: the graph is still there.
  await expect(graph(page)).toBeVisible();

  // The choice is kept; a node of a note not written yet makes it.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.notesGraph") ?? "{}").open)).toBe(true);
  await page.reload();
  await expect(graph(page)).toBeVisible();
  await expect(page.getByTestId("notes-graph-count")).toHaveText("3 notas · 7 ligações");
  await (await listNodes(page)).filter({ hasText: /^Projeto Órion/ }).focus();
  await page.keyboard.press("Enter");
  await expect(titleField(page)).toHaveValue("Projeto Órion");
  expect(await onDisk(page, "Projeto Órion.md")).toBe("");
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the graph is alive: impulses run along the links, and hold still under the pointer", async ({ page }) => {
  await start(page);
  await graphButton(page).click();
  await expect(page.getByTestId("notes-graph-canvas")).toHaveCount(1);
  // Neurons fire by themselves: impulses leave, and the graph keeps being drawn.
  await page.mouse.move(40, 500);
  await expect.poll(() => sent(page), { timeout: 15_000 }).toBeGreaterThan(3);
  const drawn = await frames(page);
  await expect.poll(() => frames(page)).toBeGreaterThan(drawn + 5);

  // Under the pointer (someone is reading a node) everything goes still: none on its way, none sent.
  const where = async () => (await spots(page)).find((spot) => spot.id === "Ideias.md")!;
  await expect
    .poll(async () => {
      const before = await where();
      await page.waitForTimeout(250);
      const after = await where();
      return Math.hypot(after.x - before.x, after.y - before.y);
    }, { timeout: 20_000 })
    .toBeLessThan(6);
  const spot = await where();
  await page.mouse.move(spot.x, spot.y);
  await expect(graph(page).locator("[data-index][data-hovered]")).toHaveText(["Ideias"]);
  await expect.poll(() => travelling(page)).toBe(0);
  const held = await sent(page);
  await page.waitForTimeout(1500);
  expect(await sent(page)).toBe(held);
  // Away again, it comes back to life.
  await page.mouse.move(40, 500);
  await expect.poll(() => sent(page), { timeout: 15_000 }).toBeGreaterThan(held);

  // With less motion asked of the system, nothing fires at all.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByTestId("notes-graph-canvas")).toHaveCount(1);
  await expect.poll(() => frames(page)).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  expect(await sent(page)).toBe(0);
});

test("the notes JARVIS read for an answer are named in the chat and fire in the graph", async ({ page }) => {
  await start(page, [`${FOLDER}\\Ideias.md`, "C:\\Windows\\fora.md"]);
  // Nothing read yet: the graph says nothing about it.
  await graphButton(page).click();
  await expect(page.getByTestId("notes-graph-count")).toBeVisible();
  await expect(page.getByTestId("notes-graph-recalled")).toHaveCount(0);

  await page.getByRole("tab", { name: "Conversas" }).click();
  const field = page.getByRole("textbox", { name: "Mensagem para o JARVIS" });
  await field.fill("O que eu anotei sobre o projeto Órion?");
  await field.press("Enter");
  const consulted = page.getByTestId("chat-sources");
  // Only what can be opened is offered: the note, not the file from outside JARVIS's folder.
  await expect(consulted.getByRole("button")).toHaveText(["Ideias"]);
  await expect(page.locator("[data-testid=chat-message][data-role=jarvis]:not([data-live])")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("jarvis.conversations") ?? "{}").conversations ?? []).flatMap((conversation: { items: { sources?: string[] }[] }) => conversation.items).find((entry: { sources?: string[] }) => entry.sources)?.sources ?? null)).toEqual([`${FOLDER}\\Ideias.md`, "C:\\Windows\\fora.md"]);

  // In the graph, the note it read is told apart and named.
  await page.getByRole("tab", { name: "Notas" }).click();
  await expect(page.getByTestId("notes-graph-recalled")).toHaveText("1 nota consultada pelo JARVIS na última resposta");
  await expect(graph(page).locator("[data-index]").filter({ hasText: /^Ideias$/ })).toHaveCount(1);
  await page.mouse.move(40, 500);
  await expect.poll(() => sent(page), { timeout: 15_000 }).toBeGreaterThan(0);

  // Kept with the answer: after a reload the source is still there, and it opens the note.
  await page.reload();
  await page.getByRole("tab", { name: "Conversas" }).click();
  await consulted.getByRole("button", { name: "Ideias" }).click();
  await expect(titleField(page)).toHaveValue("Ideias");
});

test("a node is dragged with the pointer, and its neighbours follow", async ({ page }) => {
  await start(page);
  await graphButton(page).click();
  await expect(page.getByTestId("notes-graph-canvas")).toHaveCount(1);
  // Every node of a small graph has its name under it.
  await expect(graph(page).locator("[data-index]")).toHaveCount(6);
  const where = async (id: string) => (await spots(page)).find((spot) => spot.id === id)!;
  await page.mouse.move(40, 500);
  await expect
    .poll(async () => {
      const before = await where("Ideias.md");
      await page.waitForTimeout(250);
      const after = await where("Ideias.md");
      return Math.hypot(after.x - before.x, after.y - before.y);
    }, { timeout: 20_000 })
    .toBeLessThan(6);

  // Held and pulled aside: it goes with the pointer, and a note linked to it leaves its place too.
  const node = await where("Ideias.md");
  await page.mouse.move(node.x, node.y);
  await expect(graph(page).locator("[data-index][data-hovered]")).toHaveText(["Ideias"]);
  const start_ = await where("Ideias.md");
  const neighbour = await where("Plano.md");
  await page.mouse.down();
  await page.mouse.move(start_.x + 80, start_.y + 30, { steps: 6 });
  await page.mouse.move(start_.x + 160, start_.y + 60, { steps: 6 });
  await expect.poll(async () => Math.hypot((await where("Ideias.md")).x - (start_.x + 160), (await where("Ideias.md")).y - (start_.y + 60))).toBeLessThan(12);
  await expect.poll(async () => Math.hypot((await where("Plano.md")).x - neighbour.x, (await where("Plano.md")).y - neighbour.y), { timeout: 10_000 }).toBeGreaterThan(8);
  await page.mouse.up();
  // A drag is not a click: the note was not opened.
  await expect(graph(page)).toBeVisible();
  await expect(page.getByTestId("notes-panel")).toHaveCount(0);
});
