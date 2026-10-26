//! jv_ide's Git panel, through the user's own `git` (their config, credential helpers and hooks
//! apply). Paths are relative to the repository's top, with "/". Nothing touches the network
//! unless the user asks (push, pull, fetch).

pub mod status;

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::workspace::paths::{self, Root};
use crate::workspace::text::{self, Decoded};
pub use status::GitChange;

const LOCAL: Duration = Duration::from_secs(20);
/// Commit hooks may run tests.
const COMMIT: Duration = Duration::from_secs(120);
const NETWORK: Duration = Duration::from_secs(180);
const MAX_DIFF: usize = 2 * 1024 * 1024;
/// Windows command lines are limited: paths go in chunks.
const MAX_ARGS_CHARS: usize = 8000;
pub const NO_GIT: &str = "Git não encontrado — instale o Git for Windows";

/// One change to the repository at a time (two would fight over the index lock).
static WRITING: Mutex<()> = Mutex::new(());

fn writing() -> std::sync::MutexGuard<'static, ()> {
    WRITING.lock().unwrap_or_else(|error| error.into_inner())
}

/// The `git` to run: on the PATH, else where Git for Windows installs it.
fn git_exe() -> Option<&'static PathBuf> {
    static GIT: OnceLock<Option<PathBuf>> = OnceLock::new();
    GIT.get_or_init(|| {
        crate::terminal::on_path("git.exe").or_else(|| {
            [std::env::var_os("ProgramFiles"), std::env::var_os("ProgramW6432"), std::env::var_os("LOCALAPPDATA").map(|dir| Path::new(&dir).join("Programs").into_os_string())]
                .into_iter()
                .flatten()
                .map(|dir| Path::new(&dir).join("Git").join("cmd").join("git.exe"))
                .find(|path| path.is_file())
        })
    })
    .as_ref()
}

pub struct Output {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Output {
    fn ok(&self) -> bool {
        self.code == Some(0)
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    /// What git said, for the UI (push and pull report on stderr).
    fn said(&self) -> String {
        let out = self.text();
        [out.trim(), self.stderr.trim()].into_iter().filter(|text| !text.is_empty()).collect::<Vec<_>>().join("\n")
    }
}

/// Ends a process and everything it started (ssh, credential helpers keep the pipes open).
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(crate::launcher::CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
}

/// Runs git in `dir` with English messages (so they can be recognised), no pager, no prompts.
pub fn run(dir: &Path, args: &[&str], input: Option<&[u8]>, timeout: Duration) -> Result<Output, String> {
    let git = git_exe().ok_or(NO_GIT)?;
    let mut command = Command::new(git);
    command
        .args(["--no-pager", "--literal-pathspecs", "-C"])
        .arg(paths::plain(dir))
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false", "-c", "log.showSignature=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        // Without it `status` refreshes the index, which the watcher reports, which asks for a
        // status again: forever.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("GIT_EDITOR", "true")
        .env("LC_ALL", "en_US.UTF-8")
        .env("LANG", "en_US.UTF-8")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::launcher::CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| NO_GIT.to_string())?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        let _ = stdin.write_all(input);
    }
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let reading = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(pipe) = stdout.as_mut() {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    });
    let reading_errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(pipe) = stderr.as_mut() {
            let _ = pipe.read_to_end(&mut bytes);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let started = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if started.elapsed() > timeout => {
                kill_tree(&mut child);
                let _ = child.wait();
                return Err("O Git demorou demais e foi interrompido".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(error.to_string()),
        }
    };
    Ok(Output { code, stdout: reading.join().unwrap_or_default(), stderr: reading_errors.join().unwrap_or_default() })
}

/// What went wrong, in the user's words. `output` is git's stderr and stdout together.
pub fn explain(output: &str) -> String {
    let lower = output.to_lowercase();
    let known: [(&[&str], &str); 16] = [
        (&["dubious ownership"], "O Git não confia nesta pasta (dono diferente). Rode no terminal: git config --global --add safe.directory <pasta>"),
        (&["please tell me who you are", "user.email", "unable to auto-detect email"], "Configure user.name e user.email do Git"),
        (&["nothing to commit", "nothing added to commit"], "Nada para commitar"),
        (&["no changes added to commit"], "Nenhuma alteração preparada (stage) para o commit"),
        (&["[rejected]", "fetch first", "non-fast-forward"], "Push rejeitado: faça pull primeiro"),
        (&["has no upstream branch", "no upstream configured", "there is no tracking information"], "Este branch não tem upstream"),
        (&["authentication failed", "permission denied (publickey)", "could not read username", "terminal prompts disabled"], "Falha de autenticação no remoto"),
        (&["could not resolve host", "unable to access", "connection timed out", "network is unreachable"], "Sem conexão com o remoto"),
        (&["would be overwritten"], "Faça commit ou stash antes"),
        (&["conflict"], "Conflitos de merge: resolva e faça commit"),
        (&["divergent branches", "need to specify how to reconcile"], "Branches divergentes: configure pull.rebase ou resolva no terminal"),
        (&["index.lock"], "Outro processo Git está usando o repositório"),
        (&["no local changes to save"], "Nada para guardar no stash"),
        (&["no stash entries", "is not a stash reference", "is not a valid reference"], "Não há stash"),
        (&["not a git repository"], "Esta pasta não é um repositório Git"),
        (&["no configured push destination", "does not appear to be a git repository"], "Nenhum remoto configurado"),
    ];
    for (needles, message) in known {
        if needles.iter().any(|needle| lower.contains(needle)) {
            return message.to_string();
        }
    }
    let first: Vec<&str> = output.lines().map(str::trim).filter(|line| !line.is_empty()).take(3).collect();
    if first.is_empty() { "O Git falhou".into() } else { format!("Git: {}", first.join(" ")) }
}

/// git's answer, or what went wrong.
fn check(output: Output) -> Result<Output, String> {
    if output.ok() { Ok(output) } else { Err(explain(&output.said())) }
}

/// A repository and where the opened folder sits in it.
#[derive(Clone, Debug)]
pub struct Repo {
    /// Its top folder (no `\\?\`).
    pub root: PathBuf,
    pub git_dir: PathBuf,
    /// The opened folder relative to the top ("" when it is the top), with "/".
    pub prefix: String,
}

fn local_path(text: &str) -> PathBuf {
    let path = PathBuf::from(text.trim().replace('/', "\\"));
    dunce::canonicalize(&path).unwrap_or(path)
}

/// The repository `root` belongs to; None when it is in none.
pub fn repo(root: &Root) -> Result<Option<Repo>, String> {
    let output = run(&root.canonical, &["rev-parse", "--show-toplevel", "--absolute-git-dir"], None, LOCAL)?;
    if !output.ok() {
        let message = output.said();
        if message.to_lowercase().contains("not a git repository") {
            return Ok(None);
        }
        return Err(explain(&message));
    }
    let text = output.text();
    let mut lines = text.lines();
    let (Some(top), Some(git_dir)) = (lines.next(), lines.next()) else { return Ok(None) };
    let top = local_path(top);
    let opened = paths::plain(&root.canonical);
    let prefix = opened
        .strip_prefix(&top)
        .map(|rest| rest.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default();
    Ok(Some(Repo { root: top, git_dir: local_path(git_dir), prefix }))
}

fn required(root: &str) -> Result<Repo, String> {
    let root = Root::new(root)?;
    repo(&root)?.ok_or_else(|| "Esta pasta não é um repositório Git".into())
}

/// Paths the UI sends: inside the repository, never options.
fn checked<'a>(list: &'a [String]) -> Result<Vec<&'a str>, String> {
    list.iter()
        .map(|path| {
            let path = path.as_str();
            let valid = !path.is_empty() && !path.starts_with('-') && paths::split_rel(path).is_ok();
            if valid { Ok(path) } else { Err(paths::INVALID_PATH.to_string()) }
        })
        .collect()
}

fn checked_one(path: &str) -> Result<String, String> {
    checked(&[path.to_string()]).map(|_| path.to_string())
}

/// Runs `args -- <paths>` in chunks short enough for the command line.
fn with_paths(repo: &Repo, args: &[&str], list: &[&str]) -> Result<(), String> {
    let mut start = 0;
    while start < list.len() {
        let mut end = start;
        let mut length = 0;
        while end < list.len() && (end == start || length + list[end].len() < MAX_ARGS_CHARS) {
            length += list[end].len() + 3;
            end += 1;
        }
        let mut all: Vec<&str> = args.to_vec();
        all.push("--");
        all.extend(&list[start..end]);
        check(run(&repo.root, &all, None, LOCAL)?)?;
        start = end;
    }
    Ok(())
}

fn has_head(repo: &Repo) -> Result<bool, String> {
    Ok(run(&repo.root, &["rev-parse", "--verify", "-q", "HEAD"], None, LOCAL)?.ok())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repo_root: String,
    pub prefix: String,
    pub branch: Option<String>,
    /// Short hash of HEAD; None before the first commit.
    pub head: Option<String>,
    pub detached: bool,
    pub initial: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub stash: u32,
    pub staged: Vec<GitChange>,
    pub unstaged: Vec<GitChange>,
    pub untracked: Vec<GitChange>,
    pub conflicted: Vec<GitChange>,
    /// "merge", "rebase", "cherry-pick" or "revert" in progress.
    pub operation: Option<String>,
    pub truncated: bool,
}

fn operation(git_dir: &Path) -> Option<String> {
    let found = [("MERGE_HEAD", "merge"), ("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")]
        .into_iter()
        .find(|(name, _)| git_dir.join(name).exists());
    found.map(|(_, operation)| operation.to_string())
}

/// The repository's state; None when the folder is not in one.
pub fn git_status(root: &str) -> Result<Option<GitStatus>, String> {
    let root = Root::new(root)?;
    let Some(repo) = repo(&root)? else { return Ok(None) };
    let output = check(run(&repo.root, &["status", "--porcelain=v2", "--branch", "--show-stash", "-z", "--untracked-files=all"], None, LOCAL)?)?;
    let parsed = status::parse(&output.text());
    // Git before 2.35 does not count stashes in the status.
    let stash = parsed.stash.unwrap_or_else(|| {
        run(&repo.root, &["rev-list", "--walk-reflogs", "--count", "refs/stash"], None, LOCAL)
            .ok()
            .filter(Output::ok)
            .and_then(|output| output.text().trim().parse().ok())
            .unwrap_or(0)
    });
    Ok(Some(GitStatus {
        repo_root: repo.root.display().to_string(),
        prefix: repo.prefix.clone(),
        detached: parsed.branch.is_none() && parsed.oid.is_some(),
        initial: parsed.oid.is_none(),
        head: parsed.oid.as_ref().map(|oid| oid.chars().take(7).collect()),
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        stash,
        staged: parsed.staged,
        unstaged: parsed.unstaged,
        untracked: parsed.untracked,
        conflicted: parsed.conflicted,
        operation: operation(&repo.git_dir),
        truncated: parsed.truncated,
    }))
}

pub fn stage(root: &str, list: &[String]) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    with_paths(&repo, &["add"], &checked(list)?)
}

pub fn unstage(root: &str, list: &[String]) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    let list = checked(list)?;
    if has_head(&repo)? {
        with_paths(&repo, &["restore", "--staged"], &list)
    } else {
        // Before the first commit there is nothing to restore from.
        with_paths(&repo, &["rm", "--cached", "-r", "-q"], &list)
    }
}

/// The untracked files among `list` (all of them when it is empty).
fn untracked_paths(root: &str, list: &[&str]) -> Result<Vec<String>, String> {
    let status = git_status(root)?.ok_or("Esta pasta não é um repositório Git")?;
    Ok(status.untracked.into_iter().map(|change| change.path).filter(|path| list.is_empty() || list.contains(&path.as_str())).collect())
}

fn absolute(repo: &Repo, rel: &str) -> PathBuf {
    rel.split('/').fold(repo.root.clone(), |path, part| path.join(part))
}

/// Throws away work-tree changes: tracked files go back to the index, untracked ones go to the
/// Recycle Bin (never `git clean`).
pub fn discard(root: &str, list: &[String]) -> Result<(), String> {
    let repo = required(root)?;
    let list = checked(list)?;
    let untracked = untracked_paths(root, &list)?;
    let _lock = writing();
    let tracked: Vec<&str> = list.iter().copied().filter(|path| !untracked.iter().any(|item| item == path)).collect();
    if !tracked.is_empty() {
        with_paths(&repo, &["restore", "--worktree"], &tracked)?;
    }
    if !untracked.is_empty() {
        crate::workspace::recycle(untracked.iter().map(|path| absolute(&repo, path)).collect())?;
    }
    Ok(())
}

pub fn stage_all(root: &str) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    check(run(&repo.root, &["add", "-A"], None, LOCAL)?).map(|_| ())
}

pub fn unstage_all(root: &str) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    let args: &[&str] = if has_head(&repo)? { &["reset", "-q"] } else { &["rm", "--cached", "-r", "-q", "--ignore-unmatch", "."] };
    check(run(&repo.root, args, None, LOCAL)?).map(|_| ())
}

/// Every work-tree change thrown away; untracked files too when asked (to the Recycle Bin).
pub fn discard_all(root: &str, untracked: bool) -> Result<(), String> {
    let repo = required(root)?;
    let status = git_status(root)?.ok_or("Esta pasta não é um repositório Git")?;
    let leftovers = if untracked { untracked_paths(root, &[])? } else { Vec::new() };
    let _lock = writing();
    if !status.unstaged.is_empty() {
        check(run(&repo.root, &["restore", "--worktree", "--", "."], None, LOCAL)?)?;
    }
    if !leftovers.is_empty() {
        crate::workspace::recycle(leftovers.iter().map(|path| absolute(&repo, path)).collect())?;
    }
    Ok(())
}

/// Commits what is staged; returns the new commit's short hash.
pub fn commit(root: &str, message: &str, amend: bool) -> Result<String, String> {
    let repo = required(root)?;
    let message = message.trim();
    if message.is_empty() && !amend {
        return Err("Escreva a mensagem do commit".into());
    }
    let _lock = writing();
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    let output = if message.is_empty() {
        args.push("--no-edit");
        run(&repo.root, &args, None, COMMIT)?
    } else {
        args.extend(["-F", "-"]);
        run(&repo.root, &args, Some(message.as_bytes()), COMMIT)?
    };
    check(output)?;
    let head = check(run(&repo.root, &["rev-parse", "--short", "HEAD"], None, LOCAL)?)?;
    Ok(head.text().trim().to_string())
}

/// Pushes the branch; one without an upstream gets one when the repository has a single remote.
pub fn push(root: &str) -> Result<String, String> {
    let repo = required(root)?;
    let status = git_status(root)?.ok_or("Esta pasta não é um repositório Git")?;
    let _lock = writing();
    let output = if status.upstream.is_some() {
        run(&repo.root, &["push"], None, NETWORK)?
    } else {
        let remotes = check(run(&repo.root, &["remote"], None, LOCAL)?)?.text();
        let remotes: Vec<&str> = remotes.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
        match remotes.as_slice() {
            [] => return Err("Nenhum remoto configurado".into()),
            [remote] => run(&repo.root, &["push", "-u", remote, "HEAD"], None, NETWORK)?,
            _ => return Err("Este branch não tem upstream".into()),
        }
    };
    Ok(check(output)?.said())
}

pub fn pull(root: &str) -> Result<String, String> {
    let repo = required(root)?;
    let _lock = writing();
    Ok(check(run(&repo.root, &["pull", "--no-edit"], None, NETWORK)?)?.said())
}

pub fn fetch(root: &str) -> Result<String, String> {
    let repo = required(root)?;
    Ok(check(run(&repo.root, &["fetch", "--prune"], None, NETWORK)?)?.said())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub email: String,
    /// Seconds since 1970.
    pub time: i64,
    /// Branches and tags pointing at it ("HEAD -> main, origin/main").
    pub refs: String,
    pub subject: String,
}

pub fn log(root: &str, limit: u32, skip: u32) -> Result<Vec<Commit>, String> {
    let repo = required(root)?;
    if !has_head(&repo)? {
        return Ok(Vec::new());
    }
    let count = format!("-n{}", limit.clamp(1, 1000));
    let skip = format!("--skip={skip}");
    let output = check(run(&repo.root, &["log", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e", &count, &skip], None, LOCAL)?)?;
    Ok(output
        .text()
        .split('\x1e')
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim_start_matches(['\n', '\r']).split('\x1f').collect();
            match fields.as_slice() {
                [hash, short, author, email, time, refs, subject] if !hash.is_empty() => Some(Commit {
                    hash: hash.to_string(),
                    short: short.to_string(),
                    author: author.to_string(),
                    email: email.to_string(),
                    time: time.parse().unwrap_or(0),
                    refs: refs.to_string(),
                    subject: subject.to_string(),
                }),
                _ => None,
            }
        })
        .collect())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
}

fn cut(mut text: String) -> (String, bool) {
    if text.len() <= MAX_DIFF {
        return (text, false);
    }
    let mut end = MAX_DIFF;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    (text, true)
}

/// The unified diff of one file: work tree against the index, or (`staged`) the index against
/// HEAD. An untracked file shows as all new.
pub fn diff(root: &str, path: &str, staged: bool) -> Result<Diff, String> {
    let repo = required(root)?;
    let path = checked_one(path)?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", &path]);
    let mut text = check(run(&repo.root, &args, None, LOCAL)?)?.text();
    if text.is_empty() && !staged {
        let tracked = run(&repo.root, &["ls-files", "--error-unmatch", "--", &path], None, LOCAL)?.ok();
        if !tracked {
            // Exit code 1 means "they differ", which is the point.
            let output = run(&repo.root, &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", &path], None, LOCAL)?;
            if output.code != Some(0) && output.code != Some(1) {
                return Err(explain(&output.said()));
            }
            text = output.text();
        }
    }
    let binary = text.lines().any(|line| line.starts_with("Binary files ") && line.ends_with(" differ"));
    let (text, truncated) = cut(text);
    Ok(Diff { text, binary, truncated })
}

/// A file as it is in HEAD or in the index (None when it is not there, or is binary).
pub fn show_file(root: &str, path: &str, rev: &str) -> Result<Option<String>, String> {
    let repo = required(root)?;
    let path = checked_one(path)?;
    let spec = match rev {
        "HEAD" => format!("HEAD:{path}"),
        "INDEX" => format!(":{path}"),
        _ => return Err("Revisão inválida".into()),
    };
    let output = run(&repo.root, &["show", &spec], None, LOCAL)?;
    if !output.ok() {
        return Ok(None);
    }
    Ok(match text::decode(&output.stdout) {
        Decoded::Text { text, .. } => Some(text),
        Decoded::Binary => None,
    })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,
    pub time: i64,
    pub message: String,
}

pub fn stash_list(root: &str) -> Result<Vec<Stash>, String> {
    let repo = required(root)?;
    let output = run(&repo.root, &["stash", "list", "--format=%gd%x1f%ct%x1f%gs"], None, LOCAL)?;
    if !output.ok() {
        return Ok(Vec::new());
    }
    Ok(output
        .text()
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\x1f');
            let reference = fields.next()?;
            let index = reference.strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
            Some(Stash { index, time: fields.next()?.parse().unwrap_or(0), message: fields.next().unwrap_or_default().to_string() })
        })
        .collect())
}

pub fn stash_push(root: &str, message: Option<&str>, untracked: bool) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    let mut args = vec!["stash", "push"];
    if untracked {
        args.push("--include-untracked");
    }
    let message = message.map(str::trim).filter(|message| !message.is_empty());
    if let Some(message) = message {
        args.extend(["-m", message]);
    }
    let output = check(run(&repo.root, &args, None, LOCAL)?)?;
    // Nothing to save is not an error to git.
    if output.said().to_lowercase().contains("no local changes to save") {
        return Err(explain("no local changes to save"));
    }
    Ok(())
}

fn stash_ref(index: u32) -> String {
    format!("stash@{{{index}}}")
}

pub fn stash_pop(root: &str, index: u32) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    check(run(&repo.root, &["stash", "pop", &stash_ref(index)], None, LOCAL)?).map(|_| ())
}

pub fn stash_drop(root: &str, index: u32) -> Result<(), String> {
    let repo = required(root)?;
    let _lock = writing();
    check(run(&repo.root, &["stash", "drop", &stash_ref(index)], None, LOCAL)?).map(|_| ())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// "main", or "origin/main" for a remote one.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
}

pub fn branches(root: &str) -> Result<Vec<Branch>, String> {
    let repo = required(root)?;
    let output = check(run(&repo.root, &["for-each-ref", "--format=%(refname)%1f%(HEAD)%1f%(upstream:short)", "refs/heads", "refs/remotes"], None, LOCAL)?)?;
    Ok(output
        .text()
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\x1f');
            let reference = fields.next()?;
            let current = fields.next() == Some("*");
            let upstream = fields.next().filter(|upstream| !upstream.is_empty()).map(str::to_string);
            let (name, remote) = match (reference.strip_prefix("refs/heads/"), reference.strip_prefix("refs/remotes/")) {
                (Some(name), _) => (name, false),
                (None, Some(name)) if !name.ends_with("/HEAD") => (name, true),
                _ => return None,
            };
            Some(Branch { name: name.to_string(), remote, current, upstream })
        })
        .collect())
}

/// Switches to `branch` (or creates it here). A remote branch ("origin/x") gets a local one that
/// tracks it.
pub fn checkout(root: &str, branch: &str, create: bool) -> Result<(), String> {
    let repo = required(root)?;
    let branch = branch.trim();
    let valid = !branch.is_empty() && !branch.starts_with('-') && run(&repo.root, &["check-ref-format", "--branch", branch], None, LOCAL)?.ok();
    if !valid {
        return Err("Nome de branch inválido".into());
    }
    let _lock = writing();
    let exists = |reference: &str| run(&repo.root, &["show-ref", "--verify", "--quiet", reference], None, LOCAL).is_ok_and(|output| output.ok());
    let output = if create {
        run(&repo.root, &["switch", "-c", branch], None, LOCAL)?
    } else if !exists(&format!("refs/heads/{branch}")) && exists(&format!("refs/remotes/{branch}")) {
        let local = branch.split_once('/').map_or(branch, |(_, rest)| rest);
        run(&repo.root, &["switch", "-c", local, "--track", branch], None, LOCAL)?
    } else {
        run(&repo.root, &["switch", branch], None, LOCAL)?
    };
    check(output).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn explains_git_errors_in_portuguese() {
        let cases = [
            ("fatal: detected dubious ownership in repository at 'C:/x'", "O Git não confia"),
            ("*** Please tell me who you are.", "Configure user.name"),
            ("nothing to commit, working tree clean", "Nada para commitar"),
            ("no changes added to commit (use \"git add\")", "Nenhuma alteração preparada"),
            (" ! [rejected]        main -> main (fetch first)", "Push rejeitado"),
            ("fatal: The current branch x has no upstream branch.", "Este branch não tem upstream"),
            ("fatal: Authentication failed for 'https://x'", "Falha de autenticação"),
            ("git@github.com: Permission denied (publickey).", "Falha de autenticação"),
            ("fatal: unable to access 'https://x/': Could not resolve host: x", "Sem conexão"),
            ("error: Your local changes to the following files would be overwritten by checkout", "Faça commit ou stash"),
            ("CONFLICT (content): Merge conflict in a.txt", "Conflitos de merge"),
            ("hint: You have divergent branches and need to specify how to reconcile them.", "Branches divergentes"),
            ("fatal: Unable to create 'C:/x/.git/index.lock': File exists.", "Outro processo Git"),
            ("No local changes to save", "Nada para guardar"),
            ("error: stash@{3} is not a valid reference", "Não há stash"),
            ("fatal: something odd\nsecond line\nthird\nfourth", "Git: fatal: something odd second line third"),
            ("", "O Git falhou"),
        ];
        for (output, expected) in cases {
            assert!(explain(output).starts_with(expected), "{output:?} -> {}", explain(output));
        }
    }

    #[test]
    fn refuses_paths_that_are_options_or_lead_out() {
        assert!(checked(&["src/a.rs".into(), "README.md".into()]).is_ok());
        for bad in ["-rf", "--all", "../x", "/etc/passwd", "C:\\x", ""] {
            assert!(checked(&[bad.to_string()]).is_err(), "{bad:?}");
        }
    }

    /// A real repository in a temporary folder (skipped when git is not installed).
    struct Temp {
        dir: PathBuf,
        root: String,
    }

    impl Temp {
        fn new(name: &str) -> Option<Self> {
            git_exe()?;
            let dir = std::env::temp_dir().join(format!("jarvis-git-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(dir.join("app")).unwrap();
            let temp = Self { root: dir.display().to_string(), dir };
            for args in [
                &["init", "-q", "-b", "main"][..],
                &["config", "user.name", "Jarvis"],
                &["config", "user.email", "jarvis@example.com"],
                &["config", "commit.gpgsign", "false"],
                &["config", "core.autocrlf", "false"],
            ] {
                assert!(run(&temp.dir, args, None, LOCAL).unwrap().ok(), "git {args:?}");
            }
            Some(temp)
        }

        fn write(&self, rel: &str, text: &str) {
            let path = rel.split('/').fold(self.dir.clone(), |path, part| path.join(part));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }

        fn status(&self) -> GitStatus {
            git_status(&self.root).unwrap().expect("a repository")
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn names(list: &[GitChange]) -> Vec<String> {
        list.iter().map(|change| format!("{}:{}", change.status, change.path)).collect()
    }

    #[test]
    fn a_whole_session_in_a_real_repository() {
        let Some(repo) = Temp::new("flow") else { return };
        // Empty repository: a branch, nothing committed.
        let first = repo.status();
        assert!(first.initial && first.head.is_none() && !first.detached);
        assert_eq!(first.branch.as_deref(), Some("main"));
        assert!(log(&repo.root, 10, 0).unwrap().is_empty());

        repo.write("app/report.py", "def reorder_rows():\n    pass\n");
        repo.write("README.md", "# inventário\n");
        assert_eq!(names(&repo.status().untracked), ["?:README.md", "?:app/report.py"]);
        stage(&repo.root, &["README.md".into()]).unwrap();
        assert_eq!(names(&repo.status().staged), ["A:README.md"]);
        unstage(&repo.root, &["README.md".into()]).unwrap();
        assert!(repo.status().staged.is_empty(), "unstaged before the first commit");
        stage_all(&repo.root).unwrap();
        assert_eq!(commit(&repo.root, "  ", false).unwrap_err(), "Escreva a mensagem do commit");
        let hash = commit(&repo.root, "Primeiro commit: relatório", false).unwrap();
        let status = repo.status();
        assert_eq!(status.head.as_deref(), Some(hash.as_str()));
        assert!(!status.initial && status.staged.is_empty() && status.untracked.is_empty());
        let history = log(&repo.root, 10, 0).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!((history[0].subject.as_str(), history[0].author.as_str(), history[0].short.as_str()), ("Primeiro commit: relatório", "Jarvis", hash.as_str()));
        assert!(history[0].refs.contains("main"));
        assert_eq!(commit(&repo.root, "nada", false).unwrap_err(), "Nada para commitar");

        // Changes, diffs and throwing them away.
        repo.write("app/report.py", "def reorder_rows():\n    return []\n");
        repo.write("novo.txt", "novo\n");
        let status = repo.status();
        assert_eq!(names(&status.unstaged), ["M:app/report.py"]);
        assert_eq!(names(&status.untracked), ["?:novo.txt"]);
        let changed = diff(&repo.root, "app/report.py", false).unwrap();
        assert!(changed.text.contains("-    pass") && changed.text.contains("+    return []") && !changed.binary);
        assert!(diff(&repo.root, "novo.txt", false).unwrap().text.contains("+novo"), "an untracked file is all new");
        assert_eq!(show_file(&repo.root, "app/report.py", "HEAD").unwrap().as_deref(), Some("def reorder_rows():\n    pass\n"));
        assert_eq!(show_file(&repo.root, "nada.py", "HEAD").unwrap(), None);
        stage(&repo.root, &["app/report.py".into()]).unwrap();
        assert!(diff(&repo.root, "app/report.py", true).unwrap().text.contains("+    return []"));
        unstage(&repo.root, &["app/report.py".into()]).unwrap();
        discard(&repo.root, &["app/report.py".into()]).unwrap();
        assert_eq!(fs::read_to_string(repo.dir.join("app").join("report.py")).unwrap(), "def reorder_rows():\n    pass\n");

        // Stash keeps work aside, pop brings it back.
        repo.write("README.md", "# inventário\nmais\n");
        stash_push(&repo.root, Some("guardado"), false).unwrap();
        assert!(repo.status().unstaged.is_empty());
        assert_eq!(repo.status().stash, 1);
        let stashes = stash_list(&repo.root).unwrap();
        assert_eq!((stashes[0].index, stashes[0].message.ends_with("guardado")), (0, true));
        assert_eq!(stash_push(&repo.root, None, false).unwrap_err(), "Nada para guardar no stash");
        stash_pop(&repo.root, 0).unwrap();
        assert_eq!(names(&repo.status().unstaged), ["M:README.md"]);
        assert_eq!(stash_pop(&repo.root, 5).unwrap_err(), "Não há stash");

        // Branches.
        checkout(&repo.root, "feature/csv", true).unwrap();
        assert_eq!(repo.status().branch.as_deref(), Some("feature/csv"));
        let all = branches(&repo.root).unwrap();
        assert!(all.iter().any(|branch| branch.name == "feature/csv" && branch.current && !branch.remote));
        assert!(all.iter().any(|branch| branch.name == "main" && !branch.current));
        checkout(&repo.root, "main", false).unwrap();
        assert_eq!(checkout(&repo.root, "-x", false).unwrap_err(), "Nome de branch inválido");
        assert_eq!(checkout(&repo.root, "a..b", true).unwrap_err(), "Nome de branch inválido");
        assert_eq!(push(&repo.root).unwrap_err(), "Nenhum remoto configurado");
    }

    #[test]
    fn a_subfolder_knows_its_place_and_status_leaves_the_index_alone() {
        let Some(repo) = Temp::new("subfolder") else { return };
        repo.write("app/main.rs", "fn main() {}\n");
        stage_all(&repo.root).unwrap();
        commit(&repo.root, "inicial", false).unwrap();
        let sub = Root::new(&repo.dir.join("app").display().to_string()).unwrap();
        let found = super::repo(&sub).unwrap().unwrap();
        assert_eq!(found.prefix, "app");
        assert_eq!(fs::canonicalize(&found.root).unwrap(), fs::canonicalize(&repo.dir).unwrap());
        assert!(found.git_dir.ends_with(".git"));
        let index = repo.dir.join(".git").join("index");
        let before = fs::metadata(&index).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(50));
        repo.write("app/main.rs", "fn main() { }\n");
        let status = git_status(&sub.display()).unwrap().unwrap();
        assert_eq!(status.prefix, "app");
        assert_eq!(names(&status.unstaged), ["M:app/main.rs"]);
        assert_eq!(fs::metadata(&index).unwrap().modified().unwrap(), before, "GIT_OPTIONAL_LOCKS keeps status from writing the index");
    }

    #[test]
    fn a_folder_outside_any_repository_has_no_status() {
        if git_exe().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("jarvis-git-none-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        // The temp folder is not in a repository on a normal machine.
        let status = git_status(&dir.display().to_string()).unwrap();
        assert!(status.is_none());
        assert_eq!(stage(&dir.display().to_string(), &["x".into()]).unwrap_err(), "Esta pasta não é um repositório Git");
        fs::remove_dir_all(dir).unwrap();
    }
}
