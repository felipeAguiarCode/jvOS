# Vendor: sherpa-onnx

Runtime ONNX do k2-fsa que dá a voz do JARVIS (Piper e Kokoro, offline) e roda o Silero VAD, o porteiro que decide se um trecho de áudio tem fala antes de ele ir ao Whisper.

| | |
|---|---|
| **ID** | `vendor/sherpa-onnx` |
| **Tipo** | Crate Rust (com DLLs nativas pré-compiladas) |
| **Status** | Em uso |
| **Versão** | `sherpa-onnx` 1.13.8 (declarada `=1.13.8`, `default-features = false`, `features = ["shared"]`)<br>`sherpa-onnx-sys` 1.13.8 (transitiva)<br>libs pré-compiladas `sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib.tar.bz2` (8.032.957 bytes, cache em `t/sherpa-onnx-prebuilt/`)<br>DLLs: `sherpa-onnx-c-api.dll` (4.605.952 B), `sherpa-onnx-cxx-api.dll` (259.584 B), `onnxruntime.dll` 1.28.2 (17.799.168 B), `onnxruntime_providers_shared.dll` (104.960 B) |
| **Licença** | `sherpa-onnx` e `sherpa-onnx-sys`: Apache-2.0 · ONNX Runtime: MIT ⚠ inferido — confirmar (o pacote pré-compilado não traz o arquivo de licença) |
| **Fonte** | https://github.com/k2-fsa/sherpa-onnx · libs: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib.tar.bz2` (baixadas pelo build do `sherpa-onnx-sys`) |
| **Onde roda** | processo Rust (comando `speech_synthesize` e thread `jarvis-voice`) · build (download das DLLs) |

## Objetivo

O JARVIS precisa falar português do Brasil com voz neural, sem nuvem e sem chave. O sherpa-onnx roda Piper e Kokoro em processo, e a versão 1.13.8 é a última que ainda fonetiza o português pelo `espeak-ng-data` de cada modelo ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)). O mesmo runtime, já linkado, traz o Silero VAD, que tira do Whisper o ruído que a VAD de energia deixava passar ([ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).

## Não-objetivos

- Sem a 2.x: ela removeu o espeak-ng, e o português ficaria sem fonetizador.
- Sem a feature `static` (padrão do crate): ela baixa um arquivo de ~122 MB.
- Sem reconhecimento de fala nem detector de palavra de ativação (KWS) do sherpa: o reconhecimento é do [whisper-rs](../whisper-rs/spec.md), e os modelos de KWS prontos são em inglês ou chinês.
- Sem GPU: tudo roda com `provider` CPU.
- Os arquivos de modelo não são deste item: ver [piper-voices](../piper-voices/spec.md), [kokoro](../kokoro/spec.md) e [silero-vad](../silero-vad/spec.md).

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `src-tauri/Cargo.toml` e o `src-tauri/Cargo.lock` atuais
- **Quando** rodo `cargo tree -e features -i sherpa-onnx` em `src-tauri`
- **Então** aparece `sherpa-onnx v1.13.8` com a feature `shared` e sem a `static`, e o `Cargo.toml` declara `version = "=1.13.8"`.

### Critério 2 (RF-007)

- **Dado** um build de dev concluído (`npm run dev` ou `cargo build`)
- **Quando** listo `t\debug\*.dll`
- **Então** estão lá `sherpa-onnx-c-api.dll` (4.605.952 B), `sherpa-onnx-cxx-api.dll` (259.584 B), `onnxruntime.dll` (17.799.168 B, versão 1.28.2) e `onnxruntime_providers_shared.dll` (104.960 B).

### Critério 3 (RF-008)

- **Dado** `t\debug\deps` sem as DLLs do sherpa
- **Quando** rodo `cargo test --lib -- --ignored speech_gate`
- **Então** o binário de teste carrega o `onnxruntime.dll` 1.17 de `System32` e quebra ("API version 28 not available", ACCESS_VIOLATION). Depois de copiar `sherpa-onnx-c-api.dll`, `onnxruntime.dll` e `onnxruntime_providers_shared.dll` de `t\debug` para `t\debug\deps`, o mesmo comando passa.

### Critério 4 (RF-005)

- **Dado** as DLLs em `t\debug\deps`
- **Quando** rodo `cargo test --lib -- --ignored speech_gate` (baixa o `silero_vad.onnx` na primeira vez)
- **Então** passa `speech_gate_tells_speech_from_noise`: `wake_only`, `wake_command` e `terminal` têm 0,25 s de fala ou mais; ruído branco, um zumbido de 120 Hz e 2 s de silêncio ficam abaixo de 0,25 s.

### Critério 5 (RF-004)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- speech::` em `src-tauri`
- **Então** passam `writes_a_playable_wav` (44 + 8 bytes, taxa de 24.000 Hz, amostras cortadas em ±`i16::MAX`), `catalog_is_consistent` (`VOICES[0]` é `miro`, ids do Kokoro entre 0 e 53) e `extracts_an_archive_and_counts_it_once_ready`.

### Critério 6 (RF-001)

- **Dado** a voz "Miro" escolhida e o modelo `piper-miro` sem a marca `.ready`
- **Quando** a UI chama `speech_synthesize`
- **Então** o comando devolve o erro `voice-missing`; com o modelo baixado e o texto vazio, devolve "Nada para falar".

### Critério 7 (RNF-005)

- **Dado** as vozes em `%LOCALAPPDATA%\dev.jarvis.os\tts` e as DLLs em `t\debug\deps`
- **Quando** rodo `JARVIS_TTS_DIR=<tts> JARVIS_TTS_OUT=<pasta> cargo test --lib -- --ignored speech_samples --nocapture`
- **Então** cada linha impressa traz o RTF: cerca de 0,25–0,3 nas vozes Piper e 1,1–1,2 no Kokoro, neste Core 7 150U.

## Casos de borda

- **Vazio/nulo:** o primeiro build sem rede falha no `sherpa-onnx-sys` ("Failed to download sherpa-onnx archive from …"). Com o arquivo já em `t/sherpa-onnx-prebuilt/`, ou com `SHERPA_ONNX_ARCHIVE_DIR` ou `SHERPA_ONNX_LIB_DIR` apontando para uma cópia, o build sai offline. Sem o modelo da voz, a síntese responde `voice-missing`. Sem o `silero_vad.onnx`, ou offline, o porteiro deixa tudo passar e a VAD de energia decide sozinha.
- **Duplicidade/idempotência:** com a pasta `lib` já extraída em `t/sherpa-onnx-prebuilt/`, o build não baixa de novo; as DLLs são recopiadas a cada execução do build script. Mover a pasta de build deixa saídas de build script com caminhos antigos (`t/<perfil>/build/*/output`) e dá `LNK1181` em `sherpa-onnx-c-api.lib`: apague essas pastas e as gêmeas em `.fingerprint`. Um segundo `speech_download` do mesmo modelo volta `Ok` sem outra thread. O Silero baixa uma vez por execução (`DOWNLOADING`).
- **Concorrência/corrida:** o `Speaker` guarda o modelo num `Mutex`, então duas sínteses ao mesmo tempo rodam uma depois da outra. O detector do Silero vive só na thread de voz. O download do Silero roda em outra thread (`jarvis-silero-download`), e o porteiro olha a pasta de novo a cada 10 s; o arquivo só conta como baixado com o tamanho exato, nunca o `.part`.
- **Permissões/visibilidade:** o Windows 11 traz um `onnxruntime.dll` 1.17 em `System32` (1.17.260914 nesta máquina). Um binário sem as DLLs do sherpa ao lado carrega essa versão e quebra. A pasta do executável é buscada primeiro, por isso as DLLs ficam ao lado de todo binário que as carrega: app, testes e instalador.

## Uso no jvOS

### Síntese de voz (`src-tauri/src/speech.rs`)

`Speaker` transforma uma frase em WAV com a voz escolhida ([tts](../../../features/tts/spec.md)).

- **Comportamento:**
  - **RF-001**: O jvOS DEVE manter um modelo carregado por vez (`Mutex<Option<(id, OfflineTts)>>`). Trocar para uma voz de outro modelo descarta o anterior antes de criar o novo.
    - Se o modelo não tiver a marca `.ready`, então responda `voice-missing`.
    - Se o texto vier vazio, então responda "Nada para falar".
    - Se `OfflineTts::create` falhar, então responda "Não consegui carregar a voz"; se a geração falhar, "A voz falhou".
  - **RF-002**: O jvOS DEVE criar o `OfflineTts` com metade das threads da máquina, limitada a 1–4, `max_num_sentences: 1` e `silence_scale: 0,2`. A velocidade pedida é limitada a 0,5–2,0.
  - **RF-003**: Cada modelo DEVE usar o `espeak-ng-data` da própria pasta como `data_dir`.
    - Piper (VITS): o `.onnx` da voz e `tokens.txt`, com `noise_scale` 0,667, `noise_scale_w` 0,8 e `length_scale` 1,0.
    - Kokoro: `model.int8.onnx`, `voices.bin` e `tokens.txt`, com `lang` `pt-br` e o `sid` de cada voz (Alex 43, Santa 44, Dora 42, George 26).
  - **RF-004**: A saída DEVE virar um WAV PCM de 16 bits mono na taxa do modelo (`wav()`), devolvido como bytes crus pelo `speech_synthesize`.
  - Enquanto o JARVIS fala, a UI mantém `voice_deafen(true)`, para a escuta não tomar a fala dele por comando.

### Porteiro Silero (`src-tauri/src/voice/silero.rs`)

`SpeechGate` decide se a frase cortada pela VAD de energia vai ao Whisper ([voice-engine](../../../features/voice-engine/spec.md)).

- **Comportamento:**
  - **RF-005**: O jvOS DEVE criar o `VoiceActivityDetector` com limiar 0,5, fala e silêncio mínimos de 0,25 s, janela de 512 amostras, buffer de 30 s, 16 kHz, 1 thread e `provider` `cpu`.
  - **RF-006**: Só nos modos "Hey Jarvis" e "Sempre ouvindo", e só sobre as frases candidatas, o porteiro DEVE zerar o detector, passar o áudio, fechar (`flush`) e somar os segmentos. A frase passa com 0,25 s de fala ou mais.
    - Se o modelo faltar, então o porteiro dispara um download em segundo plano (um por execução), olha a pasta de novo a cada 10 s e, enquanto isso, deixa tudo passar.
    - Se o modelo não carregar, então o stderr mostra "[jarvis] Silero VAD: could not load <caminho>" e tudo passa.
  - O push-to-talk, o ditado e as perguntas não passam pelo porteiro.

### DLLs e build (`src-tauri/Cargo.toml`, build script do `sherpa-onnx-sys`)

De onde vêm as bibliotecas nativas.

- **Comportamento:**
  - **RF-007**: O build DEVE baixar uma vez o pacote `shared` da versão 1.13.8 para `t/sherpa-onnx-prebuilt/`, extraí-lo e copiar as 4 DLLs para `t/<perfil>/` e `t/<perfil>/examples/`.
  - **RF-008**: Todo binário que carrega o sherpa DEVE ter `sherpa-onnx-c-api.dll`, `onnxruntime.dll` e `onnxruntime_providers_shared.dll` na mesma pasta. O build cuida de `t/debug` e `t/release`; os binários de teste rodam de `t/debug/deps` e precisam de cópia manual.

## Restrições

- **RNF-001**: Versão travada em `=1.13.8`. Não subir para a 2.x sem um fonetizador de português.
- **RNF-002**: Feature `shared`, não `static`: 8,0 MB baixados no build contra ~122 MB.
- **RNF-003**: ~22,8 MB de DLLs ao lado de cada binário que carrega o sherpa.
- **RNF-004**: Offline em tempo de execução: os modelos são baixados uma vez, e a síntese e o porteiro não usam rede.
- **RNF-005**: Velocidade neste Core 7 150U: Piper com RTF ≈ 0,25–0,3; Kokoro int8 com RTF ≈ 1,1–1,2, pior com mais threads (núcleos E). O Silero leva ~5 ms por segundo de áudio numa thread (comentário em `silero.rs`).
- **RNF-006**: Licença Apache-2.0.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/speech.rs` | Catálogo de modelos e vozes, download e extração, `Speaker`, `config`, `wav` |
| `src-tauri/src/voice/silero.rs` | `SpeechGate`, `load`, `speech_seconds`, teste `speech_gate_tells_speech_from_noise` |
| `src-tauri/src/voice/mod.rs` | Cria o `SpeechGate` ao lado dos modelos do Whisper e o chama nos modos de escuta |
| `src-tauri/src/models.rs` | `SILERO` (arquivo, tamanho, SHA-256 e origem) |
| `src-tauri/src/lib.rs` | `speech_status`, `speech_download`, `speech_synthesize`, `voice_deafen` |
| `src/lib/speech.ts` | Adaptador da UI (`tauriBackend`) e o fake `__JARVIS_SPEECH__` |
| `src-tauri/Cargo.toml` | `sherpa-onnx = { version = "=1.13.8", default-features = false, features = ["shared"] }` |

### Testes

Rode de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados.

- `cargo test --lib -- speech::`: catálogo, WAV e extração (não carrega as DLLs).
- `copy t\debug\sherpa-onnx-c-api.dll t\debug\deps\`, o mesmo para `onnxruntime.dll` e `onnxruntime_providers_shared.dll`, e então `cargo test --lib -- --ignored speech_gate`: o Silero de verdade.
- `JARVIS_TTS_DIR=<tts> JARVIS_TTS_OUT=<pasta> [JARVIS_WHISPER=<ggml>] cargo test --lib -- --ignored speech_samples --nocapture`: todas as vozes falando três linhas do JARVIS, com RTF, tom e o que o Whisper ouve.
- `npx playwright test tests/speech.spec.ts`: a UI da voz com o fake `__JARVIS_SPEECH__` (não carrega o sherpa).

### Atualização e reversão

- **Comando:** só dentro da 1.x. Troque `=1.13.8` por `=1.13.<n>` no `Cargo.toml` e rode `cargo update -p sherpa-onnx --precise 1.13.<n>` em `src-tauri`. O build baixa o pacote da nova versão; copie as DLLs novas para `t\debug\deps`.
- **Prova:** critérios 1 a 5 e 7; `speech_samples` com o Whisper (`JARVIS_WHISPER`) entendendo as frases de cada voz; o app falando "Às suas ordens…" com a voz Miro.
- **Sinal de volta:** português lido como inglês ou embolado (sem espeak-ng), erro "API version … not available", RTF pior que o da RNF-005, ou o Silero reprovando as fixtures.
- **Reversão:** volte `=1.13.8` no `Cargo.toml` e o `Cargo.lock`, apague as DLLs da versão nova de `t\debug`, `t\release` e `t\debug\deps` e recompile. O pacote da 1.13.8 continua em `t/sherpa-onnx-prebuilt/`.

### Decisões relacionadas

- [ADR-0005 — Voz do JARVIS local com sherpa-onnx fixado em 1.13.8](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)
- [ADR-0021 — Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)

## Dependências

- Vendor: [piper-voices](../piper-voices/spec.md) e [kokoro](../kokoro/spec.md) (os modelos de voz), [silero-vad](../silero-vad/spec.md) (o modelo do porteiro), [archives](../archives/spec.md) (extração `.tar.bz2` e SHA-256), [http](../http/spec.md) (download dos modelos), [whisper-rs](../whisper-rs/spec.md) (quem recebe o que passa pelo porteiro), [tauri](../tauri/spec.md) (WAV como `ipc::Response`).
- Specs: [tts](../../../features/tts/spec.md), [voice-engine](../../../features/voice-engine/spec.md), [settings](../../../features/settings/spec.md), [build-and-env](../../../arch/build-and-env.md#dependências-nativas-fixadas).
- Sistema: rede no primeiro build (GitHub releases), CPU x64, Windows 11 com o `onnxruntime.dll` de `System32` que precisa ser evitado.

## Pendências

- [ ] Nada copia as DLLs para `t/debug/deps`: os testes `speech_gate` e `speech_samples` dependem de cópia manual (comentário em `src-tauri/src/voice/silero.rs`).
- [ ] O instalador (`npm run tauri build`) ainda não foi verificado com as DLLs ao lado do `jarvis.exe`, e o `bundle` de `src-tauri/tauri.conf.json` não declara `resources`. Ver [tts](../../../features/tts/spec.md#known-limitations) e [build-and-env](../../../arch/build-and-env.md#pendências).
- [ ] O build script do `sherpa-onnx-sys` baixa as libs sem conferir hash. O jvOS não fixa o SHA-256 do pacote `sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib.tar.bz2`.
