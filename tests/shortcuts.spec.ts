import { expect, test, type Page } from "@playwright/test";
import {
  describeDuration,
  parseReminder,
  shortcutPrompt,
  spokenStatus,
  spokenTime,
  statusReport,
  type ShortcutEvent,
} from "../src/lib/shortcuts";
import { cleanupSummary, formatBytes } from "../src/lib/cleanup";
import { fill, LINES, type LineKey, type LineValues } from "../src/lib/jarvisLines";
import { SCREENS, waitForFrames } from "./helpers";

// JARVIS's voice shortcuts. The engine (Rust, tested by cargo) decides which one was said; here
// `__JARVIS__.voiceShortcut` stands in for its `voice:shortcut` event, and a scripted JARVIS
// (src/lib/assistant.ts) for Claude Code. He calls the user "Tony".

const NAME = "Tony";
/** Every way JARVIS can say it (he picks one at random). */
const variants = (key: LineKey, values: LineValues = {}) => LINES[key].map((template) => fill(template, NAME, values));

test("parseReminder: durations in words or digits, what to say, and times of day left to JARVIS", () => {
  expect(parseReminder("beber água em 20 minutos.")).toEqual({ minutes: 20, text: "beber água" });
  expect(parseReminder("5 minutos")).toEqual({ minutes: 5, text: "" });
  expect(parseReminder("que tenho reunião daqui a meia hora")).toEqual({ minutes: 30, text: "tenho reunião" });
  expect(parseReminder("em uma hora e meia de ligar para a Ana")).toEqual({ minutes: 90, text: "ligar para a Ana" });
  expect(parseReminder("de tirar o bolo do forno em vinte e cinco minutos")).toEqual({ minutes: 25, text: "tirar o bolo do forno" });
  expect(parseReminder("alongar daqui 1 hora e 30 minutos")).toEqual({ minutes: 90, text: "alongar" });
  expect(parseReminder("um café em 10 minutos")).toEqual({ minutes: 10, text: "um café" });
  expect(parseReminder("30 segundos")).toEqual({ minutes: 0.5, text: "" });
  // A time of day, or no time at all: JARVIS reads the clock.
  expect(parseReminder("da reunião às 15 horas")).toBeNull();
  expect(parseReminder("de pagar a conta amanhã")).toBeNull();
  expect(parseReminder("em 9000 horas")).toBeNull();
});

test("spoken time, durations and the machine's status", () => {
  expect(describeDuration(20)).toBe("20 minutos");
  expect(describeDuration(61)).toBe("1 hora e 1 minuto");
  expect(describeDuration(0.5)).toBe("30 segundos");
  expect(spokenTime(new Date(2026, 9, 27, 14, 5))).toBe("São 14 horas e 5 minutos.");
  expect(spokenTime(new Date(2026, 9, 27, 13, 0))).toBe("São 13 horas em ponto.");
  expect(spokenTime(new Date(2026, 9, 27, 1, 1))).toBe("É 1 hora e 1 minuto.");
  expect(spokenTime(new Date(2026, 9, 27, 12, 30))).toBe("É meio-dia e 30 minutos.");

  const gb = 1024 ** 3;
  const stats = {
    cpu: 0.12,
    gpu: 0.05,
    ram: { used: 10 * gb, total: 16 * gb },
    memory: null,
    disks: [{ name: "C:", used: 470 * gb, total: 475 * gb }],
    wlan: { signal: 0.8, ssid: "Casa" },
  };
  const calm = spokenStatus({ stats: { ...stats, disks: [{ name: "C:", used: 100 * gb, total: 475 * gb }] }, battery: { level: 0.8, charging: true }, music: null });
  expect(calm).toBe(
    "Todos os sistemas operando normalmente. Processador em 12 por cento, memória em 63 por cento, 375 gigabytes livres no disco C, bateria em 80 por cento, carregando, Wi-Fi Casa com sinal de 80 por cento.",
  );
  // What needs attention comes first.
  const tight = spokenStatus({ stats, battery: { level: 0.1, charging: false }, music: null });
  expect(tight).toMatch(/^Atenção: o disco C está quase cheio, a bateria está baixa, convém ligar na tomada\. Processador/);
  expect(spokenStatus({ stats: null, battery: null, music: null })).toBe("Não consigo ler os sensores do sistema agora.");

  const report = statusReport({ stats, battery: null, music: { title: "Billie Jean", artist: "Michael Jackson", station: "Flash FM", playing: false } }, new Date(2026, 9, 27, 9, 7));
  expect(report).toContain("Hora local: 09:07, terça-feira, 27 de outubro de 2026");
  expect(report).toContain("Disco C:: 5 GB livres de 475 GB");
  expect(report).toContain("Música: Billie Jean — Michael Jackson (Flash FM), pausada");
});

test("prompts carry the user's words and what the shortcut means", () => {
  const now = new Date(2026, 9, 27, 8, 30);
  const research = shortcutPrompt("research", 'Pesquisa sobre o "Iron Man"', 'o "Iron Man"', { now });
  expect(research).toContain("[Atalho: pesquisa] O usuário disse: \"Pesquisa sobre o 'Iron Man'\". Assunto: o \"Iron Man\".");
  expect(research).toContain("Notas/AAAA-MM-DD Pesquisa - <assunto curto>.md");
  expect(research).toContain("Fontes");
  const briefing = shortcutPrompt("briefing", "Bom dia, Jarvis", "", { now, machine: "Todos os sistemas operando normalmente." });
  expect(briefing).toContain("Agora são 08:30 de terça-feira, 27 de outubro de 2026. Estado do computador: Todos os sistemas operando normalmente.");
  expect(shortcutPrompt("reminder", "me lembra da reunião às 15h", "da reunião às 15h", { now })).toContain("reminder_set");
  expect(shortcutPrompt("memory", "lembre-se que moro em Curitiba", "moro em Curitiba", { now })).toContain("Memória.md");
});

const reply = (page: Page) => page.getByTestId("jarvis-reply");
const log = (page: Page) => page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!);
const stored = (page: Page, key: string) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);
/** The last answer, as the history keeps it (on screen it is cut into pages of words). */
const lastAnswer = (page: Page) => stored(page, "jarvis.assistant").then((memory) => (memory?.items.at(-1)?.answer as string | undefined) ?? "");
const say = (page: Page, event: ShortcutEvent) => page.evaluate((shortcut) => window.__JARVIS__!.voiceShortcut(shortcut), event);
/** Waits for the answer on screen to be over. */
const answered = (page: Page) => expect(reply(page)).toBeHidden({ timeout: 30_000 });

async function start(page: Page) {
  await page.addInitScript(() => {
    window.__JARVIS_ASSISTANT__ = { reply: "Feito. A nota está salva.", delayMs: 20 };
    const gb = 1024 ** 3;
    window.__JARVIS_SYSTEM__ = { cpu: 0.12, gpu: 0.05, ram: { used: 8 * gb, total: 16 * gb }, memory: null, disks: [{ name: "C:", used: 100 * gb, total: 475 * gb }], wlan: null };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.assistant", "jarvis.reminders", "jarvis.pomodoro"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
  }, JSON.stringify({ taskbar: false, assistantName: NAME }));
  await page.reload();
  await waitForFrames(page, 10);
}

test("a question said to Voice goes to JARVIS; a research goes with its instructions, the words stay in the history", async ({ page }) => {
  await start(page);
  await say(page, { action: "ask", text: "Qual a capital da França?", said: "Qual a capital da França?" });
  await expect(reply(page)).toBeVisible();
  await answered(page);

  await say(page, { action: "research", text: "a fusão nuclear", said: "Pesquisa sobre a fusão nuclear" });
  await answered(page);
  const asks = (await log(page)).asks.map((item) => item.text);
  expect(asks[0]).toBe("Qual a capital da França?");
  expect(asks[1]).toMatch(/^\[Atalho: pesquisa\] O usuário disse: "Pesquisa sobre a fusão nuclear"\. Assunto: a fusão nuclear\./);
  // The history keeps what was said, not the instructions.
  await expect.poll(async () => (await stored(page, "jarvis.assistant"))?.items.map((item: { question: string }) => item.question)).toEqual([
    "Qual a capital da França?",
    "Pesquisa sobre a fusão nuclear",
  ]);
});

test("the time, the date and the status are answered at once, without Claude Code", async ({ page }) => {
  await start(page);
  await say(page, { action: "time", text: "", said: "Que horas são?" });
  await expect(reply(page)).toBeVisible();
  await expect.poll(() => lastAnswer(page)).toMatch(/(São|são) \d+ horas|(É|é) (1 hora|meia-noite|meio-dia)/);
  await answered(page);

  await say(page, { action: "status", text: "", said: "Status do sistema" });
  await expect(reply(page)).toBeVisible();
  const readings = "Processador em 12 por cento, memória em 50 por cento, 375 gigabytes livres no disco C.";
  await expect.poll(() => lastAnswer(page)).toContain(readings);
  expect(variants("statusOk").map((head) => `${head} ${readings}`)).toContain(await lastAnswer(page));
  await page.screenshot({ path: `${SCREENS}/shortcut-status.png` });
  await answered(page);

  await say(page, { action: "date", text: "", said: "Que dia é hoje?" });
  await expect(reply(page)).toBeVisible();
  await expect.poll(() => lastAnswer(page)).toMatch(/(\S+-feira|sábado|domingo), \d+ de \S+ de \d{4}/i);
  await answered(page);
  expect((await log(page)).asks).toEqual([]);
  // They land in the history like any answer.
  await expect.poll(async () => (await stored(page, "jarvis.assistant"))?.items.length).toBe(3);
});

test("reminders: a timer said to Voice, and one JARVIS sets that goes off", async ({ page }) => {
  await start(page);
  const before = Date.now();
  await say(page, { action: "reminder", text: "beber água em 20 minutos.", said: "Me lembra de beber água em 20 minutos." });
  await expect(reply(page)).toBeVisible();
  await expect.poll(() => lastAnswer(page)).toContain("beber água");
  expect(variants("reminderSet", { when: "20 minutos", text: "beber água" })).toContain(await lastAnswer(page));
  await expect.poll(async () => (await stored(page, "jarvis.reminders"))?.length).toBe(1);
  const [saved] = await stored(page, "jarvis.reminders");
  expect(saved.text).toBe("beber água");
  expect(saved.due).toBeGreaterThanOrEqual(before + 20 * 60_000);
  await answered(page);

  // A time of day goes to JARVIS, who sets it with reminder_set.
  await say(page, { action: "reminder", text: "da reunião às 15 horas", said: "Me lembra da reunião às 15 horas" });
  await answered(page);
  expect((await log(page)).asks.at(-1)?.text).toMatch(/^\[Atalho: lembrete\]/);
  const set = await page.evaluate(() => window.__JARVIS__!.action("reminder_set", { minutes: 0.03, text: "alongar" }));
  expect(set).toEqual({ ok: true, text: "Lembrete agendado para daqui a 2 segundos: alongar" });
  // On the dock, and in the core in JARVIS's words.
  await expect(page.getByRole("status").filter({ hasText: "Lembrete: alongar" })).toBeVisible({ timeout: 10_000 });
  await expect(reply(page)).toBeVisible();
  await expect.poll(() => lastAnswer(page)).toContain("longar");
  expect(variants("reminderDue", { text: "alongar" })).toContain(await lastAnswer(page));
  await expect.poll(async () => (await stored(page, "jarvis.reminders"))?.length).toBe(1);
  expect(await page.evaluate(() => window.__JARVIS__!.action("reminder_set", { minutes: 0, text: "x" }))).toMatchObject({ ok: false });
});

test("Protocolo foco closes the windows and starts a focus phase", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    window.__JARVIS__!.voiceWindow({ kind: "clock", open: true });
    window.__JARVIS__!.voiceWindow({ kind: "calculator", open: true });
  });
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeVisible();
  await say(page, { action: "focus", text: "", said: "Protocolo foco" });
  await expect.poll(async () => variants("focus", { minutes: 25 }).includes(await lastAnswer(page))).toBe(true);
  await expect(page.getByRole("dialog", { name: "Relógio" })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Pomodoro" })).toBeVisible();
  await expect.poll(async () => (await stored(page, "jarvis.pomodoro"))?.endsAt).not.toBeNull();
  expect((await stored(page, "jarvis.pomodoro")).phase).toBe("focus");
});

test("the memory cleanup: Claude Code's RAM given back, said by JARVIS or shown in the settings", async ({ page }) => {
  expect(formatBytes(215 * 1024 ** 2)).toBe("215 MB");
  expect(formatBytes(1.25 * 1024 ** 3)).toBe("1,3 GB");
  expect(cleanupSummary({ outcome: "idle" })).toBe("Nada a liberar: o Claude Code já estava parado.");

  await start(page);
  await page.evaluate((freed) => (window.__JARVIS_CLEANUP__ = { outcome: "stopped", freed }), 215 * 1024 ** 2);
  await say(page, { action: "cleanup", text: "", said: "Ativa o garbage collector" });
  await expect.poll(async () => variants("cleanupDone", { freed: "215 megabytes" }).includes(await lastAnswer(page))).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Memória: 215 MB liberados" })).toBeVisible();
  await answered(page);
  // Never in the middle of an answer.
  await page.evaluate(() => (window.__JARVIS_CLEANUP__ = { outcome: "busy" }));
  await say(page, { action: "cleanup", text: "", said: "Limpa a memória" });
  await expect.poll(async () => variants("cleanupBusy").includes(await lastAnswer(page))).toBe(true);
  await answered(page);
  // No Claude Code needed for any of it.
  expect((await log(page))?.asks ?? []).toEqual([]);

  await page.evaluate((freed) => (window.__JARVIS_CLEANUP__ = { outcome: "stopped", freed }), 180 * 1024 ** 2);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Limpar memória" }).click();
  await expect(page.getByTestId("cleanup-result")).toHaveText("180 MB de RAM liberados. Ele volta na próxima pergunta, na mesma conversa.");
  await page.getByTestId("cleanup-result").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}/settings-cleanup.png` });
});

test("JARVIS's model is chosen in the settings, next to the Whisper models", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const brain = page.getByRole("radiogroup", { name: "Modelo do JARVIS" });
  await expect(brain.getByRole("radio", { name: "Sonnet" })).toHaveAttribute("aria-checked", "true");
  await brain.getByRole("radio", { name: "Haiku" }).click();
  await expect(page.getByText("O mais rápido. O Claude Code que responde")).toBeVisible();
  await expect.poll(async () => (await stored(page, "jarvis.settings"))?.assistantModel, { timeout: 5_000 }).toBe("haiku");
  // Small, the default, comes first: the CPU runs it in about two seconds.
  const whisper = page.getByRole("radiogroup", { name: "Modelo Whisper" });
  await expect(whisper.getByRole("radio").first()).toHaveAttribute("aria-label", "Modelo Small");
});
