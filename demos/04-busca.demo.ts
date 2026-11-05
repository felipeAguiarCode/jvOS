import { expect, test, type Demo } from "./lib/demo";

// 09:40 · Busca: "/" finds widgets, layout actions, the core mode and music, and runs them.

async function search(demo: Demo, query: string, expected: string) {
  await demo.press("/", 600);
  const dialog = demo.dialog("Busca");
  await expect(dialog).toBeVisible();
  await demo.type(query, 95);
  await expect(dialog.locator('[role="option"][aria-selected="true"]')).toContainText(new RegExp(expected, "i"));
  await demo.beat(1100);
  await demo.press("Enter", 1800);
}

test("04 · Busca", async ({ demo }) => {
  await demo.start({ at: "2026-11-04T09:40" });

  await search(demo, "nucleo 2d", "2D");
  await demo.beat(2000);
  await search(demo, "nucleo 3d", "3D");
  await demo.beat(1500);

  await search(demo, "calc", "Calculadora");
  await expect(demo.dialog("Calculadora")).toBeVisible();
  await search(demo, "relogio", "Relógio");
  await expect(demo.dialog("Relógio")).toBeVisible();
  await search(demo, "lado a lado", "Lado a lado");
  await demo.beat(800);
  await search(demo, "centralizar", "Centralizar");
  await demo.beat(800);

  await search(demo, "tocar emotion", "Emotion");
  await demo.beat(3500);
});
