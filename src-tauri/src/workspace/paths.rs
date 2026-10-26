//! Paths inside a workspace. The UI names a folder (`root`, absolute) and a path relative to it
//! (`rel`, "/"-separated); nothing it sends may lead out of the root, not even through a link.

use std::fs;
use std::path::{Path, PathBuf};

pub const OUTSIDE: &str = "Fora da pasta do projeto";
pub const INVALID_PATH: &str = "Caminho inválido";
pub const INVALID_NAME: &str = "Nome inválido";

/// Windows' device names: no file may be called that, whatever its extension.
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5",
    "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A folder the UI works in.
#[derive(Debug, Clone)]
pub struct Root {
    /// As the user picked it, made absolute: what the UI shows and the shells start in.
    pub shown: PathBuf,
    /// Its `fs::canonicalize` (a verbatim `\\?\` path): every check compares against this.
    pub canonical: PathBuf,
}

impl Root {
    /// The UI's folder: absolute, existing, a directory.
    pub fn new(path: &str) -> Result<Self, String> {
        let path = Path::new(path.trim());
        if !path.is_absolute() {
            return Err(INVALID_PATH.into());
        }
        let canonical = fs::canonicalize(path).map_err(|_| "Pasta não encontrada".to_string())?;
        if !canonical.is_dir() {
            return Err("Não é uma pasta".into());
        }
        Ok(Self { shown: shown(path), canonical })
    }

    /// The root of a drive or a share ("C:\"), which is too big to watch or index.
    pub fn is_volume(&self) -> bool {
        self.canonical.parent().is_none()
    }

    /// The UI's text for the root.
    pub fn display(&self) -> String {
        self.shown.display().to_string()
    }

    /// `path` (inside the root) as the UI names it: relative, with "/".
    pub fn relative(&self, path: &Path) -> Option<String> {
        let rest = path.strip_prefix(&self.canonical).ok()?;
        Some(rest.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
    }
}

/// `path` absolute and normalised (separators, `.`/`..`), without a trailing separator.
fn shown(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let text = absolute.to_string_lossy();
    let trimmed = text.trim_end_matches(['\\', '/']);
    // "C:\" keeps its backslash: "C:" alone means "the current folder of C:".
    if trimmed.len() == 2 && trimmed.ends_with(':') { absolute } else { PathBuf::from(trimmed) }
}

/// The parts of a relative path; "" is the root itself. Absolute paths, drives, `.`, `..`, empty
/// parts and `:` (alternate data streams) are refused.
pub fn split_rel(rel: &str) -> Result<Vec<&str>, String> {
    let rel = rel.strip_suffix('/').unwrap_or(rel);
    if rel.is_empty() {
        return Ok(Vec::new());
    }
    let parts: Vec<&str> = rel.split(['/', '\\']).collect();
    let bad = |part: &&str| part.is_empty() || *part == "." || *part == ".." || part.contains(':') || part.chars().any(char::is_control);
    if parts.iter().any(bad) {
        return Err(INVALID_PATH.into());
    }
    Ok(parts)
}

/// A file name the UI chose for something new.
pub fn validate_name(name: &str) -> Result<(), String> {
    let forbidden = |c: char| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control();
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_lowercase();
    let valid = !name.is_empty()
        && name.chars().count() <= 255
        && !name.chars().any(forbidden)
        && !name.ends_with(['.', ' '])
        && name != "."
        && name != ".."
        && !RESERVED.contains(&stem.as_str());
    if valid { Ok(()) } else { Err(INVALID_NAME.into()) }
}

fn join(base: &Path, parts: &[&str]) -> PathBuf {
    parts.iter().fold(base.to_path_buf(), |path, part| path.join(part))
}

fn inside(root: &Root, path: &Path) -> Result<(), String> {
    if path.starts_with(&root.canonical) { Ok(()) } else { Err(OUTSIDE.into()) }
}

/// The real path of something that exists inside the root (links followed: a link leading out is
/// refused).
pub fn resolve(root: &Root, rel: &str) -> Result<PathBuf, String> {
    let parts = split_rel(rel)?;
    let canonical = fs::canonicalize(join(&root.canonical, &parts)).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "Arquivo não encontrado".to_string(),
        std::io::ErrorKind::PermissionDenied => "Sem permissão".to_string(),
        _ => INVALID_PATH.to_string(),
    })?;
    inside(root, &canonical)?;
    Ok(canonical)
}

/// An existing entry itself (a link stays a link): its folder must be inside the root. For
/// renaming, deleting and revealing, which act on the entry and never on what a link points to.
pub fn resolve_entry(root: &Root, rel: &str) -> Result<PathBuf, String> {
    let parts = split_rel(rel)?;
    let (name, folder) = parts.split_last().ok_or_else(|| "A pasta do projeto não pode ser alterada".to_string())?;
    let folder = resolve(root, &folder.join("/"))?;
    let entry = folder.join(name);
    fs::symlink_metadata(&entry).map_err(|_| "Arquivo não encontrado".to_string())?;
    Ok(entry)
}

/// Where something new goes: every name is valid and the deepest folder that exists already is
/// inside the root. Missing folders in between are the caller's to create.
pub fn resolve_new(root: &Root, rel: &str) -> Result<PathBuf, String> {
    let parts = split_rel(rel)?;
    if parts.is_empty() {
        return Err(INVALID_NAME.into());
    }
    for part in &parts {
        validate_name(part)?;
    }
    let mut existing = parts.len() - 1;
    while existing > 0 && !join(&root.canonical, &parts[..existing]).exists() {
        existing -= 1;
    }
    let base = resolve(root, &parts[..existing].join("/"))?;
    Ok(join(&base, &parts[existing..]))
}

/// What explorer, cmd and wsl understand: no `\\?\` prefix.
pub fn plain(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> (PathBuf, Root) {
        let dir = std::env::temp_dir().join(format!("jarvis-ws-paths-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src").join("a.rs"), "fn main() {}").unwrap();
        let root = Root::new(&dir.display().to_string()).unwrap();
        (dir, root)
    }

    #[test]
    fn splits_relative_paths_and_refuses_escapes() {
        assert_eq!(split_rel("").unwrap(), Vec::<&str>::new());
        assert_eq!(split_rel("src/a.rs").unwrap(), ["src", "a.rs"]);
        assert_eq!(split_rel("src\\a.rs").unwrap(), ["src", "a.rs"]);
        assert_eq!(split_rel("src/").unwrap(), ["src"]);
        for bad in ["/etc", "..", "src/../..", "./a", "a//b", "C:\\x", "C:x", "a:b", "file.txt:stream", "\\\\server\\share", "a\u{0}b"] {
            assert_eq!(split_rel(bad).unwrap_err(), INVALID_PATH, "{bad:?}");
        }
    }

    #[test]
    fn validates_new_names() {
        for good in ["main.rs", ".gitignore", "Relatório final.md", "a b", "console", "conexão.txt"] {
            assert!(validate_name(good).is_ok(), "{good:?}");
        }
        for bad in ["", ".", "..", "a<b", "a>b", "a:b", "a\"b", "a|b", "a?b", "a*b", "a/b", "a\\b", "trailing.", "trailing ", "CON", "con.txt", "con.d", "Nul", "com1.log", "LPT9", "a\tb"] {
            assert_eq!(validate_name(bad).unwrap_err(), INVALID_NAME, "{bad:?}");
        }
        assert!(validate_name(&"x".repeat(256)).is_err());
    }

    #[test]
    fn resolves_inside_the_root_only() {
        let (dir, root) = temp_root("resolve");
        let file = resolve(&root, "src/a.rs").unwrap();
        assert!(file.starts_with(&root.canonical));
        assert_eq!(root.relative(&file).as_deref(), Some("src/a.rs"));
        // Case does not matter on Windows; the real name comes back.
        #[cfg(windows)]
        assert_eq!(resolve(&root, "SRC/A.RS").unwrap(), file);
        assert_eq!(resolve(&root, "").unwrap(), root.canonical);
        assert_eq!(resolve(&root, "nada.txt").unwrap_err(), "Arquivo não encontrado");
        assert_eq!(resolve(&root, "../x").unwrap_err(), INVALID_PATH);
        // Device names lead out of the folder.
        #[cfg(windows)]
        assert!(resolve(&root, "NUL").is_err());
        // The root's own name: the short (8.3) temp folder and its long name are the same folder.
        assert_eq!(Root::new(&root.canonical.display().to_string()).unwrap().canonical, root.canonical);
        assert_eq!(root.display(), dir.display().to_string());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_roots_that_are_not_folders_and_knows_volume_roots() {
        assert_eq!(Root::new("relative\\path").unwrap_err(), INVALID_PATH);
        assert_eq!(Root::new("C:\\definitely\\missing\\folder").unwrap_err(), "Pasta não encontrada");
        let (dir, root) = temp_root("kinds");
        assert!(!root.is_volume());
        assert_eq!(Root::new(&dir.join("src").join("a.rs").display().to_string()).unwrap_err(), "Não é uma pasta");
        #[cfg(windows)]
        {
            let volume = Root::new("C:\\").unwrap();
            assert!(volume.is_volume());
            assert_eq!(volume.display(), "C:\\");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn new_paths_need_valid_names_and_an_existing_folder_inside() {
        let (dir, root) = temp_root("new");
        let path = resolve_new(&root, "src/novo.py").unwrap();
        assert_eq!(path, root.canonical.join("src").join("novo.py"));
        // Missing folders in between are allowed (the caller creates them).
        assert_eq!(resolve_new(&root, "a/b/c.txt").unwrap(), root.canonical.join("a").join("b").join("c.txt"));
        assert_eq!(resolve_new(&root, "src/con.txt").unwrap_err(), INVALID_NAME);
        assert_eq!(resolve_new(&root, "").unwrap_err(), INVALID_NAME);
        assert_eq!(resolve_new(&root, "../fora.txt").unwrap_err(), INVALID_PATH);
        fs::remove_dir_all(dir).unwrap();
    }

    /// A junction (no admin rights needed) pointing out of the project: reading through it is
    /// refused, but the link itself can be acted on.
    #[cfg(windows)]
    #[test]
    fn links_leading_out_are_refused_but_can_be_removed() {
        let (dir, root) = temp_root("junction");
        let outside = std::env::temp_dir().join(format!("jarvis-ws-paths-outside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "x").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(dir.join("link"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink: {}", String::from_utf8_lossy(&status.stderr));
        assert_eq!(resolve(&root, "link/secret.txt").unwrap_err(), OUTSIDE);
        assert_eq!(resolve(&root, "link").unwrap_err(), OUTSIDE);
        assert_eq!(resolve_new(&root, "link/novo.txt").unwrap_err(), OUTSIDE);
        let entry = resolve_entry(&root, "link").unwrap();
        assert_eq!(entry, root.canonical.join("link"));
        assert!(resolve_entry(&root, "link/secret.txt").is_err());
        fs::remove_dir(&entry).unwrap();
        assert!(outside.join("secret.txt").exists(), "removing the link keeps its target");
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
