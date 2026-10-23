mod download;
mod files;
mod launcher;
mod models;
mod music;
mod settings;
mod terminal;
mod voice;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Emitter, Manager, State};

use settings::Settings;
use voice::{VoiceEngine, VoiceStatus};

/// The frontend reveals the window after its first rendered frame. This is only a
/// safety net in case that signal never arrives (e.g. rAF throttled while hidden).
const REVEAL_FALLBACK: Duration = Duration::from_millis(2500);

/// Error code returned when listening is requested before the selected model is downloaded.
const MODEL_MISSING: &str = "model-missing";

const EVENT_MODEL_PROGRESS: &str = "model:progress";
const EVENT_MODEL_DONE: &str = "model:done";
const EVENT_MUSIC_INSTALL_PROGRESS: &str = "music:install-progress";
const EVENT_MUSIC_INSTALL_DONE: &str = "music:install-done";
const EVENT_TERMINAL_OUTPUT: &str = "terminal:output";
const EVENT_TERMINAL_EXIT: &str = "terminal:exit";

struct AppState {
    settings: Arc<RwLock<Settings>>,
    settings_path: PathBuf,
    models_dir: PathBuf,
    voice: VoiceEngine,
    downloading: Mutex<HashSet<&'static str>>,
    /// jv_T4p3's yt-dlp (shared with blocking tasks).
    music: Arc<music::Music>,
    /// jv_sh's shells.
    terminals: Arc<terminal::Terminals>,
}

impl AppState {
    fn snapshot(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    fn persist(&self) -> Result<(), String> {
        settings::save(&self.settings_path, &self.snapshot()).map_err(|e| format!("Falha ao salvar: {e}"))
    }

    fn selected_model(&self) -> Result<PathBuf, String> {
        let id = self.settings.read().unwrap().model.clone();
        let model = models::find(&id).ok_or_else(|| MODEL_MISSING.to_string())?;
        if !models::is_downloaded(&self.models_dir, model) {
            return Err(MODEL_MISSING.into());
        }
        Ok(models::path(&self.models_dir, model))
    }

    fn start_voice(&self, app: &AppHandle) -> Result<(), String> {
        let model = self.selected_model()?;
        self.voice.start(app.clone(), self.settings.clone(), model);
        Ok(())
    }
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.snapshot()
}

/// Saves the settings edited in the UI and returns them sanitised. Listening on/off is not
/// taken from here (see `voice_start` / `voice_stop`); changing the model restarts the engine.
#[tauri::command]
async fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    let incoming = settings::sanitize(settings);
    let model_changed = {
        let mut current = state.settings.write().unwrap();
        let model_changed = current.model != incoming.model;
        *current = Settings { voice_enabled: current.voice_enabled, ..incoming };
        model_changed
    };
    state.persist()?;
    if model_changed && state.voice.is_running() {
        if let Err(error) = state.start_voice(&app) {
            state.voice.stop();
            return Err(error);
        }
    }
    Ok(state.snapshot())
}

#[tauri::command]
fn launch_app(state: State<AppState>, id: String) -> Result<(), String> {
    let command = state
        .settings
        .read()
        .unwrap()
        .apps
        .iter()
        .find(|app| app.id == id)
        .map(|app| app.command.clone())
        .ok_or_else(|| "Programa não configurado".to_string())?;
    launcher::launch(&command)
}

/// Desktop editors: the file was picked in the native dialog (dialog plugin).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    files::read(Path::new(&path))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    files::write(Path::new(&path), &contents)
}

#[tauri::command]
async fn voice_start(app: AppHandle, state: State<'_, AppState>) -> Result<VoiceStatus, String> {
    state.start_voice(&app)?;
    state.settings.write().unwrap().voice_enabled = true;
    state.persist()?;
    Ok(state.voice.status())
}

/// Push-to-talk: the microphone is open only while the button is held (`down`); a release
/// with `cancel` throws the recording away. The first press also turns listening on (loads
/// the model), like `voice_start`.
#[tauri::command]
async fn voice_push(app: AppHandle, state: State<'_, AppState>, down: bool, cancel: bool) -> Result<VoiceStatus, String> {
    state.voice.set_talking(down, cancel);
    if down && !state.voice.is_running() {
        if let Err(error) = state.start_voice(&app) {
            state.voice.set_talking(false, true);
            return Err(error);
        }
        state.settings.write().unwrap().voice_enabled = true;
        state.persist()?;
    }
    Ok(state.voice.status())
}

/// Markdown dictation: the microphone records while `down`, whatever the activation mode, and
/// the text goes to the editor, never to the assistant. An engine that is off starts just for
/// this and stops again afterwards; "listening on/off" is left alone.
#[tauri::command]
async fn voice_dictate(app: AppHandle, state: State<'_, AppState>, down: bool) -> Result<VoiceStatus, String> {
    state.voice.set_dictating(down);
    if down && !state.voice.is_running() {
        state.voice.set_exit_after_dictation(true);
        if let Err(error) = state.start_voice(&app) {
            state.voice.set_dictating(false);
            state.voice.set_exit_after_dictation(false);
            return Err(error);
        }
    }
    Ok(state.voice.status())
}

#[tauri::command]
async fn voice_stop(state: State<'_, AppState>) -> Result<VoiceStatus, String> {
    state.voice.set_talking(false, true);
    state.voice.stop();
    state.settings.write().unwrap().voice_enabled = false;
    state.persist()?;
    Ok(state.voice.status())
}

#[tauri::command]
fn voice_status(state: State<AppState>) -> VoiceStatus {
    state.voice.status()
}

#[tauri::command]
fn models_status(state: State<AppState>) -> Vec<models::ModelStatus> {
    let downloading = state.downloading.lock().unwrap();
    models::MODELS
        .iter()
        .map(|model| models::ModelStatus {
            id: model.id,
            label: model.label,
            description: model.description,
            size: model.size,
            downloaded: models::is_downloaded(&state.models_dir, model),
            downloading: downloading.contains(model.id),
        })
        .collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProgress {
    id: &'static str,
    received: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDone {
    id: &'static str,
    error: Option<String>,
}

/// Starts a background download; progress and completion arrive as events.
#[tauri::command]
fn download_model(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let model = models::find(&id).ok_or_else(|| "Modelo desconhecido".to_string())?;
    if !state.downloading.lock().unwrap().insert(model.id) {
        return Ok(());
    }
    let dir = state.models_dir.clone();
    std::thread::spawn(move || {
        let result = models::download(model, &dir, |received, total| {
            let _ = app.emit(EVENT_MODEL_PROGRESS, ModelProgress { id: model.id, received, total });
        });
        app.state::<AppState>().downloading.lock().unwrap().remove(model.id);
        let _ = app.emit(EVENT_MODEL_DONE, ModelDone { id: model.id, error: result.err() });
    });
    Ok(())
}

#[tauri::command]
async fn music_status(state: State<'_, AppState>) -> Result<music::MusicStatus, String> {
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || music.status()).await.map_err(|e| e.to_string())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallDone {
    version: Option<String>,
    error: Option<String>,
}

/// Downloads (or updates) yt-dlp in the background; progress and completion arrive as events.
#[tauri::command]
fn music_install(app: AppHandle, state: State<AppState>) {
    let music = state.music.clone();
    std::thread::spawn(move || {
        let result = music.install(|received, total| {
            let _ = app.emit(EVENT_MUSIC_INSTALL_PROGRESS, ModelProgress { id: "yt-dlp", received, total });
        });
        let done = match result {
            Ok(version) => InstallDone { version, error: None },
            Err(error) => InstallDone { version: None, error: Some(error) },
        };
        let _ = app.emit(EVENT_MUSIC_INSTALL_DONE, done);
    });
}

/// The audio-only stream of a song on YouTube: searched ("Artista - Música") or by video id
/// (a link pasted into a playlist).
#[tauri::command]
async fn music_resolve(state: State<'_, AppState>, query: Option<String>, video_id: Option<String>) -> Result<music::Resolved, String> {
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || match (video_id, query) {
        (Some(id), _) => music.resolve_video(&id),
        (None, Some(query)) => music.resolve(&query),
        (None, None) => Err("Nada para tocar".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The user's terminal profiles (Windows Terminal's, or the shells found).
#[tauri::command]
fn terminal_profiles() -> terminal::Profiles {
    terminal::profiles()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    id: u32,
    code: Option<u32>,
}

/// Starts one of the profiles (only those: the UI cannot run an arbitrary command line).
#[tauri::command]
fn terminal_open(app: AppHandle, state: State<AppState>, profile: String, cols: u16, rows: u16) -> Result<u32, String> {
    let profile = terminal::profiles().profiles.into_iter().find(|item| item.id == profile).ok_or("Perfil não encontrado")?;
    let output = app.clone();
    state.terminals.open(
        &profile,
        cols,
        rows,
        move |id, data| {
            let _ = output.emit(EVENT_TERMINAL_OUTPUT, TerminalOutput { id, data });
        },
        move |id, code| {
            let _ = app.emit(EVENT_TERMINAL_EXIT, TerminalExit { id, code });
        },
    )
}

#[tauri::command]
fn terminal_write(state: State<AppState>, id: u32, data: String) -> Result<(), String> {
    state.terminals.write(id, &data)
}

#[tauri::command]
fn terminal_resize(state: State<AppState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    state.terminals.resize(id, cols, rows)
}

#[tauri::command]
fn terminal_close(state: State<AppState>, id: u32) {
    state.terminals.close(id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // The page only calls getUserMedia after the user turns listening on, so the
        // WebView-level prompt is redundant; OS privacy settings still apply.
        .on_permission_request(|_webview, kind| match kind {
            PermissionKind::Microphone => PermissionResponse::Allow,
            // jv_sh pastes with Ctrl+V / right click, as Windows Terminal does.
            PermissionKind::ClipboardRead => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            launch_app,
            read_text_file,
            write_text_file,
            voice_start,
            voice_push,
            voice_dictate,
            voice_stop,
            voice_status,
            models_status,
            download_model,
            music_status,
            music_install,
            music_resolve,
            terminal_profiles,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
        ])
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            // Large files: local (non-roaming) app data.
            let models_dir = app.path().app_local_data_dir()?.join("models");
            let bin_dir = app.path().app_local_data_dir()?.join("bin");
            // jv_sh's own commands (jvfetch), on the PATH of every tab.
            let tools = terminal::install_tools(&app.path().app_local_data_dir()?.join("jv_sh"))
                .map(|bin| terminal::Tools { bin, settings: settings_path.clone() })
                .inspect_err(|error| eprintln!("[jarvis] jv_sh commands not installed: {error}"))
                .ok();
            let state = AppState {
                settings: Arc::new(RwLock::new(settings::load(&settings_path))),
                settings_path,
                models_dir,
                voice: VoiceEngine::default(),
                downloading: Mutex::new(HashSet::new()),
                music: Arc::new(music::Music::new(bin_dir)),
                terminals: Arc::new(terminal::Terminals::new(tools)),
            };
            // Restore listening if it was on when the app was last closed.
            if state.snapshot().voice_enabled {
                if let Err(error) = state.start_voice(app.handle()) {
                    eprintln!("[jarvis] listening not restored: {error}");
                }
            }
            app.manage(state);

            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(REVEAL_FALLBACK);
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // No shell outlives JARVIS.
            if let tauri::RunEvent::Exit = event
                && let Some(state) = app.try_state::<AppState>()
            {
                state.terminals.close_all();
            }
        });
}
