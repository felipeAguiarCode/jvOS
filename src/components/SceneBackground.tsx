import { useLayoutEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { PlaneGeometry, type ShaderMaterial } from "three";
import { useDisposables } from "../hooks/useDisposables";
import { compositionPixels, DOCK_RESERVE } from "../lib/layout";
import type { Background } from "../lib/settings";
import { createGlyphAtlas } from "../shaders/background/glyphAtlas";
import { createDomeGridMaterial } from "../shaders/background/gridMaterial";
import { createMatrixMaterial } from "../shaders/background/matrixMaterial";

/**
 * Full-screen backdrop drawn before the hologram, which adds on top of it. "solid" is just
 * the scene's background color.
 */
export function SceneBackground({ kind }: { kind: Background }) {
  if (kind === "grid") return <DomeGrid />;
  if (kind === "matrix") return <MatrixRain />;
  return null;
}

function DomeGrid() {
  const { geometry, material } = useMemo(() => ({ geometry: new PlaneGeometry(2, 2), material: createDomeGridMaterial() }), []);
  useDisposables(geometry, material);
  return <Backdrop geometry={geometry} material={material} />;
}

function MatrixRain() {
  const { geometry, atlas, material } = useMemo(() => {
    const atlas = createGlyphAtlas();
    return { geometry: new PlaneGeometry(2, 2), atlas, material: createMatrixMaterial(atlas) };
  }, []);
  useDisposables(geometry, atlas, material);
  return <Backdrop geometry={geometry} material={material} />;
}

/** Keeps the screen-space uniforms in step with the canvas: centred on the core, scaled with it. */
function Backdrop({ geometry, material }: { geometry: PlaneGeometry; material: ShaderMaterial }) {
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  useLayoutEffect(() => {
    const u = material.uniforms;
    u.uResolution.value.set(size.width * dpr, size.height * dpr);
    // gl_FragCoord grows upward; the core is centred in the area above the dock.
    u.uCenter.value.set((size.width / 2) * dpr, ((size.height + DOCK_RESERVE) / 2) * dpr);
    u.uScale.value = compositionPixels(size.width, size.height) * dpr;
    u.uPixelRatio.value = dpr;
  }, [material, size.width, size.height, dpr]);

  return <mesh geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} />;
}
