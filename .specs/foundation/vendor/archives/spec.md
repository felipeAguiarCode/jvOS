# Vendor: tar, bzip2 e sha2

Crates que extraem os pacotes `.tar.bz2` das vozes do JARVIS e conferem o SHA-256 de tudo o que o jvOS baixa (modelos do Whisper, Silero, vozes e `yt-dlp`).

| | |
|---|---|
| **ID** | `vendor/archives` |
| **Tipo** | Crate Rust |
| **Status** | Em uso |
| **Versão** | `tar` 0.4.46 (declarada `"0.4"`)<br>`bzip2` 0.6.1 (declarada `"0.6"`; backend padrão `libbz2-rs-sys` 0.2.5, em Rust puro)<br>`sha2` 0.10.9 (declarada `"0.10"`)<br>também no lock, só no build do `sherpa-onnx-sys`: `bzip2` 0.4.4 (`bzip2-sys` 0.1.13+1.0.8, em C) e `bzip2` 0.5.2 (via `zip` 2.6.1) |
| **Licença** | `tar`, `bzip2`, `sha2`: MIT OR Apache-2.0 |
| **Fonte** | https://github.com/composefs/tar-rs · https://github.com/trifectatechfoundation/bzip2-rs · https://github.com/RustCrypto/hashes |
| **Onde roda** | processo Rust (threads de download de `download_model`, `speech_download`, `music_install` e do Silero) |

## Objetivo

As vozes do sherpa-onnx são publicadas como `.tar.bz2` com uma pasta de arquivos (modelo, `tokens.txt`, `espeak-ng-data`), e o jvOS precisa extraí-las sem ferramenta externa. Todo download só vale depois de conferir o SHA-256 fixado no código, para que um arquivo parcial ou corrompido nunca seja usado ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md), [ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)). A escolha destes crates não está registrada: ⚠ inferido — confirmar.

## Não-objetivos

- Sem `.zip`, `.gz` ou `.7z` em tempo de execução: só `.tar.bz2`.
- Sem criar pacotes: o `tar::Builder` e o `BzEncoder` só aparecem no teste.
- Sem assinatura (GPG, minisign): a confiança vem do SHA-256 fixado no código ou do `SHA2-256SUMS` do release do `yt-dlp`.
- Sem o backend em C do `bzip2` em tempo de execução: as versões com `bzip2-sys` são só do build do `sherpa-onnx-sys`.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- speech::tests::extracts_an_archive_and_counts_it_once_ready` em `src-tauri`
- **Então** o teste passa: um `.tar.bz2` com `voz/tokens.txt` é extraído com o conteúdo igual, e o modelo só conta como baixado depois de existir `voz/.ready`.

### Critério 2 (RF-003)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- download::` em `src-tauri`
- **Então** passa `hex_is_lowercase_and_padded` (`[0x00, 0x0f, 0xab]` vira `000fab`).

### Critério 3 (RF-003)

- **Dado** um build local com o `sha256` de uma voz trocado em `MODELS` (`src-tauri/src/speech.rs`)
- **Quando** baixo essa voz nas Configurações
- **Então** `speech:done` traz "Arquivo corrompido (verificação SHA-256 falhou)", o `.part` é apagado e nenhuma pasta da voz ganha `.ready`.

### Critério 4 (RF-002)

- **Dado** a voz "Kokoro (neural)" ainda não baixada
- **Quando** baixo pelas Configurações
- **Então** `%LOCALAPPDATA%\dev.jarvis.os\tts\kokoro-int8-multi-lang-v1_0\.ready` existe, a pasta tem cerca de 189.881.734 bytes e não sobra nenhum `.tar.bz2` em `tts\`.

### Critério 5 (RNF-001)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -i libbz2-rs-sys` e `cargo tree -e normal,build -i bzip2@0.4.4` em `src-tauri`
- **Então** o `libbz2-rs-sys` aparece só sob `bzip2 v0.6.1` sob `jarvis`, e o `bzip2` 0.4.4 só sob `[build-dependencies]` do `sherpa-onnx-sys`.

## Casos de borda

- **Vazio/nulo:** um pacote sem a pasta esperada responde "O pacote da voz veio sem a pasta esperada" e não grava `.ready`. Um `.tar.bz2` que não se extrai responde "Falha ao extrair a voz: <erro>"; o pacote é apagado mesmo assim e o download precisa ser refeito. Sem `Content-Length`, o progresso usa o tamanho do catálogo.
- **Duplicidade/idempotência:** baixar de novo sobre uma extração pela metade sobrescreve os arquivos, e o `.ready` só vem no fim. Um `.part` antigo é truncado pelo download novo. O lock tem três versões do `bzip2` (0.6.1, 0.5.2 e 0.4.4), mas só a 0.6.1 entra no `jarvis.exe`.
- **Concorrência/corrida:** o conjunto `speech_downloading` impede duas extrações do mesmo modelo; modelos diferentes podem baixar e extrair em paralelo, cada um na sua pasta. O SHA-256 é calculado durante o download, no mesmo laço que grava, sem reler o arquivo.
- **Permissões/visibilidade:** o `tar::Archive::unpack` pula entradas com `..` e recusa gravar fora da pasta de destino ("trying to unpack outside of destination path"), então um pacote não escapa de `tts\`. O hash esperado é comparado em hex minúsculo. O pico de disco do Kokoro é o pacote mais a pasta extraída (~322 MB) antes de o pacote ser apagado.

## Uso no jvOS

### Extração das vozes com `tar` e `bzip2` (`src-tauri/src/speech.rs`)

Cada voz do [tts](../../../features/tts/spec.md) é um pacote do release `tts-models` do sherpa-onnx.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE extrair o `.tar.bz2` em fluxo (`BufReader` → `BzDecoder` → `tar::Archive::unpack`) na pasta `tts\`, apagar o pacote, conferir que a pasta com o nome do pacote sem `.tar.bz2` existe e só então gravar `.ready` nela.
    - Se a extração falhar, então responda "Falha ao extrair a voz: <erro>".
    - Se a pasta não existir, então responda "O pacote da voz veio sem a pasta esperada".
  - **RF-002**: Uma voz DEVE contar como baixada só com o `.ready` (`is_downloaded`).

### Verificação dos downloads com `sha2` (`src-tauri/src/download.rs`)

Usada por `models.rs` (3 modelos do Whisper e o Silero), `speech.rs` (5 pacotes de voz) e `music.rs` (`yt-dlp.exe`).

- **Comportamento:**
  - **RF-003**: `fetch_verified` DEVE calcular o SHA-256 (`Sha256`) de cada bloco no mesmo laço que grava o `.part`, comparar o hex minúsculo com o esperado e conferir o tamanho quando ele é conhecido. Só então o `.part` é renomeado para o nome final.
    - Se não conferir, então apague o `.part` e responda "Arquivo corrompido (verificação SHA-256 falhou)".
  - O hash do `yt-dlp.exe` não vem do código: o `music.rs` lê o `SHA2-256SUMS` do mesmo release antes de baixar ([yt-dlp](../yt-dlp/spec.md)).

## Restrições

- **RNF-001**: `tar` 0.4, `bzip2` 0.6 com o backend padrão em Rust puro (`libbz2-rs-sys`), `sha2` 0.10. O `bzip2-sys` em C fica só no build do `sherpa-onnx-sys`.
- **RNF-002**: Cada item do catálogo tem tamanho e SHA-256 fixos no código: 3 modelos do Whisper e o Silero (`models.rs`), 5 pacotes de voz (`speech.rs`).
- **RNF-003**: Pico de disco ao instalar uma voz: Kokoro 132.353.410 bytes de pacote + 189.881.734 extraídos; Piper Miro 21.341.456 + 37.318.881.
- **RNF-004**: Licença MIT OR Apache-2.0 nos três crates.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/speech.rs` | `download`, `extract`, `is_downloaded`, `READY`; teste `extracts_an_archive_and_counts_it_once_ready` |
| `src-tauri/src/download.rs` | `fetch_verified` (SHA-256 e tamanho), `hex` |
| `src-tauri/src/models.rs` | Tamanho e SHA-256 dos modelos do Whisper e do Silero |
| `src-tauri/src/music.rs` | Hash do `yt-dlp.exe` lido do `SHA2-256SUMS` |
| `src-tauri/Cargo.toml` | `tar = "0.4"`, `bzip2 = "0.6"`, `sha2 = "0.10"` |

### Testes

Rode de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados.

- `cargo test --lib -- speech::`: extração e marca `.ready` (com `tar::Builder` e `BzEncoder` no teste), catálogo com hashes de 64 caracteres.
- `cargo test --lib -- download:: models::`: hex do SHA-256, catálogo dos modelos e arquivo parcial que não conta como baixado.
- `cargo test --lib -- music::tests::finds_the_checksum_of_a_file`: o hash certo no `SHA2-256SUMS`.
- Critérios 3 e 4 à mão, no app.

### Atualização e reversão

- **Comando:** em `src-tauri`, `cargo update -p tar --precise 0.4.<n>`, `cargo update -p bzip2@0.6.1 --precise 0.6.<n>` e `cargo update -p sha2 --precise 0.10.<n>`.
- **Prova:** critérios 1, 2 e 5 e o download de uma voz Piper pelas Configurações, que precisa terminar com `.ready`.
- **Sinal de volta:** "Falha ao extrair a voz" num pacote que extraía, "Arquivo corrompido" em downloads íntegros, ou o `bzip2-sys` em C entrando no `jarvis.exe`.
- **Reversão:** volte `src-tauri/Cargo.lock` e recompile. Confira o critério 5.

### Decisões relacionadas

- [ADR-0005 — Voz do JARVIS local com sherpa-onnx fixado em 1.13.8](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)
- [ADR-0021 — Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)

## Dependências

- Vendor: [http](../http/spec.md) (o `ureq` que traz os bytes), [sherpa-onnx](../sherpa-onnx/spec.md) (quem usa as vozes e quem traz o `bzip2` 0.4 e 0.5 para o lock), [piper-voices](../piper-voices/spec.md), [kokoro](../kokoro/spec.md), [whisper-models](../whisper-models/spec.md), [silero-vad](../silero-vad/spec.md) e [yt-dlp](../yt-dlp/spec.md) (o que é conferido).
- Specs: [tts](../../../features/tts/spec.md), [voice-engine](../../../features/voice-engine/spec.md), [jv_t4p3](../../../apps/jv_t4p3/spec.md), [persistência](../../../domain/persistence.md) (`%LOCALAPPDATA%\dev.jarvis.os\tts` e `models`), [security](../../../arch/security.md).
- Sistema: espaço em disco em `%LOCALAPPDATA%` (até ~322 MB durante a instalação do Kokoro).

## Pendências

- Nenhuma por enquanto.
