import { Fragment, lazy, Suspense, useRef, type KeyboardEvent, type RefObject } from "react";
import { usePointerDrag } from "../../../../hooks/usePointerDrag";
import { useIde, useStore } from "./context";
import { EditorPanel } from "./EditorPanel";
import { FileTree } from "./FileTree";
import { GitPanel } from "./GitPanel";
import { MIN_COLUMN_PX, MIN_PANEL_PX, resizeColumns, resizePanels } from "./layout";
import { OutlinePanel } from "./OutlinePanel";
import { SearchPanel } from "./SearchPanel";
import type { IdeLayout, PanelSlot } from "./types";

// xterm loads with the first terminal panel, not with the IDE.
const TerminalPanel = lazy(() => import("./TerminalPanel").then((module) => ({ default: module.TerminalPanel })));

/** Arrow keys move a splitter by this share. */
const KEY_STEP = 0.02;

/** Columns of stacked panels with splitters between them; a zoomed panel fills everything. */
export function PanelLayout() {
  const { layout } = useIde();
  const area = useRef<HTMLDivElement>(null);
  const zoom = layout.zoom;
  const zoomColumn = zoom ? layout.columns.find((column) => column.panels.some((panel) => panel.id === zoom))?.id : null;

  return (
    <div ref={area} data-testid="ide-panels" className="flex min-h-0 flex-1 px-1 pt-0.5">
      {layout.columns.map((column, index) => {
        const hidden = !!zoomColumn && column.id !== zoomColumn;
        return (
          <Fragment key={column.id}>
            {index > 0 && !zoomColumn && <ColumnSplitter index={index - 1} area={area} />}
            <div data-column={column.id} className={`flex min-w-0 flex-col ${hidden ? "hidden" : ""}`} style={{ flex: `${zoomColumn ? 1 : column.size} 1 0` }}>
              {column.panels.map((panel, panelIndex) => {
                const panelHidden = !!zoom && panel.id !== zoom;
                return (
                  <Fragment key={panel.id}>
                    {panelIndex > 0 && !zoom && <PanelSplitter columnId={column.id} index={panelIndex - 1} />}
                    <div className={`flex min-h-0 ${panelHidden ? "hidden" : ""}`} style={{ flex: `${zoom ? 1 : panel.size} 1 0` }}>
                      <Panel slot={panel} />
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </Fragment>
        );
      })}
      {!layout.columns.length && <EmptyLayout />}
    </div>
  );
}

function Panel({ slot }: { slot: PanelSlot }) {
  switch (slot.kind) {
    case "editor":
      return <EditorPanel id={slot.id} />;
    case "files":
      return <FileTree id={slot.id} />;
    case "git":
      return <GitPanel id={slot.id} />;
    case "outline":
      return <OutlinePanel id={slot.id} />;
    case "search":
      return <SearchPanel id={slot.id} />;
    case "terminal":
      return (
        <Suspense fallback={<div className="p-2 text-hud-text/50">carregando o terminal…</div>}>
          <TerminalPanel id={slot.id} profile={slot.profile ?? null} />
        </Suspense>
      );
  }
}

function EmptyLayout() {
  const store = useStore();
  return (
    <div className="flex flex-1 items-center justify-center text-hud-text/50">
      <button type="button" onClick={() => store.resetLayout()} className="cursor-pointer outline-none hover:text-hud-light focus-visible:text-hud-light">
        [Restaurar os painéis]
      </button>
    </div>
  );
}

interface DragStart {
  layout: IdeLayout;
  size: number;
}

/** Between two columns: drag, or focus it and use ← →. */
function ColumnSplitter({ index, area }: { index: number; area: RefObject<HTMLDivElement | null> }) {
  const store = useStore();
  const drag = usePointerDrag<DragStart>({
    onStart: () => ({ layout: store.state.layout, size: area.current?.clientWidth ?? 1 }),
    onMove: ({ dx }, start) => store.setLayoutSizes(resizeColumns(start.layout, index, dx / start.size, MIN_COLUMN_PX / start.size)),
    onEnd: () => undefined,
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const width = area.current?.clientWidth ?? 1;
    store.setLayoutSizes(resizeColumns(store.state.layout, index, event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP, MIN_COLUMN_PX / width));
  };
  return (
    <div
      {...drag}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar colunas"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid={`ide-split-col-${index}`}
      className="w-1 shrink-0 cursor-col-resize touch-none outline-none hover:bg-hud-light/30 focus-visible:bg-hud-light/40"
    />
  );
}

function PanelSplitter({ columnId, index }: { columnId: string; index: number }) {
  const store = useStore();
  const self = useRef<HTMLDivElement>(null);
  const columnHeight = () => self.current?.parentElement?.clientHeight ?? 1;
  const drag = usePointerDrag<DragStart>({
    onStart: () => ({ layout: store.state.layout, size: columnHeight() }),
    onMove: ({ dy }, start) => store.setLayoutSizes(resizePanels(start.layout, columnId, index, dy / start.size, MIN_PANEL_PX / start.size)),
    onEnd: () => undefined,
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    store.setLayoutSizes(resizePanels(store.state.layout, columnId, index, event.key === "ArrowUp" ? -KEY_STEP : KEY_STEP, MIN_PANEL_PX / columnHeight()));
  };
  return (
    <div
      ref={self}
      {...drag}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Redimensionar painéis"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid={`ide-split-${columnId}-${index}`}
      className="h-1 shrink-0 cursor-row-resize touch-none outline-none hover:bg-hud-light/30 focus-visible:bg-hud-light/40"
    />
  );
}
