//! Verified downloads: streamed into a `.part` file that only takes its final name once its
//! SHA-256 (and size, when known) match, so a partial or corrupted file is never used.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// Downloads `url` into `target`, reporting `(received, total)` bytes; `total` is `size`, else the
/// server's Content-Length, else 0. Bodies larger than `limit` are refused.
pub fn fetch_verified(
    url: &str,
    target: &Path,
    sha256: &str,
    size: Option<u64>,
    limit: u64,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Não foi possível criar a pasta {}: {e}", dir.display()))?;
    }
    let partial = target.with_extension("part");

    let response = ureq::get(url).call().map_err(|e| format!("Falha no download: {e}"))?;
    let length = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let total = size.or(length).unwrap_or(0);
    let mut reader = response.into_body().into_with_config().limit(limit).reader();

    let result = (|| {
        let mut file = File::create(&partial).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut received = 0u64;
        let mut last_report = Instant::now();
        progress(0, total);
        loop {
            let read = reader.read(&mut buffer).map_err(|e| format!("Falha no download: {e}"))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            hasher.update(&buffer[..read]);
            received += read as u64;
            if last_report.elapsed() >= PROGRESS_INTERVAL {
                progress(received, total);
                last_report = Instant::now();
            }
        }
        file.sync_all().map_err(|e| e.to_string())?;
        progress(received, total.max(received));

        if size.is_some_and(|size| size != received) || hex(&hasher.finalize()) != sha256.to_ascii_lowercase() {
            return Err("Arquivo corrompido (verificação SHA-256 falhou)".to_string());
        }
        Ok(())
    })();

    match result {
        Ok(()) => fs::rename(&partial, target).map_err(|e| e.to_string()),
        Err(error) => {
            let _ = fs::remove_file(&partial);
            Err(error)
        }
    }
}

/// A small text file (checksum lists), at most `limit` bytes.
pub fn fetch_text(url: &str, limit: u64) -> Result<String, String> {
    let response = ureq::get(url).call().map_err(|e| format!("Falha no download: {e}"))?;
    response
        .into_body()
        .into_with_config()
        .limit(limit)
        .read_to_string()
        .map_err(|e| format!("Falha no download: {e}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(hex(&[0x00, 0x0f, 0xab]), "000fab");
    }
}
