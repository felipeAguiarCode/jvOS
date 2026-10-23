import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import type { BloomEffect } from "postprocessing";
import { Fog, Group, MathUtils, PerspectiveCamera } from "three";
import { COMPOSITION_DIAMETER, compositionPixels, DOCK_RESERVE } from "../lib/layout";
import type { QualityPreset } from "../lib/quality";
import type { Background } from "../lib/settings";
import { SignalsContext, useSignals, type HoloSignals } from "../lib/signals";
import { colors } from "../lib/sceneColors";
import { sharedUniforms } from "../shaders/hologram/sharedUniforms";
import { AudioDriver } from "./AudioDriver";
import { JarvisCore } from "./JarvisCore";
import { SceneBackground } from "./SceneBackground";

/** Composition diameter (px) at which point sprites use their nominal size (1080p). */
const REFERENCE_PIXELS = 480;
const FOV = 32;
/** Startup (hidden window, shader compilation) is not representative of the frame rate. */
const MONITOR_DELAY_MS = 5000;
/** Maximum parallax tilt from the mouse, radians. */
const PARALLAX_X = 0.05;
const PARALLAX_Y = 0.07;
/** Powering on after the boot screen: grows from a point, spinning into place. */
const IGNITION_MS = 1500;

/**
 * "standby": switched off (the boot screen covers it); a number: powering on since that
 * `performance.now()`; null: simply on.
 */
export type Ignition = "standby" | number | null;

interface JarvisSceneProps {
  quality: QualityPreset;
  background: Background;
  ignition?: Ignition;
  signals: HoloSignals;
  sample: (delta: number) => void;
  paused: boolean;
  onFirstFrame: () => void;
  onQualityFallback: () => void;
}

export function JarvisScene({
  quality,
  background,
  ignition = null,
  signals,
  sample,
  paused,
  onFirstFrame,
  onQualityFallback,
}: JarvisSceneProps) {
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, quality.maxDpr));
  const [monitoring, setMonitoring] = useState(false);

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, quality.maxDpr));
  }, [quality.maxDpr]);

  // Measure performance only once things settle, and restart the measurement after a pause.
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => setMonitoring(true), MONITOR_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setMonitoring(false);
    };
  }, [paused]);

  return (
    <Canvas
      data-desktop-surface
      className="!fixed inset-0"
      dpr={dpr}
      frameloop={paused ? "never" : "always"}
      gl={{ antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" }}
      camera={{ fov: FOV, near: 0.1, far: 200, position: [0, 0, 24] }}
    >
      <SignalsContext.Provider value={signals}>
        {/* The shared theme color itself, so a theme switch also changes the background. */}
        <primitive attach="background" object={colors.void} />
        {/* Black fog + additive blending = the far side of the hologram dims (depth cue). */}
        <fog attach="fog" args={["#000000", 22, 30]} />
        <AudioDriver sample={sample} onFirstFrame={onFirstFrame} />
        {/* Outside the composition: no parallax. */}
        <SceneBackground kind={background} />
        <Composition ignition={ignition}>
          <JarvisCore quality={quality} />
        </Composition>
        {monitoring && (
          <PerformanceMonitor
            flipflops={3}
            // Back up to the screen's own density, never past it: supersampling on a 1x screen
            // costs hundreds of MB of (shared) video memory and frames for little gain.
            onIncline={() => setDpr((value) => Math.min(quality.maxDpr, window.devicePixelRatio || 1, value + 0.25))}
            onDecline={() => setDpr((value) => Math.max(1, value - 0.25))}
            onFallback={onQualityFallback}
          />
        )}
        <Effects quality={quality} dpr={dpr} />
      </SignalsContext.Provider>
    </Canvas>
  );
}

/** 0 → 1 with a small overshoot, like a ring settling. */
function easeOutBack(t: number) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/**
 * Fits the hologram to the viewport (camera distance, vertical offset above the dock,
 * fog range, point sprite scale) and applies the subtle mouse parallax and the power-on.
 */
function Composition({ children, ignition }: { children: ReactNode; ignition: Ignition }) {
  const group = useRef<Group>(null);
  const power = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  useLayoutEffect(() => {
    const pixels = compositionPixels(size.width, size.height);
    const unitsPerPixel = COMPOSITION_DIAMETER / pixels;
    const distance = (size.height * unitsPerPixel) / (2 * Math.tan(MathUtils.degToRad(FOV / 2)));

    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    // Shift the frustum so the core is centred in the area above the dock while
    // the camera keeps looking straight at it (symmetric perspective).
    camera.setViewOffset(size.width, size.height, 0, DOCK_RESERVE / 2, size.width, size.height);
    camera.updateProjectionMatrix();

    if (scene.fog instanceof Fog) {
      scene.fog.near = distance - 1.3;
      scene.fog.far = distance + 4.6;
    }
    sharedUniforms.uCameraDistance.value = distance;
    sharedUniforms.uPointScale.value = dpr * (pixels / REFERENCE_PIXELS);
  }, [camera, scene, size.width, size.height, dpr]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    const onLeave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useFrame((_, delta) => {
    const target = group.current;
    if (!target) return;
    const dt = Math.min(delta, 0.05);
    target.rotation.y = MathUtils.damp(target.rotation.y, pointer.current.x * PARALLAX_Y, 2, dt);
    target.rotation.x = MathUtils.damp(target.rotation.x, pointer.current.y * PARALLAX_X, 2, dt);

    const planet = power.current;
    if (!planet) return;
    planet.visible = ignition !== "standby";
    const progress = typeof ignition === "number" ? Math.min(1, (performance.now() - ignition) / IGNITION_MS) : 1;
    planet.scale.setScalar(Math.max(0.001, easeOutBack(progress)));
    planet.rotation.y = -((1 - progress) ** 3) * Math.PI * 1.5;
  });

  return (
    <group ref={group}>
      <group ref={power}>{children}</group>
    </group>
  );
}

/** Bloom only catches HDR values (> 1): hot points and peaks — lines stay crisp. */
function Effects({ quality, dpr }: { quality: QualityPreset; dpr: number }) {
  const signals = useSignals();
  const bloom = useRef<BloomEffect>(null);
  // High DPR multiplies the cost of every MSAA sample.
  const msaa = dpr > 1.25 ? Math.min(2, quality.msaa) : quality.msaa;

  useFrame(() => {
    if (bloom.current) {
      bloom.current.intensity = 0.9 + signals.level * 0.4 + signals.bass * 0.2 + signals.voice * 0.5 + signals.pulse * 0.5;
    }
  });

  return (
    <EffectComposer key={msaa} multisampling={msaa} enableNormalPass={false}>
      <Bloom
        ref={bloom}
        mipmapBlur
        luminanceThreshold={0.95}
        luminanceSmoothing={0.08}
        intensity={0.9}
        radius={0.62}
        levels={quality.bloomLevels}
      />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>
  );
}
