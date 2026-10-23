import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

/** Circles are drawn in the XY plane (facing the camera) or the XZ plane (horizontal ring). */
export type Plane = "xy" | "xz";
/** Intensity along a curve, t ∈ [0, 1]. Used as per-vertex brightness (additive blending). */
export type AlphaFn = (t: number) => number;

export const TAU = Math.PI * 2;
const constant: AlphaFn = () => 1;

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();

/** Deterministic PRNG (mulberry32) so the hologram is identical on every launch. */
export function createRandom(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planePoint(radius: number, angle: number, plane: Plane, out: Vector3) {
  const c = Math.cos(angle) * radius;
  const s = Math.sin(angle) * radius;
  return plane === "xy" ? out.set(c, s, 0) : out.set(c, 0, s);
}

/** Latitude ∈ [-π/2, π/2], longitude ∈ [0, 2π]. */
export function spherePoint(radius: number, lat: number, lon: number, out: Vector3) {
  const r = Math.cos(lat) * radius;
  return out.set(Math.cos(lon) * r, Math.sin(lat) * radius, Math.sin(lon) * r);
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Fades both ends of a curve over `edge` (fraction of its length). */
export const fadeEnds =
  (edge = 0.15, level = 1): AlphaFn =>
  (t) =>
    level * smooth(t / edge) * smooth((1 - t) / edge);

/**
 * Bright stretches over a dim base. Each span is [start, end, level] in t-space,
 * with soft shoulders so lit segments don't end abruptly.
 */
export const litSpans =
  (spans: [number, number, number][], base: number, shoulder = 0.012): AlphaFn =>
  (t) => {
    let value = base;
    for (const [start, end, level] of spans) {
      const w = smooth((t - start) / shoulder) * smooth((end - t) / shoulder);
      value = Math.max(value, base + (level - base) * w);
    }
    return value;
  };

/** Accumulates independent line segments plus a per-vertex intensity (`aAlpha`). */
export class LineBuilder {
  private positions: number[] = [];
  private alphas: number[] = [];

  segment(a: Vector3, b: Vector3, alphaA = 1, alphaB = alphaA) {
    // Fully dark segments are invisible under additive blending — skip them.
    if (alphaA < 0.004 && alphaB < 0.004) return this;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    this.alphas.push(alphaA, alphaB);
    return this;
  }

  /** Polyline sampled from `fn(t)` for t ∈ [0, 1]. */
  curve(steps: number, fn: (t: number, out: Vector3) => void, alpha: AlphaFn = constant) {
    fn(0, tmpA);
    let previous = alpha(0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      fn(t, tmpB);
      const current = alpha(t);
      this.segment(tmpA, tmpB, previous, current);
      tmpA.copy(tmpB);
      previous = current;
    }
    return this;
  }

  arc(radius: number, start: number, end: number, steps: number, plane: Plane = "xy", alpha: AlphaFn = constant) {
    return this.curve(steps, (t, out) => planePoint(radius, start + (end - start) * t, plane, out), alpha);
  }

  /** Radial ticks from r0 to r1 at `count` evenly spaced angles in [start, end). */
  ticks(
    r0: number,
    r1: number,
    count: number,
    start: number,
    end: number,
    plane: Plane = "xy",
    alpha: (index: number) => number = () => 1,
  ) {
    const step = (end - start) / count;
    for (let i = 0; i < count; i++) {
      const angle = start + step * i;
      const a = alpha(i);
      this.segment(planePoint(r0, angle, plane, tmpA), planePoint(r1, angle, plane, tmpB), a, a * 0.6);
    }
    return this;
  }

  /** Dotted circle: `count` tiny dashes of `dash` radians. */
  dots(radius: number, count: number, dash: number, plane: Plane = "xy", alpha: (index: number) => number = () => 1) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU;
      const a = alpha(i);
      this.segment(planePoint(radius, angle, plane, tmpA), planePoint(radius, angle + dash, plane, tmpB), a, a);
    }
    return this;
  }

  /** Outline of a small rectangle centred on the circle, aligned tangentially. */
  rect(radius: number, angle: number, length: number, depth: number, alpha = 1) {
    const half = length / radius / 2;
    const corners = [
      planePoint(radius - depth / 2, angle - half, "xy", new Vector3()),
      planePoint(radius - depth / 2, angle + half, "xy", new Vector3()),
      planePoint(radius + depth / 2, angle + half, "xy", new Vector3()),
      planePoint(radius + depth / 2, angle - half, "xy", new Vector3()),
    ];
    for (let i = 0; i < 4; i++) this.segment(corners[i], corners[(i + 1) % 4], alpha);
    return this;
  }

  get segmentCount() {
    return this.alphas.length / 2;
  }

  /** Geometry for `LineSegments` + HoloLineMaterial. */
  toGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("aAlpha", new Float32BufferAttribute(this.alphas, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Flat arrays for `LineSegmentsGeometry` (fat lines): intensity is baked into RGB as grey. */
  toFatArrays(intensity = 1) {
    const positions = new Float32Array(this.positions);
    const colors = new Float32Array(this.positions.length);
    for (let i = 0; i < this.alphas.length; i++) {
      colors.fill(this.alphas[i] * intensity, i * 3, i * 3 + 3);
    }
    return { positions, colors };
  }
}

/**
 * Orbiting point cloud attributes for HoloPointsMaterial.
 * `position` is the starting point, `aAxis` the orbit axis, `aParams` = (speed, phase, size, brightness).
 */
export class PointBuilder {
  private positions: number[] = [];
  private axes: number[] = [];
  private params: number[] = [];

  add(position: Vector3, size: number, brightness: number, phase: number, speed = 0, axis: Vector3 = tmpC.set(0, 1, 0)) {
    this.positions.push(position.x, position.y, position.z);
    this.axes.push(axis.x, axis.y, axis.z);
    this.params.push(speed, phase, size, brightness);
    return this;
  }

  toGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("aAxis", new Float32BufferAttribute(this.axes, 3));
    geometry.setAttribute("aParams", new Float32BufferAttribute(this.params, 4));
    geometry.computeBoundingSphere();
    return geometry;
  }
}
