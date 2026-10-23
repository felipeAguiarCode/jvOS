//! Text files for the desktop editors: absolute paths only, UTF-8, size-limited.

use std::fs;
use std::io;
use std::path::Path;

const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn describe(action: &str, error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "Arquivo não encontrado".into(),
        io::ErrorKind::PermissionDenied => "Sem permissão para acessar o arquivo".into(),
        _ => format!("{action}: {error}"),
    }
}

pub fn read(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("Caminho inválido".into());
    }
    let size = fs::metadata(path).map_err(|e| describe("Falha ao abrir", e))?.len();
    if size > MAX_BYTES {
        return Err("Arquivo grande demais (máx. 2 MB)".into());
    }
    let bytes = fs::read(path).map_err(|e| describe("Falha ao abrir", e))?;
    String::from_utf8(bytes).map_err(|_| "O arquivo não é texto UTF-8".into())
}

/// Writes atomically (temp file + rename), like the settings.
pub fn write(path: &Path, contents: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Caminho inválido".into());
    }
    let mut temp_name = path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    temp_name.push(".tmp");
    let temp = path.with_file_name(temp_name);
    fs::write(&temp, contents).map_err(|e| describe("Falha ao salvar", e))?;
    fs::rename(&temp, path).map_err(|e| describe("Falha ao salvar", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jarvis-files-test-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trip() {
        let dir = temp_dir("round-trip");
        let path = dir.join("notas.md");
        write(&path, "# Olá\n\n- item ção\n").unwrap();
        assert_eq!(read(&path).unwrap(), "# Olá\n\n- item ção\n");
        // Overwrites in place.
        write(&path, "novo").unwrap();
        assert_eq!(read(&path).unwrap(), "novo");
        assert!(!dir.join("notas.md.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_relative_path() {
        assert_eq!(read(Path::new("notas.md")).unwrap_err(), "Caminho inválido");
        assert_eq!(write(Path::new("notas.md"), "x").unwrap_err(), "Caminho inválido");
    }

    #[test]
    fn rejects_large_file() {
        let dir = temp_dir("large");
        let path = dir.join("big.txt");
        fs::write(&path, vec![b'a'; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(read(&path).unwrap_err(), "Arquivo grande demais (máx. 2 MB)");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_non_utf8_and_missing_files() {
        let dir = temp_dir("utf8");
        let path = dir.join("bin.dat");
        fs::write(&path, [0xff, 0xfe, 0x00, 0x41]).unwrap();
        assert_eq!(read(&path).unwrap_err(), "O arquivo não é texto UTF-8");
        assert_eq!(read(&dir.join("nada.txt")).unwrap_err(), "Arquivo não encontrado");
        fs::remove_dir_all(dir).unwrap();
    }
}
