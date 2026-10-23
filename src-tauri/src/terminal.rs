//! jv_sh's sessions: the user's real shells (the Windows Terminal profiles) running in a
//! pseudoconsole (ConPTY), one per tab. Output streams to the UI as text; the UI writes keys back.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::Value;

/// After the shell exits, the pseudoconsole gets this long to hand over its last output.
const DRAIN_MS: u64 = 150;
const READ_CHUNK: usize = 64 * 1024;

/// jv_sh's own command: the system at a glance, JARVIS style.
const JVFETCH: &str = include_str!("../jvfetch.ps1");
/// Its launcher for PowerShell and cmd.
const JVFETCH_CMD: &str = "@powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0..\\jvfetch.ps1\" %*\r\n";
/// Its launcher for bash: Git Bash (cygpath) and WSL (wslpath) hand PowerShell a Windows path.
const JVFETCH_SH: &str = r#"#!/bin/sh
script="$(dirname "$0")/../jvfetch.ps1"
if command -v cygpath >/dev/null 2>&1; then script=$(cygpath -w "$script")
elif command -v wslpath >/dev/null 2>&1; then script=$(wslpath -w "$script")
fi
exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$script" "$@"
"#;
/// The variables jv_sh hands its shells; WSLENV passes them into WSL and back out to Windows.
const SHARED_ENV: [&str; 4] = ["JARVIS_SH", "JARVIS_SHELL", "JARVIS_VERSION", "JARVIS_SETTINGS"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub commandline: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profiles {
    pub profiles: Vec<Profile>,
    /// Id of the profile new tabs use (the Windows Terminal default).
    pub default: Option<String>,
}

struct Session {
    // Dropped on close: that closes the pseudoconsole and ends the reader.
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Where jv_sh's commands live (see `install_tools`), and the settings jvfetch reports.
pub struct Tools {
    pub bin: PathBuf,
    pub settings: PathBuf,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
    tools: Option<Tools>,
}

impl Terminals {
    pub fn new(tools: Option<Tools>) -> Self {
        Self { tools, ..Self::default() }
    }

    /// Starts `profile` in a pseudoconsole of `cols` × `rows`. Output arrives through `on_output`;
    /// `on_exit` reports the exit code once the shell is gone and its output delivered.
    pub fn open(
        self: &Arc<Self>,
        profile: &Profile,
        cols: u16,
        rows: u16,
        on_output: impl Fn(u32, String) + Send + 'static,
        on_exit: impl FnOnce(u32, Option<u32>) + Send + 'static,
    ) -> Result<u32, String> {
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| format!("Pseudoconsole: {e}"))?;
        let argv = split_commandline(&profile.commandline);
        let (program, args) = argv.split_first().ok_or("Perfil sem comando")?;
        let mut command = CommandBuilder::new(program);
        command.args(args);
        command.cwd(&profile.cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if let Some(tools) = &self.tools {
            let path = command.get_env("PATH").map(|value| value.to_string_lossy().into_owned());
            let wslenv = command.get_env("WSLENV").map(|value| value.to_string_lossy().into_owned());
            for (key, value) in shell_env(&profile.name, tools, path.as_deref(), wslenv.as_deref()) {
                command.env(key, value);
            }
        }
        let mut child = pair.slave.spawn_command(command).map_err(|e| format!("Não foi possível iniciar {}: {e}", profile.name))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        self.sessions.lock().unwrap().insert(id, Session { master: pair.master, writer, killer });

        thread::spawn(move || {
            let mut buffer = vec![0u8; READ_CHUNK];
            let mut pending = Vec::new();
            while let Ok(read) = reader.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                pending.extend_from_slice(&buffer[..read]);
                let text = decode_utf8(&mut pending);
                if !text.is_empty() {
                    on_output(id, text);
                }
            }
        });

        let sessions = Arc::clone(self);
        thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            thread::sleep(Duration::from_millis(DRAIN_MS));
            sessions.sessions.lock().unwrap().remove(&id);
            on_exit(id, code);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(&id).ok_or("Sessão encerrada")?;
        session.writer.write_all(data.as_bytes()).and_then(|()| session.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("Sessão encerrada")?;
        session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    /// Ends a session: the shell is killed (its exit is still reported).
    pub fn close(&self, id: u32) {
        if let Some(session) = self.sessions.lock().unwrap().get_mut(&id) {
            let _ = session.killer.kill();
        }
    }

    /// Every shell goes when JARVIS does.
    pub fn close_all(&self) {
        for (_, mut session) in self.sessions.lock().unwrap().drain() {
            let _ = session.killer.kill();
        }
    }
}

/// Writes jv_sh's commands into `dir` and returns the folder that goes on the PATH (`dir/bin`, with
/// jvfetch.cmd for PowerShell and cmd, jvfetch for bash). The script itself stays out of `bin`, or
/// PowerShell would run it in-process and trip over the execution policy.
pub fn install_tools(dir: &Path) -> io::Result<PathBuf> {
    let bin = dir.join("bin");
    fs::create_dir_all(&bin)?;
    // Windows PowerShell 5.1 reads a script without a BOM as ANSI.
    write_if_changed(&dir.join("jvfetch.ps1"), format!("\u{feff}{}", JVFETCH.replace("\r\n", "\n")).as_bytes())?;
    write_if_changed(&bin.join("jvfetch.cmd"), JVFETCH_CMD.as_bytes())?;
    write_if_changed(&bin.join("jvfetch"), JVFETCH_SH.replace("\r\n", "\n").as_bytes())?;
    Ok(bin)
}

fn write_if_changed(path: &Path, content: &[u8]) -> io::Result<()> {
    if fs::read(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    fs::write(path, content)
}

/// What jv_sh adds to a shell's environment: its commands first on the PATH, what jvfetch shows,
/// and those variables listed in WSLENV (keeping the user's entries) so WSL passes them through.
pub fn shell_env(profile: &str, tools: &Tools, path: Option<&str>, wslenv: Option<&str>) -> Vec<(&'static str, String)> {
    let bin = tools.bin.display().to_string();
    let path = match path {
        Some(path) if !path.is_empty() => format!("{bin};{path}"),
        _ => bin,
    };
    let mut shared: Vec<&str> = wslenv
        .unwrap_or_default()
        .split(':')
        .filter(|entry| !entry.is_empty() && !SHARED_ENV.iter().any(|name| entry.split('/').next() == Some(name)))
        .collect();
    shared.extend(SHARED_ENV);
    vec![
        ("PATH", path),
        ("WSLENV", shared.join(":")),
        ("JARVIS_SH", "1".into()),
        ("JARVIS_SHELL", profile.into()),
        ("JARVIS_VERSION", env!("CARGO_PKG_VERSION").into()),
        ("JARVIS_SETTINGS", tools.settings.display().to_string()),
    ]
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(2, 500), cols: cols.clamp(10, 1000), pixel_width: 0, pixel_height: 0 }
}

/// The text in `pending` that is complete UTF-8, leaving a character cut between two reads for
/// the next one; invalid bytes become U+FFFD.
pub fn decode_utf8(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                out.push_str(text);
                pending.clear();
                return out;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                out.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or_default());
                match error.error_len() {
                    // Cut mid-character: keep the start for the next read.
                    None => {
                        pending.drain(..valid);
                        return out;
                    }
                    Some(bad) => {
                        out.push('\u{FFFD}');
                        pending.drain(..valid + bad);
                    }
                }
            }
        }
    }
}

/// Program and arguments of a Windows command line: spaces separate, double quotes group.
pub fn split_commandline(line: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut started = false;
    for c in line.trim().chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    args.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            c => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        args.push(current);
    }
    args
}

/// `%VAR%` replaced by its value (left as is when the variable does not exist).
pub fn expand_env(text: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) {
                    Some(value) => out.push_str(&value),
                    None => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Windows Terminal's settings are JSON with comments and trailing commas: both go.
pub fn strip_jsonc(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut in_string = false;
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                out.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match (c, chars.get(i + 1)) {
            ('"', _) => {
                in_string = true;
                out.push(c);
                i += 1;
            }
            ('/', Some('/')) => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            ('/', Some('*')) => {
                i += 2;
                while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
            }
            (',', _) => {
                // A comma followed only by blanks and a closing bracket is dropped.
                let next = chars[i + 1..].iter().find(|c| !c.is_whitespace());
                if !matches!(next, Some('}') | Some(']')) {
                    out.push(c);
                }
                i += 1;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn home() -> String {
    env("USERPROFILE").unwrap_or_else(|| "C:\\".into())
}

fn git_bash() -> Option<PathBuf> {
    [env("ProgramFiles"), env("ProgramW6432"), env("LOCALAPPDATA").map(|dir| format!("{dir}\\Programs"))]
        .into_iter()
        .flatten()
        .map(|dir| Path::new(&dir).join("Git").join("bin").join("bash.exe"))
        .find(|path| path.is_file())
}

fn on_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(program)).find(|candidate| candidate.is_file())
}

fn quote(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

/// The profiles of a Windows Terminal settings file (text as on disk). Dynamic profiles have no
/// command line of their own: WSL distributions and Git Bash get theirs; others (Azure Cloud
/// Shell, Visual Studio prompts) need Windows Terminal itself and are left out.
pub fn parse_wt_profiles(text: &str, lookup: &impl Fn(&str) -> Option<String>, git: Option<&Path>) -> Profiles {
    let Ok(settings) = serde_json::from_str::<Value>(&strip_jsonc(text)) else {
        return Profiles { profiles: Vec::new(), default: None };
    };
    let list = match &settings["profiles"] {
        Value::Array(list) => list.clone(),
        other => other["list"].as_array().cloned().unwrap_or_default(),
    };
    let home = lookup("USERPROFILE").unwrap_or_else(|| "C:\\".into());
    let mut profiles = Vec::new();
    for entry in list {
        if entry["hidden"].as_bool() == Some(true) {
            continue;
        }
        let (Some(id), Some(name)) = (entry["guid"].as_str(), entry["name"].as_str()) else { continue };
        let commandline = match (entry["commandline"].as_str(), entry["source"].as_str()) {
            (Some(line), _) => expand_env(line, lookup),
            // Older Windows Terminal generated WSL profiles itself; newer WSL registers its own.
            (None, Some("Windows.Terminal.Wsl" | "Microsoft.WSL")) => format!("wsl.exe -d \"{name}\" --cd ~"),
            (None, Some("Git")) => match git {
                Some(bash) => format!("{} --login -i", quote(bash)),
                None => continue,
            },
            _ => continue,
        };
        let cwd = entry["startingDirectory"]
            .as_str()
            .map(|dir| expand_env(dir, lookup))
            .filter(|dir| !dir.is_empty() && !dir.starts_with("//wsl") && !dir.starts_with('~'))
            .unwrap_or_else(|| home.clone());
        profiles.push(Profile { id: id.to_string(), name: name.to_string(), commandline, cwd });
    }
    let default = settings["defaultProfile"]
        .as_str()
        .filter(|id| profiles.iter().any(|profile| profile.id == *id))
        .map(str::to_string)
        .or_else(|| profiles.first().map(|profile| profile.id.clone()));
    Profiles { profiles, default }
}

/// Windows Terminal's settings file: the Store package (stable first), then an unpackaged install.
fn wt_settings() -> Option<PathBuf> {
    let local = PathBuf::from(env("LOCALAPPDATA")?);
    let packages = std::fs::read_dir(local.join("Packages")).ok()?;
    let mut candidates: Vec<PathBuf> = packages
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("Microsoft.WindowsTerminal")))
        .map(|path| path.join("LocalState").join("settings.json"))
        .filter(|path| path.is_file())
        .collect();
    candidates.sort_by_key(|path| path.to_string_lossy().contains("Preview"));
    candidates.into_iter().next().or_else(|| Some(local.join("Microsoft").join("Windows Terminal").join("settings.json")).filter(|path| path.is_file()))
}

/// What a machine without Windows Terminal (or with an unreadable one) still has.
fn fallback_profiles() -> Profiles {
    let home = home();
    let mut profiles = Vec::new();
    let mut add = |id: &str, name: &str, commandline: String| profiles.push(Profile { id: id.into(), name: name.into(), commandline, cwd: home.clone() });
    if let Some(pwsh) = on_path("pwsh.exe") {
        add("pwsh", "PowerShell", quote(&pwsh));
    }
    if let Some(powershell) = on_path("powershell.exe") {
        add("powershell", "Windows PowerShell", quote(&powershell));
    }
    if let Some(cmd) = on_path("cmd.exe") {
        add("cmd", "Prompt de comando", quote(&cmd));
    }
    if let Some(bash) = git_bash() {
        add("git-bash", "Git Bash", format!("{} --login -i", quote(&bash)));
    }
    if on_path("wsl.exe").is_some() {
        add("wsl", "WSL", "wsl.exe --cd ~".into());
    }
    let default = profiles.first().map(|profile| profile.id.clone());
    Profiles { profiles, default }
}

/// The user's terminal profiles: Windows Terminal's when it is installed, otherwise the shells found.
pub fn profiles() -> Profiles {
    let from_wt = wt_settings()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| parse_wt_profiles(&text, &env, git_bash().as_deref()))
        .filter(|found| !found.profiles.is_empty());
    from_wt.unwrap_or_else(fallback_profiles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    const SETTINGS: &str = r#"
    // Windows Terminal settings, comments and all.
    {
        "$schema": "https://aka.ms/terminal-profiles-schema",
        "defaultProfile": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}",
        /* a block
           comment */
        "profiles": {
            "defaults": {},
            "list": [
                { "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}", "name": "Windows PowerShell", "commandline": "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "hidden": false },
                { "guid": "{0caa0dad-35be-5f56-a8ff-afceeeaa6101}", "name": "Prompt de comando", "commandline": "%SystemRoot%\\System32\\cmd.exe", "startingDirectory": "D:\\work" },
                { "guid": "{b453ae62-4e3d-5e58-b989-0a998ec441b8}", "name": "Azure Cloud Shell", "source": "Windows.Terminal.Azure" },
                { "guid": "{2ece5bfe-50ed-5f3a-ab87-5cd4baafed2b}", "name": "Git Bash", "source": "Git" },
                { "guid": "{7dfd37a3-88b6-5446-bca2-2755cee185a8}", "name": "Ubuntu", "source": "Windows.Terminal.Wsl", "startingDirectory": "//wsl$/Ubuntu/home/me" },
                { "guid": "{33333333-0000-0000-0000-000000000000}", "name": "Debian", "source": "Microsoft.WSL" },
                { "guid": "{11111111-0000-0000-0000-000000000000}", "name": "Escondido", "commandline": "x.exe", "hidden": true },
                { "guid": "{22222222-0000-0000-0000-000000000000}", "name": "url // not a comment", "commandline": "y.exe" },
            ],
        },
    }"#;

    fn lookup(name: &str) -> Option<String> {
        match name {
            "SystemRoot" => Some("C:\\Windows".into()),
            "USERPROFILE" => Some("C:\\Users\\me".into()),
            _ => None,
        }
    }

    #[test]
    fn reads_windows_terminal_profiles() {
        let git = PathBuf::from("C:\\Program Files\\Git\\bin\\bash.exe");
        let found = parse_wt_profiles(SETTINGS, &lookup, Some(&git));
        let names: Vec<&str> = found.profiles.iter().map(|profile| profile.name.as_str()).collect();
        assert_eq!(names, ["Windows PowerShell", "Prompt de comando", "Git Bash", "Ubuntu", "Debian", "url // not a comment"]);
        assert_eq!(found.default.as_deref(), Some("{61c54bbd-c2c6-5271-96e7-009a87ff44bf}"));
        let powershell = &found.profiles[0];
        assert_eq!(powershell.commandline, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        assert_eq!(powershell.cwd, "C:\\Users\\me");
        assert_eq!(found.profiles[1].cwd, "D:\\work");
        assert_eq!(found.profiles[2].commandline, "\"C:\\Program Files\\Git\\bin\\bash.exe\" --login -i");
        assert_eq!(found.profiles[3].commandline, "wsl.exe -d \"Ubuntu\" --cd ~");
        assert_eq!(found.profiles[3].cwd, "C:\\Users\\me");
        assert_eq!(found.profiles[4].commandline, "wsl.exe -d \"Debian\" --cd ~");
        // Without Git for Windows, its profile is left out.
        assert!(!parse_wt_profiles(SETTINGS, &lookup, None).profiles.iter().any(|profile| profile.name == "Git Bash"));
        assert!(parse_wt_profiles("not json", &lookup, None).profiles.is_empty());
    }

    #[test]
    fn strips_comments_and_trailing_commas_outside_strings() {
        let clean = strip_jsonc("{ \"a\": \"x // y\", // gone\n \"b\": [1, 2,], /* gone */ \"c\": \"\\\"/*\" , }");
        let value: Value = serde_json::from_str(&clean).unwrap();
        assert_eq!(value["a"], "x // y");
        assert_eq!(value["b"], serde_json::json!([1, 2]));
        assert_eq!(value["c"], "\"/*");
    }

    #[test]
    fn splits_windows_command_lines() {
        assert_eq!(split_commandline("\"C:\\Program Files\\Git\\bin\\bash.exe\" --login -i"), ["C:\\Program Files\\Git\\bin\\bash.exe", "--login", "-i"]);
        assert_eq!(split_commandline("  cmd.exe   /k  echo hi "), ["cmd.exe", "/k", "echo", "hi"]);
        assert_eq!(split_commandline("wsl.exe -d \"Ubuntu 22\" --cd ~"), ["wsl.exe", "-d", "Ubuntu 22", "--cd", "~"]);
        assert!(split_commandline("   ").is_empty());
    }

    #[test]
    fn expands_variables() {
        assert_eq!(expand_env("%SystemRoot%\\cmd.exe", lookup), "C:\\Windows\\cmd.exe");
        assert_eq!(expand_env("%NOPE%\\x %USERPROFILE%", lookup), "%NOPE%\\x C:\\Users\\me");
        assert_eq!(expand_env("100% sure", lookup), "100% sure");
    }

    #[test]
    fn keeps_characters_cut_between_reads() {
        let bytes = "olá ✓".as_bytes();
        let mut pending = bytes[..bytes.len() - 1].to_vec();
        assert_eq!(decode_utf8(&mut pending), "olá ");
        pending.push(bytes[bytes.len() - 1]);
        assert_eq!(decode_utf8(&mut pending), "✓");
        let mut invalid = vec![b'a', 0xFF, b'b'];
        assert_eq!(decode_utf8(&mut invalid), "a\u{FFFD}b");
        assert!(invalid.is_empty());
    }

    /// Runs `profile` in a real pseudoconsole until it exits, answering ConPTY's opening question
    /// (where the cursor is, ESC[6n) as xterm.js does in the app. Each `typed` line goes in once the
    /// shell is quiet (its prompt is up, whatever it looks like), one at a time: a program started
    /// from WSL takes whatever was typed ahead. Returns the session, exit code and output.
    #[cfg(windows)]
    fn run(terminals: &Arc<Terminals>, profile: &Profile, typed: &[&str], timeout: Duration) -> (u32, Option<u32>, String) {
        let (output, outputs) = mpsc::channel();
        let (exit, exits) = mpsc::channel();
        let id = terminals
            .open(
                profile,
                120,
                40,
                move |_, text| {
                    let _ = output.send(text);
                },
                move |id, code| {
                    let _ = exit.send((id, code));
                },
            )
            .expect("open");
        let mut text = String::new();
        let mut typed = typed.iter();
        let mut last = std::time::Instant::now();
        let deadline = std::time::Instant::now() + timeout;
        let (exited, code) = loop {
            if let Ok(chunk) = outputs.recv_timeout(Duration::from_millis(50)) {
                text.push_str(&chunk);
                last = std::time::Instant::now();
                if chunk.contains("\x1b[6n") {
                    let _ = terminals.write(id, "\x1b[1;1R");
                }
            }
            if !text.is_empty()
                && last.elapsed() > Duration::from_millis(1500)
                && let Some(keys) = typed.next()
            {
                let _ = terminals.write(id, keys);
                last = std::time::Instant::now();
            }
            if let Ok(done) = exits.try_recv() {
                break done;
            }
            assert!(std::time::Instant::now() < deadline, "no exit; output so far {text:?}");
        };
        text.extend(outputs.try_iter());
        assert_eq!(exited, id);
        (id, code, text)
    }

    /// The output without escape sequences (colours, cursor moves).
    fn plain(text: &str) -> String {
        let mut out = String::new();
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            match (c, chars.peek()) {
                ('\x1b', Some('[')) => {
                    chars.next();
                    while chars.next().is_some_and(|c| !c.is_ascii_alphabetic()) {}
                }
                ('\x1b', Some(']')) => while chars.next().is_some_and(|c| c != '\x07') {},
                ('\x1b', _) => {
                    chars.next();
                }
                _ => out.push(c),
            }
        }
        out
    }

    fn tools_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("jarvis-jvsh-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn installs_jvfetch_for_every_shell() {
        let dir = tools_dir("install");
        let bin = install_tools(&dir).expect("install");
        assert_eq!(bin, dir.join("bin"));
        let script = fs::read(dir.join("jvfetch.ps1")).unwrap();
        assert!(script.starts_with("\u{feff}".as_bytes()), "Windows PowerShell reads a script without a BOM as ANSI");
        assert!(!bin.join("jvfetch.ps1").exists(), "on the PATH, PowerShell would run the script itself");
        assert!(fs::read_to_string(bin.join("jvfetch.cmd")).unwrap().contains("-File \"%~dp0..\\jvfetch.ps1\""));
        let sh = fs::read_to_string(bin.join("jvfetch")).unwrap();
        assert!(sh.starts_with("#!/bin/sh\n") && !sh.contains('\r'), "bash needs LF line endings");
        // The next start leaves them as they are.
        let written = fs::metadata(dir.join("jvfetch.ps1")).unwrap().modified().unwrap();
        install_tools(&dir).expect("install again");
        assert_eq!(fs::metadata(dir.join("jvfetch.ps1")).unwrap().modified().unwrap(), written);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hands_shells_its_commands_and_shares_them_with_wsl() {
        let tools = Tools { bin: PathBuf::from(r"C:\data\jv_sh\bin"), settings: PathBuf::from(r"C:\config\settings.json") };
        let env: HashMap<_, _> = shell_env("Ubuntu", &tools, Some(r"C:\Windows;C:\tools"), Some("USERPROFILE/p:JARVIS_SHELL/u")).into_iter().collect();
        assert_eq!(env["PATH"], r"C:\data\jv_sh\bin;C:\Windows;C:\tools");
        assert_eq!(env["WSLENV"], "USERPROFILE/p:JARVIS_SH:JARVIS_SHELL:JARVIS_VERSION:JARVIS_SETTINGS");
        assert_eq!(env["JARVIS_SH"], "1");
        assert_eq!(env["JARVIS_SHELL"], "Ubuntu");
        assert_eq!(env["JARVIS_SETTINGS"], r"C:\config\settings.json");
        let bare: HashMap<_, _> = shell_env("cmd", &tools, None, None).into_iter().collect();
        assert_eq!(bare["PATH"], r"C:\data\jv_sh\bin");
        assert_eq!(bare["WSLENV"], "JARVIS_SH:JARVIS_SHELL:JARVIS_VERSION:JARVIS_SETTINGS");
    }

    #[test]
    fn strips_escape_sequences() {
        assert_eq!(plain("\x1b[1m\x1b[34msistema\x1b[0m \x1b]0;title\x07ok\x1b[?25h"), "sistema ok");
    }

    /// A real shell in a real pseudoconsole: output arrives, then the exit code.
    #[test]
    #[cfg(windows)]
    fn runs_a_shell_in_a_pseudoconsole() {
        let terminals = Arc::new(Terminals::default());
        let profile = Profile { id: "cmd".into(), name: "cmd".into(), commandline: "cmd.exe /c echo jarvis-pty".into(), cwd: home() };
        let (id, code, text) = run(&terminals, &profile, &[], Duration::from_secs(15));
        assert_eq!(code, Some(0));
        assert!(text.contains("jarvis-pty"), "output was {text:?}");
        assert!(terminals.write(id, "x").is_err(), "the session is gone after the exit");
    }

    /// jvfetch for real, as a tab runs it: found on the PATH, this machine's facts on screen.
    #[test]
    #[cfg(windows)]
    fn runs_jvfetch_in_a_tab() {
        let dir = tools_dir("jvfetch");
        let bin = install_tools(&dir).expect("install");
        let terminals = Arc::new(Terminals::new(Some(Tools { bin, settings: dir.join("settings.json") })));
        let profile = Profile { id: "cmd".into(), name: "Prompt de comando".into(), commandline: "cmd.exe /d /c jvfetch".into(), cwd: home() };
        let (_, code, text) = run(&terminals, &profile, &[], Duration::from_secs(60));
        let _ = fs::remove_dir_all(&dir);
        let shown = plain(&text);
        println!("{shown}");
        assert_eq!(code, Some(0), "output was {shown}");
        for fact in ["sistema", "memória", "cpu", "Prompt de comando", "jv_sh", "J · A · R · V · I · S"] {
            assert!(shown.contains(fact), "no {fact:?} in {shown}");
        }
        assert!(text.contains("\x1b[34m"), "inside jv_sh, the accent is the theme's palette slot");
    }

    /// This machine's own default profile (Windows Terminal's), typed into like a user would.
    #[test]
    #[cfg(windows)]
    #[ignore = "uses this machine's terminal profiles"]
    fn opens_the_users_default_profile() {
        let found = profiles();
        println!("profiles: {:?}", found.profiles.iter().map(|profile| &profile.name).collect::<Vec<_>>());
        let profile = found.profiles.iter().find(|profile| Some(&profile.id) == found.default.as_ref()).expect("a default profile").clone();
        println!("default: {} -> {}", profile.name, profile.commandline);
        let terminals = Arc::new(Terminals::default());
        let (_, code, text) = run(&terminals, &profile, &["echo \"jarvis $(1+1)\"\r", "exit\r"], Duration::from_secs(30));
        println!("exit {code:?}; output:\n{text}");
        assert!(text.contains("jarvis 2"), "the shell ran the command");
    }

    /// jvfetch typed in each of this machine's profiles (PowerShell, cmd, Git Bash, WSL...).
    #[test]
    #[cfg(windows)]
    #[ignore = "uses this machine's terminal profiles"]
    fn runs_jvfetch_in_every_profile() {
        let dir = tools_dir("jvfetch-profiles");
        let bin = install_tools(&dir).expect("install");
        let terminals = Arc::new(Terminals::new(Some(Tools { bin, settings: dir.join("settings.json") })));
        let mut failed = Vec::new();
        for profile in profiles().profiles {
            // One line, so a shell still starting up (WSL) cannot hand the exit to jvfetch.
            let line = if profile.commandline.contains("cmd.exe") { "jvfetch & exit\r" } else { "jvfetch; exit\r" };
            let (_, code, text) = run(&terminals, &profile, &[line], Duration::from_secs(90));
            let shown = plain(&text);
            let ran = shown.contains("memória") && shown.contains(&format!("shell      {}", profile.name));
            println!("{} -> exit {code:?}, jvfetch {}", profile.name, if ran { "ok" } else { "MISSING" });
            if !ran {
                println!("{shown}");
                failed.push(profile.name);
            }
        }
        let _ = fs::remove_dir_all(&dir);
        assert!(failed.is_empty(), "jvfetch did not run in {failed:?}");
    }
}
