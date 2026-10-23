import { Vector4 } from "three";
import { SPECTRUM_BANDS } from "../../lib/signals";

/**
 * Uniform objects shared by reference across every hologram material, so the
 * audio driver updates time and audio once per frame for the whole scene.
 */
export const sharedUniforms = {
  uTime: { value: 0 },
  /** x = level (RMS), y = bass, z = mid, w = treble — all smoothed, 0..1. */
  uAudio: { value: new Vector4() },
  /** 0..1 while someone speaks: the whole hologram brightens. */
  uVoice: { value: 0 },
  /** Smoothed band energies, low → high frequencies, 0..1. */
  uSpectrum: { value: new Float32Array(SPECTRUM_BANDS) },
  /** Device pixels per point-size unit (dpr × viewport height / 1080). */
  uPointScale: { value: 1 },
  /** Camera distance, for point size attenuation. */
  uCameraDistance: { value: 20 },
};
