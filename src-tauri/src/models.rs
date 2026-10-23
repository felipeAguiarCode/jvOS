//! Whisper model catalog and verified downloads (ggml files from the whisper.cpp repository).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::download;

pub struct ModelInfo {
    pub id: &'static str,
    pub file: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// Quantised multilingual models: Large V3 Turbo (the default, sized to fit a 2 GB GPU) for
/// accuracy, and Base as a lightweight fallback for machines without a usable GPU.
pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "large-v3-turbo",
        file: "ggml-large-v3-turbo-q5_0.bin",
        label: "Large V3 Turbo",
        description: "Mais preciso, recomendado",
        size: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
    ModelInfo {
        id: "base",
        file: "ggml-base-q5_1.bin",
        label: "Base",
        description: "Leve e rápido, para CPUs mais fracas",
        size: 59_707_625,
        sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    },
];

const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

pub fn find(id: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|model| model.id == id)
}

pub fn path(dir: &Path, model: &ModelInfo) -> PathBuf {
    dir.join(model.file)
}

/// A complete file of the expected size (the hash was verified when it was downloaded).
pub fn is_downloaded(dir: &Path, model: &ModelInfo) -> bool {
    fs::metadata(path(dir, model)).is_ok_and(|meta| meta.len() == model.size)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub size: u64,
    pub downloaded: bool,
    pub downloading: bool,
}

/// Downloads `model` into `dir`, reporting `(received, total)` bytes. The file only takes its
/// final name after its SHA-256 matches, so a partial or corrupted download is never used.
pub fn download(model: &ModelInfo, dir: &Path, progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let target = path(dir, model);
    download::fetch_verified(&format!("{BASE_URL}/{}", model.file), &target, model.sha256, Some(model.size), model.size + 1, progress)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_consistent() {
        for model in MODELS {
            assert_eq!(model.sha256.len(), 64);
            assert!(model.file.ends_with(".bin"));
            assert!(find(model.id).is_some());
        }
        assert!(find("missing").is_none());
    }

    #[test]
    fn partial_files_do_not_count_as_downloaded() {
        let dir = std::env::temp_dir().join(format!("jarvis-models-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let model = &MODELS[0];
        fs::write(path(&dir, model), b"truncated").unwrap();
        assert!(!is_downloaded(&dir, model));
        fs::remove_dir_all(dir).unwrap();
    }
}
