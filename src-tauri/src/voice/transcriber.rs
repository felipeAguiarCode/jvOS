//! Whisper (whisper.cpp via whisper-rs) speech-to-text for short utterances.

use std::path::Path;
use std::sync::Once;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

use super::matcher::normalize;
use super::vad::SAMPLE_RATE;

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

static SILENCE_LOGS: Once = Once::new();

pub struct Transcriber {
    /// Keeps its own reference to the loaded model.
    state: WhisperState,
    threads: i32,
}

impl Transcriber {
    pub fn load(model: &Path) -> Result<Self, String> {
        // Route whisper.cpp/ggml logs to the (unused) `log` facade instead of stderr.
        SILENCE_LOGS.call_once(whisper_rs::install_logging_hooks);
        let mut parameters = WhisperContextParameters::default();
        parameters.flash_attn(true);
        let context = WhisperContext::new_with_params(model, parameters)
            .map_err(|e| format!("Falha ao carregar o modelo de voz: {e}"))?;
        let state = context.create_state().map_err(|e| format!("Falha ao iniciar o Whisper: {e}"))?;
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, MAX_THREADS) as i32;
        Ok(Self { state, threads })
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
    fn detects_prompt_echo() {
        let prompt = build_prompt(["navegador", "vs code", "terminal"].map(String::from).into_iter());
        assert_eq!(prompt, "Hey Jarvis. navegador, vs code, terminal.");
        assert!(is_prompt_echo("Hey Jarvis, navegador, VS Code", &prompt));
        assert!(!is_prompt_echo("Hey Jarvis, abre o navegador", &prompt));
        assert!(!is_prompt_echo("terminal", &prompt), "a single keyword is a real command");
    }
}
