import { AGENT, desktopWith } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 21:15 · jv_agent: JARVIS writes a pull-request reviewer while the ASCII robot assembles part by
// part, shows it for review, and runs it once in a jv_sh tab after "pode rodar".

const PATH = "C:\\JARVIS\\Agentes\\revisor-pr.md";

test("13 · jv_agent", async ({ demo, page }) => {
  await demo.start({
    at: "2026-11-04T21:15",
    storage: { "jarvis.desktop": desktopWith([], { agent: { x: 24, y: 44, w: 680, h: 880 } }) },
    fakes: { __JARVIS_TERMINAL__: true },
  });

  await demo.ask("Jarvis, vamos criar um agente que revisa os pull requests do jvOS.", {
    reply: "Escrevi o revisor de PR; quer revisar antes de rodar?",
    delayMs: 110,
    files: [{ path: PATH, content: AGENT }],
  });
  const agent = demo.dialog("jv_agent");
  await expect(agent).toBeVisible({ timeout: 15_000 });
  await expect(agent.getByTestId("agent-live")).toBeHidden({ timeout: 60_000 });
  await demo.replied();
  await demo.beat(1500);

  await demo.ask("Mostra pra mim. A tarefa é revisar o último PR.", { reply: "Está na oficina para revisão. Diga pode rodar quando estiver satisfeito.", delayMs: 75 });
  await demo.beat(600);
  await demo.action("agent_review", { name: "revisor-pr", task: "Revise o último PR do jvOS" });
  await expect(agent.getByTestId("agent-review")).toHaveAttribute("data-state", "review");
  await demo.replied();
  await demo.beat(2500);

  await demo.ask("Pode rodar.", { reply: "Rodando o revisor numa aba do jv_sh.", delayMs: 75 });
  await demo.beat(600);
  await demo.action("agent_run", { name: "revisor-pr" });
  await expect(page.getByRole("dialog", { name: "jv_sh", exact: true })).toBeVisible();
  await demo.replied();
  await demo.beat(3500);
});
