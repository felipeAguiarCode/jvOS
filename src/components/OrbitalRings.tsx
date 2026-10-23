import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Euler, Group, MathUtils, Quaternion, Vector3 } from "three";
import { useDisposables } from "../hooks/useDisposables";
import { createFatLines } from "../lib/fatLines";
import { LineBuilder, litSpans, planePoint, PointBuilder, TAU } from "../lib/geometry";
import { EQUATOR_QUATERNION, RINGS, type Ring } from "../lib/rings";
import { useSignals } from "../lib/signals";
import { colors } from "../lib/sceneColors";
import { createHoloLineMaterial } from "../shaders/hologram/holoLineMaterial";
import { createHoloPointsMaterial } from "../shaders/hologram/holoPointsMaterial";

const RUNNER_TRAIL = 16;
/** How much later each ring starts swinging onto the equator, and how long the swing takes (in `align`). */
const LOCK_STAGGER = 0.12;
const LOCK_SPAN = 0.64;

const restTilt = new Euler();
const restOrientation = new Quaternion();

/**
 * Layer 03 — tilted orbital rings, each spinning independently with light runners. While JARVIS
 * listens they swing one after another onto the core's equator, like a gyroscope locking.
 */
export function OrbitalRings() {
  return (
    <>
      {RINGS.map((spec, index) => (
        <Ring key={index} spec={spec} index={index} />
      ))}
    </>
  );
}

function Ring({ spec, index }: { spec: Ring; index: number }) {
  const signals = useSignals();
  const tilt = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const runner = useRef<Group>(null);
  const phase = useRef({ spin: index * 0.9, runner: index * 1.7 });

  const { stroke, detailGeometry, detailMaterial, runnerGeometry, runnerMaterial } = useMemo(() => {
    const R = spec.radius;

    // Main stroke: wide line, lit stretches over a faint base.
    const main = new LineBuilder().arc(R, 0, TAU, 288, "xz", litSpans(spec.spans, spec.base));
    const { positions, colors: rgb } = main.toFatArrays();
    const stroke = createFatLines(positions, rgb, spec.width);

    // Thin companion circle, tick scale and notches marking the lit stretches.
    const detail = new LineBuilder();
    const twin = R + spec.twin;
    detail.arc(twin, 0, TAU, 220, "xz", () => 0.32);
    const [from, to] = spec.ticks;
    const minor = Math.round((to - from) * 90);
    const outward = Math.sign(spec.twin);
    detail.ticks(twin, twin + outward * 0.05, minor, from * TAU, to * TAU, "xz", (i) => (i % 5 === 0 ? 0 : 0.5));
    detail.ticks(twin, twin + outward * 0.11, Math.ceil(minor / 5), from * TAU, to * TAU, "xz", () => 0.95);
    const a = new Vector3();
    const b = new Vector3();
    for (const [start, end] of spec.spans) {
      for (const turn of [start, end]) {
        planePoint(R, turn * TAU, "xz", a);
        detail.segment(b.copy(a).setY(-0.045), a.setY(0.045), 0.85);
      }
    }

    // Runners: a bright head followed by a fading trail.
    const points = new PointBuilder();
    const direction = Math.sign(spec.runnerSpeed);
    for (const start of spec.runners) {
      for (let k = 0; k < RUNNER_TRAIL; k++) {
        const fade = 1 - k / RUNNER_TRAIL;
        const angle = start * TAU - direction * k * 0.016;
        points.add(planePoint(R, angle, "xz", a), 2 + 4.2 * fade, (k === 0 ? 3.2 : 1.6) * fade * fade, 0);
      }
    }

    return {
      stroke,
      detailGeometry: detail.toGeometry(),
      detailMaterial: createHoloLineMaterial({ color: colors.cyan, opacity: 0.85, backFade: 0.55 }),
      runnerGeometry: points.toGeometry(),
      runnerMaterial: createHoloPointsMaterial({ color: colors.light, intensity: 1, twinkle: 0 }),
    };
  }, [spec]);

  useDisposables(stroke.geometry, stroke.material, detailGeometry, detailMaterial, runnerGeometry, runnerMaterial);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = signals.time;
    const boost = 1 + signals.mid * 1.2;
    // Speed breathes slowly so no two rings stay in lockstep.
    const variation = 1 + 0.28 * Math.sin(t * 0.13 + index * 1.7);
    phase.current.spin += dt * spec.speed * variation * boost;
    phase.current.runner += dt * spec.runnerSpeed * (0.85 + 0.15 * variation) * boost;

    if (spin.current) spin.current.rotation.y = phase.current.spin;
    if (runner.current) runner.current.rotation.y = phase.current.runner;
    if (tilt.current) {
      restTilt.set(
        spec.tilt[0] + Math.sin(t * 0.09 + index * 2.1) * 0.035,
        spec.tilt[1],
        spec.tilt[2] + Math.sin(t * 0.07 + index) * 0.03,
      );
      const start = index * LOCK_STAGGER;
      const lock = MathUtils.smoothstep(signals.align, start, start + LOCK_SPAN);
      tilt.current.quaternion.slerpQuaternions(restOrientation.setFromEuler(restTilt), EQUATOR_QUATERNION, lock);
    }

    const glow =
      1 + signals.mid * 0.45 + signals.active * 0.06 + signals.voice * 0.55 + signals.pulse * 0.35 + signals.align * 0.25;
    stroke.material.color.copy(colors.holo).multiplyScalar(glow);
    detailMaterial.uniforms.uOpacity.value = 0.8 + signals.mid * 0.5;
    runnerMaterial.uniforms.uIntensity.value = 1 + signals.mid * 0.5;
  });

  return (
    <group ref={tilt} rotation={spec.tilt}>
      <group ref={spin}>
        <primitive object={stroke} />
        <lineSegments geometry={detailGeometry} material={detailMaterial} />
      </group>
      <group ref={runner}>
        <points geometry={runnerGeometry} material={runnerMaterial} frustumCulled={false} />
      </group>
    </group>
  );
}
