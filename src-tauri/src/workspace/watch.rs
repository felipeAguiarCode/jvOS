//! Follows an open folder: what changed on disk (by jv_ide, a terminal, git, another editor)
//! reaches the UI in batches, so the tree, the open files and the Git panel keep up.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;

use super::paths::{self, Root};
use super::TEMP_PREFIX;

/// A batch goes out after this long without events...
const QUIET: Duration = Duration::from_millis(200);
/// ...or this long after its first one, whatever comes.
const MAX_WAIT: Duration = Duration::from_secs(1);
/// More paths than this in one batch: the UI reloads what it shows instead.
const MAX_PATHS: usize = 500;
/// More raw events than this: the system's buffer has likely overflowed (notify does not say so on
/// Windows), so some were lost.
const MAX_EVENTS: usize = 2000;
/// What in a git folder says the status or the branch changed.
const GIT_FILES: [&str; 8] = ["HEAD", "index", "packed-refs", "ORIG_HEAD", "MERGE_HEAD", "FETCH_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// Relative to the root, with "/".
    pub path: String,
    pub kind: ChangeKind,
}

/// One batch, as the `workspace:changed` event carries it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub root: String,
    pub changes: Vec<Change>,
    /// The repository's status or branch may have changed.
    pub git: bool,
    /// Too much changed (or events were lost): reload everything shown.
    pub rescan: bool,
}

/// Where events come from: the folder (as watched) and its repository's git folder.
pub struct Scope {
    pub root: PathBuf,
    pub git_dir: Option<PathBuf>,
}

impl Scope {
    fn git_relevant(rest: &Path) -> bool {
        let parts: Vec<String> = rest.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
        match parts.first().map(String::as_str) {
            Some("refs") => true,
            Some(first) if first.starts_with("rebase-") => true,
            Some(first) => parts.len() == 1 && GIT_FILES.contains(&first),
            None => false,
        }
    }
}

/// The changes collected since the last batch, merged per path.
#[derive(Default)]
pub struct Batch {
    order: Vec<String>,
    kinds: HashMap<String, ChangeKind>,
    git: bool,
    rescan: bool,
    events: usize,
}

fn merge(before: ChangeKind, after: ChangeKind) -> ChangeKind {
    use ChangeKind::*;
    match (before, after) {
        (Created, Modified) => Created,
        (Removed, Created | Modified) => Modified,
        (_, Removed) => Removed,
        (Modified, Created) => Modified,
        (_, kind) => kind,
    }
}

impl Batch {
    fn record(&mut self, scope: &Scope, path: &Path, kind: ChangeKind) {
        if let Some(git_dir) = &scope.git_dir
            && let Ok(rest) = path.strip_prefix(git_dir)
        {
            self.git |= Scope::git_relevant(rest);
            return;
        }
        let Ok(rest) = path.strip_prefix(&scope.root) else { return };
        let parts: Vec<String> = rest.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.is_empty() || parts[0] == ".git" || parts.last().is_some_and(|name| name.starts_with(TEMP_PREFIX)) {
            return;
        }
        let rel = parts.join("/");
        match self.kinds.get_mut(&rel) {
            Some(existing) => *existing = merge(*existing, kind),
            None => {
                self.order.push(rel.clone());
                self.kinds.insert(rel, kind);
            }
        }
        if self.order.len() > MAX_PATHS {
            self.rescan = true;
        }
    }

    pub fn add(&mut self, scope: &Scope, result: notify::Result<Event>) {
        self.events += 1;
        if self.events > MAX_EVENTS {
            self.rescan = true;
        }
        let event = match result {
            Ok(event) => event,
            Err(_) => {
                self.rescan = true;
                return;
            }
        };
        if event.need_rescan() {
            self.rescan = true;
        }
        let kind = match event.kind {
            EventKind::Access(_) => return,
            EventKind::Create(_) => ChangeKind::Created,
            EventKind::Remove(_) => ChangeKind::Removed,
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => ChangeKind::Removed,
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => ChangeKind::Created,
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                if let [from, to, ..] = event.paths.as_slice() {
                    self.record(scope, from, ChangeKind::Removed);
                    self.record(scope, to, ChangeKind::Created);
                }
                return;
            }
            _ => ChangeKind::Modified,
        };
        for path in &event.paths {
            self.record(scope, path, kind);
        }
    }

    /// The batch for the UI, if anything happened; starts a new one.
    pub fn take(&mut self, root: &str) -> Option<Changed> {
        let batch = std::mem::take(self);
        if batch.order.is_empty() && !batch.git && !batch.rescan {
            return None;
        }
        let changes = if batch.rescan {
            Vec::new()
        } else {
            batch.order.into_iter().map(|path| Change { kind: batch.kinds[&path], path }).collect()
        };
        Some(Changed { root: root.to_string(), changes, git: batch.git, rescan: batch.rescan })
    }
}

/// A folder being followed. Dropping it stops the watcher, whose thread then ends.
pub struct Watch {
    _watcher: notify::RecommendedWatcher,
}

impl Watch {
    pub fn start(root: &Root, git_dir: Option<PathBuf>, on_change: impl Fn(Changed) + Send + 'static) -> Result<Self, String> {
        let watched = paths::plain(&root.canonical);
        let git_dir = git_dir.map(|dir| paths::plain(&dir));
        let (sender, events) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        watcher.watch(&watched, RecursiveMode::Recursive).map_err(|error| error.to_string())?;
        // The repository's own folder lives elsewhere when a subfolder (or a worktree) is open.
        if let Some(dir) = git_dir.as_ref().filter(|dir| !dir.starts_with(&watched)) {
            let _ = watcher.watch(dir, RecursiveMode::Recursive);
        }
        let scope = Scope { root: watched, git_dir };
        let shown = root.display();
        thread::spawn(move || {
            let mut batch = Batch::default();
            while let Ok(first) = events.recv() {
                batch.add(&scope, first);
                let started = Instant::now();
                loop {
                    let left = MAX_WAIT.saturating_sub(started.elapsed());
                    if left.is_zero() {
                        break;
                    }
                    match events.recv_timeout(QUIET.min(left)) {
                        Ok(event) => batch.add(&scope, event),
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
                if let Some(changed) = batch.take(&shown) {
                    on_change(changed);
                }
            }
        });
        Ok(Self { _watcher: watcher })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn scope() -> Scope {
        Scope { root: PathBuf::from(r"C:\proj"), git_dir: Some(PathBuf::from(r"C:\proj\.git")) }
    }

    fn event(kind: EventKind, paths: &[&str]) -> notify::Result<Event> {
        Ok(paths.iter().fold(Event::new(kind), |event, path| event.add_path(PathBuf::from(path))))
    }

    const CREATE: EventKind = EventKind::Create(CreateKind::Any);
    const MODIFY: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Any));
    const REMOVE: EventKind = EventKind::Remove(RemoveKind::Any);

    #[test]
    fn merges_events_per_path() {
        let scope = scope();
        let mut batch = Batch::default();
        batch.add(&scope, event(CREATE, &[r"C:\proj\novo.txt"]));
        batch.add(&scope, event(MODIFY, &[r"C:\proj\novo.txt"]));
        batch.add(&scope, event(REMOVE, &[r"C:\proj\velho.txt"]));
        batch.add(&scope, event(CREATE, &[r"C:\proj\velho.txt"]));
        batch.add(&scope, event(MODIFY, &[r"C:\proj\src\a.rs"]));
        batch.add(&scope, event(REMOVE, &[r"C:\proj\src\a.rs"]));
        // Renames arrive as two halves.
        batch.add(&scope, event(EventKind::Modify(ModifyKind::Name(RenameMode::From)), &[r"C:\proj\de.txt"]));
        batch.add(&scope, event(EventKind::Modify(ModifyKind::Name(RenameMode::To)), &[r"C:\proj\para.txt"]));
        batch.add(&scope, event(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &[r"C:\proj\x.txt", r"C:\proj\y.txt"]));
        batch.add(&scope, event(EventKind::Access(notify::event::AccessKind::Any), &[r"C:\proj\lido.txt"]));
        let changed = batch.take("C:\\proj").unwrap();
        let kinds: Vec<(&str, ChangeKind)> = changed.changes.iter().map(|change| (change.path.as_str(), change.kind)).collect();
        use ChangeKind::*;
        assert_eq!(
            kinds,
            [
                ("novo.txt", Created),
                ("velho.txt", Modified),
                ("src/a.rs", Removed),
                ("de.txt", Removed),
                ("para.txt", Created),
                ("x.txt", Removed),
                ("y.txt", Created)
            ]
        );
        assert!(!changed.git && !changed.rescan);
        assert_eq!(batch.take("C:\\proj"), None, "a new batch starts empty");
    }

    #[test]
    fn git_internals_only_flag_the_repository() {
        let scope = scope();
        let mut batch = Batch::default();
        batch.add(&scope, event(MODIFY, &[r"C:\proj\.git\objects\ab\cdef"]));
        batch.add(&scope, event(CREATE, &[r"C:\proj\.git\index.lock"]));
        assert_eq!(batch.take("C:\\proj"), None, "objects and locks say nothing");
        for path in [r"C:\proj\.git\index", r"C:\proj\.git\HEAD", r"C:\proj\.git\refs\heads\main", r"C:\proj\.git\rebase-merge\done"] {
            batch.add(&scope, event(MODIFY, &[path]));
            let changed = batch.take("C:\\proj").unwrap();
            assert!(changed.git && changed.changes.is_empty(), "{path}");
        }
        // A git folder outside the root (a subfolder was opened).
        let outside = Scope { root: PathBuf::from(r"C:\repo\app"), git_dir: Some(PathBuf::from(r"C:\repo\.git")) };
        batch.add(&outside, event(MODIFY, &[r"C:\repo\.git\index"]));
        batch.add(&outside, event(MODIFY, &[r"C:\repo\outro\x.txt"]));
        let changed = batch.take("C:\\repo\\app").unwrap();
        assert!(changed.git && changed.changes.is_empty());
    }

    #[test]
    fn our_temporary_files_are_ignored_and_floods_ask_for_a_rescan() {
        let scope = scope();
        let mut batch = Batch::default();
        batch.add(&scope, event(CREATE, &[r"C:\proj\src\.~jv-a.rs-1-0"]));
        batch.add(&scope, event(MODIFY, &[r"C:\proj\src\a.rs"]));
        assert_eq!(batch.take("C:\\proj").unwrap().changes, [Change { path: "src/a.rs".into(), kind: ChangeKind::Modified }]);
        for index in 0..=MAX_PATHS {
            batch.add(&scope, event(CREATE, &[&format!(r"C:\proj\node_modules\{index}.js")]));
        }
        let flood = batch.take("C:\\proj").unwrap();
        assert!(flood.rescan && flood.changes.is_empty());
        batch.add(&scope, Err(notify::Error::generic("lost")));
        assert!(batch.take("C:\\proj").unwrap().rescan);
        for _ in 0..=MAX_EVENTS {
            batch.add(&scope, event(MODIFY, &[r"C:\proj\a.txt"]));
        }
        assert!(batch.take("C:\\proj").unwrap().rescan, "too many events: some were likely lost");
        let json = serde_json::to_value(Changed { root: "C:\\proj".into(), changes: vec![Change { path: "a".into(), kind: ChangeKind::Removed }], git: false, rescan: false }).unwrap();
        assert_eq!(json["changes"][0]["kind"], "removed");
    }

    /// The real watcher: a file written in the folder arrives as a batch; once dropped, nothing
    /// more is reported.
    #[test]
    fn follows_a_real_folder() {
        let dir = std::env::temp_dir().join(format!("jarvis-ws-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let root = Root::new(&dir.display().to_string()).unwrap();
        let (sender, batches) = mpsc::channel();
        let watch = Watch::start(&root, None, move |changed| {
            let _ = sender.send(changed);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(dir.join("sub").join("novo.txt"), "x").unwrap();
        let changed = batches.recv_timeout(Duration::from_secs(5)).expect("a batch");
        assert_eq!(changed.root, root.display());
        assert!(changed.changes.iter().any(|change| change.path == "sub/novo.txt"), "{changed:?}");
        drop(watch);
        std::thread::sleep(Duration::from_millis(300));
        while batches.try_recv().is_ok() {}
        std::fs::write(dir.join("depois.txt"), "x").unwrap();
        assert!(batches.recv_timeout(Duration::from_millis(1500)).is_err(), "a dropped watch reports nothing");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
