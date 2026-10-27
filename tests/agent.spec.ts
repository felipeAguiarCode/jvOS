import { expect, test, type Page } from "@playwright/test";
import { PLAIN_SETTINGS, SCREENS, waitForFrames } from "./helpers";

// jv_agent with the scripted JARVIS (src/lib/assistant.ts) writing the draft, and the fake
// shells (src/lib/terminal.ts) standing in for the jv_sh tab that runs it.
const PATH = "C:\\JARVIS\\Agentes\\revisor-pr.md";
const AGENT = [
  "---",
  "name: revisor-pr",
  "description: Revisa pull requests e aponta riscos",
  "tools: Read, Grep, Glob",
  "model: sonnet",
  "---",
  "Você revisa o diff do pull request atual.",
  "Aponte bugs, riscos e testes que faltam, do mais grave ao menos grave.",
  "",
].join("\n");

const agentWindow = (page: Page) => page.getByRole("dialog", { name: "jv_agent", exact: true });
const card = (page: Page) => agentWindow(page).getByTestId("agent-review");
const action = (page: Page, tool: string, args: Record<string, unknown>) =>
  page.evaluate(([name, input]) => window.__JARVIS__!.action(name, input), [tool, args] as const);
const terminalLog = (page: Page) => page.evaluate(() => window.__JARVIS_TERMINAL_LOG__ ?? null);

async function start(page: Page, content = AGENT) {
  await page.addInitScript((files) => {
    window.__JARVIS_ASSISTANT__ = { reply: "Escrevi o agente; quer revisar?", delayMs: 40, files };
    window.__JARVIS_TERMINAL__ = true;
  }, [{ path: PATH, content }]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    localStorage.removeItem("jarvis.desktop");
    localStorage.removeItem("jarvis.assistant");
    localStorage.setItem("jarvis.settings", settings);
  }, PLAIN_SETTINGS);
  await page.reload();
  await waitForFrames(page, 10);
}

test("JARVIS writes the agent in jv_agent, shows it for review and runs it once in jv_sh", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__JARVIS__!.ask("Jarvis, vamos criar um agente que revisa pull requests"));

  await expect(agentWindow(page)).toBeVisible();
  await expect(agentWindow(page).getByTestId("agent-live")).toBeVisible();
  await expect(agentWindow(page).locator(".cm-content")).toContainText("do mais grave ao menos grave", { timeout: 15_000 });
  await expect(agentWindow(page).getByTestId("agent-live")).toBeHidden();
  await expect(agentWindow(page).getByTestId("agent-field-name")).toHaveText("revisor-pr");
  await expect(agentWindow(page).getByTestId("agent-field-description")).toHaveText("Revisa pull requests e aponta riscos");
  await expect(card(page)).toHaveAttribute("data-state", "draft");

  // Running needs the review first.
  expect((await action(page, "agent_run", { name: "revisor-pr" })).ok).toBe(false);
  const review = await action(page, "agent_review", { name: "revisor-pr", task: "Revise o último PR" });
  expect(review.ok).toBe(true);
  expect(review.text).toContain("Em revisão no jv_agent: revisor-pr");
  await expect(card(page)).toHaveAttribute("data-state", "review");
  await expect(agentWindow(page).getByLabel("Tarefa da primeira execução")).toHaveValue("Revise o último PR");
  await expect(agentWindow(page).getByLabel("Pasta de trabalho")).toHaveValue("C:\\JARVIS\\Agentes\\revisor-pr");
  await page.screenshot({ path: `${SCREENS}/agent-review.png` });

  // Edited by hand after the review: JARVIS has to show it again.
  await agentWindow(page).locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Seja breve.");
  await expect(card(page)).toHaveAttribute("data-state", "changed");
  const refused = await action(page, "agent_run", { name: "revisor-pr" });
  expect(refused).toEqual({ ok: false, text: "O agente mudou depois da revisão: chame agent_review de novo." });

  // Reviewed again, it runs at once (JARVIS does not wait for the screen to catch up).
  expect((await action(page, "agent_review", { name: "revisor-pr", task: "Revise o último PR" })).ok).toBe(true);
  expect(await action(page, "agent_run", { name: "revisor-pr" })).toEqual({ ok: true, text: "Rodando o agente revisor-pr numa aba do jv_sh, em C:\\JARVIS\\Agentes\\revisor-pr" });
  const shell = page.getByRole("dialog", { name: "jv_sh", exact: true });
  await expect(shell).toBeVisible();
  await expect(shell.getByRole("tab", { name: /Agente revisor-pr/ })).toBeVisible();
  await expect.poll(async () => (await terminalLog(page))?.opens).toContain("agent:revisor-pr");
  expect((await terminalLog(page))?.cwds).toContain("C:\\JARVIS\\Agentes\\revisor-pr");
  await expect(card(page)).toHaveAttribute("data-state", "draft");
});

test("what is missing is listed and keeps the agent from running", async ({ page }) => {
  await start(page, "---\nname: revisor-pr\n---\n");
  await page.evaluate(() => window.__JARVIS__!.ask("cria o agente"));
  await expect(agentWindow(page).getByTestId("agent-problems")).toContainText("Falta a descrição");
  await expect(agentWindow(page).getByTestId("agent-problems")).toContainText("Falta o prompt");
  await expect(agentWindow(page).getByRole("button", { name: "Rodar uma vez" })).toBeDisabled();
  const review = await action(page, "agent_review", { name: "revisor-pr" });
  expect(review.ok).toBe(false);
  expect(review.text).toContain("Falta a descrição");
  expect((await action(page, "agent_review", { name: "inexistente" })).ok).toBe(false);
});

test("the Rodar button runs the open agent in the folder and with the task chosen there", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__JARVIS__!.ask("cria o agente"));
  await expect(agentWindow(page).getByTestId("agent-field-name")).toHaveText("revisor-pr", { timeout: 15_000 });
  await expect(agentWindow(page).getByTestId("agent-live")).toBeHidden();
  await agentWindow(page).getByLabel("Pasta de trabalho").fill("C:\\Projetos\\api");
  await agentWindow(page).getByLabel("Tarefa da primeira execução").fill("Revise o PR 42");
  await agentWindow(page).getByRole("button", { name: "Rodar uma vez" }).click();
  await expect(page.getByRole("dialog", { name: "jv_sh", exact: true })).toBeVisible();
  await expect.poll(async () => (await terminalLog(page))?.opens).toContain("agent:revisor-pr");
  expect((await terminalLog(page))?.cwds).toContain("C:\\Projetos\\api");
});
