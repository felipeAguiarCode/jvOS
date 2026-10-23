import type { ReactNode } from "react";

/** Building blocks for widgets drawn like terminal apps (neofetch lines, block bars, reverse-video headers). */

/** `key ~ value`, the key in the accent colour, like neofetch. */
export function KeyValue({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 font-mono text-[12px] leading-snug">
      <span className="w-[7ch] shrink-0 text-right text-hud-cyan">{name}</span>
      <span className="text-hud-text/50">~</span>
      <span className="min-w-0 truncate text-hud-text">{children}</span>
    </div>
  );
}

/** `[██████░░░░] 64%` */
export function BlockBar({ value, cells = 20, tone = "normal", label }: { value: number; cells?: number; tone?: "normal" | "alert"; label?: string }) {
  const share = Math.max(0, Math.min(1, value));
  const filled = Math.round(share * cells);
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100} className="flex items-center gap-2 font-mono text-[12px]">
      <span className={`whitespace-pre ${tone === "alert" ? "text-hud-alert" : "text-hud-light"}`}>
        [{"█".repeat(filled)}
        <span className="text-hud-text/25">{"░".repeat(cells - filled)}</span>]
      </span>
      <span className="tabular-nums text-hud-text/70">{String(Math.round(share * 100)).padStart(3, " ")}%</span>
    </div>
  );
}

/** A header row in reverse video, like cmus' column titles. */
export function ReverseRow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between bg-hud-light/80 px-2 font-mono text-[11px] leading-5 font-semibold text-hud-void">
      <span className="truncate">{left}</span>
      {right && <span className="shrink-0">{right}</span>}
    </div>
  );
}

/** `[key] action`: a keyboard hint that is also a button. */
export function KeyHint({ hotkey, label, action, onClick }: { hotkey: string; label: string; action: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-1 font-mono text-[11px] text-hud-text/60 outline-none hover:text-hud-light focus-visible:text-hud-light"
    >
      <span className="bg-hud-text/12 px-1 text-hud-cyan group-hover:bg-hud-light/85 group-hover:text-hud-void">{hotkey}</span>
      {action}
    </button>
  );
}
