import { useCallback, useEffect, useRef, useState } from "react";
import { approach, createSignals, SPECTRUM_BANDS, type HoloSignals } from "../lib/signals";

export type VoiceStatus = "idle" | "listening" | "error";

/** Alignment of the hologram: a fixed amount, or following the voice ("Sempre ouvindo" mode). */
export type AlignTarget = number | "voice";

type Band = "bass" | "mid" | "treble";

/** Frequency ranges (Hz) of each band. Voice fundamentals sit in "bass". */
const BAND_RANGES: Record<Band, [number, number]> = {
  bass: [60, 250],
  mid: [250, 2000],
  treble: [2000, 8000],
};

/** Envelope time constants: fast attack, slow release (seconds). */
const ATTACK = 0.05;
const RELEASE = 0.38;
/** The level's running peak decays over a few seconds so quiet microphones still drive the visuals. */
const PEAK_DECAY = 4;
const PEAK_FLOOR = 0.45;
/** Exponent separating the bands: the dominant band follows the level, weaker ones fall off fast. */
const BAND_CONTRAST = 2.5;
/** Maximum delta fed into the scene clock (avoids jumps after a pause). */
const MAX_DELTA = 0.05;
/** Share of the audio reaction kept at zero attention (waiting for "Hey Jarvis"). */
const RESTING_GAIN = 0.25;
/** Frequency range (Hz) split into the log-spaced spectrum bands. */
const SPECTRUM_RANGE: [number, number] = [90, 7000];
const SPECTRUM_ATTACK = 0.04;
const SPECTRUM_RELEASE = 0.18;
/** Speech detection: dB above the background noise where `voice` starts and saturates. */
const VOICE_ABOVE_NOISE: [number, number] = [6, 18];
/** Below this (dBFS) nothing counts as speech, whatever the noise floor. */
const VOICE_GATE_DB = -62;
/** The noise floor follows quiet moments quickly and creeps up slowly under speech (seconds). */
const NOISE_FALL = 0.25;
const NOISE_RISE = 4;
/** `voice` lights up fast and holds through the gaps between syllables. */
const VOICE_ATTACK = 0.06;
const VOICE_RELEASE = 0.45;
/** Particles and rings snap onto the equator quickly and scatter back more slowly (seconds). */
const ALIGN_IN = 0.35;
const ALIGN_OUT = 0.7;

interface AudioGraph {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  timeData: Float32Array<ArrayBuffer>;
  freqData: Uint8Array<ArrayBuffer>;
  bins: Record<Band, [number, number]>;
  spectrumBins: [number, number][];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Edges (Hz) of the spectrum bands, evenly spaced on a log scale. */
function spectrumRanges(): [number, number][] {
  const [low, high] = SPECTRUM_RANGE;
  const ratio = Math.pow(high / low, 1 / SPECTRUM_BANDS);
  return Array.from({ length: SPECTRUM_BANDS }, (_, i) => [low * Math.pow(ratio, i), low * Math.pow(ratio, i + 1)]);
}

function describeError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Acesso ao microfone negado";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Nenhum microfone encontrado";
    case "NotReadableError":
    case "AbortError":
      return "Microfone indisponível";
    default:
      return "Falha ao abrir o microfone";
  }
}

function releaseGraph(graph: AudioGraph) {
  graph.stream.getTracks().forEach((track) => track.stop());
  graph.source.disconnect();
  void graph.context.close().catch(() => undefined);
}

/** 0..1 energy of a band on the analyser's dB scale. Mean + peak, so narrow tones register too. */
function bandEnergy(data: Uint8Array, [from, to]: [number, number]) {
  let sum = 0;
  let peak = 0;
  for (let i = from; i <= to; i++) {
    sum += data[i];
    peak = Math.max(peak, data[i]);
  }
  const value = (sum / (to - from + 1) + peak) / 2 / 255;
  // Ignore the noise floor, then stretch the remaining range.
  return clamp01((value - 0.12) / 0.75);
}

/**
 * Microphone capture for the hologram. React state only changes on status transitions;
 * the per-frame features live in the mutable `signals` object, updated by `sample()`
 * from inside the render loop.
 */
export function useAudioAnalyzer() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const graphRef = useRef<AudioGraph | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const signals = useRef<HoloSignals>(createSignals()).current;
  const peak = useRef(PEAK_FLOOR);
  const noise = useRef(0);
  const spectrumTarget = useRef(new Float32Array(SPECTRUM_BANDS)).current;
  const attentionTarget = useRef(1);
  const alignTarget = useRef<AlignTarget>(0);

  const stop = useCallback(() => {
    requestRef.current++; // also cancels a pending permission request
    pendingRef.current = false;
    const graph = graphRef.current;
    graphRef.current = null;
    if (graph) releaseGraph(graph);
    setStatus("idle");
    setError(null);
  }, []);

  const fail = useCallback((message: string) => {
    const graph = graphRef.current;
    graphRef.current = null;
    if (graph) releaseGraph(graph);
    setStatus("error");
    setError(message);
  }, []);

  const start = useCallback(async () => {
    if (graphRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      fail("Microfone não suportado");
      return;
    }

    const request = ++requestRef.current;
    pendingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      // Turned off (or restarted) while the permission request was pending.
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -22;
      source.connect(analyser); // not connected to the destination: no echo

      const hzPerBin = context.sampleRate / analyser.fftSize;
      const lastBin = analyser.frequencyBinCount - 1;
      const toBins = ([lo, hi]: [number, number]): [number, number] => {
        const from = Math.min(lastBin, Math.max(1, Math.floor(lo / hzPerBin)));
        return [from, Math.min(lastBin, Math.max(from, Math.ceil(hi / hzPerBin)))];
      };

      const graph: AudioGraph = {
        stream,
        context,
        source,
        analyser,
        timeData: new Float32Array(analyser.fftSize),
        freqData: new Uint8Array(analyser.frequencyBinCount),
        bins: { bass: toBins(BAND_RANGES.bass), mid: toBins(BAND_RANGES.mid), treble: toBins(BAND_RANGES.treble) },
        spectrumBins: spectrumRanges().map(toBins),
      };
      // The noise floor is re-learned from the first quiet moments of every capture.
      noise.current = 0;

      stream.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (graphRef.current === graph) fail("Microfone desconectado");
        }),
      );

      graphRef.current = graph;
      if (context.state === "suspended") await context.resume();
      setStatus("listening");
      setError(null);
    } catch (err) {
      if (request === requestRef.current) fail(describeError(err));
    } finally {
      if (request === requestRef.current) pendingRef.current = false;
    }
  }, [fail]);

  const toggle = useCallback(() => {
    if (graphRef.current || pendingRef.current) stop();
    else void start();
  }, [start, stop]);

  /** How strongly the hologram follows the voice, 0..1 (eased). */
  const setAttention = useCallback((value: number) => {
    attentionTarget.current = value;
  }, []);

  /** How aligned the particles and rings are, 0..1, or "voice" to align while someone speaks (eased). */
  const setAlign = useCallback((target: AlignTarget) => {
    alignTarget.current = target;
  }, []);

  /** A visual beat: wake word heard, command executed. */
  const pulse = useCallback(() => {
    signals.pulse = 1;
  }, [signals]);

  /** Suspends audio processing while the window is hidden / minimised. */
  const setSuspended = useCallback((suspended: boolean) => {
    const context = graphRef.current?.context;
    if (!context) return;
    void (suspended ? context.suspend() : context.resume()).catch(() => undefined);
  }, []);

  /** Called once per frame (before the scene updates). */
  const sample = useCallback(
    (delta: number) => {
      const dt = Math.min(delta, MAX_DELTA);
      signals.time += dt;
      signals.frames++;

      let level = 0;
      let bass = 0;
      let mid = 0;
      let treble = 0;
      let speaking = 0;
      spectrumTarget.fill(0);

      const graph = graphRef.current;
      if (graph && graph.context.state === "running") {
        graph.analyser.getFloatTimeDomainData(graph.timeData);
        let sum = 0;
        for (let i = 0; i < graph.timeData.length; i++) sum += graph.timeData[i] * graph.timeData[i];
        const rms = Math.sqrt(sum / graph.timeData.length);
        const db = 20 * Math.log10(rms + 1e-9);
        // -60 dBFS → 0, -18 dBFS → 1 (noise gate built in).
        level = clamp01((db + 60) / 42);

        // Speech = clearly above the background noise, so it works with quiet and loud microphones alike.
        noise.current = approach(noise.current, db, dt, db < noise.current ? NOISE_FALL : NOISE_RISE);
        if (db > VOICE_GATE_DB) speaking = smoothstep(VOICE_ABOVE_NOISE[0], VOICE_ABOVE_NOISE[1], db - noise.current);
        // Adaptive normalisation against a slowly decaying running peak.
        peak.current = Math.max(level, peak.current * Math.exp(-dt / PEAK_DECAY), PEAK_FLOOR);
        level /= peak.current;

        // Bands describe the spectral balance, scaled by the level: the dominant band
        // follows the voice, the others only as much as they are present.
        graph.analyser.getByteFrequencyData(graph.freqData);
        const rawBass = bandEnergy(graph.freqData, graph.bins.bass);
        const rawMid = bandEnergy(graph.freqData, graph.bins.mid);
        const rawTreble = bandEnergy(graph.freqData, graph.bins.treble);
        const dominant = Math.max(rawBass, rawMid, rawTreble, 1e-3);
        bass = level * Math.pow(rawBass / dominant, BAND_CONTRAST);
        mid = level * Math.pow(rawMid / dominant, BAND_CONTRAST);
        treble = level * Math.pow(rawTreble / dominant, BAND_CONTRAST);
        for (let i = 0; i < SPECTRUM_BANDS; i++) spectrumTarget[i] = bandEnergy(graph.freqData, graph.spectrumBins[i]);
      }

      signals.attention = approach(signals.attention, attentionTarget.current, dt, 0.35);
      signals.pulse *= Math.exp(-dt / 0.6);
      const align = alignTarget.current === "voice" ? signals.voice : alignTarget.current;
      signals.align = approach(signals.align, align, dt, align > signals.align ? ALIGN_IN : ALIGN_OUT);
      const gain = RESTING_GAIN + (1 - RESTING_GAIN) * signals.attention;

      const envelope = (current: number, target: number) =>
        approach(current, target * gain, dt, target * gain > current ? ATTACK : RELEASE);
      signals.level = envelope(signals.level, level);
      signals.bass = envelope(signals.bass, bass);
      signals.mid = envelope(signals.mid, mid);
      signals.treble = envelope(signals.treble, treble);
      signals.active = approach(signals.active, graph ? 1 : 0, dt, 0.6);

      const voice = speaking * gain;
      signals.voice = approach(signals.voice, voice, dt, voice > signals.voice ? VOICE_ATTACK : VOICE_RELEASE);
      for (let i = 0; i < SPECTRUM_BANDS; i++) {
        const target = spectrumTarget[i] * gain;
        const current = signals.spectrum[i];
        signals.spectrum[i] = approach(current, target, dt, target > current ? SPECTRUM_ATTACK : SPECTRUM_RELEASE);
      }
    },
    [signals, spectrumTarget],
  );

  // Release the microphone if the app unmounts while listening.
  useEffect(
    () => () => {
      requestRef.current++;
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) releaseGraph(graph);
    },
    [],
  );

  return { status, error, start, stop, toggle, setSuspended, setAttention, setAlign, pulse, signals, sample };
}
