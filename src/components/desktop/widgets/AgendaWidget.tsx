import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import type { Agenda } from "../../../hooks/useAgenda";
import { dateKey, type AgendaEvent } from "../../../lib/agenda";
import { ReverseRow } from "./tui";

/** A day marked this recently is shown when the widget opens (JARVIS opens it as he marks). */
const FOCUS_MS = 5000;
const ROW_BUTTON = "grid size-4 shrink-0 cursor-pointer place-items-center text-hud-text/40 opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100";

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

/** The first day of the month `months` away from "AAAA-MM". */
function shiftMonth(month: string, months: number) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, index - 1 + months, 1);
  return dateKey(date).slice(0, 7);
}

/** An event's time and title edited in place: Enter or leaving the row saves, Esc cancels (null). */
function EventEditor({ event, onDone }: { event: AgendaEvent; onDone: (changes: { title: string; time: string | null } | null) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);
  // Enter, Esc and the blur of the row going away must not answer twice.
  const answered = useRef(false);
  const finish = (save: boolean) => {
    if (answered.current) return;
    answered.current = true;
    const fields = form.current?.elements;
    const value = (name: string) => (fields?.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    onDone(save ? { title: value("title"), time: value("time") || null } : null);
  };
  useEffect(() => {
    title.current?.focus();
    title.current?.select();
  }, []);
  return (
    <form
      ref={form}
      onSubmit={(submit) => submit.preventDefault()}
      onKeyDown={(key) => {
        // The window's keys (Ctrl+W) wait while typing.
        key.stopPropagation();
        if (key.key === "Enter") {
          key.preventDefault();
          finish(true);
        }
        if (key.key === "Escape") finish(false);
      }}
      onBlur={(blur) => {
        if (!blur.currentTarget.contains(blur.relatedTarget as Node | null)) finish(true);
      }}
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      <input name="time" type="time" defaultValue={event.time ?? ""} aria-label={`Horário do compromisso ${event.id}`} className="w-[9ch] shrink-0 bg-transparent text-hud-cyan outline-none [color-scheme:dark]" />
      <input ref={title} name="title" defaultValue={event.title} maxLength={120} aria-label={`Editar compromisso ${event.id}`} className="min-w-0 flex-1 border border-hud-light/50 bg-transparent px-1 text-hud-text outline-none select-text" />
    </form>
  );
}

/**
 * The user's agenda as a month and the chosen day's commitments, each with its number. JARVIS
 * marks and reads it by voice ("marca reunião amanhã às 15h", "repassa minha agenda",
 * "desmarca o compromisso 3") and says each one before it starts.
 */
export function AgendaWidget({ agenda }: { agenda: Agenda }) {
  const today = dateKey(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The day JARVIS (or an edit) just marked.
  const { focused } = agenda;
  useEffect(() => {
    if (!focused || Date.now() - focused.at > FOCUS_MS) return;
    setSelected(focused.date);
    setMonth(focused.date.slice(0, 7));
  }, [focused]);

  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const length = new Date(year, monthIndex, 0).getDate();
  const cells = [...Array<null>(first.getDay()).fill(null), ...Array.from({ length }, (_, i) => dateKey(new Date(year, monthIndex - 1, i + 1)))];
  const busy = new Set(agenda.events.map((event) => event.date));
  const dayEvents = agenda.events.filter((event) => event.date === selected);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const added = agenda.add({ title, date: selected, time: time || null });
    if (typeof added === "string") return setProblem(added);
    setTitle("");
    setTime("");
    setProblem(null);
  };

  const pick = (date: string) => {
    setSelected(date);
    setMonth(date.slice(0, 7));
  };

  const change = (id: number, changes: { title: string; time: string | null } | null) => {
    setEditing(null);
    if (!changes) return;
    const changed = agenda.update(id, changes);
    setProblem(typeof changed === "string" ? changed : null);
  };

  return (
    <div className="flex h-full flex-col font-mono text-[12px] select-text">
      <ReverseRow
        left={MONTH.format(first)}
        right={
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="cursor-pointer outline-none">
              <ChevronLeft size={12} strokeWidth={2} />
            </button>
            <button type="button" onClick={() => pick(today)} className="cursor-pointer px-1 outline-none">
              hoje
            </button>
            <button type="button" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))} className="cursor-pointer outline-none">
              <ChevronRight size={12} strokeWidth={2} />
            </button>
          </span>
        }
      />
      <div role="group" aria-label="Calendário" className="grid grid-cols-7 gap-px px-2 pt-1 text-center">
        {WEEKDAYS.map((weekday, index) => (
          <span key={index} aria-hidden className="text-[10px] text-hud-text/40">
            {weekday}
          </span>
        ))}
        {cells.map((date, index) =>
          date ? (
            <button
              key={date}
              type="button"
              aria-label={`${DAY.format(new Date(`${date}T00:00:00`))}${busy.has(date) ? ", com compromissos" : ""}`}
              aria-pressed={date === selected}
              onClick={() => setSelected(date)}
              className={`relative cursor-pointer rounded-sm py-0.5 tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-hud-light/60 ${
                date === selected ? "bg-hud-light/85 text-hud-void" : date === today ? "text-hud-light ring-1 ring-hud-cyan/40" : "text-hud-text/80 hover:bg-hud-cyan/10"
              }`}
            >
              {Number(date.slice(8))}
              {busy.has(date) && <span aria-hidden className={`absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full ${date === selected ? "bg-hud-void" : "bg-hud-cyan"}`} />}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
      <div className="mt-1 border-t border-hud-cyan/10 px-2 pt-1 text-[11px] text-hud-text/60">{DAY.format(new Date(`${selected}T00:00:00`))}</div>
      <ul aria-label="Compromissos do dia" className="min-h-0 flex-1 overflow-y-auto px-2">
        {dayEvents.map((event) => (
          <li key={event.id} data-event={event.id} className="group flex items-center gap-2 py-0.5">
            <span className="w-[3ch] shrink-0 text-right tabular-nums text-hud-text/45">#{event.id}</span>
            {editing === event.id ? (
              <EventEditor event={event} onDone={(changes) => change(event.id, changes)} />
            ) : (
              <>
                <span className="w-[5ch] shrink-0 tabular-nums text-hud-cyan">{event.time ?? "dia"}</span>
                <span onDoubleClick={() => setEditing(event.id)} className="min-w-0 flex-1 truncate text-hud-text">
                  {event.title}
                </span>
              </>
            )}
            <button type="button" aria-label={`Editar ${event.title}`} onClick={() => setEditing(event.id)} className={`${ROW_BUTTON} hover:text-hud-light`}>
              <Pencil size={10} strokeWidth={1.8} />
            </button>
            <button type="button" aria-label={`Apagar ${event.title}`} onClick={() => agenda.remove(event.id)} className={`${ROW_BUTTON} hover:text-hud-alert`}>
              <X size={11} strokeWidth={1.8} />
            </button>
          </li>
        ))}
        {!dayEvents.length && <li className="py-0.5 text-hud-text/40">Nada marcado.</li>}
      </ul>
      {problem && <p className="px-2 text-[11px] text-hud-alert/85">{problem}</p>}
      <form onSubmit={add} className="flex items-center gap-2 border-t border-hud-cyan/10 px-2 py-1">
        <input type="time" value={time} aria-label="Horário" onChange={(event) => setTime(event.target.value)} className="w-[9ch] shrink-0 bg-transparent text-hud-cyan outline-none [color-scheme:dark]" />
        <input
          value={title}
          aria-label="Novo compromisso"
          placeholder="Novo compromisso"
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-hud-text outline-none placeholder:text-hud-text/30"
        />
      </form>
    </div>
  );
}
