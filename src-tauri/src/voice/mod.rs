//! Voice assistant engine: microphone → VAD → Whisper → wake word / keyword → launch.
//!
//! Runs on its own thread, independent of the WebView, so commands keep working while the
//! window is minimised. The UI follows along through events.

pub mod audio;
pub mod matcher;
pub mod transcriber;
pub mod vad;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::launcher;
use crate::settings::{Activation, Settings};
use audio::Resampler;
use matcher::{command_vocabulary, Decision, Session};
use transcriber::{build_prompt, Transcriber};
use vad::Vad;

pub const EVENT_STATE: &str = "voice:state";
pub const EVENT_TRANSCRIBING: &str = "voice:transcribing";
pub const EVENT_TRANSCRIPT: &str = "voice:transcript";
pub const EVENT_WAKE: &str = "voice:wake";
pub const EVENT_COMMAND: &str = "voice:command";
/// Markdown dictation: `pending` while Whisper works, then the text (never a command).
pub const EVENT_DICTATION: &str = "voice:dictation";
/// A JARVIS window (widget or app) to open or close.
pub const EVENT_WINDOW: &str = "voice:window";
/// Close every widget, every app or every window.
pub const EVENT_WINDOWS: &str = "voice:windows";
/// jv_T4p3 controls ("próxima música", "toca a Flash FM").
pub const EVENT_MUSIC: &str = "voice:music";
/// Pomodoro controls ("inicia o pomodoro", "pula a fase").
pub const EVENT_POMODORO: &str = "voice:pomodoro";

const CANNOT_CLOSE: &str = "Fechar programas pela voz ainda não é possível";

/// A working microphone always picks up some noise; exact zeros mean it is muted
/// (often a laptop's microphone mute key, which Windows does not report as muted).
const SILENT_MIC_AFTER: Duration = Duration::from_secs(4);
const SILENT_MIC_MESSAGE: &str = "O microfone não está captando som. Verifique a tecla de mudo do microfone.";
/// How often the loop checks the push-to-talk button while the microphone is closed.
const POLL: Duration = Duration::from_millis(20);
/// Push-to-talk recordings stop growing at Whisper's 30 s window.
const MAX_PUSH_SAMPLES: usize = vad::SAMPLE_RATE * 30;
/// A hold shorter than this with pure digital silence is a tap, not a muted microphone.
const MIN_PUSH_SAMPLES: usize = vad::SAMPLE_RATE * 3 / 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceState {
    Off,
    /// Loading the Whisper model and opening the microphone.
    Loading,
    /// Wake word mode: waiting for "Hey Jarvis".
    Standby,
    /// Heard "Hey Jarvis": waiting for a keyword.
    Awake,
    /// Always-listening mode: every utterance is checked for keywords.
    Listening,
    /// Push-to-talk: model loaded, microphone closed until the button is held.
    Ready,
    /// Push-to-talk: button held, recording.
    Talking,
    /// The Markdown editor's microphone is held: recording for the editor, deaf to commands.
    Dictating,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub state: VoiceState,
    pub message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptEvent {
    text: String,
    millis: u128,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandEvent {
    app_id: String,
    name: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowEvent {
    kind: String,
    open: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsEvent {
    group: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicEvent {
    action: String,
    target: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PomodoroEvent {
    action: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictationEvent {
    text: String,
    pending: bool,
}

struct Worker {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

pub struct VoiceEngine {
    worker: Mutex<Option<Worker>>,
    status: Arc<Mutex<VoiceStatus>>,
    /// Push-to-talk button held. Outlives restarts: the first press may start the engine.
    talking: Arc<AtomicBool>,
    /// Push-to-talk: the last release was a cancel, so its recording is thrown away.
    discard: Arc<AtomicBool>,
    /// The Markdown editor's microphone is held.
    dictating: Arc<AtomicBool>,
    /// The engine was started only to dictate: it leaves again once the dictation is done.
    exit_after_dictation: Arc<AtomicBool>,
}

impl Default for VoiceEngine {
    fn default() -> Self {
        Self {
            worker: Mutex::new(None),
            status: Arc::new(Mutex::new(VoiceStatus { state: VoiceState::Off, message: None })),
            talking: Arc::new(AtomicBool::new(false)),
            discard: Arc::new(AtomicBool::new(false)),
            dictating: Arc::new(AtomicBool::new(false)),
            exit_after_dictation: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl VoiceEngine {
    pub fn status(&self) -> VoiceStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        self.worker.lock().unwrap().as_ref().is_some_and(|worker| !worker.thread.is_finished())
    }

    /// (Re)starts listening with the given model.
    pub fn start(&self, app: AppHandle, settings: Arc<RwLock<Settings>>, model: PathBuf) {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let reporter = Reporter { app, status: self.status.clone() };
        // Reported right away so the command that started the engine returns "loading".
        reporter.set(VoiceState::Loading, None);
        let thread = {
            let stop = stop.clone();
            let buttons = Buttons {
                talking: self.talking.clone(),
                discard: self.discard.clone(),
                dictating: self.dictating.clone(),
                exit_after_dictation: self.exit_after_dictation.clone(),
            };
            std::thread::Builder::new()
                .name("jarvis-voice".into())
                .spawn(move || run(reporter, settings, model, buttons, stop))
                .expect("failed to spawn the voice thread")
        };
        *self.worker.lock().unwrap() = Some(Worker { stop, thread });
    }

    /// Push-to-talk: the microphone opens while `down` and closes on release, which also
    /// sends the recording to Whisper — unless `cancel` (slid away, Esc, a tap) discards it.
    pub fn set_talking(&self, down: bool, cancel: bool) {
        // Stored before `talking`, so the loop that sees the release also sees the cancel.
        self.discard.store(!down && cancel, Ordering::SeqCst);
        self.talking.store(down, Ordering::SeqCst);
    }

    /// Markdown dictation: while `down`, everything heard is kept for the editor and the
    /// assistant hears nothing, whatever the activation mode. Release sends it to Whisper.
    pub fn set_dictating(&self, down: bool) {
        self.dictating.store(down, Ordering::SeqCst);
    }

    pub fn set_exit_after_dictation(&self, exit: bool) {
        self.exit_after_dictation.store(exit, Ordering::SeqCst);
    }

    /// Stops listening and waits until the microphone is released.
    pub fn stop(&self) {
        let worker = self.worker.lock().unwrap().take();
        if let Some(worker) = worker {
            worker.stop.store(true, Ordering::Relaxed);
            let _ = worker.thread.join();
        }
    }
}

/// Keeps the shared status and the UI in sync.
struct Reporter {
    app: AppHandle,
    status: Arc<Mutex<VoiceStatus>>,
}

impl Reporter {
    fn state(&self) -> VoiceState {
        self.status.lock().unwrap().state
    }

    fn set(&self, state: VoiceState, message: Option<String>) {
        let status = VoiceStatus { state, message };
        *self.status.lock().unwrap() = status.clone();
        let _ = self.app.emit(EVENT_STATE, status);
    }

    fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        let _ = self.app.emit(event, payload);
    }
}

fn resting_state(activation: Activation) -> VoiceState {
    match activation {
        Activation::WakeWord => VoiceState::Standby,
        Activation::Always => VoiceState::Listening,
        Activation::PushToTalk => VoiceState::Ready,
    }
}

/// The held buttons (Voice, and the Markdown microphone), shared with the UI commands.
struct Buttons {
    talking: Arc<AtomicBool>,
    discard: Arc<AtomicBool>,
    dictating: Arc<AtomicBool>,
    exit_after_dictation: Arc<AtomicBool>,
}

/// Audio kept while a button is held, and who gets it on release.
enum Recording {
    /// Voice button: Whisper, then the keyword decision.
    Command(Vec<f32>),
    /// Markdown microphone: Whisper, then the editor.
    Dictation(Vec<f32>),
}

/// An open microphone and its resampler to 16 kHz.
struct Mic {
    capture: audio::Capture,
    resampler: Resampler,
}

impl Mic {
    fn open(sender: &mpsc::Sender<Vec<f32>>, device_lost: &Arc<AtomicBool>) -> Result<Self, String> {
        device_lost.store(false, Ordering::Relaxed);
        let capture = audio::open(sender.clone(), device_lost.clone())?;
        let resampler = Resampler::new(capture.sample_rate);
        Ok(Self { capture, resampler })
    }

    /// Closes the stream and returns the audio it had already captured (16 kHz).
    fn close(self, receiver: &mpsc::Receiver<Vec<f32>>) -> Vec<f32> {
        let Self { capture, mut resampler } = self;
        drop(capture);
        let mut samples = Vec::new();
        while let Ok(chunk) = receiver.try_recv() {
            resampler.process(&chunk, &mut samples);
        }
        samples
    }
}

fn extend_capped(recording: &mut Vec<f32>, samples: &[f32]) {
    let room = MAX_PUSH_SAMPLES.saturating_sub(recording.len());
    recording.extend_from_slice(&samples[..samples.len().min(room)]);
}

/// The muted-microphone warning, when a held recording came back as pure digital silence.
fn muted_message(silent_mic: bool, heard_sound: bool, recording: &[f32]) -> Option<String> {
    (silent_mic || (!heard_sound && recording.len() >= MIN_PUSH_SAMPLES)).then(|| SILENT_MIC_MESSAGE.to_string())
}

fn run(
    reporter: Reporter,
    settings: Arc<RwLock<Settings>>,
    model: PathBuf,
    buttons: Buttons,
    stop: Arc<AtomicBool>,
) {
    let mut transcriber = match Transcriber::load(&model) {
        Ok(transcriber) => transcriber,
        Err(error) => return reporter.set(VoiceState::Error, Some(error)),
    };

    let (sender, receiver) = mpsc::channel();
    let device_lost = Arc::new(AtomicBool::new(false));
    let mut mic: Option<Mic> = None;
    // What is recorded while a button is held.
    let mut held: Option<Recording> = None;
    let mut vad = Vad::default();
    let mut session = Session::default();
    let mut activation = settings.read().unwrap().activation;
    let mut samples = Vec::new();
    let mut last_sound = Instant::now();
    let mut heard_sound = false;
    let mut silent_mic = false;
    reporter.set(resting_state(activation), None);

    while !stop.load(Ordering::Relaxed) {
        let dictating = buttons.dictating.load(Ordering::SeqCst);
        let in_dictation = matches!(held, Some(Recording::Dictation(_)));
        // Started only to dictate, and the button was released before the model finished loading.
        if !dictating && !in_dictation && buttons.exit_after_dictation.swap(false, Ordering::SeqCst) {
            break;
        }
        // The listening modes keep the microphone open; push-to-talk and dictation only while held.
        let push = activation == Activation::PushToTalk;
        let want_open = dictating || !push || buttons.talking.load(Ordering::SeqCst);

        if want_open && mic.is_none() {
            match Mic::open(&sender, &device_lost) {
                Ok(opened) => mic = Some(opened),
                Err(error) => return reporter.set(VoiceState::Error, Some(error)),
            }
            last_sound = Instant::now();
            heard_sound = false;
            silent_mic = false;
            if dictating {
                held = Some(Recording::Dictation(Vec::new()));
                session = Session::default();
                reporter.set(VoiceState::Dictating, None);
            } else if push {
                held = Some(Recording::Command(Vec::new()));
                reporter.set(VoiceState::Talking, None);
            }
        } else if dictating && !in_dictation {
            // The Markdown microphone takes over an open microphone: the assistant stops hearing.
            held = Some(Recording::Dictation(Vec::new()));
            vad = Vad::default();
            session = Session::default();
            reporter.set(VoiceState::Dictating, None);
        } else if !want_open && let Some(open) = mic.take() {
            // Released: stop listening right away, then act on what was said.
            let tail = open.close(&receiver);
            let discard = buttons.discard.swap(false, Ordering::SeqCst);
            match held.take() {
                Some(Recording::Dictation(mut recording)) => {
                    extend_capped(&mut recording, &tail);
                    reporter.set(resting_state(activation), muted_message(silent_mic, heard_sound, &recording));
                    dictate(&reporter, &settings, &mut transcriber, &recording);
                    if buttons.exit_after_dictation.swap(false, Ordering::SeqCst) {
                        break;
                    }
                }
                // Cancelled: the recording never reaches Whisper.
                Some(Recording::Command(_)) if discard => reporter.set(VoiceState::Ready, None),
                Some(Recording::Command(mut recording)) => {
                    extend_capped(&mut recording, &tail);
                    reporter.set(VoiceState::Ready, muted_message(silent_mic, heard_sound, &recording));
                    if vad::contains_speech(&recording) {
                        handle_utterance(&reporter, &settings, &mut transcriber, &mut session, &recording);
                    }
                }
                None => {}
            }
        } else if !dictating && in_dictation {
            // Dictation over while the microphone stays open (listening modes): back to the assistant.
            if let Some(Recording::Dictation(recording)) = held.take() {
                reporter.set(resting_state(activation), silent_mic.then(|| SILENT_MIC_MESSAGE.to_string()));
                dictate(&reporter, &settings, &mut transcriber, &recording);
            }
            vad = Vad::default();
            if buttons.exit_after_dictation.swap(false, Ordering::SeqCst) {
                break;
            }
        }

        match receiver.recv_timeout(POLL) {
            Ok(chunk) => {
                if let Some(open) = mic.as_mut() {
                    if chunk.iter().any(|sample| sample.abs() > 1e-5) {
                        last_sound = Instant::now();
                        heard_sound = true;
                        if silent_mic {
                            silent_mic = false;
                            reporter.set(reporter.state(), None);
                        }
                    }
                    samples.clear();
                    open.resampler.process(&chunk, &mut samples);
                    match held.as_mut() {
                        Some(Recording::Command(recording) | Recording::Dictation(recording)) => extend_capped(recording, &samples),
                        None => {
                            for utterance in vad.push(&samples) {
                                if stop.load(Ordering::Relaxed) {
                                    break;
                                }
                                handle_utterance(&reporter, &settings, &mut transcriber, &mut session, &utterance);
                            }
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        if device_lost.load(Ordering::Relaxed) {
            return reporter.set(VoiceState::Error, Some("O microfone parou de responder".into()));
        }
        if mic.is_some() && !silent_mic && last_sound.elapsed() >= SILENT_MIC_AFTER {
            silent_mic = true;
            reporter.set(reporter.state(), Some(SILENT_MIC_MESSAGE.into()));
        }

        // The mode can change from the settings while listening; a dictation in progress is kept.
        let current = settings.read().unwrap().activation;
        let expired = session.expire(Instant::now());
        let message = silent_mic.then(|| SILENT_MIC_MESSAGE.to_string());
        let in_dictation = matches!(held, Some(Recording::Dictation(_)));
        if current != activation {
            activation = current;
            session = Session::default();
            if !in_dictation {
                held = None;
                reporter.set(resting_state(activation), message);
            }
        } else if expired && !in_dictation {
            reporter.set(resting_state(activation), message);
        }
    }

    drop(mic);
    reporter.set(VoiceState::Off, None);
}

/// Punctuated sample text, so Whisper punctuates the dictation; no keywords here.
fn dictation_prompt(language: &str) -> &'static str {
    if language == "en" {
        "Hello, how are you? Yes, thank you. First, second and third."
    } else {
        "Olá, tudo bem? Sim, obrigado. Primeiro, segundo e terceiro."
    }
}

/// Markdown dictation: Whisper only — no wake word, no keywords, nothing launched.
fn dictate(reporter: &Reporter, settings: &RwLock<Settings>, transcriber: &mut Transcriber, recording: &[f32]) {
    if !vad::contains_speech(recording) {
        return;
    }
    let language = settings.read().unwrap().language.clone();
    reporter.emit(EVENT_DICTATION, DictationEvent { text: String::new(), pending: true });
    let text = match transcriber.transcribe(recording, &language, dictation_prompt(&language)) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("[jarvis] {error}");
            String::new()
        }
    };
    reporter.emit(EVENT_DICTATION, DictationEvent { text, pending: false });
}

fn handle_utterance(
    reporter: &Reporter,
    settings: &RwLock<Settings>,
    transcriber: &mut Transcriber,
    session: &mut Session,
    utterance: &[f32],
) {
    let (activation, language, apps, commands) = {
        let settings = settings.read().unwrap();
        (settings.activation, settings.language.clone(), settings.apps.clone(), settings.voice_commands.clone())
    };
    let prompt = build_prompt(command_vocabulary(&apps, &commands));

    let started = Instant::now();
    // The UI shows that a phrase was heard while Whisper works on it.
    reporter.emit(EVENT_TRANSCRIBING, true);
    let result = transcriber.transcribe(utterance, &language, &prompt);
    reporter.emit(EVENT_TRANSCRIBING, false);
    let text = match result {
        Ok(text) => text,
        Err(error) => {
            eprintln!("[jarvis] {error}");
            return;
        }
    };
    if text.is_empty() {
        return;
    }
    reporter.emit(EVENT_TRANSCRIPT, TranscriptEvent { text: text.clone(), millis: started.elapsed().as_millis() });

    match session.decide(&text, activation, &apps, &commands, Instant::now()) {
        Decision::Ignore => {}
        Decision::Wake => {
            reporter.emit(EVENT_WAKE, ());
            reporter.set(VoiceState::Awake, None);
        }
        Decision::Launch { app_id } => {
            let Some(app) = apps.iter().find(|app| app.id == app_id) else { return };
            let error = launcher::launch(&app.command).err();
            reporter.emit(EVENT_COMMAND, CommandEvent { app_id: app.id.clone(), name: app.name.clone(), error });
            reporter.set(resting_state(activation), None);
        }
        // The windows live in the UI, which does the opening and closing.
        Decision::Window { kind, open } => {
            reporter.emit(EVENT_WINDOW, WindowEvent { kind, open });
            reporter.set(resting_state(activation), None);
        }
        Decision::CloseGroup { group } => {
            reporter.emit(EVENT_WINDOWS, WindowsEvent { group });
            reporter.set(resting_state(activation), None);
        }
        // The player lives in the UI too (and knows the user's playlists).
        Decision::Music { action, target } => {
            reporter.emit(EVENT_MUSIC, MusicEvent { action, target });
            reporter.set(resting_state(activation), None);
        }
        Decision::Pomodoro { action } => {
            reporter.emit(EVENT_POMODORO, PomodoroEvent { action });
            reporter.set(resting_state(activation), None);
        }
        Decision::CannotClose { app_id } => {
            let Some(app) = apps.iter().find(|app| app.id == app_id) else { return };
            let error = Some(CANNOT_CLOSE.to_string());
            reporter.emit(EVENT_COMMAND, CommandEvent { app_id: app.id.clone(), name: app.name.clone(), error });
            reporter.set(resting_state(activation), None);
        }
    }
}

#[cfg(test)]
mod speech_tests {
    //! End to end with real speech (Windows TTS fixtures) and the real Whisper model:
    //! VAD → Whisper → wake word / keyword decision. Downloads the default model on first run
    //! (Large V3 Turbo, ~575 MB, into the app's model folder): `cargo test -- --ignored speech`.

    use super::*;
    use crate::models;
    use crate::settings::default_apps;

    fn fixture(name: &str) -> Vec<f32> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(format!("{name}.wav"));
        let bytes = std::fs::read(&path).unwrap();
        // Walk the RIFF chunks to the PCM data (16-bit mono, 16 kHz).
        let mut offset = 12;
        loop {
            let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            if &bytes[offset..offset + 4] == b"data" {
                return bytes[offset + 8..offset + 8 + size]
                    .chunks_exact(2)
                    .map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0)
                    .collect();
            }
            offset += 8 + size + (size & 1);
        }
    }

    fn model_path() -> PathBuf {
        let dir = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("dev.jarvis.os/models");
        let model = models::find(&Settings::default().model).unwrap();
        if !models::is_downloaded(&dir, model) {
            models::download(model, &dir, |_, _| {}).unwrap();
        }
        models::path(&dir, model)
    }

    /// Utterances separated by a second of silence, decided one second apart.
    fn run(names: &[&str], activation: Activation) -> Vec<Decision> {
        let mut transcriber = Transcriber::load(&model_path()).unwrap();
        let apps = default_apps();
        let commands = crate::settings::default_voice_commands();
        let prompt = build_prompt(command_vocabulary(&apps, &commands));
        let mut vad = Vad::default();
        let mut session = Session::default();

        let mut audio = vec![0.0; vad::SAMPLE_RATE / 2];
        for name in names {
            audio.extend(fixture(name));
            audio.extend(vec![0.0; vad::SAMPLE_RATE]);
        }

        let start = Instant::now();
        let mut decisions = Vec::new();
        for chunk in audio.chunks(480) {
            for utterance in vad.push(chunk) {
                let began = Instant::now();
                let text = transcriber.transcribe(&utterance, "pt", &prompt).unwrap();
                let at = start + Duration::from_secs(decisions.len() as u64);
                let decision = session.decide(&text, activation, &apps, &commands, at);
                println!(
                    "{:>5} ms for {:.1} s of audio  {text:?} → {decision:?}",
                    began.elapsed().as_millis(),
                    utterance.len() as f32 / vad::SAMPLE_RATE as f32
                );
                decisions.push(decision);
            }
        }
        decisions
    }

    fn launch(id: &str) -> Decision {
        Decision::Launch { app_id: id.into() }
    }

    #[test]
    #[ignore = "needs the Whisper model (downloads ~575 MB on first run)"]
    fn speech_wake_word_mode() {
        let decisions = run(&["unrelated", "wake_command", "wake_only", "command_vscode", "claude"], Activation::WakeWord);
        assert_eq!(decisions, vec![Decision::Ignore, launch("browser"), Decision::Wake, launch("vscode"), launch("claude")]);
    }

    #[test]
    #[ignore = "needs the Whisper model (downloads ~575 MB on first run)"]
    fn speech_window_commands() {
        // The Windows TTS voice garbles "relógio" and "pomodoro" for Whisper; "bateria" survives.
        let window = |kind: &str, open: bool| Decision::Window { kind: kind.into(), open };
        let held = run(&["window_open", "window_close"], Activation::PushToTalk);
        assert_eq!(held, vec![window("battery", true), window("calculator", false)]);
        let waking = run(&["window_open", "window_close"], Activation::WakeWord);
        assert_eq!(waking, vec![Decision::Ignore, window("calculator", false)], "without the wake word nothing happens");
    }

    #[test]
    #[ignore = "needs the Whisper model (downloads ~575 MB on first run)"]
    fn speech_always_listening_mode() {
        let decisions = run(&["terminal", "unrelated", "command_vscode"], Activation::Always);
        // "terminal" opens jv_sh, the terminal inside JARVIS.
        let shell = Decision::Window { kind: "shell".into(), open: true };
        assert_eq!(decisions, vec![shell, Decision::Ignore, launch("vscode")]);
    }
}
