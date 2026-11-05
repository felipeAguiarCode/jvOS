import { expect, test, type Page } from "@playwright/test";
import { agentSheet, figureRows, litParts, progressBar, stepsDone } from "../src/lib/agentFigure";
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
    window.__JARVIS_ASSISTANT__ = { reply: "Escrevi o agente; quer revisar?", files };
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

test("the ASCII agent is built part by part from the draft, as JARVIS writes it", () => {
  // Every row of the figure is as wide as the others.
  for (const row of figureRows(agentSheet(""))) expect(row.map((segment) => segment.text).join("")).toHaveLength(17);
  // A header still being written already has the lines it got.
  const half = agentSheet("---\nname: revisor-pr\ndescription: Revisa PRs\ntoo");
  expect(half).toEqual({ name: "revisor-pr", description: "Revisa PRs", tools: null, model: null, prompt: null });
  expect(litParts(half)).toEqual(["antenna", "head", "body", "eyes"]);
  const whole = agentSheet(AGENT);
  expect(litParts(whole)).toEqual(["antenna", "head", "body", "eyes", "arms", "core", "legs"]);
  const core = figureRows(whole)[6].map((segment) => segment.text).join("");
  expect(core).toBe(" │  │ SONNET│  │ ");
  expect(figureRows(agentSheet("---\nname: x\n---\n"))[2].map((segment) => segment.text).join("")).toContain("○   ○");
  expect(progressBar(stepsDone(whole, false))).toBe("[■■■■■□]");
});

const session = (page: Page) => agentWindow(page).getByRole("log", { name: "Sessão do agente" });
const tab = (page: Page, name: RegExp) => agentWindow(page).getByRole("tab", { name });

test("JARVIS writes the agent in jv_agent, shows it for review and runs it once in jv_sh", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__JARVIS__!.ask("Jarvis, vamos criar um agente que revisa pull requests"));

  await expect(agentWindow(page)).toBeVisible();
  await expect(agentWindow(page).getByTestId("agent-live")).toBeVisible();
  const figure = agentWindow(page).getByTestId("agent-figure");
  await expect(figure).toHaveAttribute("data-state", "live");
  await expect(agentWindow(page).getByTestId("agent-live")).toBeHidden({ timeout: 15_000 });
  // Built from the draft: every part, the eyes open, the model in its core.
  await expect(figure).toHaveAttribute("data-lit", "antenna head body eyes arms core legs");
  await expect(figure).toContainText("◉   ◉");
  await expect(figure).toContainText("SONNET");
  await figure.screenshot({ path: `${SCREENS}/agent-figure.png` });
  await expect(agentWindow(page).getByTestId("agent-progress")).toContainText("[■■■■■□] 5/6");
  await expect(agentWindow(page).getByTestId("agent-field-name")).toHaveText("revisor-pr");
  await expect(agentWindow(page).getByTestId("agent-field-description")).toHaveText("Revisa pull requests e aponta riscos");
  await expect(card(page)).toHaveAttribute("data-state", "draft");
  // The session: what was said to JARVIS, and what happened to the agent.
  await expect(session(page).locator('[data-who="você"]').first()).toContainText("Jarvis, vamos criar um agente que revisa pull requests");
  await expect(session(page).locator('[data-who="jarvis"]').first()).toContainText("Escrevi o agente; quer revisar?");
  await expect(session(page).locator('[data-who="✓"]').last()).toContainText("revisor-pr.md salvo");
  // The file itself is in the second tab.
  await tab(page, /revisor-pr\.md/).click();
  await expect(agentWindow(page).locator(".cm-content")).toContainText("do mais grave ao menos grave");
  await tab(page, /oficina/).click();

  // Running needs the review first.
  expect((await action(page, "agent_run", { name: "revisor-pr" })).ok).toBe(false);
  const review = await action(page, "agent_review", { name: "revisor-pr", task: "Revise o último PR" });
  expect(review.ok).toBe(true);
  expect(review.text).toContain("Em revisão no jv_agent: revisor-pr");
  await expect(card(page)).toHaveAttribute("data-state", "review");
  await expect(figure).toHaveAttribute("data-state", "review");
  await expect(agentWindow(page).getByTestId("agent-progress")).toContainText("6/6");
  await expect(session(page).locator('[data-who="→"]').last()).toContainText("em revisão · C:\\JARVIS\\Agentes\\revisor-pr · “Revise o último PR”");
  await expect(agentWindow(page).getByTestId("agent-prompt")).toContainText("diga “pode rodar”");
  await expect(agentWindow(page).getByLabel("Tarefa da primeira execução")).toHaveValue("Revise o último PR");
  await expect(agentWindow(page).getByLabel("Pasta de trabalho")).toHaveValue("C:\\JARVIS\\Agentes\\revisor-pr");
  await page.screenshot({ path: `${SCREENS}/agent-review.png` });

  // Edited by hand after the review: JARVIS has to show it again.
  await tab(page, /revisor-pr\.md/).click();
  await agentWindow(page).locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Seja breve.");
  await tab(page, /oficina/).click();
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
  await expect(figure).toHaveAttribute("data-state", "running");
  await expect(session(page).locator('[data-who="▶"]').last()).toContainText("claude --agent revisor-pr “Revise o último PR” · C:\\JARVIS\\Agentes\\revisor-pr");
});

test("what is missing is listed and keeps the agent from running", async ({ page }) => {
  await start(page, "---\nname: revisor-pr\n---\n");
  await page.evaluate(() => window.__JARVIS__!.ask("cria o agente"));
  await expect(agentWindow(page).getByTestId("agent-problems")).toContainText("Falta a descrição");
  await expect(agentWindow(page).getByTestId("agent-problems")).toContainText("Falta o prompt");
  await expect(agentWindow(page).getByRole("button", { name: "Rodar uma vez" })).toBeDisabled();
  // Only the head and the frame so far: hollow eyes, no arms, no legs; the antenna warns.
  const figure = agentWindow(page).getByTestId("agent-figure");
  await expect(figure).toHaveAttribute("data-state", "problem");
  await expect(figure).toHaveAttribute("data-lit", "antenna head body");
  await expect(figure).toContainText("○   ○");
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
