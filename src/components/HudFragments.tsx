import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Vector3 } from "three";
import { useDisposables } from "../hooks/useDisposables";
import { createFatLines } from "../lib/fatLines";
import { fadeEnds, LineBuilder, planePoint, TAU } from "../lib/geometry";
import { approach, useSignals } from "../lib/signals";
import { colors } from "../lib/sceneColors";
import { createHoloLineMaterial } from "../shaders/hologram/holoLineMaterial";

const DEG = Math.PI / 180;

/**
 * Layer 04 — measurement scales, dotted circles, brackets, luminous markers and a
 * periodic scan ping, on a near-frontal plane around the core.
 */
export function HudFragments() {
  const signals = useSignals();
  const scale = useRef<Group>(null);
  const dotted = useRef<Group>(null);
  const brackets = useRef<Group>(null);
  const markers = useRef<Group>(null);
  const ping = useRef<Group>(null);
  const pingState = useRef({ phase: 0.35, rate: 1 / 7, pulse: 0 });

  const parts = useMemo(() => {
    // 270° gauge with minor ticks every 3° and major ticks every 15°.
    const gauge = new LineBuilder();
    const start = -225 * DEG;
    const end = 45 * DEG;
    gauge.arc(2.75, start, end, 180, "xy", fadeEnds(0.04, 0.7));
    gauge.ticks(2.75, 2.8, 90, start, end, "xy", (i) => (i % 5 === 0 ? 0 : 0.55));
    gauge.ticks(2.71, 2.86, 18, start, end, "xy", () => 1);

    // Dotted circle; every tenth dot brighter.
    const dots = new LineBuilder().dots(2.93, 144, 0.006, "xy", (i) => (i % 12 === 0 ? 1 : 0.42));

    // Four 18° brackets with inward end caps.
    const bracket = new LineBuilder();
    const a = new Vector3();
    const b = new Vector3();
    for (let k = 0; k < 4; k++) {
      const center = (k * 90 + 45) * DEG;
      bracket.arc(3.06, center - 9 * DEG, center + 9 * DEG, 24, "xy", () => 0.9);
      for (const end of [center - 9 * DEG, center + 9 * DEG]) {
        bracket.segment(planePoint(3.0, end, "xy", a), planePoint(3.06, end, "xy", b), 0.9);
      }
    }

    // Twelve small luminous bars (wide strokes) plus four outlined cells.
    const bars = new LineBuilder();
    for (let k = 0; k < 12; k++) {
      const angle = (k * 30 + 15) * DEG;
      bars.segment(planePoint(2.865, angle - 0.022, "xy", a), planePoint(2.865, angle + 0.022, "xy", b), k % 3 === 0 ? 1.4 : 0.75);
    }
    const barArrays = bars.toFatArrays();
    const cells = new LineBuilder();
    for (let k = 0; k < 4; k++) cells.rect(2.865, (k * 90 + 2) * DEG, 0.13, 0.05, 0.75);

    const pingCircle = new LineBuilder().arc(1, 0, TAU, 160, "xy", () => 1);

    return {
      dimGeometry: gauge.toGeometry(),
      dimMaterial: createHoloLineMaterial({ color: colors.cyan, opacity: 0.55, backFade: 0 }),
      dotGeometry: dots.toGeometry(),
      dotMaterial: createHoloLineMaterial({ color: colors.light, opacity: 0.6, backFade: 0 }),
      bracketGeometry: bracket.toGeometry(),
      cellGeometry: cells.toGeometry(),
      brightMaterial: createHoloLineMaterial({ color: colors.holo, opacity: 0.7, backFade: 0 }),
      bars: createFatLines(barArrays.positions, barArrays.colors, 3.2, 0),
      pingGeometry: pingCircle.toGeometry(),
      pingMaterial: createHoloLineMaterial({ color: colors.holo, opacity: 0, backFade: 0 }),
    };
  }, []);

  useDisposables(
    parts.dimGeometry,
    parts.dimMaterial,
    parts.dotGeometry,
    parts.dotMaterial,
    parts.bracketGeometry,
    parts.cellGeometry,
    parts.brightMaterial,
    parts.bars.geometry,
    parts.bars.material,
    parts.pingGeometry,
    parts.pingMaterial,
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = signals.time;
    if (scale.current) scale.current.rotation.z = t * 0.022;
    if (dotted.current) dotted.current.rotation.z = -t * 0.035;
    // Brackets advance in slow surges instead of a constant drift.
    if (brackets.current) brackets.current.rotation.z = t * 0.05 + Math.sin(t * 0.21) * 0.25;
    if (markers.current) markers.current.rotation.z = -t * 0.016;

    // Ping: expanding ring, more frequent while the voice is active; an event pulse fires a new one.
    const state = pingState.current;
    if (signals.pulse > state.pulse + 0.5) state.phase = Math.ceil(state.phase);
    state.pulse = signals.pulse;
    state.rate = approach(state.rate, 1 / (7 - 3 * signals.level - 2.5 * signals.voice), dt, 0.8);
    state.phase += dt * state.rate;
    const p = state.phase % 1;
    const eased = 1 - Math.pow(1 - p, 3);
    ping.current?.scale.setScalar(1.08 + 2.02 * eased);
    parts.pingMaterial.uniforms.uOpacity.value = 0.55 * Math.pow(1 - p, 2) * Math.min(1, p * 25);

    parts.dimMaterial.uniforms.uOpacity.value = 0.55 + signals.active * 0.05 + signals.level * 0.2;
    parts.bars.material.color.copy(colors.holo).multiplyScalar(1 + signals.voice * 0.5);
  });

  return (
    <group rotation={[-0.2, 0.14, 0.02]}>
      <group ref={scale}>
        <lineSegments geometry={parts.dimGeometry} material={parts.dimMaterial} />
      </group>
      <group ref={dotted}>
        <lineSegments geometry={parts.dotGeometry} material={parts.dotMaterial} />
      </group>
      <group ref={brackets}>
        <lineSegments geometry={parts.bracketGeometry} material={parts.brightMaterial} />
      </group>
      <group ref={markers}>
        <primitive object={parts.bars} />
        <lineSegments geometry={parts.cellGeometry} material={parts.brightMaterial} />
      </group>
      <group ref={ping}>
        <lineSegments geometry={parts.pingGeometry} material={parts.pingMaterial} />
      </group>
    </group>
  );
}
