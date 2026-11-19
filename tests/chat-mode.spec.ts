import { expect, test, type Page } from "@playwright/test";
import { conversationTitle, migrateMemory, parseConversations, parseMemory } from "../src/lib/assistant";
import { conversationPreview, matchesConversation, parseChatMode } from "../src/lib/chatMode";
import { activeConversation, PLAIN_SETTINGS, waitForFrames } from "./helpers";

// The chat mode (.specs/features/chat-mode/spec.md): JARVIS as a messenger over the desktop.
// A scripted stand-in answers (src/lib/assistant.ts), as in assistant.spec.ts.

const chat = (page: Page) => page.getByTestId("chat-view");
const field = (page: Page) => page.getByRole("textbox", { name: "Mensagem para o JARVIS" });
const bubbles = (page: Page, role: "user" | "jarvis") => page.locator(`[data-testid=chat-message][data-role=${role}]`);
/** What was asked, without the time under it. */
const questions = (page: Page) => page.locator("[data-testid=chat-message][data-role=user] p");
/** JARVIS's bubbles whose answer is over. */
const answers = (page: Page) => page.locator("[data-testid=chat-message][data-role=jarvis]:not([data-live])");
const rows = (page: Page) => page.getByTestId("chat-conversation");
const row = (page: Page, title: string | RegExp) => rows(page).filter({ hasText: title });
const log = (page: Page) => page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!);
const mode = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.chatMode") ?? "null")?.mode);

interface StartOptions {
  assistant?: unknown;
  settings?: string;
  /** Extra localStorage, set before the app loads. */
  seed?: Record<string, unknown>;
  speech?: unknown;
  /** The in-memory disk (src/lib/workspaceFake.ts), where JARVIS's notes are. */
  fs?: unknown;
}

async function start(page: Page, { assistant = { reply: "Certamente.", delayMs: 20 }, settings = PLAIN_SETTINGS, seed = {}, speech, fs }: StartOptions = {}) {
  await page.addInitScript(
    ([options, voice, disk]) => {
      if (options) window.__JARVIS_ASSISTANT__ = options as never;
      if (voice) window.__JARVIS_SPEECH__ = voice as never;
      if (disk) window.__JARVIS_FS__ = disk as never;
    },
    [assistant, speech, fs] as const,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  // StrictMode writes the stored values back as the app mounts: the seeds go in after that.
  await waitForFrames(page, 10);
  await page.evaluate(
    ([plain, extra]) => {
      ["jarvis.desktop", "jarvis.assistant", "jarvis.conversations", "jarvis.chatMode"].forEach((key) => localStorage.removeItem(key));
      localStorage.setItem("jarvis.settings", plain);
      localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
      for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, JSON.stringify(value));
    },
    [settings, seed] as const,
  );
  await page.reload();
}

/** Into the chat from the desktop, by the keyboard. */
async function enter(page: Page) {
  await waitForFrames(page, 10);
  await page.keyboard.press("Control+Shift+J");
  await expect(chat(page)).toBeVisible();
}

async function send(page: Page, text: string) {
  await field(page).fill(text);
  await field(page).press("Enter");
}

test("chat-mode helpers", () => {
  expect(parseChatMode("x")).toBeNull();
  expect(parseChatMode({ mode: "tela", section: "x", speak: "sim" })).toEqual({ mode: "desktop", section: "conversations", speak: false, collapsed: false });
  expect(parseChatMode({ mode: "chat", section: "notes", speak: true, collapsed: true })).toEqual({ mode: "chat", section: "notes", speak: true, collapsed: true });

  expect(conversationTitle("  Como   está o tempo? ")).toBe("Como está o tempo?");
  expect(conversationTitle("")).toBe("Nova conversa");
  const long = conversationTitle("Pesquisa sobre a história da computação quântica e os seus principais marcos até hoje");
  expect(long.length).toBeLessThanOrEqual(49);
  expect(long.endsWith("…")).toBe(true);

  // The single history of before: a stretch per "Nova conversa" mark, the session on the last one.
  const old = parseMemory({
    sessionId: "old-session",
    items: [
      { id: 1, at: 1000, question: "Fatura do Mike", answer: "Feita." },
      { id: 2, at: 2000, question: "E o e-mail?", answer: "Enviado." },
      { id: 3, at: 3000, newConversation: true },
      { id: 4, at: 4000, question: "Como está o clima?", answer: "Ensolarado.", steps: ["mcp__jarvis__weather"] },
    ],
  });
  const migrated = migrateMemory(old, 9000);
  expect(migrated.conversations.map((conversation) => [conversation.id, conversation.title, conversation.sessionId, conversation.items.length])).toEqual([
    ["c1", "Fatura do Mike", null, 2],
    ["c4", "Como está o clima?", "old-session", 1],
  ]);
  expect(migrated.activeId).toBe("c4");
  expect(migrateMemory(old, 1)).toEqual(migrated);
  // Ended on a mark: that session was already left behind. Nothing to migrate: one empty conversation.
  expect(migrateMemory(parseMemory({ sessionId: "s", items: [{ id: 1, at: 1, question: "a", answer: "b" }, { id: 2, at: 2, newConversation: true }] }), 5).conversations[0].sessionId).toBeNull();
  expect(migrateMemory(null, 7)).toEqual({ activeId: "c7", conversations: [{ id: "c7", title: "Nova conversa", sessionId: null, createdAt: 7, updatedAt: 7, items: [] }] });

  expect(parseConversations("x")).toBeNull();
  expect(parseConversations({ activeId: "a", conversations: [] })).toBeNull();
  const parsed = parseConversations({
    activeId: "gone",
    conversations: [
      { id: "a", title: " Antiga ", sessionId: 5, createdAt: 1, updatedAt: 10, items: [{ id: 1, at: 1, question: "q", answer: "r" }, { bad: true }] },
      { id: "b", renamed: true, updatedAt: 20, items: "x" },
      { title: "sem id" },
      { id: "a", title: "repetida" },
    ],
  })!;
  expect(parsed.activeId).toBe("b");
  expect(parsed.conversations.map((conversation) => [conversation.id, conversation.title, conversation.sessionId, conversation.items.length])).toEqual([
    ["a", "Antiga", null, 1],
    ["b", "Nova conversa", null, 0],
  ]);

  const [first] = migrated.conversations;
  expect(matchesConversation(first, "")).toBe(true);
  expect(matchesConversation(first, "FATURA")).toBe(true);
  expect(matchesConversation(first, "e-mail")).toBe(true);
  expect(matchesConversation(first, "clima")).toBe(false);
  expect(conversationPreview(first)).toBe("Enviado.");
});

test("the top bar button and Ctrl+Shift+J switch between the desktop and the chat", async ({ page }) => {
  await start(page, { settings: JSON.stringify({ taskbar: true }) });
  await waitForFrames(page, 10);
  // A window on the desktop, to find again afterwards.
  await page.evaluate(() => window.__JARVIS__!.voiceWindow({ kind: "clock", open: true }));
  const clock = page.getByRole("dialog", { name: "Relógio" });
  await expect(clock).toBeVisible();
  await expect(chat(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Modo chat", exact: true }).click();
  await expect(chat(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Modo desktop", exact: true })).toBeVisible();
  await expect.poll(() => mode(page)).toBe("chat");
  // The desktop is still there, under the chat and out of reach.
  await expect(page.getByTestId("desktop-layer")).toHaveAttribute("inert", "");
  // The voice command's confirmation is the conversation so far.
  await expect(questions(page)).toHaveText(["Comando de voz"]);
  // Below the top bar.
  expect((await chat(page).boundingBox())!.y).toBe(28);

  await page.keyboard.press("Control+Shift+J");
  await expect(chat(page)).toHaveCount(0);
  await expect(clock).toBeVisible();
  await expect.poll(() => mode(page)).toBe("desktop");

  // By voice, both ways; JARVIS's confirmation lands in the conversation.
  await page.evaluate(() => window.__JARVIS__!.voiceShortcut({ action: "chatMode", text: "", said: "modo chat" }));
  await expect(chat(page)).toBeVisible();
  await expect(questions(page)).toHaveText(["Comando de voz", "modo chat"]);
  await expect(answers(page)).toHaveCount(2);
  await page.evaluate(() => window.__JARVIS__!.voiceShortcut({ action: "desktopMode", text: "", said: "modo desktop" }));
  await expect(chat(page)).toHaveCount(0);

  // The mode is remembered, and the desktop comes back as it was.
  await page.keyboard.press("Control+Shift+J");
  await expect.poll(() => mode(page)).toBe("chat");
  await page.reload();
  await expect(chat(page)).toBeVisible();
  await page.getByRole("button", { name: "Voltar ao desktop" }).click();
  await expect(chat(page)).toHaveCount(0);
  await expect(clock).toBeVisible();
});

test("a typed question is answered in a bubble, with the agent's steps and the file it wrote", async ({ page }) => {
  const note = "C:\\JARVIS\\Notas\\2026-11-19 Fatura.md";
  await start(page, {
    assistant: { reply: "Encontrei o **Mike** nos registros. A nota está pronta.", delayMs: 20, files: [{ path: note, content: "# Fatura\n\nMike Johnson, 2500." }] },
    // The stand-in only says it wrote the note; here it is on the stand-in disk.
    fs: { projects: { "C:\\JARVIS\\Notas": { files: { "2026-11-19 Fatura.md": "# Fatura\n\nMike Johnson, 2500." }, git: false } } },
  });
  await enter(page);
  // Without the top bar the chat takes the whole window.
  expect((await chat(page).boundingBox())!.y).toBe(0);
  await expect(field(page)).toBeFocused();

  // Nothing empty is sent; Shift+Enter breaks the line.
  await field(page).press("Enter");
  await field(page).fill("   ");
  await field(page).press("Enter");
  await expect(bubbles(page, "user")).toHaveCount(0);
  await field(page).fill("Cria a fatura");
  await field(page).press("Shift+Enter");
  await field(page).pressSequentially("do Mike");
  await field(page).press("Enter");

  await expect(questions(page)).toHaveText([/Cria a fatura\s+do Mike/]);
  await expect(field(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Parar", exact: true })).toBeVisible();
  await expect(answers(page)).toHaveCount(1, { timeout: 15_000 });
  const answer = answers(page).first();
  await expect(answer).toContainText("Encontrei o Mike nos registros.");
  await expect(answer.locator("strong")).toHaveText("Mike");
  await expect(answer.getByTestId("chat-steps")).toHaveText("Escrevendo");
  await expect(answer.getByTestId("chat-file")).toContainText("2026-11-19 Fatura.md");
  await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
  // The conversation takes the question's name, and keeps what the agent did.
  await expect(page.getByTestId("chat-title")).toHaveText("Cria a fatura do Mike");
  await expect.poll(async () => (await activeConversation(page))?.items[0]).toMatchObject({ steps: ["Write"], files: [note] });

  // "Abrir" shows the note in the chat's own notes, without leaving the chat.
  await answer.getByRole("button", { name: "Abrir 2026-11-19 Fatura.md" }).click();
  await expect(page.getByRole("tab", { name: "Notas" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Título da nota" })).toHaveValue("2026-11-19 Fatura");
  await expect(page.locator("[data-testid=note-editor] .cm-content")).toContainText("Mike Johnson, 2500.");
  await expect(chat(page)).toBeVisible();
  expect(await mode(page)).toBe("chat");
});

test("an answer stops with Parar or Esc, and a failure shows in its bubble", async ({ page }) => {
  await start(page, { assistant: { reply: "Uma resposta longa o bastante para ser interrompida no meio do caminho, senhor.", delayMs: 150 } });
  await enter(page);
  await send(page, "Primeira");
  await expect(bubbles(page, "jarvis").first()).toContainText("Uma resposta");
  await page.getByRole("button", { name: "Parar", exact: true }).click();
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText("Interrompida");

  await send(page, "Segunda");
  await expect(bubbles(page, "jarvis").nth(1)).toContainText("Uma resposta");
  await field(page).press("Escape");
  await expect(answers(page)).toHaveCount(2);
  expect((await log(page)).cancels).toBe(2);
  await expect.poll(async () => (await activeConversation(page))?.items.map((item) => item.cancelled)).toEqual([true, true]);

  // A failure: the error in the bubble, and the field takes the next question.
  await page.evaluate(() => (window.__JARVIS_ASSISTANT__ = { reply: "Pela metade", delayMs: 10, error: "O Claude Code não respondeu" }));
  await send(page, "Terceira");
  await expect(answers(page)).toHaveCount(3);
  await expect(answers(page).nth(2).getByTestId("chat-error")).toHaveText("O Claude Code não respondeu");
  await expect(field(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
});

test("in a browser the chat says the conversation needs the desktop app", async ({ page }) => {
  await start(page, { assistant: null });
  await enter(page);
  await send(page, "Status?");
  await expect(page.getByTestId("chat-notice")).toHaveText("Disponível no app desktop");
  await expect(bubbles(page, "user")).toHaveCount(0);
});

test("each conversation keeps its own session; a new one starts another", async ({ page }) => {
  await start(page);
  await enter(page);
  await send(page, "Primeira pergunta");
  await expect(answers(page)).toHaveCount(1);
  await expect(rows(page)).toHaveCount(1);

  // A new conversation: empty, and its first question starts another session.
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  // An empty one is used again, not made twice.
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await send(page, "Segunda pergunta");
  await expect(answers(page)).toHaveCount(1);
  expect((await log(page)).asks.map((item) => item.sessionId)).toEqual([null, null]);
  await expect.poll(async () => (await activeConversation(page))?.sessionId).toBe("fake-session-2");
  // Newest first.
  await expect(rows(page).nth(0)).toContainText("Segunda pergunta");

  // Back in the first one, the question goes on in its session.
  await row(page, "Primeira pergunta").getByRole("button", { name: /Primeira pergunta/ }).first().click();
  await expect(questions(page)).toHaveText(["Primeira pergunta"]);
  await send(page, "Terceira pergunta");
  await expect(answers(page)).toHaveCount(2);
  expect((await log(page)).asks[2]).toEqual({ text: "Terceira pergunta", sessionId: "fake-session-1" });

  // While JARVIS answers here, the other one is free (agent-contacts.spec.ts goes further).
  await page.evaluate(() => (window.__JARVIS_ASSISTANT__ = { reply: "Um momento, estou trabalhando nisso com toda a calma do mundo.", delayMs: 200 }));
  await send(page, "Quarta pergunta");
  await expect(row(page, "Primeira pergunta").getByRole("img", { name: "Respondendo" })).toBeVisible();
  await row(page, "Segunda pergunta").getByRole("button", { name: /Segunda pergunta/ }).first().click();
  await expect(questions(page)).toHaveText(["Segunda pergunta"]);
  await expect(field(page)).toBeEnabled();
  // It ends where it was asked.
  await expect(row(page, "Primeira pergunta").getByRole("img", { name: "Respondendo" })).toHaveCount(0, { timeout: 30_000 });
  await expect(answers(page)).toHaveCount(1);
  await row(page, "Primeira pergunta").getByRole("button", { name: /Primeira pergunta/ }).first().click();
  await expect(questions(page)).toHaveText(["Primeira pergunta", "Terceira pergunta", "Quarta pergunta"]);
  await expect(answers(page)).toHaveCount(3);

  // Rename, and search by the new name; a renamed conversation keeps its name.
  await page.evaluate(() => (window.__JARVIS_ASSISTANT__ = { reply: "Certamente.", delayMs: 20 }));
  const second = row(page, "Segunda pergunta");
  await second.hover();
  await second.getByRole("button", { name: "Renomear Segunda pergunta" }).click();
  await page.getByRole("textbox", { name: "Nome da conversa" }).fill("Projeto Órion");
  await page.getByRole("textbox", { name: "Nome da conversa" }).press("Enter");
  await expect(row(page, "Projeto Órion")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Buscar conversas" }).fill("orion");
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Buscar conversas" }).fill("terceira");
  await expect(rows(page)).toHaveText([/Primeira pergunta/]);
  await page.getByRole("searchbox", { name: "Buscar conversas" }).fill("nada disso");
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Buscar conversas" }).fill("");
  // Esc gives a rename up.
  await row(page, "Projeto Órion").hover();
  await row(page, "Projeto Órion").getByRole("button", { name: "Renomear Projeto Órion" }).click();
  await page.getByRole("textbox", { name: "Nome da conversa" }).fill("Outro nome");
  await page.getByRole("textbox", { name: "Nome da conversa" }).press("Escape");
  await expect(row(page, "Projeto Órion")).toHaveCount(1);
  await row(page, "Projeto Órion").getByRole("button", { name: /Projeto Órion/ }).first().click();
  await send(page, "Mais uma");
  await expect(answers(page)).toHaveCount(2);
  await expect(page.getByTestId("chat-title")).toHaveText("Projeto Órion");

  // Delete: asked first; then the conversation goes, and its session with it.
  const renamed = row(page, "Projeto Órion");
  await renamed.hover();
  await renamed.getByRole("button", { name: "Apagar Projeto Órion" }).click();
  await renamed.getByRole("button", { name: "Não apagar" }).click();
  await expect(rows(page)).toHaveCount(2);
  await renamed.hover();
  await renamed.getByRole("button", { name: "Apagar Projeto Órion" }).click();
  await renamed.getByRole("button", { name: "Sim, apagar" }).click();
  await expect(rows(page)).toHaveCount(1);
  expect((await log(page)).forgets).toEqual(["fake-session-2"]);
  // The one left takes the screen; deleting the last one leaves an empty conversation.
  await expect(bubbles(page, "user")).toHaveCount(3);
  const last = row(page, "Primeira pergunta");
  await last.hover();
  await last.getByRole("button", { name: "Apagar Primeira pergunta" }).click();
  await last.getByRole("button", { name: "Sim, apagar" }).click();
  await expect(rows(page)).toHaveText([/Nova conversa/]);
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  expect((await log(page)).forgets).toEqual(["fake-session-2", "fake-session-1"]);
});

test("the old single history becomes conversations", async ({ page }) => {
  await start(page, {
    seed: {
      "jarvis.chatMode": { mode: "chat", speak: false },
      "jarvis.assistant": {
        sessionId: "0000aaaa-0000-4000-8000-00000000000a",
        items: [
          { id: 1, at: 1000, question: "Fatura do Mike", answer: "Feita." },
          { id: 2, at: 2000, question: "E o e-mail?", answer: "Enviado." },
          { id: 3, at: 3000, newConversation: true },
          { id: 4, at: 4000, question: "Como está o clima?", answer: "Ensolarado." },
        ],
      },
    },
  });
  await expect(chat(page)).toBeVisible();
  await expect(rows(page)).toHaveText([/Como está o clima\?/, /Fatura do Mike/]);
  await expect(row(page, "Como está o clima?")).toHaveAttribute("data-active", "true");
  await expect(questions(page)).toHaveText(["Como está o clima?"]);

  // Only the last stretch goes on in the old session.
  await send(page, "E amanhã?");
  await expect(answers(page)).toHaveCount(2);
  await row(page, "Fatura do Mike").getByRole("button", { name: /Fatura do Mike/ }).first().click();
  await expect(questions(page)).toHaveText(["Fatura do Mike", "E o e-mail?"]);
  await send(page, "Mande de novo");
  await expect(answers(page)).toHaveCount(3);
  expect((await log(page)).asks.map((item) => item.sessionId)).toEqual(["0000aaaa-0000-4000-8000-00000000000a", null]);
  // The old key is left as it was.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.assistant")!).items.length)).toBe(4);
});

test("answers are spoken when the voice is on, and any answer can be heard again", async ({ page }) => {
  await start(page, { assistant: { reply: "Às suas ordens. Os sistemas estão operacionais.", delayMs: 20 }, speech: { msPerWord: 250 } });
  const spoken = () => page.evaluate(() => window.__JARVIS_SPEECH_LOG__?.texts ?? []);
  await enter(page);
  // A gesture, so the page may play sound.
  await chat(page).click({ position: { x: 900, y: 300 } });

  // Off by default: written, not said.
  const voice = page.getByRole("button", { name: "Falar as respostas" });
  await expect(voice).toBeEnabled();
  await expect(voice).toHaveAttribute("aria-pressed", "false");
  await send(page, "Status?");
  await expect(answers(page)).toHaveCount(1);
  expect(await spoken()).toEqual([]);

  // Any answer can be heard, and stopped.
  await answers(page).first().getByRole("button", { name: "Ouvir", exact: true }).click();
  await expect.poll(spoken).toEqual(["Às suas ordens. Os sistemas estão operacionais."]);
  const stop = answers(page).first().getByRole("button", { name: "Parar de ouvir" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(answers(page).first().getByRole("button", { name: "Ouvir", exact: true })).toBeVisible();

  // On: each new answer is said as it ends.
  await voice.click();
  await expect(voice).toHaveAttribute("aria-pressed", "true");
  await send(page, "De novo?");
  await expect(answers(page)).toHaveCount(2);
  await expect.poll(async () => (await spoken()).length).toBe(2);
  await expect(answers(page).nth(1).getByRole("button", { name: "Parar de ouvir" })).toBeVisible();
  await expect(answers(page).nth(1).getByRole("button", { name: "Ouvir", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.chatMode")!).speak)).toBe(true);
});

test("the side bar folds away and comes back, and the choice is kept", async ({ page }) => {
  await start(page);
  await enter(page);
  await send(page, "Primeira pergunta");
  await expect(answers(page)).toHaveCount(1);
  const side = page.getByRole("navigation", { name: "Barra lateral do chat" });
  const thread = page.getByTestId("chat-thread");
  const wide = (await side.boundingBox())!.width;
  const before = (await thread.boundingBox())!.width;
  expect(wide).toBe(320);

  // Folded: a strip with the button that brings it back, and the conversation takes the room.
  await page.getByRole("button", { name: "Recolher a barra lateral" }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Notas" })).toHaveCount(0);
  expect((await side.boundingBox())!.width).toBe(48);
  expect((await thread.boundingBox())!.width).toBe(before + wide - 48);
  // The conversation goes on as before.
  await send(page, "Segunda pergunta");
  await expect(answers(page)).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("jarvis.chatMode")!).collapsed)).toBe(true);

  // Kept across a reload; then back.
  await page.reload();
  await expect(chat(page)).toBeVisible();
  await expect(side).toHaveAttribute("data-collapsed", "true");
  await expect(questions(page)).toHaveText(["Primeira pergunta", "Segunda pergunta"]);
  await page.getByRole("button", { name: "Mostrar a barra lateral" }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Recolher a barra lateral" })).toBeVisible();
  expect((await side.boundingBox())!.width).toBe(320);
});
