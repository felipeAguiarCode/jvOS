//! JARVIS's voice: neural text-to-speech, offline — sherpa-onnx running Kokoro-82M (Brazilian
//! Portuguese voices) or a Piper voice. A model is downloaded once from the Settings, like
//! Whisper's, and the UI asks for one sentence at a time while the previous one plays.
//!
//! sherpa-onnx's DLLs sit next to jarvis.exe: Windows 11 has an older onnxruntime.dll of its
//! own in System32, and the application's folder is searched first.

use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, OfflineTtsModelConfig, OfflineTtsVitsModelConfig};

use crate::download;

const BASE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";
/// Written once an archive is fully extracted: what counts as downloaded.
const READY: &str = ".ready";

/// How a model turns text into speech.
pub enum Kind {
    /// Kokoro ≥ 1.0: several speakers, a language for its built-in phonemizer.
    Kokoro { lang: &'static str },
    /// Piper (VITS): one speaker; `onnx` is the model file's name.
    Piper { onnx: &'static str },
}

pub struct VoiceModel {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// The release archive; it holds a folder of the same name, without `.tar.bz2`.
    pub archive: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub kind: Kind,
}

impl VoiceModel {
    fn folder(&self) -> &'static str {
        self.archive.trim_end_matches(".tar.bz2")
    }
}

/// Measured on a Core 7 150U (Whisper understood every voice): the Piper voices speak about 4×
/// faster than real time, Kokoro about as fast as real time — a sentence's wait before it starts.
pub const MODELS: &[VoiceModel] = &[
    VoiceModel {
        id: "piper-miro",
        label: "Piper Miro",
        description: "Voz grave e rápida, recomendada",
        archive: "vits-piper-pt_BR-miro-high-int8.tar.bz2",
        size: 21_341_456,
        sha256: "d6bea7c3e4176feb2fd470958fa9c72cbc4b9ed5ff29d1f7b1c935733ce2c08b",
        kind: Kind::Piper { onnx: "pt_BR-miro-high.onnx" },
    },
    VoiceModel {
        id: "piper-cadu",
        label: "Piper Cadu",
        description: "Leve e rápida",
        archive: "vits-piper-pt_BR-cadu-medium-int8.tar.bz2",
        size: 21_135_464,
        sha256: "78f1caf0a74cc6cb8dedaff87affd232ee653d5b0394d4cf4d2e97ecbfa5ff3d",
        kind: Kind::Piper { onnx: "pt_BR-cadu-medium.onnx" },
    },
    VoiceModel {
        id: "piper-jeff",
        label: "Piper Jeff",
        description: "Leve e rápida",
        archive: "vits-piper-pt_BR-jeff-medium-int8.tar.bz2",
        size: 21_211_448,
        sha256: "21a8883f9662c784dd5653fd9d5cb9aaae2551c70e16854e81ff4a9c96470e6a",
        kind: Kind::Piper { onnx: "pt_BR-jeff-medium.onnx" },
    },
    VoiceModel {
        id: "piper-dii",
        label: "Piper Dii",
        description: "Leve e rápida",
        archive: "vits-piper-pt_BR-dii-high-int8.tar.bz2",
        size: 21_117_576,
        sha256: "8a5b0195eff80a0240f18a3f1d528d4bef08f1b702126cee858d700365fc4111",
        kind: Kind::Piper { onnx: "pt_BR-dii-high.onnx" },
    },
    VoiceModel {
        id: "kokoro",
        label: "Kokoro (neural)",
        description: "Mais natural, mas leva cerca de 1 s por segundo de fala",
        archive: "kokoro-int8-multi-lang-v1_0.tar.bz2",
        size: 132_353_410,
        sha256: "72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653",
        kind: Kind::Kokoro { lang: "pt-br" },
    },
];

/// A voice to pick in the Settings: a model, and its speaker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    pub id: &'static str,
    pub label: &'static str,
    pub model: &'static str,
    /// Speaker id in the model (Kokoro v1.0's table is alphabetical; em_santa was added last, at 53).
    #[serde(skip)]
    pub sid: i32,
}

/// Genders as heard (median pitch of the samples: male ~100–155 Hz, female ~200 Hz).
pub const VOICES: &[Voice] = &[
    Voice { id: "miro", label: "Miro · masculina, grave", model: "piper-miro", sid: 0 },
    Voice { id: "cadu", label: "Cadu · masculina", model: "piper-cadu", sid: 0 },
    Voice { id: "jeff", label: "Jeff · masculina", model: "piper-jeff", sid: 0 },
    Voice { id: "dii", label: "Dii · feminina", model: "piper-dii", sid: 0 },
    Voice { id: "pm_alex", label: "Alex · neural, masculina", model: "kokoro", sid: 43 },
    Voice { id: "pm_santa", label: "Santa · neural, masculina", model: "kokoro", sid: 44 },
    Voice { id: "pf_dora", label: "Dora · neural, feminina", model: "kokoro", sid: 42 },
    Voice { id: "bm_george", label: "George · neural, sotaque britânico", model: "kokoro", sid: 26 },
];

pub fn find_model(id: &str) -> Option<&'static VoiceModel> {
    MODELS.iter().find(|model| model.id == id)
}

pub fn find_voice(id: &str) -> Option<&'static Voice> {
    VOICES.iter().find(|voice| voice.id == id)
}

fn model_dir(dir: &Path, model: &VoiceModel) -> PathBuf {
    dir.join(model.folder())
}

pub fn is_downloaded(dir: &Path, model: &VoiceModel) -> bool {
    model_dir(dir, model).join(READY).is_file()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub size: u64,
    pub downloaded: bool,
    pub downloading: bool,
}

/// Downloads the model's archive (hash-checked) and extracts it into `dir`.
pub fn download(model: &VoiceModel, dir: &Path, progress: impl FnMut(u64, u64)) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let archive = dir.join(model.archive);
    download::fetch_verified(&format!("{BASE_URL}/{}", model.archive), &archive, model.sha256, Some(model.size), model.size + 1, progress)?;
    let extracted = extract(&archive, dir);
    let _ = fs::remove_file(&archive);
    extracted?;
    let target = model_dir(dir, model);
    if !target.is_dir() {
        return Err("O pacote da voz veio sem a pasta esperada".into());
    }
    fs::write(target.join(READY), b"").map_err(|error| error.to_string())
}

/// A `.tar.bz2` unpacked into `dir` (entries cannot escape it).
fn extract(archive: &Path, dir: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|error| error.to_string())?;
    tar::Archive::new(bzip2::read::BzDecoder::new(BufReader::new(file)))
        .unpack(dir)
        .map_err(|error| format!("Falha ao extrair a voz: {error}"))
}

/// The loaded model (one at a time; loading takes a moment, so it stays).
pub struct Speaker {
    loaded: Mutex<Option<(&'static str, OfflineTts)>>,
    threads: i32,
}

impl Default for Speaker {
    fn default() -> Self {
        Self::new(std::thread::available_parallelism().map_or(2, |count| (count.get() / 2).clamp(1, 4)) as i32)
    }
}

impl Speaker {
    pub fn new(threads: i32) -> Self {
        Self { loaded: Mutex::new(None), threads }
    }

    /// `text` spoken by `voice` at `speed` (1 = normal), as a 16-bit PCM WAV file.
    pub fn synthesize(&self, dir: &Path, voice: &str, text: &str, speed: f32) -> Result<Vec<u8>, String> {
        let voice = find_voice(voice).ok_or("Voz desconhecida")?;
        let model = find_model(voice.model).ok_or("Modelo de voz desconhecido")?;
        if !is_downloaded(dir, model) {
            return Err(MISSING.into());
        }
        let text = text.trim();
        if text.is_empty() {
            return Err("Nada para falar".into());
        }
        let mut loaded = self.loaded.lock().unwrap();
        if loaded.as_ref().is_none_or(|(id, _)| *id != model.id) {
            *loaded = None;
            let tts = OfflineTts::create(&config(&model_dir(dir, model), model, self.threads)).ok_or("Não consegui carregar a voz")?;
            *loaded = Some((model.id, tts));
        }
        let (_, tts) = loaded.as_ref().expect("just loaded");
        let generation = GenerationConfig { sid: voice.sid, speed: speed.clamp(0.5, 2.0), silence_scale: 0.2, ..Default::default() };
        let audio = tts.generate_with_config(text, &generation, None::<fn(&[f32], f32) -> bool>).ok_or("A voz falhou")?;
        Ok(wav(audio.samples(), audio.sample_rate().max(1) as u32))
    }
}

/// Returned while the selected voice's model is not on disk.
pub const MISSING: &str = "voice-missing";

fn config(dir: &Path, model: &VoiceModel, threads: i32) -> OfflineTtsConfig {
    let file = |name: &str| Some(dir.join(name).display().to_string());
    // espeak-ng turns the Portuguese text into phonemes; its data comes with every model.
    let phonemes = file("espeak-ng-data");
    let mut models = OfflineTtsModelConfig { num_threads: threads, ..Default::default() };
    match model.kind {
        Kind::Kokoro { lang } => {
            models.kokoro = OfflineTtsKokoroModelConfig {
                model: file("model.int8.onnx"),
                voices: file("voices.bin"),
                tokens: file("tokens.txt"),
                data_dir: phonemes,
                lang: Some(lang.into()),
                length_scale: 1.0,
                ..Default::default()
            };
        }
        Kind::Piper { onnx } => {
            models.vits = OfflineTtsVitsModelConfig {
                model: file(onnx),
                tokens: file("tokens.txt"),
                data_dir: phonemes,
                noise_scale: 0.667,
                noise_scale_w: 0.8,
                length_scale: 1.0,
                ..Default::default()
            };
        }
    }
    OfflineTtsConfig { model: models, max_num_sentences: 1, silence_scale: 0.2, ..Default::default() }
}

/// Mono samples in -1..1 as a 16-bit PCM WAV file.
pub fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&((sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16).to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_consistent() {
        for model in MODELS {
            assert_eq!(model.sha256.len(), 64);
            assert!(model.archive.ends_with(".tar.bz2"));
            assert!(!model.folder().ends_with(".bz2"));
        }
        for voice in VOICES {
            assert!(find_model(voice.model).is_some(), "{}", voice.id);
        }
        // Kokoro v1.0's 54 voices.
        assert!(VOICES.iter().filter(|voice| voice.model == "kokoro").all(|voice| (0..54).contains(&voice.sid)));
        // The default (src/lib/speech.ts) comes first.
        assert_eq!(VOICES[0].id, "miro");
    }

    #[test]
    fn writes_a_playable_wav() {
        let bytes = wav(&[0.0, 1.0, -1.0, 2.0], 24_000);
        assert_eq!(bytes.len(), 44 + 8);
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 24_000);
        assert_eq!(&bytes[36..40], b"data");
        let samples: Vec<i16> = bytes[44..].chunks(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]])).collect();
        // Clipped beyond full scale.
        assert_eq!(samples, [0, i16::MAX, -i16::MAX, i16::MAX]);
    }

    /// Every voice saying a few JARVIS lines, saved to listen to, with its speed and what Whisper
    /// hears in it: `JARVIS_TTS_DIR=<models> JARVIS_TTS_OUT=<dir> [JARVIS_WHISPER=<ggml>]
    /// cargo test --lib -- --ignored speech_samples --nocapture`.
    #[test]
    #[ignore = "needs the voice models (and a Whisper model for the transcriptions)"]
    fn speech_samples() {
        use crate::voice::audio::Resampler;
        use crate::voice::transcriber::Transcriber;
        use std::time::Instant;

        let dir = PathBuf::from(std::env::var("JARVIS_TTS_DIR").expect("JARVIS_TTS_DIR"));
        let out = PathBuf::from(std::env::var("JARVIS_TTS_OUT").expect("JARVIS_TTS_OUT"));
        fs::create_dir_all(&out).unwrap();
        let mut whisper = std::env::var("JARVIS_WHISPER").ok().map(|model| Transcriber::load(Path::new(&model)).unwrap());
        let lines = [
            "Às suas ordens. Os sistemas estão operacionais e o Claude Code está pronto.",
            "O dólar fechou a cinco reais e quarenta centavos, numa alta de oito por cento.",
            "Salvei a nota com o resumo da reunião de hoje. Deseja mais alguma coisa?",
        ];
        let speaker = std::env::var("JARVIS_TTS_THREADS").ok().and_then(|threads| threads.parse().ok()).map_or_else(Speaker::default, Speaker::new);
        let only = std::env::var("JARVIS_TTS_VOICES").ok();
        for voice in VOICES {
            if only.as_ref().is_some_and(|list| !list.split(',').any(|id| id == voice.id)) {
                continue;
            }
            if !find_model(voice.model).is_some_and(|model| is_downloaded(&dir, model)) {
                println!("{}: model not here, skipped", voice.id);
                continue;
            }
            for (index, line) in lines.iter().enumerate() {
                let started = Instant::now();
                let bytes = speaker.synthesize(&dir, voice.id, line, 1.0).unwrap();
                let elapsed = started.elapsed().as_secs_f32();
                fs::write(out.join(format!("{}-{}.wav", voice.id, index + 1)), &bytes).unwrap();
                let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
                let samples: Vec<f32> = bytes[44..].chunks(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / i16::MAX as f32).collect();
                let seconds = samples.len() as f32 / rate as f32;
                let pitch = pitch_hz(&samples, rate);
                let heard = whisper.as_mut().map(|transcriber| {
                    let mut resampled = Vec::new();
                    Resampler::new(rate).process(&samples, &mut resampled);
                    transcriber.transcribe(&resampled, "pt", "").unwrap_or_else(|error| error)
                });
                println!("{} #{}: {seconds:.1}s of audio in {elapsed:.2}s (RTF {:.2}), pitch {pitch:.0} Hz | heard: {}", voice.id, index + 1, elapsed / seconds, heard.unwrap_or_default());
            }
        }
    }

    /// The median fundamental frequency of the voiced parts (autocorrelation over 40 ms frames):
    /// roughly 85–155 Hz for a male voice, 165–255 Hz for a female one.
    fn pitch_hz(samples: &[f32], rate: u32) -> f32 {
        let frame = (rate as usize) / 25;
        let (shortest, longest) = (rate as usize / 400, rate as usize / 70);
        let mut found: Vec<f32> = samples
            .chunks_exact(frame)
            .filter(|chunk| chunk.iter().map(|x| x * x).sum::<f32>() / frame as f32 > 1e-3)
            .filter_map(|chunk| {
                let energy: f32 = chunk.iter().map(|x| x * x).sum();
                let (lag, score) = (shortest..longest)
                    .map(|lag| (lag, chunk.iter().zip(&chunk[lag..]).map(|(a, b)| a * b).sum::<f32>() / energy))
                    .fold((0, 0.0), |best, item| if item.1 > best.1 { item } else { best });
                (score > 0.5).then(|| rate as f32 / lag as f32)
            })
            .collect();
        found.sort_by(f32::total_cmp);
        found.get(found.len() / 2).copied().unwrap_or(0.0)
    }

    #[test]
    fn extracts_an_archive_and_counts_it_once_ready() {
        let root = std::env::temp_dir().join(format!("jarvis-speech-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        // A tiny archive shaped like the real ones: one folder of files.
        let archive = root.join("voz.tar.bz2");
        {
            let file = File::create(&archive).unwrap();
            let mut builder = tar::Builder::new(bzip2::write::BzEncoder::new(file, bzip2::Compression::fast()));
            let mut header = tar::Header::new_gnu();
            header.set_size(5);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, "voz/tokens.txt", &b"a 1\n\n"[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }
        let out = root.join("tts");
        extract(&archive, &out).unwrap();
        assert_eq!(fs::read_to_string(out.join("voz").join("tokens.txt")).unwrap(), "a 1\n\n");
        let model = VoiceModel { id: "x", label: "", description: "", archive: "voz.tar.bz2", size: 0, sha256: "", kind: Kind::Piper { onnx: "x.onnx" } };
        assert!(!is_downloaded(&out, &model));
        fs::write(model_dir(&out, &model).join(READY), b"").unwrap();
        assert!(is_downloaded(&out, &model));
        let _ = fs::remove_dir_all(&root);
    }
}
