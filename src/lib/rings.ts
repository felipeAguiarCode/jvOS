import { Euler, Quaternion, Vector3 } from "three";

export interface RingSpec {
  radius: number;
  /**
   * Normal of the ring plane in view terms (+z points at the camera): |z| sets how open
   * the ellipse looks on screen, x/y set which way it leans.
   */
  normal: [number, number, number];
  /** Spin around the ring normal, rad/s (sign = direction). */
  speed: number;
  /** Width of the main stroke in CSS pixels. */
  width: number;
  /** Lit stretches [start, end, level] in turns; everything else glows at `base`. */
  spans: [number, number, number][];
  base: number;
  /** Arc (in turns) covered by the tick scale. */
  ticks: [number, number];
  /** Offset of the thin companion circle. */
  twin: number;
  /** Start positions (turns) of the bright runners. */
  runners: number[];
  runnerSpeed: number;
}

const RING_SPECS: RingSpec[] = [
  {
    radius: 1.75,
    normal: [0.18, 0.92, 0.36],
    speed: 0.17,
    width: 1.6,
    spans: [
      [0.02, 0.21, 0.95],
      [0.3, 0.335, 1.3],
      [0.52, 0.78, 0.75],
    ],
    base: 0.13,
    ticks: [0.55, 0.95],
    twin: 0.045,
    runners: [0, 0.5],
    runnerSpeed: 0.55,
  },
  {
    radius: 1.98,
    normal: [-0.82, 0.3, 0.48],
    speed: -0.11,
    width: 1.3,
    spans: [
      [0.1, 0.42, 0.85],
      [0.6, 0.63, 1.35],
      [0.7, 0.88, 0.65],
    ],
    base: 0.09,
    ticks: [0.05, 0.3],
    twin: -0.04,
    runners: [0.25],
    runnerSpeed: -0.42,
  },
  {
    radius: 2.22,
    normal: [0.45, -0.5, 0.74],
    speed: 0.08,
    width: 2,
    spans: [
      [0, 0.12, 1],
      [0.18, 0.2, 1.4],
      [0.45, 0.7, 0.72],
      [0.82, 0.9, 0.9],
    ],
    base: 0.11,
    ticks: [0.3, 0.6],
    twin: 0.05,
    runners: [0.1, 0.6],
    runnerSpeed: 0.3,
  },
  {
    radius: 2.48,
    normal: [-0.35, 0.62, 0.7],
    speed: -0.13,
    width: 1.35,
    spans: [
      [0.15, 0.48, 0.8],
      [0.62, 0.66, 1.25],
    ],
    base: 0.07,
    ticks: [0.7, 1],
    twin: -0.05,
    runners: [0.4],
    runnerSpeed: -0.5,
  },
];

/** Ring specs plus the Euler rotation taking the XZ plane onto each ring plane. */
export const RINGS = RING_SPECS.map((spec) => {
  const normal = new Vector3(...spec.normal).normalize();
  const tilt = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal));
  return { ...spec, tilt: [tilt.x, tilt.y, tilt.z] as [number, number, number] };
});

export type Ring = (typeof RINGS)[number];

/** Axial tilt of the core's grid: its equator is where particles and rings align while listening. */
export const CORE_TILT: [number, number, number] = [0.38, 0, 0.22];

/** Rotation taking the XZ plane onto the core's equator (same convention as each ring's `tilt`). */
export const EQUATOR_QUATERNION = new Quaternion().setFromEuler(new Euler(...CORE_TILT));
export const EQUATOR_NORMAL = new Vector3(0, 1, 0).applyQuaternion(EQUATOR_QUATERNION);
/** A direction lying in the equator plane. */
export const EQUATOR_U = new Vector3(1, 0, 0).applyQuaternion(EQUATOR_QUATERNION);

/** Ring radii: the lanes aligned particles settle into, on top of the aligned rings. */
export const LANES = RINGS.map((ring) => ring.radius) as [number, number, number, number];
