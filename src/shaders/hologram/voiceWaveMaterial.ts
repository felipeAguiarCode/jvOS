import { AdditiveBlending, ShaderMaterial } from "three";
import { SPECTRUM_BANDS } from "../../lib/signals";
import { colors } from "../../lib/sceneColors";
import { sharedUniforms } from "./sharedUniforms";

const LAST_BAND = SPECTRUM_BANDS - 1;

const vertexShader = /* glsl */ `
  #include <common>

  attribute float aAlpha;
  /** Maximum outward displacement of the vertex at full voice. */
  attribute float aLift;
  /** Per-ring variation of the idle wobble. */
  attribute float aSeed;

  uniform float uTime;
  uniform float uVoice;
  uniform float uSpectrum[${SPECTRUM_BANDS}];

  varying float vAlpha;

  float spectrumAt(float x) {
    float f = clamp(x, 0.0, 1.0) * ${LAST_BAND}.0;
    int i = int(f);
    return mix(uSpectrum[i], uSpectrum[min(i + 1, ${LAST_BAND})], fract(f));
  }

  void main() {
    vec3 p = position;
    float r = length(p.xy);
    vec2 dir = p.xy / r;

    // Mirrored left/right: low frequencies at the top, high ones at the bottom.
    float energy = spectrumAt(acos(clamp(dir.y, -1.0, 1.0)) / PI);
    float wobble = 0.5 + 0.5 * sin(atan(dir.y, dir.x) * (4.0 + aSeed) + uTime * (2.2 + aSeed * 0.7) + aSeed * 2.1);
    p.xy = dir * (r + aLift * uVoice * (energy * 0.85 + wobble * 0.15));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vAlpha = aAlpha * uVoice * (0.55 + energy * 0.9);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHotColor;

  varying float vAlpha;

  void main() {
    // Loud peaks drift toward the near-white glow color (and above 1.0 → bloom).
    vec3 color = mix(uColor, uHotColor, clamp(vAlpha - 0.7, 0.0, 1.0)) * vAlpha;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Camera-facing waveform rings and spectrum bars, displaced by the voice in the vertex shader. */
export function createVoiceWaveMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uVoice: sharedUniforms.uVoice,
      uSpectrum: sharedUniforms.uSpectrum,
      uColor: { value: colors.holo },
      uHotColor: { value: colors.glow },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
