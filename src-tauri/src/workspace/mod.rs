//! jv_ide's view of the disk: a folder the user opened, its files listed, read, written, created,
//! renamed and deleted (to the Recycle Bin), watched for changes and searched. Every path the UI
//! sends is relative to a root and may not lead out of it (see `paths`).

pub mod paths;
pub mod search;
pub mod text;
pub mod watch;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use paths::Root;
use text::{Decoded, Encoding, Eol};

/// Larger files open as "too large" instead of in the editor.
pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// A folder lists at most this many entries.
const MAX_ENTRIES: usize = 5000;
/// What `write` answers when the file is no longer the one the editor read.
pub const FILE_CHANGED: &str = "file-changed";
/// Our own temporary files while saving (the watcher ignores them).
pub const TEMP_PREFIX: &str = ".~jv-";

/// Size and last change of a file, to notice that someone else changed it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub size: u64,
    /// Milliseconds since 1970.
    pub modified: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    /// Relative to the root, with "/".
    pub path: String,
    pub kind: EntryKind,
    /// A symbolic link or junction (`kind` is what it points to).
    pub link: bool,
    pub size: u64,
    pub modified: u64,
    /// Hidden attribute or a leading dot.
    pub hidden: bool,
    /// Left out by .gitignore (or .ignore, the global excludes...).
    pub ignored: bool,
    pub readonly: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileContent {
    /// The text with "\n" only; `eol` and `encoding` are what the file uses on disk.
    Text { contents: String, encoding: Encoding, eol: Eol, mixed_eol: bool, stamp: Stamp, readonly: bool },
    Binary { stamp: Stamp },
    TooLarge { stamp: Stamp, max: u64 },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub root: String,
    /// The opened folder inside the repository ("" at its top), with "/".
    pub prefix: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    /// The folder as the UI shows it (and sends back as `root`).
    pub root: String,
    pub name: String,
    pub repo: Option<RepoInfo>,
    /// False when changes on disk cannot be followed (some network drives).
    pub watching: bool,
}

/// The folders open in jv_ide: one watcher each, and the search running now.
#[derive(Default)]
pub struct Workspaces {
    watches: Mutex<HashMap<String, watch::Watch>>,
    /// Bumped by every new search; a search whose id is no longer this one stops.
    pub search: AtomicU64,
}

impl Workspaces {
    /// Opens `path` as a project: its repository and, unless already followed, a watcher whose
    /// batches go to `on_change`.
    pub fn open(&self, path: &str, on_change: impl Fn(watch::Changed) + Send + 'static) -> Result<WorkspaceInfo, String> {
        let root = Root::new(path)?;
        if root.is_volume() {
            return Err("Abra uma pasta de projeto, não a raiz da unidade".into());
        }
        let shown = root.display();
        let repo = crate::git::repo(&root).ok().flatten();
        let mut watches = self.watches.lock().unwrap_or_else(|error| error.into_inner());
        let watching = match watches.get(&shown) {
            Some(_) => true,
            None => {
                // A repository above the folder (a subfolder was opened) or elsewhere (a worktree):
                // its HEAD, index and refs are followed too.
                let git_dir = repo.as_ref().map(|repo| repo.git_dir.clone());
                match watch::Watch::start(&root, git_dir, on_change) {
                    Ok(watch) => {
                        watches.insert(shown.clone(), watch);
                        true
                    }
                    Err(error) => {
                        eprintln!("[jarvis] not watching {shown}: {error}");
                        false
                    }
                }
            }
        };
        let name = root.shown.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| shown.clone());
        let repo = repo.map(|repo| RepoInfo { root: repo.root.display().to_string(), prefix: repo.prefix });
        Ok(WorkspaceInfo { root: shown, name, repo, watching })
    }

    pub fn close(&self, root: &str) {
        self.watches.lock().unwrap_or_else(|error| error.into_inner()).remove(root.trim());
    }

    /// Nothing outlives JARVIS: watchers stop, the running search too.
    pub fn close_all(&self) {
        self.watches.lock().unwrap_or_else(|error| error.into_inner()).clear();
        self.search.fetch_add(1, Ordering::SeqCst);
    }
}

pub fn describe(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "Arquivo não encontrado".into(),
        io::ErrorKind::PermissionDenied => "Sem permissão".into(),
        io::ErrorKind::AlreadyExists => "Já existe um item com esse nome".into(),
        io::ErrorKind::DirectoryNotEmpty => "A pasta não está vazia".into(),
        io::ErrorKind::CrossesDevices => "Não é possível mover entre unidades".into(),
        io::ErrorKind::StorageFull => "Disco cheio".into(),
        io::ErrorKind::InvalidFilename => paths::INVALID_NAME.into(),
        _ if error.raw_os_error() == Some(32) => "O arquivo está em uso por outro programa".into(),
        _ => error.to_string(),
    }
}

fn millis(metadata: &fs::Metadata) -> u64 {
    metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |since| since.as_millis() as u64)
}

fn stamp(metadata: &fs::Metadata) -> Stamp {
    Stamp { size: metadata.len(), modified: millis(metadata) }
}

fn stamp_of(path: &Path) -> Result<Stamp, String> {
    fs::metadata(path).map(|metadata| stamp(&metadata)).map_err(describe)
}

#[cfg(windows)]
fn hidden_attribute(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x2 != 0
}

#[cfg(not(windows))]
fn hidden_attribute(_: &fs::Metadata) -> bool {
    false
}

/// The names in `dir` that .gitignore and its kin (in `dir` and above) leave in.
fn kept_names(dir: &Path) -> HashSet<std::ffi::OsString> {
    ignore::WalkBuilder::new(dir)
        .max_depth(Some(1))
        .hidden(false)
        .parents(true)
        .require_git(false)
        .follow_links(false)
        .build()
        .flatten()
        .filter(|entry| entry.depth() == 1)
        .map(|entry| entry.file_name().to_os_string())
        .collect()
}

/// A folder's entries: folders first, then files, by name; `.git` left out.
pub fn list(root: &Root, rel: &str) -> Result<Listing, String> {
    let dir = paths::resolve(root, rel)?;
    if !dir.is_dir() {
        return Err("Não é uma pasta".into());
    }
    let prefix = paths::split_rel(rel)?.join("/");
    let kept = kept_names(&paths::plain(&dir));
    let mut entries = Vec::new();
    let mut truncated = false;
    for item in fs::read_dir(&dir).map_err(describe)?.flatten() {
        let name = item.file_name();
        if name == ".git" {
            continue;
        }
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(own) = item.metadata() else { continue };
        let link = own.file_type().is_symlink();
        // What a link points to (a broken one is shown as a file).
        let metadata = if link { fs::metadata(item.path()).unwrap_or(own) } else { own };
        let text = name.to_string_lossy().into_owned();
        entries.push(DirEntry {
            path: if prefix.is_empty() { text.clone() } else { format!("{prefix}/{text}") },
            kind: if metadata.is_dir() { EntryKind::Dir } else { EntryKind::File },
            link,
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            modified: millis(&metadata),
            hidden: text.starts_with('.') || hidden_attribute(&metadata),
            ignored: !kept.contains(&name),
            readonly: metadata.permissions().readonly(),
            name: text,
        });
    }
    entries.sort_by(|a, b| (a.kind != EntryKind::Dir).cmp(&(b.kind != EntryKind::Dir)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(Listing { path: prefix, entries, truncated })
}

/// A file as the editor takes it: text (decoded, "\n" only), or why it is not editable.
pub fn read(root: &Root, rel: &str) -> Result<FileContent, String> {
    let path = paths::resolve(root, rel)?;
    let metadata = fs::metadata(&path).map_err(describe)?;
    if metadata.is_dir() {
        return Err("É uma pasta".into());
    }
    let stamp = stamp(&metadata);
    if metadata.len() > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { stamp, max: MAX_TEXT_BYTES });
    }
    let bytes = fs::read(&path).map_err(describe)?;
    Ok(match text::decode(&bytes) {
        Decoded::Text { text, encoding, eol, mixed_eol } => {
            FileContent::Text { contents: text, encoding, eol, mixed_eol, stamp, readonly: metadata.permissions().readonly() }
        }
        Decoded::Binary => FileContent::Binary { stamp },
    })
}

static TEMP_COUNTER: AtomicU32 = AtomicU32::new(0);

#[cfg(windows)]
fn replace_file(target: &Path, replacement: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *const std::ffi::c_void,
            reserved: *const std::ffi::c_void,
        ) -> i32;
    }
    const REPLACEFILE_IGNORE_MERGE_ERRORS: u32 = 0x2;
    let wide = |path: &Path| path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (target, replacement) = (wide(target), wide(replacement));
    unsafe { ReplaceFileW(target.as_ptr(), replacement.as_ptr(), std::ptr::null(), REPLACEFILE_IGNORE_MERGE_ERRORS, std::ptr::null(), std::ptr::null()) != 0 }
}

#[cfg(not(windows))]
fn replace_file(_: &Path, _: &Path) -> bool {
    false
}

/// Saves `contents` ("\n" line breaks) in the file's `encoding` with `eol`. `expected` is the
/// stamp the editor read: if the file changed (or vanished) since, nothing is written and the
/// answer is `FILE_CHANGED`. Without it the file is created, or overwritten. Atomic: a temporary
/// file next to it replaces it (keeping its attributes).
pub fn write(root: &Root, rel: &str, contents: &str, encoding: Encoding, eol: Eol, expected: Option<Stamp>) -> Result<Stamp, String> {
    let bytes = text::encode(contents, encoding, eol)?;
    let existing = match paths::resolve(root, rel) {
        Ok(path) => Some(path),
        // Missing: a new file (its name checked), unless something else is wrong.
        Err(error) if fs::symlink_metadata(root.canonical.join(paths::split_rel(rel)?.join("\\"))).is_ok() => return Err(error),
        Err(_) => None,
    };
    let target = match &existing {
        Some(path) => {
            let metadata = fs::metadata(path).map_err(describe)?;
            if metadata.is_dir() {
                return Err("É uma pasta".into());
            }
            if expected.is_some_and(|expected| expected != stamp(&metadata)) {
                return Err(FILE_CHANGED.into());
            }
            if metadata.permissions().readonly() {
                return Err("Arquivo somente leitura".into());
            }
            path.clone()
        }
        None if expected.is_some() => return Err(FILE_CHANGED.into()),
        None => {
            let path = paths::resolve_new(root, rel)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(describe)?;
            }
            path
        }
    };
    let folder = target.parent().ok_or_else(|| paths::INVALID_PATH.to_string())?;
    let name = target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = folder.join(format!("{TEMP_PREFIX}{name}-{}-{}", std::process::id(), TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)));
    let written = fs::File::create(&temp).and_then(|mut file| {
        file.write_all(&bytes)?;
        file.sync_all()
    });
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(describe(error));
    }
    let replaced = existing.is_some() && replace_file(&target, &temp);
    if !replaced
        && let Err(error) = fs::rename(&temp, &target)
    {
        let _ = fs::remove_file(&temp);
        return Err(describe(error));
    }
    stamp_of(&target)
}

/// The current stamp of each path (None when it is gone or unreadable).
pub fn stat(root: &Root, rels: &[String]) -> Vec<Option<Stamp>> {
    rels.iter().map(|rel| paths::resolve(root, rel).ok().and_then(|path| stamp_of(&path).ok())).collect()
}

/// A new empty file or folder (missing folders on the way are created).
pub fn create(root: &Root, rel: &str, dir: bool) -> Result<(), String> {
    let path = paths::resolve_new(root, rel)?;
    if fs::symlink_metadata(&path).is_ok() {
        return Err(describe(io::ErrorKind::AlreadyExists.into()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(describe)?;
    }
    if dir {
        fs::create_dir(&path).map_err(describe)
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(&path).map(|_| ()).map_err(describe)
    }
}

/// Renames or moves an entry (a link is moved, not what it points to). Changing only the case of
/// a name is allowed.
pub fn rename(root: &Root, from: &str, to: &str) -> Result<(), String> {
    let source = paths::resolve_entry(root, from)?;
    let target = paths::resolve_new(root, to)?;
    if source == target {
        return Ok(());
    }
    let same_entry = source.to_string_lossy().to_lowercase() == target.to_string_lossy().to_lowercase();
    if fs::symlink_metadata(&target).is_ok() && !same_entry {
        return Err(describe(io::ErrorKind::AlreadyExists.into()));
    }
    if fs::symlink_metadata(&source).is_ok_and(|metadata| metadata.is_dir()) && target.starts_with(&source) {
        return Err("Uma pasta não pode ir para dentro dela mesma".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(describe)?;
    }
    fs::rename(&source, &target).map_err(describe)
}

/// "name (2).ext", "name (3).ext"... the first that is free.
fn free_name(path: &Path) -> PathBuf {
    if fs::symlink_metadata(path).is_err() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = path.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| path.with_file_name(format!("{stem} ({n}){extension}")))
        .find(|candidate| fs::symlink_metadata(candidate).is_err())
        .unwrap_or_else(|| path.to_path_buf())
}

/// Copies a folder's contents; links inside are skipped (never followed).
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    for item in fs::read_dir(from)? {
        let item = item?;
        let kind = item.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        let target = to.join(item.file_name());
        if kind.is_dir() {
            copy_tree(&item.path(), &target)?;
        } else {
            fs::copy(item.path(), target)?;
        }
    }
    Ok(())
}

/// Copies a file or folder to `to` (or the first free "name (n)" next to it); returns where the
/// copy went, relative to the root.
pub fn copy(root: &Root, from: &str, to: &str) -> Result<String, String> {
    let source = paths::resolve(root, from)?;
    let target = free_name(&paths::resolve_new(root, to)?);
    if source.is_dir() && target.starts_with(&source) {
        return Err("Uma pasta não pode ir para dentro dela mesma".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(describe)?;
    }
    if source.is_dir() {
        copy_tree(&source, &target).map_err(describe)?;
    } else {
        fs::copy(&source, &target).map_err(describe)?;
    }
    root.relative(&target).ok_or_else(|| paths::OUTSIDE.into())
}

/// Moves `paths` to the Recycle Bin. On a thread of its own: the shell's file operation needs
/// COM, initialised there the way it wants.
pub fn recycle(paths: Vec<PathBuf>) -> Result<(), String> {
    let paths: Vec<PathBuf> = paths.iter().map(|path| paths::plain(path)).collect();
    match std::thread::spawn(move || trash::delete_all(&paths)).join() {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(format!("Não foi possível mover para a Lixeira: {error}")),
        Err(_) => Err("Não foi possível mover para a Lixeira".into()),
    }
}

/// Deletes entries: to the Recycle Bin, or for good. A link goes, never what it points to; the
/// root itself cannot be deleted.
pub fn delete(root: &Root, rels: &[String], permanent: bool) -> Result<(), String> {
    let entries = rels.iter().map(|rel| paths::resolve_entry(root, rel)).collect::<Result<Vec<_>, _>>()?;
    if !permanent {
        return recycle(entries);
    }
    for entry in entries {
        let metadata = fs::symlink_metadata(&entry).map_err(describe)?;
        let removed = if metadata.is_symlink() {
            // A link to a folder (or a junction) is removed as a folder, a link to a file as a file.
            fs::remove_dir(&entry).or_else(|_| fs::remove_file(&entry))
        } else if metadata.is_dir() {
            fs::remove_dir_all(&entry)
        } else {
            fs::remove_file(&entry)
        };
        removed.map_err(describe)?;
    }
    Ok(())
}

/// Shows an entry selected in Explorer (the root: the folder itself).
pub fn reveal(root: &Root, rel: &str) -> Result<(), String> {
    let mut command = std::process::Command::new("explorer.exe");
    if paths::split_rel(rel)?.is_empty() {
        command.arg(paths::plain(&root.canonical));
    } else {
        let entry = paths::plain(&paths::resolve_entry(root, rel)?);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.raw_arg(format!("/select,\"{}\"", entry.display()));
        }
        #[cfg(not(windows))]
        command.arg(entry);
    }
    // Explorer exits with 1 even when it worked: it is not waited for.
    command.spawn().map(|_| ()).map_err(|error| format!("Falha ao abrir o Explorer: {error}"))
}

/// The drive (or share) the folder is on, and its space.
pub fn disk(root: &Root) -> Option<crate::system::Disk> {
    crate::system::disk_of(&paths::plain(&root.canonical))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> (PathBuf, Root) {
        let dir = std::env::temp_dir().join(format!("jarvis-ws-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("target").join("debug")).unwrap();
        fs::write(dir.join("src").join("main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.join("README.md"), "# Projeto\r\n").unwrap();
        fs::write(dir.join(".gitignore"), "target/\n*.log\n").unwrap();
        fs::write(dir.join("debug.log"), "x").unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::write(dir.join("A.txt"), "a").unwrap();
        let root = Root::new(&dir.display().to_string()).unwrap();
        (dir, root)
    }

    #[test]
    fn lists_folders_first_with_ignore_and_hidden_flags() {
        let (dir, root) = project("list");
        let listing = list(&root, "").unwrap();
        let names: Vec<&str> = listing.entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["src", "target", ".gitignore", "A.txt", "b.txt", "debug.log", "README.md"], ".git is left out");
        let by_name = |name: &str| listing.entries.iter().find(|entry| entry.name == name).unwrap().clone();
        assert!(by_name("target").ignored && by_name("debug.log").ignored, "gitignored without a repository too");
        assert!(!by_name("src").ignored && !by_name("README.md").ignored);
        assert!(by_name(".gitignore").hidden && !by_name("README.md").hidden);
        assert_eq!(by_name("README.md").size, 11);
        assert_eq!(by_name("src").kind, EntryKind::Dir);
        let inner = list(&root, "src").unwrap();
        assert_eq!(inner.path, "src");
        assert_eq!(inner.entries[0].path, "src/main.rs");
        assert_eq!(list(&root, "README.md").unwrap_err(), "Não é uma pasta");
        let json = serde_json::to_value(&inner.entries[0]).unwrap();
        assert_eq!(json["kind"], "file");
        assert!(json.get("modified").is_some() && json.get("readonly").is_some());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_text_binary_and_large_files() {
        let (dir, root) = project("read");
        let FileContent::Text { contents, encoding, eol, stamp, .. } = read(&root, "README.md").unwrap() else { panic!("text") };
        assert_eq!((contents.as_str(), encoding, eol), ("# Projeto\n", Encoding::Utf8, Eol::Crlf));
        assert_eq!(stamp.size, 11);
        fs::write(dir.join("logo.png"), b"\x89PNG\r\n\x1a\n\x00\x00").unwrap();
        assert!(matches!(read(&root, "logo.png").unwrap(), FileContent::Binary { .. }));
        fs::write(dir.join("big.log"), vec![b'a'; MAX_TEXT_BYTES as usize + 1]).unwrap();
        assert!(matches!(read(&root, "big.log").unwrap(), FileContent::TooLarge { max: MAX_TEXT_BYTES, .. }));
        assert_eq!(read(&root, "src").unwrap_err(), "É uma pasta");
        let json = serde_json::to_value(read(&root, "README.md").unwrap()).unwrap();
        assert_eq!((json["kind"].as_str(), json["eol"].as_str(), json["mixedEol"].as_bool()), (Some("text"), Some("crlf"), Some(false)));
        assert_eq!(serde_json::to_value(read(&root, "big.log").unwrap()).unwrap()["kind"], "tooLarge");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_keep_encoding_and_line_endings_and_refuse_stale_stamps() {
        let (dir, root) = project("write");
        let FileContent::Text { contents, encoding, eol, stamp, .. } = read(&root, "README.md").unwrap() else { panic!("text") };
        let saved = write(&root, "README.md", &format!("{contents}mais\n"), encoding, eol, Some(stamp)).unwrap();
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"# Projeto\r\nmais\r\n");
        assert_eq!(saved.size, 17);
        // The editor's stamp is now old: someone else's change is not overwritten.
        assert_eq!(write(&root, "README.md", "x", encoding, eol, Some(stamp)).unwrap_err(), FILE_CHANGED);
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"# Projeto\r\nmais\r\n");
        // Without a stamp it is overwritten; a missing file is created with its folders.
        write(&root, "README.md", "novo\n", Encoding::Utf8bom, Eol::Lf, None).unwrap();
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"\xEF\xBB\xBFnovo\n");
        write(&root, "docs/guia/novo.md", "olá", Encoding::Windows1252, Eol::Lf, None).unwrap();
        assert_eq!(fs::read(dir.join("docs").join("guia").join("novo.md")).unwrap(), b"ol\xe1");
        // A file deleted since it was read is a change too.
        assert_eq!(write(&root, "sumiu.txt", "x", Encoding::Utf8, Eol::Lf, Some(saved)).unwrap_err(), FILE_CHANGED);
        assert_eq!(write(&root, "x.txt", "日本", Encoding::Windows1252, Eol::Lf, None).unwrap_err(), text::NOT_1252);
        assert_eq!(write(&root, "../fora.txt", "x", Encoding::Utf8, Eol::Lf, None).unwrap_err(), paths::INVALID_PATH);
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().filter(|item| item.file_name().to_string_lossy().starts_with(TEMP_PREFIX)).collect();
        assert!(leftovers.is_empty(), "no temporary file is left behind");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn saving_keeps_the_hidden_attribute_and_refuses_read_only_files() {
        let (dir, root) = project("attributes");
        let hidden = dir.join("oculto.txt");
        fs::write(&hidden, "a").unwrap();
        assert!(std::process::Command::new("attrib").arg("+h").arg(&hidden).status().unwrap().success());
        write(&root, "oculto.txt", "b", Encoding::Utf8, Eol::Lf, None).unwrap();
        assert_eq!(fs::read_to_string(&hidden).unwrap(), "b");
        assert!(hidden_attribute(&fs::metadata(&hidden).unwrap()), "ReplaceFileW keeps the attributes");
        let locked = dir.join("travado.txt");
        fs::write(&locked, "a").unwrap();
        let mut permissions = fs::metadata(&locked).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&locked, permissions.clone()).unwrap();
        assert_eq!(write(&root, "travado.txt", "b", Encoding::Utf8, Eol::Lf, None).unwrap_err(), "Arquivo somente leitura");
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(&locked, permissions).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn creates_renames_copies_and_deletes() {
        let (dir, root) = project("ops");
        create(&root, "src/novo.py", false).unwrap();
        assert!(dir.join("src").join("novo.py").is_file());
        assert_eq!(create(&root, "src/novo.py", false).unwrap_err(), "Já existe um item com esse nome");
        create(&root, "pasta/sub", true).unwrap();
        assert!(dir.join("pasta").join("sub").is_dir());
        // Rename, move, case only.
        rename(&root, "src/novo.py", "src/velho.py").unwrap();
        assert!(dir.join("src").join("velho.py").is_file());
        rename(&root, "src/velho.py", "pasta/velho.py").unwrap();
        assert!(dir.join("pasta").join("velho.py").is_file());
        rename(&root, "b.txt", "B.txt").unwrap();
        assert!(fs::read_dir(&dir).unwrap().flatten().any(|item| item.file_name() == "B.txt"));
        assert_eq!(rename(&root, "B.txt", "README.md").unwrap_err(), "Já existe um item com esse nome");
        assert_eq!(rename(&root, "pasta", "pasta/sub/pasta").unwrap_err(), "Uma pasta não pode ir para dentro dela mesma");
        assert!(rename(&root, "", "x").is_err(), "the root stays");
        // Copies get a free name.
        assert_eq!(copy(&root, "README.md", "README.md").unwrap(), "README (2).md");
        assert_eq!(copy(&root, "README.md", "README.md").unwrap(), "README (3).md");
        assert_eq!(copy(&root, "pasta", "pasta2").unwrap(), "pasta2");
        assert!(dir.join("pasta2").join("velho.py").is_file());
        assert_eq!(copy(&root, "pasta", "pasta/sub/copia").unwrap_err(), "Uma pasta não pode ir para dentro dela mesma");
        // Permanent deletion.
        delete(&root, &["pasta2".into(), "README (3).md".into()], true).unwrap();
        assert!(!dir.join("pasta2").exists() && !dir.join("README (3).md").exists());
        assert!(delete(&root, &["".into()], true).is_err(), "the root stays");
        assert_eq!(stat(&root, &["README.md".into(), "nada.txt".into()])[1], None);
        assert!(stat(&root, &["README.md".into()])[0].is_some());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_inside_is_listed_as_a_link_and_deleted_alone() {
        let (dir, root) = project("junction");
        let outside = std::env::temp_dir().join(format!("jarvis-ws-junction-target-{}", std::process::id()));
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), "x").unwrap();
        let made = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(dir.join("link")).arg(&outside).output().unwrap();
        assert!(made.status.success());
        let entry = list(&root, "").unwrap().entries.into_iter().find(|entry| entry.name == "link").unwrap();
        assert!(entry.link && entry.kind == EntryKind::Dir);
        assert_eq!(read(&root, "link/keep.txt").unwrap_err(), paths::OUTSIDE);
        delete(&root, &["link".into()], true).unwrap();
        assert!(!dir.join("link").exists());
        assert!(outside.join("keep.txt").exists(), "the target is untouched");
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn opening_refuses_drive_roots() {
        let workspaces = Workspaces::default();
        #[cfg(windows)]
        assert_eq!(workspaces.open("C:\\", |_| {}).unwrap_err(), "Abra uma pasta de projeto, não a raiz da unidade");
        let (dir, root) = project("open");
        let info = workspaces.open(&dir.display().to_string(), |_| {}).unwrap();
        assert_eq!(info.root, root.display());
        assert_eq!(info.name, dir.file_name().unwrap().to_string_lossy());
        assert!(info.watching);
        // Opening again keeps the one watcher.
        assert!(workspaces.open(&dir.display().to_string(), |_| {}).unwrap().watching);
        workspaces.close(&info.root);
        workspaces.close_all();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn knows_the_disk_of_a_folder() {
        let (dir, root) = project("disk");
        #[cfg(windows)]
        {
            let disk = disk(&root).expect("the temp folder's drive");
            assert!(disk.name.ends_with(':') && disk.usage.total > 0 && disk.usage.used <= disk.usage.total, "{disk:?}");
        }
        let _ = root;
        fs::remove_dir_all(dir).unwrap();
    }

    /// The real Recycle Bin (left out of normal runs: it fills the user's bin).
    #[test]
    #[ignore = "uses the user's Recycle Bin"]
    fn deletes_to_the_recycle_bin() {
        let (dir, root) = project("recycle");
        delete(&root, &["b.txt".into()], false).unwrap();
        assert!(!dir.join("b.txt").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
