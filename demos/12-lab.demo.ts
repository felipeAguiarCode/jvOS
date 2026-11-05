import { expect, test } from "./lib/demo";

// 20:30 · jv_lab: the lesson catalog, "LLM por dentro" with its simulated terminal (tokens, the next
// token), a hint, and the harness lesson running an agent loop.

test("12 · jv_lab", async ({ demo }) => {
  await demo.start({ at: "2026-11-04T20:30" });

  const lab = await demo.open("jv_lab", "Apps");
  await lab.getByRole("button", { name: "Maximizar jv_lab" }).click();
  await demo.beat(1800);
  const screen = lab.locator("[data-terminal] .xterm-rows");
  const challenges = lab.getByRole("region", { name: "Desafios" });
  const run = async (command: string, wait = 2200) => {
    await demo.type(command, 70);
    await demo.press("Enter", wait);
  };

  await lab.getByRole("button", { name: "LLM por dentro", exact: true }).click();
  await expect(screen).toContainText("Desafio 1/5", { timeout: 20_000 });
  await demo.beat(1800);
  await run('tokenize "Olá, mundo!"', 3000);
  await expect(screen).toContainText("Desafio 1/5 concluído");

  await challenges.getByRole("button", { name: "Mostrar dica" }).click();
  await demo.beat(2200);
  await lab.locator("[data-terminal]").click();
  await run('llm next "O céu é"', 3500);
  await expect(screen).toContainText("Desafio 2/5 concluído");

  // The harness: an agent loop with its tools.
  await lab.getByRole("button", { name: "Voltar às lições" }).click();
  await demo.beat(1500);
  await lab.getByRole("button", { name: "Harness", exact: true }).click();
  await expect(screen).toContainText("Desafio 1/5", { timeout: 20_000 });
  await demo.beat(1500);
  await run("harness inspect", 2800);
  await run("harness tools", 2800);
  await run('harness run "corrija o teste que falha"', 9000);
});
