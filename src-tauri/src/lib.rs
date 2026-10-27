mod agents;
mod assistant;
mod download;
mod files;
mod git;
mod launcher;
mod mcp;
mod models;
mod music;
mod settings;
mod speech;
mod system;
mod terminal;
mod voice;
mod workspace;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Emitter, Manager, State};

use settings::Settings;
use voice::{VoiceEngine, VoiceStatus};
use workspace::paths::Root;
use workspace::text::{Encoding, Eol};
use workspace::Stamp;

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
const EVENT_WORKSPACE_CHANGED: &str = "workspace:changed";
/// A tool call from JARVIS (Claude Code) for the UI to carry out (`assistant_action_result` answers).
const EVENT_ASSISTANT_ACTION: &str = "assistant:action";
const EVENT_SPEECH_PROGRESS: &str = "speech:progress";
const EVENT_SPEECH_DONE: &str = "speech:done";

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
    /// The system meters' widgets (shared with blocking tasks).
    system: Arc<Mutex<system::Sampler>>,
    /// jv_ide's open folders (watchers) and its running search.
    workspaces: Arc<workspace::Workspaces>,
    /// The core's conversation with Claude Code.
    assistant: Arc<assistant::Assistant>,
    /// JARVIS's tool calls waiting for the UI.
    actions: Arc<mcp::Bridge>,
    /// JARVIS's voice: the loaded text-to-speech model, and where the models live.
    speaker: Arc<speech::Speaker>,
    speech_dir: PathBuf,
    speech_downloading: Mutex<HashSet<&'static str>>,
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

/// Runs `job` off the main thread (file system, git and searches can take a while).
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

/// Opens a folder in jv_ide: follows its changes (`workspace:changed`) and finds its repository.
#[tauri::command]
async fn workspace_open(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<workspace::WorkspaceInfo, String> {
    let workspaces = state.workspaces.clone();
    blocking(move || {
        workspaces.open(&path, move |changed| {
            let _ = app.emit(EVENT_WORKSPACE_CHANGED, changed);
        })
    })
    .await
}

#[tauri::command]
async fn workspace_close(state: State<'_, AppState>, root: String) -> Result<(), String> {
    state.workspaces.close(&root);
    Ok(())
}

#[tauri::command]
async fn workspace_list(root: String, path: String) -> Result<workspace::Listing, String> {
    blocking(move || workspace::list(&Root::new(&root)?, &path)).await
}

#[tauri::command]
async fn workspace_read(root: String, path: String) -> Result<workspace::FileContent, String> {
    blocking(move || workspace::read(&Root::new(&root)?, &path)).await
}

/// Saves a file in its encoding and line endings; `expected` (the stamp read) guards against
/// overwriting someone else's change ("file-changed").
#[tauri::command]
async fn workspace_write(root: String, path: String, contents: String, encoding: Encoding, eol: Eol, expected: Option<Stamp>) -> Result<Stamp, String> {
    blocking(move || workspace::write(&Root::new(&root)?, &path, &contents, encoding, eol, expected)).await
}

#[tauri::command]
async fn workspace_stat(root: String, paths: Vec<String>) -> Result<Vec<Option<Stamp>>, String> {
    blocking(move || Ok(workspace::stat(&Root::new(&root)?, &paths))).await
}

#[tauri::command]
async fn workspace_create(root: String, path: String, dir: bool) -> Result<(), String> {
    blocking(move || workspace::create(&Root::new(&root)?, &path, dir)).await
}

#[tauri::command]
async fn workspace_rename(root: String, from: String, to: String) -> Result<(), String> {
    blocking(move || workspace::rename(&Root::new(&root)?, &from, &to)).await
}

#[tauri::command]
async fn workspace_copy(root: String, from: String, to: String) -> Result<String, String> {
    blocking(move || workspace::copy(&Root::new(&root)?, &from, &to)).await
}

/// To the Recycle Bin, unless `permanent`.
#[tauri::command]
async fn workspace_delete(root: String, paths: Vec<String>, permanent: bool) -> Result<(), String> {
    blocking(move || workspace::delete(&Root::new(&root)?, &paths, permanent)).await
}

#[tauri::command]
async fn workspace_reveal(root: String, path: String) -> Result<(), String> {
    blocking(move || workspace::reveal(&Root::new(&root)?, &path)).await
}

#[tauri::command]
async fn workspace_disk(root: String) -> Result<Option<system::Disk>, String> {
    blocking(move || Ok(workspace::disk(&Root::new(&root)?))).await
}

/// Every file of the project, for quick open.
#[tauri::command]
async fn workspace_files(root: String) -> Result<workspace::search::FileList, String> {
    blocking(move || Ok(workspace::search::files(&Root::new(&root)?))).await
}

/// Starts a search across the project and returns its id; matches, then a "done", arrive on
/// `on_event`. A newer search (or `workspace_search_cancel`) stops it.
#[tauri::command]
async fn workspace_search(state: State<'_, AppState>, root: String, query: workspace::search::Query, on_event: Channel<workspace::search::SearchEvent>) -> Result<u64, String> {
    let workspaces = state.workspaces.clone();
    let prepared = blocking(move || workspace::search::prepare(&Root::new(&root)?, &query)).await?;
    let id = workspaces.search.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || workspace::search::run(prepared, id, &workspaces.search, |event| on_event.send(event).is_ok()));
    Ok(id)
}

#[tauri::command]
fn workspace_search_cancel(state: State<AppState>) {
    state.workspaces.search.fetch_add(1, Ordering::SeqCst);
}

/// The repository's state (None outside a repository).
#[tauri::command]
async fn git_status(root: String) -> Result<Option<git::GitStatus>, String> {
    blocking(move || git::git_status(&root)).await
}

#[tauri::command]
async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || git::stage(&root, &paths)).await
}

#[tauri::command]
async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || git::unstage(&root, &paths)).await
}

/// Work-tree changes thrown away (untracked files to the Recycle Bin).
#[tauri::command]
async fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || git::discard(&root, &paths)).await
}

#[tauri::command]
async fn git_stage_all(root: String) -> Result<(), String> {
    blocking(move || git::stage_all(&root)).await
}

#[tauri::command]
async fn git_unstage_all(root: String) -> Result<(), String> {
    blocking(move || git::unstage_all(&root)).await
}

#[tauri::command]
async fn git_discard_all(root: String, untracked: bool) -> Result<(), String> {
    blocking(move || git::discard_all(&root, untracked)).await
}

#[tauri::command]
async fn git_commit(root: String, message: String, amend: bool) -> Result<String, String> {
    blocking(move || git::commit(&root, &message, amend)).await
}

#[tauri::command]
async fn git_push(root: String) -> Result<String, String> {
    blocking(move || git::push(&root)).await
}

#[tauri::command]
async fn git_pull(root: String) -> Result<String, String> {
    blocking(move || git::pull(&root)).await
}

#[tauri::command]
async fn git_fetch(root: String) -> Result<String, String> {
    blocking(move || git::fetch(&root)).await
}

#[tauri::command]
async fn git_log(root: String, limit: u32, skip: u32) -> Result<Vec<git::Commit>, String> {
    blocking(move || git::log(&root, limit, skip)).await
}

#[tauri::command]
async fn git_diff(root: String, path: String, staged: bool) -> Result<git::Diff, String> {
    blocking(move || git::diff(&root, &path, staged)).await
}

/// A file as it is in "HEAD" or the "INDEX".
#[tauri::command]
async fn git_show_file(root: String, path: String, rev: String) -> Result<Option<String>, String> {
    blocking(move || git::show_file(&root, &path, &rev)).await
}

#[tauri::command]
async fn git_stash_list(root: String) -> Result<Vec<git::Stash>, String> {
    blocking(move || git::stash_list(&root)).await
}

#[tauri::command]
async fn git_stash_push(root: String, message: Option<String>, untracked: bool) -> Result<(), String> {
    blocking(move || git::stash_push(&root, message.as_deref(), untracked)).await
}

#[tauri::command]
async fn git_stash_pop(root: String, index: u32) -> Result<(), String> {
    blocking(move || git::stash_pop(&root, index)).await
}

#[tauri::command]
async fn git_stash_drop(root: String, index: u32) -> Result<(), String> {
    blocking(move || git::stash_drop(&root, index)).await
}

#[tauri::command]
async fn git_branches(root: String) -> Result<Vec<git::Branch>, String> {
    blocking(move || git::branches(&root)).await
}

#[tauri::command]
async fn git_checkout(root: String, branch: String, create: bool) -> Result<(), String> {
    blocking(move || git::checkout(&root, &branch, create)).await
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

/// The core's microphone: records while `down`, whatever the activation mode, and the text goes
/// to the conversation with Claude Code, never to the keyword commands; `cancel` throws the
/// recording away. Like dictation, an engine that is off starts just for this.
#[tauri::command]
async fn voice_ask(app: AppHandle, state: State<'_, AppState>, down: bool, cancel: bool) -> Result<VoiceStatus, String> {
    state.voice.set_asking(down, cancel);
    if down && !state.voice.is_running() {
        state.voice.set_exit_after_dictation(true);
        if let Err(error) = state.start_voice(&app) {
            state.voice.set_asking(false, true);
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

/// Asks JARVIS (Claude Code); the answer streams on `on_event` and ends with a "done".
/// `session_id` continues an earlier conversation (the UI keeps it with the history).
#[tauri::command]
async fn assistant_ask(state: State<'_, AppState>, text: String, session_id: Option<String>, on_event: Channel<assistant::AssistantEvent>) -> Result<(), String> {
    let assistant = state.assistant.clone();
    blocking(move || assistant.ask(&text, session_id, on_event)).await
}

/// Starts Claude Code while the user is still talking, so the answer comes sooner.
#[tauri::command]
async fn assistant_warm(state: State<'_, AppState>, session_id: Option<String>) -> Result<(), String> {
    let assistant = state.assistant.clone();
    blocking(move || assistant.warm(session_id)).await
}

#[tauri::command]
async fn assistant_cancel(state: State<'_, AppState>) -> Result<(), String> {
    let assistant = state.assistant.clone();
    blocking(move || {
        assistant.cancel();
        Ok(())
    })
    .await
}

/// "Nova conversa": the next question starts a new Claude Code session.
#[tauri::command]
async fn assistant_reset(state: State<'_, AppState>) -> Result<(), String> {
    let assistant = state.assistant.clone();
    blocking(move || {
        assistant.reset();
        Ok(())
    })
    .await
}

/// JARVIS's folder (notes, agent drafts), for the UI to tell which editor a file belongs to.
#[tauri::command]
fn assistant_folder(state: State<AppState>) -> assistant::Folder {
    state.assistant.folder().clone()
}

/// The agent drafts in Documentos\JARVIS\Agentes, by name.
#[tauri::command]
fn agent_drafts(state: State<AppState>) -> Vec<String> {
    agents::drafts(state.assistant.folder())
}

/// What keeps an agent draft from running (empty: ready), for jv_agent's review card.
#[tauri::command]
fn agent_problems(name: String, text: String) -> Vec<String> {
    agents::problems(&name, &text)
}

/// Installs `Agentes\<name>.md` as one of the user's Claude Code subagents.
#[tauri::command]
async fn agent_install(state: State<'_, AppState>, name: String) -> Result<String, String> {
    let assistant = state.assistant.clone();
    blocking(move || agents::install(assistant.folder(), &name).map(|path| path.display().to_string())).await
}

/// A jv_sh tab running an installed agent once: `claude --agent <name> "<task>"` in `cwd`. Only
/// that command line: the UI still cannot run an arbitrary one (see `terminal_open`).
#[tauri::command]
fn terminal_open_agent(app: AppHandle, state: State<AppState>, name: String, task: String, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    if !agents::installed(&name) {
        return Err(format!("O agente \"{name}\" não está instalado"));
    }
    let dir = PathBuf::from(cwd.trim());
    // Its own folder under Agentes is made on first run; any other has to exist.
    if dir.starts_with(&state.assistant.folder().agents) {
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    }
    let cwd = terminal::start_dir(&dir.display().to_string())?.display().to_string();
    let exe = assistant::claude_exe().ok_or("Claude Code não encontrado")?;
    let mut argv = vec![exe.display().to_string(), "--agent".to_string(), name.clone()];
    // One argument on the command line: no quotes or line breaks of its own.
    let task = task.replace(['"', '\r', '\n'], " ").trim().to_string();
    if !task.is_empty() {
        argv.push(task);
    }
    let profile = terminal::Profile { id: format!("agent:{name}"), name: format!("Agente {name}"), commandline: terminal::join_commandline(&argv), cwd };
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

/// The UI's answer to a tool call (`assistant:action`).
#[tauri::command]
fn assistant_action_result(state: State<AppState>, id: u64, ok: bool, text: String) {
    state.actions.resolve(id, if ok { Ok(text) } else { Err(text) });
}

/// JARVIS's tools: opening a site happens here, everything else in the UI, which owns the desktop.
fn run_tool(app: &AppHandle, actions: &mcp::Bridge, tool: &str, args: serde_json::Value) -> mcp::ToolResult {
    if tool == "open_url" {
        let url = args["url"].as_str().unwrap_or_default().trim();
        if !(url.starts_with("https://") || url.starts_with("http://")) || url.chars().any(char::is_whitespace) {
            return Err("Só abro endereços http ou https".into());
        }
        return launcher::launch(url).map(|()| format!("Aberto {url}"));
    }
    actions.call(tool, args, |request| app.emit(EVENT_ASSISTANT_ACTION, request).is_ok())
}

/// Starts JARVIS's MCP server and writes the `--mcp-config` file Claude Code is given.
fn start_mcp(app: &AppHandle, actions: Arc<mcp::Bridge>, config: &Path) -> Result<PathBuf, String> {
    let handle = app.clone();
    let server = mcp::start(move |tool, args| run_tool(&handle, &actions, tool, args))?;
    if let Some(dir) = config.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    std::fs::write(config, server.config().to_string()).map_err(|error| error.to_string())?;
    Ok(config.to_path_buf())
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

/// JARVIS's voices: the models (downloaded or not) and the voices they offer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechStatus {
    models: Vec<speech::ModelStatus>,
    voices: &'static [speech::Voice],
}

#[tauri::command]
fn speech_status(state: State<AppState>) -> SpeechStatus {
    let downloading = state.speech_downloading.lock().unwrap();
    let models = speech::MODELS
        .iter()
        .map(|model| speech::ModelStatus {
            id: model.id,
            label: model.label,
            description: model.description,
            size: model.size,
            downloaded: speech::is_downloaded(&state.speech_dir, model),
            downloading: downloading.contains(model.id),
        })
        .collect();
    SpeechStatus { models, voices: speech::VOICES }
}

/// Downloads a voice model in the background (`speech:progress`, then `speech:done`).
#[tauri::command]
fn speech_download(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let model = speech::find_model(&id).ok_or("Voz desconhecida")?;
    if !state.speech_downloading.lock().unwrap().insert(model.id) {
        return Ok(());
    }
    let dir = state.speech_dir.clone();
    std::thread::spawn(move || {
        let result = speech::download(model, &dir, |received, total| {
            let _ = app.emit(EVENT_SPEECH_PROGRESS, ModelProgress { id: model.id, received, total });
        });
        app.state::<AppState>().speech_downloading.lock().unwrap().remove(model.id);
        let _ = app.emit(EVENT_SPEECH_DONE, ModelDone { id: model.id, error: result.err() });
    });
    Ok(())
}

/// `text` in JARVIS's voice, as a WAV file (the UI plays it and follows its length).
#[tauri::command]
async fn speech_synthesize(state: State<'_, AppState>, text: String, voice: String, speed: f32) -> Result<tauri::ipc::Response, String> {
    let (speaker, dir) = (state.speaker.clone(), state.speech_dir.clone());
    blocking(move || speaker.synthesize(&dir, &voice, &text, speed)).await.map(tauri::ipc::Response::new)
}

/// While JARVIS speaks, the listening modes do not take his words for commands.
#[tauri::command]
fn voice_deafen(state: State<AppState>, on: bool) {
    state.voice.set_deaf(on);
}

/// The system meters (CPU, GPU, RAM, virtual memory, disks, Wi-Fi), read now; rates cover the
/// time since the previous call.
#[tauri::command]
async fn system_stats(state: State<'_, AppState>) -> Result<system::SystemStats, String> {
    let sampler = state.system.clone();
    tauri::async_runtime::spawn_blocking(move || sampler.lock().unwrap().read()).await.map_err(|e| e.to_string())
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

/// Starts one of the profiles (only those: the UI cannot run an arbitrary command line), in
/// `cwd` when given (jv_ide's terminals open in the project).
#[tauri::command]
fn terminal_open(app: AppHandle, state: State<AppState>, profile: String, cols: u16, rows: u16, cwd: Option<String>) -> Result<u32, String> {
    let mut profile = terminal::profiles().profiles.into_iter().find(|item| item.id == profile).ok_or("Perfil não encontrado")?;
    if let Some(cwd) = cwd.filter(|cwd| !cwd.trim().is_empty()) {
        profile = terminal::in_dir(profile, &terminal::start_dir(&cwd)?);
    }
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
            voice_ask,
            voice_stop,
            voice_status,
            assistant_ask,
            assistant_warm,
            assistant_cancel,
            assistant_reset,
            assistant_folder,
            assistant_action_result,
            speech_status,
            speech_download,
            speech_synthesize,
            voice_deafen,
            agent_drafts,
            agent_problems,
            agent_install,
            terminal_open_agent,
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
            system_stats,
            workspace_open,
            workspace_close,
            workspace_list,
            workspace_read,
            workspace_write,
            workspace_stat,
            workspace_create,
            workspace_rename,
            workspace_copy,
            workspace_delete,
            workspace_reveal,
            workspace_disk,
            workspace_files,
            workspace_search,
            workspace_search_cancel,
            git_status,
            git_stage,
            git_unstage,
            git_discard,
            git_stage_all,
            git_unstage_all,
            git_discard_all,
            git_commit,
            git_push,
            git_pull,
            git_fetch,
            git_log,
            git_diff,
            git_show_file,
            git_stash_list,
            git_stash_push,
            git_stash_pop,
            git_stash_drop,
            git_branches,
            git_checkout,
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
            // JARVIS (Claude Code) works in Documentos\JARVIS and acts on the jvOS through its MCP server.
            let jarvis_folder = app.path().document_dir().or_else(|_| app.path().home_dir())?.join("JARVIS");
            let actions = Arc::new(mcp::Bridge::default());
            let mcp_config = start_mcp(app.handle(), actions.clone(), &app.path().app_local_data_dir()?.join("assistant").join("mcp.json"))
                .inspect_err(|error| eprintln!("[jarvis] JARVIS's tools unavailable: {error}"))
                .ok();
            let state = AppState {
                settings: Arc::new(RwLock::new(settings::load(&settings_path))),
                settings_path,
                models_dir,
                voice: VoiceEngine::default(),
                downloading: Mutex::new(HashSet::new()),
                music: Arc::new(music::Music::new(bin_dir)),
                terminals: Arc::new(terminal::Terminals::new(tools)),
                system: Arc::new(Mutex::new(system::Sampler::default())),
                workspaces: Arc::new(workspace::Workspaces::default()),
                assistant: Arc::new(assistant::Assistant::new(assistant::Folder::new(jarvis_folder), mcp_config)),
                actions,
                speaker: Arc::new(speech::Speaker::default()),
                speech_dir: app.path().app_local_data_dir()?.join("tts"),
                speech_downloading: Mutex::new(HashSet::new()),
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
            // No shell, watcher, search or Claude Code outlives JARVIS.
            if let tauri::RunEvent::Exit = event
                && let Some(state) = app.try_state::<AppState>()
            {
                state.terminals.close_all();
                state.workspaces.close_all();
                state.assistant.close();
            }
        });
}
