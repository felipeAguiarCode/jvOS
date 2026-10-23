import { AdditiveBlending, ShaderMaterial } from "three";
import { colors } from "../../lib/sceneColors";
import { sharedUniforms } from "./sharedUniforms";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uAudio;
  uniform float uVoice;
  uniform float uExtent;
  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform vec3 uAbyss;

  varying vec2 vUv;

  void main() {
    // Distance from the centre in core radii.
    float r = length(vUv - 0.5) * 2.0 * uExtent;
    float breath = 1.0 + 0.09 * sin(uTime * 1.2) + 0.04 * sin(uTime * 0.53 + 1.7);

    float limb = exp(-pow((r - 1.035) / 0.05, 2.0)) * 0.11;
    // While someone speaks the veil widens into an aura around the core.
    float veil = exp(-pow((r - 1.2) / (0.45 + uVoice * 0.3), 2.0)) * 0.022;
    float kernel = exp(-r * r / 0.0025) * 0.9 + exp(-r * r / 0.03) * 0.06;

    // Very wide, very faint lift of the secondary background tone behind the core.
    float depth = exp(-r * r / 6.0) * smoothstep(1.0, 0.92, r / uExtent);

    float level = uAudio.x;
    float bass = uAudio.y;
    vec3 color = uColor * (limb + veil) * breath * (1.0 + level * 1.4 + uVoice * 1.8)
               + uHotColor * kernel * (0.8 + 0.2 * breath + bass * 1.2 + uVoice * 0.8)
               + uAbyss * depth;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Camera-facing radial glow: thin limb around the core, faint veil, tiny kernel and background lift. */
export function createHaloMaterial(extent: number) {
  return new ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uAudio: sharedUniforms.uAudio,
      uVoice: sharedUniforms.uVoice,
      uExtent: { value: extent },
      uColor: { value: colors.holo },
      uHotColor: { value: colors.glow },
      uAbyss: { value: colors.abyss },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
