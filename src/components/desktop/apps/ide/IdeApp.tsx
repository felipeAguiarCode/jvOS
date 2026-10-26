import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { loadWorkspaceBackend, type WorkspaceBackend } from "../../../../lib/workspace";
import { buildCommands, commandForKey } from "./commands";
import { IdeContext, useIde } from "./context";
import { IdeStatusBar } from "./IdeStatusBar";
import { MenuBar, MENUS, type MenuBarHandle } from "./MenuBar";
import { Minibuffer } from "./Minibuffer";
import { Palette } from "./Palette";
import { PanelLayout } from "./PanelLayout";
import { IdeStore } from "./store";

/** The project drive's usage is read again this often. */
const DISK_POLL_MS = 30_000;

/** jv_ide: a TUI IDE in termide's mould on top of a folder on disk (the desktop app) or the dev fake. */
export function IdeApp({ paused }: { paused: boolean }) {
  const [backend, setBackend] = useState<WorkspaceBackend | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadWorkspaceBackend().then((loaded) => alive && setBackend(loaded));
    return () => {
      alive = false;
    };
  }, []);
  if (backend === undefined) return <div className="flex h-full items-center justify-center font-mono text-xs text-hud-text/50">carregando…</div>;
  if (backend === null) {
    return (
      <div data-testid="ide-app" className="flex h-full items-center justify-center font-mono text-xs text-hud-text/55">
        Disponível no app desktop
      </div>
    );
  }
  return <Ide backend={backend} paused={paused} />;
}

function Ide({ backend, paused }: { backend: WorkspaceBackend; paused: boolean }) {
  const [store] = useState(() => new IdeStore(backend));

  useEffect(() => {
    store.mount();
    const flush = () => store.flush();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      store.unmount();
    };
  }, [store]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => void store.refreshDisk(), DISK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store, paused]);

  return (
    <IdeContext.Provider value={store}>
      <IdeRoot store={store} paused={paused} />
    </IdeContext.Provider>
  );
}

function IdeRoot({ store, paused }: { store: IdeStore; paused: boolean }) {
  const state = useIde();
  const menu = useRef<MenuBarHandle | null>(null);

  // Before CodeMirror, xterm and the window: the IDE's shortcuts win inside it.
  const onKeyDownCapture = (event: KeyboardEvent) => {
    const native = event.nativeEvent;
    const inTerminal = !!(event.target as Element).closest?.("[data-terminal]");
    if (native.altKey && !native.ctrlKey && !native.shiftKey && !native.metaKey && !inTerminal) {
      const index = MENUS.findIndex((item) => item.letter === native.key.toLowerCase());
      if (index >= 0) {
        event.preventDefault();
        event.stopPropagation();
        menu.current?.open(index);
        return;
      }
    }
    const id = commandForKey(native, inTerminal);
    if (!id) return;
    // With no tab open, Ctrl+W goes on to close the window.
    if (id === "tab.close" && !store.state.active) return;
    event.preventDefault();
    event.stopPropagation();
    if (id === "menu.focus") return menu.current?.focus();
    if (id.startsWith("panel.focus:")) return store.focusNth(Number(id.slice(12)));
    const command = buildCommands(store, store.state).get(id);
    if (command && command.enabled !== false) {
      if (store.state.palette && !id.startsWith("palette.")) store.closePalette();
      command.run();
    }
  };

  return (
    <div
      ref={(element) => {
        store.container = element;
      }}
      data-testid="ide-app"
      data-plain-keys
      // A click on something that takes no focus lands here, so the shortcuts keep working.
      tabIndex={-1}
      onKeyDownCapture={onKeyDownCapture}
      className="relative flex h-full flex-col font-mono text-[12px] text-hud-text outline-none select-none"
    >
      <MenuBar
        paused={paused}
        handle={(value) => {
          menu.current = value;
        }}
      />
      <PanelLayout />
      <Minibuffer />
      <IdeStatusBar />
      {state.palette && <Palette key={`${state.palette.mode}:${state.palette.query}`} />}
    </div>
  );
}
