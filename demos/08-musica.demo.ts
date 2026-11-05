import { expect, test } from "./lib/demo";

// 15:30 · jv_T4p3: the Vice City stations by keyboard, a song playing on the ASCII cassette, the
// next one, the volume, shuffle and pause.

test("08 · jv_T4p3", async ({ demo, page }) => {
  await demo.start({ at: "2026-11-04T15:30" });

  await demo.open("jv_T4p3", "Apps");
  await expect(page.getByTestId("tape-player")).toBeFocused();
  await demo.beat(800);

  for (let i = 0; i < 2; i++) await demo.press("ArrowRight", 900);
  for (let i = 0; i < 3; i++) await demo.press("ArrowDown", 450);
  await demo.press("Enter", 4500);
  await expect(page.getByTestId("cassette")).toBeVisible();

  await demo.press("n", 3500);
  await demo.press("-", 500);
  await demo.press("-", 900);
  await demo.press("+", 900);
  await demo.press("s", 1500);
  await demo.press(" ", 2000);
  await demo.press(" ", 1500);
  await demo.press("ArrowRight", 900);
  await demo.press("ArrowDown", 450);
  await demo.press("Enter", 4500);
});
