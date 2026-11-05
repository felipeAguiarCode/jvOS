//! Silero VAD (sherpa-onnx) as the gatekeeper of the listening modes: before an utterance the
//! energy VAD cut goes to Whisper, Silero checks that it holds speech at all. A door, a keyboard,
//! music without singing or a fan are energy, not speech, and cost a whole Whisper pass each
//! (~2.4 s of ten CPU cores with Small). Silero runs only on those candidates (~5 ms per second of
//! audio on one thread), never continuously.
//!
//! The model (~0.6 MB) is downloaded the first time a listening mode needs it; until it is there,
//! or offline, the energy VAD alone decides, as before.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use super::vad::SAMPLE_RATE;
use crate::models;

/// Silero's speech probability above which a 32 ms window counts as speech (its default).
const THRESHOLD: f32 = 0.5;
/// Shorter bursts are not speech ("Hey Jarvis" alone lasts ~0.6 s).
const MIN_SPEECH_SECONDS: f32 = 0.25;
const MIN_SILENCE_SECONDS: f32 = 0.25;
/// Silero v4 at 16 kHz reads 512-sample windows.
const WINDOW: i32 = 512;
/// The energy VAD cuts utterances at 10 s; the buffer holds a few of them.
const BUFFER_SECONDS: f32 = 30.0;
/// With the model missing, the folder is looked at again this often (the download may finish).
const RECHECK: Duration = Duration::from_secs(10);

/// One download per run, whatever the number of engines started.
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

pub struct SpeechGate {
    dir: PathBuf,
    detector: Option<VoiceActivityDetector>,
    checked: Option<Instant>,
}

impl SpeechGate {
    /// The gate for the models in `dir` (next to the Whisper models). Nothing is loaded yet.
    pub fn new(dir: &Path) -> Self {
        Self { dir: dir.to_path_buf(), detector: None, checked: None }
    }

    /// Whether the utterance holds speech. True when Silero is not available (yet): the energy VAD
    /// already let it through.
    pub fn passes(&mut self, utterance: &[f32]) -> bool {
        self.ensure_loaded();
        match &self.detector {
            Some(detector) => speech_seconds(detector, utterance) >= MIN_SPEECH_SECONDS,
            None => true,
        }
    }

    fn ensure_loaded(&mut self) {
        if self.detector.is_some() || self.checked.is_some_and(|at| at.elapsed() < RECHECK) {
            return;
        }
        self.checked = Some(Instant::now());
        let model = &models::SILERO;
        if models::is_downloaded(&self.dir, model) {
            self.detector = load(&models::path(&self.dir, model));
        } else if !DOWNLOADING.swap(true, Ordering::SeqCst) {
            let dir = self.dir.clone();
            let _ = std::thread::Builder::new().name("jarvis-silero-download".into()).spawn(move || {
                if let Err(error) = models::download(&models::SILERO, &dir, |_, _| {}) {
                    eprintln!("[jarvis] Silero VAD: {error}");
                }
                DOWNLOADING.store(false, Ordering::SeqCst);
            });
        }
    }
}

fn load(model: &Path) -> Option<VoiceActivityDetector> {
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(model.to_string_lossy().into_owned()),
            threshold: THRESHOLD,
            min_silence_duration: MIN_SILENCE_SECONDS,
            min_speech_duration: MIN_SPEECH_SECONDS,
            window_size: WINDOW,
            max_speech_duration: BUFFER_SECONDS,
        },
        sample_rate: SAMPLE_RATE as i32,
        num_threads: 1,
        provider: Some("cpu".into()),
        ..Default::default()
    };
    let detector = VoiceActivityDetector::create(&config, BUFFER_SECONDS);
    if detector.is_none() {
        eprintln!("[jarvis] Silero VAD: could not load {}", model.display());
    }
    detector
}

/// Seconds of speech Silero finds in `samples` (16 kHz mono), from a fresh state.
fn speech_seconds(detector: &VoiceActivityDetector, samples: &[f32]) -> f32 {
    detector.reset();
    detector.accept_waveform(samples);
    detector.flush();
    let mut total = 0usize;
    while let Some(segment) = detector.front() {
        total += segment.n().max(0) as usize;
        detector.pop();
    }
    total as f32 / SAMPLE_RATE as f32
}

#[cfg(test)]
mod speech_tests {
    //! Real Silero model (downloaded on first run) on the speech fixtures:
    //! `cargo test --lib -- --ignored speech_gate`. Needs sherpa's DLLs next to the test binary
    //! (target/debug/deps), or Windows loads its own older onnxruntime.dll.

    use super::*;

    fn fixture(name: &str) -> Vec<f32> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(format!("{name}.wav"));
        let bytes = std::fs::read(&path).unwrap();
        // Walk the RIFF chunks to the PCM data (16-bit mono, 16 kHz), as voice::speech_tests does.
        let mut offset = 12;
        loop {
            let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            if &bytes[offset..offset + 4] == b"data" {
                return bytes[offset + 8..offset + 8 + size].chunks_exact(2).map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0).collect();
            }
            offset += 8 + size + (size & 1);
        }
    }

    fn detector() -> VoiceActivityDetector {
        let dir = std::env::var("LOCALAPPDATA").map(|base| PathBuf::from(base).join("dev.jarvis.os").join("models")).unwrap();
        if !models::is_downloaded(&dir, &models::SILERO) {
            models::download(&models::SILERO, &dir, |_, _| {}).unwrap();
        }
        load(&models::path(&dir, &models::SILERO)).unwrap()
    }

    #[test]
    #[ignore]
    fn speech_gate_tells_speech_from_noise() {
        let detector = detector();
        for name in ["wake_only", "wake_command", "terminal"] {
            let seconds = speech_seconds(&detector, &fixture(name));
            assert!(seconds >= MIN_SPEECH_SECONDS, "{name}: only {seconds:.2} s of speech");
        }

        // Loud broadband noise (a fan, a crowd hiss) and a steady hum: energy, not speech.
        let mut seed = 0x2545_f491_u32;
        let noise: Vec<f32> = (0..SAMPLE_RATE * 3)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.6
            })
            .collect();
        assert!(speech_seconds(&detector, &noise) < MIN_SPEECH_SECONDS, "white noise passed");
        let hum: Vec<f32> = (0..SAMPLE_RATE * 3).map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 120.0 / SAMPLE_RATE as f32).sin() * 0.4).collect();
        assert!(speech_seconds(&detector, &hum) < MIN_SPEECH_SECONDS, "a 120 Hz hum passed");
        assert!(speech_seconds(&detector, &vec![0.0; SAMPLE_RATE * 2]) < MIN_SPEECH_SECONDS, "silence passed");
    }
}
