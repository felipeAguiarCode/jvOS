import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { motion } from "motion/react";
import { COMPOSITION_CSS, CORE_CENTER_Y_CSS } from "../lib/layout";
import type { HoloSignals } from "../lib/signals";
import type { Ignition } from "./JarvisScene";

/** An orbit: radius (of 100), tilt and squash at rest (a circle seen at an angle), turn time. */
interface Orbit {
  radius: number;
  tilt: number;
  squash: number;
  spin: number;
  reverse?: boolean;
  dash?: string;
}

const ORBITS: Orbit[] = [
  { radius: 54, tilt: -22, squash: 0.34, spin: 17 },
  { radius: 62, tilt: 31, squash: 0.44, spin: 24, reverse: true, dash: "5 2.2" },
  { radius: 71, tilt: 66, squash: 0.24, spin: 33, dash: "0.8 2.6" },
];
/** Listening for a command, every orbit lies down on the core's equator (as in the 3D hologram). */
const ALIGNED_SQUASH = 0.22;
const ALIGNED_SCALE = 1.12;

interface FlatCoreProps {
  ignition: Ignition;
  signals: HoloSignals;
  sample: (delta: number) => void;
  paused: boolean;
  onFirstFrame: () => void;
}

/**
 * The light core: the hologram's rings as vector layers, no WebGL. Each ring is its own layer
 * spun by the compositor (no repaint per frame); the voice only moves a few transforms and
 * opacities. Paused (hidden, or behind a maximised app), nothing runs.
 */
export function FlatCore({ ignition, signals, sample, paused, onFirstFrame }: FlatCoreProps) {
  const halo = useRef<HTMLDivElement>(null);
  const voice = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const orbits = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const id = requestAnimationFrame(onFirstFrame);
    return () => cancelAnimationFrame(id);
  }, [onFirstFrame]);

  useEffect(() => {
    if (paused) return;
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
    let frame = requestAnimationFrame(function tick(now) {
      sample((now - last) / 1000);
      last = now;
      const { level, bass, voice: speaking, pulse, active, align } = signals;
      const round = (value: number) => value.toFixed(3);
      set(halo.current, "opacity", round(Math.min(1, 0.4 + level * 0.35 + speaking * 0.15 + pulse * 0.5)));
      set(halo.current, "transform", `scale(${round(1 + bass * 0.12 + pulse * 0.1)})`);
      set(voice.current, "opacity", round(Math.min(1, 0.12 + active * 0.18 + speaking * 0.6 + pulse * 0.4)));
      set(voice.current, "transform", `scale(${round(1 + level * 0.22)})`);
      set(hud.current, "opacity", round(Math.min(1, 0.6 + active * 0.25 + pulse * 0.3)));
      ORBITS.forEach((orbit, i) => {
        const tilt = orbit.tilt * (1 - align);
        const squash = orbit.squash + (ALIGNED_SQUASH - orbit.squash) * align;
        const scale = 1 + (ALIGNED_SCALE - 1) * align;
        set(orbits.current[i], "transform", `rotate(${tilt.toFixed(2)}deg) scale(${round(scale)}, ${round(scale * squash)})`);
      });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [paused, sample, signals]);

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
        {/* The glow behind the core, breathing with the voice. */}
        <div
          ref={halo}
          className="absolute inset-[22%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-hud-holo) 30%, transparent), transparent 68%)" }}
        />
        <Layer spin={140} ref={hud}>
          <HudRing />
        </Layer>
        <Layer spin={90} reverse>
          <circle r={84} className="fill-none stroke-hud-light/60" strokeWidth={0.7} strokeDasharray="0.1 2.6" strokeLinecap="round" />
        </Layer>
        <Layer>
          <circle r={64} className="fill-none stroke-hud-cyan/30" strokeWidth={0.45} />
          <Globe />
        </Layer>
        {ORBITS.map((orbit, i) => (
          <div
            key={orbit.radius}
            ref={(element) => {
              orbits.current[i] = element;
            }}
            data-orbit
            className="absolute inset-0 will-change-transform"
            style={{ transform: `rotate(${orbit.tilt}deg) scale(1, ${orbit.squash})` }}
          >
            <Layer spin={orbit.spin} reverse={orbit.reverse}>
              <circle r={orbit.radius} className="fill-none stroke-hud-holo/70" strokeWidth={1.1} strokeDasharray={orbit.dash} />
              {/* A brighter stretch and a satellite riding the orbit. */}
              <circle
                r={orbit.radius}
                className="fill-none stroke-hud-glow"
                strokeWidth={1.4}
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="9 91"
                filter="url(#flat-core-glow)"
              />
              <circle cx={orbit.radius} r={2} className="fill-hud-glow" filter="url(#flat-core-glow)" />
            </Layer>
          </div>
        ))}
        <div ref={voice} className="absolute inset-0 opacity-10 will-change-transform">
          <Svg>
            <circle r={41} className="fill-none stroke-hud-light" strokeWidth={0.9} filter="url(#flat-core-glow)" />
          </Svg>
        </div>
        <svg aria-hidden className="absolute size-0">
          <defs>
            <filter id="flat-core-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
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

/** The outer HUD: a scale of ticks, four brackets and markers, like the hologram's outer arcs. */
function HudRing() {
  const ticks = Array.from({ length: 120 }, (_, i) => i * 3);
  return (
    <g filter="url(#flat-core-glow)">
      <circle r={92} className="fill-none stroke-hud-line" strokeWidth={0.4} />
      {ticks.map((angle) => {
        const long = angle % 15 === 0;
        return (
          <line
            key={angle}
            x1={long ? 86 : 89}
            x2={92}
            transform={`rotate(${angle})`}
            className={long ? "stroke-hud-cyan/80" : "stroke-hud-line"}
            strokeWidth={long ? 0.55 : 0.35}
          />
        );
      })}
      {[38, 128, 218, 308].map((angle) => (
        <path key={angle} d={arc(97, angle, angle + 22)} className="fill-none stroke-hud-cyan" strokeWidth={1.3} />
      ))}
      {[12, 75, 164, 251, 333].map((angle) => (
        <path key={angle} d={arc(90, angle, angle + 3)} className="fill-none stroke-hud-holo" strokeWidth={2} strokeLinecap="round" />
      ))}
      {[0, 90, 180, 270].map((angle) => (
        <rect key={angle} x={94} y={-1.6} width={2.4} height={3.2} transform={`rotate(${angle})`} className="fill-none stroke-hud-cyan" strokeWidth={0.5} />
      ))}
    </g>
  );
}

/** The wireframe planet: meridians, parallels and the crystal at its heart. */
function Globe() {
  const radius = 31;
  return (
    <g className="fill-none stroke-hud-holo" strokeWidth={0.5}>
      <circle r={radius} className="stroke-hud-cyan" strokeWidth={0.8} />
      {[18, 42, 66].map((angle) => (
        <ellipse key={angle} rx={radius * Math.cos((angle * Math.PI) / 180)} ry={radius} opacity={0.65} />
      ))}
      <line y1={-radius} y2={radius} opacity={0.65} />
      {[-60, -30, 0, 30, 60].map((latitude) => {
        const rx = radius * Math.cos((latitude * Math.PI) / 180);
        return <ellipse key={latitude} cy={radius * Math.sin((latitude * Math.PI) / 180)} rx={rx} ry={rx * 0.22} opacity={0.55} />;
      })}
      <g filter="url(#flat-core-glow)" className="stroke-hud-glow" strokeWidth={0.7}>
        <polygon points={hexagon(9)} />
        <polygon points={hexagon(9, 2)} opacity={0.6} />
        <circle r={2.4} className="fill-hud-glow" />
      </g>
    </g>
  );
}

/** SVG arc along a circle of `radius`, between two angles (degrees, clockwise from 3 o'clock). */
function arc(radius: number, from: number, to: number) {
  const point = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return `${(radius * Math.cos(radians)).toFixed(2)} ${(radius * Math.sin(radians)).toFixed(2)}`;
  };
  return `M ${point(from)} A ${radius} ${radius} 0 0 1 ${point(to)}`;
}

/** A hexagon of `radius`; with `step` 2, the triangle on every other vertex. */
function hexagon(radius: number, step = 1) {
  return Array.from({ length: 6 / step }, (_, i) => {
    const angle = ((i * step * 60 - 90) * Math.PI) / 180;
    return `${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}
