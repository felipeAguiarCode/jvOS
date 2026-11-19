import { expect, test, type Page } from "@playwright/test";
import { parseContacts } from "../src/lib/agentContacts";
import { MAX_ANSWERING, newConversation, parseConversations, TOO_MANY } from "../src/lib/assistant";
import { parseChatMode } from "../src/lib/chatMode";
import { activeConversation, PLAIN_SETTINGS, waitForFrames } from "./helpers";

// Agents as contacts and answers in the background (.specs/features/agent-contacts/spec.md): each
// conversation has its own Claude Code, here the scripted stand-in of src/lib/assistant.ts.

const SLOW = { reply: "Um momento, estou trabalhando nisso com toda a calma do mundo, senhor.", delayMs: 150 };
const AGENTS = [
  { name: "revisor-pr", description: "Revisa pull requests" },
  { name: "analista", description: "Analisa planilhas" },
];

const chat = (page: Page) => page.getByTestId("chat-view");
const field = (page: Page) => page.getByRole("textbox", { name: "Mensagem para o JARVIS" });
const questions = (page: Page) => page.locator("[data-testid=chat-message][data-role=user] p");
const answers = (page: Page) => page.locator("[data-testid=chat-message][data-role=jarvis]:not([data-live])");
const rows = (page: Page) => page.getByTestId("chat-conversation");
const row = (page: Page, title: string | RegExp) => rows(page).filter({ hasText: title });
const open = (page: Page, title: string) => row(page, title).getByRole("button").first().click();
const working = (page: Page) => page.getByRole("img", { name: "Respondendo" });
const notice = (page: Page) => page.getByTestId("chat-notice");
const who = (page: Page) => page.getByTestId("chat-who");
const log = (page: Page) => page.evaluate(() => window.__JARVIS_ASSISTANT_LOG__!);
const script = (page: Page, options: unknown) => page.evaluate((next) => void (window.__JARVIS_ASSISTANT__ = next as never), options);
const newChat = (page: Page) => page.getByRole("button", { name: "Nova conversa", exact: true }).click();

async function start(page: Page, assistant: unknown = SLOW) {
  await page.addInitScript((options) => {
    window.__JARVIS_ASSISTANT__ = options as never;
  }, assistant);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  // StrictMode writes the stored values back as the app mounts: the seeds go in after that.
  await waitForFrames(page, 10);
  await page.evaluate((settings) => {
    ["jarvis.desktop", "jarvis.assistant", "jarvis.conversations"].forEach((key) => localStorage.removeItem(key));
    localStorage.setItem("jarvis.settings", settings);
    localStorage.setItem("jarvis.core", JSON.stringify({ mode: "2d" }));
    localStorage.setItem("jarvis.chatMode", JSON.stringify({ mode: "chat", section: "conversations", speak: false }));
  }, PLAIN_SETTINGS);
  await page.reload();
  await expect(chat(page)).toBeVisible();
}

async function send(page: Page, text: string) {
  await field(page).fill(text);
  await field(page).press("Enter");
}

test("agent-contacts helpers", () => {
  expect(parseContacts("x")).toEqual([]);
  expect(parseContacts([{ name: "revisor-pr", description: "Revisa PRs" }, { name: "" }, null, { name: "sem-descricao", description: 3 }])).toEqual([
    { name: "revisor-pr", description: "Revisa PRs" },
    { name: "sem-descricao", description: "" },
  ]);

  // A conversation keeps who answers in it and whether it has an answer not read yet.
  expect(newConversation(5, "revisor-pr")).toMatchObject({ id: "c5", agent: "revisor-pr", items: [] });
  expect(newConversation(5)).not.toHaveProperty("agent");
  const parsed = parseConversations({
    activeId: "a",
    conversations: [
      { id: "a", title: "Com agente", agent: "revisor-pr", unread: true, updatedAt: 2, items: [] },
      { id: "b", title: "Nome ruim", agent: "../Bash", unread: "sim", updatedAt: 1, items: [] },
    ],
  })!;
  expect(parsed.conversations[0]).toMatchObject({ agent: "revisor-pr", unread: true });
  expect(parsed.conversations[1]).not.toHaveProperty("agent");
  expect(parsed.conversations[1]).not.toHaveProperty("unread");

  expect(parseChatMode({ mode: "chat", section: "agents", speak: false })).toEqual({ mode: "chat", section: "agents", speak: false, collapsed: false });
  expect(MAX_ANSWERING).toBe(5);
});

test("two conversations are answered at once; one that ends out of sight is marked unread", async ({ page }) => {
  await start(page);
  await send(page, "Primeira");
  await expect(working(page)).toHaveCount(1);
  // Named by its question as it is asked, not when the answer ends.
  await expect(page.getByTestId("chat-title")).toHaveText("Primeira");

  // Another conversation asks while the first one is still being answered.
  await newChat(page);
  await expect(field(page)).toBeEnabled();
  await send(page, "Segunda");
  await expect(questions(page)).toHaveText(["Segunda"]);
  await expect(working(page)).toHaveCount(2);
  await expect(who(page)).toContainText("1 outra conversa em andamento");
  expect((await log(page)).asks.map((item) => item.sessionId)).toEqual([null, null]);

  // Stopping this one leaves the other alone.
  await page.getByRole("button", { name: "Parar", exact: true }).click();
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).first()).toContainText("Interrompida");
  await expect(working(page)).toHaveCount(1);
  expect((await log(page)).cancels).toBe(1);

  // The first one ends out of sight: marked, and the user is told.
  await expect(row(page, "Primeira")).toHaveAttribute("data-unread", "true", { timeout: 30_000 });
  await expect(working(page)).toHaveCount(0);
  await expect(notice(page)).toHaveText('Resposta pronta em "Primeira"');
  await expect(row(page, "Primeira").getByRole("img", { name: "Resposta não lida" })).toBeVisible();
  await open(page, "Primeira");
  await expect(row(page, "Primeira")).not.toHaveAttribute("data-unread", "true");
  await expect(answers(page)).toHaveText([/Um momento, estou trabalhando nisso com toda a calma do mundo, senhor\./]);
  // Each one went on in its own session.
  await expect.poll(async () => (await activeConversation(page))?.sessionId).toBe("fake-session-1");

  // Five at once is the limit: the sixth is told so, and nothing is sent.
  await script(page, { reply: "palavra ".repeat(200), delayMs: 300 });
  await send(page, "Um");
  await open(page, "Segunda");
  await send(page, "Dois");
  for (const text of ["Três", "Quatro", "Cinco"]) {
    await newChat(page);
    await send(page, text);
  }
  await expect(working(page)).toHaveCount(5);
  await newChat(page);
  await send(page, "Seis");
  await expect(notice(page)).toHaveText(TOO_MANY);
  await expect(questions(page)).toHaveCount(0);
  expect((await log(page)).asks).toHaveLength(7);
  // In one of the five, a second question waits for its answer.
  await open(page, "Cinco");
  await expect(page.getByRole("button", { name: "Parar", exact: true })).toBeVisible();
  // Once one is stopped there is room again.
  await page.getByRole("button", { name: "Parar", exact: true }).click();
  await expect(working(page)).toHaveCount(4);
  await open(page, "Nova conversa");
  await send(page, "Seis");
  await expect(working(page)).toHaveCount(5);
});

test("an installed agent is a contact: its conversation is answered by the agent", async ({ page }) => {
  await start(page, { reply: "Certamente.", delayMs: 20, agents: AGENTS });
  await page.getByRole("tab", { name: "Agentes" }).click();
  const contacts = page.getByTestId("agent-contact");
  await expect(contacts).toHaveText([/revisor-pr\s*Revisa pull requests/, /analista\s*Analisa planilhas/]);

  // A contact opens a conversation of its own, back in the conversations.
  await contacts.filter({ hasText: "revisor-pr" }).getByRole("button").click();
  await expect(page.getByRole("tab", { name: "Conversas" })).toHaveAttribute("aria-selected", "true");
  await expect(who(page)).toHaveText("agente revisor-pr");
  await expect(page.getByTestId("chat-empty")).toContainText("Agente revisor-pr");
  await expect(page.getByTestId("chat-empty")).toContainText("as mesmas travas do JARVIS");
  await expect(rows(page)).toHaveCount(2);

  await send(page, "Revise o PR 42");
  await expect(answers(page)).toHaveCount(1);
  await send(page, "E o 43?");
  await expect(answers(page)).toHaveCount(2);
  // The agent answers there, on that conversation's session.
  expect((await log(page)).asks).toEqual([
    { text: "Revise o PR 42", sessionId: null, agent: "revisor-pr" },
    { text: "E o 43?", sessionId: "fake-session-1", agent: "revisor-pr" },
  ]);
  await expect(row(page, "Revise o PR 42")).toHaveAttribute("data-agent", "revisor-pr");
  await expect(row(page, "Revise o PR 42")).toContainText("revisor-pr");
  // Its face is not the core's.
  await expect(page.getByTestId("chat-thread").getByTestId("agent-avatar")).toHaveCount(2);
  await expect(page.getByTestId("chat-thread").getByTestId("core-avatar")).toHaveCount(0);
  await expect.poll(() => activeConversation(page)).toMatchObject({ agent: "revisor-pr", sessionId: "fake-session-1" });

  // JARVIS's own conversations go without an agent.
  await open(page, "Nova conversa");
  await expect(who(page)).toHaveText("JARVIS");
  await expect(page.getByRole("button", { name: "Rodar no terminal" })).toHaveCount(0);
  await send(page, "Que horas são?");
  await expect(answers(page)).toHaveCount(1);
  expect((await log(page)).asks[2]).toEqual({ text: "Que horas são?", sessionId: null });
  await expect(page.getByTestId("chat-thread").getByTestId("core-avatar")).toHaveCount(1);

  // The contact again: a new conversation with it, used again while it is empty.
  for (let times = 0; times < 2; times++) {
    await page.getByRole("tab", { name: "Agentes" }).click();
    await contacts.filter({ hasText: "revisor-pr" }).getByRole("button").click();
    await expect(who(page)).toHaveText("agente revisor-pr");
    await expect(rows(page)).toHaveCount(3);
  }
  // Kept across a reload.
  await page.reload();
  await expect(who(page)).toHaveText("agente revisor-pr");

  // With its own tools it runs in the desktop's terminal.
  await open(page, "Revise o PR 42");
  await page.getByRole("button", { name: "Rodar no terminal" }).click();
  await expect(chat(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "jv_sh" })).toBeVisible();
});

test("without agents the section says how to get one", async ({ page }) => {
  await start(page, { reply: "Certamente.", delayMs: 20 });
  await page.getByRole("tab", { name: "Agentes" }).click();
  await expect(page.getByTestId("agents-list")).toHaveText("Nenhum agente ainda. Peça ao JARVIS para criar um.");
});
