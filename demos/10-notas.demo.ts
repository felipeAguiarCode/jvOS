import { MEETING_NOTE, RESEARCH_NOTE } from "./lib/fixtures";
import { expect, test } from "./lib/demo";

// 17:30 · O JARVIS escreve: a meeting summary and a web research note, written live into Jarvis
// Mark with its preview, then a line added by hand.

test("10 · O JARVIS escreve", async ({ demo }) => {
  await demo.start({ at: "2026-11-04T17:30" });

  await demo.ask("Jarvis, salva um resumo da reunião de hoje nas notas.", {
    reply: "Salvo nas notas, com as decisões e os próximos passos.",
    delayMs: 85,
    files: [{ path: "C:\\JARVIS\\Notas\\2026-11-04 Reunião de hoje.md", content: MEETING_NOTE }],
  });
  const mark = demo.dialog("Jarvis Mark");
  await expect(mark).toBeVisible({ timeout: 15_000 });
  await demo.replied();
  await demo.beat(2500);

  await demo.ask(
    "Pesquisa sobre fusão nuclear.",
    {
      reply: "Pronto. A pesquisa sobre fusão nuclear está nas notas, com as fontes no fim.",
      delayMs: 75,
      files: [{ path: "C:\\JARVIS\\Notas\\2026-11-04 Pesquisa - fusão nuclear.md", content: RESEARCH_NOTE }],
    },
    { shortcut: "research", text: "fusão nuclear." },
  );
  await demo.replied();
  await demo.beat(2000);

  // A line by hand, at the end.
  await mark.locator(".cm-content").click();
  await demo.press("Control+End", 400);
  await demo.type("\n## Para ler\n\n- O artigo do **SPARC**, no fim de semana.", 65);
  await demo.beat(3500);
});
