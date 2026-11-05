/** A commitment in the Agenda widget ("Reunião com a Ana", amanhã às 15h). */
export interface AgendaEvent {
  /** Short, to be said ("desmarca o compromisso 3"). */
  id: number;
  title: string;
  /** "AAAA-MM-DD". */
  date: string;
  /** "HH:MM"; null: all day. */
  time: string | null;
  /** Minutes before the time JARVIS says it. */
  notify: number;
  /** Already said (or missed while JARVIS was closed). */
  alerted: boolean;
}

export const DEFAULT_NOTIFY = 10;

export const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
export const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** When the event starts (all-day events: at midnight). */
export const startOf = (event: Pick<AgendaEvent, "date" | "time">) => new Date(`${event.date}T${event.time ?? "00:00"}:00`).getTime();

/** When JARVIS says it. */
export const alertAt = (event: AgendaEvent) => startOf(event) - event.notify * 60_000;

/** Earliest first; all-day events open their day. */
export const byStart = (a: AgendaEvent, b: AgendaEvent) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title);

/** "AAAA-MM-DD" of a local date. */
export function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `days` after the local date `date` ("AAAA-MM-DD"). */
export function addDays(date: string, days: number) {
  const day = new Date(`${date}T00:00:00`);
  day.setDate(day.getDate() + days);
  return dateKey(day);
}

/** The events as data for JARVIS (the `agenda_list` tool). */
export function agendaReport(events: AgendaEvent[]) {
  if (!events.length) return "Nenhum compromisso nesse período.";
  return events.map((event) => `${event.id}: ${event.date} ${event.time ?? "dia todo"} · ${event.title}${event.time ? ` (aviso ${event.notify} min antes)` : ""}`).join("\n");
}
