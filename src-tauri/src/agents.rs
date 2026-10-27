//! The agents JARVIS writes with the user — `Documentos\JARVIS\Agentes\<name>.md`, in Claude
//! Code's subagent format (YAML frontmatter, then the prompt) — installed as the user's own
//! Claude Code subagents (`~/.claude/agents/`) to run them in a jv_sh tab.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::assistant::Folder;

/// Which agents JARVIS installed: only those it may replace.
const RECORD: &str = ".instalados.json";

/// A name Claude Code takes for a subagent (and a safe file name).
pub fn valid_name(name: &str) -> bool {
    (1..=64).contains(&name.len()) && name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit()) && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// The frontmatter's `key: value` lines (a value may be quoted); None without a frontmatter.
pub fn frontmatter(text: &str) -> Option<Vec<(String, String)>> {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut fields = Vec::new();
    for line in lines {
        if line.trim() == "---" {
            return Some(fields);
        }
        if let Some((key, value)) = line.split_once(':')
            && !key.starts_with([' ', '\t', '-'])
        {
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
            fields.push((key.trim().to_string(), value));
        }
    }
    None
}

/// What keeps a draft from being installed, in the user's words (empty: ready).
pub fn problems(name: &str, text: &str) -> Vec<String> {
    let mut found = Vec::new();
    if !valid_name(name) {
        found.push(format!("O nome \"{name}\" deve ter só letras minúsculas, números e hífens"));
    }
    let Some(fields) = frontmatter(text) else {
        found.push("Falta o cabeçalho (frontmatter) entre linhas ---".into());
        return found;
    };
    let field = |key: &str| fields.iter().find(|(name, _)| name == key).map(|(_, value)| value.as_str());
    match field("name") {
        Some(value) if value == name => {}
        Some(value) => found.push(format!("O cabeçalho diz name: {value}, mas o arquivo é {name}.md")),
        None => found.push("Falta o campo name no cabeçalho".into()),
    }
    if field("description").is_none_or(str::is_empty) {
        found.push("Falta a descrição (description) no cabeçalho".into());
    }
    let prompt = text.splitn(3, "---").nth(2).unwrap_or_default();
    if prompt.trim().is_empty() {
        found.push("Falta o prompt do agente depois do cabeçalho".into());
    }
    found
}

/// The user's Claude Code subagents folder.
pub fn user_agents_dir() -> Option<PathBuf> {
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|home| Path::new(&home).join(".claude")))?;
    Some(config.join("agents"))
}

pub fn draft_path(folder: &Folder, name: &str) -> PathBuf {
    folder.agents.join(format!("{name}.md"))
}

/// The drafts in Agentes, by name.
pub fn drafts(folder: &Folder) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(&folder.agents)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.strip_suffix(".md").map(str::to_string))
        .filter(|name| valid_name(name))
        .collect();
    names.sort();
    names
}

fn read_record(folder: &Folder) -> BTreeSet<String> {
    std::fs::read_to_string(folder.agents.join(RECORD)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

/// Copies the draft to the user's subagents; an agent of the same name that JARVIS did not
/// install is never replaced. Returns where it went.
pub fn install(folder: &Folder, name: &str) -> Result<PathBuf, String> {
    install_into(folder, name, &user_agents_dir().ok_or("Pasta do Claude Code não encontrada")?)
}

fn install_into(folder: &Folder, name: &str, agents: &Path) -> Result<PathBuf, String> {
    let text = std::fs::read_to_string(draft_path(folder, name)).map_err(|_| format!("Não achei Agentes\\{name}.md"))?;
    if let Some(problem) = problems(name, &text).into_iter().next() {
        return Err(problem);
    }
    let target = agents.join(format!("{name}.md"));
    let mut record = read_record(folder);
    if target.exists() && !record.contains(name) {
        return Err(format!("Você já tem um agente \"{name}\" no Claude Code: escolha outro nome"));
    }
    std::fs::create_dir_all(agents).map_err(|error| error.to_string())?;
    std::fs::write(&target, text).map_err(|error| format!("Falha ao instalar o agente: {error}"))?;
    record.insert(name.to_string());
    let _ = std::fs::write(folder.agents.join(RECORD), serde_json::to_string_pretty(&record).unwrap_or_default());
    Ok(target)
}

/// Whether the user's Claude Code has the subagent.
pub fn installed(name: &str) -> bool {
    valid_name(name) && user_agents_dir().is_some_and(|dir| dir.join(format!("{name}.md")).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "---\nname: revisor-pr\ndescription: \"Revisa pull requests\"\ntools: Read, Grep\nmodel: sonnet\n---\nVocê revisa PRs com cuidado.\n";

    #[test]
    fn names_follow_claude_code() {
        assert!(valid_name("revisor-pr") && valid_name("a1"));
        for bad in ["", "Revisor", "-x", "a b", "a_b", "../x", "ç"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn reads_the_frontmatter() {
        let fields = frontmatter(GOOD).unwrap();
        assert!(fields.contains(&("description".into(), "Revisa pull requests".into())));
        assert!(fields.contains(&("tools".into(), "Read, Grep".into())));
        assert_eq!(frontmatter("sem cabeçalho"), None);
        assert_eq!(frontmatter("---\nname: x\n"), None);
    }

    #[test]
    fn says_what_is_missing() {
        assert!(problems("revisor-pr", GOOD).is_empty());
        assert_eq!(problems("outro", GOOD).len(), 1);
        let bare = problems("x", "---\nname: x\n---\n");
        assert_eq!(bare.len(), 2, "{bare:?}");
        assert_eq!(problems("x", "só texto").len(), 1);
    }

    #[test]
    fn installs_but_never_replaces_an_agent_of_the_user() {
        let root = std::env::temp_dir().join(format!("jarvis-agents-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = Folder::new(root.join("JARVIS"));
        let agents = root.join("claude").join("agents");
        std::fs::create_dir_all(&folder.agents).unwrap();
        std::fs::write(draft_path(&folder, "revisor-pr"), GOOD).unwrap();

        let target = install_into(&folder, "revisor-pr", &agents).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), GOOD);
        // JARVIS's own: updated again.
        assert!(install_into(&folder, "revisor-pr", &agents).is_ok());

        std::fs::write(agents.join("meu.md"), "do usuário").unwrap();
        std::fs::write(draft_path(&folder, "meu"), GOOD.replace("revisor-pr", "meu")).unwrap();
        assert!(install_into(&folder, "meu", &agents).is_err());
        assert_eq!(std::fs::read_to_string(agents.join("meu.md")).unwrap(), "do usuário");
        assert!(install_into(&folder, "nenhum", &agents).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
