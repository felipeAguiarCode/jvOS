import { useCallback, useEffect, useState } from "react";
import type { DockItemId, DockNotice } from "../components/QuickDock";

const DURATION_MS = { info: 1700, error: 3200 } as const;

/** One transient message at a time above a dock item, dismissed automatically. */
export function useDockNotice() {
  const [notice, setNotice] = useState<DockNotice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), DURATION_MS[notice.tone]);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const show = useCallback((target: DockItemId, text: string, tone: DockNotice["tone"] = "info") => {
    setNotice({ target, text, tone, key: Date.now() });
  }, []);

  /** Dismisses the item's notice, or only one of the given tone. */
  const clear = useCallback((target: DockItemId, tone?: DockNotice["tone"]) => {
    setNotice((current) => (current?.target === target && (!tone || current.tone === tone) ? null : current));
  }, []);

  return { notice, show, clear };
}
