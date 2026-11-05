import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Play } from "lucide-react";
import { agentSheet, progressBar, STEPS, stepsDone } from "../../../../lib/agentFigure";
import { agentNameOf, agentProblems, agentRequests, frontmatter, launchAgent, listDrafts, readDraft, rememberDraft, writeDraft, type AgentRequest } from "../../../../lib/agents";
import { assistantFolder, type AssistantFolder } from "../../../../lib/assistant";
import { canUseFiles, pickFolder, samePath } from "../../../../lib/files";
import { draftRequests, type FileRequest } from "../../../../lib/requests";
import { AgentFigure, type FigureState } from "./AgentFigure";
import { AgentSession, type AgentConversation, type SessionEvent } from "./AgentSession";

// The editor (CodeMirror) only loads for the second tab: fetched when the pointer reaches it.
const loadEditor = () => import("./AgentEditor");
const AgentEditor = lazy(() => loadEditor().then((module) => ({ default: module.AgentEditor })));

/** The user's own edits reach the disk after this pause, so JARVIS reads them before its next one. */
const SAVE_MS = 600;
const CHECK_MS = 300;
/** The session shows the conversation from a little before the window opened (the first question opens it). */
const SESSION_LOOKBACK_MS = 5 * 60_000;
const MAX_EVENTS = 100;

const STATE_LABEL: Record<FigureState | "changed", string> = {
  empty: "nenhum agente aberto",
  draft: "rascunho",
  live: "JARVIS escrevendo",
  problem: "com pendências",
  review: "em revisão",
  changed: "alterado depois da revisão",
  running: "rodando no jv_sh",
};

const HINT: Record<FigureState | "changed", string> = {
  empty: "diga “Jarvis, vamos criar um agente”",
  draft: "responda ao JARVIS; pronto, ele mostra o agente para revisão",
  live: "o JARVIS está escrevendo o agente…",
  problem: "responda ao JARVIS ou corrija o arquivo em [2]",
  review: "diga “pode rodar” ou clique em Rodar uma vez",
  changed: "mudou depois da revisão: peça ao JARVIS para revisar de novo",
  running: "acompanhe e aprove as permissões no jv_sh",
};

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
 * jv_agent: the Claude Code agents JARVIS writes with the user by voice, as a terminal. The
 * workshop shows the agent in ASCII, built part by part as the interview fills the draft in, its
 * sheet and the review (where it works, the first task) with "Rodar uma vez", which installs it as
 * the user's Claude Code subagent and runs it in a jv_sh tab; beside it, the session: the interview
 * said to JARVIS and what happened to the agent. The draft itself is in the second tab, to edit.
 */
export function AgentApp({ conversation = null }: { conversation?: AgentConversation | null }) {
  const [tab, setTab] = useState<"workshop" | "file">("workshop");
  const [openedAt] = useState(() => Date.now());
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const log = useCallback((icon: SessionEvent["icon"], text: string) => setEvents((current) => [...current, { at: Date.now(), icon, text }].slice(-MAX_EVENTS)), []);
  /** The agent last run, as it was then. */
  const [launched, setLaunched] = useState<{ name: string; text: string } | null>(null);
  const [folder, setFolder] = useState<AssistantFolder | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** JARVIS is writing the draft right now. */
  const [live, setLive] = useState(false);
  /** A write is under way (its first piece already logged). */
  const writing = useRef(false);
  const [review, setReview] = useState<Review | null>(null);
  const [workFolder, setWorkFolder] = useState("");
  const [task, setTask] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
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
        if (!writing.current) log("✎", `JARVIS escrevendo Agentes/${name}.md`);
        writing.current = true;
        setLive(true);
        rememberDraft(path, content);
        setDraft({ name, path, text: content, saved: content });
        return;
      }
      writing.current = false;
      setLive(false);
      if (content !== null) rememberDraft(path, content);
      const text = await readDraft(path).catch(() => content ?? (current && samePath(current.path, path) ? current.text : ""));
      setDraft({ name, path, text, saved: text });
      setStatus({ text: "Atualizado pelo JARVIS", tone: "info" });
      log("✓", `${name}.md salvo · ${stepsDone(agentSheet(text), false).filter(Boolean).length} de ${STEPS.length - 1} partes`);
      refresh();
    },
    [flush, refresh, agentsDir, log],
  );
  useEffect(() => {
    const pending = draftRequests.take();
    if (pending) void receive(pending);
    return draftRequests.listen((request) => void receive(request));
  }, [receive]);

  const run = useCallback(
    async (name: string, folderPath: string, firstTask: string) => {
      setRunning(true);
      try {
        const text = await launchAgent({ name, folder: folderPath, task: firstTask });
        setStatus({ text, tone: "info" });
        const current = latest.current.draft;
        setLaunched(current?.name === name ? { name, text: current.text } : null);
        log("▶", `claude --agent ${name}${firstTask ? ` “${firstTask}”` : ""} · ${folderPath}`);
        showReview(null);
        return text;
      } catch (error) {
        log("✗", String(error instanceof Error ? error.message : error));
        throw error;
      } finally {
        setRunning(false);
      }
    },
    [showReview, log],
  );

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
        if (found.length) {
          log("⚠", `revisão: ${found.join("; ")}`);
          return request.reply({ ok: false, text: `O agente ainda tem problemas: ${found.join("; ")}` });
        }
        log("→", `em revisão · ${where}${first ? ` · “${first}”` : ""}`);
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
    [open, run, agentsDir, showReview, log],
  );
  useEffect(() => {
    const pending = agentRequests.take();
    if (pending) void handle(pending);
    return agentRequests.listen((request) => void handle(request));
  }, [handle]);

  const fields = draft ? (frontmatter(draft.text) ?? {}) : {};
  const sheet = agentSheet(draft?.text ?? "");
  const changed = review !== null && draft?.name === review.name && draft.text !== review.text;
  const inReview = review !== null && draft?.name === review.name && !changed;
  const canRun = draft !== null && problems.length === 0 && workFolder.trim() !== "" && !running && !live;
  const ran = launched !== null && draft?.name === launched.name && draft.text === launched.text;
  const state: FigureState = !draft ? "empty" : live ? "live" : running || ran ? "running" : inReview ? "review" : problems.length ? "problem" : "draft";
  const said = state === "draft" && changed ? "changed" : state;
  const steps = stepsDone(sheet, inReview || ran);
  const drafts = [...new Set([...names, ...(draft ? [draft.name] : [])])].sort();

  const runNow = () => {
    if (!draft || !canRun) return;
    void run(draft.name, workFolder.trim(), task.trim()).catch((error) => setStatus({ text: String(error instanceof Error ? error.message : error), tone: "error" }));
  };

  return (
    <div data-testid="agent-app" className="flex h-full min-h-0 flex-col font-mono text-[12px]">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-hud-cyan/15 px-3 text-hud-text/70">
        <span className="text-hud-cyan">jarvis@agente</span>
        <span className="truncate">:~/Agentes/{draft ? `${draft.name}.md` : ""}</span>
        <span aria-hidden className="crt-cursor text-hud-light">
          ▌
        </span>
        <span className="flex-1" />
        {live && (
          <span data-testid="agent-live" className="shrink-0 text-hud-amber uppercase">
            ● JARVIS escrevendo
          </span>
        )}
        <div role="tablist" aria-label="Visões do agente" className="flex shrink-0 items-center gap-1">
          {(
            [
              ["workshop", "1", "oficina"],
              ["file", "2", draft ? `${draft.name}.md` : "agente.md"],
            ] as const
          ).map(([id, key, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onPointerEnter={id === "file" ? () => void loadEditor() : undefined}
              onFocus={id === "file" ? () => void loadEditor() : undefined}
              onClick={() => setTab(id)}
              className={`cursor-pointer px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-hud-light/50 ${tab === id ? "bg-hud-light/85 text-hud-void" : "text-hud-text/60 hover:text-hud-light"}`}
            >
              <span aria-hidden>[{key}] </span>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "file" ? (
        <div role="tabpanel" aria-label={draft ? `${draft.name}.md` : "agente.md"} className="min-h-0 flex-1">
          {draft ? (
            <Suspense fallback={<p className="p-6 text-center text-hud-text/50">Carregando o editor…</p>}>
              <AgentEditor doc={draft.text} onChange={(text) => setDraft((current) => (current && current.text !== text ? { ...current, text } : current))} />
            </Suspense>
          ) : (
            <p className="p-6 text-center text-hud-text/55">Nenhum agente aberto. Clique no núcleo e diga: “Jarvis, vamos criar um agente”.</p>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Oficina" className="flex min-h-0 flex-1">
          <section className="hud-scroll flex w-[400px] max-w-[55%] shrink-0 flex-col gap-3 overflow-y-auto border-r border-hud-cyan/15 p-3">
            <div className="flex gap-3">
              <AgentFigure sheet={sheet} state={state} />
              <div className="min-w-0 flex-1 pt-1">
                {draft ? (
                  <>
                    <div data-testid="agent-field-name" className="truncate text-[14px] text-hud-light crt-text">
                      {fields.name ?? sheet.name ?? "—"}
                    </div>
                    <div aria-hidden className="mb-1.5 truncate text-hud-cyan/50">
                      {"─".repeat(Math.max(8, Math.min(24, (fields.name ?? sheet.name ?? "").length)))}
                    </div>
                    <dl className="grid grid-cols-[6ch_1fr] gap-x-2 gap-y-0.5">
                      <dt className="text-hud-cyan">faz</dt>
                      <dd data-testid="agent-field-description" className="line-clamp-3 text-hud-text/85">
                        {fields.description ?? sheet.description ?? "—"}
                      </dd>
                      <dt className="text-hud-cyan">usa</dt>
                      <dd className="truncate text-hud-text/85">{sheet.tools ?? "todas as ferramentas"}</dd>
                      <dt className="text-hud-cyan">modelo</dt>
                      <dd className="truncate text-hud-text/85">{sheet.model ?? "o padrão"}</dd>
                    </dl>
                  </>
                ) : (
                  <div className="space-y-1.5 text-hud-text/55">
                    <p>Nenhum agente aberto.</p>
                    <p>Clique no núcleo e diga: “Jarvis, vamos criar um agente”. Ele monta o agente aqui, parte por parte.</p>
                  </div>
                )}
              </div>
            </div>
            <div data-testid="agent-progress" className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={state === "review" ? "text-hud-amber" : "text-hud-light"}>{progressBar(steps)}</span>{" "}
                <span className="tabular-nums text-hud-text/70">
                  {steps.filter(Boolean).length}/{steps.length}
                </span>{" "}
                <span className={state === "problem" ? "text-hud-alert" : state === "review" || state === "live" ? "text-hud-amber" : "text-hud-text/60"}>· {STATE_LABEL[said]}</span>
              </div>
              <ol aria-label="Etapas" className="flex flex-wrap gap-x-2.5 text-[11px]">
                {STEPS.map((step, index) => (
                  <li key={step} data-done={steps[index] || undefined} className={steps[index] ? "text-hud-light" : "text-hud-text/35"}>
                    {steps[index] ? "✓" : "·"} {step}
                  </li>
                ))}
              </ol>
            </div>
            {draft && (
              <section aria-label="Revisão" data-testid="agent-review" data-state={inReview ? "review" : changed ? "changed" : "draft"} className="space-y-2.5 border-t border-hud-cyan/10 pt-2.5">
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
            <section aria-label="Agentes" className="mt-auto border-t border-hud-cyan/10 pt-2">
              <h3 className="mb-1 text-[10px] tracking-[0.24em] text-hud-text/45 uppercase">Agentes</h3>
              {drafts.length === 0 ? (
                <p className="text-hud-text/45">Nenhum ainda.</p>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {drafts.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => void open(name)}
                        aria-current={draft?.name === name ? "true" : undefined}
                        className={`cursor-pointer px-1.5 outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50 ${draft?.name === name ? "bg-hud-cyan/15 text-hud-light" : "text-hud-text/75"}`}
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
          <AgentSession conversation={conversation} events={events} since={openedAt - SESSION_LOOKBACK_MS} hint={HINT[said]} />
        </div>
      )}
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-hud-cyan/15 px-3 text-[10px] text-hud-text/50">
        <span data-testid="agent-status" className={status?.tone === "error" ? "text-hud-alert" : ""}>
          {status?.text ?? (draft ? (draft.text === draft.saved ? "Salvo" : "Salvando…") : folder ? folder.agents : "")}
        </span>
      </div>
    </div>
  );
}
