import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, LineSegments } from "three";
import { useDisposables } from "../hooks/useDisposables";
import { TAU } from "../lib/geometry";
import { useSignals } from "../lib/signals";
import { createVoiceWaveMaterial } from "../shaders/hologram/voiceWaveMaterial";

/** Waveform rings between the core and the outer shell: [radius, lift, brightness]. */
const WAVES: [number, number, number][] = [
  [1.1, 0.17, 0.95],
  [1.15, 0.12, 0.55],
  [1.2, 0.08, 0.32],
];
const WAVE_STEPS = 200;
/** Radial spectrum bars just outside the waveform. */
const BARS = 120;
const BAR_RADIUS = 1.3;
const BAR_BASE = 0.025;
const BAR_LIFT = 0.34;

function buildGeometry() {
  const positions: number[] = [];
  const alphas: number[] = [];
  const lifts: number[] = [];
  const seeds: number[] = [];
  const vertex = (angle: number, radius: number, alpha: number, lift: number, seed: number) => {
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    alphas.push(alpha);
    lifts.push(lift);
    seeds.push(seed);
  };

  WAVES.forEach(([radius, lift, alpha], seed) => {
    for (let i = 0; i < WAVE_STEPS; i++) {
      vertex((i / WAVE_STEPS) * TAU, radius, alpha, lift, seed);
      vertex(((i + 1) / WAVE_STEPS) * TAU, radius, alpha, lift, seed);
    }
  });

  // Only the outer end of a bar moves: it grows with the energy of its band.
  for (let i = 0; i < BARS; i++) {
    const angle = (i / BARS) * TAU;
    const alpha = i % 4 === 0 ? 0.9 : 0.55;
    vertex(angle, BAR_RADIUS, alpha, 0, WAVES.length);
    vertex(angle, BAR_RADIUS + BAR_BASE, alpha * 0.35, BAR_LIFT, WAVES.length);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aAlpha", new Float32BufferAttribute(alphas, 1));
  geometry.setAttribute("aLift", new Float32BufferAttribute(lifts, 1));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
  return geometry;
}

/** Layer 07 — voice waveform: invisible in silence, follows the speech spectrum around the core. */
export function VoiceWave() {
  const signals = useSignals();
  const lines = useRef<LineSegments>(null);
  const { geometry, material } = useMemo(() => ({ geometry: buildGeometry(), material: createVoiceWaveMaterial() }), []);

  useDisposables(geometry, material);

  useFrame(() => {
    if (lines.current) lines.current.visible = signals.voice > 0.003;
  });

  return <lineSegments ref={lines} geometry={geometry} material={material} frustumCulled={false} />;
}
