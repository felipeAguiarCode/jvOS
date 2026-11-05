import { useCallback, useEffect, useRef, useState } from "react";
import { alertAt, byStart, DEFAULT_NOTIFY, isDate, isTime, startOf, type AgendaEvent } from "../lib/agenda";
import { useStoredState } from "../lib/storage";
import { idOf, smallestFreeId } from "../lib/tasks";

const AGENDA_KEY = "jarvis.agenda";
const MAX_EVENTS = 500;
const MAX_TITLE = 120;
const MAX_NOTIFY = 24 * 60;
/** An alert missed by more than this while JARVIS was closed is not said late. */
const STALE_MS = 60 * 60_000;
const MAX_DELAY = 2 ** 31 - 1;

function parseAgenda(raw: unknown): AgendaEvent[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw
    .filter(
      (item): item is Omit<AgendaEvent, "id"> & { id: unknown } =>
        !!item &&
        typeof item.title === "string" &&
        typeof item.date === "string" &&
        isDate(item.date) &&
        (item.time === null || (typeof item.time === "string" && isTime(item.time))),
    )
    .slice(0, MAX_EVENTS);
  // Numbers stay; the old "ev-…" ids (and repeats) take the lowest free ones, in order.
  const taken = new Set<number>();
  const kept = valid.map((item) => {
    const id = idOf(item.id);
    if (id === null || taken.has(id)) return null;
    taken.add(id);
    return id;
  });
  return valid.map((item, index) => {
    const id = kept[index] ?? smallestFreeId(taken);
    taken.add(id);
    return { ...item, id, notify: typeof item.notify === "number" ? item.notify : DEFAULT_NOTIFY, alerted: item.alerted === true };
  });
}

/** All day, or its time long gone: nothing to say. */
const alreadySaid = (event: AgendaEvent) => !event.time || alertAt(event) <= Date.now() - STALE_MS;

/**
 * The user's agenda (the Agenda widget; JARVIS marks and reads it by voice), kept in
 * localStorage. An event with a time goes off `notify` minutes before it.
 */
export function useAgenda(onDue: (event: AgendaEvent) => void) {
  const [events, setEvents] = useStoredState<AgendaEvent[]>(AGENDA_KEY, [], parseAgenda, 0);
  /** The day of the last event marked or moved, for the widget to show (`at` repeats a day). */
  const [focused, setFocused] = useState<{ date: string; at: number } | null>(null);
  const latest = useRef({ events, onDue });
  latest.current = { events, onDue };

  useEffect(() => {
    const waiting = events.filter((event) => event.time && !event.alerted);
    if (!waiting.length) return;
    const next = Math.min(...waiting.map(alertAt));
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        const due = waiting.filter((event) => alertAt(event) <= now);
        if (!due.length) return;
        setEvents((current) => current.map((event) => (due.some((item) => item.id === event.id) ? { ...event, alerted: true } : event)));
        // Long gone (JARVIS was closed): marked, not said.
        due.filter((event) => now - startOf(event) < STALE_MS).forEach((event) => latest.current.onDue(event));
      },
      Math.min(MAX_DELAY, Math.max(0, next - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [events, setEvents]);

  /** Marks one; returns it, or what is wrong. */
  const add = useCallback(
    (input: { title: string; date: string; time?: string | null; notify?: number | null }): AgendaEvent | string => {
      const title = input.title.trim().slice(0, MAX_TITLE);
      const time = input.time?.trim() || null;
      if (!title) return "Falta o compromisso";
      if (!isDate(input.date)) return "Data inválida (use AAAA-MM-DD)";
      if (time && !isTime(time)) return "Horário inválido (use HH:MM)";
      const current = latest.current.events;
      if (current.length >= MAX_EVENTS) return "A agenda está cheia";
      const notify = Math.round(Math.min(MAX_NOTIFY, Math.max(0, input.notify ?? DEFAULT_NOTIFY)));
      const event: AgendaEvent = { id: smallestFreeId(current.map((item) => item.id)), title, date: input.date, time, notify, alerted: false };
      event.alerted = alreadySaid(event);
      // Read by the next call right away (two marked in a row get two numbers).
      latest.current.events = [...current, event].sort(byStart);
      setEvents(latest.current.events);
      setFocused({ date: event.date, at: Date.now() });
      return event;
    },
    [setEvents],
  );

  /** Changes one (the widget's inline edit); returns it, or what is wrong. */
  const update = useCallback(
    (id: number, changes: { title?: string; date?: string; time?: string | null }): AgendaEvent | string => {
      const found = latest.current.events.find((event) => event.id === id);
      if (!found) return "Esse compromisso não existe mais";
      const title = (changes.title ?? found.title).trim().slice(0, MAX_TITLE);
      const date = changes.date ?? found.date;
      const time = changes.time === undefined ? found.time : changes.time?.trim() || null;
      if (!title) return "Falta o compromisso";
      if (!isDate(date)) return "Data inválida (use AAAA-MM-DD)";
      if (time && !isTime(time)) return "Horário inválido (use HH:MM)";
      const moved = date !== found.date || time !== found.time;
      const event: AgendaEvent = { ...found, title, date, time };
      if (moved) event.alerted = alreadySaid(event);
      latest.current.events = latest.current.events.map((item) => (item.id === id ? event : item)).sort(byStart);
      setEvents(latest.current.events);
      if (date !== found.date) setFocused({ date, at: Date.now() });
      return event;
    },
    [setEvents],
  );

  /** Removes one; returns it (null when there was none). */
  const remove = useCallback(
    (id: number) => {
      const found = latest.current.events.find((event) => event.id === id) ?? null;
      latest.current.events = latest.current.events.filter((event) => event.id !== id);
      setEvents(latest.current.events);
      return found;
    },
    [setEvents],
  );

  /** The events from `from` to `to` ("AAAA-MM-DD", both included), in order. */
  const between = useCallback((from: string, to: string) => latest.current.events.filter((event) => event.date >= from && event.date <= to).sort(byStart), []);

  return { events, focused, add, update, remove, between };
}

export type Agenda = ReturnType<typeof useAgenda>;
