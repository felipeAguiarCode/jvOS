import { AdditiveBlending, Color, ShaderMaterial, UniformsLib, UniformsUtils } from "three";
import { sharedUniforms } from "./sharedUniforms";

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>

  attribute float aAlpha;

  uniform float uTime;
  uniform vec4 uAudio;
  uniform float uDisplace;
  uniform float uBackFade;

  varying float vAlpha;
  varying float vHeight;

  void main() {
    vec3 p = position;

    // Very small surface ripple; bass pushes it a little further.
    if (uDisplace > 0.0) {
      float ripple = sin(p.y * 6.0 + uTime * 1.3) * sin(p.x * 4.5 - uTime * 0.8) * sin(p.z * 5.5 + uTime * 1.1);
      p += normalize(p) * ripple * uDisplace * (0.4 + uAudio.y * 2.2);
    }

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Every layer is centred on the core: the side facing away from the camera is dimmed.
    vec3 center = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float facing = normalize(mvPosition.xyz - center).z;
    float back = mix(1.0 - uBackFade, 1.0, smoothstep(-0.75, 0.45, facing));

    vAlpha = aAlpha * back;
    vHeight = position.y;

    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uScanStrength;
  uniform float uScanHeight;
  uniform float uVoice;

  varying float vAlpha;
  varying float vHeight;

  void main() {
    float scan = uScanStrength * exp(-pow((vHeight - uScanHeight) / 0.07, 2.0));
    // Speech brightens every line of the hologram.
    vec3 color = uColor * vAlpha * uOpacity * (1.0 + scan) * (1.0 + uVoice * 0.6);

    gl_FragColor = vec4(color, 1.0);

    #include <colorspace_fragment>
    // Black fog under additive blending = depth fade: the far side of the hologram dims.
    #include <fog_fragment>
  }
`;

export interface HoloLineOptions {
  /** Held by reference: one of the theme `colors`, so a theme switch recolours the line. */
  color: Color;
  opacity?: number;
  /** Amplitude of the vertex ripple (0 disables it). */
  displace?: number;
  /** How much the far side (relative to the core centre) is dimmed, 0..1. */
  backFade?: number;
}

export type HoloLineMaterial = ShaderMaterial & {
  uniforms: {
    uColor: { value: Color };
    uOpacity: { value: number };
    uScanStrength: { value: number };
    uScanHeight: { value: number };
  };
};

/** Thin (1px) hologram line material for `LineSegments`, intensity per vertex via `aAlpha`. */
export function createHoloLineMaterial({ color, opacity = 1, displace = 0, backFade = 0.6 }: HoloLineOptions) {
  return new ShaderMaterial({
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uAudio: sharedUniforms.uAudio,
      uVoice: sharedUniforms.uVoice,
      uColor: { value: color },
      uOpacity: { value: opacity },
      uDisplace: { value: displace },
      uBackFade: { value: backFade },
      uScanStrength: { value: 0 },
      uScanHeight: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  }) as HoloLineMaterial;
}
