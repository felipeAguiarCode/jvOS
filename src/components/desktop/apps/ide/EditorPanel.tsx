import { useEffect, useRef, useState, type MouseEvent, type Ref, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import { dirName } from "../../../../lib/paths";
import { MenuPopup, type MenuSection } from "../../widgets/WidgetMenu";
import { useIde, useStore } from "./context";
import { formatSize } from "./format";
import { PanelFrame, usePanelFocus } from "./PanelFrame";
import type { BufferMeta } from "./types";

/** The editor panel: tabs, the single CodeMirror view, and what replaces it (welcome, binary…). */
export function EditorPanel({ id }: { id: string }) {
  const store = useStore();
  const state = useIde();
  const active = store.buffer(state.active);
  const tabs = useRef<HTMLDivElement>(null);
  usePanelFocus(id, () => {
    if (active?.view === "text") store.focusEditor();
    else tabs.current?.querySelector<HTMLElement>("[aria-selected=true], button")?.focus();
  });
  const title = active?.path ? dirName(active.path) : (state.root ?? "jv_ide");

  return (
    <PanelFrame id={id} label="Editor" title={title}>
      <div className="flex h-full flex-col">
        <TabStrip ref={tabs} />
        {active && <DiskNotice meta={active} />}
        <div className="relative min-h-0 flex-1">
          <EditorHost hidden={active?.view !== "text"} effects={state.prefs.effects} />
          {!active && <Welcome />}
          {active && active.view !== "text" && <BufferMessage meta={active} />}
        </div>
      </div>
    </PanelFrame>
  );
}

/** One EditorView for every tab; the store swaps the tabs' states in and out of it. */
function EditorHost({ hidden, effects }: { hidden: boolean; effects: boolean }) {
  const store = useStore();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new EditorView({ parent: host.current! });
    store.attachView(view);
    return () => {
      store.detachView(view);
      view.destroy();
    };
  }, [store]);
  return (
    <div
      ref={host}
      data-allow-context-menu
      data-testid="ide-editor"
      className={`absolute inset-0 overflow-hidden select-text ${hidden ? "hidden" : ""} ${effects ? "" : "[&_.cm-editor]:[text-shadow:none]"}`}
    />
  );
}

function TabStrip({ ref }: { ref: Ref<HTMLDivElement> }) {
  const store = useStore();
  const { buffers, active } = useIde();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLButtonElement>(null);

  // The active tab stays in sight.
  useEffect(() => {
    const strip = (ref as RefObject<HTMLDivElement | null>).current;
    strip?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, buffers.length, ref]);

  const sections: MenuSection[] = [
    {
      title: "Abas abertas",
      items: buffers.map((buffer) => ({
        kind: "radio" as const,
        label: `${buffer.title}${buffer.dirty ? " ●" : ""}`,
        checked: buffer.id === active,
        onSelect: () => {
          setMenu(null);
          void store.activate(buffer.id, { focus: true });
        },
      })),
    },
    {
      items: [
        { kind: "action", label: "Salvar tudo", detail: "Ctrl+Alt+S", onSelect: () => void store.saveAll() },
        { kind: "action", label: "Fechar as salvas", onSelect: () => store.closeSaved(), disabled: !buffers.length },
        { kind: "action", label: "Fechar as outras", onSelect: () => active && store.closeOthers(active), disabled: !active },
        { kind: "action", label: "Reabrir a última fechada", detail: "Ctrl+Shift+T", onSelect: () => store.reopenClosed() },
      ],
    },
  ];

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom });
  };

  return (
    <div className="flex h-[18px] shrink-0 items-stretch text-[12px] leading-[18px]">
      <button
        ref={list}
        type="button"
        aria-label="Lista de abas"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={openMenu}
        className="shrink-0 cursor-pointer px-1 text-hud-cyan outline-none hover:bg-hud-light/85 hover:text-hud-void focus-visible:bg-hud-light/85 focus-visible:text-hud-void"
      >
        [≡]
      </button>
      <div ref={ref} role="tablist" aria-label="Abas abertas" className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        {buffers.map((buffer) => (
          <Tab key={buffer.id} meta={buffer} active={buffer.id === active} />
        ))}
      </div>
      {menu && <MenuPopup at={menu} label="Abas" sections={sections} container={store.container} onClose={() => setMenu(null)} onDismiss={() => (setMenu(null), list.current?.focus())} />}
    </div>
  );
}

function Tab({ meta, active }: { meta: BufferMeta; active: boolean }) {
  const store = useStore();
  return (
    <span
      className={`group flex shrink-0 items-center ${active ? "bg-hud-light/85 text-hud-void" : "text-hud-text/75 hover:text-hud-light"} ${meta.preview ? "italic" : ""}`}
      data-preview={meta.preview || undefined}
      data-dirty={meta.dirty || undefined}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={meta.path ?? meta.title}
        onClick={() => void store.activate(meta.id, { focus: true })}
        onDoubleClick={() => store.pin(meta.id)}
        onAuxClick={(event) => event.button === 1 && store.closeBuffer(meta.id)}
        className={`cursor-pointer pl-2 outline-none focus-visible:underline ${meta.disk === "deleted" ? "line-through" : ""}`}
      >
        {meta.title}
        {meta.disk === "deleted" && <span className="no-underline"> (excluído)</span>}
        {meta.dirty && <span className={active ? "" : "text-hud-light"}> ●</span>}
      </button>
      <button
        type="button"
        aria-label={`Fechar ${meta.title}`}
        title="Fechar (Ctrl+W)"
        onClick={() => store.closeBuffer(meta.id)}
        className={`cursor-pointer px-1.5 outline-none ${active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"}`}
      >
        ×
      </button>
    </span>
  );
}

/** A file that changed or vanished on disk under the open tab. */
function DiskNotice({ meta }: { meta: BufferMeta }) {
  const store = useStore();
  if (meta.disk === "changed") {
    return (
      <div role="alertdialog" aria-label="Conflito com o disco" className="flex shrink-0 flex-wrap items-center gap-x-2 bg-hud-alert/15 px-2 text-[12px] leading-[18px]">
        <span className="text-hud-alert">{meta.title} mudou fora do jv_ide.</span>
        <NoticeButton onClick={() => void store.reloadFromDisk(meta.id)}>Recarregar</NoticeButton>
        <NoticeButton onClick={() => void store.keepMine(meta.id)}>Manter as minhas</NoticeButton>
        <NoticeButton onClick={() => void store.compareWithDisk(meta.id)}>Comparar</NoticeButton>
      </div>
    );
  }
  if (meta.disk === "deleted") {
    return (
      <div role="status" className="shrink-0 bg-hud-alert/10 px-2 text-[12px] leading-[18px] text-hud-alert">
        {meta.title} foi excluído do disco · Ctrl+S cria de novo
      </div>
    );
  }
  return null;
}

function NoticeButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="cursor-pointer text-hud-text outline-none hover:text-hud-light focus-visible:text-hud-light">
      [{children}]
    </button>
  );
}

function BufferMessage({ meta }: { meta: BufferMeta }) {
  const text =
    meta.view === "binary"
      ? `arquivo binário (${formatSize(meta.size)}) — não editável`
      : meta.view === "large"
        ? `arquivo grande demais (${formatSize(meta.size)}) — o jv_ide abre até 5 MB`
        : meta.view === "error"
          ? (meta.message ?? "não foi possível abrir")
          : "carregando…";
  return (
    <div data-testid="ide-buffer-message" className={`flex h-full items-center justify-center px-4 text-center ${meta.view === "error" ? "text-hud-alert" : "text-hud-text/55"}`}>
      {text}
    </div>
  );
}

function Welcome() {
  const store = useStore();
  const { root, recent } = useIde();
  const hint = (keys: string, label: string, run: () => void) => (
    <button type="button" onClick={run} className="group flex cursor-pointer items-center gap-1.5 text-left outline-none">
      <span className="bg-hud-text/12 px-1 text-hud-cyan group-hover:bg-hud-light/85 group-hover:text-hud-void group-focus-visible:bg-hud-light/85 group-focus-visible:text-hud-void">{keys}</span>
      <span className="text-hud-text/70 group-hover:text-hud-light">{label}</span>
    </button>
  );
  return (
    <div data-testid="ide-welcome" className="flex h-full flex-col justify-center gap-3 overflow-auto px-6 py-4 text-[12px]">
      <pre aria-hidden className="leading-tight text-hud-light/80">{"┌──────────────────────┐\n│  jv_ide · JARVIS OS  │\n└──────────────────────┘"}</pre>
      <div className="flex flex-col gap-1">
        {hint("Ctrl+O", "abrir pasta", () => void store.pickFolder())}
        {root && hint("Ctrl+P", "abrir arquivo", () => store.openPalette("files"))}
        {hint("Ctrl+N", "novo arquivo", () => void store.newUntitled())}
        {hint("Ctrl+Shift+P", "comandos", () => store.openPalette("commands"))}
        {hint("Ctrl+`", "terminal", () => void store.toggleTerminal())}
      </div>
      {!root && recent.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-hud-text/45">Projetos recentes</span>
          {recent.slice(0, 9).map((path, index) => (
            <button key={path} type="button" onClick={() => void store.openProject(path)} className="cursor-pointer truncate text-left text-hud-text/75 outline-none hover:text-hud-light focus-visible:text-hud-light">
              [{index + 1}] {path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
