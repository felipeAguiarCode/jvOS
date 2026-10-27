import { useCallback, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { agentRequests, type AgentAsk, type ToolReply } from "../lib/agents";
import { normalize, searchCommands, type Command } from "../lib/search";

/** Mirrors `ActionRequest` in `src-tauri/src/mcp.rs`. */
interface ActionRequest {
  id: number;
  tool: string;
  args: Record<string, unknown>;
}

interface AssistantActionsOptions {
  /** Everything the search bar can run, as it is right now. */
  commands: () => Command[];
  /** Opens jv_agent (agent reviews happen there). */
  openAgents: () => void;
  /** Tells the user what JARVIS did (on the Voice dock item). */
  notify: (text: string) => void;
}

/**
 * The best command for a few words ("relógio", "fechar calculadora", "abre o tema verde"): the
 * whole query first, then without its leading words (spoken verbs the catalog does not know).
 * Without a match, the closest candidates by single words.
 */
export function findCommand(commands: Command[], query: string): { match: Command | null; candidates: Command[] } {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    const rest = words.slice(start);
    // "o", "da", "2d"… alone would match almost anything.
    if (!rest.some((word) => word.length >= 3)) break;
    const found = searchCommands(commands, rest.join(" "));
    if (found.length) return { match: found[0], candidates: found.slice(0, 5) };
  }
  const candidates = [...new Set(words.filter((word) => word.length >= 3).flatMap((word) => searchCommands(commands, word).slice(0, 3)))];
  return { match: null, candidates: candidates.slice(0, 5) };
}

const describe = (command: Command) => `${command.id} — ${command.title} (${command.group})`;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * JARVIS's hands on the jvOS: the tool calls its MCP server hands over (`assistant:action`),
 * carried out here and answered back to Claude Code. `run` also serves the dev probe.
 */
export function useAssistantActions({ commands, openAgents, notify }: AssistantActionsOptions) {
  const latest = useRef({ commands, openAgents, notify });
  latest.current = { commands, openAgents, notify };

  const askAgents = useCallback((request: AgentAsk) => {
    latest.current.openAgents();
    return new Promise<ToolReply>((resolve) => agentRequests.send({ ...request, reply: resolve }));
  }, []);

  const run = useCallback(
    async (tool: string, args: Record<string, unknown>): Promise<ToolReply> => {
      const { commands, notify } = latest.current;
      switch (tool) {
        case "jvos_commands":
          return { ok: true, text: commands().map(describe).join("\n") };
        case "jvos_run": {
          const list = commands();
          const id = text(args.id);
          const query = text(args.query);
          const byId = id ? list.find((command) => command.id === id) : undefined;
          const { match, candidates } = byId ? { match: byId, candidates: [] } : findCommand(list, query || id);
          if (!match) {
            return {
              ok: false,
              text: candidates.length
                ? `Nada certo para "${query || id}". Opções próximas:\n${candidates.map(describe).join("\n")}`
                : `Nenhuma ação do jvOS para "${query || id}". Veja jvos_commands.`,
            };
          }
          match.run();
          notify(`JARVIS: ${match.title}`);
          return { ok: true, text: `Feito: ${match.title}` };
        }
        case "agent_review": {
          const name = text(args.name);
          if (!name) return { ok: false, text: "Falta o nome do agente" };
          return askAgents({ kind: "review", name, folder: text(args.folder) || null, task: text(args.task) || null });
        }
        case "agent_run": {
          const name = text(args.name);
          if (!name) return { ok: false, text: "Falta o nome do agente" };
          return askAgents({ kind: "run", name });
        }
        default:
          return { ok: false, text: `Ferramenta desconhecida: ${tool}` };
      }
    },
    [askAgents],
  );

  // The desktop app's MCP server waits for each answer.
  useEffect(() => {
    if (!isTauri()) return;
    const stop = listen<ActionRequest>("assistant:action", ({ payload }) => {
      void run(payload.tool, payload.args ?? {})
        .catch((error: unknown): ToolReply => ({ ok: false, text: String(error) }))
        .then((reply) => invoke("assistant_action_result", { id: payload.id, ok: reply.ok, text: reply.text }));
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [run]);

  return run;
}
