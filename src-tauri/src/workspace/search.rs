//! Finding things in a project: every file's path (for quick open) and text across files, both
//! honouring .gitignore and skipping `.git` and `node_modules`.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use ignore::overrides::{Override, OverrideBuilder};
use ignore::{WalkBuilder, WalkState};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use super::paths::{self, Root};
use super::text::{self, Decoded};

const MAX_FILES: usize = 50_000;
/// Larger files are not searched.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 2000;
const MAX_PER_FILE: usize = 1000;
/// Matches go out in batches this big, or this often.
const BATCH: usize = 100;
const BATCH_EVERY: Duration = Duration::from_millis(50);
/// A preview shows about this many characters of the line.
const PREVIEW: usize = 200;
/// ...starting at most this many before the match.
const PREVIEW_LEAD: usize = 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    /// Relative paths, with "/".
    pub files: Vec<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    pub pattern: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// Globs a file must match (any of them), like ripgrep's `-g`.
    pub include: Vec<String>,
    /// Globs that leave files (and folders) out.
    pub exclude: Vec<String>,
    pub max_results: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub path: String,
    /// 1-based.
    pub line: usize,
    /// In UTF-16 units from the start of the line, as the editor counts.
    pub column: usize,
    pub length: usize,
    /// The line around the match, without its indentation.
    pub preview: String,
    pub preview_column: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SearchEvent {
    Matches { id: u64, matches: Vec<Match> },
    Done { id: u64, files: usize, total: usize, truncated: bool, cancelled: bool, millis: u64 },
}

fn skipped(entry: &ignore::DirEntry) -> bool {
    matches!(entry.file_name().to_str(), Some(".git" | "node_modules"))
}

fn walker(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder.hidden(false).require_git(false).follow_links(false).filter_entry(|entry| !skipped(entry));
    builder
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Every file in the project (for quick open; the UI does the fuzzy matching).
pub fn files(root: &Root) -> FileList {
    let base = paths::plain(&root.canonical);
    let mut files = Vec::new();
    let mut truncated = false;
    for entry in walker(&base).build().flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if files.len() == MAX_FILES {
            truncated = true;
            break;
        }
        files.push(relative(&base, entry.path()));
    }
    files.sort_by_key(|path| path.to_lowercase());
    FileList { files, truncated }
}

/// The search, checked and ready to run.
pub struct Prepared {
    base: std::path::PathBuf,
    regex: Regex,
    overrides: Override,
    max: usize,
}

pub fn prepare(root: &Root, query: &Query) -> Result<Prepared, String> {
    if query.pattern.is_empty() {
        return Err("Digite algo para buscar".into());
    }
    let pattern = if query.regex { query.pattern.clone() } else { regex::escape(&query.pattern) };
    let pattern = if query.whole_word { format!(r"\b(?:{pattern})\b") } else { pattern };
    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!query.case_sensitive)
        .size_limit(10 * 1024 * 1024)
        .build()
        .map_err(|error| format!("Expressão regular inválida: {error}"))?;
    let base = paths::plain(&root.canonical);
    let mut overrides = OverrideBuilder::new(&base);
    overrides.case_insensitive(true).map_err(|error| error.to_string())?;
    let globs = query.include.iter().map(|glob| glob.trim().to_string()).chain(query.exclude.iter().map(|glob| format!("!{}", glob.trim())));
    for glob in globs.filter(|glob| !glob.is_empty() && glob != "!") {
        overrides.add(&glob).map_err(|error| format!("Filtro inválido: {error}"))?;
    }
    let overrides = overrides.build().map_err(|error| format!("Filtro inválido: {error}"))?;
    let max = query.max_results.map_or(DEFAULT_MAX_RESULTS, |max| (max as usize).max(1));
    Ok(Prepared { base, regex, overrides, max })
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

fn floor_boundary(text: &str, mut index: usize) -> usize {
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// About `PREVIEW` characters of `line` around the match at `start..end` (byte offsets), and where
/// the match starts in it (UTF-16).
fn preview(line: &str, start: usize, end: usize) -> (String, usize) {
    let indent = line.len() - line.trim_start().len();
    let from = if start.saturating_sub(indent) > PREVIEW_LEAD { floor_boundary(line, start - PREVIEW_LEAD) } else { indent.min(start) };
    let to = floor_boundary(line, line.len().min(from + PREVIEW.max(end - from)));
    let to = to.max(end.min(line.len()));
    (line[from..to].trim_end().to_string(), utf16_len(&line[from..start]))
}

/// The matches in one file's text.
fn find(regex: &Regex, path: &str, text: &str) -> Vec<Match> {
    let mut found = Vec::new();
    for (index, line) in text.split('\n').enumerate() {
        for hit in regex.find_iter(line) {
            if hit.start() == hit.end() {
                continue;
            }
            let (preview, preview_column) = preview(line, hit.start(), hit.end());
            found.push(Match {
                path: path.to_string(),
                line: index + 1,
                column: utf16_len(&line[..hit.start()]),
                length: utf16_len(hit.as_str()),
                preview,
                preview_column,
            });
            if found.len() == MAX_PER_FILE {
                return found;
            }
        }
    }
    found
}

/// Runs the search, handing `send` its matches in batches and then `Done`. It stops when
/// `current` moves past `id` (a newer search, or a cancel), at the result limit, or when `send`
/// returns false (nobody is listening anymore).
pub fn run(prepared: Prepared, id: u64, current: &AtomicU64, mut send: impl FnMut(SearchEvent) -> bool) {
    let started = Instant::now();
    let Prepared { base, regex, overrides, max } = prepared;
    let stop = AtomicBool::new(false);
    let searched = AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map_or(4, |count| count.get()).min(8);
    let mut total = 0;
    let mut truncated = false;
    let mut listening = true;
    std::thread::scope(|scope| {
        let (sender, found) = mpsc::channel::<Vec<Match>>();
        let (stop, searched, regex, base) = (&stop, &searched, &regex, &base);
        let mut builder = walker(base);
        builder.overrides(overrides).max_filesize(Some(MAX_FILE_BYTES)).threads(threads);
        let parallel = builder.build_parallel();
        scope.spawn(move || {
            parallel.run(|| {
                let sender = sender.clone();
                Box::new(move |entry| {
                    if stop.load(Ordering::Relaxed) || current.load(Ordering::Relaxed) != id {
                        return WalkState::Quit;
                    }
                    let Ok(entry) = entry else { return WalkState::Continue };
                    if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                        return WalkState::Continue;
                    }
                    searched.fetch_add(1, Ordering::Relaxed);
                    let Ok(bytes) = std::fs::read(entry.path()) else { return WalkState::Continue };
                    let Decoded::Text { text, .. } = text::decode(&bytes) else { return WalkState::Continue };
                    if !regex.is_match(&text) {
                        return WalkState::Continue;
                    }
                    let matches = find(regex, &relative(base, entry.path()), &text);
                    if !matches.is_empty() && sender.send(matches).is_err() {
                        return WalkState::Quit;
                    }
                    WalkState::Continue
                })
            });
        });
        let mut pending: Vec<Match> = Vec::new();
        let mut sent_at = Instant::now();
        loop {
            let received = found.recv_timeout(BATCH_EVERY);
            let finished = matches!(received, Err(mpsc::RecvTimeoutError::Disconnected));
            if let Ok(mut matches) = received
                && listening
                && !truncated
            {
                matches.truncate(max - total);
                total += matches.len();
                pending.extend(matches);
                if total >= max {
                    truncated = true;
                    stop.store(true, Ordering::Relaxed);
                }
            }
            if listening && !pending.is_empty() && (finished || pending.len() >= BATCH || sent_at.elapsed() >= BATCH_EVERY) {
                listening = send(SearchEvent::Matches { id, matches: std::mem::take(&mut pending) });
                sent_at = Instant::now();
                if !listening {
                    stop.store(true, Ordering::Relaxed);
                }
            }
            if finished {
                break;
            }
        }
    });
    let cancelled = current.load(Ordering::Relaxed) != id;
    if listening {
        send(SearchEvent::Done {
            id,
            files: searched.load(Ordering::Relaxed),
            total,
            truncated,
            cancelled,
            millis: started.elapsed().as_millis() as u64,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn project(name: &str) -> (std::path::PathBuf, Root) {
        let dir = std::env::temp_dir().join(format!("jarvis-ws-search-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for folder in ["src", "node_modules/lib", "target", ".git"] {
            fs::create_dir_all(dir.join(folder)).unwrap();
        }
        fs::write(dir.join(".gitignore"), "target/\n").unwrap();
        fs::write(dir.join("src").join("main.rs"), "fn main() {\n    let reorder = 1; // Reorder\n    reorders();\n}\n").unwrap();
        fs::write(dir.join("src").join("report.py"), "def reorder_rows(store):\n    return []\n").unwrap();
        fs::write(dir.join("node_modules").join("lib").join("index.js"), "reorder").unwrap();
        fs::write(dir.join("target").join("out.txt"), "reorder").unwrap();
        fs::write(dir.join(".git").join("HEAD"), "reorder").unwrap();
        fs::write(dir.join("logo.png"), b"reorder\x00\x00").unwrap();
        // UTF-16 with a BOM, and an emoji before the match (two UTF-16 units).
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("😀 reorder".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        fs::write(dir.join("notes.txt"), utf16).unwrap();
        let root = Root::new(&dir.display().to_string()).unwrap();
        (dir, root)
    }

    fn search(root: &Root, query: Query) -> (Vec<Match>, SearchEvent) {
        let counter = AtomicU64::new(7);
        let mut matches = Vec::new();
        let mut done = None;
        run(prepare(root, &query).unwrap(), 7, &counter, |event| {
            match event {
                SearchEvent::Matches { matches: batch, .. } => matches.extend(batch),
                other => done = Some(other),
            }
            true
        });
        matches.sort_by(|a, b| (&a.path, a.line, a.column).cmp(&(&b.path, b.line, b.column)));
        (matches, done.expect("done"))
    }

    fn query(pattern: &str) -> Query {
        Query { pattern: pattern.into(), ..Query::default() }
    }

    #[test]
    fn lists_files_honouring_gitignore() {
        let (dir, root) = project("files");
        let list = files(&root);
        assert_eq!(list.files, [".gitignore", "logo.png", "notes.txt", "src/main.rs", "src/report.py"]);
        assert!(!list.truncated);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn finds_text_literally_by_default_ignoring_case() {
        let (dir, root) = project("literal");
        let (matches, done) = search(&root, query("reorder"));
        let places: Vec<(&str, usize, usize)> = matches.iter().map(|hit| (hit.path.as_str(), hit.line, hit.column)).collect();
        assert_eq!(places, [("notes.txt", 1, 3), ("src/main.rs", 2, 8), ("src/main.rs", 2, 24), ("src/main.rs", 3, 4), ("src/report.py", 1, 4)]);
        let SearchEvent::Done { total, truncated, cancelled, files, .. } = done else { panic!() };
        assert_eq!((total, truncated, cancelled), (5, false, false));
        assert!(files >= 4);
        let hit = &matches[1];
        assert_eq!((hit.length, hit.preview.as_str(), hit.preview_column), (7, "let reorder = 1; // Reorder", 4));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn honours_case_whole_words_regex_and_globs() {
        let (dir, root) = project("options");
        let count = |query: Query| search(&root, query).0.len();
        assert_eq!(count(Query { case_sensitive: true, ..query("Reorder") }), 1);
        assert_eq!(count(Query { whole_word: true, ..query("reorder") }), 3, "not reorders() nor reorder_rows");
        assert_eq!(count(Query { regex: true, ..query(r"reorder\w+") }), 2);
        assert_eq!(count(Query { include: vec!["*.py".into()], ..query("reorder") }), 1);
        assert_eq!(count(Query { exclude: vec!["src/**".into()], ..query("reorder") }), 1);
        assert_eq!(count(Query { max_results: Some(2), ..query("reorder") }), 2);
        let SearchEvent::Done { truncated, .. } = search(&root, Query { max_results: Some(2), ..query("reorder") }).1 else { panic!() };
        assert!(truncated);
        assert_eq!(prepare(&root, &Query { regex: true, ..query("(") }).err().unwrap().split(':').next(), Some("Expressão regular inválida"));
        assert_eq!(prepare(&root, &query("")).err().unwrap(), "Digite algo para buscar");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_newer_search_cancels_this_one() {
        let (dir, root) = project("cancel");
        let counter = AtomicU64::new(2);
        let mut done = None;
        run(prepare(&root, &query("reorder")).unwrap(), 1, &counter, |event| {
            if let SearchEvent::Done { cancelled, .. } = event {
                done = Some(cancelled);
            }
            true
        });
        assert_eq!(done, Some(true));
        // Nobody listening: it stops without a Done.
        let counter = AtomicU64::new(3);
        let mut calls = 0;
        run(prepare(&root, &query("reorder")).unwrap(), 3, &counter, |_| {
            calls += 1;
            false
        });
        assert_eq!(calls, 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn previews_long_lines_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(300), "b".repeat(300));
        let (text, column) = preview(&line, 300, 306);
        assert_eq!(&text[column..column + 6], "needle");
        assert!(text.chars().count() <= PREVIEW + 1);
        assert_eq!(preview("    x = 1", 4, 5), ("x = 1".into(), 0));
        let json = serde_json::to_value(SearchEvent::Done { id: 1, files: 2, total: 3, truncated: false, cancelled: false, millis: 4 }).unwrap();
        assert_eq!(json["event"], "done");
        let json = serde_json::to_value(SearchEvent::Matches { id: 1, matches: vec![] }).unwrap();
        assert_eq!(json["event"], "matches");
    }
}
