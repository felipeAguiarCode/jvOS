import { agendaAt, QUOTES, TASKS, WEATHER } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 07:45 · Rotina da manhã: "bom dia" brings the briefing (Claude Code), then the weather, the agenda
// and the to-do list, answered on the spot by JARVIS's local lines.

const AT = "2026-11-04T07:45";

const BRIEFING =
  "Bom dia, Felipe. Curitiba amanhece com dezessete graus e sol entre nuvens; a máxima chega a vinte e quatro. " +
  "Na agenda, a daily às nove e meia, o almoço com a Ana ao meio-dia e meia e a revisão do jvOS às três. " +
  "Restam três tarefas, a começar pelo PR do jv_agent. Café primeiro, imagino.";

test("02 · Rotina da manhã", async ({ demo }) => {
  await demo.start({
    at: AT,
    storage: { "jarvis.weather": { city: "Curitiba" }, "jarvis.agenda": agendaAt(AT), "jarvis.tasks": TASKS },
    fakes: { __JARVIS_QUOTES__: QUOTES, __JARVIS_WEATHER__: WEATHER },
  });

  await demo.ask("Bom dia, Jarvis.", { reply: BRIEFING, delayMs: 60 }, { shortcut: "briefing", text: "" });
  await demo.replied();
  await demo.beat(800);

  await demo.shortcut("Jarvis, como vai estar o tempo amanhã?", "weather", "amanhã?");
  await expect(demo.dialog("Clima")).toBeVisible();
  await demo.replied();
  await demo.beat(600);

  await demo.shortcut("Repassa minha agenda.", "agenda");
  await expect(demo.dialog("Agenda")).toBeVisible();
  await demo.replied();
  await demo.beat(600);

  await demo.shortcut("Adiciona tarefa comprar café.", "taskAdd", "comprar café.");
  await expect(demo.dialog("Tarefas").getByText("Comprar café")).toBeVisible();
  await demo.replied();
  await demo.beat(400);

  await demo.shortcut("Conclui a tarefa um.", "taskDone", "um.");
  await expect(demo.dialog("Tarefas").getByRole("checkbox", { name: /Revisar o PR/ })).toBeChecked();
  await demo.replied();
  await demo.beat(1500);
});
