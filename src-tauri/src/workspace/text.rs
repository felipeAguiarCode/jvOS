//! What a file's bytes say: its encoding and line endings, or that it is binary. The editor
//! always gets text with "\n"; saving puts back the file's own encoding and line endings.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Utf8bom,
    Utf16le,
    Utf16be,
    Windows1252,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

#[derive(Debug, PartialEq)]
pub enum Decoded {
    Text { text: String, encoding: Encoding, eol: Eol, mixed_eol: bool },
    Binary,
}

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
/// A NUL byte this early means binary (UTF-16 without a BOM included: it is not supported).
const SNIFF: usize = 8 * 1024;

/// Windows-1252's 0x80..0x9F. The five bytes it leaves undefined map to the C1 control of the same
/// value, so every byte comes back unchanged.
const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{81}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}',
    '\u{0152}', '\u{8D}', '\u{017D}', '\u{8F}', '\u{90}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{9D}', '\u{017E}', '\u{0178}',
];

pub const NOT_1252: &str = "Caractere fora do Windows-1252 — salve em UTF-8";

fn utf16(bytes: &[u8], little: bool) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| if little { u16::from_le_bytes([pair[0], pair[1]]) } else { u16::from_be_bytes([pair[0], pair[1]]) })
        .collect();
    String::from_utf16(&units).ok()
}

fn windows1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&byte| match byte {
            0x80..=0x9F => CP1252_HIGH[usize::from(byte - 0x80)],
            _ => char::from(byte),
        })
        .collect()
}

/// Mostly text: control characters (other than tab, line breaks, form feed and escape) are rare.
fn looks_like_text(bytes: &[u8]) -> bool {
    let controls = bytes.iter().filter(|&&byte| byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0C | 0x1B)).count();
    controls * 100 < bytes.len().max(1)
}

/// The text with "\n" only, the line ending most lines use, and whether they differ (a lone "\r"
/// counts as different: the editor turns it into a line break).
fn split_eol(text: String) -> (String, Eol, bool) {
    let bytes = text.as_bytes();
    let (mut crlf, mut lf, mut cr) = (0usize, 0usize, 0usize);
    for (index, &byte) in bytes.iter().enumerate() {
        match byte {
            b'\n' if index > 0 && bytes[index - 1] == b'\r' => crlf += 1,
            b'\n' => lf += 1,
            b'\r' if bytes.get(index + 1) != Some(&b'\n') => cr += 1,
            _ => {}
        }
    }
    let eol = if crlf > lf { Eol::Crlf } else { Eol::Lf };
    let mixed = (crlf > 0 && lf > 0) || cr > 0;
    let text = if crlf > 0 { text.replace("\r\n", "\n") } else { text };
    (text, eol, mixed)
}

pub fn decode(bytes: &[u8]) -> Decoded {
    let (text, encoding) = if let Some(rest) = bytes.strip_prefix(&UTF8_BOM) {
        match std::str::from_utf8(rest) {
            Ok(text) => (text.to_string(), Encoding::Utf8bom),
            Err(_) => return Decoded::Binary,
        }
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        match utf16(rest, true) {
            Some(text) => (text, Encoding::Utf16le),
            None => return Decoded::Binary,
        }
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        match utf16(rest, false) {
            Some(text) => (text, Encoding::Utf16be),
            None => return Decoded::Binary,
        }
    } else if bytes[..bytes.len().min(SNIFF)].contains(&0) {
        return Decoded::Binary;
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        (text.to_string(), Encoding::Utf8)
    } else if looks_like_text(bytes) {
        (windows1252(bytes), Encoding::Windows1252)
    } else {
        return Decoded::Binary;
    };
    // Text with NULs inside (after a BOM) is still not something to edit.
    if text.contains('\0') {
        return Decoded::Binary;
    }
    let (text, eol, mixed_eol) = split_eol(text);
    Decoded::Text { text, encoding, eol, mixed_eol }
}

fn to_1252(c: char) -> Option<u8> {
    match u32::from(c) {
        code @ (0..=0x7F | 0xA0..=0xFF) => u8::try_from(code).ok(),
        _ => CP1252_HIGH.iter().position(|&high| high == c).and_then(|index| u8::try_from(index + 0x80).ok()),
    }
}

/// The bytes to write for `text` (line breaks as "\n"), in `encoding` with `eol`.
pub fn encode(text: &str, encoding: Encoding, eol: Eol) -> Result<Vec<u8>, String> {
    let text = text.replace("\r\n", "\n");
    let text = match eol {
        Eol::Lf => text,
        Eol::Crlf => text.replace('\n', "\r\n"),
    };
    Ok(match encoding {
        Encoding::Utf8 => text.into_bytes(),
        Encoding::Utf8bom => UTF8_BOM.iter().copied().chain(text.into_bytes()).collect(),
        Encoding::Utf16le => [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(u16::to_le_bytes)).collect(),
        Encoding::Utf16be => [0xFE, 0xFF].into_iter().chain(text.encode_utf16().flat_map(u16::to_be_bytes)).collect(),
        Encoding::Windows1252 => text.chars().map(to_1252).collect::<Option<Vec<u8>>>().ok_or_else(|| NOT_1252.to_string())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: &[u8]) -> (String, Encoding, Eol, bool) {
        match decode(bytes) {
            Decoded::Text { text, encoding, eol, mixed_eol } => (text, encoding, eol, mixed_eol),
            Decoded::Binary => panic!("binary: {bytes:?}"),
        }
    }

    /// Decoding then encoding gives back the very same bytes.
    fn round_trips(bytes: &[u8]) {
        let (decoded, encoding, eol, _) = text(bytes);
        assert_eq!(encode(&decoded, encoding, eol).unwrap(), bytes, "{encoding:?} {eol:?}");
    }

    #[test]
    fn detects_encodings_and_round_trips_them() {
        assert_eq!(text(b"ola\nmundo\n"), ("ola\nmundo\n".into(), Encoding::Utf8, Eol::Lf, false));
        assert_eq!(text("olá\r\nção\r\n".as_bytes()), ("olá\nção\n".into(), Encoding::Utf8, Eol::Crlf, false));
        assert_eq!(text(b"\xEF\xBB\xBFbom"), ("bom".into(), Encoding::Utf8bom, Eol::Lf, false));
        assert_eq!(text(b"\xFF\xFEo\x00i\x00\r\x00\n\x00").1, Encoding::Utf16le);
        assert_eq!(text(b"\xFE\xFF\x00o\x00i").0, "oi");
        // Latin-1-ish bytes that are not UTF-8: Windows-1252, € and the quotes included.
        assert_eq!(text(b"caf\xe9 \x80 \x93x\x94"), ("café € “x”".into(), Encoding::Windows1252, Eol::Lf, false));
        for bytes in [
            b"ola\nmundo".as_slice(),
            "olá\r\nção\r\n".as_bytes(),
            b"\xEF\xBB\xBF# t\xC3\xADtulo\r\n",
            b"\xFF\xFEo\x00i\x00\r\x00\n\x00",
            b"\xFE\xFF\x00o\x00i\x00\n",
            b"caf\xe9\r\n\x80\x81\x8d\x8f\x90\x9d\xff",
            b"",
            "emoji 😀 e ção\n".as_bytes(),
        ] {
            round_trips(bytes);
        }
    }

    #[test]
    fn line_endings_take_the_majority_and_flag_mixtures() {
        assert_eq!(text(b"a\r\nb\r\nc\n"), ("a\nb\nc\n".into(), Encoding::Utf8, Eol::Crlf, true));
        assert_eq!(text(b"a\nb\nc\r\n"), ("a\nb\nc\n".into(), Encoding::Utf8, Eol::Lf, true));
        assert_eq!(text(b"a\rb").3, true, "a lone CR is a mixture");
        assert_eq!(text(b"no line break").2, Eol::Lf);
        // Saving a mixture writes one kind of line ending.
        assert_eq!(encode("a\nb\r\nc", Encoding::Utf8, Eol::Crlf).unwrap(), b"a\r\nb\r\nc");
    }

    #[test]
    fn binary_files_are_recognised() {
        assert_eq!(decode(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), Decoded::Binary);
        assert_eq!(decode(b"MZ\x90\x00\x03"), Decoded::Binary);
        assert_eq!(decode(&[0x01, 0x02, 0x03, 0x04, 0x05, 0xC3, 0x28, 0x10]), Decoded::Binary, "control bytes, not UTF-8");
        assert_eq!(decode(b"\xFF\xFEo"), Decoded::Binary, "odd UTF-16");
        assert_eq!(decode(b"\xFF\xFE\x00\xD8"), Decoded::Binary, "lone surrogate");
        assert_eq!(decode(b"\xEF\xBB\xBF\xC3\x28"), Decoded::Binary, "BOM but not UTF-8");
    }

    #[test]
    fn windows_1252_refuses_what_it_cannot_hold() {
        assert_eq!(encode("café €", Encoding::Windows1252, Eol::Lf).unwrap(), b"caf\xe9 \x80");
        assert_eq!(encode("日本", Encoding::Windows1252, Eol::Lf).unwrap_err(), NOT_1252);
        assert_eq!(serde_json::to_string(&Encoding::Windows1252).unwrap(), "\"windows1252\"");
        assert_eq!(serde_json::to_string(&Encoding::Utf8bom).unwrap(), "\"utf8bom\"");
        assert_eq!(serde_json::to_string(&Eol::Crlf).unwrap(), "\"crlf\"");
    }
}
