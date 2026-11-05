import { expect, test, type Page } from "@playwright/test";
import { addDays, dateKey } from "../src/lib/agenda";
import { describeWeather, formatChange, formatPrice, normalizeSymbol, spokenChange, spokenPrice, type Quote, type Weather } from "../src/lib/feeds";
import { agendaLine, fill, LINES, spokenClock, stockAlertLine, weatherLine, type LineKey, type LineValues } from "../src/lib/jarvisLines";
import { placeIn } from "../src/lib/shortcuts";
import { crossed } from "../src/hooks/useWatchlist";
import { SCREENS, waitForFrames } from "./helpers";

// What JARVIS watches for the user: stocks and FIIs (Yahoo Finance), the weather (Open-Meteo)
// and the agenda. In the browser `__JARVIS_QUOTES__` and `__JARVIS_WEATHER__` stand in for the
// Rust side (tested by cargo), `__JARVIS__.action` for Claude Code's tool calls.

const NAME = "Tony";
const variants = (key: LineKey, values: LineValues = {}) => LINES[key].map((template) => fill(template, NAME, values));

const QUOTES: Record<string, Omit<Quote, "symbol" | "error">> = {
  PETR4: { name: "Petróleo Brasileiro S.A. - Petrobras", price: 53.88, change: -0.0818, currency: "BRL", time: 1793045134, points: [58.1, 56, 55.2, 53.88] },
  HGLG11: { name: "FII CSHG LOG", price: 151.7, change: 0.0042, currency: "BRL", time: 1793044980, points: [151, 151.4, 151.7] },
};
const WEATHER: Weather = {
  place: "Curitiba, Paraná",
  current: { temperature: 14.7, apparent: 12.7, humidity: 68, code: 3, wind: 11.1, day: true },
  days: [
    { date: "2026-10-27", code: 51, max: 18.8, min: 10.4, rain: 8 },
    { date: "2026-10-28", code: 61, max: 21.7, min: 11.8, rain: 76 },
    { date: "2026-10-29", code: 2, max: 18.7, min: 14.3, rain: 20 },
    { date: "2026-10-30", code: 95, max: 23.9, min: 14.7, rain: 96 },
    { date: "2026-10-31", code: 0, max: 20.2, min: 15.2, rain: 0 },
  ],
};

test("tickers, prices and the weather in words", () => {
  expect(normalizeSymbol(" petr4.sa ")).toBe("PETR4");
  expect(normalizeSymbol("hglg11")).toBe("HGLG11");
  expect(normalizeSymbol("petr 4")).toBeNull();
  expect(formatPrice(53.88, "BRL")).toBe("R$ 53,88");
  expect(formatPrice(1234.5, "USD")).toBe("US$ 1.234,50");
  expect(formatChange(-0.0818)).toBe("−8,18%");
  expect(formatChange(0.0042)).toBe("+0,42%");
  expect(spokenPrice(53.88, "BRL")).toBe("53 reais e 88");
  expect(spokenPrice(1, "BRL")).toBe("1 real");
  expect(spokenChange(-0.0818)).toBe("queda de 8,2 por cento");
  expect(spokenChange(0.0001)).toBe("estável no dia");
  expect(describeWeather(61).text).toBe("chuva fraca");
  expect(describeWeather(0, false).text).toBe("céu limpo");
  expect(spokenClock("15:30")).toBe("15 e 30");
  expect(spokenClock("09:00")).toBe("9 horas");
  expect(spokenClock("01:00")).toBe("1 hora");

  // The place in a weather question.
  expect(placeIn("em Curitiba?")).toBe("Curitiba");
  expect(placeIn("para amanhã em São Paulo")).toBe("São Paulo");
  expect(placeIn("no Rio de Janeiro amanhã")).toBe("Rio de Janeiro");
  expect(placeIn("para amanhã")).toBeNull();
  expect(placeIn("hoje?")).toBeNull();
  expect(placeIn("")).toBeNull();
});

test("JARVIS's lines for the weather, the agenda and a price alert", () => {
  const today = weatherLine(WEATHER, "today", NAME, () => 0);
  expect(today).toContain("15 graus e nublado");
  expect(today).toContain("Hoje, mínima de 10 e máxima de 19.");
  // Rain likely tomorrow: the umbrella.
  const tomorrow = weatherLine(WEATHER, "tomorrow", NAME, () => 0);
  expect(tomorrow).toMatch(/chuva fraca/);
  expect(tomorrow).toMatch(/76 por cento/);
  expect(tomorrow).toMatch(/guarda-chuva/);

  expect(variants("agendaEmpty", { when: "hoje" })).toContain(agendaLine([], "hoje", NAME, () => 0));
  const busy = agendaLine(
    [
      { id: "a", title: "Aniversário da mãe", date: "2026-10-27", time: null, notify: 10, alerted: true },
      { id: "b", title: "Reunião com a Ana", date: "2026-10-27", time: "15:00", notify: 10, alerted: false },
    ],
    "hoje",
    NAME,
    () => 0,
  );
  expect(busy).toContain("o dia todo, Aniversário da mãe; às 15 horas, Reunião com a Ana");

  const alert = { id: 1, symbol: "PETR4", above: 50, below: null };
  const quote = { symbol: "PETR4", error: null, ...QUOTES.PETR4 };
  expect(crossed(alert, quote)).toBe(true);
  expect(crossed({ ...alert, above: 60 }, quote)).toBe(false);
  expect(crossed({ ...alert, above: null, below: 54 }, quote)).toBe(true);
  expect(variants("stockAlert", { symbol: "PETR4", price: "53 reais e 88", direction: "acima", limit: "50 reais" })).toContain(stockAlertLine(alert, quote, NAME, () => 0));
});

const stored = (page: Page, key: string) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);
const lastAnswer = (page: Page) => stored(page, "jarvis.assistant").then((memory) => (memory?.items.at(-1)?.answer as string | undefined) ?? "");
const action = (page: Page, tool: string, args: Record<string, unknown>) => page.evaluate(([name, input]) => window.__JARVIS__!.action(name, input), [tool, args] as const);
const shortcut = (page: Page, action: string, text: string, said: string) =>
  page.evaluate((event) => window.__JARVIS__!.voiceShortcut(event as Parameters<NonNullable<typeof window.__JARVIS__>["voiceShortcut"]>[0]), { action, text, said });
const answered = (page: Page) => expect(page.getByTestId("jarvis-reply")).toBeHidden({ timeout: 30_000 });

async function start(page: Page) {
  await page.addInitScript(
    ([quotes, weather]) => {
      window.__JARVIS_QUOTES__ = quotes;
      window.__JARVIS_WEATHER__ = weather;
      window.__JARVIS_ASSISTANT__ = { reply: "Feito.", delayMs: 20 };
    },
    [QUOTES, WEATHER] as const,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.assistant", "jarvis.watchlist", "jarvis.weather", "jarvis.agenda", "jarvis.tasks"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
  }, JSON.stringify({ taskbar: false, assistantName: NAME }));
  await page.reload();
  await waitForFrames(page, 10);
}

test("stocks: typed into the widget or watched by JARVIS, with a price alert that goes off", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "stocks", open: true }));
  const widget = page.getByRole("dialog", { name: "Ações" });
  await expect(widget.getByText("Nenhum código ainda.", { exact: false })).toBeVisible();

  await widget.getByLabel("Adicionar código").fill("petr4");
  await widget.getByLabel("Adicionar código").press("Enter");
  const petr = widget.locator('[data-symbol="PETR4"]');
  await expect(petr).toContainText("R$ 53,88");
  await expect(petr).toContainText("−8,18%");

  // "Jarvis, monitora o HGLG11": his tool, the widget and the answer he gets.
  const watched = await action(page, "stocks_watch", { symbol: "hglg11" });
  expect(watched.ok).toBe(true);
  expect(watched.text).toContain("HGLG11 (FII CSHG LOG): R$ 151,70, +0,42% no dia");
  await expect(widget.locator('[data-symbol="HGLG11"]')).toContainText("R$ 151,70");
  const quoted = await action(page, "stocks_quote", { symbols: ["PETR4", "NOPE3"] });
  expect(quoted.text).toContain("PETR4 (Petróleo Brasileiro S.A. - Petrobras): R$ 53,88, −8,18% no dia");
  expect(quoted.text).toContain("NOPE3: erro");
  await page.screenshot({ path: `${SCREENS}/widget-stocks.png` });

  // An alert below the price waits; one the price is already past goes off at once, said by JARVIS.
  expect((await action(page, "stocks_alert", { symbol: "HGLG11", below: 140 })).ok).toBe(true);
  await expect(widget.locator('[data-symbol="HGLG11"]')).toContainText("avisar abaixo de R$ 140,00");
  expect((await action(page, "stocks_alert", { symbol: "PETR4", above: 50 })).ok).toBe(true);
  await expect.poll(() => lastAnswer(page)).toContain("PETR4");
  expect(variants("stockAlert", { symbol: "PETR4", price: "53 reais e 88", direction: "acima", limit: "50 reais" })).toContain(await lastAnswer(page));
  await expect.poll(async () => (await stored(page, "jarvis.watchlist"))?.alerts.map((alert: { symbol: string }) => alert.symbol)).toEqual(["HGLG11"]);
  expect((await action(page, "stocks_alert", { symbol: "PETR4" })).ok).toBe(false);

  // Removed by hand, it is gone for good.
  await petr.hover();
  await widget.getByRole("button", { name: "Parar de acompanhar PETR4" }).click();
  await expect(petr).toHaveCount(0);
  await expect.poll(async () => (await stored(page, "jarvis.watchlist"))?.symbols).toEqual(["HGLG11"]);
});

test("the weather: the widget's city, spoken now and tomorrow, another city on request", async ({ page }) => {
  await start(page);
  // No city yet: JARVIS asks for one.
  await shortcut(page, "weather", "", "Como está o tempo?");
  await expect.poll(() => lastAnswer(page)).toContain("cidade");
  expect(variants("weatherNoCity")).toContain(await lastAnswer(page));
  await answered(page);

  const widget = page.getByRole("dialog", { name: "Clima" });
  await expect(widget).toBeVisible();
  await widget.getByLabel("Sua cidade").fill("curitiba");
  await widget.getByLabel("Sua cidade").press("Enter");
  await expect(widget.getByTestId("weather-now")).toHaveText("15°");
  await expect(widget).toContainText("nublado");
  await expect(widget.getByRole("list", { name: "Próximos dias" }).getByRole("listitem")).toHaveCount(5);
  await page.screenshot({ path: `${SCREENS}/widget-weather.png` });
  expect((await stored(page, "jarvis.weather"))?.city).toBe("curitiba");

  await shortcut(page, "weather", "", "Como está o tempo?");
  await expect.poll(() => lastAnswer(page)).toContain("Hoje, mínima de 10 e máxima de 19.");
  await answered(page);
  await shortcut(page, "weather", "amanhã", "Vai chover amanhã?");
  await expect.poll(() => lastAnswer(page)).toContain("76 por cento");
  await answered(page);

  // JARVIS's tool: the widget's city by default, any other on request (the widget keeps its own).
  expect((await action(page, "weather", {})).text).toMatch(/^Curitiba, agora: 15°C \(sensação 13°C\), nublado/);
  expect((await action(page, "weather", { city: "Recife" })).text).toMatch(/^Recife, agora/);
  expect((await stored(page, "jarvis.weather"))?.city).toBe("curitiba");
});

test("the agenda: marked by JARVIS or by hand, numbered, edited, read back, said before it starts", async ({ page }) => {
  await start(page);
  const today = dateKey(new Date());
  const tomorrow = addDays(today, 1);

  // "Marca dentista amanhã às 10": his tool opens the widget on that day.
  const marked = await action(page, "agenda_add", { title: "Dentista", date: tomorrow, time: "10:00" });
  expect(marked).toEqual({ ok: true, text: `Marcado: 1: ${tomorrow} 10:00 · Dentista (aviso 10 min antes)` });
  const widget = page.getByRole("dialog", { name: "Agenda" });
  const day = widget.getByRole("list", { name: "Compromissos do dia" });
  await expect(day.locator('[data-event="1"]')).toContainText("#1");
  await expect(day.locator('[data-event="1"]')).toContainText("Dentista");
  expect((await action(page, "agenda_add", { title: "x", date: "amanhã" })).ok).toBe(false);

  // Edited in place: a new time and title.
  await day.getByText("Dentista").dblclick();
  await widget.getByLabel("Horário do compromisso 1").fill("11:15");
  await widget.getByLabel("Editar compromisso 1").fill("Dentista (retorno)");
  await widget.getByLabel("Editar compromisso 1").press("Enter");
  await expect(day.locator('[data-event="1"]')).toContainText("11:15");
  await expect(day.locator('[data-event="1"]')).toContainText("Dentista (retorno)");
  await shortcut(page, "agenda", "", "O que eu tenho amanhã?");
  await expect.poll(() => lastAnswer(page)).toContain("às 11 e 15, Dentista (retorno)");
  await answered(page);

  // By hand, on today.
  await widget.getByRole("button", { name: "hoje", exact: true }).click();
  await expect(day).toContainText("Nada marcado.");
  await widget.getByLabel("Novo compromisso").fill("Ligar para o banco");
  await widget.getByLabel("Novo compromisso").press("Enter");
  await expect(day.locator('[data-event="2"]')).toContainText("Ligar para o banco");
  await page.screenshot({ path: `${SCREENS}/widget-agenda.png` });

  const listed = await action(page, "agenda_list", {});
  expect(listed.text).toContain(`1: ${tomorrow} 11:15 · Dentista (retorno) (aviso 10 min antes)`);
  expect(listed.text).toContain(`2: ${today} dia todo · Ligar para o banco`);
  // By number: JARVIS's tool, or said ("apaga o compromisso dois").
  expect((await action(page, "agenda_remove", { id: 1 })).text).toBe("Apagado: Dentista (retorno)");
  await shortcut(page, "agendaRemove", "dois", "Apaga o compromisso dois");
  await expect.poll(() => lastAnswer(page)).toContain("Ligar para o banco");
  expect(variants("agendaRemoved", { id: 2, title: "Ligar para o banco" })).toContain(await lastAnswer(page));
  await answered(page);
  await shortcut(page, "agendaRemove", "7", "Apaga o compromisso 7");
  await expect.poll(() => lastAnswer(page)).toContain("7");
  expect(variants("agendaNotFound", { id: 7 })).toContain(await lastAnswer(page));
  await answered(page);
  expect((await action(page, "agenda_list", {})).text).toBe("Nenhum compromisso nesse período.");

  // Starting in three minutes, said three minutes before: right away.
  const soon = new Date(Date.now() + 3 * 60_000);
  const time = `${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`;
  expect((await action(page, "agenda_add", { title: "Call com o time", date: dateKey(soon), time, notify: 3 })).ok).toBe(true);
  await expect.poll(() => lastAnswer(page), { timeout: 10_000 }).toContain("Call com o time");
  await expect(page.getByText("Agenda: Call com o time", { exact: true })).toBeVisible();
});

test("the briefing hands JARVIS the weather, the day's agenda and what is left on the list", async ({ page }) => {
  await start(page);
  await page.evaluate(() => localStorage.setItem("jarvis.weather", JSON.stringify({ city: "Curitiba" })));
  await page.reload();
  await waitForFrames(page, 10);
  await action(page, "agenda_add", { title: "Reunião com a Ana", date: dateKey(new Date()), time: "23:59" });
  await action(page, "tasks_add", { text: "Comprar pão" });
  await shortcut(page, "briefing", "", "Bom dia, Jarvis");
  await expect.poll(async () => (await page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!.asks.at(-1)?.text)) ?? "").toContain("Clima: Curitiba, agora");
  const prompt = (await page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!.asks.at(-1)?.text)) ?? "";
  expect(prompt).toContain("23:59 · Reunião com a Ana");
  expect(prompt).toContain("Tarefas pendentes: 1: [ ] Comprar pão");
});

test("events saved with the old ids get short numbers", async ({ page }) => {
  await start(page);
  const today = dateKey(new Date());
  await page.evaluate((date) => {
    const old = (id: string, title: string) => ({ id, title, date, time: null, notify: 10, alerted: true });
    localStorage.setItem("jarvis.agenda", JSON.stringify([old("ev-lq3x9k2ab", "Aniversário da mãe"), old("ev-lq3xa01cd", "Pagar o aluguel")]));
  }, today);
  await page.reload();
  await waitForFrames(page, 10);
  expect((await action(page, "agenda_list", {})).text).toBe(`1: ${today} dia todo · Aniversário da mãe\n2: ${today} dia todo · Pagar o aluguel`);
});
