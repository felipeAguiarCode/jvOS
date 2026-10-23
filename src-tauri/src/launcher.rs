//! Launches the programs configured in the settings.

use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn is_url(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// First token of a command line, honouring double quotes: `"C:\a b\x.exe" --flag` → `C:\a b\x.exe`.
fn program_of(command_line: &str) -> &str {
    let line = command_line.trim_start();
    match line.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or(rest),
        None => line.split_whitespace().next().unwrap_or(line),
    }
}

/// Explicit paths must exist; bare names (`wt`, `code`) are resolved by Windows at launch.
fn check_program(command_line: &str) -> Result<(), String> {
    let program = program_of(command_line);
    // `/B`-style switches start with a slash but are not paths.
    let looks_like_path = program.contains('\\') || program.contains(':') || program.starts_with('.');
    if looks_like_path && !is_url(program) && !Path::new(program).exists() {
        return Err(format!("Programa não encontrado: {program}"));
    }
    Ok(())
}

/// Builds the arguments for `cmd /C start "" <command line>`. `start` resolves programs like the
/// Run dialog (PATH, PATHEXT, App Paths) and opens URLs in the default browser.
fn start_arguments(command_line: &str) -> Result<String, String> {
    let command_line = command_line.trim();
    if command_line.is_empty() {
        return Err("Nenhum comando configurado".into());
    }
    check_program(command_line)?;
    // Unquoted URLs may contain `&`, which cmd would treat as a command separator.
    let target = if is_url(command_line) && !command_line.contains('"') {
        format!("\"{command_line}\"")
    } else {
        command_line.to_string()
    };
    Ok(format!("/D /C start \"\" {target}"))
}

/// Starts `command_line` detached from the app, without a console window of its own.
pub fn launch(command_line: &str) -> Result<(), String> {
    let arguments = start_arguments(command_line)?;
    let mut command = Command::new("cmd");
    #[cfg(windows)]
    command.raw_arg(arguments).creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    command.arg(arguments);
    command.spawn().map(|_| ()).map_err(|error| format!("Falha ao abrir: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_program() {
        assert_eq!(program_of("wt claude"), "wt");
        assert_eq!(program_of(r#""C:\Program Files\App\app.exe" --x"#), r"C:\Program Files\App\app.exe");
        assert_eq!(program_of("  code  "), "code");
    }

    #[test]
    fn builds_start_arguments() {
        assert_eq!(start_arguments("wt claude").unwrap(), r#"/D /C start "" wt claude"#);
        assert_eq!(start_arguments("https://a.com/?x=1&y=2").unwrap(), r#"/D /C start "" "https://a.com/?x=1&y=2""#);
        assert!(start_arguments("   ").is_err());
        assert!(start_arguments(r#""C:\definitely\missing\app.exe""#).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn launches_a_real_command() {
        // `/B` keeps the launched cmd in the hidden console: no window flashes during tests.
        let marker = std::env::temp_dir().join(format!("jarvis-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir(&marker);
        launch(&format!("/B cmd /C mkdir {}", marker.display())).unwrap();
        for _ in 0..50 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(marker.exists(), "launched command did not run");
        std::fs::remove_dir(marker).unwrap();
    }
}
