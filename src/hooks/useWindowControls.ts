import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HoldPhase } from "../components/QuickDock";

interface WindowControlsOptions {
  onToggleVoice: () => void;
  /** Push-to-talk: M is held instead of toggling; Esc while holding cancels. */
  pushToTalk: boolean;
  onHoldVoice: (phase: HoldPhase) => void;
  onCycleQuality: () => void;
  onOpenSettings: () => void;
  onOpenAdvanced: () => void;
  /** `/` outside a text field opens the search bar. */
  onOpenSearch: () => void;
}

/** Shortcuts without modifiers must not fire while typing in a field. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Delay after which the window is shown even if no frame was rendered yet. */
const REVEAL_FALLBACK_MS = 500;

/**
 * Frameless-window plumbing: reveal after the first frame, keyboard shortcuts (M toggles the
 * microphone, or is held in push-to-talk) and pausing while hidden or minimised. Every Tauri call is guarded so the app also
 * runs in a regular browser.
 */
export function useWindowControls({
  onToggleVoice,
  pushToTalk,
  onHoldVoice,
  onCycleQuality,
  onOpenSettings,
  onOpenAdvanced,
  onOpenSearch,
}: WindowControlsOptions) {
  const [paused, setPaused] = useState(false);
  const revealed = useRef(false);
  const decorated = useRef(false);
  const holdingVoice = useRef(false);
  const handlers = useRef({ onToggleVoice, pushToTalk, onHoldVoice, onCycleQuality, onOpenSettings, onOpenAdvanced, onOpenSearch });
  handlers.current = { onToggleVoice, pushToTalk, onHoldVoice, onCycleQuality, onOpenSettings, onOpenAdvanced, onOpenSearch };

  const reveal = useCallback(() => {
    if (revealed.current || !isTauri()) return;
    revealed.current = true;
    const appWindow = getCurrentWindow();
    void appWindow
      .show()
      .then(() => appWindow.setFocus())
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(reveal, REVEAL_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [reveal]);

  useEffect(() => {
    // Releasing M (or the window losing focus while it is held) ends a push-to-talk hold; Esc cancels it.
    const releaseVoice = (phase: HoldPhase = "send") => {
      if (!holdingVoice.current) return;
      holdingVoice.current = false;
      handlers.current.onHoldVoice(phase);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey || event.metaKey;
      // A terminal owns the keyboard (Ctrl+Q, Ctrl+M… mean something to the shell); F11 still works.
      if (event.key !== "F11" && event.target instanceof Element && event.target.closest("[data-terminal]")) return;

      if (ctrl && event.shiftKey && key === "q") {
        event.preventDefault();
        handlers.current.onCycleQuality();
        return;
      }
      // With Shift the key reads "<" on US and ABNT2 layouts alike, so match the physical key.
      if (ctrl && event.shiftKey && event.code === "Comma") {
        event.preventDefault();
        handlers.current.onOpenAdvanced();
        return;
      }
      if (ctrl && !event.shiftKey && key === ",") {
        event.preventDefault();
        handlers.current.onOpenSettings();
        return;
      }
      if (!ctrl && !event.altKey && event.key === "/" && !isTyping(event.target)) {
        event.preventDefault();
        handlers.current.onOpenSearch();
        return;
      }
      if (!ctrl && !event.altKey && key === "m" && !isTyping(event.target)) {
        if (event.repeat) return;
        if (!handlers.current.pushToTalk) {
          handlers.current.onToggleVoice();
        } else if (!holdingVoice.current) {
          holdingVoice.current = true;
          handlers.current.onHoldVoice("start");
        }
        return;
      }
      if (event.key === "Escape" && holdingVoice.current) {
        releaseVoice("cancel");
        return;
      }
      if (!isTauri()) return;

      const appWindow = getCurrentWindow();
      if (ctrl && !event.shiftKey && key === "q") {
        event.preventDefault();
        void appWindow.close();
      } else if (ctrl && !event.shiftKey && key === "m") {
        event.preventDefault();
        void appWindow.minimize();
      } else if (event.key === "F11") {
        event.preventDefault();
        void appWindow.isFullscreen().then((fullscreen) => appWindow.setFullscreen(!fullscreen));
      } else if (ctrl && event.shiftKey && key === "d") {
        // Escape hatch: bring back the native frame.
        event.preventDefault();
        decorated.current = !decorated.current;
        void appWindow.setDecorations(decorated.current);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "m") releaseVoice();
    };
    const onBlur = () => releaseVoice();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const update = async () => {
      let hidden = document.hidden;
      if (!hidden && isTauri()) hidden = await getCurrentWindow().isMinimized().catch(() => false);
      if (!disposed) setPaused(hidden);
    };

    document.addEventListener("visibilitychange", update);
    if (isTauri()) {
      void getCurrentWindow()
        .onResized(update)
        .then((stop) => (disposed ? stop() : (unlisten = stop)));
    }
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", update);
      unlisten?.();
    };
  }, []);

  return { paused, reveal };
}
