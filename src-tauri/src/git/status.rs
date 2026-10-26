//! `git status --porcelain=v2 --branch --show-stash -z`, read into what the Git panel shows.

use serde::Serialize;

/// The panel lists at most this many changes in all.
const MAX_CHANGES: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    /// Relative to the repository's top, with "/".
    pub path: String,
    /// Where a renamed or copied file came from.
    pub orig_path: Option<String>,
    /// M (modified), A (added), D (deleted), R (renamed), C (copied), T (type changed), U (conflict), ? (untracked).
    pub status: String,
    pub submodule: bool,
}

/// What the status output says (the rest of `GitStatus` comes from elsewhere).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Parsed {
    /// The commit HEAD points to; None before the first commit.
    pub oid: Option<String>,
    /// The branch; None when HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// None when git is too old to report it (before 2.35).
    pub stash: Option<u32>,
    pub staged: Vec<GitChange>,
    pub unstaged: Vec<GitChange>,
    pub untracked: Vec<GitChange>,
    pub conflicted: Vec<GitChange>,
    pub truncated: bool,
}

impl Parsed {
    fn count(&self) -> usize {
        self.staged.len() + self.unstaged.len() + self.untracked.len() + self.conflicted.len()
    }
}

fn change(path: &str, orig_path: Option<&str>, status: char, submodule: bool) -> GitChange {
    GitChange { path: path.to_string(), orig_path: orig_path.map(str::to_string), status: status.to_string(), submodule }
}

/// One tracked entry: X (index) goes to staged, Y (work tree) to unstaged, "." meaning unchanged.
fn tracked(parsed: &mut Parsed, xy: &str, sub: &str, path: &str, orig: Option<&str>) {
    let mut codes = xy.chars();
    let (x, y) = (codes.next().unwrap_or('.'), codes.next().unwrap_or('.'));
    let submodule = sub.starts_with('S');
    if x != '.' {
        parsed.staged.push(change(path, orig, x, submodule));
    }
    if y != '.' {
        parsed.unstaged.push(change(path, orig, y, submodule));
    }
}

pub fn parse(output: &str) -> Parsed {
    let mut parsed = Parsed::default();
    let mut records = output.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if parsed.count() >= MAX_CHANGES && !record.starts_with('#') {
            parsed.truncated = true;
            continue;
        }
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => parsed.oid = Some(value.to_string()),
                "branch.head" if value != "(detached)" => parsed.branch = Some(value.to_string()),
                "branch.upstream" => parsed.upstream = Some(value.to_string()),
                "branch.ab" => {
                    for part in value.split_whitespace() {
                        if let Some(ahead) = part.strip_prefix('+') {
                            parsed.ahead = ahead.parse().unwrap_or(0);
                        } else if let Some(behind) = part.strip_prefix('-') {
                            parsed.behind = behind.parse().unwrap_or(0);
                        }
                    }
                }
                "stash" => parsed.stash = value.parse().ok(),
                _ => {}
            }
            continue;
        }
        match record.as_bytes().first() {
            Some(b'1') => {
                let fields: Vec<&str> = record.splitn(9, ' ').collect();
                if let [_, xy, sub, _, _, _, _, _, path] = fields.as_slice() {
                    tracked(&mut parsed, xy, sub, path, None);
                }
            }
            // A rename or copy: its original path is the next record.
            Some(b'2') => {
                let fields: Vec<&str> = record.splitn(10, ' ').collect();
                let orig = records.next();
                if let [_, xy, sub, _, _, _, _, _, _, path] = fields.as_slice() {
                    tracked(&mut parsed, xy, sub, path, orig);
                }
            }
            Some(b'u') => {
                let fields: Vec<&str> = record.splitn(11, ' ').collect();
                if let [_, _, sub, .., path] = fields.as_slice() {
                    parsed.conflicted.push(change(path, None, 'U', sub.starts_with('S')));
                }
            }
            Some(b'?') => {
                if let Some(path) = record.strip_prefix("? ") {
                    parsed.untracked.push(change(path, None, '?', false));
                }
            }
            _ => {}
        }
    }
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO: &str = "0000000000000000000000000000000000000000";
    const A: &str = "1111111111111111111111111111111111111111";

    fn ordinary(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 {A} {A} {path}")
    }

    #[test]
    fn reads_branch_and_changes() {
        let output = [
            format!("# branch.oid {A}"),
            "# branch.head main".into(),
            "# branch.upstream origin/main".into(),
            "# branch.ab +8 -2".into(),
            "# stash 3".into(),
            ordinary(".M", "inventory/models.py"),
            ordinary("M.", "README.md"),
            ordinary("MM", "src/ação com espaço.rs"),
            ordinary("A.", "novo.txt"),
            ordinary("D.", "velho.txt"),
            ordinary("T.", "link"),
            format!("1 .M SC.. 160000 160000 160000 {A} {A} vendor/lib"),
            format!("2 R. N... 100644 100644 100644 {A} {A} R100 docs/guia novo.md"),
            "docs/guia antigo.md".into(),
            format!("u UU N... 100644 100644 100644 100644 {A} {A} {A} conflito.rs"),
            format!("u AA N... 000000 100644 100644 100644 {ZERO} {A} {A} ambos.rs"),
            "? untracked file.txt".into(),
            "? .env".into(),
            "! ignored.log".into(),
        ]
        .join("\0")
            + "\0";
        let parsed = parse(&output);
        assert_eq!(parsed.oid.as_deref(), Some(A));
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!((parsed.ahead, parsed.behind, parsed.stash), (8, 2, Some(3)));
        let paths = |list: &[GitChange]| list.iter().map(|item| format!("{}:{}", item.status, item.path)).collect::<Vec<_>>();
        assert_eq!(paths(&parsed.staged), ["M:README.md", "M:src/ação com espaço.rs", "A:novo.txt", "D:velho.txt", "T:link", "R:docs/guia novo.md"]);
        assert_eq!(paths(&parsed.unstaged), ["M:inventory/models.py", "M:src/ação com espaço.rs", "M:vendor/lib"]);
        assert_eq!(paths(&parsed.untracked), ["?:untracked file.txt", "?:.env"]);
        assert_eq!(paths(&parsed.conflicted), ["U:conflito.rs", "U:ambos.rs"]);
        assert_eq!(parsed.staged[5].orig_path.as_deref(), Some("docs/guia antigo.md"));
        assert!(parsed.unstaged[2].submodule && !parsed.unstaged[0].submodule);
        assert!(!parsed.truncated);
    }

    #[test]
    fn reads_new_detached_and_trackless_repositories() {
        let initial = parse("# branch.oid (initial)\0# branch.head main\0? a.txt\0");
        assert_eq!((initial.oid, initial.branch.as_deref(), initial.upstream, initial.stash), (None, Some("main"), None, None));
        assert_eq!(initial.untracked.len(), 1);
        let detached = parse(&format!("# branch.oid {A}\0# branch.head (detached)\0"));
        assert_eq!((detached.oid.as_deref(), detached.branch), (Some(A), None));
        assert_eq!(parse(""), Parsed::default());
    }

    #[test]
    fn stops_listing_at_the_limit() {
        let many: String = (0..MAX_CHANGES + 5).map(|index| format!("? f{index}.txt\0")).collect();
        let parsed = parse(&many);
        assert_eq!(parsed.untracked.len(), MAX_CHANGES);
        assert!(parsed.truncated);
        let json = serde_json::to_value(&parsed.untracked[0]).unwrap();
        assert_eq!(json["origPath"], serde_json::Value::Null);
    }
}
