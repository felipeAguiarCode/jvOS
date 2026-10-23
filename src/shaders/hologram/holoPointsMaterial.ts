import { AdditiveBlending, Color, ShaderMaterial, UniformsLib, UniformsUtils, Vector4 } from "three";
import { EQUATOR_NORMAL, EQUATOR_U, LANES } from "../../lib/rings";
import { colors } from "../../lib/sceneColors";
import { sharedUniforms } from "./sharedUniforms";

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>

  attribute vec3 aAxis;
  attribute vec4 aParams; // speed, phase, size, brightness

  uniform float uTime;
  uniform vec4 uAudio;
  uniform float uPointScale;
  uniform float uCameraDistance;
  uniform float uTwinkle;
  uniform float uBackFade;
  uniform float uVoice;

  #ifdef WANDER
    /** 0..1: how far the particles have moved onto the equator (listening). */
    uniform float uAlign;
    /** Scene time when the alignment began: the aligned orbits start from the positions at that instant. */
    uniform float uAlignStart;
    uniform vec3 uEquator;
    uniform vec3 uEquatorU;
    /** Radii of the orbital rings, the lanes on the equator. */
    uniform vec4 uLanes;
  #endif

  varying float vBrightness;

  // Rodrigues rotation of p around unit axis k.
  vec3 rotateAround(vec3 p, vec3 k, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c);
  }

  #ifdef WANDER
    // Per-particle random number in [0, 1): the phase is random, the salt picks a stream.
    float seeded(float phase, float salt) {
      return fract(sin(phase * 12.9898 + salt * 78.233) * 43758.5453);
    }

    // Free flight, a pure function of time: translation with surges along the orbit, the orbit
    // plane nodding back and forth (rotation), breathing radius, bobbing and a small loop.
    vec3 wanderPos(float t, vec3 axis, float speed, float phase) {
      float r1 = seeded(phase, 1.0);
      float r2 = seeded(phase, 2.0);
      float r3 = seeded(phase, 3.0);
      float r4 = seeded(phase, 4.0);

      // The speed itself never changes (that would scrub the phase): the surge is added to the angle.
      float angle = t * speed + 0.35 * sin(t * (0.21 + 0.25 * r1) + phase * 3.0);
      vec3 p = rotateAround(position, axis, angle);

      vec3 helper = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 nodAxis = rotateAround(normalize(cross(axis, helper)), axis, r2 * PI2);
      p = rotateAround(p, nodAxis, 0.25 * sin(t * (0.09 + 0.12 * r3) + phase));

      vec3 radial = normalize(p);
      vec3 tangent = cross(axis, p);
      tangent /= max(length(tangent), 1e-4);
      p *= 1.0 + 0.06 * sin(t * (0.35 + 0.4 * r4) + phase * 5.0);
      p += axis * 0.05 * sin(t * (0.5 + 0.6 * r1) + phase * 2.0);
      float loop = t * (1.1 + 1.4 * r2) + phase * 4.0;
      p += (tangent * cos(loop) + radial * sin(loop)) * 0.045;
      return p;
    }

    float nearestLane(float radius) {
      float lane = uLanes.x;
      if (abs(radius - uLanes.y) < abs(radius - lane)) lane = uLanes.y;
      if (abs(radius - uLanes.z) < abs(radius - lane)) lane = uLanes.z;
      if (abs(radius - uLanes.w) < abs(radius - lane)) lane = uLanes.w;
      return lane;
    }

    // Aligned: a thin disk on the equator, mostly on the ring lanes, every particle turning the
    // same way (inner ones faster). It starts where each particle was projected onto the plane.
    vec3 alignedPos(float t, vec3 axis, float speed, float phase) {
      vec3 start = wanderPos(uAlignStart, axis, speed, phase);
      vec3 planar = start - uEquator * dot(start, uEquator);
      float planarLength = length(planar);
      vec3 direction = planarLength > 1e-3 ? planar / planarLength : uEquatorU;

      float rest = length(position);
      float radius = mix(rest, nearestLane(rest), 0.8) + (seeded(phase, 5.0) - 0.5) * 0.1;
      float omega = 0.32 * pow(uLanes.x / radius, 1.5);
      vec3 p = rotateAround(direction, uEquator, (t - uAlignStart) * omega) * radius;
      return p + uEquator * 0.02 * sin(t * (0.8 + seeded(phase, 6.0)) + phase * 3.0);
    }

    // Spherical interpolation of unit vectors: the path goes around the core, never through it.
    vec3 slerpDirection(vec3 a, vec3 b, float t) {
      float cosine = clamp(dot(a, b), -1.0, 1.0);
      vec3 across = b - a * cosine;
      float acrossLength = length(across);
      if (acrossLength < 1e-4) return t < 0.5 ? a : b;
      float angle = acos(cosine) * t;
      return a * cos(angle) + (across / acrossLength) * sin(angle);
    }
  #endif

  void main() {
    float speed = aParams.x;
    float phase = aParams.y;
    float size = aParams.z;
    float brightness = aParams.w;

    vec3 p = position;
    #ifdef WANDER
      vec3 axis = normalize(aAxis);
      p = wanderPos(uTime, axis, speed, phase);
      // A wave from the inside out: inner particles reach the equator first.
      float order = clamp((length(position) - 1.15) / 1.5, 0.0, 1.0);
      float start = 0.4 * order + 0.15 * seeded(phase, 7.0);
      float aligned = smoothstep(start, start + 0.45, uAlign);
      if (aligned > 0.0) {
        vec3 target = alignedPos(uTime, axis, speed, phase);
        float from = length(p);
        float to = length(target);
        p = slerpDirection(p / from, target / to, aligned) * mix(from, to, aligned);
      }
      brightness *= 1.0 + 0.35 * aligned;
    #else
      if (speed != 0.0) {
        p = rotateAround(p, normalize(aAxis), uTime * speed);
        p *= 1.0 + 0.018 * sin(uTime * 0.7 + phase * 3.0);
      }
    #endif

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vec3 center = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float facing = normalize(mvPosition.xyz - center).z;
    float back = mix(1.0 - uBackFade, 1.0, smoothstep(-0.75, 0.45, facing));

    float twinkle = mix(1.0, 0.55 + 0.45 * sin(uTime * (0.9 + fract(phase * 7.31) * 1.8) + phase * 6.2831), uTwinkle);
    float treble = uAudio.w;
    vBrightness = brightness * twinkle * back * (1.0 + treble * 1.6) * (1.0 + uVoice * 0.7);

    gl_PointSize = size * (1.0 + treble * 0.45) * uPointScale * (uCameraDistance / -mvPosition.z);

    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform float uIntensity;

  varying float vBrightness;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = pow(1.0 - d, 2.2);

    // Brightest points drift toward the near-white glow color (and above 1.0 → bloom).
    float b = vBrightness * uIntensity;
    vec3 tint = mix(uColor, uHotColor, clamp(b - 0.8, 0.0, 1.0));
    gl_FragColor = vec4(tint * core * b, 1.0);

    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface HoloPointsOptions {
  color?: Color;
  intensity?: number;
  /** 0 = steady, 1 = full twinkle. */
  twinkle?: number;
  /** Free-flying orbits that align on the core's equator with `uAlign` (the particle layer). */
  wander?: boolean;
}

export type HoloPointsMaterial = ShaderMaterial & {
  uniforms: { uIntensity: { value: number }; uTwinkle: { value: number } };
};

/** Soft round sprites; orbiting points are animated entirely in the vertex shader. */
export function createHoloPointsMaterial({ color = colors.light, intensity = 1, twinkle = 1, wander = false }: HoloPointsOptions = {}) {
  return new ShaderMaterial({
    defines: wander ? { WANDER: "" } : {},
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uAudio: sharedUniforms.uAudio,
      uVoice: sharedUniforms.uVoice,
      uPointScale: sharedUniforms.uPointScale,
      uCameraDistance: sharedUniforms.uCameraDistance,
      uColor: { value: color },
      uHotColor: { value: colors.glow },
      uIntensity: { value: intensity },
      uTwinkle: { value: twinkle },
      uBackFade: { value: 0.55 },
      ...(wander && {
        uAlign: { value: 0 },
        uAlignStart: { value: 0 },
        uEquator: { value: EQUATOR_NORMAL },
        uEquatorU: { value: EQUATOR_U },
        uLanes: { value: new Vector4(...LANES) },
      }),
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  }) as HoloPointsMaterial;
}
