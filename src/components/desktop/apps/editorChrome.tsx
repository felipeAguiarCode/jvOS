import type { ReactNode } from "react";
import { FilePlus, FolderOpen, Save } from "lucide-react";
import type { EditorDocument, EditorStatus } from "../../../hooks/useEditorDocument";
import { UNAVAILABLE } from "../../../lib/files";

/** Toolbar button: icon only, the label is the tooltip and the accessible name. */
export function ToolButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      title={disabled ? UNAVAILABLE : label}
      disabled={disabled}
      onClick={onClick}
      // Keeps the editor's selection while clicking formatting buttons.
      onMouseDown={(event) => event.preventDefault()}
      className={`grid h-6 w-7 cursor-pointer place-items-center outline-none transition-colors focus-visible:bg-hud-light/85 focus-visible:text-hud-void disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "bg-hud-light/80 text-hud-void" : "text-hud-text/60 hover:bg-hud-light/85 hover:text-hud-void"
      }`}
    >
      {children}
    </button>
  );
}

export function ToolSeparator() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-hud-cyan/15" />;
}

/** New / Open / Save, shared by both editors. */
export function FileButtons({ document }: { document: EditorDocument }) {
  return (
    <>
      <ToolButton label="Novo" onClick={document.newFile}>
        <FilePlus size={14} strokeWidth={1.6} />
      </ToolButton>
      <ToolButton label="Abrir" onClick={document.openFile} disabled={!document.canUseFiles}>
        <FolderOpen size={14} strokeWidth={1.6} />
      </ToolButton>
      <ToolButton label="Salvar" onClick={() => void document.save()} disabled={!document.canUseFiles}>
        <Save size={14} strokeWidth={1.6} />
      </ToolButton>
    </>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-8 shrink-0 items-center gap-0.5 bg-hud-text/[0.04] px-2">{children}</div>;
}

/** Inline confirmation when New/Open would drop unsaved changes. */
export function ConfirmBar({ document }: { document: EditorDocument }) {
  if (!document.pending) return null;
  return (
    <div role="alertdialog" aria-label="Alterações não salvas" className="flex items-center gap-3 border-b border-hud-alert/25 bg-hud-alert/[0.06] px-3 py-1.5 text-xs text-hud-text">
      <span className="flex-1">Descartar as alterações não salvas?</span>
      <button type="button" onClick={document.confirmPending} className="cursor-pointer rounded-md border border-hud-alert/40 px-2 py-0.5 text-[10px] tracking-[0.16em] text-hud-alert uppercase hover:bg-hud-alert/10">
        Descartar
      </button>
      <button type="button" onClick={document.cancelPending} className="cursor-pointer rounded-md border border-hud-cyan/20 px-2 py-0.5 text-[10px] tracking-[0.16em] text-hud-text/80 uppercase hover:text-hud-light">
        Cancelar
      </button>
    </div>
  );
}

/** tmux/lualine-style status line: a bright badge, the file, then the details on the right. */
export function StatusBar({
  badge,
  document,
  status = document.status,
  children,
}: {
  badge: string;
  document: EditorDocument;
  /** Overrides the document's own message (e.g. a dictation in progress). */
  status?: EditorStatus | null;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex h-6 shrink-0 items-center gap-3 bg-hud-text/[0.06] pr-3 font-mono text-[10px] tracking-[0.1em] text-hud-text/60 uppercase select-text"
    >
      <span className="flex h-full items-center bg-hud-light/80 px-2.5 font-semibold text-hud-void">{badge}</span>
      <span className="truncate text-hud-text/85" title={document.path ?? undefined}>
        {document.fileName}
        {document.dirty && <span className="ml-1.5 text-hud-light">●</span>}
      </span>
      <span className="flex-1" />
      {status ? <span className={`truncate ${status.tone === "error" ? "text-hud-alert/90" : "text-hud-light/80"}`}>{status.text}</span> : children}
    </div>
  );
}

export function StatusItem({ children }: { children: ReactNode }) {
  return <span className="shrink-0 whitespace-nowrap">{children}</span>;
}
