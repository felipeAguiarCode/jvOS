import { AdditiveBlending, ShaderMaterial } from "three";
import { colors } from "../../lib/sceneColors";
import { sharedUniforms } from "../hologram/sharedUniforms";
import { backdropVertexShader, createScreenUniforms } from "./backdrop";

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uVoice;
  uniform vec2 uCenter;
  uniform float uScale;
  uniform vec3 uColor;
  uniform vec3 uScanColor;

  // A virtual eye at the origin looks down -z from inside a unit sphere centred BACK behind it.
  const float FOCAL = 0.7;
  const float BACK = 0.45;
  /** Grid cell on the sphere surface. */
  const float SPACING = 0.11;
  const float SCAN_PERIOD = 9.0;

  /** Anti-aliased lines on integer coordinates, about "width" pixels wide. */
  float gridLines(vec2 g, float width) {
    vec2 d = abs(fract(g - 0.5) - 0.5) / (fwidth(g) * width);
    return 1.0 - min(min(d.x, d.y), 1.0);
  }

  void main() {
    // Composition diameters from the core.
    vec2 p = (gl_FragCoord.xy - uCenter) / uScale;
    vec3 dir = normalize(vec3(p * FOCAL, -1.0));
    float b = -BACK * dir.z;
    float t = b + sqrt(b * b + 1.0 - BACK * BACK);
    // Hit point relative to the sphere centre.
    vec3 hit = dir * t + vec3(0.0, 0.0, BACK);

    // Plane sections x = k and y = k: small cells at the back, lines curving toward the edges.
    vec2 g = hit.xy / SPACING;
    float major = gridLines(g, 1.0);
    float minor = gridLines(g * 2.0, 0.8) * (1.0 - smoothstep(0.12, 0.3, max(fwidth(g.x), fwidth(g.y)) * 2.0));

    // The nearer surface (the edges) is brighter; behind the hologram the grid stays faint.
    float near = smoothstep(1.5, 0.75, t);
    float core = smoothstep(0.22, 0.8, length(p));

    // A slow scan ring sweeps from the back of the dome toward the viewer.
    float angle = acos(clamp(-hit.z, -1.0, 1.0));
    float phase = mod(uTime, SCAN_PERIOD) / SCAN_PERIOD * 2.6;
    float scan = exp(-pow((angle - phase) / 0.07, 2.0));

    float level = (major * 0.75 + minor * 0.22) * mix(0.25, 1.0, near) * mix(0.3, 1.0, core);
    vec3 color = uColor * level * (0.34 + scan * 0.45) * (1.0 + uVoice * 0.6)
               + uScanColor * scan * major * 0.05 * core;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** "Grid côncavo": the inside of a holographic dome around the hologram. */
export function createDomeGridMaterial() {
  return new ShaderMaterial({
    uniforms: {
      ...createScreenUniforms(),
      uTime: sharedUniforms.uTime,
      uVoice: sharedUniforms.uVoice,
      uColor: { value: colors.line },
      uScanColor: { value: colors.holo },
    },
    vertexShader: backdropVertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
