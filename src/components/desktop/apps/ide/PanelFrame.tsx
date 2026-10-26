import { useEffect, useRef, type ReactNode } from "react";
import { useIde, useStore } from "./context";

/** Registers how a panel takes the keyboard (Alt+N, F6, the Janelas menu). */
export function usePanelFocus(id: string, focus: () => void) {
  const store = useStore();
  const latest = useRef(focus);
  latest.current = focus;
  useEffect(() => {
    const run = () => latest.current();
    store.panelFocus.set(id, run);
    return () => {
      if (store.panelFocus.get(id) === run) store.panelFocus.delete(id);
    };
  }, [store, id]);
}

/**
 * A termide panel: a thin box whose top edge carries "[x] title". The focused panel is drawn in
 * the accent with its title in reverse video. Double-clicking the title zooms the panel.
 */
export function PanelFrame({
  id,
  label,
  title,
  aside,
  children,
}: {
  id: string;
  /** Accessible name of the region. */
  label: string;
  title: ReactNode;
  /** Right after the title (counts, branch…). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const store = useStore();
  const { layout } = useIde();
  const focused = layout.focus === id;
  const line = focused ? "border-hud-light/70" : "border-hud-cyan/25";

  return (
    <section
      role="region"
      aria-label={label}
      data-panel-id={id}
      data-focused={focused || undefined}
      onPointerDownCapture={() => store.focusPanel(id, false)}
      onFocusCapture={() => store.focusPanel(id, false)}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex h-[17px] shrink-0 items-stretch text-[11px] leading-[17px]" onDoubleClick={() => store.toggleZoom(id)}>
        <span aria-hidden className={`mt-[8px] w-1.5 shrink-0 border-t border-l ${line}`} />
        <button
          type="button"
          aria-label={`Fechar o painel ${label}`}
          title={`Fechar o painel ${label}`}
          onClick={() => store.closePanel(id)}
          onDoubleClick={(event) => event.stopPropagation()}
          className="shrink-0 cursor-pointer px-0.5 text-hud-text/55 outline-none hover:text-hud-alert focus-visible:text-hud-light"
        >
          [x]
        </button>
        <span className={`min-w-0 truncate px-1 ${focused ? "bg-hud-light/85 font-semibold text-hud-void" : "text-hud-text/75"}`}>{title}</span>
        {aside && <span className="flex shrink-0 items-center gap-1 px-1 text-hud-text/60">{aside}</span>}
        <span aria-hidden className={`mt-[8px] min-w-2 flex-1 border-t border-r ${line}`} />
      </header>
      <div className={`relative min-h-0 flex-1 border-x border-b ${line}`}>{children}</div>
    </section>
  );
}
