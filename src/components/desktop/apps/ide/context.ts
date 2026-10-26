import { createContext, useContext, useSyncExternalStore } from "react";
import type { IdeStore } from "./store";

export const IdeContext = createContext<IdeStore | null>(null);

export function useStore(): IdeStore {
  const store = useContext(IdeContext);
  if (!store) throw new Error("jv_ide: store missing");
  return store;
}

/** The whole IDE state; re-renders on every change (the editor's text is not in it). */
export function useIde() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Line, column and selection of the active tab. */
export function useCursor() {
  const store = useStore();
  return useSyncExternalStore(store.cursor.subscribe, store.cursor.get);
}

/** Changes on every edit of the active tab. */
export function useDocTick() {
  const store = useStore();
  return useSyncExternalStore(store.docTick.subscribe, store.docTick.get);
}
