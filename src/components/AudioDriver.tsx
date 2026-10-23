import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSignals } from "../lib/signals";
import { sharedUniforms } from "../shaders/hologram/sharedUniforms";

interface AudioDriverProps {
  sample: (delta: number) => void;
  onFirstFrame?: () => void;
}

/**
 * Runs before every other frame callback (priority -1): advances the scene clock,
 * samples the analyser and publishes the result to the shared shader uniforms.
 */
export function AudioDriver({ sample, onFirstFrame }: AudioDriverProps) {
  const signals = useSignals();
  const firstFrame = useRef(true);

  useFrame((_, delta) => {
    sample(delta);
    sharedUniforms.uTime.value = signals.time;
    sharedUniforms.uAudio.value.set(signals.level, signals.bass, signals.mid, signals.treble);
    sharedUniforms.uVoice.value = signals.voice;
    sharedUniforms.uSpectrum.value.set(signals.spectrum);

    if (firstFrame.current) {
      firstFrame.current = false;
      onFirstFrame?.();
    }
  }, -1);

  return null;
}
