import { agendaAt, desktopWith, TASKS, WEATHER } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 14:00 · Protocolo foco: a busy desktop is cleared, the Pomodoro starts, the music comes in with
// the cassette and the mini player, and the focus gets five more minutes.

const AT = "2026-11-04T14:00";

test("07 · Protocolo foco", async ({ demo }) => {
  await demo.start({
    at: AT,
    storage: {
      "jarvis.desktop": desktopWith(["clock", "weather", "agenda", "calculator", "system", "tasks"]),
      "jarvis.weather": { city: "Curitiba" },
      "jarvis.agenda": agendaAt(AT),
      "jarvis.tasks": TASKS,
    },
    fakes: { __JARVIS_WEATHER__: WEATHER },
  });
  await demo.beat(1200);

  await demo.shortcut("Jarvis, protocolo foco.", "focus");
  const pomodoro = demo.dialog("Pomodoro");
  await expect(pomodoro).toBeVisible();
  await demo.replied();
  await demo.beat(1500);

  await demo.music("Toca a Flash FM.", { action: "play", target: "flash fm" });
  await demo.beat(1500);
  await demo.window("Abre a fita.", { kind: "tape", open: true });
  await demo.beat(1200);
  await demo.window("E o mini player.", { kind: "miniplayer", open: true });
  await expect(demo.dialog("Mini player")).toBeVisible();
  await demo.beat(3000);

  await demo.music("Próxima música.", { action: "next", target: null });
  await demo.beat(3000);

  await demo.pomodoro("Mais cinco minutos no pomodoro.", "longer");
  await demo.beat(4000);
});
