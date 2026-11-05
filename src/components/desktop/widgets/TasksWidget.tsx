import { useState, type FormEvent } from "react";
import { Pencil, X } from "lucide-react";
import type { Tasks } from "../../../hooks/useTasks";
import { EditField, ReverseRow } from "./tui";

const DAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

const ROW_BUTTON = "grid size-4 shrink-0 cursor-pointer place-items-center text-hud-text/40 opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100";

/**
 * The day's to-do list: each task with its number, ticked, edited or deleted here or by voice
 * ("Jarvis, adiciona tarefa comprar pão", "conclui a tarefa 2", "remove a tarefa 3"). It opens
 * by itself while something is pending; done ones go the next day.
 */
export function TasksWidget({ tasks }: { tasks: Tasks }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const done = tasks.tasks.length - tasks.pending.length;

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const added = tasks.add(draft);
    if (typeof added === "string") return setProblem(added);
    setDraft("");
    setProblem(null);
  };

  const rename = (id: number, text: string | null) => {
    setEditing(null);
    if (text === null) return;
    const changed = tasks.update(id, text);
    setProblem(typeof changed === "string" ? changed : null);
  };

  return (
    <div className="flex h-full flex-col font-mono text-[12px] select-text">
      <ReverseRow left={`hoje · ${DAY.format(new Date())}`} right={tasks.tasks.length ? `${done} de ${tasks.tasks.length}` : undefined} />
      {tasks.tasks.length ? (
        <ul aria-label="Tarefas do dia" className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {tasks.tasks.map((task) => (
            <li key={task.id} data-task={task.id} className="group flex items-center gap-2 py-0.5">
              <span className="w-[3ch] shrink-0 text-right tabular-nums text-hud-text/45">#{task.id}</span>
              <button
                type="button"
                role="checkbox"
                aria-checked={task.done !== null}
                aria-label={task.text}
                onClick={() => tasks.setDone(task.id, !task.done)}
                className="shrink-0 cursor-pointer text-hud-cyan outline-none hover:text-hud-light focus-visible:text-hud-light"
              >
                {task.done ? "[x]" : "[ ]"}
              </button>
              {editing === task.id ? (
                <EditField label={`Editar tarefa ${task.id}`} initial={task.text} maxLength={160} onDone={(text) => rename(task.id, text)} />
              ) : (
                <span onDoubleClick={() => setEditing(task.id)} className={`min-w-0 flex-1 truncate ${task.done ? "text-hud-text/40 line-through" : "text-hud-text"}`}>
                  {task.text}
                </span>
              )}
              <button type="button" aria-label={`Editar ${task.text}`} onClick={() => setEditing(task.id)} className={`${ROW_BUTTON} hover:text-hud-light`}>
                <Pencil size={10} strokeWidth={1.8} />
              </button>
              <button type="button" aria-label={`Apagar ${task.text}`} onClick={() => tasks.remove(task.id)} className={`${ROW_BUTTON} hover:text-hud-alert`}>
                <X size={11} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex-1 px-3 py-2 leading-relaxed text-hud-text/55">Nada para hoje. Diga “Jarvis, adiciona tarefa comprar pão” ou digite abaixo.</p>
      )}
      {problem && <p className="px-2 text-[11px] text-hud-alert/85">{problem}</p>}
      <form onSubmit={add} className="flex items-center gap-2 border-t border-hud-cyan/10 px-2 py-1">
        <span className="text-hud-cyan">+</span>
        <input
          value={draft}
          aria-label="Nova tarefa"
          placeholder="Nova tarefa"
          maxLength={160}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-hud-text outline-none placeholder:text-hud-text/30"
        />
      </form>
    </div>
  );
}
