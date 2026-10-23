/**
 * Boot screen sounds, synthesised (no audio assets): keyboard clicks while typing, the POST
 * beep, the power-on chord as the POST gives way to the desktop, and the punchy digital hit of
 * each greeting word (after the SUPERHOT word cut-ins).
 */
export interface BootSound {
  click: () => void;
  beep: () => void;
  /** The machine coming to life: a warm, open chord that swells and rings out. */
  chime: () => void;
  /** One word slamming in: a pitch-dropping thump, a crunch of distorted noise, a digital blip. */
  hit: () => void;
  /** The text glitching out: a few stuttering zaps. */
  glitch: () => void;
  close: () => void;
}

const SILENT: BootSound = { click: () => undefined, beep: () => undefined, chime: () => undefined, hit: () => undefined, glitch: () => undefined, close: () => undefined };

/** The power-on chord: A, E, B, C#, E (an open A with the ninth), each voice at its own level. */
const CHIME_VOICES: [number, number][] = [
  [110, 0.5],
  [164.81, 0.38],
  [246.94, 0.26],
  [277.18, 0.32],
  [329.63, 0.26],
];
const CHIME_SECONDS = 3.2;

/** Hard-clipping curve for the crunch. */
function distortion(amount: number) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

export function createBootSound(enabled: boolean): BootSound {
  if (!enabled) return SILENT;
  try {
    const context = new AudioContext();
    void context.resume().catch(() => undefined);

    // A 25 ms burst of decaying noise, high-passed: a mechanical key.
    const length = Math.round(context.sampleRate * 0.025);
    const noise = context.createBuffer(1, length, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;

    // Without a user gesture a browser keeps the context suspended: stay silent then.
    const live = () => context.state === "running";

    // Shared by the word hits: everything goes through one gritty stage and a limiter.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.connect(context.destination);
    const grit = context.createWaveShaper();
    grit.curve = distortion(18);
    grit.oversample = "2x";
    grit.connect(limiter);

    const burst = (at: number, length: number, gain: number, frequency: number) => {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.playbackRate.value = 0.4 + Math.random() * 0.2;
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = frequency;
      band.Q.value = 0.9;
      const level = context.createGain();
      level.gain.setValueAtTime(gain, at);
      level.gain.exponentialRampToValueAtTime(0.001, at + length);
      source.connect(band).connect(level).connect(grit);
      source.start(at);
      source.stop(at + length + 0.02);
    };

    return {
      click() {
        if (!live()) return;
        const source = context.createBufferSource();
        source.buffer = noise;
        source.playbackRate.value = 0.85 + Math.random() * 0.3;
        const filter = context.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 1600;
        const gain = context.createGain();
        gain.gain.value = 0.07;
        source.connect(filter).connect(gain).connect(context.destination);
        source.start();
      },
      beep() {
        if (!live()) return;
        const start = context.currentTime + 0.01;
        const oscillator = context.createOscillator();
        oscillator.type = "square";
        oscillator.frequency.value = 1000;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 2400;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.06, start + 0.008);
        gain.gain.setValueAtTime(0.06, start + 0.13);
        gain.gain.linearRampToValueAtTime(0, start + 0.15);
        oscillator.connect(filter).connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.16);
      },
      chime() {
        if (!live()) return;
        const start = context.currentTime + 0.02;
        const out = context.createGain();
        out.gain.setValueAtTime(0.0001, start);
        out.gain.exponentialRampToValueAtTime(0.16, start + 0.08);
        out.gain.exponentialRampToValueAtTime(0.001, start + CHIME_SECONDS);
        // Bright at first, mellowing as it rings.
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(3200, start);
        filter.frequency.exponentialRampToValueAtTime(800, start + CHIME_SECONDS * 0.8);
        out.connect(filter).connect(context.destination);
        // A sine and a slightly detuned triangle per note: a soft beating, like a warm organ.
        for (const [frequency, level] of CHIME_VOICES) {
          for (const [type, detune, share] of [["sine", -4, 1], ["triangle", 5, 0.35]] as const) {
            const voice = context.createOscillator();
            voice.type = type;
            voice.frequency.value = frequency;
            voice.detune.value = detune;
            const gain = context.createGain();
            gain.gain.value = level * share;
            voice.connect(gain).connect(out);
            voice.start(start);
            voice.stop(start + CHIME_SECONDS + 0.1);
          }
        }
      },
      hit() {
        if (!live()) return;
        const start = context.currentTime + 0.005;
        // Each word a little different, so the series never sounds looped.
        const detune = 0.92 + Math.random() * 0.16;

        // The thump: a sine falling fast in pitch, like a kick drum.
        const body = context.createOscillator();
        body.type = "sine";
        body.frequency.setValueAtTime(170 * detune, start);
        body.frequency.exponentialRampToValueAtTime(42, start + 0.16);
        const bodyGain = context.createGain();
        bodyGain.gain.setValueAtTime(0.0001, start);
        bodyGain.gain.exponentialRampToValueAtTime(0.55, start + 0.004);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        body.connect(bodyGain).connect(grit);
        body.start(start);
        body.stop(start + 0.32);

        // The crunch: distorted noise, mid and high.
        burst(start, 0.07, 0.35, 1800 * detune);
        burst(start + 0.012, 0.045, 0.2, 4200 * detune);

        // The digital edge: a square blip dropping two octaves.
        const blip = context.createOscillator();
        blip.type = "square";
        blip.frequency.setValueAtTime(960 * detune, start);
        blip.frequency.exponentialRampToValueAtTime(240, start + 0.05);
        const blipGain = context.createGain();
        blipGain.gain.setValueAtTime(0.06, start);
        blipGain.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
        blip.connect(blipGain).connect(limiter);
        blip.start(start);
        blip.stop(start + 0.07);
      },
      glitch() {
        if (!live()) return;
        const start = context.currentTime + 0.005;
        for (let i = 0; i < 4; i++) burst(start + i * 0.055 + Math.random() * 0.015, 0.03, 0.22, 900 + Math.random() * 3000);
      },
      close() {
        // After the chord has rung out (the boot screen goes away while it still sounds).
        window.setTimeout(() => void context.close().catch(() => undefined), CHIME_SECONDS * 1000 + 300);
      },
    };
  } catch {
    return SILENT;
  }
}
