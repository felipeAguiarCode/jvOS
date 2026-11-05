//! Whisper (whisper.cpp via whisper-rs) speech-to-text for short utterances.

use std::path::Path;
use std::sync::{Mutex, Once};

use serde::Serialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

use super::matcher::normalize;
use super::vad::SAMPLE_RATE;
use crate::settings::{AUTO_DEVICE, CPU_DEVICE};

/// Segments Whisper itself considers non-speech above this probability are dropped.
const NO_SPEECH_THRESHOLD: f32 = 0.6;
/// whisper.cpp ignores inputs shorter than one second: pad with silence.
const MIN_SAMPLES: usize = SAMPLE_RATE * 11 / 10;
/// The encoder normally processes a fixed 30 s window (1500 frames, 50 per second). Commands
/// last a few seconds, so the window is sized to the utterance plus a margin: several times faster.
const ENCODER_FRAMES_PER_SECOND: f32 = 50.0;
const ENCODER_MARGIN: i32 = 128;
const ENCODER_MAX: i32 = 1500;
/// Measured on the speech fixtures (Core 7 150U, CPU only, 10 threads): 384 frames gives the
/// same text as 768 at ~60% of the time (Small ~2.4 s, Base ~0.75 s per command); 256 garbles
/// Base and sends Small into repetition loops.
const ENCODER_MIN: i32 = 384;
/// Decoded tokens per second of audio (speech is ~6), plus a base: a decoder caught in a
/// repetition loop ("Abre a bateria. Abre a bateria…") stops there instead of running for seconds.
const TOKENS_PER_SECOND: f32 = 10.0;
const TOKENS_BASE: i32 = 24;
/// The encoder is fastest with one thread per physical core on a hybrid laptop CPU (2 P + 8 E
/// cores: 10 threads beat 8 and 12).
const MAX_THREADS: usize = 10;
/// On a GPU the CPU threads only feed it (and run the few CPU-side ops): more of them just wake
/// cores that wait.
const GPU_THREADS: i32 = 4;
/// Two seconds of silence: the shapes of a short command, enough to build the GPU pipelines.
const WARM_UP_SAMPLES: usize = SAMPLE_RATE * 2;

static SILENCE_LOGS: Once = Once::new();
/// ggml's Vulkan backend initialises its instance on first use without a lock: device listing
/// (the settings) and model loading (the voice thread) take turns.
static VULKAN: Mutex<()> = Mutex::new(());

/// A GPU whisper.cpp can run on (its Vulkan backend). `index` is ggml's device number.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuDevice {
    #[serde(skip)]
    pub index: i32,
    pub name: String,
    pub vram_mb: u64,
}

/// The GPUs Whisper can use: none in a build without the `vulkan` feature.
pub fn gpu_devices() -> Vec<GpuDevice> {
    #[cfg(feature = "vulkan")]
    {
        let _guard = VULKAN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        whisper_rs::vulkan::list_devices()
            .into_iter()
            .map(|device| GpuDevice { index: device.id, name: device.name.trim().to_string(), vram_mb: (device.vram.total / (1024 * 1024)) as u64 })
            .collect()
    }
    #[cfg(not(feature = "vulkan"))]
    Vec::new()
}

/// The GPU `setting` asks for: "cpu" none, a name that GPU (if it is still there), "auto" the
/// measured choice (`auto_device`). The order of ggml's list says nothing: on the Core 7 150U +
/// MX570 laptop it is "Intel(R) Graphics", then "NVIDIA GeForce MX570 A".
fn pick_device(setting: &str, devices: &[GpuDevice]) -> Option<GpuDevice> {
    if setting == CPU_DEVICE {
        return None;
    }
    if setting != AUTO_DEVICE
        && let Some(device) = devices.iter().find(|device| device.name == setting)
    {
        return Some(device.clone());
    }
    auto_device(devices)
}

/// "auto": the integrated GPU when there is one, else the first other GPU (ADR-0021). Measured
/// with Small on the real speech fixtures: CPU 2.6–8 s per command, Intel Graphics 0.74–0.86 s,
/// the MX570 0.10–0.27 s. The integrated one frees the CPU at a fraction of the time without
/// keeping the discrete GPU awake (and drawing power) for as long as listening is on; the
/// discrete one is a click away in the settings.
fn auto_device(devices: &[GpuDevice]) -> Option<GpuDevice> {
    devices.iter().find(|device| is_integrated(&device.name)).or_else(|| devices.first()).cloned()
}

/// Vulkan names the GPU by its marketing name; the integrated ones are the CPU vendor's: Intel's
/// ("Intel(R) Graphics", "Intel(R) Arc(TM) Graphics" on newer chips) except the discrete Arc
/// cards ("Arc(TM) A770", "Arc B580"), and AMD's "Radeon(TM) Graphics" without a model number.
fn is_integrated(name: &str) -> bool {
    let name = name.to_lowercase();
    let discrete_arc = name.find("arc").is_some_and(|at| {
        let model = name[at + 3..].trim_start_matches("(tm)").trim_start();
        let mut chars = model.chars();
        matches!(chars.next(), Some('a' | 'b')) && chars.next().is_some_and(|c| c.is_ascii_digit())
    });
    (name.contains("intel") && !discrete_arc) || name.contains("radeon(tm) graphics") || name.contains("radeon graphics")
}

pub struct Transcriber {
    /// Keeps its own reference to the loaded model.
    state: WhisperState,
    threads: i32,
    /// Where it runs: "CPU" or the GPU's name.
    device: String,
}

impl Transcriber {
    /// Loads `model` on the device `setting` asks for ("auto", "cpu" or a GPU name). A GPU that
    /// fails to take the model falls back to the CPU.
    pub fn load(model: &Path, setting: &str) -> Result<Self, String> {
        // Route whisper.cpp/ggml logs to the (unused) `log` facade instead of stderr.
        SILENCE_LOGS.call_once(whisper_rs::install_logging_hooks);
        let gpu = pick_device(setting, &gpu_devices());
        if let Some(device) = &gpu {
            match Self::load_on(model, Some(device)).and_then(Self::warmed_up) {
                Ok(transcriber) => return Ok(transcriber),
                Err(error) => eprintln!("[jarvis] Whisper on {}: {error}; using the CPU", device.name),
            }
        }
        Self::load_on(model, None)
    }

    /// On a GPU the first transcription compiles ggml's Vulkan pipelines: measured 34.7 s on the
    /// MX570 and 6.6 s on Intel Graphics the very first time (the drivers cache them afterwards).
    /// Done here, on silence, it is part of loading, not of the user's first command.
    fn warmed_up(mut self) -> Result<Self, String> {
        self.transcribe(&vec![0.0; WARM_UP_SAMPLES], "pt", "Hey Jarvis.")?;
        Ok(self)
    }

    fn load_on(model: &Path, gpu: Option<&GpuDevice>) -> Result<Self, String> {
        let _guard = VULKAN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut parameters = WhisperContextParameters::default();
        parameters.flash_attn(true);
        parameters.use_gpu(gpu.is_some());
        if let Some(device) = gpu {
            parameters.gpu_device(device.index);
        }
        let context = WhisperContext::new_with_params(model, parameters)
            .map_err(|e| format!("Falha ao carregar o modelo de voz: {e}"))?;
        let state = context.create_state().map_err(|e| format!("Falha ao iniciar o Whisper: {e}"))?;
        let cpu_threads = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, MAX_THREADS) as i32;
        let threads = if gpu.is_some() { GPU_THREADS.min(cpu_threads) } else { cpu_threads };
        let device = gpu.map_or_else(|| "CPU".to_string(), |device| device.name.clone());
        Ok(Self { state, threads, device })
    }

    /// "CPU" or the GPU's name.
    pub fn device(&self) -> &str {
        &self.device
    }

    /// Transcribes one utterance. `prompt` biases the vocabulary (wake word, keywords).
    pub fn transcribe(&mut self, audio: &[f32], language: &str, prompt: &str) -> Result<String, String> {
        let mut padded;
        let audio = if audio.len() < MIN_SAMPLES {
            padded = audio.to_vec();
            padded.resize(MIN_SAMPLES, 0.0);
            &padded[..]
        } else {
            audio
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.threads);
        params.set_language(if language == "auto" { None } else { Some(language) });
        params.set_translate(false);
        params.set_no_context(true);
        params.set_single_segment(true);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_temperature(0.0);
        params.set_no_speech_thold(NO_SPEECH_THRESHOLD);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_initial_prompt(prompt);
        let seconds = audio.len() as f32 / SAMPLE_RATE as f32;
        let frames = (seconds * ENCODER_FRAMES_PER_SECOND).ceil() as i32 + ENCODER_MARGIN;
        params.set_audio_ctx(frames.clamp(ENCODER_MIN, ENCODER_MAX));
        params.set_max_tokens((seconds * TOKENS_PER_SECOND) as i32 + TOKENS_BASE);

        self.state.full(params, audio).map_err(|e| format!("Falha na transcrição: {e}"))?;

        let text = self
            .state
            .as_iter()
            .filter(|segment| segment.no_speech_probability() < NO_SPEECH_THRESHOLD)
            .filter_map(|segment| segment.to_str_lossy().ok().map(|text| text.trim().to_string()))
            .collect::<Vec<_>>()
            .join(" ");

        Ok(if is_prompt_echo(&text, prompt) { String::new() } else { text })
    }
}

/// On noise Whisper sometimes just repeats its prompt; such output must not trigger anything.
fn is_prompt_echo(text: &str, prompt: &str) -> bool {
    let text = normalize(text);
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let prompt = normalize(prompt).split_whitespace().collect::<Vec<_>>().join(" ");
    text.split_whitespace().count() >= 3 && prompt.contains(&text)
}

/// Vocabulary hint: the wake word and every configured keyword.
pub fn build_prompt(keywords: impl Iterator<Item = String>) -> String {
    let keywords: Vec<String> = keywords.collect();
    if keywords.is_empty() {
        "Hey Jarvis.".into()
    } else {
        // whisper.cpp takes the prompt as a C string.
        format!("Hey Jarvis. {}.", keywords.join(", ")).replace('\0', "")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_prefers_the_integrated_gpu_and_names_win() {
        let gpu = |index, name: &str| GpuDevice { index, name: name.into(), vram_mb: 2048 };
        let laptop = [gpu(0, "Intel(R) Graphics"), gpu(1, "NVIDIA GeForce MX570 A")];
        assert_eq!(pick_device("auto", &laptop).map(|device| device.index), Some(0));
        // The order does not matter, only what the GPU is.
        let swapped = [gpu(0, "NVIDIA GeForce MX570 A"), gpu(1, "Intel(R) Graphics")];
        assert_eq!(pick_device("auto", &swapped).map(|device| device.index), Some(1));
        // A discrete Arc card is not the integrated GPU; newer Intel iGPUs named "Arc" are.
        let desktop = [gpu(0, "Intel(R) Arc(TM) A770 Graphics"), gpu(1, "Intel(R) UHD Graphics 770")];
        assert_eq!(pick_device("auto", &desktop).map(|device| device.index), Some(1));
        assert!(is_integrated("Intel(R) Arc(TM) Graphics") && !is_integrated("Intel(R) Arc(TM) B580 Graphics"));
        assert!(is_integrated("AMD Radeon(TM) Graphics") && !is_integrated("AMD Radeon RX 7600"));
        assert_eq!(pick_device("auto", &[gpu(0, "NVIDIA GeForce RTX 4060")]).map(|device| device.index), Some(0));
        assert_eq!(pick_device("auto", &[]), None);
        // Chosen by name; a name that is gone falls back to "auto"; "cpu" never uses a GPU.
        assert_eq!(pick_device("NVIDIA GeForce MX570 A", &laptop).map(|device| device.index), Some(1));
        assert_eq!(pick_device("Some old GPU", &laptop).map(|device| device.index), Some(0));
        assert_eq!(pick_device("cpu", &laptop), None);
    }

    #[test]
    fn detects_prompt_echo() {
        let prompt = build_prompt(["navegador", "vs code", "terminal"].map(String::from).into_iter());
        assert_eq!(prompt, "Hey Jarvis. navegador, vs code, terminal.");
        assert!(is_prompt_echo("Hey Jarvis, navegador, VS Code", &prompt));
        assert!(!is_prompt_echo("Hey Jarvis, abre o navegador", &prompt));
        assert!(!is_prompt_echo("terminal", &prompt), "a single keyword is a real command");
    }
}
