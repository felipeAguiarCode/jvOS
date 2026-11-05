import { agendaAt, TASKS_EVENING } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 19:10 · Volta para casa: "acorda, querido, papai chegou". The lights flicker on, the core ignites,
// Relógio, Agenda and Tarefas open one by one, and JARVIS welcomes him home with the rest of the day.

const AT = "2026-11-04T19:10";

test("11 · Volta para casa", async ({ demo, page }) => {
  await demo.start({
    at: AT,
    storage: { "jarvis.agenda": agendaAt(AT), "jarvis.tasks": TASKS_EVENING },
    // The list opens by itself while something is pending; the scene opens it again.
    setup: async (d) => {
      await d.page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "tasks", open: false }));
      await d.beat(800);
    },
  });
  await demo.beat(1500);

  await demo.shortcut("Acorda, querido, papai chegou!", "homecoming");
  await expect(page.getByTestId("homecoming")).toBeVisible();
  for (const name of ["Relógio", "Agenda", "Tarefas"]) await expect(demo.dialog(name)).toBeVisible();
  await expect(page.getByTestId("greeting")).toBeVisible();
  await expect(page.getByTestId("greeting")).toBeHidden({ timeout: 20_000 });
  await demo.replied();
  await demo.beat(2500);
});
