import { desktopWith } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 02:10 · Madrugada: the 2D rings, "que horas são" with a remark on the hour, "limpa a memória"
// freeing Claude Code's RAM, and "fecha tudo".

test("14 · Madrugada", async ({ demo, page }) => {
  await demo.start({
    at: "2026-11-05T02:10",
    core: "2d",
    storage: { "jarvis.desktop": desktopWith(["clock", "system"]) },
    fakes: { __JARVIS_CLEANUP__: { outcome: "stopped", freed: 215 * 1024 * 1024 } },
  });
  await demo.beat(1200);

  await demo.shortcut("Jarvis, que horas são?", "time");
  await demo.replied();
  await demo.beat(800);

  await demo.shortcut("Limpa a memória.", "cleanup");
  await expect(page.getByRole("status").filter({ hasText: "215 MB liberados" })).toBeVisible({ timeout: 10_000 });
  await demo.replied();
  await demo.beat(800);

  await demo.closeGroup("Fecha tudo.", "all");
  await expect(demo.dialog("Relógio")).toBeHidden();
  await demo.beat(4500);
});
