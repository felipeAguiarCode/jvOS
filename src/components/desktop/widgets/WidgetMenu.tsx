import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { WidgetToggles } from "../../../hooks/useWidgetOptions";

export interface MenuItem {
  /** "action" runs and closes the menu; checks and radios keep it open. */
  kind: "check" | "radio" | "action";
  label: string;
  checked?: boolean;
  onSelect: () => void;
  /** Dimmed, on the right (a shortcut, a size). */
  detail?: string;
  disabled?: boolean;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

/** The menu keeps this far from the edges of its bounds. */
const MARGIN = 8;

const ITEM =
  "flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-hud-text outline-none hover:bg-hud-light/85 hover:text-hud-void focus-visible:bg-hud-light/85 focus-visible:text-hud-void disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-hud-text";

/**
 * A widget's settings menu: `open` goes on the widget's `onContextMenu` (right click, or the menu
 * key / Shift+F10 while it has focus); the menu shows at the pointer.
 */
export function useWidgetMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const open = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    origin.current = event.currentTarget;
    // From the keyboard there is no pointer: the widget's corner instead.
    if (event.clientX === 0 && event.clientY === 0) {
      const box = event.currentTarget.getBoundingClientRect();
      setAt({ x: box.left + 16, y: box.top + 16 });
    } else setAt({ x: event.clientX, y: event.clientY });
  }, []);
  const close = useCallback(() => setAt(null), []);
  // Esc hands the focus back to the widget.
  const dismiss = useCallback(() => {
    setAt(null);
    origin.current?.focus({ preventScroll: true });
  }, []);
  return { at, open, close, dismiss };
}

export type WidgetMenuState = ReturnType<typeof useWidgetMenu>;

/** Checkbox items for a widget's toggles, in the order given. */
export function toggleItems<T extends WidgetToggles>(options: T, toggle: (name: keyof T) => void, labels: [keyof T, string][]): MenuItem[] {
  return labels.map(([name, label]) => ({ kind: "check", label, checked: options[name], onSelect: () => toggle(name) }));
}

/** The open menu, if any. Ticking a box keeps it open; Esc, a click elsewhere or leaving the window closes it. */
export function WidgetMenu({ menu, label, sections }: { menu: WidgetMenuState; label: string; sections: MenuSection[] }) {
  if (!menu.at) return null;
  return <MenuPopup at={menu.at} label={label} sections={sections} onClose={menu.close} onDismiss={menu.dismiss} />;
}

export interface MenuPopupProps {
  /** Viewport coordinates of the corner it opens from. */
  at: { x: number; y: number };
  label: string;
  sections: MenuSection[];
  onClose: () => void;
  /** Esc: close and hand the focus back. */
  onDismiss: () => void;
  /**
   * Portal target. Inside a window the menu keeps the window's accent and effects and is placed
   * relative to it (`fixed` is unreliable under a transformed window); default: the page.
   */
  container?: HTMLElement | null;
  /** ← and →: a menu bar moves to the neighbouring menu. */
  onNavigate?: (direction: -1 | 1) => void;
}

/** A TUI menu of checks, radios and actions, kept inside its bounds. */
export function MenuPopup({ at, label, sections, onClose, onDismiss, container, onNavigate }: MenuPopupProps) {
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null);

  // Flipped to the other side of the pointer when it would overflow.
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const bounds = container?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const x = at.x + box.width + MARGIN > bounds.right ? Math.max(bounds.left + MARGIN, at.x - box.width) : at.x;
    const y = at.y + box.height + MARGIN > bounds.bottom ? Math.max(bounds.top + MARGIN, at.y - box.height) : at.y;
    setPlace({ x: x - bounds.left, y: y - bounds.top });
  }, [at, container]);

  // The keyboard goes into the menu, and back where it was when an item closes it (the menu's
  // buttons vanish with it, which would otherwise drop the focus on the page).
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const menu = root.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      const active = document.activeElement;
      if ((!active || active === document.body || menu?.contains(active)) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => !root.current?.contains(event.target as Node) && onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, onDismiss]);

  // Arrows move between the items, as in a native menu. Keys stop here: through the portal they
  // would otherwise reach the widget's own shortcuts (Space plays, digits type).
  const onKeyDown = (event: ReactKeyboardEvent) => {
    event.stopPropagation();
    if (onNavigate && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      onNavigate(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index + items.length - 1) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    items[moves[event.key]]?.focus();
  };

  return createPortal(
    <div
      ref={root}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={`${container ? "absolute" : "fixed"} z-[90] max-h-[80vh] min-w-[24ch] overflow-y-auto border border-hud-cyan/30 bg-hud-panel/95 py-1 font-mono text-[12px] shadow-[0_12px_30px_rgba(0,0,0,0.6)] ${
        // Transparent (not invisible: that would refuse the focus) until it is placed.
        place ? "" : "opacity-0"
      }`}
      style={{ left: place?.x ?? 0, top: place?.y ?? 0 }}
    >
      {sections.map((section, index) => (
        <div key={section.title ?? index} role="group" aria-label={section.title}>
          {index > 0 && <div role="separator" className="my-1 h-px bg-hud-cyan/20" />}
          {section.title && <div className="px-3 pt-1 pb-1.5 text-[10px] tracking-[0.2em] text-hud-text/45 uppercase">{section.title}</div>}
          {section.items.map((item, itemIndex) => (
            <button
              key={`${itemIndex}:${item.label}`}
              type="button"
              role={item.kind === "check" ? "menuitemcheckbox" : item.kind === "radio" ? "menuitemradio" : "menuitem"}
              aria-checked={item.kind === "action" ? undefined : (item.checked ?? false)}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                if (item.kind === "action") onClose();
              }}
              className={ITEM}
            >
              {item.kind !== "action" && (
                <span className="text-hud-cyan">{item.kind === "check" ? (item.checked ? "[x]" : "[ ]") : item.checked ? "(•)" : "( )"}</span>
              )}
              <span className="truncate">{item.label}</span>
              {item.detail && <span className="ml-auto shrink-0 pl-3 text-[10px] opacity-60">{item.detail}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    container ?? document.body,
  );
}
