import { lazy, useState, type ComponentType } from "react";
import type { WindowKind } from "../../lib/desktop";

/**
 * An app loaded on first use, not with the hologram. `preload` fetches it ahead of its window: a
 * window opened once it is in shows the app at once. Opened before, it shows "Carregando…", which
 * React keeps on screen for at least 300 ms however fast the chunk arrives (FALLBACK_THROTTLE_MS).
 */
function lazyApp<P extends object>(load: () => Promise<ComponentType<P>>) {
  let ready: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const preload = () =>
    (loading ??= load().then(
      (component) => (ready = component),
      (error: unknown) => {
        loading = null;
        throw error;
      },
    ));
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function App(props: P) {
    // Chosen once: going from the lazy one to the loaded one would remount the app.
    const [Shown] = useState<ComponentType<P>>(() => ready ?? (Lazy as ComponentType<P>));
    return <Shown {...props} />;
  }
  return Object.assign(App, { preload });
}

// The editors (CodeMirror, Markdown), the terminal and the player load on first use.
export const MarkdownEditor = lazyApp(() => import("./apps/MarkdownEditor").then((module) => module.MarkdownEditor));
export const IdeApp = lazyApp(() => import("./apps/ide/IdeApp").then((module) => module.IdeApp));
export const TapePlayer = lazyApp(() => import("./apps/TapePlayer").then((module) => module.TapePlayer));
export const ShellApp = lazyApp(() => import("./apps/ShellApp").then((module) => module.ShellApp));
export const LabApp = lazyApp(() => import("./apps/lab/LabApp").then((module) => module.LabApp));
export const AgentApp = lazyApp(() => import("./apps/agent/AgentApp").then((module) => module.AgentApp));

const APPS: Partial<Record<WindowKind, { preload: () => Promise<unknown> }>> = {
  markdown: MarkdownEditor,
  ide: IdeApp,
  music: TapePlayer,
  shell: ShellApp,
  lab: LabApp,
  agent: AgentApp,
};

/** Fetches a window's app ahead of opening it (at once for the widgets, which are always in). */
export const preloadWindow = (kind: WindowKind): Promise<unknown> => APPS[kind]?.preload() ?? Promise.resolve();
