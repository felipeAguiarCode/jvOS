import { Vector2 } from "three";

/** Clip-space quad: covers the whole canvas whatever the camera (and its view offset). */
export const backdropVertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Screen-space uniforms, in device pixels (gl_FragCoord space), kept in step by `SceneBackground`. */
export function createScreenUniforms() {
  return {
    uResolution: { value: new Vector2(1, 1) },
    /** Centre of the core (it sits in the middle of the area above the dock). */
    uCenter: { value: new Vector2() },
    /** Diameter of the composition, so the backdrop scales with the hologram. */
    uScale: { value: 1 },
    uPixelRatio: { value: 1 },
  };
}
