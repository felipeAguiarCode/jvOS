import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { CORE_MODES, type CoreMode } from "../lib/core";
import type { Background } from "../lib/settings";
import { paletteFor, type Theme } from "../lib/theme";

/** Building blocks shared by the settings panel and the advanced menu. */

/**
 * Chips with a field after them: Enter or comma adds, Backspace on the empty field removes the
 * last one, × removes any. Program keywords and voice phrases.
 */
export function ChipInput({
  items,
  onChange,
  addLabel,
  removeLabel,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  /** Accessible name of the field. */
  addLabel: string;
  removeLabel: (item: string) => string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const item = draft.trim().replace(/,+$/, "").trim();
    setDraft("");
    if (!item || items.some((existing) => existing.toLowerCase() === item.toLowerCase())) return;
    onChange([...items, item]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && items.length) {
      onChange(items.slice(0, -1));
    }
  };

  return (
    <div className="hud-input flex min-h-9 flex-wrap items-center gap-1.5 py-1.5">
      {items.map((item) => (
        <span key={item} className="flex items-center gap-1 rounded-md border border-hud-cyan/25 bg-hud-cyan/[0.08] py-0.5 pr-1 pl-2 text-xs text-hud-light/90">
          {item}
          <button
            type="button"
            aria-label={removeLabel(item)}
            onClick={() => onChange(items.filter((existing) => existing !== item))}
            className="grid size-4 cursor-pointer place-items-center rounded text-hud-text/50 hover:text-hud-light"
          >
            <X size={10} strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        aria-label={addLabel}
        placeholder={items.length ? "" : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="min-w-16 flex-1 bg-transparent text-xs text-hud-text outline-none placeholder:text-hud-text/35"
      />
    </div>
  );
}

export interface CardOption<T> {
  value: T;
  label: string;
  swatch: ReactNode;
}

/** Theme cards; the custom one shows the colour of the given hue. */
export function themeOptions(hue: number): CardOption<Theme>[] {
  return [
    { value: "blue", label: "Azul", swatch: <ThemeSwatch theme="blue" hue={hue} /> },
    { value: "green", label: "Verde Matrix", swatch: <ThemeSwatch theme="green" hue={hue} /> },
    { value: "yellow", label: "Amarelo digital", swatch: <ThemeSwatch theme="yellow" hue={hue} /> },
    { value: "custom", label: "Personalizada", swatch: <ThemeSwatch theme="custom" hue={hue} /> },
  ];
}

export const BACKGROUNDS: CardOption<Background>[] = [
  { value: "solid", label: "Preto", swatch: <BackgroundSwatch kind="solid" /> },
  { value: "grid", label: "Grid côncavo", swatch: <BackgroundSwatch kind="grid" /> },
  { value: "matrix", label: "Matrix", swatch: <BackgroundSwatch kind="matrix" /> },
];

/** Columns of the Matrix miniature: x, head y, trail length (glyphs). */
const RAIN_SWATCH = [
  [4, 17, 4],
  [10, 8, 2],
  [16, 27, 6],
  [22, 13, 3],
  [28, 30, 7],
  [34, 6, 2],
  [40, 21, 5],
  [46, 11, 3],
];

export function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3">
      <h3 className="text-[10px] font-semibold tracking-[0.28em] text-hud-cyan/80 uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-hud-cyan/10 px-1 py-px font-mono text-[11px] text-hud-light/90">{children}</code>;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-hud-cyan/15 bg-white/[0.02] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`relative flex-1 cursor-pointer rounded-lg px-2.5 py-2 text-xs leading-tight tracking-[0.12em] uppercase outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
              active ? "text-hud-light" : "text-hud-text/55 hover:text-hud-text"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`segment-${label}`}
                className="absolute inset-0 rounded-lg border border-hud-cyan/30 bg-hud-cyan/[0.09] shadow-[0_0_14px_color-mix(in_oklab,var(--color-hud-cyan)_15%,transparent)]"
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Radio cards with a visual swatch. */
export function CardPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 3,
}: {
  label: string;
  options: CardOption<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  const labelId = useId();
  return (
    <div className="space-y-2">
      <div id={labelId} className="text-[10px] tracking-[0.18em] text-hud-text/45 uppercase">
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className={`grid gap-2 ${columns === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border px-2 pt-3.5 pb-3 text-[10px] leading-tight tracking-[0.14em] uppercase outline-none transition focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
                active ? "border-hud-cyan/40 bg-hud-cyan/[0.06] text-hud-light" : "border-hud-cyan/12 bg-white/[0.02] text-hud-text/55 hover:text-hud-text"
              }`}
            >
              {option.swatch}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Each theme swatch shows its own colors, whatever the current theme. */
export function ThemeSwatch({ theme, hue }: { theme: Theme; hue: number }) {
  const { holo, light } = paletteFor(theme, hue);
  return (
    <span
      aria-hidden
      className="grid size-8 place-items-center rounded-full border"
      style={{ borderColor: holo, boxShadow: `0 0 12px ${holo}55, inset 0 0 8px ${holo}40` }}
    >
      <span className="size-2.5 rounded-full" style={{ background: light, boxShadow: `0 0 8px ${light}` }} />
    </span>
  );
}

/** Background miniatures, drawn in the current theme color like the backgrounds themselves. */
/** Core cards for the advanced menu. */
export const CORE_OPTIONS: CardOption<CoreMode>[] = CORE_MODES.map((mode) => ({
  value: mode.value,
  label: mode.label,
  swatch: <CoreSwatch mode={mode.value} />,
}));

/** Only the 3D core draws the animated backgrounds (they share its WebGL canvas). */
export function BackgroundNote({ core }: { core: CoreMode }) {
  if (core === "3d") return null;
  return <p className="text-xs leading-relaxed text-hud-text/55">Grid e Matrix aparecem só com o núcleo 3D (Menu avançado → Núcleo).</p>;
}

export function CoreSwatch({ mode }: { mode: CoreMode }) {
  return (
    <svg aria-hidden viewBox="0 0 50 32" className="h-8 w-[50px] rounded-md border border-hud-cyan/20 bg-hud-void">
      {mode === "3d" && (
        <g fill="none">
          <circle cx={25} cy={16} r={11} className="fill-hud-cyan/15" />
          <circle cx={25} cy={16} r={7} className="stroke-hud-holo" strokeWidth={0.6} />
          <ellipse cx={25} cy={16} rx={3.5} ry={7} className="stroke-hud-holo/70" strokeWidth={0.5} />
          <ellipse cx={25} cy={16} rx={7} ry={2} className="stroke-hud-holo/70" strokeWidth={0.5} />
          <ellipse cx={25} cy={16} rx={13} ry={4} transform="rotate(-18 25 16)" className="stroke-hud-light" strokeWidth={0.9} />
          <circle cx={25} cy={16} r={1.4} className="fill-hud-glow" />
        </g>
      )}
      {mode === "2d" && (
        <g fill="none">
          <circle cx={25} cy={16} r={12.5} className="stroke-hud-line" strokeWidth={0.5} strokeDasharray="0.6 1.2" />
          <circle cx={25} cy={16} r={9.5} className="stroke-hud-cyan" strokeWidth={0.6} />
          <ellipse cx={25} cy={16} rx={9} ry={3} transform="rotate(24 25 16)" className="stroke-hud-holo/80" strokeWidth={0.6} />
          <circle cx={25} cy={16} r={4.5} className="stroke-hud-holo" strokeWidth={0.6} />
          <circle cx={25} cy={16} r={1.2} className="fill-hud-glow" />
        </g>
      )}
      {mode === "off" && (
        <g fill="none" className="stroke-hud-text/35" strokeWidth={0.9} strokeLinecap="round">
          <path d="M21.6 12.6 A5 5 0 1 0 28.4 12.6" />
          <line x1={25} y1={10} x2={25} y2={15} />
        </g>
      )}
    </svg>
  );
}

export function BackgroundSwatch({ kind }: { kind: Background }) {
  return (
    <svg aria-hidden viewBox="0 0 50 32" className="h-8 w-[50px] rounded-md border border-hud-cyan/20 bg-hud-void">
      {kind === "grid" && (
        <g className="fill-none stroke-hud-line" strokeWidth={0.7}>
          {/* Pincushion lines: denser at the back (centre), spreading toward the edges. */}
          {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
            <path key={`v${k}`} d={`M${25 + k * 8} 0 Q${25 + k * 2} 16 ${25 + k * 8} 32`} />
          ))}
          {[-2, -1, 0, 1, 2].map((k) => (
            <path key={`h${k}`} d={`M0 ${16 + k * 7.5} Q25 ${16 + k * 2.5} 50 ${16 + k * 7.5}`} />
          ))}
        </g>
      )}
      {kind === "matrix" &&
        RAIN_SWATCH.map(([x, head, length]) =>
          Array.from({ length }, (_, i) => (
            <rect
              key={`${x}-${i}`}
              x={x - 1}
              y={head - i * 3.4}
              width={2}
              height={2.4}
              className={i === 0 ? "fill-hud-light" : "fill-hud-cyan"}
              opacity={i === 0 ? 1 : 0.8 * (1 - i / length)}
            />
          )),
        )}
    </svg>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border outline-none transition-colors focus-visible:ring-1 focus-visible:ring-hud-light/50 ${
        checked ? "border-hud-cyan/50 bg-hud-cyan/25" : "border-hud-cyan/20 bg-white/[0.03]"
      }`}
    >
      <motion.span
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`absolute top-[3px] left-0 size-4 rounded-full ${
          checked ? "bg-hud-light shadow-[0_0_10px_color-mix(in_oklab,var(--color-hud-light)_90%,transparent)]" : "bg-hud-text/40"
        }`}
      />
    </button>
  );
}

/** A labelled row with a switch on the right. */
export function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-hud-cyan/12 bg-white/[0.02] px-4 py-3">
      <div>
        <div className="text-sm text-hud-text">{label}</div>
        {hint && <div className="text-xs text-hud-text/50">{hint}</div>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

export function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-lg text-hud-text/55 outline-none transition hover:bg-hud-cyan/10 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Slider with the label on the left and the formatted value on the right. */
export function Range({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  format = String,
  track,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  /** CSS background for the track (e.g. a hue rainbow). */
  track?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-[10px] tracking-[0.18em] text-hud-text/45 uppercase">
        <span>{label}</span>
        <span className="tabular-nums text-hud-text/75">{format(value)}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="hud-range"
        style={track ? { background: track } : undefined}
      />
    </label>
  );
}

/** Secondary action button (advanced menu). */
export function ActionButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-hud-cyan/20 bg-white/[0.02] px-3 py-2.5 text-xs tracking-[0.14em] text-hud-text/80 uppercase outline-none transition hover:border-hud-cyan/50 hover:text-hud-light focus-visible:ring-1 focus-visible:ring-hud-light/50 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {label}
    </button>
  );
}
