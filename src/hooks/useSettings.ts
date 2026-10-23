import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadModels, loadSettings, saveSettings, type ModelStatus, type Settings } from "../lib/settings";

/** Edits are saved after a short pause in typing. */
const SAVE_DELAY_MS = 450;

/** Settings with optimistic local edits and debounced persistence. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<Settings | null>(null);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      latest.current = loaded;
      setSettings(loaded);
    });
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (!latest.current) return;
    try {
      await saveSettings(latest.current);
      setSaveError(null);
    } catch (error) {
      setSaveError(String(error));
    }
  }, []);

  const update = useCallback(
    (change: (current: Settings) => Settings) => {
      if (!latest.current) return;
      const next = change(latest.current);
      latest.current = next;
      setSettings(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Never lose the last edit when the app closes.
  useEffect(() => {
    const onUnload = () => {
      if (timer.current !== undefined) void flush();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [flush]);

  return { settings, update, flush, saveError };
}

interface ProgressEvent {
  id: string;
  received: number;
  total: number;
}

interface DoneEvent {
  id: string;
  error: string | null;
}

/** Whisper model catalog with download progress (desktop app only). */
export function useModels() {
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(() => void loadModels().then(setModels), []);

  useEffect(() => {
    refresh();
    if (!isTauri()) return;
    const subscriptions = [
      listen<ProgressEvent>("model:progress", ({ payload }) =>
        setProgress((current) => ({ ...current, [payload.id]: payload.total ? payload.received / payload.total : 0 })),
      ),
      listen<DoneEvent>("model:done", ({ payload }) => {
        setProgress(({ [payload.id]: _, ...rest }) => rest);
        setErrors(({ [payload.id]: _, ...rest }) => (payload.error ? { ...rest, [payload.id]: payload.error } : rest));
        refresh();
      }),
    ];
    return () => subscriptions.forEach((subscription) => void subscription.then((stop) => stop()));
  }, [refresh]);

  const download = useCallback(
    async (id: string) => {
      if (!isTauri()) return;
      setErrors(({ [id]: _, ...rest }) => rest);
      setProgress((current) => ({ ...current, [id]: 0 }));
      try {
        await invoke("download_model", { id });
      } catch (error) {
        setErrors((current) => ({ ...current, [id]: String(error) }));
      }
      refresh();
    },
    [refresh],
  );

  return { models, progress, errors, download, refresh };
}
