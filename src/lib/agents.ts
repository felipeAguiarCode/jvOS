import { invoke, isTauri } from "@tauri-apps/api/core";
import { baseName, readText, writeText } from "./files";
import { requestChannel } from "./requests";
import type { TerminalProfile } from "./terminal";

/** A tool call's answer, for JARVIS. */
export interface ToolReply {
  ok: boolean;
  text: string;
}

/** JARVIS asking jv_agent to show an agent for review, or to run the one under review. */
export type AgentAsk = { kind: "review"; name: string; folder: string | null; task: string | null } | { kind: "run"; name: string };

/** …with where its answer goes. */
export type AgentRequest = AgentAsk & { reply: (result: ToolReply) => void };

export const agentRequests = requestChannel<AgentRequest>();

/** An agent, reviewed, ready to run once. */
export interface AgentLaunch {
  name: string;
  /** Where it works (absolute). */
  folder: string;
  /** What it is asked to do first (may be empty). */
  task: string;
}

/** A name Claude Code takes for a subagent (same rule as `agents::valid_name`). */
export const isAgentName = (name: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);

/** The agent a draft file is: `Agentes\revisor-pr.md` → `revisor-pr`. */
export const agentNameOf = (path: string) => baseName(path).replace(/\.md$/i, "");

/** The frontmatter's `key: value` lines, or null without one (as `agents::frontmatter`). */
export function frontmatter(text: string): Record<string, string> | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") return fields;
    const colon = line.indexOf(":");
    if (colon > 0 && !/^[\s-]/.test(line)) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/** What keeps a draft from running, in the user's words (the desktop app's own check). */
export async function agentProblems(name: string, text: string): Promise<string[]> {
  if (isTauri()) return invoke<string[]>("agent_problems", { name, text }).catch((error) => [String(error)]);
  const fields = frontmatter(text);
  const found: string[] = [];
  if (!isAgentName(name)) found.push(`O nome "${name}" deve ter só letras minúsculas, números e hífens`);
  if (!fields) return [...found, "Falta o cabeçalho (frontmatter) entre linhas ---"];
  if (fields.name !== name) found.push(fields.name ? `O cabeçalho diz name: ${fields.name}, mas o arquivo é ${name}.md` : "Falta o campo name no cabeçalho");
  if (!fields.description) found.push("Falta a descrição (description) no cabeçalho");
  if (!(text.split("---")[2] ?? "").trim()) found.push("Falta o prompt do agente depois do cabeçalho");
  return found;
}

// Without the desktop app (the browser tests) the drafts live in memory.
const memoryDrafts = new Map<string, string>();

/** The drafts in Documentos\JARVIS\Agentes, by name. */
export async function listDrafts(): Promise<string[]> {
  if (isTauri()) return invoke<string[]>("agent_drafts").catch(() => []);
  return [...memoryDrafts.keys()].sort();
}

export async function readDraft(path: string): Promise<string> {
  if (isTauri()) return readText(path);
  const text = memoryDrafts.get(agentNameOf(path));
  if (text === undefined) throw new Error(`Não achei ${baseName(path)}`);
  return text;
}

export async function writeDraft(path: string, text: string): Promise<void> {
  if (isTauri()) return writeText(path, text);
  memoryDrafts.set(agentNameOf(path), text);
}

/** What JARVIS wrote, where there is no disk to read it back from (browser). */
export function rememberDraft(path: string, text: string) {
  if (!isTauri()) memoryDrafts.set(agentNameOf(path), text);
}

/** The jv_sh tab that runs an agent once. */
export function agentProfile({ name, folder, task }: AgentLaunch): TerminalProfile {
  return { id: `agent:${name}`, name: `Agente ${name}`, commandline: `claude --agent ${name}`, cwd: folder, agent: { name, task } };
}

// Installing and opening jv_sh is the desktop's job (App owns the windows).
let launcher: ((launch: AgentLaunch) => Promise<string>) | null = null;

export function setAgentLauncher(run: (launch: AgentLaunch) => Promise<string>): () => void {
  launcher = run;
  return () => {
    if (launcher === run) launcher = null;
  };
}

/** Installs the agent as the user's Claude Code subagent and runs it in a jv_sh tab. */
export function launchAgent(launch: AgentLaunch): Promise<string> {
  return launcher ? launcher(launch) : Promise.reject(new Error("O jvOS ainda não está pronto"));
}
