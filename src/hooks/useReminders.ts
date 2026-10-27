import { useCallback, useEffect, useRef } from "react";
import { useStoredState } from "../lib/storage";
import { MAX_REMINDER_MINUTES } from "../lib/shortcuts";

export interface Reminder {
  id: number;
  /** What to say then (empty: a plain timer). */
  text: string;
  /** When (ms since the epoch). */
  due: number;
}

const REMINDERS_KEY = "jarvis.reminders";
const MAX_REMINDERS = 50;
/** setTimeout's longest delay; a later reminder is simply looked at again then. */
const MAX_DELAY = 2 ** 31 - 1;

function parseReminders(raw: unknown): Reminder[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((item): item is Reminder => !!item && typeof item.id === "number" && typeof item.text === "string" && typeof item.due === "number")
    .slice(0, MAX_REMINDERS);
}

/**
 * JARVIS's reminders ("me lembra de beber água em 20 minutos"), kept in localStorage so they
 * survive a restart: one that came due while JARVIS was closed goes off when it opens.
 */
export function useReminders(onDue: (reminder: Reminder) => void) {
  const [reminders, setReminders] = useStoredState<Reminder[]>(REMINDERS_KEY, [], parseReminders, 0);
  const latest = useRef(onDue);
  latest.current = onDue;

  useEffect(() => {
    if (!reminders.length) return;
    const next = Math.min(...reminders.map((reminder) => reminder.due));
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        const due = reminders.filter((reminder) => reminder.due <= now);
        if (!due.length) return;
        setReminders((current) => current.filter((reminder) => !due.some((item) => item.id === reminder.id)));
        due.forEach((reminder) => latest.current(reminder));
      },
      Math.min(MAX_DELAY, Math.max(0, next - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [reminders, setReminders]);

  /** Sets one `minutes` from now; returns it (null when out of range). */
  const add = useCallback(
    (minutes: number, text: string): Reminder | null => {
      if (!(minutes > 0) || minutes > MAX_REMINDER_MINUTES) return null;
      const now = Date.now();
      const reminder = { id: now + Math.random(), text: text.trim(), due: now + Math.round(minutes * 60_000) };
      setReminders((current) => [...current, reminder].slice(-MAX_REMINDERS));
      return reminder;
    },
    [setReminders],
  );

  const clear = useCallback(() => setReminders([]), [setReminders]);

  return { reminders, add, clear };
}
