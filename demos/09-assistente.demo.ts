import { QUOTES } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 16:20 · Pergunte ao JARVIS: a stock quote (Claude Code with his tools), a price alert, the
// machine's status, a reminder that goes off, and the conversation history.

test("09 · Pergunte ao JARVIS", async ({ demo, page }) => {
  await demo.start({
    at: "2026-11-04T16:20",
    storage: { "jarvis.watchlist": { symbols: ["VALE3", "ITUB4", "BBAS3", "MXRF11"], alerts: [] } },
    fakes: { __JARVIS_QUOTES__: QUOTES },
  });

  await demo.ask("Jarvis, como está a Petrobras hoje?", {
    reply: "A Petrobras fecha a tarde em trinta e oito reais e quarenta e dois, alta de dois vírgula um por cento. Deixei a PETR4 no widget de ações, ao lado das outras.",
    delayMs: 75,
  });
  await demo.beat(700);
  await demo.action("stocks_watch", { symbol: "PETR4" });
  await expect(demo.dialog("Ações").locator('[data-symbol="PETR4"]')).toBeVisible();
  await demo.replied();
  await demo.beat(800);

  await demo.ask("Me avisa se a Vale passar de setenta.", { reply: "Combinado. Aviso assim que a Vale passar de setenta reais.", delayMs: 75 });
  await demo.beat(600);
  await demo.action("stocks_alert", { symbol: "VALE3", above: 70 });
  await demo.replied();
  await demo.beat(800);

  await demo.shortcut("Status do sistema.", "status");
  await demo.replied();
  await demo.beat(600);

  await demo.shortcut("Me lembra de alongar em 25 segundos.", "reminder", "de alongar em 25 segundos.");
  await demo.replied();
  await demo.beat(800);

  await page.getByRole("button", { name: "Histórico do JARVIS" }).first().click();
  await expect(demo.dialog("Histórico do JARVIS")).toBeVisible();
  await demo.beat(4500);
  await demo.press("Escape", 800);

  await expect(page.getByRole("status").filter({ hasText: "Lembrete: alongar" })).toBeVisible({ timeout: 40_000 });
  await demo.replied();
  await demo.beat(1500);
});
