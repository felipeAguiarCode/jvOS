//! JARVIS's conversation: the Claude Code CLI (`claude -p`) in stream-json mode, kept running
//! between questions so an answer starts in about a second. The text streams back to the UI on
//! a Channel as it is written; the conversation itself is Claude Code's own session, resumed by
//! id when the process has to start again (after a cancel, or a restart of JARVIS).
//!
//! JARVIS works in its own folder (Documentos\JARVIS: notes, agent drafts, his memory) and
//! nowhere else: `--restricted` confines the file tools to it and leaves out every tool that
//! runs commands. It acts on the jvOS through JARVIS's MCP server (see `mcp.rs`).

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

/// Who JARVIS is, appended to Claude Code's own system prompt.
const PERSONA: &str = include_str!("../assistant-persona.md");
/// JARVIS's long-term memory, in his folder: what the user asked him to remember.
const MEMORY_FILE: &str = "Memória.md";
/// The memory goes on the command line with the persona (Windows caps it at 32 767 characters).
const MAX_MEMORY: usize = 8000;
/// The web and the files of JARVIS's folder; no command runs.
const TOOLS: &str = "WebSearch,WebFetch,Read,Edit,Write,Glob,Grep";
/// All allowed without asking: `--restricted` already keeps the file tools inside the folder,
/// and anything else that would ask is refused (`dontAsk`).
const ALLOWED: [&str; 8] = ["WebSearch", "WebFetch", "Read", "Edit", "Write", "Glob", "Grep", "mcp__jarvis"];
/// Writing a file streams its content: the UI gets it again after at least this many new characters.
const FILE_STEP: usize = 24;
const NOT_FOUND: &str = "Claude Code não encontrado. Instale-o (claude.ai/code) e entre na sua conta rodando `claude` uma vez.";
const BUSY: &str = "Ainda estou respondendo.";
/// The last lines Claude Code wrote to stderr, to explain a process that ended mid-answer.
const STDERR_LINES: usize = 12;

/// What the UI receives while a question is answered.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AssistantEvent {
    /// The Claude Code session holding the conversation (to resume it later).
    Session { id: String },
    /// More of the answer.
    Delta { text: String },
    /// A tool started (a web search, a file, a jvOS action).
    Tool { name: String },
    /// A file JARVIS is writing: its `content` so far while the Write streams in, then `done`
    /// (no content) once it is on disk — after a Write or an Edit.
    File { path: String, content: Option<String>, done: bool },
    /// The answer is complete (`text` is all of it), failed, or was cancelled.
    Done { text: String, error: Option<String>, cancelled: bool },
}

/// JARVIS's folder and its parts.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub root: PathBuf,
    pub notes: PathBuf,
    pub agents: PathBuf,
}

impl Folder {
    pub fn new(root: PathBuf) -> Self {
        Self { notes: root.join("Notas"), agents: root.join("Agentes"), root }
    }
}

/// The running `claude` process.
struct Process {
    child: Child,
    stdin: ChildStdin,
    /// The `--model` it runs with ("default": none given).
    model: String,
}

#[derive(Default)]
struct Shared {
    /// Where the question being answered streams to.
    turn: Option<Channel<AssistantEvent>>,
    session: Option<String>,
    stderr: VecDeque<String>,
    /// Bumped whenever a process is replaced, so the readers of a killed one go quiet.
    generation: u64,
}

pub struct Assistant {
    /// Claude Code's working folder: away from any project, so no CLAUDE.md is picked up.
    folder: Folder,
    /// JARVIS's MCP server, for `--mcp-config` (None: it could not start).
    mcp_config: Option<PathBuf>,
    process: Mutex<Option<Process>>,
    shared: Arc<Mutex<Shared>>,
}

impl Assistant {
    pub fn new(folder: Folder, mcp_config: Option<PathBuf>) -> Self {
        Self { folder, mcp_config, process: Mutex::new(None), shared: Arc::default() }
    }

    pub fn folder(&self) -> &Folder {
        &self.folder
    }

    /// Starts Claude Code ahead of the question (when JARVIS opens, while the user is talking).
    /// An answer in progress is left alone.
    pub fn warm(&self, session: Option<String>, model: &str) -> Result<(), String> {
        let mut process = self.process.lock().unwrap();
        if self.shared.lock().unwrap().turn.is_some() {
            return Ok(());
        }
        self.ensure(&mut process, session, model).map(|_| ())
    }

    /// Sends a question; the answer streams to `channel` and always ends with a `Done`.
    pub fn ask(&self, text: &str, session: Option<String>, model: &str, channel: Channel<AssistantEvent>) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("Pergunta vazia".into());
        }
        let mut process = self.process.lock().unwrap();
        if self.shared.lock().unwrap().turn.is_some() {
            return Err(BUSY.into());
        }
        let running = self.ensure(&mut process, session, model)?;
        // Set before writing, so not even the first event can be missed.
        self.shared.lock().unwrap().turn = Some(channel);
        let message = json!({ "type": "user", "message": { "role": "user", "content": text }, "parent_tool_use_id": null });
        let sent = writeln!(running.stdin, "{message}").and_then(|()| running.stdin.flush());
        if let Err(error) = sent {
            self.shared.lock().unwrap().turn = None;
            self.stop(&mut process);
            return Err(format!("Falha ao falar com o Claude Code: {error}"));
        }
        Ok(())
    }

    /// Stops the answer in progress. The process goes with it; the session stays, so the next
    /// question picks the conversation up again.
    pub fn cancel(&self) {
        let mut process = self.process.lock().unwrap();
        let Some(channel) = self.shared.lock().unwrap().turn.take() else { return };
        self.stop(&mut process);
        let _ = channel.send(AssistantEvent::Done { text: String::new(), error: None, cancelled: true });
    }

    /// "Nova conversa": forgets the session (an answer in progress is cancelled).
    pub fn reset(&self) {
        let mut process = self.process.lock().unwrap();
        let turn = {
            let mut shared = self.shared.lock().unwrap();
            shared.session = None;
            shared.turn.take()
        };
        self.stop(&mut process);
        if let Some(channel) = turn {
            let _ = channel.send(AssistantEvent::Done { text: String::new(), error: None, cancelled: true });
        }
    }

    /// JARVIS is closing: no `claude` outlives it.
    pub fn close(&self) {
        let mut process = self.process.lock().unwrap();
        self.stop(&mut process);
    }

    fn stop(&self, process: &mut Option<Process>) {
        self.shared.lock().unwrap().generation += 1;
        if let Some(mut old) = process.take() {
            crate::git::kill_tree(&mut old.child);
            let _ = old.child.wait();
        }
    }

    /// The running process, started (or restarted on `session`, or with another model) when needed.
    fn ensure<'a>(&self, process: &'a mut Option<Process>, session: Option<String>, model: &str) -> Result<&'a mut Process, String> {
        let alive = process.as_mut().is_some_and(|running| matches!(running.child.try_wait(), Ok(None)));
        let same_model = process.as_ref().is_some_and(|running| running.model == model);
        let known = self.shared.lock().unwrap().session.clone();
        // A conversation from before (the history kept in the UI) that this process is not on.
        let other = session.as_ref().is_some_and(|wanted| known.as_ref().is_some_and(|current| current != wanted));
        if !alive || !same_model || other {
            self.stop(process);
            // A session that is gone (deleted, or from another machine) cannot be resumed:
            // Claude Code would only answer "No conversation found". A new one starts instead.
            *process = Some(self.spawn(session.or(known).filter(|id| session_exists(id)), model)?);
        }
        Ok(process.as_mut().expect("just started"))
    }

    /// The persona, and what JARVIS was asked to remember (read again each time he starts).
    fn system_prompt(&self) -> String {
        let memory = std::fs::read_to_string(self.folder.root.join(MEMORY_FILE)).unwrap_or_default();
        let memory: String = memory.trim().chars().take(MAX_MEMORY).collect();
        if memory.is_empty() {
            return PERSONA.to_string();
        }
        format!("{PERSONA}\nO que você já guardou em {MEMORY_FILE}:\n\n{memory}\n")
    }

    fn spawn(&self, resume: Option<String>, model: &str) -> Result<Process, String> {
        let exe = claude_exe().ok_or(NOT_FOUND)?;
        for dir in [&self.folder.root, &self.folder.notes, &self.folder.agents] {
            std::fs::create_dir_all(dir).map_err(|error| format!("Falha ao criar {}: {error}", dir.display()))?;
        }
        let mut command = Command::new(exe);
        command
            .args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
            .args(["--restricted", "--tools", TOOLS, "--permission-mode", "dontAsk", "--allowedTools"])
            .args(ALLOWED)
            // Only JARVIS's own server: the user's connectors would hold the first answer back.
            .arg("--strict-mcp-config");
        if let Some(config) = &self.mcp_config {
            command.arg("--mcp-config").arg(config);
        }
        // The user's own default can be a slow model at a high effort: JARVIS talks, so he picks his.
        if model != "default" {
            command.args(["--model", model]);
        }
        command.args(["--disable-slash-commands", "--effort", "low", "--append-system-prompt"]).arg(self.system_prompt());
        if let Some(id) = &resume {
            command.args(["--resume", id]);
        }
        command
            .current_dir(&self.folder.root)
            // A running claude.exe cannot be replaced; the user's own sessions update it.
            .env("DISABLE_AUTOUPDATER", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(crate::launcher::CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| format!("Não consegui iniciar o Claude Code: {error}"))?;
        let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            crate::git::kill_tree(&mut child);
            return Err("Não consegui iniciar o Claude Code".into());
        };
        let generation = {
            let mut shared = self.shared.lock().unwrap();
            shared.generation += 1;
            shared.session = resume;
            shared.stderr.clear();
            shared.generation
        };
        let errors = {
            let shared = self.shared.clone();
            std::thread::spawn(move || read_errors(stderr, &shared, generation))
        };
        let shared = self.shared.clone();
        std::thread::spawn(move || read_output(stdout, &shared, generation, errors));
        Ok(Process { child, stdin, model: model.to_string() })
    }
}

/// "anota que…": a line in the day's notes (`Notas/AAAA-MM-DD Anotações.md`), written at once
/// with no Claude Code involved. `date` ("AAAA-MM-DD") and `time` ("HH:MM") are the user's
/// local ones, from the UI. Returns the file.
pub fn append_note(folder: &Folder, text: &str, date: &str, time: &str) -> Result<PathBuf, String> {
    let digits = |value: &str, separator: char, len: usize| {
        value.len() == len && value.chars().all(|c| c.is_ascii_digit() || c == separator)
    };
    if !digits(date, '-', 10) || !digits(time, ':', 5) {
        return Err("Data inválida".into());
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("Nada para anotar".into());
    }
    std::fs::create_dir_all(&folder.notes).map_err(|error| error.to_string())?;
    let path = folder.notes.join(format!("{date} Anotações.md"));
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|error| error.to_string())?;
    let fresh = file.metadata().map(|meta| meta.len() == 0).unwrap_or(false);
    let (year, rest) = date.split_at(4);
    let header = if fresh { format!("# Anotações de {}/{}/{year}\n\n", &rest[4..6], &rest[1..3]) } else { String::new() };
    writeln!(file, "{header}- **{time}** {text}").map_err(|error| error.to_string())?;
    Ok(path)
}

/// The native installer's claude.exe: on the PATH, or where the installer puts it.
pub(crate) fn claude_exe() -> Option<PathBuf> {
    crate::terminal::on_path("claude.exe").or_else(|| {
        let home = std::env::var_os("USERPROFILE")?;
        Some(Path::new(&home).join(".local").join("bin").join("claude.exe")).filter(|path| path.is_file())
    })
}

/// Whether Claude Code still has the session's transcript (`<config>/projects/<folder>/<id>.jsonl`).
/// When that cannot be told, it is assumed to be there.
fn session_exists(id: &str) -> bool {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return false;
    }
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|home| Path::new(&home).join(".claude")));
    let Some(Ok(projects)) = config.map(|dir| std::fs::read_dir(dir.join("projects"))) else { return true };
    let file = format!("{id}.jsonl");
    projects.flatten().any(|project| project.path().join(&file).is_file())
}

fn read_errors(stderr: impl Read, shared: &Mutex<Shared>, generation: u64) {
    for line in BufReader::new(stderr).lines() {
        let Ok(line) = line else { break };
        let mut shared = shared.lock().unwrap();
        if shared.generation != generation {
            return;
        }
        if shared.stderr.len() == STDERR_LINES {
            shared.stderr.pop_front();
        }
        shared.stderr.push_back(line);
    }
}

fn read_output(stdout: impl Read, shared: &Mutex<Shared>, generation: u64, errors: JoinHandle<()>) {
    let mut turn = Turn::default();
    // Claude Code announces its session before it answers; failing before that, it never had one.
    let mut started = false;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        let events = parse_line(&value, &mut turn);
        if events.is_empty() {
            continue;
        }
        let mut shared = shared.lock().unwrap();
        if shared.generation != generation {
            return;
        }
        for event in events {
            if let AssistantEvent::Session { id } = &event {
                started = true;
                shared.session = Some(id.clone());
            }
            let done = matches!(event, AssistantEvent::Done { .. });
            // E.g. a session that could not be resumed: the next question starts a new one.
            if done && !started {
                shared.session = None;
            }
            if let Some(channel) = &shared.turn {
                let _ = channel.send(event);
            }
            if done {
                shared.turn = None;
            }
        }
    }
    // The process ended. Mid-answer, say why (stderr is complete once its reader is done).
    let _ = errors.join();
    let mut shared = shared.lock().unwrap();
    if shared.generation != generation {
        return;
    }
    if let Some(channel) = shared.turn.take() {
        let said = shared.stderr.iter().map(String::as_str).collect::<Vec<_>>().join("\n");
        let error = if said.trim().is_empty() { "O Claude Code encerrou sem responder".to_string() } else { said };
        let _ = channel.send(AssistantEvent::Done { text: turn.text, error: Some(error), cancelled: false });
    }
}

/// A tool call whose input is still streaming in.
struct ToolBlock {
    id: String,
    name: String,
    /// The input so far (JSON, cut anywhere).
    json: String,
    /// How much of a Write's content the UI has already been sent (characters).
    sent: usize,
}

/// The answer being streamed.
#[derive(Default)]
struct Turn {
    text: String,
    /// A new text block began after some text (e.g. after a web search): keep them apart.
    paragraph: bool,
    /// Tool calls being written, by content block index.
    blocks: HashMap<u64, ToolBlock>,
    /// Writes and edits waiting for their result: the file of each tool call.
    writes: HashMap<String, String>,
}

fn writes_files(tool: &str) -> bool {
    tool == "Write" || tool == "Edit"
}

/// One line of `--output-format stream-json`, as events for the UI.
fn parse_line(value: &Value, turn: &mut Turn) -> Vec<AssistantEvent> {
    // Only JARVIS's own words and files: not those of a subagent working for it.
    let own = value["parent_tool_use_id"].is_null();
    match value["type"].as_str() {
        Some("system") if value["subtype"] == "init" => match value["session_id"].as_str() {
            Some(id) => vec![AssistantEvent::Session { id: id.to_string() }],
            None => Vec::new(),
        },
        Some("stream_event") if own => {
            let event = &value["event"];
            let index = event["index"].as_u64().unwrap_or_default();
            match event["type"].as_str() {
                Some("content_block_start") => match event["content_block"]["type"].as_str() {
                    Some("text") => {
                        turn.paragraph = !turn.text.is_empty();
                        Vec::new()
                    }
                    Some("tool_use" | "server_tool_use") => {
                        let block = &event["content_block"];
                        let name = block["name"].as_str().unwrap_or_default().to_string();
                        let id = block["id"].as_str().unwrap_or_default().to_string();
                        turn.blocks.insert(index, ToolBlock { id, name: name.clone(), json: String::new(), sent: 0 });
                        vec![AssistantEvent::Tool { name }]
                    }
                    _ => Vec::new(),
                },
                Some("content_block_delta") => match event["delta"]["type"].as_str() {
                    Some("text_delta") => {
                        let delta = event["delta"]["text"].as_str().unwrap_or_default();
                        if delta.is_empty() {
                            return Vec::new();
                        }
                        let text = if std::mem::take(&mut turn.paragraph) { format!("\n\n{delta}") } else { delta.to_string() };
                        turn.text.push_str(&text);
                        vec![AssistantEvent::Delta { text }]
                    }
                    // A Write's content shows in its editor as it is written.
                    Some("input_json_delta") => {
                        let Some(block) = turn.blocks.get_mut(&index) else { return Vec::new() };
                        block.json.push_str(event["delta"]["partial_json"].as_str().unwrap_or_default());
                        if block.name != "Write" {
                            return Vec::new();
                        }
                        let (Some((path, true)), Some((content, _))) = (partial_field(&block.json, "file_path"), partial_field(&block.json, "content")) else {
                            return Vec::new();
                        };
                        let length = content.chars().count();
                        if length < block.sent + FILE_STEP {
                            return Vec::new();
                        }
                        block.sent = length;
                        vec![AssistantEvent::File { path, content: Some(content), done: false }]
                    }
                    _ => Vec::new(),
                },
                Some("content_block_stop") => {
                    let Some(block) = turn.blocks.remove(&index).filter(|block| writes_files(&block.name)) else { return Vec::new() };
                    let Ok(input) = serde_json::from_str::<Value>(&block.json) else { return Vec::new() };
                    let Some(path) = input["file_path"].as_str() else { return Vec::new() };
                    turn.writes.insert(block.id, path.to_string());
                    // The whole of a Write's content, whatever was left out of the steps.
                    match input["content"].as_str().filter(|_| block.name == "Write") {
                        Some(content) => vec![AssistantEvent::File { path: path.to_string(), content: Some(content.to_string()), done: false }],
                        None => Vec::new(),
                    }
                }
                _ => Vec::new(),
            }
        }
        // Tool results: a write or an edit that made it to disk.
        Some("user") if own => value["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["type"] == "tool_result")
            .filter_map(|item| {
                let path = turn.writes.remove(item["tool_use_id"].as_str()?)?;
                (item["is_error"] != true).then_some(AssistantEvent::File { path, content: None, done: true })
            })
            .collect(),
        Some("result") => {
            let Turn { text: streamed, .. } = std::mem::take(turn);
            let result = value["result"].as_str().unwrap_or_default();
            let failed = value["is_error"] == true || value["subtype"] != "success";
            let error = failed.then(|| {
                let errors: Vec<&str> = value["errors"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
                if !errors.is_empty() {
                    errors.join("\n")
                } else if !result.is_empty() {
                    result.to_string()
                } else {
                    format!("O Claude Code falhou ({})", value["subtype"].as_str().unwrap_or("erro"))
                }
            });
            // What was shown is the answer; `result` only has the last message (and is all
            // there is when nothing streamed).
            let text = if streamed.is_empty() && !failed { result.to_string() } else { streamed };
            vec![AssistantEvent::Done { text, error, cancelled: false }]
        }
        _ => Vec::new(),
    }
}

/// A string field of a JSON object that is still being written — `{"file_path": "C:\\x", "content": "Ol`:
/// its value so far and whether it is complete. Top-level fields only; None until the field
/// starts (or when the text is not an object). An escape cut in half waits for its other half.
fn partial_field(json: &str, key: &str) -> Option<(String, bool)> {
    let chars: Vec<char> = json.chars().collect();
    let mut at = 0;
    let skip_space = |at: &mut usize| {
        while chars.get(*at).is_some_and(|c| c.is_whitespace()) {
            *at += 1;
        }
    };
    skip_space(&mut at);
    if chars.get(at) != Some(&'{') {
        return None;
    }
    at += 1;
    loop {
        skip_space(&mut at);
        match chars.get(at)? {
            ',' => {
                at += 1;
                continue;
            }
            '"' => {}
            _ => return None,
        }
        at += 1;
        let (name, closed) = json_string(&chars, &mut at);
        if !closed {
            return None;
        }
        skip_space(&mut at);
        if chars.get(at) != Some(&':') {
            return None;
        }
        at += 1;
        skip_space(&mut at);
        if *chars.get(at)? == '"' {
            at += 1;
            let (value, closed) = json_string(&chars, &mut at);
            if name == key {
                return Some((value, closed));
            }
            if !closed {
                return None;
            }
        } else {
            // Another kind of value: skipped up to the next field.
            let mut depth = 0usize;
            loop {
                match chars.get(at)? {
                    '"' => {
                        at += 1;
                        if !json_string(&chars, &mut at).1 {
                            return None;
                        }
                        continue;
                    }
                    '{' | '[' => depth += 1,
                    '}' | ']' if depth == 0 => return None,
                    '}' | ']' => depth -= 1,
                    ',' if depth == 0 => break,
                    _ => {}
                }
                at += 1;
            }
        }
    }
}

/// Decodes a JSON string from just after its opening quote; stops at its end (true) or where
/// the text runs out (false).
fn json_string(chars: &[char], at: &mut usize) -> (String, bool) {
    let mut out = String::new();
    while let Some(&c) = chars.get(*at) {
        match c {
            '"' => {
                *at += 1;
                return (out, true);
            }
            '\\' => {
                let Some(&escaped) = chars.get(*at + 1) else { break };
                let simple = match escaped {
                    'n' => Some('\n'),
                    't' => Some('\t'),
                    'r' => Some('\r'),
                    'b' => Some('\u{8}'),
                    'f' => Some('\u{c}'),
                    'u' => None,
                    other => Some(other),
                };
                if let Some(decoded) = simple {
                    out.push(decoded);
                    *at += 2;
                    continue;
                }
                let unit = |from: usize| -> Option<u32> {
                    let hex: String = chars.get(from..from + 4)?.iter().collect();
                    u32::from_str_radix(&hex, 16).ok()
                };
                let Some(first) = unit(*at + 2) else { break };
                if (0xD800..0xDC00).contains(&first) {
                    // A surrogate pair: both halves are needed.
                    let second = (chars.get(*at + 6) == Some(&'\\') && chars.get(*at + 7) == Some(&'u')).then(|| unit(*at + 8)).flatten();
                    let Some(second) = second else { break };
                    out.extend(char::from_u32(0x10000 + ((first - 0xD800) << 10) + (second.wrapping_sub(0xDC00) & 0x3FF)));
                    *at += 12;
                } else {
                    out.extend(char::from_u32(first));
                    *at += 6;
                }
            }
            _ => {
                out.push(c);
                *at += 1;
            }
        }
    }
    (out, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lines as `claude` 2.1.310 wrote them (trimmed to the fields that matter).
    const INIT: &str = r#"{"type":"system","subtype":"init","cwd":"C:\\x","session_id":"a926d26e-626f-4187-a399-be5016a22db0","tools":["WebFetch","WebSearch"],"permissionMode":"dontAsk"}"#;
    const TEXT_START: &str = r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"parent_tool_use_id":null}"#;
    const SEARCH_START: &str = r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"WebSearch","input":{}}},"parent_tool_use_id":null}"#;
    const ASSISTANT: &str = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Olá. 7 vezes 8 é 56."}]},"parent_tool_use_id":null}"#;
    const SUCCESS: &str = r#"{"duration_api_ms":1565,"stop_reason":"end_turn","session_id":"a926d26e","type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"7 vezes 8 é 56."}"#;

    fn delta(text: &str) -> String {
        json!({ "type": "stream_event", "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } }, "parent_tool_use_id": null }).to_string()
    }

    fn feed(turn: &mut Turn, lines: &[&str]) -> Vec<AssistantEvent> {
        lines.iter().flat_map(|line| parse_line(&serde_json::from_str(line).unwrap(), turn)).collect()
    }

    #[test]
    fn streams_the_answer_and_ends_the_turn() {
        let mut turn = Turn::default();
        let (first, second) = (delta("Olá. 7 vezes "), delta("8 é 56."));
        let events = feed(&mut turn, &[INIT, TEXT_START, &first, &second, ASSISTANT, SUCCESS]);
        assert_eq!(
            events,
            [
                AssistantEvent::Session { id: "a926d26e-626f-4187-a399-be5016a22db0".into() },
                AssistantEvent::Delta { text: "Olá. 7 vezes ".into() },
                AssistantEvent::Delta { text: "8 é 56.".into() },
                // The whole streamed answer, not just `result` (the last message).
                AssistantEvent::Done { text: "Olá. 7 vezes 8 é 56.".into(), error: None, cancelled: false },
            ]
        );
        assert!(turn.text.is_empty());
    }

    #[test]
    fn a_web_search_splits_the_answer_into_paragraphs() {
        let mut turn = Turn::default();
        let (before, after) = (delta("Vou verificar."), delta("O dólar fechou a R$ 5,40."));
        let events = feed(&mut turn, &[TEXT_START, &before, SEARCH_START, TEXT_START, &after]);
        assert_eq!(
            events,
            [
                AssistantEvent::Delta { text: "Vou verificar.".into() },
                AssistantEvent::Tool { name: "WebSearch".into() },
                AssistantEvent::Delta { text: "\n\nO dólar fechou a R$ 5,40.".into() },
            ]
        );
    }

    #[test]
    fn nothing_streamed_falls_back_to_the_result() {
        let mut turn = Turn::default();
        assert_eq!(feed(&mut turn, &[SUCCESS]), [AssistantEvent::Done { text: "7 vezes 8 é 56.".into(), error: None, cancelled: false }]);
    }

    #[test]
    fn failures_carry_their_reason() {
        let mut turn = Turn::default();
        let logged_out = r#"{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}"#;
        let crashed = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["boom","again"]}"#;
        let bare = r#"{"type":"result","subtype":"error_max_turns","is_error":true}"#;
        let events = feed(&mut turn, &[logged_out, crashed, bare]);
        let errors: Vec<_> = events
            .iter()
            .map(|event| match event {
                AssistantEvent::Done { error, .. } => error.clone().unwrap(),
                other => panic!("unexpected {other:?}"),
            })
            .collect();
        assert_eq!(errors, ["Not logged in · Please run /login", "boom\nagain", "O Claude Code falhou (error_max_turns)"]);
    }

    fn tool_start(index: u64, id: &str, name: &str) -> String {
        json!({ "type": "stream_event", "event": { "type": "content_block_start", "index": index, "content_block": { "type": "tool_use", "id": id, "name": name, "input": {} } }, "parent_tool_use_id": null }).to_string()
    }

    fn tool_input(index: u64, partial: &str) -> String {
        json!({ "type": "stream_event", "event": { "type": "content_block_delta", "index": index, "delta": { "type": "input_json_delta", "partial_json": partial } }, "parent_tool_use_id": null }).to_string()
    }

    fn block_stop(index: u64) -> String {
        json!({ "type": "stream_event", "event": { "type": "content_block_stop", "index": index }, "parent_tool_use_id": null }).to_string()
    }

    fn tool_result(id: &str, error: bool) -> String {
        json!({ "type": "user", "message": { "role": "user", "content": [{ "tool_use_id": id, "type": "tool_result", "content": "ok", "is_error": error }] }, "parent_tool_use_id": null }).to_string()
    }

    /// A tool call's input in the order Claude writes it (the file first), cut in pieces of
    /// `size` characters as the stream sends it.
    fn pieces(fields: &[(&str, &str)], size: usize) -> Vec<String> {
        let input = format!("{{{}}}", fields.iter().map(|(key, value)| format!("{}: {}", json!(key), json!(value))).collect::<Vec<_>>().join(", "));
        let chars: Vec<char> = input.chars().collect();
        chars.chunks(size).map(|piece| piece.iter().collect()).collect()
    }

    #[test]
    fn a_write_streams_its_content_then_lands_on_disk() {
        let path = r"C:\Users\x\Documents\JARVIS\Notas\2026-10-26 Reunião.md";
        let content = "# Reunião\n\n- Decidimos usar o \"núcleo\" como ponte.\n- Próximo passo: notas por voz 😀.\n";
        let mut lines = vec![tool_start(0, "toolu_w", "Write")];
        lines.extend(pieces(&[("file_path", path), ("content", content)], 7).iter().map(|piece| tool_input(0, piece)));
        lines.extend([block_stop(0), tool_result("toolu_w", false)]);
        let mut turn = Turn::default();
        let events = feed(&mut turn, &lines.iter().map(String::as_str).collect::<Vec<_>>());

        assert_eq!(events[0], AssistantEvent::Tool { name: "Write".into() });
        let shown: Vec<&str> = events
            .iter()
            .filter_map(|event| match event {
                AssistantEvent::File { path: written, content: Some(text), done: false } if written == path => Some(text.as_str()),
                _ => None,
            })
            .collect();
        // Several steps, each a beginning of the content, ending with all of it.
        assert!(shown.len() >= 3, "{shown:?}");
        assert!(shown.iter().all(|text| content.starts_with(text)));
        assert_eq!(shown.last(), Some(&content));
        assert_eq!(events.last(), Some(&AssistantEvent::File { path: path.into(), content: None, done: true }));
    }

    #[test]
    fn an_edit_reports_its_file_once_done_and_failures_report_nothing() {
        let edit = [("file_path", r"C:\J\Agentes\revisor.md"), ("old_string", "a"), ("new_string", "b")];
        let mut lines = vec![tool_start(1, "toolu_e", "Edit")];
        lines.extend(pieces(&edit, 9).iter().map(|piece| tool_input(1, piece)));
        lines.push(block_stop(1));
        let mut turn = Turn::default();
        let before: Vec<&str> = lines.iter().map(String::as_str).collect();
        assert_eq!(feed(&mut turn, &before), [AssistantEvent::Tool { name: "Edit".into() }]);
        assert_eq!(feed(&mut turn, &[&tool_result("toolu_e", false)]), [AssistantEvent::File { path: r"C:\J\Agentes\revisor.md".into(), content: None, done: true }]);

        let mut failed = Turn::default();
        let write = json!({ "file_path": r"C:\fora.txt", "content": "x" }).to_string();
        feed(&mut failed, &[&tool_start(0, "toolu_x", "Write"), &tool_input(0, &write), &block_stop(0)]);
        assert!(feed(&mut failed, &[&tool_result("toolu_x", true)]).is_empty());
    }

    #[test]
    fn partial_fields_are_read_as_they_arrive() {
        assert_eq!(partial_field(r#"{"file_path": "C:\\x", "content": "Ol"#, "file_path"), Some((r"C:\x".into(), true)));
        assert_eq!(partial_field(r#"{"file_path": "C:\\x", "content": "Ol"#, "content"), Some(("Ol".into(), false)));
        assert_eq!(partial_field(r#"{"content": "a\nb \"c\" \u00e7\u00e3o \ud83d\ude00"#, "content"), Some(("a\nb \"c\" ção 😀".into(), false)));
        // Escapes cut in half wait for the rest.
        for cut in [r#"{"content": "ab\"#, r#"{"content": "ab\u00"#, r#"{"content": "ab\ud83d"#, r#"{"content": "ab\ud83d\u"#] {
            assert_eq!(partial_field(cut, "content"), Some(("ab".into(), false)), "{cut}");
        }
        assert_eq!(partial_field(r#"{"n": 3, "o": {"a": [1, "}"]}, "content": "z"}"#, "content"), Some(("z".into(), true)));
        assert_eq!(partial_field(r#"{"file_path": "x""#, "content"), None);
        assert_eq!(partial_field(r#"{"file_pa"#, "file_path"), None);
        assert_eq!(partial_field(r#"["content"]"#, "content"), None);
    }

    #[test]
    fn quick_notes_go_to_the_days_file() {
        let root = std::env::temp_dir().join(format!("jarvis-notes-test-{}", std::process::id()));
        let folder = Folder::new(root.clone());
        let path = append_note(&folder, "  comprar\n café ", "2026-10-27", "09:05").unwrap();
        append_note(&folder, "ligar para a Ana", "2026-10-27", "14:30").unwrap();
        assert_eq!(path, folder.notes.join("2026-10-27 Anotações.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Anotações de 27/10/2026\n\n- **09:05** comprar café\n- **14:30** ligar para a Ana\n");
        assert!(append_note(&folder, "x", "../../evil", "09:05").is_err());
        assert!(append_note(&folder, "   ", "2026-10-27", "09:05").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_memory_joins_the_persona() {
        let root = std::env::temp_dir().join(format!("jarvis-memory-test-{}", std::process::id()));
        let assistant = Assistant::new(Folder::new(root.clone()), None);
        assert_eq!(assistant.system_prompt(), PERSONA);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(MEMORY_FILE), "- Mora em Curitiba.\n").unwrap();
        let prompt = assistant.system_prompt();
        assert!(prompt.starts_with(PERSONA) && prompt.ends_with("- Mora em Curitiba.\n"), "{prompt}");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_session_ids_are_looked_up() {
        assert!(!session_exists(""));
        assert!(!session_exists("..\\..\\settings"));
        assert!(!session_exists("00000000-0000-4000-8000-00000000000g"));
    }

    #[test]
    fn subagents_and_other_lines_are_ignored() {
        let mut turn = Turn::default();
        let subagent = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"interno"}},"parent_tool_use_id":"toolu_9"}"#;
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}},"parent_tool_use_id":null}"#;
        let rate = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#;
        let status = r#"{"type":"system","subtype":"status","status":"requesting"}"#;
        assert!(feed(&mut turn, &[subagent, thinking, rate, status, ASSISTANT]).is_empty());
    }
}
