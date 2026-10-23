//! jv_T4p3's audio source: yt-dlp finds each song on YouTube and hands back the URL of its
//! audio-only stream, which the WebView plays directly (no video, nothing saved to disk).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::download;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
#[cfg(windows)]
const EXE: &str = "yt-dlp.exe";
#[cfg(not(windows))]
const EXE: &str = "yt-dlp";
/// The release binary is ~18 MB; anything far larger is not it.
const MAX_EXE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SUMS_BYTES: u64 = 64 * 1024;
/// A search plus extraction usually takes a few seconds; YouTube can be slow.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(40);
/// AAC in MP4 first (plays everywhere Chromium does), then whatever audio-only stream exists.
const AUDIO_FORMAT: &str = "bestaudio[ext=m4a]/bestaudio";
/// Stream URLs are signed for a few hours; refresh a little before they expire.
const EXPIRY_MARGIN: u64 = 120;
const MAX_QUERY: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicStatus {
    /// "missing", "ready" or "installing".
    pub ytdlp: &'static str,
    pub version: Option<String>,
    /// Our own copy (updatable from the app) rather than one found on PATH.
    pub managed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub video_id: String,
    pub title: String,
    /// The channel that uploaded it (the artist, for pasted links).
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub url: String,
    /// Unix time (s) after which `url` stops working, when the URL says.
    #[serde(skip)]
    pub expires: Option<u64>,
}

pub struct Music {
    bin_dir: PathBuf,
    installing: AtomicBool,
    /// Search query → video id: the second time a song plays, no search is needed.
    ids: Mutex<HashMap<String, String>>,
    /// Video id → stream, until it expires.
    streams: Mutex<HashMap<String, Resolved>>,
}

impl Music {
    pub fn new(bin_dir: PathBuf) -> Self {
        Self { bin_dir, installing: AtomicBool::new(false), ids: Mutex::default(), streams: Mutex::default() }
    }

    fn managed_path(&self) -> PathBuf {
        self.bin_dir.join(EXE)
    }

    /// Our copy first, then the first one on PATH.
    fn executable(&self) -> Option<(PathBuf, bool)> {
        let managed = self.managed_path();
        if managed.is_file() {
            return Some((managed, true));
        }
        let path = std::env::var_os("PATH")?;
        std::env::split_paths(&path).map(|dir| dir.join(EXE)).find(|candidate| candidate.is_file()).map(|found| (found, false))
    }

    pub fn status(&self) -> MusicStatus {
        if self.installing.load(Ordering::SeqCst) {
            return MusicStatus { ytdlp: "installing", version: None, managed: true };
        }
        match self.executable() {
            Some((exe, managed)) => MusicStatus { ytdlp: "ready", version: version(&exe), managed },
            None => MusicStatus { ytdlp: "missing", version: None, managed: false },
        }
    }

    /// Downloads (or updates) our own copy of the official release, checked against the
    /// release's SHA2-256SUMS. Returns the installed version.
    pub fn install(&self, progress: impl FnMut(u64, u64)) -> Result<Option<String>, String> {
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err("O yt-dlp já está sendo baixado".into());
        }
        let result = (|| {
            let sums = download::fetch_text(&format!("{RELEASES}/SHA2-256SUMS"), MAX_SUMS_BYTES)?;
            let sha256 = checksum_for(&sums, EXE).ok_or("A lista de verificação do yt-dlp não tem o executável")?;
            let target = self.managed_path();
            download::fetch_verified(&format!("{RELEASES}/{EXE}"), &target, &sha256, None, MAX_EXE_BYTES, progress)?;
            Ok(version(&target))
        })();
        self.installing.store(false, Ordering::SeqCst);
        result
    }

    /// The audio stream of the first YouTube result for `query` ("Artista - Música").
    pub fn resolve(&self, query: &str) -> Result<Resolved, String> {
        let query = clean_query(query)?;
        let now = unix_now();
        let known = self.ids.lock().unwrap().get(&query).cloned();
        if let Some(id) = &known
            && let Some(stream) = self.streams.lock().unwrap().get(id)
            && stream.expires.is_none_or(|expires| expires > now + EXPIRY_MARGIN)
        {
            return Ok(stream.clone());
        }

        let target = match &known {
            Some(id) => watch_url(id),
            None => search_target(&query),
        };
        let resolved = self.extract(&target)?;
        self.ids.lock().unwrap().insert(query, resolved.video_id.clone());
        Ok(resolved)
    }

    /// The audio stream of one video (a link pasted into a playlist).
    pub fn resolve_video(&self, id: &str) -> Result<Resolved, String> {
        if !is_video_id(id) {
            return Err("Link do YouTube inválido".into());
        }
        if let Some(stream) = self.streams.lock().unwrap().get(id)
            && stream.expires.is_none_or(|expires| expires > unix_now() + EXPIRY_MARGIN)
        {
            return Ok(stream.clone());
        }
        self.extract(&watch_url(id))
    }

    fn extract(&self, target: &str) -> Result<Resolved, String> {
        let (exe, _) = self.executable().ok_or("yt-dlp-missing")?;
        let output = run(&exe, &["--no-config", "--no-playlist", "--no-warnings", "-f", AUDIO_FORMAT, "-j", target], RESOLVE_TIMEOUT)?;
        let resolved = parse_resolved(&output)?;
        self.streams.lock().unwrap().insert(resolved.video_id.clone(), resolved.clone());
        Ok(resolved)
    }
}

fn watch_url(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}")
}

/// `ytsearch1:` keeps the query from ever being read as an option or a URL.
fn search_target(query: &str) -> String {
    format!("ytsearch1:{query}")
}

fn clean_query(query: &str) -> Result<String, String> {
    let query = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if query.is_empty() || query.chars().count() > MAX_QUERY {
        return Err("Busca inválida".into());
    }
    Ok(query)
}

/// The SHA-256 listed for `file` in a `sha256sum`-style list ("<hash>  <name>").
pub fn checksum_for(sums: &str, file: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == file && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    })
}

/// Reads yt-dlp's `-j` output (one JSON object) and keeps only what the player needs; the
/// stream must be an https URL on YouTube's media servers.
pub fn parse_resolved(output: &str) -> Result<Resolved, String> {
    let line = output.lines().map(str::trim).find(|line| line.starts_with('{')).ok_or("Música não encontrada no YouTube")?;
    let info: Value = serde_json::from_str(line).map_err(|_| "Resposta inesperada do yt-dlp".to_string())?;
    let video_id = info["id"].as_str().filter(|id| is_video_id(id)).ok_or("Resposta inesperada do yt-dlp (id)")?;
    let url = info["url"].as_str().filter(|url| is_stream_url(url)).ok_or("O yt-dlp não devolveu um stream de áudio")?;
    Ok(Resolved {
        video_id: video_id.to_string(),
        title: info["title"].as_str().unwrap_or_default().to_string(),
        uploader: info["uploader"].as_str().or(info["channel"].as_str()).map(str::to_string),
        duration: info["duration"].as_f64(),
        url: url.to_string(),
        expires: expiry(url),
    })
}

fn is_video_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_stream_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?']).next().unwrap_or_default();
    host.ends_with(".googlevideo.com") && !host.contains('@')
}

/// `expire=<unix time>` from the signed URL's query string.
fn expiry(url: &str) -> Option<u64> {
    let query = url.split_once('?')?.1;
    query.split('&').find_map(|pair| pair.strip_prefix("expire=")).and_then(|value| value.parse().ok())
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0)
}

fn command(exe: &Path) -> Command {
    let mut command = Command::new(exe);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn version(exe: &Path) -> Option<String> {
    let output = run(exe, &["--version"], Duration::from_secs(20)).ok()?;
    output.lines().next().map(|line| line.trim().to_string()).filter(|line| !line.is_empty())
}

/// Runs yt-dlp and returns its stdout. Both pipes are drained on their own threads (the JSON can
/// be large), and the process is killed after `timeout`.
fn run(exe: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = command(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar o yt-dlp: {e}"))?;
    let drain = |mut pipe: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        })
    };
    let stdout = drain(Box::new(child.stdout.take().expect("piped stdout")));
    let stderr = drain(Box::new(child.stderr.take().expect("piped stderr")));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("O YouTube demorou demais para responder".into());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    if status.success() {
        Ok(stdout)
    } else {
        Err(error_message(&stderr))
    }
}

/// yt-dlp's last error line, without its prefix.
fn error_message(stderr: &str) -> String {
    let line = stderr.lines().rev().map(str::trim).find(|line| !line.is_empty()).unwrap_or("erro desconhecido");
    format!("yt-dlp: {}", line.trim_start_matches("ERROR:").trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1767225600&itag=140&mime=audio%2Fmp4";

    #[test]
    fn finds_the_checksum_of_a_file() {
        let sums = format!("{}  yt-dlp\n{}  yt-dlp.exe\n{}  yt-dlp_macos\n", "a".repeat(64), "B".repeat(64), "c".repeat(64));
        assert_eq!(checksum_for(&sums, "yt-dlp.exe"), Some("b".repeat(64)));
        assert_eq!(checksum_for(&sums, "yt-dlp"), Some("a".repeat(64)));
        assert_eq!(checksum_for(&sums, "yt-dlp_x86.exe"), None);
        assert_eq!(checksum_for("nothex  yt-dlp.exe", "yt-dlp.exe"), None);
    }

    #[test]
    fn parses_a_resolution() {
        let json = format!(r#"{{"id":"SwIW4QQUj8k","title":"Blondie - Atomic","uploader":"Blondie","duration":230.5,"url":"{URL}","formats":[]}}"#);
        let resolved = parse_resolved(&format!("\n{json}\n")).unwrap();
        assert_eq!(resolved.video_id, "SwIW4QQUj8k");
        assert_eq!(resolved.title, "Blondie - Atomic");
        assert_eq!(resolved.uploader.as_deref(), Some("Blondie"));
        assert_eq!(resolved.duration, Some(230.5));
        assert_eq!(resolved.url, URL);
        assert_eq!(resolved.expires, Some(1_767_225_600));
    }

    #[test]
    fn rejects_odd_resolutions() {
        let with = |id: &str, url: &str| parse_resolved(&format!(r#"{{"id":"{id}","title":"x","url":"{url}"}}"#));
        assert!(with("short", URL).is_err());
        assert!(with("SwIW4QQUj8k", "http://rr3.googlevideo.com/videoplayback").is_err());
        assert!(with("SwIW4QQUj8k", "https://evil.example.com/?x=.googlevideo.com").is_err());
        assert!(with("SwIW4QQUj8k", "https://user@rr3.googlevideo.com/videoplayback").is_err());
        assert!(parse_resolved("").is_err());
        assert!(parse_resolved("not json").is_err());
    }

    #[test]
    fn queries_are_normalised_and_bounded() {
        assert_eq!(clean_query("  Blondie   -  Atomic ").unwrap(), "Blondie - Atomic");
        assert!(clean_query("   ").is_err());
        assert!(clean_query(&"x".repeat(MAX_QUERY + 1)).is_err());
        assert_eq!(search_target("-x"), "ytsearch1:-x");
    }

    #[test]
    fn pasted_links_need_a_real_video_id() {
        let music = Music::new(std::env::temp_dir().join("jarvis-music-no-bin"));
        assert_eq!(music.resolve_video("--exec=calc").unwrap_err(), "Link do YouTube inválido");
        assert_eq!(music.resolve_video("short").unwrap_err(), "Link do YouTube inválido");
    }

    #[test]
    fn error_lines_lose_their_prefix() {
        assert_eq!(error_message("WARNING: a\nERROR: [youtube] abc: Video unavailable\n"), "yt-dlp: [youtube] abc: Video unavailable");
        assert_eq!(error_message(""), "yt-dlp: erro desconhecido");
    }

    /// Network: installs yt-dlp into a temp folder and resolves a real song.
    #[test]
    #[ignore]
    fn installs_and_resolves_for_real() {
        let dir = std::env::temp_dir().join(format!("jarvis-music-test-{}", std::process::id()));
        let music = Music::new(dir.clone());
        let version = music.install(|_, _| {}).expect("install");
        println!("yt-dlp {version:?}");
        let started = Instant::now();
        let resolved = music.resolve("Blondie - Atomic").expect("resolve");
        println!("{} in {:?}: {} ({:?} s)\n{}", resolved.video_id, started.elapsed(), resolved.title, resolved.duration, resolved.url);
        assert!(is_stream_url(&resolved.url));
        // Cached: the second time is instant.
        let again = Instant::now();
        assert_eq!(music.resolve("Blondie - Atomic").unwrap(), resolved);
        assert!(again.elapsed() < Duration::from_millis(50));
        if let Ok(keep) = std::env::var("JARVIS_KEEP_YTDLP") {
            let _ = std::fs::copy(dir.join(EXE), Path::new(&keep).join(EXE));
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
