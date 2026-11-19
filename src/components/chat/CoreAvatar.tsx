import type { CSSProperties } from "react";

/** The rim's bright segments, as in the 2D core (degrees, clockwise from 3 o'clock). */
const RIM: [number, number][] = [
  [196, 254],
  [262, 300],
  [306, 336],
  [344, 392],
  [400, 448],
  [456, 486],
  [494, 548],
];

function arc(radius: number, from: number, to: number) {
  const point = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return `${(radius * Math.cos(radians)).toFixed(1)} ${(radius * Math.sin(radians)).toFixed(1)}`;
  };
  return `M ${point(from)} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

const TRIANGLE = [90, 210, 330]
  .map((angle) => {
    const radians = (angle * Math.PI) / 180;
    return `${(40 * Math.cos(radians)).toFixed(1)},${(5 + 40 * Math.sin(radians)).toFixed(1)}`;
  })
  .join(" ");

/**
 * JARVIS's face in the chat: the 2D core in miniature (segmented rim, inner ring, the triangle
 * at the heart). Plain vector, no filters and no WebGL; the rim only turns while he answers.
 */
export function CoreAvatar({ size = 28, active = false }: { size?: number; active?: boolean }) {
  return (
    <span aria-hidden data-testid="core-avatar" data-active={active || undefined} className="relative block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 size-full">
        <circle r={100} className="fill-hud-abyss" />
        <circle r={62} className="fill-none stroke-hud-cyan/60" strokeWidth={5} />
        <polygon points={TRIANGLE} className="fill-hud-cyan/15 stroke-hud-glow" strokeWidth={9} strokeLinejoin="miter" />
      </svg>
      <span className={`absolute inset-0 ${active ? "core-spin" : ""}`} style={active ? ({ "--spin": "6s" } as CSSProperties) : undefined}>
        <svg viewBox="-100 -100 200 200" className="absolute inset-0 size-full">
          <g className="fill-none stroke-hud-holo" strokeWidth={9}>
            {RIM.map(([from, to]) => (
              <path key={from} d={arc(90, from, to)} />
            ))}
          </g>
        </svg>
      </span>
    </span>
  );
}
