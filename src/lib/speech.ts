import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStoredState } from "./storage";

/** A voice model (mirrors `speech::ModelStatus` in Rust). */
export interface SpeechModel {
  id: string;
  label: string;
  description: string;
  size: number;
  downloaded: boolean;
  downloading: boolean;
}

/** A voice to pick: a model and its speaker. */
export interface SpeechVoice {
  id: string;
  label: string;
  model: string;
}

export interface SpeechStatus {
  models: SpeechModel[];
  voices: SpeechVoice[];
}

/** Stored in `jarvis.speech`. */
export interface SpeechPrefs {
  /** JARVIS speaks his answers. */
  enabled: boolean;
  voice: string;
  /** 1 = normal pace. */
  speed: number;
}

export const DEFAULT_SPEECH: SpeechPrefs = { enabled: true, voice: "miro", speed: 1 };
export const SPEEDS = { min: 0.8, max: 1.3 };

function parseSpeech(raw: unknown): SpeechPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { enabled, voice, speed } = raw as Record<string, unknown>;
  return {
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_SPEECH.enabled,
    voice: typeof voice === "string" && voice ? voice : DEFAULT_SPEECH.voice,
    speed: typeof speed === "number" && Number.isFinite(speed) ? Math.min(SPEEDS.max, Math.max(SPEEDS.min, speed)) : DEFAULT_SPEECH.speed,
  };
}

export function useSpeechPrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.speech", DEFAULT_SPEECH, parseSpeech);
  return [prefs, setPrefs] as const;
}

/** How the desktop app (or the tests' stand-in) speaks. */
interface SpeechBackend {
  status(): Promise<SpeechStatus>;
  download(id: string): Promise<void>;
  /** A WAV file. */
  synthesize(text: string, voice: string, speed: number): Promise<ArrayBuffer>;
  /** The listening modes ignore the microphone while JARVIS speaks. */
  deafen(on: boolean): void;
}

interface FakeSpeechOptions {
  /** How long each word lasts (ms). */
  msPerWord?: number;
  /** Synthesis fails (the text then keeps its own pace). */
  fail?: boolean;
}

declare global {
  interface Window {
    /** Development-only: a silent stand-in voice for the browser tests (true, or options). */
    __JARVIS_SPEECH__?: boolean | FakeSpeechOptions;
    /** …and what it was asked to say. */
    __JARVIS_SPEECH_LOG__?: { texts: string[]; deaf: boolean[] };
  }
}

const tauriBackend: SpeechBackend = {
  status: () => invoke<SpeechStatus>("speech_status"),
  download: (id) => invoke("speech_download", { id }),
  synthesize: (text, voice, speed) => invoke<ArrayBuffer>("speech_synthesize", { text, voice, speed }),
  deafen: (on) => void invoke("voice_deafen", { on }).catch(() => undefined),
};

/** Silence lasting `seconds`, as a WAV file. */
function silentWav(seconds: number, rate = 8000): ArrayBuffer {
  const samples = Math.max(1, Math.round(seconds * rate));
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return buffer;
}

function fakeBackend(): SpeechBackend {
  const log = (window.__JARVIS_SPEECH_LOG__ ??= { texts: [], deaf: [] });
  const options = () => (typeof window.__JARVIS_SPEECH__ === "object" ? window.__JARVIS_SPEECH__ : {});
  return {
    status: async () => ({
      models: [{ id: "piper-miro", label: "Piper Miro", description: "Simulada", size: 1, downloaded: true, downloading: false }],
      voices: [
        { id: "miro", label: "Miro · masculina, grave", model: "piper-miro" },
        { id: "dii", label: "Dii · feminina", model: "piper-miro" },
      ],
    }),
    download: async () => undefined,
    async synthesize(text) {
      log.texts.push(text);
      if (options().fail) throw new Error("voz simulada falhou");
      return silentWav((text.split(/\s+/).length * (options().msPerWord ?? 250)) / 1000);
    },
    deafen: (on) => void log.deaf.push(on),
  };
}

let fake: SpeechBackend | undefined;

/** The backend in use, or null where JARVIS has no voice (a browser, outside the tests). */
export function speechBackend(): SpeechBackend | null {
  if (isTauri()) return tauriBackend;
  if (import.meta.env.DEV && window.__JARVIS_SPEECH__) return (fake ??= fakeBackend());
  return null;
}

/** The voice models and their downloads (progress 0..1 by model id). */
export function useSpeechStatus() {
  const backend = speechBackend();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = useCallback(() => void backend?.status().then(setStatus, () => undefined), [backend]);

  useEffect(() => {
    refresh();
    if (!isTauri()) return;
    const subscriptions = [
      listen<{ id: string; received: number; total: number }>("speech:progress", ({ payload }) =>
        setProgress((current) => ({ ...current, [payload.id]: payload.total ? payload.received / payload.total : 0 })),
      ),
      listen<{ id: string; error: string | null }>("speech:done", ({ payload }) => {
        setProgress(({ [payload.id]: _, ...rest }) => rest);
        setErrors((current) => {
          const { [payload.id]: _, ...rest } = current;
          return payload.error ? { ...rest, [payload.id]: payload.error } : rest;
        });
        refresh();
      }),
    ];
    return () => subscriptions.forEach((subscription) => void subscription.then((stop) => stop()));
  }, [refresh]);

  const download = useCallback(
    (id: string) => {
      setProgress((current) => ({ ...current, [id]: 0 }));
      void backend?.download(id).catch((error: unknown) => {
        setProgress(({ [id]: _, ...rest }) => rest);
        setErrors((current) => ({ ...current, [id]: String(error) }));
      });
    },
    [backend],
  );

  return { available: backend !== null, status, progress, errors, download };
}

/** Whether `voice` can speak now (its model is on disk). */
export function voiceReady(status: SpeechStatus | null, voice: string) {
  const model = status?.voices.find((item) => item.id === voice)?.model;
  return status?.models.some((item) => item.id === model && item.downloaded) ?? false;
}

/** A sentence being spoken. */
export interface Playback {
  /** Seconds. */
  duration: number;
  ended: Promise<void>;
}

/** After his last word the microphone listens again (the room's echo dies down first). */
const DEAF_TAIL_MS = 400;

/**
 * JARVIS speaking one answer: each sentence synthesised in turn (the next ones while one plays)
 * and played through an analyser, so the hologram can follow his voice.
 */
export class SpeechPlayer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private clips = new Map<number, Promise<AudioBuffer | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private source: AudioBufferSourceNode | null = null;
  private deafTimer = 0;
  private closed = false;

  constructor(
    private backend: SpeechBackend,
    private prefs: Pick<SpeechPrefs, "voice" | "speed">,
    /** The analyser of his voice (null once he is done for good). */
    private onVoice: (analyser: AnalyserNode | null) => void,
  ) {}

  private audio() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -22;
      this.analyser.connect(this.context.destination);
      this.onVoice(this.analyser);
    }
    return this.context;
  }

  /** Starts making sentence `key` (in order: one synthesis at a time). */
  prepare(key: number, text: string) {
    if (this.clips.has(key) || this.closed) return;
    const clip = this.queue.then(async () => {
      if (this.closed) return null;
      const bytes = await this.backend.synthesize(text, this.prefs.voice, this.prefs.speed);
      return this.closed ? null : this.audio().decodeAudioData(bytes);
    });
    const settled = clip.catch(() => null);
    this.queue = settled;
    this.clips.set(key, settled);
  }

  /** Sentence `key`, once made (null: it could not be). */
  ready(key: number): Promise<AudioBuffer | null> {
    return this.clips.get(key) ?? Promise.resolve(null);
  }

  /** Plays a sentence; resolves null when the audio cannot play (e.g. no sound allowed yet). */
  async play(buffer: AudioBuffer): Promise<Playback | null> {
    const context = this.audio();
    if (context.state !== "running") await context.resume().catch(() => undefined);
    if (context.state !== "running" || this.closed) return null;
    this.source?.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser!);
    window.clearTimeout(this.deafTimer);
    this.backend.deafen(true);
    this.source = source;
    const ended = new Promise<void>((resolve) => {
      // Ended, stopped, or — should the audio stall — when it should have.
      const done = () => {
        window.clearTimeout(guard);
        if (this.source === source) {
          this.source = null;
          this.deafTimer = window.setTimeout(() => this.backend.deafen(false), DEAF_TAIL_MS);
        }
        resolve();
      };
      const guard = window.setTimeout(done, buffer.duration * 1000 + 1500);
      source.onended = done;
    });
    source.start();
    return { duration: buffer.duration, ended };
  }

  /** Silence at once; nothing more is said. */
  close() {
    if (this.closed) return;
    this.closed = true;
    const playing = this.source;
    this.source = null;
    playing?.stop();
    window.clearTimeout(this.deafTimer);
    if (playing) this.backend.deafen(false);
    this.onVoice(null);
    void this.context?.close().catch(() => undefined);
  }
}

export function createSpeechPlayer(prefs: Pick<SpeechPrefs, "voice" | "speed">, onVoice: (analyser: AnalyserNode | null) => void) {
  const backend = speechBackend();
  return backend ? new SpeechPlayer(backend, prefs, onVoice) : null;
}
