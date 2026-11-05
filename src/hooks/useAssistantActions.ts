import { useCallback, useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { addDays, agendaReport, dateKey } from "../lib/agenda";
import { agentRequests, type AgentAsk, type ToolReply } from "../lib/agents";
import type { WindowKind } from "../lib/desktop";
import { MAX_WATCHED, quotesReport, weatherReport } from "../lib/feeds";
import { normalize, searchCommands, type Command } from "../lib/search";
import { describeDuration, MAX_REMINDER_MINUTES, statusReport, type MachineState } from "../lib/shortcuts";
import { idOf, tasksReport } from "../lib/tasks";
import type { Agenda } from "./useAgenda";
import type { Tasks } from "./useTasks";
import type { Watchlist } from "./useWatchlist";
import type { WeatherFeed } from "./useWeather";

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
  /** The machine right now (meters, battery, music). */
  machine: () => Promise<MachineState>;
  /** Sets a reminder; false when it could not be set. */
  remind: (minutes: number, text: string) => boolean;
  /** The Ações, Clima, Agenda and Tarefas widgets' data. */
  stocks: Watchlist;
  weather: WeatherFeed;
  agenda: Agenda;
  tasks: Tasks;
  /** Shows a widget (opening it, or bringing it to the front). */
  show: (kind: WindowKind) => void;
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
/** A price or a number of minutes, as a number or as text ("60,5"). */
const amount = (value: unknown) => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(number) ? number : null;
};

/**
 * JARVIS's hands on the jvOS: the tool calls its MCP server hands over (`assistant:action`),
 * carried out here and answered back to Claude Code. `run` also serves the dev probe.
 */
export function useAssistantActions({ commands, openAgents, notify, machine, remind, stocks, weather, agenda, tasks, show }: AssistantActionsOptions) {
  const latest = useRef({ commands, openAgents, notify, machine, remind, stocks, weather, agenda, tasks, show });
  latest.current = { commands, openAgents, notify, machine, remind, stocks, weather, agenda, tasks, show };

  const askAgents = useCallback((request: AgentAsk) => {
    latest.current.openAgents();
    return new Promise<ToolReply>((resolve) => agentRequests.send({ ...request, reply: resolve }));
  }, []);

  const run = useCallback(
    async (tool: string, args: Record<string, unknown>): Promise<ToolReply> => {
      const { commands, notify, machine, remind, stocks, weather, agenda, tasks, show } = latest.current;
      switch (tool) {
        case "system_status":
          return { ok: true, text: statusReport(await machine(), new Date()) };
        case "reminder_set": {
          const minutes = typeof args.minutes === "number" ? args.minutes : Number(args.minutes);
          const what = text(args.text);
          if (!(minutes > 0) || minutes > MAX_REMINDER_MINUTES) return { ok: false, text: `Minutos fora do intervalo (1 a ${MAX_REMINDER_MINUTES})` };
          if (!remind(minutes, what)) return { ok: false, text: "Não consegui agendar o lembrete" };
          return { ok: true, text: `Lembrete agendado para daqui a ${describeDuration(minutes)}: ${what || "timer"}` };
        }
        case "stocks_quote": {
          const asked = Array.isArray(args.symbols) ? args.symbols.map(text).filter(Boolean) : [];
          const symbols = (asked.length ? asked : stocks.symbols).slice(0, MAX_WATCHED);
          if (!symbols.length) return { ok: false, text: "Nenhum código pedido e o widget Ações está vazio" };
          return { ok: true, text: quotesReport(await stocks.refresh(symbols)) };
        }
        case "stocks_watch": {
          const symbol = text(args.symbol);
          if (args.remove === true) {
            stocks.unwatch(symbol);
            return { ok: true, text: `${symbol.toUpperCase()} saiu do widget Ações` };
          }
          const watched = stocks.watch(symbol);
          if (!watched) return { ok: false, text: `Código inválido ou lista cheia (máximo ${MAX_WATCHED}): ${symbol}` };
          show("stocks");
          const [quote] = await stocks.refresh([watched]);
          return { ok: true, text: `${watched} no widget Ações. ${quote ? quotesReport([quote]) : ""}`.trim() };
        }
        case "stocks_alert": {
          const symbol = text(args.symbol);
          if (args.remove === true) {
            stocks.removeAlerts(symbol);
            return { ok: true, text: `Alertas de ${symbol.toUpperCase()} apagados` };
          }
          const alert = stocks.addAlert(symbol, amount(args.above), amount(args.below));
          if (!alert) return { ok: false, text: "Passe o código e um preço above e/ou below maior que zero" };
          show("stocks");
          notify(`Alerta: ${alert.symbol}${alert.above !== null ? ` ≥ ${alert.above}` : ""}${alert.below !== null ? ` ≤ ${alert.below}` : ""}`);
          // The price may already be past it: looked at right away.
          const [quote] = await stocks.refresh([alert.symbol]).catch(() => []);
          return { ok: true, text: `Alerta criado para ${alert.symbol}. ${quote ? `Agora: ${quotesReport([quote])}` : ""}`.trim() };
        }
        case "weather": {
          const city = text(args.city);
          if (!city && !weather.city) return { ok: false, text: "O widget Clima não tem cidade: pergunte ao usuário e chame de novo com city" };
          return { ok: true, text: weatherReport(await weather.forecast(city || undefined)) };
        }
        case "agenda_add": {
          const added = agenda.add({ title: text(args.title), date: text(args.date), time: text(args.time) || null, notify: amount(args.notify) });
          if (typeof added === "string") return { ok: false, text: added };
          // The widget shows the day it went on.
          show("agenda");
          notify(`Agenda: ${added.title}`);
          return { ok: true, text: `Marcado: ${agendaReport([added])}` };
        }
        case "agenda_list": {
          const from = text(args.from) || dateKey(new Date());
          const to = text(args.to) || addDays(from, 7);
          return { ok: true, text: agendaReport(agenda.between(from, to)) };
        }
        case "agenda_remove": {
          const id = idOf(args.id);
          const removed = id === null ? null : agenda.remove(id);
          return removed ? { ok: true, text: `Apagado: ${removed.title}` } : { ok: false, text: "Nenhum compromisso com esse número (veja agenda_list)" };
        }
        case "tasks_add": {
          const added = tasks.add(text(args.text));
          if (typeof added === "string") return { ok: false, text: added };
          show("tasks");
          notify(`Tarefa ${added.id}: ${added.text}`);
          return { ok: true, text: `Na lista como tarefa ${added.id}: ${added.text}` };
        }
        case "tasks_list":
          return { ok: true, text: tasksReport(tasks.list()) };
        case "tasks_done": {
          const id = idOf(args.id);
          const task = id === null ? null : tasks.setDone(id, args.done !== false);
          if (!task) return { ok: false, text: "Nenhuma tarefa com esse número (veja tasks_list)" };
          return { ok: true, text: `${task.done ? "Feita" : "De volta a pendente"}: ${task.id}, ${task.text}` };
        }
        case "tasks_remove": {
          const id = idOf(args.id);
          const removed = id === null ? null : tasks.remove(id);
          return removed ? { ok: true, text: `Apagada: ${removed.id}, ${removed.text}` } : { ok: false, text: "Nenhuma tarefa com esse número (veja tasks_list)" };
        }
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
