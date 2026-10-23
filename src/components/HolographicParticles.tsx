import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Euler, Vector3 } from "three";
import { useDisposables } from "../hooks/useDisposables";
import { createRandom, PointBuilder, TAU } from "../lib/geometry";
import { RINGS } from "../lib/rings";
import { useSignals } from "../lib/signals";
import { colors } from "../lib/sceneColors";
import { createHoloPointsMaterial } from "../shaders/hologram/holoPointsMaterial";

/** Share of particles that travel in bands along the orbital rings (the rest form a loose shell). */
const BAND_SHARE = 0.6;

/**
 * Layer 05 — particles flying around the core: surging orbits whose planes nod, plus breathing,
 * bobbing and small loops. While JARVIS listens they align on the core's equator, a disk on the
 * ring lanes. Everything is computed in the vertex shader; the CPU never touches the buffer.
 */
export function HolographicParticles({ count }: { count: number }) {
  const signals = useSignals();

  const { geometry, material } = useMemo(() => {
    const random = createRandom(97);
    const builder = new PointBuilder();
    const tilt = new Euler();
    const position = new Vector3();
    const axis = new Vector3();
    const bandCount = Math.round(count * BAND_SHARE);

    for (let i = 0; i < bandCount; i++) {
      const ring = RINGS[i % RINGS.length];
      tilt.set(...ring.tilt);
      const angle = random() * TAU;
      const radius = ring.radius + (random() - 0.5) * 0.18;
      position.set(Math.cos(angle) * radius, (random() - 0.5) * 0.07, Math.sin(angle) * radius).applyEuler(tilt);
      axis.set(0, 1, 0).applyEuler(tilt);
      const speed = Math.sign(ring.speed) * (0.05 + random() * 0.12);
      const bright = random() < 0.07;
      builder.add(position, 1.1 + random() * 1.7, bright ? 1.5 + random() : 0.3 + random() * 0.45, random() * TAU, speed, axis);
    }

    for (let i = bandCount; i < count; i++) {
      // Uniform direction, radius biased toward the core.
      const z = random() * 2 - 1;
      const theta = random() * TAU;
      const s = Math.sqrt(1 - z * z);
      const radius = 1.15 + Math.pow(random(), 1.7) * 1.5;
      position.set(Math.cos(theta) * s, z, Math.sin(theta) * s).multiplyScalar(radius);
      axis.set((random() - 0.5) * 0.7, 1, (random() - 0.5) * 0.7).normalize();
      const speed = (random() < 0.85 ? 1 : -1) * (0.03 + random() * 0.1);
      const bright = random() < 0.06;
      builder.add(position, 0.9 + random() * 1.5, bright ? 1.3 + random() : 0.22 + random() * 0.4, random() * TAU, speed, axis);
    }

    return {
      geometry: builder.toGeometry(),
      material: createHoloPointsMaterial({ color: colors.light, intensity: 1, wander: true }),
    };
  }, [count]);

  useDisposables(geometry, material);

  useFrame(() => {
    const u = material.uniforms;
    u.uIntensity.value = 0.95 + signals.active * 0.1;
    u.uAlign.value = signals.align;
    // The aligned orbits start from wherever the particles are when the alignment begins; held
    // while aligned, so pressing again mid-scatter continues smoothly instead of jumping.
    if (signals.align < 0.01) u.uAlignStart.value = signals.time;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
