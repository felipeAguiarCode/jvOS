import { expect, test } from "./lib/demo";

// 09:10 · Janelas e widgets: widgets from the dock, a sum on the calculator, a window snapped to
// the edge and another resized, "Lado a lado" from the advanced menu, then "fecha todos os widgets".

test("03 · Janelas e widgets", async ({ demo }) => {
  await demo.start({ at: "2026-11-04T09:10" });

  await demo.open("Relógio", "Widgets");
  await demo.open("Sistema", "Widgets");
  await demo.open("Bateria", "Widgets");
  const calc = await demo.open("Calculadora", "Widgets");

  for (const key of ["1", "2", "8", "×", "4", "Igual"]) {
    await calc.getByRole("button", { name: key, exact: true }).click();
    await demo.beat(260);
  }
  await expect(calc.getByTestId("calc-display")).toHaveText("512");
  await demo.beat(1200);

  // Thrown to the left edge: it snaps, with a guide while held.
  await demo.drag(calc.locator("header"), 22 - 352, 440);
  await demo.beat(600);

  // The meters grow from the corner.
  await demo.drag(demo.dialog("Sistema").getByTestId("resize-se"), -40, 120, 20);
  await demo.beat(1500);

  // Side by side, from the advanced menu.
  await demo.press("Control+Shift+,", 700);
  const menu = demo.dialog("Menu avançado");
  await menu.getByRole("tab", { name: "Layout" }).click();
  await demo.beat(900);
  await menu.getByRole("button", { name: "Lado a lado" }).click();
  await demo.beat(1500);
  await demo.press("Escape", 2500);

  await demo.closeGroup("Fecha todos os widgets.", "widgets");
  await expect(demo.dialog("Relógio")).toBeHidden();
  await demo.beat(3500);
});
