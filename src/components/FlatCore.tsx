import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { motion } from "motion/react";
import { frameRate, runFrames } from "../lib/frameClock";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";
import type { HoloSignals } from "../lib/signals";
import type { Ignition } from "./JarvisScene";

/** Listening for a command, the lock-on brackets swing in from this turn and scale, closing on the core. */
const LOCK_TURN = 45;
const LOCK_SCALE = 1.25;
/** The outer rim: bright segments (degrees, clockwise from 3 o'clock) and their radius. */
const RIM: [number, number, number][] = [
  [196, 254, 97],
  [262, 300, 99.5],
  [306, 336, 97],
  [344, 392, 97],
  [400, 448, 99.5],
  [456, 486, 97],
  [494, 548, 97],
];

interface FlatCoreProps {
  ignition: Ignition;
  signals: HoloSignals;
  sample: (delta: number) => void;
  paused: boolean;
  /** False while another app has the focus: the voice is followed at a lower frame rate. */
  focused: boolean;
  onFirstFrame: () => void;
}

/**
 * The light core: a JARVIS HUD reactor drawn as vector layers, no WebGL — a dark band of ticks
 * inside a segmented rim, an amber bracket, a bright inner ring over a faint globe and the
 * glowing triangle at the heart. Each ring is its own layer spun by the compositor (no repaint per
 * frame); the voice only moves a few transforms and opacities. Paused (hidden, or behind a
 * maximised app), nothing runs.
 */
export function FlatCore({ ignition, signals, sample, paused, focused, onFirstFrame }: FlatCoreProps) {
  const halo = useRef<HTMLDivElement>(null);
  const voice = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const lock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(onFirstFrame);
    return () => cancelAnimationFrame(id);
  }, [onFirstFrame]);

  const fps = frameRate(paused, focused);
  useEffect(() => {
    if (!fps) return;
    const written = new WeakMap<HTMLElement, Record<string, string>>();
    // Styles are only written when they change: at rest the loop costs a sample and nothing else.
    const set = (element: HTMLElement | null, property: "transform" | "opacity", value: string) => {
      if (!element) return;
      const current = written.get(element) ?? {};
      if (current[property] === value) return;
      current[property] = value;
      written.set(element, current);
      element.style[property] = value;
    };
    let last = performance.now();
    return runFrames(fps, (now) => {
      sample((now - last) / 1000);
      last = now;
      const { level, bass, voice: speaking, pulse, active, align } = signals;
      const round = (value: number) => value.toFixed(3);
      set(halo.current, "opacity", round(Math.min(1, 0.4 + level * 0.35 + speaking * 0.15 + pulse * 0.5)));
      set(halo.current, "transform", `scale(${round(1 + bass * 0.12 + pulse * 0.1)})`);
      set(voice.current, "opacity", round(Math.min(1, 0.15 + active * 0.2 + speaking * 0.6 + pulse * 0.4)));
      set(voice.current, "transform", `scale(${round(1 + level * 0.18)})`);
      set(hud.current, "opacity", round(Math.min(1, 0.7 + active * 0.2 + pulse * 0.3)));
      set(lock.current, "opacity", round(align));
      set(lock.current, "transform", `rotate(${(LOCK_TURN * (1 - align)).toFixed(2)}deg) scale(${round(1 + (LOCK_SCALE - 1) * (1 - align))})`);
    });
  }, [fps, sample, signals]);

  const standby = { scale: 0.001, rotate: -270, opacity: 0 };
  return (
    <div data-desktop-surface data-core="2d" className={`fixed inset-0 ${paused ? "core-paused" : ""}`}>
      <motion.div
        aria-hidden
        initial={ignition === "standby" ? standby : false}
        animate={ignition === "standby" ? standby : { scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 1.5, ease: "backOut" }}
        className="pointer-events-none absolute"
        style={{
          left: `calc(50% - ${COMPOSITION_CSS} / 2)`,
          top: `calc(${CORE_CENTER_Y_CSS} - ${COMPOSITION_CSS} / 2)`,
          width: COMPOSITION_CSS,
          height: COMPOSITION_CSS,
        }}
      >
        <Layer>
          <Disc />
        </Layer>
        {/* The glow behind the heart, breathing with the voice. */}
        <div
          ref={halo}
          className="absolute inset-[24%] rounded-full opacity-40 will-change-[transform,opacity]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-hud-holo) 34%, transparent), transparent 68%)" }}
        />
        <Layer spin={150}>
          <Rim />
        </Layer>
        <Layer spin={220} reverse ref={hud}>
          <Ticks />
        </Layer>
        <Layer spin={70} reverse>
          <circle r={70} className="fill-none stroke-hud-cyan/55" strokeWidth={1.3} pathLength={360} strokeDasharray="5 2.5" />
          <path d={arc(46, 100, 168)} className="fill-none stroke-hud-cyan/50" strokeWidth={1.1} />
          <path d={arc(46, 282, 326)} className="fill-none stroke-hud-cyan/50" strokeWidth={1.1} />
        </Layer>
        <Layer spin={40}>
          <InnerBand />
        </Layer>
        <Layer>
          <AmberBracket />
          <circle r={52} className="fill-none stroke-hud-light" strokeWidth={1.6} filter="url(#flat-core-glow)" />
          <rect x={-9} y={-62} width={18} height={2.6} rx={1} transform="rotate(-8)" className="fill-hud-light/80" />
          <Plate />
        </Layer>
        <div
          ref={lock}
          data-lock
          className="absolute inset-0 opacity-0 will-change-transform"
          style={{ transform: `rotate(${LOCK_TURN}deg) scale(${LOCK_SCALE})` }}
        >
          <Svg>
            <LockBrackets />
          </Svg>
        </div>
        {/* The heart: the triangle, and its glow swelling with the voice. */}
        <div ref={voice} className="absolute inset-0 opacity-15 will-change-transform">
          <Svg>
            <polygon points={triangle(25, 3)} className="fill-none stroke-hud-holo" strokeWidth={7} strokeLinejoin="miter" filter="url(#flat-core-bloom)" />
          </Svg>
        </div>
        <Layer>
          <polygon points={triangle(25, 3)} className="fill-hud-cyan/10 stroke-hud-glow" strokeWidth={3.6} strokeLinejoin="miter" filter="url(#flat-core-glow)" />
          <polygon points={triangle(15, 3)} className="fill-none stroke-hud-light/35" strokeWidth={0.6} />
        </Layer>
        <svg aria-hidden className="absolute size-0">
          <defs>
            <filter id="flat-core-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="flat-core-bloom" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
            <radialGradient id="flat-core-disc">
              <stop offset="0%" style={{ stopColor: "var(--color-hud-cyan)", stopOpacity: 0.3 }} />
              <stop offset="45%" style={{ stopColor: "var(--color-hud-cyan)", stopOpacity: 0.1 }} />
              <stop offset="100%" style={{ stopColor: "var(--color-hud-cyan)", stopOpacity: 0.03 }} />
            </radialGradient>
          </defs>
        </svg>
      </motion.div>
    </div>
  );
}

/** Nothing at the centre: the empty desktop is still a surface, and the window still shows. */
export function HiddenCore({ onFirstFrame }: { onFirstFrame: () => void }) {
  useEffect(() => {
    const id = requestAnimationFrame(onFirstFrame);
    return () => cancelAnimationFrame(id);
  }, [onFirstFrame]);
  return <div data-desktop-surface data-core="off" className="fixed inset-0" />;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="-100 -100 200 200" className="absolute inset-0 size-full overflow-visible">
      {children}
    </svg>
  );
}

/** A full-size layer; `spin` turns it on the compositor (seconds per turn). */
function Layer({ spin, reverse, children, ref }: { spin?: number; reverse?: boolean; children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  const style = spin ? ({ "--spin": `${spin}s`, animationDirection: reverse ? "reverse" : undefined } as CSSProperties) : undefined;
  return (
    <div ref={ref} className={`absolute inset-0 ${spin ? "core-spin" : ""}`} style={style}>
      <Svg>{children}</Svg>
    </div>
  );
}

/** The reactor's body: a dark disc, the navy band and the lit globe behind the heart. */
function Disc() {
  return (
    <g>
      <circle r={95} className="fill-hud-abyss/85" />
      <circle r={84} className="fill-none stroke-hud-cyan/15" strokeWidth={20} />
      <circle r={94} className="fill-none stroke-hud-cyan/45" strokeWidth={0.6} />
      <circle r={74} className="fill-none stroke-hud-cyan/70" strokeWidth={0.9} />
      <circle r={50} fill="url(#flat-core-disc)" />
      <Globe radius={42} />
    </g>
  );
}

/** Bright segments around the edge, two of them stepped out. */
function Rim() {
  return (
    <g className="fill-none stroke-hud-holo" filter="url(#flat-core-glow)">
      {RIM.map(([from, to, radius]) => (
        <path key={from} d={arc(radius, from, to)} strokeWidth={radius > 98 ? 1.2 : 2.6} />
      ))}
    </g>
  );
}

/** The scale on the band: short bright dashes all the way round, a few left out. */
function Ticks() {
  const angles = Array.from({ length: 60 }, (_, i) => i * 6).filter((angle) => ![24, 30, 162, 246].includes(angle));
  return (
    <g filter="url(#flat-core-glow)">
      {angles.map((angle) => (
        <line key={angle} x1={81} x2={88} transform={`rotate(${angle})`} className="stroke-hud-holo/90" strokeWidth={1.6} />
      ))}
      {[24, 162].map((angle) => (
        <path key={angle} d={arc(84.5, angle, angle + 8)} className="fill-none stroke-hud-cyan/80" strokeWidth={6} />
      ))}
    </g>
  );
}

/** The band right outside the inner ring, with its brighter stretches. */
function InnerBand() {
  return (
    <g className="fill-none">
      <circle r={57.5} className="stroke-hud-cyan/15" strokeWidth={5} />
      <path d={arc(57.5, -42, 38)} className="stroke-hud-holo/55" strokeWidth={5} />
      <path d={arc(57.5, 112, 140)} className="stroke-hud-holo/40" strokeWidth={5} />
      <path d={arc(60.5, 200, 232)} className="stroke-hud-cyan/60" strokeWidth={0.8} />
    </g>
  );
}

/** The amber bracket on the left, with its notches. */
function AmberBracket() {
  return (
    <g className="fill-none stroke-hud-amber" filter="url(#flat-core-glow)">
      <path d={arc(65, 152, 206)} strokeWidth={2.2} />
      <path d={arc(62, 163, 195)} strokeWidth={0.8} opacity={0.75} />
      {[152, 179, 206].map((angle) => (
        <line key={angle} x1={65} x2={angle === 179 ? 61 : 60} transform={`rotate(${angle})`} strokeWidth={1.4} />
      ))}
    </g>
  );
}

/** The little plate under the heart: two crossed boxes. */
function Plate() {
  return (
    <g className="fill-none stroke-hud-light/70" strokeWidth={0.6} transform="translate(0 37)">
      <rect x={-9} y={-2.5} width={18} height={5} />
      <line x1={0} y1={-2.5} x2={0} y2={2.5} />
      <path d="M-9 -2.5 L0 2.5 M-9 2.5 L0 -2.5 M0 -2.5 L9 2.5 M0 2.5 L9 -2.5" opacity={0.6} />
    </g>
  );
}

/** Four brackets on the diagonals: out of sight at rest, closing on the core while it listens. */
function LockBrackets() {
  return (
    <g className="fill-none stroke-hud-glow" strokeWidth={1.8} filter="url(#flat-core-glow)">
      {[45, 135, 225, 315].map((angle) => (
        <g key={angle} transform={`rotate(${angle})`}>
          <path d={arc(66, -11, 11)} />
          <line x1={66} x2={61.5} transform="rotate(-11)" />
          <line x1={66} x2={61.5} transform="rotate(11)" />
        </g>
      ))}
    </g>
  );
}

/** A faint wireframe globe: meridians and parallels. */
function Globe({ radius }: { radius: number }) {
  return (
    <g className="fill-none stroke-hud-holo" strokeWidth={0.45} opacity={0.3}>
      {[25, 50, 72].map((angle) => (
        <ellipse key={angle} rx={radius * Math.cos((angle * Math.PI) / 180)} ry={radius} />
      ))}
      <line y1={-radius} y2={radius} />
      {[-55, -28, 0, 28, 55].map((latitude) => {
        const rx = radius * Math.cos((latitude * Math.PI) / 180);
        return <ellipse key={latitude} cy={radius * Math.sin((latitude * Math.PI) / 180)} rx={rx} ry={rx * 0.24} />;
      })}
    </g>
  );
}

/** SVG arc along a circle of `radius`, between two angles (degrees, clockwise from 3 o'clock). */
function arc(radius: number, from: number, to: number) {
  const point = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return `${(radius * Math.cos(radians)).toFixed(2)} ${(radius * Math.sin(radians)).toFixed(2)}`;
  };
  return `M ${point(from)} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

/** An equilateral triangle pointing down, of circumradius `radius`, its centre at `cy`. */
function triangle(radius: number, cy: number) {
  return [90, 210, 330]
    .map((angle) => {
      const radians = (angle * Math.PI) / 180;
      return `${(radius * Math.cos(radians)).toFixed(2)},${(cy + radius * Math.sin(radians)).toFixed(2)}`;
    })
    .join(" ");
}
