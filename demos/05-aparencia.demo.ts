import { expect, test } from "./lib/demo";

// 10:15 · Temas, núcleo e TUI: the JARVIS colours, a sweep of the custom hue, the 2D rings and the
// 3D hologram, holographic window chrome, and the TUI accent on jv_ide.

test("05 · Temas, núcleo e TUI", async ({ demo, page }) => {
  await demo.start({ at: "2026-11-04T10:15", fakes: { __JARVIS_FS__: true, __JARVIS_TERMINAL__: true } });

  // Configurações: the three themes.
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = demo.dialog("Configurações");
  await expect(settings).toBeVisible();
  await demo.beat(1000);
  for (const theme of ["Verde Matrix", "Amarelo digital", "Azul"]) {
    await settings.getByRole("radio", { name: theme }).click();
    await demo.beat(2200);
  }
  await demo.press("Escape", 900);

  // Menu avançado › Cores: the hue goes round the wheel.
  await demo.press("Control+Shift+,", 900);
  const menu = demo.dialog("Menu avançado");
  await expect(menu).toBeVisible();
  const hue = menu.getByRole("slider", { name: "Matiz" });
  await demo.glide(hue);
  for (let value = 200; value <= 650; value += 5) {
    await hue.evaluate((element: HTMLInputElement, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, String(v % 360));
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await demo.beat(40);
  }
  // The custom colour, with nothing in front of the hologram.
  await demo.press("Escape", 3000);
  await demo.press("Control+Shift+,", 900);
  await menu.getByRole("radio", { name: "Azul" }).click();
  await demo.beat(1200);

  // Núcleo: the 2D rings, then back to the hologram.
  await menu.getByRole("tab", { name: "Núcleo" }).click();
  await demo.beat(800);
  await menu.getByRole("radio", { name: "Anéis 2D" }).click();
  await demo.press("Escape", 3200);
  await demo.press("Control+Shift+,", 700);
  await menu.getByRole("tab", { name: "Núcleo" }).click();
  await menu.getByRole("radio", { name: "Holograma 3D" }).click();
  await demo.press("Escape", 2500);

  // Janelas: from the borderless TUI chrome to holographic glass.
  await demo.open("Relógio", "Widgets");
  await demo.open("Sistema", "Widgets");
  await demo.beat(800);
  await demo.press("Control+Shift+,", 700);
  await menu.getByRole("tab", { name: "Janelas" }).click();
  await demo.beat(700);
  await menu.getByRole("radio", { name: "Holográfico" }).click();
  await demo.press("Escape", 2800);
  await demo.closeGroup("Fecha os widgets.", "widgets");
  await demo.beat(1200);

  // TUI: jv_ide on a Rust file, its accent turned to amber, then green phosphor.
  const ide = await demo.open("jv_ide", "Apps");
  await ide.getByTestId("ide-welcome").click();
  await demo.press("Control+o", 900);
  await demo.press("Control+p", 500);
  await demo.type("main.rs");
  await demo.press("Enter", 1500);
  await expect(ide.locator(".cm-content")).toContainText("fn main");
  await demo.press("Control+Shift+,", 700);
  await menu.getByRole("tab", { name: "TUI" }).click();
  await demo.beat(1000);
  for (const accent of ["Âmbar", "Fósforo verde", "Magenta", "Cor do JARVIS"]) {
    await menu.getByRole("radio", { name: accent }).click();
    await demo.beat(1600);
  }
  await menu.getByRole("switch", { name: "Aberração cromática" }).click();
  await demo.beat(1200);
  await menu.getByRole("switch", { name: "Aberração cromática" }).click();
  await demo.press("Escape", 2500);
});
