import { lazy, Suspense, useEffect, useRef, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { History, MessageSquarePlus, Trash2, X } from "lucide-react";
import type { AssistantTurn } from "../hooks/useAssistant";
import type { HistoryItem } from "../lib/assistant";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";

// Markdown rendering only loads with the history open.
const AssistantHistory = lazy(() => import("./AssistantHistory").then((module) => ({ default: module.AssistantHistory })));

interface AssistantDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button next to the core (hidden with the core off, and during the boot). */
  showToggle: boolean;
  items: HistoryItem[];
  /** The question being answered, shown live at the end. */
  turn: AssistantTurn | null;
  /** JARVIS is working: the conversation cannot be reset under it. */
  busy: boolean;
  /** Esc belongs to the core while it listens or answers. */
  coreActive: boolean;
  onNewConversation: () => void;
  onClear: () => void;
}

/** Everything JARVIS answered: a drawer sliding in beside the core, opened from a button by it. */
export function AssistantDrawer({ open, onOpenChange, showToggle, items, turn, busy, coreActive, onNewConversation, onClear }: AssistantDrawerProps) {
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onOpenChange, coreActive });
  latest.current = { onOpenChange, coreActive };

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    // A click elsewhere closes it, except on the core: talking with the history open is fine.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || panel.current?.contains(target) || toggle.current?.contains(target) || target.closest("[data-core-button]")) return;
      latest.current.onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !latest.current.coreActive) latest.current.onOpenChange(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const empty = items.length === 0 && !turn;
  return (
    <>
      {showToggle && (
        <button
          ref={toggle}
          type="button"
          aria-label="Histórico do JARVIS"
          aria-expanded={open}
          title="Histórico do JARVIS"
          onClick={() => onOpenChange(!open)}
          className={`fixed z-[12] grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border bg-hud-panel/55 outline-none backdrop-blur-sm transition hover:border-hud-light/50 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
            open ? "border-hud-light/50 text-hud-light" : "border-hud-cyan/25 text-hud-text/60"
          }`}
          style={{ left: `calc(50% + ${COMPOSITION_CSS} * 0.37)`, top: `calc(${CORE_CENTER_Y_CSS} + ${COMPOSITION_CSS} * 0.37)` }}
        >
          <History size={16} strokeWidth={1.6} aria-hidden />
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.aside
            ref={panel}
            key="assistant-history"
            role="dialog"
            aria-label="Histórico do JARVIS"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Handled here, so the core does not also take it.
              event.preventDefault();
              onOpenChange(false);
              toggle.current?.focus({ preventScroll: true });
            }}
            className="fixed top-10 right-4 bottom-4 z-[23] flex w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-hud-cyan/20 bg-hud-panel/82 text-hud-text shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_0_30px_color-mix(in_oklab,var(--color-hud-cyan)_4%,transparent)] backdrop-blur-xl select-text"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-hud-light/40 to-transparent" />
            <header className="flex items-center gap-1 px-5 pt-4 pb-3">
              <h2 className="flex-1 text-[11px] font-semibold tracking-[0.32em] text-hud-light uppercase">JARVIS · Histórico</h2>
              <HeaderButton label="Nova conversa" disabled={busy || empty} onClick={onNewConversation}>
                <MessageSquarePlus size={15} strokeWidth={1.6} aria-hidden />
              </HeaderButton>
              <HeaderButton label="Limpar histórico" disabled={busy || items.length === 0} onClick={onClear}>
                <Trash2 size={15} strokeWidth={1.6} aria-hidden />
              </HeaderButton>
              <HeaderButton ref={closeButton} label="Fechar histórico" onClick={() => onOpenChange(false)}>
                <X size={16} strokeWidth={1.6} aria-hidden />
              </HeaderButton>
            </header>
            {empty ? (
              <p className="px-6 pt-6 text-sm leading-relaxed text-hud-text/55">
                Clique no núcleo e fale com o JARVIS. As respostas ficam guardadas aqui.
              </p>
            ) : (
              <Suspense fallback={null}>
                <AssistantHistory items={items} turn={turn} />
              </Suspense>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function HeaderButton({ label, disabled, onClick, children, ref }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 cursor-pointer place-items-center rounded-lg text-hud-text/60 outline-none transition hover:bg-hud-cyan/10 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-hud-text/60"
    >
      {children}
    </button>
  );
}
