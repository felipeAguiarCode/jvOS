import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { BloomEffect } from "postprocessing";
import { Fog, Group, MathUtils, PerspectiveCamera } from "three";
import { frameRate, runFrames } from "../lib/frameClock";
import { COMPOSITION_DIAMETER, compositionPixels, DOCK_RESERVE } from "../lib/layout";
import type { QualityPreset } from "../lib/quality";
import { SignalsContext, useSignals, type HoloSignals } from "../lib/signals";
import { colors } from "../lib/sceneColors";
import { sharedUniforms } from "../shaders/hologram/sharedUniforms";
import { AudioDriver } from "./AudioDriver";
import { JarvisCore } from "./JarvisCore";

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
 * The canvas covers only the hologram: a square of this many composition diameters around the
 * core. Measured at 1080p with every signal at its peak, the lit pixels (halo, particles and
 * bloom) span ~744×667 px, ~1.44 diameters; the power-on overshoots 7% and the parallax tilts a
 * little, hence the margin. ~830 px square instead of 1920×1080: a third of the pixels to shade,
 * multisample and bloom.
 */
const CANVAS_SPAN = 1.6;
/** Canvas edges on multiples of 4 CSS px, so they land on whole device pixels at 1.25× and 1.5×. */
const CANVAS_SNAP = 4;

/**
 * postprocessing's Vignette (offset 0.3, darkness 0.55: the colour times a smoothstep of the
 * distance from the screen centre in UV space) as a static full-screen CSS overlay. Black at
 * alpha 1 − factor multiplies exactly like the shader; drawn once instead of every frame, and
 * it no longer depends on the canvas covering the screen. A gradient stop at p% of an
 * "ellipse 50% 50%" sits at UV distance p/200.
 */
const VIGNETTE = (() => {
  const offset = 0.3;
  const darkness = 0.55;
  const from = 0.8;
  const to = offset * 0.799;
  const factor = (distance: number) => {
    const t = Math.min(1, Math.max(0, (distance * (darkness + offset) - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };
  const start = to / (darkness + offset);
  const corner = Math.SQRT1_2;
  const stops = Array.from({ length: 11 }, (_, i) => {
    const distance = start + ((corner - start) * i) / 10;
    return `rgb(0 0 0 / ${(1 - factor(distance)).toFixed(3)}) ${(distance * 200).toFixed(2)}%`;
  });
  return `radial-gradient(ellipse 50% 50% at 50% 50%, ${stops.join(", ")})`;
})();

interface Viewport {
  width: number;
  height: number;
}

interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the canvas sits on the screen: a square around the core, clipped to the viewport. */
function canvasRect({ width, height }: Viewport): CanvasRect {
  const half = (compositionPixels(width, height) * CANVAS_SPAN) / 2;
  const centerX = width / 2;
  const centerY = (height - DOCK_RESERVE) / 2;
  const snapDown = (value: number) => Math.floor(value / CANVAS_SNAP) * CANVAS_SNAP;
  const snapUp = (value: number) => Math.ceil(value / CANVAS_SNAP) * CANVAS_SNAP;
  const left = Math.max(0, snapDown(centerX - half));
  const top = Math.max(0, snapDown(centerY - half));
  const right = Math.min(width, snapUp(centerX + half));
  const bottom = Math.min(height, snapUp(centerY + half));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function useViewport(): Viewport {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

/**
 * "standby": switched off (the boot screen covers it); a number: powering on since that
 * `performance.now()`; null: simply on.
 */
export type Ignition = "standby" | number | null;

interface JarvisSceneProps {
  quality: QualityPreset;
  ignition?: Ignition;
  signals: HoloSignals;
  sample: (delta: number) => void;
  paused: boolean;
  /** False while another app has the focus: the hologram keeps moving at a lower frame rate. */
  focused: boolean;
  onFirstFrame: () => void;
  onQualityFallback: () => void;
}

export function JarvisScene({
  quality,
  ignition = null,
  signals,
  sample,
  paused,
  focused,
  onFirstFrame,
  onQualityFallback,
}: JarvisSceneProps) {
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, quality.maxDpr));
  const [monitoring, setMonitoring] = useState(false);
  const viewport = useViewport();
  const rect = canvasRect(viewport);
  const fps = frameRate(paused, focused);

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, quality.maxDpr));
  }, [quality.maxDpr]);

  // Measure performance only once things settle, at the full frame rate (in front), and restart
  // the measurement after a pause.
  useEffect(() => {
    if (paused || !focused) return;
    const timer = window.setTimeout(() => setMonitoring(true), MONITOR_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setMonitoring(false);
    };
  }, [paused, focused]);

  return (
    <div data-desktop-surface data-core="3d" className="fixed inset-0">
      <Canvas
        style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        dpr={dpr}
        // Frames come from the capped clock below, never from r3f's own uncapped loop.
        frameloop="never"
        // "default" keeps a dual-GPU laptop on the integrated GPU: the hologram does not wake the
        // discrete one (left to speech recognition), nor drain the battery with it.
        gl={{ antialias: false, alpha: false, stencil: false, powerPreference: "default" }}
        // The camera frames the whole viewport and the canvas shows its crop (see Composition).
        camera={{ fov: FOV, near: 0.1, far: 200, position: [0, 0, 24], manual: true }}
      >
        <SignalsContext.Provider value={signals}>
          <FrameDriver fps={fps} />
          {/* The shared theme color itself, so a theme switch also changes the background. */}
          <primitive attach="background" object={colors.void} />
          {/* Black fog + additive blending = the far side of the hologram dims (depth cue). */}
          <fog attach="fog" args={["#000000", 22, 30]} />
          <AudioDriver sample={sample} onFirstFrame={onFirstFrame} />
          <Composition ignition={ignition} viewport={viewport} rect={rect}>
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
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: VIGNETTE }} />
    </div>
  );
}

/** Renders the scene from the capped frame clock (r3f runs with frameloop "never"). */
function FrameDriver({ fps }: { fps: number }) {
  const advance = useThree((state) => state.advance);
  useEffect(() => runFrames(fps, (now) => advance(now / 1000)), [fps, advance]);
  return null;
}

/**
 * Watches the frame rate and asks for a lower density (or quality) when the GPU can't keep up:
 * drei's PerformanceMonitor logic without the drei package. Every second (4 windows of 250 ms ×
 * 10), when more than 75% of the windows ran at the top of the refresh rate the density goes up,
 * below 2/3 of it it goes down; after `flipflops` changes it gives up (`onFallback`).
 */
function PerformanceMonitor({
  flipflops,
  onIncline,
  onDecline,
  onFallback,
}: {
  flipflops: number;
  onIncline: () => void;
  onDecline: () => void;
  onFallback: () => void;
}) {
  const WINDOW_MS = 250;
  const WINDOWS = 10;
  const THRESHOLD = 0.75;
  const state = useRef({ frames: [] as number[], averages: [] as number[], refresh: 0, flipped: 0, done: false });
  const callbacks = useRef({ onIncline, onDecline, onFallback });
  callbacks.current = { onIncline, onDecline, onFallback };

  useFrame(() => {
    const api = state.current;
    if (api.done) return;
    api.frames.push(performance.now());
    const elapsed = api.frames[api.frames.length - 1] - api.frames[0];
    if (elapsed < WINDOW_MS) return;
    const fps = Math.round((api.frames.length / elapsed) * 1000);
    api.frames = [];
    api.refresh = Math.max(api.refresh, fps);
    api.averages.push(fps);
    if (api.averages.length < WINDOWS) return;
    const [lower, upper] = api.refresh > 100 ? [60, 100] : [40, 60];
    if (api.averages.filter((value) => value >= upper).length > WINDOWS * THRESHOLD) {
      api.flipped++;
      callbacks.current.onIncline();
    }
    if (api.averages.filter((value) => value < lower).length > WINDOWS * THRESHOLD) {
      api.flipped++;
      callbacks.current.onDecline();
    }
    api.averages = [];
    if (api.flipped > flipflops) {
      api.done = true;
      callbacks.current.onFallback();
    }
  });
  return null;
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
 * The camera frames the whole viewport; the canvas renders only its `rect` (setViewOffset),
 * so the picture is pixel for pixel the one a full-screen canvas would show there.
 */
function Composition({ children, ignition, viewport, rect }: { children: ReactNode; ignition: Ignition; viewport: Viewport; rect: CanvasRect }) {
  const group = useRef<Group>(null);
  const power = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const scene = useThree((state) => state.scene);
  const dpr = useThree((state) => state.viewport.dpr);
  const { width, height } = viewport;

  useLayoutEffect(() => {
    const pixels = compositionPixels(width, height);
    const unitsPerPixel = COMPOSITION_DIAMETER / pixels;
    const distance = (height * unitsPerPixel) / (2 * Math.tan(MathUtils.degToRad(FOV / 2)));

    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    // The camera is "manual" (r3f leaves it alone): its aspect is the whole viewport's.
    camera.aspect = width / height;
    // Shift the frustum so the core is centred in the area above the dock while the camera
    // keeps looking straight at it (symmetric perspective), and keep only the canvas's crop.
    camera.setViewOffset(width, height, rect.left, rect.top + DOCK_RESERVE / 2, rect.width, rect.height);
    camera.updateProjectionMatrix();

    if (scene.fog instanceof Fog) {
      scene.fog.near = distance - 1.3;
      scene.fog.far = distance + 4.6;
    }
    sharedUniforms.uCameraDistance.value = distance;
    sharedUniforms.uPointScale.value = dpr * (pixels / REFERENCE_PIXELS);
  }, [camera, scene, width, height, rect.left, rect.top, rect.width, rect.height, dpr]);

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
    </EffectComposer>
  );
}
