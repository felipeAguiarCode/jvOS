//! JARVIS's conversation: the Claude Code CLI (`claude -p`) in stream-json mode, kept running
//! between questions so an answer starts in about a second. The text streams back to the UI on
//! a Channel as it is written; the conversation itself is Claude Code's own session, resumed by
//! id when the process has to start again (after a cancel, or a restart of JARVIS).
//!
//! JARVIS works in its own folder (Documentos\JARVIS: notes, agent drafts, his memory) and
//! nowhere else: `--restricted` confines the file tools to it and leaves out every tool that
//! runs commands. It acts on the jvOS through JARVIS's MCP server (see `mcp.rs`).
//!
//! Each conversation of the chat has a process of its own (a slot), so several can be answered
//! at once (up to `MAX_ANSWERING`) and an agent can answer one of them, under the same
//! confinement, with its own instructions in place of JARVIS's persona (ADR-0028).

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
/// ...or this share of what already arrived, whichever is more. Each update re-reads the whole
/// input and sends the whole content so far, so fixed steps made a long file cost quadratic time
/// (a 50 KB note: ~2000 full re-reads and sends); growing steps keep it near linear. The final
/// content always arrives with the block's end.
const FILE_STEP_SHARE: usize = 32;
const NOT_FOUND: &str = "Claude Code não encontrado. Instale-o (claude.ai/code) e entre na sua conta rodando `claude` uma vez.";
const BUSY: &str = "Ainda estou respondendo.";
/// How many conversations can be answered at once: each one is a claude.exe of about 200 MB.
pub const MAX_ANSWERING: usize = 5;
const TOO_MANY: &str = "Já estou respondendo em 5 conversas. Espere uma terminar.";
/// The conversation of a caller that names none.
pub const MAIN: &str = "main";
/// What an agent the user talks to in the chat is told, before its own instructions: it works
/// under JARVIS's confinement (the command line sees to that; this only says so).
const AGENT_RULES: &str = "Você é um agente do JARVIS OS conversando com o usuário pelo modo chat. Responda em português do Brasil, em Markdown, de forma direta. Você trabalha com as mesmas ferramentas do JARVIS: pesquisar na web, ler e escrever arquivos somente na sua pasta de trabalho (Documentos\\JARVIS, com as pastas Notas e Agentes) e as ferramentas mcp__jarvis do jvOS. Você não roda comandos e não acessa o resto do computador: se a tarefa exigir isso, diga que ela precisa ser rodada no terminal (o botão \"Rodar no terminal\" da conversa).";
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
    /// A file JARVIS read to answer: a source (the notes are its knowledge base).
    Source { path: String },
    /// A file JARVIS is writing: its `content` so far while the Write streams in, then `done`
    /// (no content) once it is on disk — after a Write or an Edit.
    File { path: String, content: Option<String>, done: bool },
    /// The answer is complete (`text` is all of it), failed, or was cancelled.
    Done { text: String, error: Option<String>, cancelled: bool },
}

/// JARVIS's folder and its parts.
/// What the memory cleanup ("limpa a memória", "ativa o garbage collector") did with Claude Code.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Sleep {
    /// Stopped while idle; `freed` is the RAM it held, in bytes.
    Stopped { freed: u64 },
    /// In the middle of an answer: left alone.
    Busy,
    /// Not running: nothing to give back.
    Idle,
}

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

/// Who answers and whom he answers (from the settings): a change starts a new process.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Profile {
    /// The `--model` it runs with ("default": none given).
    pub model: String,
    /// What JARVIS calls the user (empty: he does not know yet).
    pub name: String,
}

/// The running `claude` process.
struct Process {
    child: Child,
    stdin: ChildStdin,
    profile: Profile,
    /// The agent whose instructions it started with (None: JARVIS himself).
    agent: Option<String>,
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

/// One conversation's Claude Code: its process and the answer in progress. Each conversation of
/// the chat has its own, so one being answered does not hold the others (ADR-0028).
#[derive(Default)]
struct Slot {
    process: Mutex<Option<Process>>,
    shared: Arc<Mutex<Shared>>,
}

pub struct Assistant {
    /// Claude Code's working folder: away from any project, so no CLAUDE.md is picked up.
    folder: Folder,
    /// JARVIS's MCP server, for `--mcp-config` (None: it could not start).
    mcp_config: Option<PathBuf>,
    /// By conversation id (`MAIN` for a caller that names none).
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    /// Held while a question is let in, so two cannot both take the last place.
    admission: Mutex<()>,
}

fn stop(shared: &Mutex<Shared>, process: &mut Option<Process>) {
    shared.lock().unwrap().generation += 1;
    if let Some(mut old) = process.take() {
        crate::git::kill_tree(&mut old.child);
        let _ = old.child.wait();
    }
}

impl Assistant {
    pub fn new(folder: Folder, mcp_config: Option<PathBuf>) -> Self {
        Self { folder, mcp_config, slots: Mutex::default(), admission: Mutex::default() }
    }

    pub fn folder(&self) -> &Folder {
        &self.folder
    }

    /// The conversation's slot, made on its first use.
    fn slot(&self, conversation: &str) -> Arc<Slot> {
        self.slots.lock().unwrap().entry(conversation.to_string()).or_default().clone()
    }

    fn existing(&self, conversation: &str) -> Option<Arc<Slot>> {
        self.slots.lock().unwrap().get(conversation).cloned()
    }

    fn all(&self) -> Vec<(String, Arc<Slot>)> {
        self.slots.lock().unwrap().iter().map(|(name, slot)| (name.clone(), slot.clone())).collect()
    }

    /// How many conversations are being answered now.
    pub fn answering(&self) -> usize {
        self.all().iter().filter(|(_, slot)| slot.shared.lock().unwrap().turn.is_some()).count()
    }

    /// The idle processes of the other conversations stop: only the one in use stays warm, so the
    /// memory does not grow with the conversations (their sessions stay, to be resumed).
    fn trim(&self, keep: &str) {
        for (name, slot) in self.all() {
            if name == keep {
                continue;
            }
            // One that is starting or stopping right now is left for the next time.
            let Ok(mut process) = slot.process.try_lock() else { continue };
            if process.is_some() && slot.shared.lock().unwrap().turn.is_none() {
                stop(&slot.shared, &mut process);
            }
        }
    }

    /// Starts Claude Code ahead of the question (when JARVIS opens, a conversation is chosen,
    /// the user starts talking). An answer in progress is left alone.
    pub fn warm(&self, conversation: &str, session: Option<String>, profile: &Profile, agent: Option<&str>) -> Result<(), String> {
        let slot = self.slot(conversation);
        let mut process = slot.process.lock().unwrap();
        if slot.shared.lock().unwrap().turn.is_some() {
            return Ok(());
        }
        self.trim(conversation);
        self.ensure(&slot, &mut process, session, profile, agent).map(|_| ())
    }

    /// Sends a question; the answer streams to `channel` and always ends with a `Done`. One
    /// answer at a time in a conversation, and `MAX_ANSWERING` conversations at a time.
    pub fn ask(&self, conversation: &str, text: &str, session: Option<String>, profile: &Profile, agent: Option<&str>, channel: Channel<AssistantEvent>) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("Pergunta vazia".into());
        }
        let slot = self.slot(conversation);
        let mut process = slot.process.lock().unwrap();
        self.admit(&slot, channel)?;
        self.trim(conversation);
        let running = match self.ensure(&slot, &mut process, session, profile, agent) {
            Ok(running) => running,
            Err(error) => {
                slot.shared.lock().unwrap().turn = None;
                return Err(error);
            }
        };
        let message = json!({ "type": "user", "message": { "role": "user", "content": text }, "parent_tool_use_id": null });
        let sent = writeln!(running.stdin, "{message}").and_then(|()| running.stdin.flush());
        if let Err(error) = sent {
            slot.shared.lock().unwrap().turn = None;
            stop(&slot.shared, &mut process);
            return Err(format!("Falha ao falar com o Claude Code: {error}"));
        }
        Ok(())
    }

    /// Lets a question into a conversation: its answer's place is taken at once (before the
    /// process is there), so not even the first event can be missed and no other question can
    /// take the same place.
    fn admit(&self, slot: &Slot, channel: Channel<AssistantEvent>) -> Result<(), String> {
        let _admission = self.admission.lock().unwrap();
        if slot.shared.lock().unwrap().turn.is_some() {
            return Err(BUSY.into());
        }
        if self.answering() >= MAX_ANSWERING {
            return Err(TOO_MANY.into());
        }
        slot.shared.lock().unwrap().turn = Some(channel);
        Ok(())
    }

    /// Stops the conversation's answer in progress. The process goes with it; the session
    /// stays, so the next question picks the conversation up again.
    pub fn cancel(&self, conversation: &str) {
        let Some(slot) = self.existing(conversation) else { return };
        let mut process = slot.process.lock().unwrap();
        let Some(channel) = slot.shared.lock().unwrap().turn.take() else { return };
        stop(&slot.shared, &mut process);
        let _ = channel.send(AssistantEvent::Done { text: String::new(), error: None, cancelled: true });
    }

    /// "Nova conversa": the conversation forgets its session (an answer in progress is cancelled).
    pub fn reset(&self, conversation: &str) {
        let Some(slot) = self.existing(conversation) else { return };
        let mut process = slot.process.lock().unwrap();
        let turn = {
            let mut shared = slot.shared.lock().unwrap();
            shared.session = None;
            shared.turn.take()
        };
        stop(&slot.shared, &mut process);
        if let Some(channel) = turn {
            let _ = channel.send(AssistantEvent::Done { text: String::new(), error: None, cancelled: true });
        }
    }

    /// A conversation deleted in the UI: its transcript (`<config>/projects/<folder>/<id>.jsonl`)
    /// goes to the Recycle Bin. A process on that session stops and the session is forgotten
    /// first (an answer in progress is cancelled). False: there was no transcript.
    pub fn forget(&self, id: &str) -> Result<bool, String> {
        if !valid_session(id) {
            return Err("Sessão inválida".into());
        }
        for (_, slot) in self.all() {
            let mut process = slot.process.lock().unwrap();
            let turn = {
                let mut shared = slot.shared.lock().unwrap();
                if shared.session.as_deref() != Some(id) {
                    continue;
                }
                shared.session = None;
                shared.turn.take()
            };
            stop(&slot.shared, &mut process);
            if let Some(channel) = turn {
                let _ = channel.send(AssistantEvent::Done { text: String::new(), error: None, cancelled: true });
            }
        }
        let files = session_files(id);
        if files.is_empty() {
            return Ok(false);
        }
        crate::workspace::recycle(files)?;
        Ok(true)
    }

    /// The memory cleanup: every idle Claude Code stops and gives its RAM back (`freed` is the
    /// sum). The sessions stay, so the next question starts each one again on its conversation.
    /// Busy only when nothing could be stopped and some conversation is being answered.
    pub fn sleep(&self) -> Sleep {
        let (mut freed, mut stopped, mut busy) = (0u64, false, false);
        for (_, slot) in self.all() {
            let mut process = slot.process.lock().unwrap();
            if slot.shared.lock().unwrap().turn.is_some() {
                busy = true;
                continue;
            }
            let alive = process.as_mut().is_some_and(|running| matches!(running.child.try_wait(), Ok(None)));
            if alive {
                freed += process.as_ref().and_then(|running| crate::system::process_memory(running.child.id())).unwrap_or(0);
                stopped = true;
            }
            // One that already ended is only reaped.
            stop(&slot.shared, &mut process);
        }
        if stopped {
            Sleep::Stopped { freed }
        } else if busy {
            Sleep::Busy
        } else {
            Sleep::Idle
        }
    }

    /// JARVIS is closing: no `claude` outlives it.
    pub fn close(&self) {
        for (_, slot) in self.all() {
            let mut process = slot.process.lock().unwrap();
            stop(&slot.shared, &mut process);
        }
    }

    /// The conversation's process, started (or restarted on `session`, or with another model,
    /// name or agent) when needed.
    fn ensure<'a>(&self, slot: &Slot, process: &'a mut Option<Process>, session: Option<String>, profile: &Profile, agent: Option<&str>) -> Result<&'a mut Process, String> {
        let alive = process.as_mut().is_some_and(|running| matches!(running.child.try_wait(), Ok(None)));
        let same = process.as_ref().is_some_and(|running| running.profile == *profile && running.agent.as_deref() == agent);
        let known = slot.shared.lock().unwrap().session.clone();
        // A session the UI kept with the conversation that this process is not on.
        let other = session.as_ref().is_some_and(|wanted| known.as_ref().is_some_and(|current| current != wanted));
        if !alive || !same || other {
            stop(&slot.shared, process);
            // A session that is gone (deleted, or from another machine) cannot be resumed:
            // Claude Code would only answer "No conversation found". A new one starts instead.
            *process = Some(self.spawn(slot, session.or(known).filter(|id| session_exists(id)), profile, agent)?);
        }
        Ok(process.as_mut().expect("just started"))
    }

    /// Who answers. JARVIS: the persona, the user's name, and what he was asked to remember
    /// (read again each time he starts). An agent of the chat: its own instructions, under the
    /// rules of a contact.
    fn system_prompt(&self, name: &str, agent: Option<&str>) -> Result<String, String> {
        let user = if name.is_empty() {
            "Você ainda não sabe o nome do usuário: trate-o sem nome até ele dizer como quer ser chamado.".to_string()
        } else {
            format!("O usuário se chama {name}: é assim que você o chama (Configurações → Cérebro do JARVIS), a não ser que ele peça outra forma.")
        };
        if let Some(agent) = agent {
            let instructions = crate::agents::prompt(&self.folder, agent)?;
            return Ok(format!("{AGENT_RULES}\n\nVocê é o agente \"{agent}\". As suas instruções:\n\n{instructions}\n\n{user}\n"));
        }
        let memory = std::fs::read_to_string(self.folder.root.join(MEMORY_FILE)).unwrap_or_default();
        let memory: String = memory.trim().chars().take(MAX_MEMORY).collect();
        if memory.is_empty() {
            return Ok(format!("{PERSONA}\n{user}\n"));
        }
        Ok(format!("{PERSONA}\n{user}\n\nO que você já guardou em {MEMORY_FILE}:\n\n{memory}\n"))
    }

    /// The command line of every conversation's process, whoever answers: only the prompt and
    /// the session change. The confinement is here (`--restricted`, the tool list, `dontAsk`,
    /// only JARVIS's MCP server), not in the prompt.
    fn arguments(&self, profile: &Profile, prompt: &str, resume: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"].map(String::from).to_vec();
        args.extend(["--restricted", "--tools", TOOLS, "--permission-mode", "dontAsk", "--allowedTools"].map(String::from));
        args.extend(ALLOWED.map(String::from));
        // Only JARVIS's own server: the user's connectors would hold the first answer back.
        args.push("--strict-mcp-config".into());
        if let Some(config) = &self.mcp_config {
            args.extend(["--mcp-config".to_string(), config.display().to_string()]);
        }
        // The user's own default can be a slow model at a high effort: JARVIS talks, so he picks his.
        if profile.model != "default" {
            args.extend(["--model".to_string(), profile.model.clone()]);
        }
        args.extend(["--disable-slash-commands", "--effort", "low", "--append-system-prompt"].map(String::from));
        args.push(prompt.to_string());
        if let Some(id) = resume {
            args.extend(["--resume".to_string(), id.to_string()]);
        }
        args
    }

    fn spawn(&self, slot: &Slot, resume: Option<String>, profile: &Profile, agent: Option<&str>) -> Result<Process, String> {
        let exe = claude_exe().ok_or(NOT_FOUND)?;
        for dir in [&self.folder.root, &self.folder.notes, &self.folder.agents] {
            std::fs::create_dir_all(dir).map_err(|error| format!("Falha ao criar {}: {error}", dir.display()))?;
        }
        let prompt = self.system_prompt(&profile.name, agent)?;
        let mut command = Command::new(exe);
        command
            .args(self.arguments(profile, &prompt, resume.as_deref()))
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
            let mut shared = slot.shared.lock().unwrap();
            shared.generation += 1;
            shared.session = resume;
            shared.stderr.clear();
            shared.generation
        };
        let errors = {
            let shared = slot.shared.clone();
            std::thread::spawn(move || read_errors(stderr, &shared, generation))
        };
        let shared = slot.shared.clone();
        std::thread::spawn(move || read_output(stdout, &shared, generation, errors));
        Ok(Process { child, stdin, profile: profile.clone(), agent: agent.map(str::to_string) })
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
    if !valid_session(id) {
        return false;
    }
    let Some(Ok(projects)) = claude_config().map(|dir| std::fs::read_dir(dir.join("projects"))) else { return true };
    let file = format!("{id}.jsonl");
    projects.flatten().any(|project| project.path().join(&file).is_file())
}

/// A session id as Claude Code writes them (a UUID): nothing in it can leave the projects folder.
fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Claude Code's own folder (`CLAUDE_CONFIG_DIR`, or `~/.claude`).
fn claude_config() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|home| Path::new(&home).join(".claude")))
}

/// The session's transcripts: `<id>.jsonl` right under a project folder, nowhere else.
fn session_files(id: &str) -> Vec<PathBuf> {
    if !valid_session(id) {
        return Vec::new();
    }
    let Some(Ok(projects)) = claude_config().map(|dir| std::fs::read_dir(dir.join("projects"))) else { return Vec::new() };
    let file = format!("{id}.jsonl");
    projects.flatten().map(|project| project.path().join(&file)).filter(|path| path.is_file()).collect()
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
    /// Length of `json` when it was last parsed.
    parsed: usize,
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
                        turn.blocks.insert(index, ToolBlock { id, name: name.clone(), json: String::new(), sent: 0, parsed: 0 });
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
                        if block.name != "Write" || block.json.len() < block.parsed + FILE_STEP.max(block.parsed / FILE_STEP_SHARE) {
                            return Vec::new();
                        }
                        block.parsed = block.json.len();
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
                    let Some(block) = turn.blocks.remove(&index).filter(|block| writes_files(&block.name) || block.name == "Read") else { return Vec::new() };
                    let Ok(input) = serde_json::from_str::<Value>(&block.json) else { return Vec::new() };
                    let Some(path) = input["file_path"].as_str() else { return Vec::new() };
                    if block.name == "Read" {
                        return vec![AssistantEvent::Source { path: path.to_string() }];
                    }
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
    fn the_cleanup_has_nothing_to_stop_before_the_first_question() {
        let assistant = Assistant::new(Folder::new(std::env::temp_dir().join("jarvis-sleep-test")), None);
        assert_eq!(assistant.sleep(), Sleep::Idle);
        assert_eq!(serde_json::to_value(Sleep::Stopped { freed: 7 }).unwrap(), json!({ "outcome": "stopped", "freed": 7 }));
        assert_eq!(serde_json::to_value(Sleep::Busy).unwrap(), json!({ "outcome": "busy" }));
    }

    #[test]
    fn the_memory_joins_the_persona() {
        let root = std::env::temp_dir().join(format!("jarvis-memory-test-{}", std::process::id()));
        let assistant = Assistant::new(Folder::new(root.clone()), None);
        let bare = assistant.system_prompt("", None).unwrap();
        assert!(bare.starts_with(PERSONA) && bare.contains("ainda não sabe o nome") && !bare.contains("O que você já guardou"), "{bare}");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(MEMORY_FILE), "- Mora em Curitiba.\n").unwrap();
        let prompt = assistant.system_prompt("Tony", None).unwrap();
        assert!(prompt.starts_with(PERSONA) && prompt.ends_with("- Mora em Curitiba.\n"), "{prompt}");
        // The name comes before the memory, which can say otherwise ("me chame de chefe").
        let (name, memory) = (prompt.find("O usuário se chama Tony").unwrap(), prompt.find("Mora em Curitiba").unwrap());
        assert!(name < memory, "{prompt}");
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A channel that goes nowhere, to take an answer's place in a test.
    fn silent() -> Channel<AssistantEvent> {
        Channel::new(|_| Ok(()))
    }

    #[test]
    fn conversations_have_their_own_slots() {
        let assistant = Assistant::new(Folder::new(std::env::temp_dir().join("jarvis-slots-test")), None);
        assert_eq!(assistant.answering(), 0);
        // One answer at a time in a conversation; another conversation is free.
        let first = assistant.slot("a");
        assert_eq!(assistant.admit(&first, silent()), Ok(()));
        assert_eq!(assistant.admit(&first, silent()), Err(BUSY.into()));
        for name in ["b", "c", "d", "e"] {
            assert_eq!(assistant.admit(&assistant.slot(name), silent()), Ok(()));
        }
        assert_eq!(assistant.answering(), MAX_ANSWERING);
        // The sixth is refused, and takes no place.
        assert_eq!(assistant.admit(&assistant.slot("f"), silent()), Err(TOO_MANY.into()));
        assert_eq!(assistant.answering(), MAX_ANSWERING);
        // Stopping one frees its place, and only its own.
        assistant.cancel("c");
        assert_eq!(assistant.answering(), MAX_ANSWERING - 1);
        assert_eq!(assistant.admit(&assistant.slot("f"), silent()), Ok(()));
        assistant.cancel("nobody");
        assistant.reset("a");
        assert_eq!(assistant.answering(), MAX_ANSWERING - 1);
        // The cleanup leaves the ones being answered alone; with none running there is nothing to stop.
        assert_eq!(assistant.sleep(), Sleep::Busy);
        for name in ["b", "d", "e", "f"] {
            assistant.cancel(name);
        }
        assert_eq!(assistant.sleep(), Sleep::Idle);
    }

    #[test]
    fn every_conversation_starts_confined() {
        let assistant = Assistant::new(Folder::new(std::env::temp_dir().join("jarvis-args-test")), Some(PathBuf::from("C:\\mcp.json")));
        let profile = Profile { model: "sonnet".into(), name: "Tony".into() };
        for (prompt, resume) in [("persona do JARVIS", None), ("instruções de um agente", Some("00000000-0000-4000-8000-0000000000aa"))] {
            let args = assistant.arguments(&profile, prompt, resume);
            let after = |flag: &str| args.iter().position(|arg| arg == flag).map(|at| args[at + 1].as_str());
            assert!(args.contains(&"--restricted".to_string()), "{args:?}");
            assert!(args.contains(&"--strict-mcp-config".to_string()), "{args:?}");
            assert_eq!(after("--tools"), Some(TOOLS));
            assert_eq!(after("--permission-mode"), Some("dontAsk"));
            assert_eq!(after("--mcp-config"), Some("C:\\mcp.json"));
            assert_eq!(after("--append-system-prompt"), Some(prompt));
            assert_eq!(after("--resume"), resume);
            // No tool that runs a command, whatever the prompt says.
            assert!(!args.iter().any(|arg| arg.contains("Bash")), "{args:?}");
        }
    }

    #[test]
    fn an_agent_answers_with_its_own_prompt() {
        let root = std::env::temp_dir().join(format!("jarvis-agent-prompt-test-{}", std::process::id()));
        let folder = Folder::new(root.clone());
        std::fs::create_dir_all(&folder.agents).unwrap();
        // It asks for a shell in its header: the chat gives it none (the command line is JARVIS's).
        std::fs::write(folder.agents.join("revisor-pr.md"), "---\nname: revisor-pr\ndescription: Revisa PRs\ntools: Bash\n---\nVocê revisa pull requests com rigor.\n").unwrap();
        std::fs::write(folder.agents.join(".instalados.json"), "[\"revisor-pr\"]").unwrap();
        let assistant = Assistant::new(folder, None);
        let prompt = assistant.system_prompt("Tony", Some("revisor-pr")).unwrap();
        assert!(prompt.starts_with(AGENT_RULES), "{prompt}");
        assert!(prompt.contains("Você é o agente \"revisor-pr\""), "{prompt}");
        assert!(prompt.contains("Você revisa pull requests com rigor."), "{prompt}");
        assert!(prompt.contains("O usuário se chama Tony"), "{prompt}");
        // Not JARVIS: his persona and his memory stay out.
        assert!(!prompt.contains(PERSONA.lines().next().unwrap()), "{prompt}");
        assert!(!prompt.contains("tools: Bash"), "{prompt}");
        // An agent that is not a contact answers nothing.
        assert_eq!(assistant.system_prompt("Tony", Some("outro")), Err("O agente \"outro\" não está disponível".into()));
        assert_eq!(assistant.system_prompt("Tony", Some("..\\x")), Err("O agente \"..\\x\" não está disponível".into()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_read_is_a_source_of_the_answer() {
        let mut turn = Turn::default();
        let read = json!({ "file_path": r"C:\J\Notas\Ideias.md" }).to_string();
        let events = feed(&mut turn, &[&tool_start(0, "toolu_r", "Read"), &tool_input(0, &read), &block_stop(0)]);
        assert_eq!(events, [AssistantEvent::Tool { name: "Read".into() }, AssistantEvent::Source { path: r"C:\J\Notas\Ideias.md".into() }]);
        // Its result is not a file written.
        assert!(feed(&mut turn, &[&tool_result("toolu_r", false)]).is_empty());
        // A search is a step, not a source: what it found is not known here.
        let grep = json!({ "pattern": "Órion", "path": "Notas" }).to_string();
        let searched = feed(&mut turn, &[&tool_start(1, "toolu_g", "Grep"), &tool_input(1, &grep), &block_stop(1)]);
        assert_eq!(searched, [AssistantEvent::Tool { name: "Grep".into() }]);
    }

    #[test]
    fn the_persona_treats_the_notes_as_its_knowledge_base() {
        // Feature notes-graph, RF-016: look in the notes first, and say where it came from.
        assert!(PERSONA.contains("base de conhecimento"), "the persona names the notes as what it knows");
        assert!(PERSONA.contains("Grep"), "the persona says how to look");
    }

    #[test]
    fn the_persona_asks_for_links_and_tags() {
        // The notes graph (feature notes-graph) grows by itself only if JARVIS links what he writes.
        assert!(PERSONA.contains("[[Nome da nota]]"), "the persona names the link syntax");
        assert!(PERSONA.contains("#projeto"), "the persona shows what a tag looks like");
    }

    #[test]
    fn only_session_ids_are_looked_up() {
        assert!(!session_exists(""));
        assert!(!session_exists("..\\..\\settings"));
        assert!(!session_exists("00000000-0000-4000-8000-00000000000g"));
    }

    #[test]
    fn forgetting_a_session_only_takes_valid_ids() {
        let assistant = Assistant::new(Folder::new(std::env::temp_dir().join("jarvis-forget-test")), None);
        assert_eq!(assistant.forget(""), Err("Sessão inválida".into()));
        assert_eq!(assistant.forget("..\\..\\settings"), Err("Sessão inválida".into()));
        assert_eq!(assistant.forget("../projects/x"), Err("Sessão inválida".into()));
        assert!(session_files("..\\..\\settings").is_empty());
        // A well-formed id nobody has: nothing to delete, and nothing is.
        assert_eq!(assistant.forget("00000000-0000-4000-8000-0000000000ff"), Ok(false));
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
