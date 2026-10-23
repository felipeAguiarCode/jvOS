//! User settings, persisted as JSON in the app config directory.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// How the assistant reacts to speech.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Activation {
    /// "Hey Jarvis" first, then a keyword (or both in one sentence).
    WakeWord,
    /// Any utterance containing a keyword triggers its app.
    Always,
    /// The microphone is open only while the Voice button (or M) is held; on release, what was
    /// said is transcribed and any keyword triggers its app.
    PushToTalk,
}

/// A program the voice keywords (and the dock) can launch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub keywords: Vec<String>,
    /// Command line: an executable (on PATH or a path, quoted if it has spaces) plus arguments, or a URL.
    pub command: String,
    /// Dock apps: always present, cannot be removed or renamed.
    #[serde(default)]
    pub builtin: bool,
}

/// A spoken interaction: the phrases that open or close a window or a group, run a music or
/// Pomodoro action, the verbs that say "open", "close" and "play", or one the user added.
/// The built-in ones come from `voice-commands.json` (shared with the UI); their phrases can be
/// edited but not their action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCommand {
    pub id: String,
    /// "window", "group", "music", "pomodoro", "playlist" (user's: plays the playlist named in
    /// `target`), "verbs" or "playVerbs".
    pub kind: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub label: String,
    pub phrases: Vec<String>,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Whether listening was on when the app last ran (restored at startup).
    pub voice_enabled: bool,
    pub activation: Activation,
    /// Whisper model id (see `models::MODELS`).
    pub model: String,
    /// "pt", "en" or "auto".
    pub language: String,
    /// Color of the hologram and the interface: "blue", "green", "yellow" or "custom" (UI only).
    pub theme: String,
    /// OKLCH hue, 0..360, of the "custom" theme (UI only).
    pub accent_hue: f32,
    /// Backdrop behind the hologram: "solid", "grid" or "matrix" (UI only).
    pub background: String,
    /// Waybar-style bar along the top of the screen, on by default (UI only).
    pub taskbar: bool,
    pub apps: Vec<AppEntry>,
    /// Everything the voice understands besides the programs' keywords (Menu avançado → Voz).
    pub voice_commands: Vec<VoiceCommand>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            voice_enabled: false,
            activation: Activation::PushToTalk,
            model: "large-v3-turbo".into(),
            language: "pt".into(),
            theme: "blue".into(),
            accent_hue: DEFAULT_HUE,
            background: "solid".into(),
            taskbar: true,
            apps: default_apps(),
            voice_commands: default_voice_commands(),
        }
    }
}

const MAX_KEYWORDS: usize = 12;
const MAX_PHRASES: usize = 30;
const MAX_PHRASE: usize = 60;
const MAX_LABEL: usize = 60;
const MAX_CUSTOM_COMMANDS: usize = 100;
/// Mirrors `WindowKind` in src/lib/desktop.ts.
const WINDOW_KINDS: [&str; 10] = ["clock", "pomodoro", "battery", "calculator", "tape", "miniplayer", "markdown", "code", "music", "shell"];
/// What the Windows Terminal program answered to before jv_sh took those words.
const OLD_TERMINAL_KEYWORDS: [&str; 3] = ["terminal", "console", "prompt de comando"];
const GROUP_TARGETS: [&str; 3] = ["widgets", "apps", "all"];
const MUSIC_TARGETS: [&str; 6] = ["resume", "pause", "next", "previous", "nextPlaylist", "previousPlaylist"];
const POMODORO_TARGETS: [&str; 6] = ["start", "pause", "reset", "skip", "longer", "shorter"];
const DEFAULT_VOICE_COMMANDS: &str = include_str!("../voice-commands.json");

/// The built-in voice commands (`voice-commands.json`, also read by the UI).
pub fn default_voice_commands() -> Vec<VoiceCommand> {
    let mut commands: Vec<VoiceCommand> = serde_json::from_str(DEFAULT_VOICE_COMMANDS).expect("voice-commands.json is valid");
    commands.iter_mut().for_each(|command| command.builtin = true);
    commands
}

/// What a command the user adds may do (the verbs stay built-in).
fn valid_custom(kind: &str, target: &str) -> bool {
    match kind {
        "window" => WINDOW_KINDS.contains(&target),
        "group" => GROUP_TARGETS.contains(&target),
        "music" => MUSIC_TARGETS.contains(&target),
        "pomodoro" => POMODORO_TARGETS.contains(&target),
        "playlist" => !target.is_empty(),
        _ => false,
    }
}

fn clip_to(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

/// Built-in commands keep their action (only their phrases change) and come back if missing;
/// the user's must do something valid. Phrases are trimmed, without duplicates.
fn sanitize_voice_commands(commands: Vec<VoiceCommand>) -> Vec<VoiceCommand> {
    let defaults = default_voice_commands();
    let mut seen = HashSet::new();
    let mut custom = 0;
    let mut out = Vec::new();
    for mut command in commands {
        command.id = clip_to(&command.id, MAX_LABEL);
        if command.id.is_empty() || !seen.insert(command.id.clone()) {
            continue;
        }
        match defaults.iter().find(|default| default.id == command.id) {
            Some(default) => {
                command.kind = default.kind.clone();
                command.target = default.target.clone();
                command.label = default.label.clone();
                command.builtin = true;
            }
            None => {
                command.target = clip_to(&command.target, 40);
                if !command.id.starts_with("custom-") || !valid_custom(&command.kind, &command.target) || custom >= MAX_CUSTOM_COMMANDS {
                    continue;
                }
                custom += 1;
                command.label = clip_to(&command.label, MAX_LABEL);
                command.builtin = false;
            }
        }
        let mut unique = HashSet::new();
        command.phrases = command
            .phrases
            .iter()
            .map(|phrase| clip_to(phrase, MAX_PHRASE))
            .filter(|phrase| !phrase.is_empty() && unique.insert(phrase.to_lowercase()))
            .take(MAX_PHRASES)
            .collect();
        out.push(command);
    }
    for (index, default) in defaults.into_iter().enumerate() {
        if !out.iter().any(|command| command.id == default.id) {
            out.insert(index.min(out.len()), default);
        }
    }
    out
}
const MAX_TEXT: usize = 300;
const LANGUAGES: [&str; 3] = ["pt", "en", "auto"];
/// Mirrors `Theme` in src/lib/theme.ts.
const THEMES: [&str; 4] = ["blue", "green", "yellow", "custom"];
/// Hue of the blue accent. Mirrors `DEFAULT_HUE` in src/lib/theme.ts.
const DEFAULT_HUE: f32 = 224.0;
/// Mirrors `Background` in src/lib/settings.ts.
const BACKGROUNDS: [&str; 3] = ["solid", "grid", "matrix"];

fn app(id: &str, name: &str, keywords: &[&str], command: String) -> AppEntry {
    AppEntry {
        id: id.into(),
        name: name.into(),
        keywords: keywords.iter().map(|k| k.to_string()).collect(),
        command,
        builtin: true,
    }
}

/// The dock programs, with commands that work on a standard Windows setup.
pub fn default_apps() -> Vec<AppEntry> {
    vec![
        app("browser", "Browser", &["navegador", "browser", "internet"], "https://www.google.com".into()),
        app("vscode", "VS Code", &["vs code", "visual studio code", "editor de código"], vscode_command()),
        // "terminal" itself now opens jv_sh, the terminal inside JARVIS.
        app("terminal", "Windows Terminal", &["windows terminal"], "wt".into()),
        app("claude", "Claude Code", &["claude code", "claude", "cloud code"], "wt claude".into()),
    ]
}

/// Prefer VS Code's GUI executable: the `code` shim on PATH is a .cmd that flashes a console.
fn vscode_command() -> String {
    let candidates = [
        std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("Programs/Microsoft VS Code/Code.exe")),
        std::env::var_os("ProgramFiles").map(|dir| PathBuf::from(dir).join("Microsoft VS Code/Code.exe")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.exists())
        .map(|path| format!("\"{}\"", path.display()))
        .unwrap_or_else(|| "code".into())
}

fn clip(text: &str) -> String {
    text.trim().chars().take(MAX_TEXT).collect()
}

/// Cleans settings coming from the UI or from disk: trims text, drops empty and duplicate
/// keywords, guarantees the dock apps exist and every id is unique.
pub fn sanitize(mut settings: Settings) -> Settings {
    if !LANGUAGES.contains(&settings.language.as_str()) {
        settings.language = "pt".into();
    }
    if !THEMES.contains(&settings.theme.as_str()) {
        settings.theme = Settings::default().theme;
    }
    settings.accent_hue = if settings.accent_hue.is_finite() { settings.accent_hue.rem_euclid(360.0) } else { DEFAULT_HUE };
    if !BACKGROUNDS.contains(&settings.background.as_str()) {
        settings.background = Settings::default().background;
    }
    if crate::models::find(&settings.model).is_none() {
        settings.model = Settings::default().model;
    }

    let defaults = default_apps();
    let mut seen = HashSet::new();
    let mut apps = Vec::new();

    for mut entry in settings.apps {
        entry.id = clip(&entry.id);
        if entry.id.is_empty() || !seen.insert(entry.id.clone()) {
            continue;
        }
        let builtin = defaults.iter().find(|d| d.id == entry.id);
        entry.builtin = builtin.is_some();
        // Untouched old keywords of the Windows Terminal program give way to jv_sh's.
        if let Some(default) = builtin.filter(|default| default.id == "terminal")
            && entry.keywords.iter().map(|keyword| keyword.trim().to_lowercase()).eq(OLD_TERMINAL_KEYWORDS)
        {
            entry.keywords = default.keywords.clone();
        }
        entry.name = match builtin {
            Some(default) => default.name.clone(),
            None => clip(&entry.name),
        };
        entry.command = clip(&entry.command);

        let mut unique = HashSet::new();
        entry.keywords = entry
            .keywords
            .iter()
            .map(|keyword| clip(keyword))
            .filter(|keyword| !keyword.is_empty() && unique.insert(keyword.to_lowercase()))
            .take(MAX_KEYWORDS)
            .collect();

        if entry.name.is_empty() && !entry.builtin {
            entry.name = "Programa".into();
        }
        apps.push(entry);
    }

    // Dock apps are always present, at the top, in dock order.
    for (index, default) in defaults.into_iter().enumerate() {
        if !apps.iter().any(|entry| entry.id == default.id) {
            apps.insert(index.min(apps.len()), default);
        }
    }

    settings.apps = apps;
    settings.voice_commands = sanitize_voice_commands(settings.voice_commands);
    settings
}

pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str::<Settings>(&json).ok())
        .map(sanitize)
        .unwrap_or_default()
}

/// Writes atomically (temp file + rename) so a crash never leaves a truncated file.
pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json)?;
    fs::rename(temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_commands_keep_their_actions_and_take_the_users() {
        let json = r#"{ "voiceCommands": [
            { "id": "music:next", "kind": "group", "target": "all", "label": "x", "phrases": ["  pula  ", "PULA", "", "próxima música"] },
            { "id": "custom-1", "kind": "playlist", "target": " Treino pesado ", "label": "Hora de treinar", "phrases": ["hora de treinar"] },
            { "id": "custom-2", "kind": "pomodoro", "target": "start", "phrases": ["bora focar"] },
            { "id": "custom-3", "kind": "verbs", "target": "open", "phrases": ["liga"] },
            { "id": "custom-4", "kind": "window", "target": "spaceship", "phrases": ["nave"] },
            { "id": "sneaky", "kind": "music", "target": "next", "phrases": ["x"] },
            { "id": "custom-2", "kind": "music", "target": "next", "phrases": ["duplicate"] }
        ] }"#;
        let settings = sanitize(serde_json::from_str(json).unwrap());
        let commands = &settings.voice_commands;
        let defaults = default_voice_commands();
        // Every built-in is there, in catalog order, followed by the user's valid ones.
        assert_eq!(commands.len(), defaults.len() + 2);
        let next = commands.iter().find(|command| command.id == "music:next").unwrap();
        assert_eq!((next.kind.as_str(), next.target.as_str(), next.builtin), ("music", "next", true));
        assert_eq!(next.label, "Próxima música");
        assert_eq!(next.phrases, vec!["pula", "próxima música"]);
        let custom: Vec<_> = commands.iter().filter(|command| !command.builtin).collect();
        assert_eq!(custom.len(), 2);
        assert_eq!((custom[0].target.as_str(), custom[0].phrases[0].as_str()), ("Treino pesado", "hora de treinar"));
        assert_eq!((custom[1].kind.as_str(), custom[1].target.as_str()), ("pomodoro", "start"));
        // A built-in left without phrases stays (that command is simply off).
        let silent = sanitize(serde_json::from_str(r#"{ "voiceCommands": [{ "id": "music:pause", "kind": "music", "target": "pause", "phrases": [] }] }"#).unwrap());
        assert!(silent.voice_commands.iter().any(|command| command.id == "music:pause" && command.phrases.is_empty()));
    }

    #[test]
    fn default_voice_commands_are_valid() {
        let commands = default_voice_commands();
        let mut ids = HashSet::new();
        for command in &commands {
            assert!(ids.insert(command.id.clone()), "duplicate id {}", command.id);
            assert!(!command.label.is_empty() && !command.phrases.is_empty(), "{}", command.id);
            let valid = matches!(command.kind.as_str(), "verbs" | "playVerbs") || valid_custom(&command.kind, &command.target);
            assert!(valid, "{} has an unknown action", command.id);
        }
        for kind in WINDOW_KINDS {
            assert!(commands.iter().any(|command| command.kind == "window" && command.target == kind), "no phrases for {kind}");
        }
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str(r#"{ "activation": "always" }"#).unwrap();
        let settings = sanitize(settings);
        assert_eq!(settings.activation, Activation::Always);
        assert_eq!(settings.language, "pt");
        assert_eq!(settings.theme, "blue");
        assert_eq!(settings.accent_hue, DEFAULT_HUE);
        assert_eq!(settings.background, "solid");
        assert!(settings.taskbar);
        assert_eq!(settings.apps.len(), default_apps().len());

        // Turning the bar off sticks.
        let without_bar: Settings = serde_json::from_str(r#"{ "taskbar": false }"#).unwrap();
        assert!(!sanitize(without_bar).taskbar);

        assert_eq!(settings.voice_commands, default_voice_commands());

        let push: Settings = serde_json::from_str(r#"{ "activation": "pushToTalk" }"#).unwrap();
        assert_eq!(push.activation, Activation::PushToTalk);
    }

    #[test]
    fn the_terminal_program_hands_its_old_words_to_jv_sh() {
        let old = |keywords: &[&str]| {
            let mut settings = Settings::default();
            let terminal = settings.apps.iter_mut().find(|a| a.id == "terminal").unwrap();
            terminal.name = "Terminal".into();
            terminal.keywords = keywords.iter().map(|k| k.to_string()).collect();
            sanitize(settings).apps.into_iter().find(|a| a.id == "terminal").unwrap()
        };
        let migrated = old(&["terminal", "console", "prompt de comando"]);
        assert_eq!(migrated.name, "Windows Terminal");
        assert_eq!(migrated.keywords, vec!["windows terminal"]);
        // Words the user chose stay.
        assert_eq!(old(&["terminal", "wt"]).keywords, vec!["terminal", "wt"]);
    }

    #[test]
    fn sanitize_cleans_keywords_and_restores_dock_apps() {
        let mut settings = Settings::default();
        settings.apps.retain(|a| a.id != "terminal");
        settings.apps[0].keywords = vec!["  Navegador ".into(), "navegador".into(), "".into(), "web".into()];
        settings.apps[0].name = "Renamed".into();
        settings.apps.push(AppEntry {
            id: "notes".into(),
            name: " Bloco de notas ".into(),
            keywords: vec!["notas".into()],
            command: " notepad ".into(),
            builtin: true,
        });
        settings.apps.push(AppEntry { id: "notes".into(), name: "dup".into(), keywords: vec![], command: String::new(), builtin: false });

        let settings = sanitize(settings);
        let browser = settings.apps.iter().find(|a| a.id == "browser").unwrap();
        assert_eq!(browser.keywords, vec!["Navegador", "web"]);
        assert_eq!(browser.name, "Browser");
        assert!(settings.apps.iter().any(|a| a.id == "terminal"));
        let notes: Vec<_> = settings.apps.iter().filter(|a| a.id == "notes").collect();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].name, "Bloco de notas");
        assert_eq!(notes[0].command, "notepad");
        assert!(!notes[0].builtin);
    }

    #[test]
    fn invalid_language_model_theme_and_background_are_reset() {
        let settings = sanitize(Settings {
            language: "xx".into(),
            model: "huge".into(),
            theme: "pink".into(),
            background: "stars".into(),
            ..Settings::default()
        });
        assert_eq!(settings.language, "pt");
        assert_eq!(settings.model, "large-v3-turbo");
        assert_eq!(settings.theme, "blue");
        assert_eq!(settings.background, "solid");
        assert_eq!(sanitize(Settings { theme: "green".into(), ..Settings::default() }).theme, "green");
        assert_eq!(sanitize(Settings { background: "matrix".into(), ..Settings::default() }).background, "matrix");

        // The custom hue wraps around the circle.
        let custom = sanitize(Settings { theme: "custom".into(), accent_hue: 400.0, ..Settings::default() });
        assert_eq!(custom.theme, "custom");
        assert_eq!(custom.accent_hue, 40.0);
        assert_eq!(sanitize(Settings { accent_hue: -30.0, ..Settings::default() }).accent_hue, 330.0);
        assert_eq!(sanitize(Settings { accent_hue: f32::NAN, ..Settings::default() }).accent_hue, DEFAULT_HUE);

        // Retired models move to the default; the Base fallback is kept.
        let retired = sanitize(Settings { model: "small".into(), ..Settings::default() });
        assert_eq!(retired.model, "large-v3-turbo");
        let base = sanitize(Settings { model: "base".into(), ..Settings::default() });
        assert_eq!(base.model, "base");
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("jarvis-settings-test-{}", std::process::id()));
        let path = dir.join("settings.json");
        let settings = Settings { activation: Activation::Always, voice_enabled: true, ..Settings::default() };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        fs::remove_dir_all(dir).unwrap();
    }
}
