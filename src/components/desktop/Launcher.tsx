import { useEffect, useRef } from "react";
import { SlidersHorizontal } from "lucide-react";
import { WINDOW_KINDS, WINDOW_SPECS, type DesktopGroup, type WindowKind } from "../../lib/desktop";

interface LauncherProps {
  /** Widgets above the Widgets item, apps above the Apps item. */
  group: DesktopGroup;
  /** Kinds already open: marked, and picking them just brings them to the front. */
  open: WindowKind[];
  onPick: (kind: WindowKind) => void;
  onClose: () => void;
  onAdvanced: () => void;
}

const COPY: Record<DesktopGroup, { label: string; hint: string }> = {
  widgets: { label: "Widgets", hint: "Por voz: “abre o relógio”, “fecha todos os widgets”." },
  apps: { label: "Apps", hint: "Por voz: “abre o Jarvis Mark”, “fecha todas as aplicações”." },
};

/** Menu above a dock item listing the widgets, or the apps, that open as windows. */
export function Launcher({ group, open, onPick, onClose, onAdvanced }: LauncherProps) {
  const root = useRef<HTMLDivElement>(null);
  const { label, hint } = COPY[group];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Clicking anywhere else closes it; its own dock item toggles it itself.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (root.current?.contains(target) || target?.closest(`[data-dock-item='${group}']`)) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [group, onClose]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={`Menu de ${label.toLowerCase()}`}
      className="w-[264px] rounded-2xl border border-hud-cyan/18 bg-hud-panel/80 p-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
    >
      <h3 className="mb-1.5 px-1 text-[10px] font-semibold tracking-[0.28em] text-hud-cyan/80 uppercase">{label}</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {WINDOW_KINDS.filter((kind) => WINDOW_SPECS[kind].group === group).map((kind) => {
          const spec = WINDOW_SPECS[kind];
          const isOpen = open.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={isOpen}
              onClick={() => onPick(kind)}
              className={`relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-1 pt-3 pb-2.5 text-[10px] leading-tight tracking-[0.14em] uppercase outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
                isOpen
                  ? "border-hud-cyan/35 bg-hud-cyan/[0.07] text-hud-light"
                  : "border-hud-cyan/12 bg-white/[0.02] text-hud-text/60 hover:border-hud-cyan/30 hover:text-hud-light"
              }`}
            >
              <spec.icon size={20} strokeWidth={1.5} aria-hidden />
              {spec.title}
              {isOpen && (
                <span
                  aria-hidden
                  className="absolute top-1.5 right-1.5 size-1 rounded-full bg-hud-light shadow-[0_0_6px_color-mix(in_oklab,var(--color-hud-light)_95%,transparent)]"
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 px-1 text-[11px] leading-snug text-hud-text/45">
        {hint} Ou tecle <kbd className="font-mono text-hud-light/80">/</kbd> para buscar.
      </p>
      <button
        type="button"
        onClick={onAdvanced}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-hud-cyan/12 py-1.5 text-[10px] tracking-[0.18em] text-hud-text/60 uppercase outline-none transition hover:border-hud-cyan/30 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50"
      >
        <SlidersHorizontal size={12} strokeWidth={1.6} aria-hidden /> Menu avançado
      </button>
    </div>
  );
}
