import type { ColumnSlot, IdeLayout, PanelKind, PanelSlot } from "./types";

/**
 * termide's arrangement: the editor wide on the left, the file manager in the middle, git over
 * the outline on the right. Panels come and go (Janelas menu, [x]); each kind has a home column.
 */

interface Home {
  column: string;
  /** Default share of the width when the column has to be recreated. */
  columnSize: number;
  /** Position inside the column. */
  order: number;
  /** Share of the column it takes when added next to others. */
  share: number;
}

const COLUMN_ORDER = ["c-main", "c-files", "c-side"];

const HOMES: Record<PanelKind, Home> = {
  editor: { column: "c-main", columnSize: 0.52, order: 0, share: 1 },
  terminal: { column: "c-main", columnSize: 0.52, order: 1, share: 0.35 },
  search: { column: "c-files", columnSize: 0.22, order: 0, share: 0.5 },
  files: { column: "c-files", columnSize: 0.22, order: 1, share: 0.5 },
  git: { column: "c-side", columnSize: 0.26, order: 0, share: 0.62 },
  outline: { column: "c-side", columnSize: 0.26, order: 1, share: 0.38 },
};

export const DEFAULT_LAYOUT: IdeLayout = {
  version: 1,
  columns: [
    { id: "c-main", size: 0.52, panels: [{ id: "editor", kind: "editor", size: 1 }] },
    { id: "c-files", size: 0.22, panels: [{ id: "files", kind: "files", size: 1 }] },
    {
      id: "c-side",
      size: 0.26,
      panels: [
        { id: "git", kind: "git", size: 0.62 },
        { id: "outline", kind: "outline", size: 0.38 },
      ],
    },
  ],
  focus: "editor",
  zoom: null,
};

/** Columns and panels below these sizes are not allowed by the splitters. */
export const MIN_COLUMN_PX = 140;
export const MIN_PANEL_PX = 56;

const normalize = <T extends { size: number }>(items: T[]): T[] => {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.size), 0);
  return total > 0 ? items.map((item) => ({ ...item, size: Math.max(0, item.size) / total })) : items.map((item) => ({ ...item, size: 1 / items.length }));
};

/** Panels in reading order: column by column, top to bottom (Alt+1…9, F6). */
export const orderedPanels = (layout: IdeLayout): PanelSlot[] => layout.columns.flatMap((column) => column.panels);

export const findPanel = (layout: IdeLayout, id: string) => orderedPanels(layout).find((panel) => panel.id === id) ?? null;

export const hasKind = (layout: IdeLayout, kind: PanelKind) => orderedPanels(layout).some((panel) => panel.kind === kind);

export const panelsOf = (layout: IdeLayout, kind: PanelKind) => orderedPanels(layout).filter((panel) => panel.kind === kind);

/** Adds a panel in its home column (recreating the column where it belongs). */
export function openPanel(layout: IdeLayout, panel: Omit<PanelSlot, "size">): IdeLayout {
  const home = HOMES[panel.kind];
  let columns = layout.columns;
  if (!columns.some((column) => column.id === home.column)) {
    const fresh: ColumnSlot = { id: home.column, size: home.columnSize, panels: [] };
    const scaled = columns.map((column) => ({ ...column, size: column.size * (1 - home.columnSize) }));
    const at = scaled.findIndex((column) => COLUMN_ORDER.indexOf(column.id) > COLUMN_ORDER.indexOf(home.column));
    columns = at < 0 ? [...scaled, fresh] : [...scaled.slice(0, at), fresh, ...scaled.slice(at)];
  }
  columns = columns.map((column) => {
    if (column.id !== home.column) return column;
    const share = column.panels.length ? home.share : 1;
    const others = column.panels.map((item) => ({ ...item, size: item.size * (1 - share) }));
    const slot: PanelSlot = { ...panel, size: share };
    // After the panels that come before it; terminals stack after the other terminals.
    const at = others.findIndex((item) => HOMES[item.kind].order > home.order);
    const panels = at < 0 ? [...others, slot] : [...others.slice(0, at), slot, ...others.slice(at)];
    return { ...column, panels: normalize(panels) };
  });
  return { ...layout, columns: normalize(columns), focus: panel.id, zoom: null };
}

export function closePanel(layout: IdeLayout, id: string): IdeLayout {
  const columns = layout.columns
    .map((column) => ({ ...column, panels: normalize(column.panels.filter((panel) => panel.id !== id)) }))
    .filter((column) => column.panels.length > 0);
  const focus = layout.focus === id ? (orderedPanels({ ...layout, columns })[0]?.id ?? null) : layout.focus;
  return { ...layout, columns: normalize(columns), focus, zoom: layout.zoom === id ? null : layout.zoom };
}

/** Moves the border after column `index` by `delta` (a share of the width). */
export function resizeColumns(layout: IdeLayout, index: number, delta: number, minShare: number): IdeLayout {
  const columns = layout.columns.map((column) => ({ ...column }));
  const left = columns[index];
  const right = columns[index + 1];
  if (!left || !right) return layout;
  const total = left.size + right.size;
  const size = Math.min(total - minShare, Math.max(minShare, left.size + delta));
  left.size = size;
  right.size = total - size;
  return { ...layout, columns };
}

/** Moves the border after panel `index` of a column by `delta` (a share of its height). */
export function resizePanels(layout: IdeLayout, columnId: string, index: number, delta: number, minShare: number): IdeLayout {
  return {
    ...layout,
    columns: layout.columns.map((column) => {
      if (column.id !== columnId) return column;
      const panels = column.panels.map((panel) => ({ ...panel }));
      const top = panels[index];
      const bottom = panels[index + 1];
      if (!top || !bottom) return column;
      const total = top.size + bottom.size;
      const size = Math.min(total - minShare, Math.max(minShare, top.size + delta));
      top.size = size;
      bottom.size = total - size;
      return { ...column, panels };
    }),
  };
}

/** Next terminal id ("term-1", "term-2"…). */
export function nextTerminalId(layout: IdeLayout): string {
  const used = new Set(orderedPanels(layout).map((panel) => panel.id));
  for (let n = 1; ; n++) if (!used.has(`term-${n}`)) return `term-${n}`;
}

const KINDS: PanelKind[] = ["editor", "files", "git", "outline", "search", "terminal"];

/** A stored layout, or null when it is unusable (then the default is used). */
export function parseLayout(raw: unknown): IdeLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const { columns, focus } = raw as Record<string, unknown>;
  if (!Array.isArray(columns)) return null;
  const seen = new Set<string>();
  const clean: ColumnSlot[] = [];
  for (const column of columns) {
    if (!column || typeof column !== "object") continue;
    const { id, size, panels } = column as Record<string, unknown>;
    if (typeof id !== "string" || !COLUMN_ORDER.includes(id) || seen.has(id) || !Array.isArray(panels)) continue;
    seen.add(id);
    const slots: PanelSlot[] = [];
    for (const panel of panels) {
      if (!panel || typeof panel !== "object") continue;
      const { id: panelId, kind, size: panelSize, profile } = panel as Record<string, unknown>;
      if (typeof panelId !== "string" || seen.has(panelId) || !KINDS.includes(kind as PanelKind)) continue;
      seen.add(panelId);
      slots.push({
        id: panelId,
        kind: kind as PanelKind,
        size: typeof panelSize === "number" && panelSize > 0 ? panelSize : 1,
        ...(typeof profile === "string" ? { profile } : {}),
      });
    }
    if (slots.length) clean.push({ id, size: typeof size === "number" && size > 0 ? size : 0.33, panels: normalize(slots) });
  }
  if (!clean.length) return null;
  clean.sort((a, b) => COLUMN_ORDER.indexOf(a.id) - COLUMN_ORDER.indexOf(b.id));
  const layout: IdeLayout = { version: 1, columns: normalize(clean), focus: null, zoom: null };
  layout.focus = typeof focus === "string" && findPanel(layout, focus) ? focus : (orderedPanels(layout)[0]?.id ?? null);
  return layout;
}
