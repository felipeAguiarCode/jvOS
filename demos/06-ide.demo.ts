import { expect, test } from "./lib/demo";

// 11:00 · jv_ide: a project opened, a Rust file with its syntax, a search across the project, the
// outline, and a commit pushed from the Git panel.

test("06 · jv_ide", async ({ demo }) => {
  await demo.start({ at: "2026-11-04T11:00", fakes: { __JARVIS_FS__: true, __JARVIS_TERMINAL__: true } });

  const ide = await demo.open("jv_ide", "Apps");
  await ide.getByRole("button", { name: "Maximizar jv_ide" }).click();
  await demo.beat(1200);
  const panel = (name: string) => ide.getByRole("region", { name, exact: true });

  await ide.getByTestId("ide-app").focus();
  await demo.press("Control+o", 1600);
  await expect(ide.getByRole("tree", { name: "Arquivos do projeto" })).toBeVisible();

  // Quick open.
  await demo.press("Control+p", 600);
  await demo.type("main.rs", 110);
  await demo.beat(600);
  await demo.press("Enter", 2400);
  await expect(ide.locator(".cm-content")).toContainText("fn main");

  // Find in the project, then jump to the match.
  await demo.press("Control+Shift+f", 600);
  await demo.type("reorder_rows", 90);
  await expect(panel("Busca")).toContainText("resultados em 2 arquivos");
  await demo.beat(1400);
  await demo.press("ArrowDown", 700);
  await demo.press("Enter", 1800);

  // The outline follows the file.
  const render = panel("Outline").getByRole("option", { name: "render linha 26" });
  await render.click();
  await demo.beat(1600);

  // Git: stage everything, commit, push.
  const git = panel("Git");
  await git.getByRole("button", { name: "[Stage tudo]" }).click();
  await demo.beat(1200);
  await git.getByRole("button", { name: "[Commit]" }).click();
  await expect(ide.getByRole("dialog", { name: /Commit em main/ })).toBeVisible();
  await demo.beat(500);
  await demo.type("Relatório de reposição revisto", 70);
  await demo.press("Enter", 1500);
  await git.getByRole("button", { name: "[Push]" }).click();
  await expect(git.getByTestId("git-counts")).toHaveText("✱0 ↑0 ↓0");
  await demo.beat(1500);
  await git.getByRole("button", { name: "[Log]" }).click();
  await demo.beat(3500);
});
