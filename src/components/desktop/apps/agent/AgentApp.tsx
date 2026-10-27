import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { Bot, FolderOpen, Play } from "lucide-react";
import { agentNameOf, agentProblems, agentRequests, frontmatter, launchAgent, listDrafts, readDraft, rememberDraft, writeDraft, type AgentRequest } from "../../../../lib/agents";
import { assistantFolder, type AssistantFolder } from "../../../../lib/assistant";
import { canUseFiles, pickFolder, samePath } from "../../../../lib/files";
import { draftRequests, type FileRequest } from "../../../../lib/requests";
import { CodeMirror } from "../CodeMirror";

/** The user's own edits reach the disk after this pause, so JARVIS reads them before its next one. */
const SAVE_MS = 600;
const CHECK_MS = 300;

interface Draft {
  name: string;
  path: string;
  text: string;
  /** What is on disk. */
  saved: string;
}

/** The agent JARVIS showed for review: the text that was shown, where and with what it runs. */
interface Review {
  name: string;
  text: string;
  folder: string;
  task: string;
}

interface Status {
  text: string;
  tone: "info" | "error";
}

/**
 * jv_agent: the Claude Code agents JARVIS writes with the user, in a terminal-like editor the
 * user can also type in. Beside it, the drafts and the review card (name, description, tools,
 * where it works, the first task) with "Rodar uma vez", which installs the agent as the user's
 * Claude Code subagent and runs it in a jv_sh tab.
 */
export function AgentApp() {
  const [folder, setFolder] = useState<AssistantFolder | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** JARVIS is writing the draft right now. */
  const [live, setLive] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [workFolder, setWorkFolder] = useState("");
  const [task, setTask] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
  const language = useMemo(() => markdown(), []);
  const latest = useRef({ draft, folder });
  latest.current = { draft, folder };
  // JARVIS can ask to run right after the review, before a render: the review is kept here at once.
  const reviewNow = useRef<Review | null>(null);
  const showReview = useCallback((next: Review | null) => {
    reviewNow.current = next;
    setReview(next);
  }, []);
  /** Where and with what it runs, as edited on the card (the review follows). */
  const editLaunch = (change: Partial<Pick<Review, "folder" | "task">>) => {
    if (change.folder !== undefined) setWorkFolder(change.folder);
    if (change.task !== undefined) setTask(change.task);
    if (reviewNow.current) showReview({ ...reviewNow.current, ...change });
  };

  const refresh = useCallback(() => void listDrafts().then(setNames), []);
  // JARVIS's folder; a request can arrive as the window opens, before it is known.
  const folderLoad = useMemo(() => assistantFolder(), []);
  useEffect(() => {
    void folderLoad.then(setFolder);
    refresh();
  }, [folderLoad, refresh]);
  const agentsDir = useCallback(async () => (latest.current.folder ?? (await folderLoad))?.agents ?? null, [folderLoad]);

  /** The open draft's unsaved edits, on disk now (before another draft takes its place). */
  const flush = useCallback(async () => {
    const current = latest.current.draft;
    if (!current || current.text === current.saved) return;
    await writeDraft(current.path, current.text).catch(() => undefined);
  }, []);

  /** Opens a draft from disk; its own folder is where it works unless told otherwise. */
  const open = useCallback(
    async (name: string): Promise<Draft | null> => {
      const current = latest.current.draft;
      if (current?.name === name) return current;
      const agents = await agentsDir();
      if (!agents) return null;
      const path = `${agents}\\${name}.md`;
      await flush();
      try {
        const text = await readDraft(path);
        const next = { name, path, text, saved: text };
        setDraft(next);
        setWorkFolder(`${agents}\\${name}`);
        return next;
      } catch (error) {
        setStatus({ text: String(error), tone: "error" });
        return null;
      }
    },
    [flush, agentsDir],
  );

  // The user's typing reaches the disk after a short pause (never while JARVIS writes).
  useEffect(() => {
    if (!draft || live || draft.text === draft.saved) return;
    const { path, text } = draft;
    const timer = window.setTimeout(() => {
      void writeDraft(path, text).then(
        () => setDraft((current) => (current?.path === path ? { ...current, saved: text } : current)),
        (error) => setStatus({ text: String(error), tone: "error" }),
      );
    }, SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, live]);

  // What keeps it from running, checked as it changes.
  useEffect(() => {
    if (!draft) return setProblems([]);
    const { name, text } = draft;
    const timer = window.setTimeout(() => void agentProblems(name, text).then(setProblems), CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // JARVIS writing a draft: shown as it is written, then as saved.
  const receive = useCallback(
    async ({ path, content, done }: FileRequest) => {
      const current = latest.current.draft;
      const name = agentNameOf(path);
      if (current && !samePath(current.path, path)) await flush();
      if (current?.name !== name) {
        const agents = await agentsDir();
        setWorkFolder(agents ? `${agents}\\${name}` : "");
      }
      if (!done) {
        if (content === null) return;
        setLive(true);
        rememberDraft(path, content);
        setDraft({ name, path, text: content, saved: content });
        return;
      }
      setLive(false);
      if (content !== null) rememberDraft(path, content);
      const text = await readDraft(path).catch(() => content ?? (current && samePath(current.path, path) ? current.text : ""));
      setDraft({ name, path, text, saved: text });
      setStatus({ text: "Atualizado pelo JARVIS", tone: "info" });
      refresh();
    },
    [flush, refresh, agentsDir],
  );
  useEffect(() => {
    const pending = draftRequests.take();
    if (pending) void receive(pending);
    return draftRequests.listen((request) => void receive(request));
  }, [receive]);

  const run = useCallback(async (name: string, folderPath: string, firstTask: string) => {
    setRunning(true);
    try {
      const text = await launchAgent({ name, folder: folderPath, task: firstTask });
      setStatus({ text, tone: "info" });
      showReview(null);
      return text;
    } finally {
      setRunning(false);
    }
  }, [showReview]);

  // JARVIS showing an agent for review, or running the one under review once the user agreed.
  const handle = useCallback(
    async (request: AgentRequest) => {
      if (request.kind === "review") {
        const shown = await open(request.name);
        if (!shown) return request.reply({ ok: false, text: `Não achei Agentes/${request.name}.md` });
        const found = await agentProblems(shown.name, shown.text);
        setProblems(found);
        const agents = await agentsDir();
        const where = request.folder?.trim() || (agents ? `${agents}\\${shown.name}` : "");
        const first = request.task?.trim() ?? "";
        setWorkFolder(where);
        setTask(first);
        showReview({ name: shown.name, text: shown.text, folder: where, task: first });
        if (found.length) return request.reply({ ok: false, text: `O agente ainda tem problemas: ${found.join("; ")}` });
        const fields = frontmatter(shown.text) ?? {};
        return request.reply({
          ok: true,
          text: `Em revisão no jv_agent: ${shown.name} — ${fields.description ?? ""}. Ferramentas: ${fields.tools || "todas as do Claude Code"}. Pasta: ${where}. Tarefa: ${first || "(nenhuma)"}. Espere o usuário confirmar antes de agent_run.`,
        });
      }
      const shown = reviewNow.current;
      const current = latest.current.draft;
      if (!shown || shown.name !== request.name) return request.reply({ ok: false, text: "Mostre o agente com agent_review antes de rodar." });
      if (current?.name === shown.name && current.text !== shown.text) return request.reply({ ok: false, text: "O agente mudou depois da revisão: chame agent_review de novo." });
      try {
        request.reply({ ok: true, text: await run(shown.name, shown.folder, shown.task) });
      } catch (error) {
        request.reply({ ok: false, text: String(error instanceof Error ? error.message : error) });
      }
    },
    [open, run, agentsDir, showReview],
  );
  useEffect(() => {
    const pending = agentRequests.take();
    if (pending) void handle(pending);
    return agentRequests.listen((request) => void handle(request));
  }, [handle]);

  const fields = draft ? (frontmatter(draft.text) ?? {}) : {};
  const changed = review !== null && draft?.name === review.name && draft.text !== review.text;
  const inReview = review !== null && draft?.name === review.name && !changed;
  const canRun = draft !== null && problems.length === 0 && workFolder.trim() !== "" && !running && !live;

  const runNow = () => {
    if (!draft || !canRun) return;
    void run(draft.name, workFolder.trim(), task.trim()).catch((error) => setStatus({ text: String(error instanceof Error ? error.message : error), tone: "error" }));
  };

  return (
    <div data-testid="agent-app" className="flex h-full min-h-0 flex-col font-mono text-[12px]">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-hud-cyan/15 px-3 text-hud-text/70">
        <span className="text-hud-cyan">jarvis@agente</span>
        <span>:~/Agentes/{draft ? `${draft.name}.md` : ""}</span>
        <span aria-hidden className="crt-cursor text-hud-light">▌</span>
        <span className="flex-1" />
        {live && (
          <span data-testid="agent-live" className="text-hud-amber uppercase">
            ● JARVIS escrevendo
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-hud-cyan/15">
          {draft ? (
            <CodeMirror
              doc={draft.text}
              onChange={(text) => setDraft((current) => (current && current.text !== text ? { ...current, text } : current))}
              language={language}
              wrap
              className="h-full"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-hud-text/55">
              <Bot size={28} strokeWidth={1.4} aria-hidden className="text-hud-cyan/60" />
              <p>Nenhum agente aberto.</p>
              <p>Clique no núcleo e diga: “Jarvis, vamos criar um agente”.</p>
            </div>
          )}
        </div>
        <aside className="hud-scroll flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-3">
          <section aria-label="Agentes">
            <h3 className="mb-1.5 text-[10px] tracking-[0.24em] text-hud-text/45 uppercase">Agentes</h3>
            {names.length === 0 && !draft ? (
              <p className="text-hud-text/45">Nenhum ainda.</p>
            ) : (
              <ul className="space-y-0.5">
                {[...new Set([...names, ...(draft ? [draft.name] : [])])].sort().map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => void open(name)}
                      aria-current={draft?.name === name ? "true" : undefined}
                      className={`w-full cursor-pointer truncate rounded px-2 py-1 text-left outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50 ${draft?.name === name ? "bg-hud-cyan/10 text-hud-light" : "text-hud-text/75"}`}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {draft && (
            <section aria-label="Revisão" data-testid="agent-review" data-state={inReview ? "review" : changed ? "changed" : "draft"} className="space-y-2.5">
              <h3 className="flex items-center gap-2 text-[10px] tracking-[0.24em] text-hud-text/45 uppercase">
                Revisão
                {inReview && <span className="rounded bg-hud-amber/15 px-1.5 py-px text-hud-amber normal-case tracking-normal">em revisão</span>}
                {changed && <span className="rounded bg-hud-cyan/10 px-1.5 py-px text-hud-text/70 normal-case tracking-normal">alterado depois da revisão</span>}
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                <dt className="text-hud-text/45">nome</dt>
                <dd data-testid="agent-field-name" className="truncate text-hud-light">{fields.name ?? "—"}</dd>
                <dt className="text-hud-text/45">faz</dt>
                <dd data-testid="agent-field-description" className="text-hud-text/85">{fields.description ?? "—"}</dd>
                <dt className="text-hud-text/45">usa</dt>
                <dd className="text-hud-text/85">{fields.tools || "todas as ferramentas"}</dd>
                <dt className="text-hud-text/45">modelo</dt>
                <dd className="text-hud-text/85">{fields.model || "o padrão"}</dd>
              </dl>
              <label className="block space-y-1">
                <span className="text-hud-text/45">Pasta de trabalho</span>
                <span className="flex gap-1">
                  <input value={workFolder} onChange={(event) => editLaunch({ folder: event.target.value })} className="hud-input min-w-0 flex-1 px-2 py-1 text-[11px]" />
                  <button
                    type="button"
                    aria-label="Escolher pasta"
                    title="Escolher pasta"
                    disabled={!canUseFiles}
                    onClick={() => void pickFolder("Pasta onde o agente vai trabalhar").then((picked) => picked && editLaunch({ folder: picked }))}
                    className="grid size-7 shrink-0 cursor-pointer place-items-center rounded text-hud-text/70 outline-none hover:bg-hud-cyan/10 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-default disabled:opacity-35"
                  >
                    <FolderOpen size={14} strokeWidth={1.6} aria-hidden />
                  </button>
                </span>
              </label>
              <label className="block space-y-1">
                <span className="text-hud-text/45">Tarefa da primeira execução</span>
                <textarea value={task} onChange={(event) => editLaunch({ task: event.target.value })} rows={3} className="hud-input w-full resize-none px-2 py-1 text-[11px]" />
              </label>
              {problems.length > 0 && (
                <ul data-testid="agent-problems" className="space-y-1 text-hud-alert">
                  {problems.map((problem) => (
                    <li key={problem}>⚠ {problem}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={runNow}
                disabled={!canRun}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-hud-light/40 bg-hud-cyan/10 py-1.5 text-hud-light uppercase tracking-[0.12em] outline-none transition hover:bg-hud-cyan/20 focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-default disabled:opacity-35"
              >
                <Play size={13} strokeWidth={1.8} aria-hidden /> Rodar uma vez
              </button>
              <p className="text-[10px] leading-relaxed text-hud-text/40">Instala como subagente do seu Claude Code e abre uma aba do jv_sh, onde você acompanha e aprova as permissões.</p>
            </section>
          )}
        </aside>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-hud-cyan/15 px-3 text-[10px] text-hud-text/50">
        <span data-testid="agent-status" className={status?.tone === "error" ? "text-hud-alert" : ""}>
          {status?.text ?? (draft ? (draft.text === draft.saved ? "Salvo" : "Salvando…") : folder ? folder.agents : "")}
        </span>
      </div>
    </div>
  );
}
