import { useCallback } from "react";
import { useStoredState } from "../lib/storage";
import { MAX_%%CONST%%_ITEMS, next%%pascal%%Id, parse%%pascal%%, tidy%%pascal%%Text, type %%pascal%%Item } from "../lib/%%kind%%";

const %%CONST%%_KEY = "jarvis.%%kind%%";

/** The %%title%% %%groupLabel%%'s list, kept in localStorage (`jarvis.%%kind%%`) and written at once: it is the user's data. */
export function use%%pascal%%() {
  const [items, setItems] = useStoredState<%%pascal%%Item[]>(%%CONST%%_KEY, [], parse%%pascal%%, 0);

  /** Adds an entry; what is wrong, in PT-BR, when it cannot. */
  const add = useCallback(
    (text: string): %%pascal%%Item | string => {
      const clean = tidy%%pascal%%Text(text);
      if (!clean) return "Escreva alguma coisa.";
      if (items.length >= MAX_%%CONST%%_ITEMS) return `A lista está cheia (${MAX_%%CONST%%_ITEMS}).`;
      const item = { id: next%%pascal%%Id(items), text: clean };
      setItems([...items, item]);
      return item;
    },
    [items, setItems],
  );

  const remove = useCallback((id: number) => setItems((list) => list.filter((item) => item.id !== id)), [setItems]);

  return { items, add, remove };
}

/** What the %%title%% %%groupLabel%% shows and changes. */
export type %%pascal%% = ReturnType<typeof use%%pascal%%>;
