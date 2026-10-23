import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Euler, Float32BufferAttribute, Group, IcosahedronGeometry, PlaneGeometry, Vector3, WireframeGeometry } from "three";
import { useDisposables } from "../hooks/useDisposables";
import { createRandom, fadeEnds, LineBuilder, PointBuilder, spherePoint, TAU } from "../lib/geometry";
import { CORE_TILT } from "../lib/rings";
import type { QualityPreset } from "../lib/quality";
import { useSignals } from "../lib/signals";
import { colors } from "../lib/sceneColors";
import { createHaloMaterial } from "../shaders/hologram/haloMaterial";
import { createHoloLineMaterial } from "../shaders/hologram/holoLineMaterial";
import { createHoloPointsMaterial } from "../shaders/hologram/holoPointsMaterial";
import { HolographicParticles } from "./HolographicParticles";
import { HudFragments } from "./HudFragments";
import { OrbitalRings } from "./OrbitalRings";
import { VoiceWave } from "./VoiceWave";

const DEG = Math.PI / 180;
const OUTER_RADIUS = 1.45;
/** Half-size of the halo quad, in core radii (it also carries the background lift). */
const HALO_EXTENT = 4.2;

/** Root of the hologram: all seven layers, gently scaled by the overall voice level. */
export function JarvisCore({ quality }: { quality: QualityPreset }) {
  const signals = useSignals();
  const root = useRef<Group>(null);

  useFrame(() => {
    root.current?.scale.setScalar(1 + signals.level * 0.05 + signals.voice * 0.03 + signals.pulse * 0.025);
  });

  return (
    <group ref={root}>
      <InnerCore density={quality.wireDensity} />
      <OuterShell />
      <VoiceWave />
      <OrbitalRings />
      <HudFragments />
      <HolographicParticles count={quality.particles} />
    </group>
  );
}

/** Layer 01 — wireframe sphere, counter-rotating geodesic lattice, surface nodes. Layer 06 — halo. */
function InnerCore({ density }: { density: number }) {
  const signals = useSignals();
  const pulse = useRef<Group>(null);
  const grid = useRef<Group>(null);
  const lattice = useRef<Group>(null);

  const { gridGeometry, gridMaterial, nodeGeometry, nodeMaterial } = useMemo(() => {
    const meridians = Math.max(12, Math.round((24 * density) / 2) * 2);
    const parallels = Math.round(15 * density) | 1; // odd → there is always an equator
    const builder = new LineBuilder();
    const nodes = new PointBuilder();
    const random = createRandom(11);
    const point = new Vector3();

    for (let m = 0; m < meridians; m++) {
      const lon = (m / meridians) * TAU;
      const emphasis = m % 3 === 0 ? 1 : 0.62;
      // Fade toward the poles so converging meridians don't form bright knots.
      builder.curve(
        56,
        (t, out) => spherePoint(1, -Math.PI / 2 + Math.PI * t, lon, out),
        (t) => emphasis * (0.12 + 0.88 * Math.pow(Math.sin(Math.PI * t), 0.9)),
      );
    }

    for (let p = 0; p < parallels; p++) {
      const lat = -Math.PI / 2 + (Math.PI * (p + 1)) / (parallels + 1);
      const equator = Math.abs(lat) < 1e-4;
      const level = equator ? 1.1 : 0.42 + 0.3 * Math.cos(lat);
      builder.curve(96, (t, out) => spherePoint(1, lat, t * TAU, out), () => level);

      // Nodes sit on grid intersections, sparsely.
      for (let m = 0; m < meridians; m++) {
        if (random() > 0.2) continue;
        const lon = (m / meridians) * TAU;
        nodes.add(spherePoint(1.003, lat, lon, point), 2.2 + random() * 2.4, 0.55 + random() * 0.9, random() * TAU);
      }
    }

    return {
      gridGeometry: builder.toGeometry(),
      gridMaterial: createHoloLineMaterial({ color: colors.cyan, opacity: 0.5, displace: 0.012, backFade: 0.72 }),
      nodeGeometry: nodes.toGeometry(),
      nodeMaterial: createHoloPointsMaterial({ color: colors.light, intensity: 1 }),
    };
  }, [density]);

  const { latticeGeometry, latticeMaterial, innerGeometry, innerMaterial } = useMemo(() => {
    const wireframe = (source: IcosahedronGeometry) => {
      const geometry = new WireframeGeometry(source);
      source.dispose();
      const count = geometry.getAttribute("position").count;
      geometry.setAttribute("aAlpha", new Float32BufferAttribute(new Float32Array(count).fill(1), 1));
      return geometry;
    };
    return {
      latticeGeometry: wireframe(new IcosahedronGeometry(0.62, 2)),
      latticeMaterial: createHoloLineMaterial({ color: colors.line, opacity: 1.3, backFade: 0.5 }),
      innerGeometry: wireframe(new IcosahedronGeometry(0.3, 0)),
      innerMaterial: createHoloLineMaterial({ color: colors.light, opacity: 0.45, backFade: 0.4 }),
    };
  }, []);

  const { haloGeometry, haloMaterial } = useMemo(
    () => ({
      haloGeometry: new PlaneGeometry(HALO_EXTENT * 2, HALO_EXTENT * 2),
      haloMaterial: createHaloMaterial(HALO_EXTENT),
    }),
    [],
  );

  useDisposables(gridGeometry, gridMaterial, nodeGeometry, nodeMaterial);
  useDisposables(latticeGeometry, latticeMaterial, innerGeometry, innerMaterial, haloGeometry, haloMaterial);

  useFrame(() => {
    const t = signals.time;
    pulse.current?.scale.setScalar(1 + 0.014 * Math.sin(t * 1.1) + 0.006 * Math.sin(t * 2.7) + signals.bass * 0.07);

    if (grid.current) grid.current.rotation.y = t * 0.06;
    if (lattice.current) {
      lattice.current.rotation.y = -t * 0.11;
      lattice.current.rotation.x = Math.sin(t * 0.17) * 0.35;
    }

    const u = gridMaterial.uniforms;
    u.uOpacity.value = 0.48 + 0.05 * Math.sin(t * 0.8) + signals.active * 0.05 + signals.level * 0.25 + signals.pulse * 0.35;
    u.uScanHeight.value = Math.sin(t * 0.42) * 0.96;
    u.uScanStrength.value = 1.4 + signals.level * 1.5 + signals.pulse * 2.5;
    latticeMaterial.uniforms.uOpacity.value = 1.2 + signals.bass * 1.2;
  });

  return (
    <group ref={pulse}>
      {/* Axial tilt toward the camera: parallels read as ellipses instead of a flat grid. */}
      <group rotation={CORE_TILT}>
        <group ref={grid}>
          <lineSegments geometry={gridGeometry} material={gridMaterial} />
          <points geometry={nodeGeometry} material={nodeMaterial} frustumCulled={false} />
        </group>
      </group>
      <group ref={lattice}>
        <lineSegments geometry={latticeGeometry} material={latticeMaterial} />
        <lineSegments geometry={innerGeometry} material={innerMaterial} rotation={[0.4, 0.2, 0]} />
      </group>
      <mesh geometry={haloGeometry} material={haloMaterial} />
    </group>
  );
}

/** Layer 02 — larger, broken sphere made of arcs with measurement ticks (the "scanner"). */
function OuterShell() {
  const signals = useSignals();
  const tilt = useRef<Group>(null);
  const spin = useRef<Group>(null);

  const { geometry, material } = useMemo(() => {
    const builder = new LineBuilder();
    const random = createRandom(23);
    const a = new Vector3();
    const b = new Vector3();
    const R = OUTER_RADIUS;

    // Meridian arcs of varying length; every other one carries a tick scale.
    for (let i = 0; i < 8; i++) {
      const lon = (i / 8) * TAU + (random() - 0.5) * 0.3;
      const span = (60 + random() * 80) * DEG;
      const lat0 = Math.max(-1.3, Math.min(1.3 - span, (random() - 0.5) * 1.2 - span / 2));
      const level = 0.55 + random() * 0.35;
      builder.curve(48, (t, out) => spherePoint(R, lat0 + span * t, lon, out), fadeEnds(0.2, level));
      if (i % 2 === 0) {
        const steps = Math.floor(span / (5 * DEG));
        for (let k = 1; k < steps; k++) {
          const lat = lat0 + k * 5 * DEG;
          const fade = Math.min(1, k / 2, (steps - k) / 2);
          const length = k % 3 === 0 ? 0.075 : 0.04;
          builder.segment(spherePoint(R, lat, lon, a), spherePoint(R + length, lat, lon, b), level * fade, level * fade * 0.5);
        }
      }
    }

    // Partial parallels: [latitude, start, span] in degrees.
    const parallels: [number, number, number][] = [
      [0, 10, 200],
      [28, 140, 120],
      [-27, 250, 110],
      [52, 300, 70],
    ];
    for (const [lat, start, span] of parallels) {
      builder.curve(
        72,
        (t, out) => spherePoint(R, lat * DEG, (start + span * t) * DEG, out),
        fadeEnds(0.15, lat === 0 ? 0.95 : 0.6),
      );
    }

    // A fragmented great circle on its own inclination: dashes with gaps.
    const inclination = new Euler(62 * DEG, 0, 18 * DEG);
    for (let k = 0; k < 18; k++) {
      const start = k * 20 * DEG;
      const level = k % 4 === 0 ? 0.95 : 0.45;
      builder.curve(
        10,
        (t, out) => {
          const angle = start + t * 12 * DEG;
          out.set(Math.cos(angle) * R, 0, Math.sin(angle) * R).applyEuler(inclination);
        },
        () => level,
      );
    }

    return {
      geometry: builder.toGeometry(),
      material: createHoloLineMaterial({ color: colors.holo, opacity: 0.42, backFade: 0.65 }),
    };
  }, []);

  useDisposables(geometry, material);

  useFrame(() => {
    const t = signals.time;
    if (spin.current) spin.current.rotation.y = -t * 0.045;
    if (tilt.current) {
      tilt.current.rotation.x = 0.32 + Math.sin(t * 0.07) * 0.06;
      tilt.current.rotation.z = 0.26 + Math.sin(t * 0.05 + 1.2) * 0.05;
    }
    material.uniforms.uOpacity.value = 0.4 + signals.active * 0.04 + signals.level * 0.18;
  });

  return (
    <group ref={tilt}>
      <group ref={spin}>
        <lineSegments geometry={geometry} material={material} />
      </group>
    </group>
  );
}
