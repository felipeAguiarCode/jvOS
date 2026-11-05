# Vendor: whisper-rs (whisper.cpp)

Bindings Rust do whisper.cpp que transcrevem, dentro do `jarvis.exe` e sem rede, cada frase dita ao jvOS, na CPU ou numa GPU pelo backend Vulkan.

| | |
|---|---|
| **ID** | `vendor/whisper-rs` |
| **Tipo** | Crate Rust (com biblioteca C++ nativa compilada no build) |
| **Status** | Em uso |
| **Versão** | `whisper-rs` 0.16.0 (declarada `"0.16"`)<br>`whisper-rs-sys` 0.15.0 (transitiva)<br>whisper.cpp 1.8.3 (código-fonte dentro do `whisper-rs-sys`)<br>feature do jvOS `vulkan = ["whisper-rs/vulkan"]`, fora do padrão<br>Vulkan SDK 1.4.363.0 (só no build, em `C:\VulkanSDK`) |
| **Licença** | `whisper-rs` e `whisper-rs-sys`: Unlicense · whisper.cpp e ggml: MIT (`whisper.cpp/LICENSE` dentro do `whisper-rs-sys`) |
| **Fonte** | https://codeberg.org/tazz4843/whisper-rs · https://github.com/ggerganov/whisper.cpp |
| **Onde roda** | processo Rust (thread `jarvis-voice`) · build (CMake, bindgen, Vulkan SDK) |

## Objetivo

O jvOS precisa reconhecer comandos em português sem internet e sem chave de API. O whisper.cpp roda em processo via `whisper-rs` ([ADR-0002](../../../arch/adr/0002-stt-whisper-offline-cpu.md)). Com a feature `vulkan`, o mesmo modelo roda na GPU integrada, que leva 0,74 a 1,4 s por comando contra 2,6 a 8,9 s na CPU e deixa a CPU livre, com volta automática para a CPU ([ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).

## Não-objetivos

- Sem CUDA, Metal, HIP, OpenMP ou CoreML: a única aceleração é a feature `vulkan`.
- Sem streaming nem timestamps: cada frase cortada pela VAD é transcrita inteira, num segmento só.
- Sem tradução (`set_translate(false)`) e sem contexto entre frases (`set_no_context(true)`).
- Os arquivos de modelo (`ggml-*.bin`) não são deste item: ver [whisper-models](../whisper-models/spec.md).
- O porteiro de fala que decide o que chega ao Whisper é do [sherpa-onnx](../sherpa-onnx/spec.md) e do [silero-vad](../silero-vad/spec.md).

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -i whisper-rs-sys` em `src-tauri`
- **Então** aparece `whisper-rs-sys v0.15.0` sob `whisper-rs v0.16.0` sob `jarvis`, e `cargo tree --features vulkan -e features -i whisper-rs-sys` mostra a feature `vulkan` do `whisper-rs-sys`, que some sem o `--features vulkan`.

### Critério 2 (RF-009)

- **Dado** o Vulkan SDK em `C:\VulkanSDK\1.4.363.0` e nenhum `--features` na linha de comando
- **Quando** rodo `npm run dev`
- **Então** o console mostra "[jarvis] Vulkan SDK at C:\VulkanSDK\1.4.363.0: speech recognition can run on the GPU." e o Tauri recebe `--features vulkan`. Sem o SDK, aparece "[jarvis] Vulkan SDK not found (winget install KhronosGroup.VulkanSDK): speech recognition runs on the CPU." e o build sai só com CPU.

### Critério 3 (RF-006)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- voice::transcriber` em `src-tauri`
- **Então** passam `auto_prefers_the_integrated_gpu_and_names_win` (o `auto` escolhe a Intel em qualquer ordem, um nome sumido vira `auto`, `cpu` nunca usa GPU) e `detects_prompt_echo`.

### Critério 4 (RF-008)

- **Dado** um build sem a feature `vulkan`
- **Quando** abro Configurações › "Processamento da voz"
- **Então** só aparecem "Automático" e "Processador", a dica diz "Este build não tem a GPU (Vulkan SDK ausente na compilação): a voz roda no processador." e `voice_devices` devolve `accelerated: false` e `gpus: []`.

### Critério 5 (RF-007)

- **Dado** um build com `vulkan` e uma GPU escolhida que falha ao carregar o modelo
- **Quando** a escuta é ligada
- **Então** o stderr mostra "[jarvis] Whisper on <nome>: <erro>; using the CPU", o motor funciona e a dica das Configurações diz "Agora: processador.".

### Critério 6 (RNF-002)

- **Dado** um build com `vulkan` nesta máquina (Core 7 150U, Intel Graphics, NVIDIA MX570)
- **Quando** rodo `JARVIS_TEST_DEVICE=auto JARVIS_TEST_MODEL=small cargo test --lib --features vulkan -- --ignored speech --nocapture`
- **Então** o teste imprime `loaded in <ms> ms on Intel(R) Graphics` e, por frase, `<ms> ms for <s> s of audio`, com 740 a 1.400 ms por frase (2,6 s no pior caso, com o clock baixo) e o mesmo texto da CPU.

### Critério 7 (RNF-004)

- **Dado** o repositório em `C:\www\side-projects\jarvis` (26 caracteres) e o `.cargo/config.toml` com `target-dir = "t"`
- **Quando** rodo `npm run tauri build -- --no-bundle` com o Vulkan SDK
- **Então** o build termina sem `MSB3491`, `MSB4018` ou `C1083`, usando o Ninja, e `t/release/jarvis.exe` tem cerca de 64,3 MB (12,8 MB sem Vulkan).

## Casos de borda

- **Vazio/nulo:** sem CMake, o `scripts/tauri.mjs` avisa "[jarvis] CMake not found: install it or add the 'C++ CMake tools' component of Visual Studio." e o build do `whisper-rs-sys` falha. Sem libclang, avisa "[jarvis] libclang not found: install LLVM (winget install LLVM.LLVM) or set LIBCLANG_PATH.". Sem Vulkan SDK, o build sai só com CPU. Áudio com menos de 1,1 s é completado com silêncio, porque o whisper.cpp ignora entradas de menos de 1 s. Sem modelo baixado, a escuta responde `model-missing` ([whisper-models](../whisper-models/spec.md)).
- **Duplicidade/idempotência:** um `--features` passado à mão é respeitado, sem `vulkan` em dobro. Uma GPU salva por nome em outra máquina vale como `auto`. O aquecimento na GPU roda uma vez por carga do modelo. Um texto que só repete o prompt (3 palavras ou mais contidas nele) é descartado.
- **Concorrência/corrida:** a inicialização do backend Vulkan do ggml não tem trava. Listar as GPUs (`voice_devices`, das Configurações) e carregar o modelo (thread de voz) passam pelo `Mutex` `VULKAN` de `transcriber.rs`. O `WhisperState` vive só na thread `jarvis-voice`.
- **Permissões/visibilidade:** um binário com `vulkan` linka o `vulkan-1.dll` e não abre numa máquina sem driver Vulkan. O SDK (~1 GB) só é usado na compilação. Caminhos acima de 260 caracteres quebram o `cl.exe` e o MSBuild, por isso o build fica em `t/` e o Vulkan usa o Ninja; um clone mais fundo que `C:\www\side-projects\jarvis` pode voltar a bater no limite ([build-and-env](../../../arch/build-and-env.md#pasta-de-build-t)).

## Uso no jvOS

### Transcrição (`src-tauri/src/voice/transcriber.rs`)

`Transcriber` carrega o modelo e transcreve uma frase de cada vez.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE carregar o modelo com `flash_attn(true)`, `use_gpu` ligado só quando há GPU escolhida e `gpu_device` com o índice dela, tudo dentro do `Mutex` `VULKAN`.
  - **RF-002**: Cada frase DEVE ser decodificada com estratégia gulosa (`best_of: 1`), temperatura 0, sem contexto, segmento único, sem timestamps, `suppress_blank` e `suppress_nst`, e com o prompt `"Hey Jarvis. <palavras-chave>."` sem caracteres NUL.
    - A janela do encoder (`audio_ctx`) é a duração × 50 quadros + 128, limitada a 384–1500.
    - O teto de tokens é a duração × 10 + 24, o que corta laços de repetição.
    - O idioma vem das Configurações; `auto` vira `None`.
  - **RF-003**: Na CPU, o jvOS DEVE usar as threads disponíveis, limitadas a 1–10 (10 venceu 8 e 12 nesta CPU 2P + 8E). Na GPU, no máximo 4.
  - **RF-004**: Segmentos com probabilidade de não-fala ≥ 0,6 DEVEM ser descartados, e uma saída que só ecoa o prompt vira texto vazio.
  - **RF-005**: Os logs do whisper.cpp e do ggml DEVEM ir para a fachada `log`, sem uso, em vez do stderr (`install_logging_hooks`, uma vez por processo).

### Dispositivo e volta para a CPU (`transcriber.rs`, `voice_devices` em `src-tauri/src/lib.rs`)

Onde o modelo roda, conforme a configuração `voiceDevice`.

- **Comportamento:**
  - **RF-006**: As GPUs DEVEM vir de `whisper_rs::vulkan::list_devices()` (nome sem espaços nas pontas e VRAM em MB), só em builds com `vulkan`.
    - `cpu`: nenhuma GPU.
    - Um nome: essa GPU, se ainda existir; senão vale `auto`.
    - `auto`: a GPU integrada (Intel, menos as Arc dedicadas, ou "Radeon(TM) Graphics" da AMD); senão a primeira da lista.
  - **RF-007**: Se a GPU falhar ao carregar o modelo ou no aquecimento, então o jvOS DEVE carregar na CPU sem erro. Na GPU, o aquecimento transcreve 2 s de silêncio para compilar os pipelines do Vulkan (a primeira vez custava 34,7 s na MX570 e 6,6 s na Intel).
  - **RF-008**: `voice_devices` DEVE devolver `gpus`, `accelerated` (`cfg!(feature = "vulkan")`) e `active` ("CPU" ou o nome da GPU, `None` com o motor parado).

### Build (`src-tauri/Cargo.toml`, `scripts/tauri.mjs`, `.cargo/config.toml`)

O whisper.cpp é compilado do código-fonte a cada build limpo.

- **Comportamento:**
  - **RF-009**: O `scripts/tauri.mjs` DEVE passar `--features vulkan` ao `dev` e ao `build` quando acha o SDK (`VULKAN_SDK`, ou a versão mais nova em `C:\VulkanSDK` que tenha `Lib\vulkan-1.lib`), e DEVE respeitar um `--features` dado à mão.
  - **RF-010**: O script DEVE achar o CMake (PATH ou a cópia do Visual Studio via `vswhere`) e o libclang (`LIBCLANG_PATH` ou `C:\Program Files\LLVM\bin`), e usar o gerador Ninja só nos builds com Vulkan.
  - **RF-011**: O `whisper-rs-sys` DEVE compilar com `opt-level = 3` também em dev, porque sem otimização o whisper.cpp é inutilizável.
  - O cargo compila em `t/`, na raiz, e não em `src-tauri/target` (`build.target-dir = "t"`).

## Restrições

- **RNF-001**: `whisper-rs` 0.16 (`whisper-rs-sys` 0.15.0, whisper.cpp 1.8.3). A feature `vulkan` fica fora do padrão, para o projeto compilar sem o SDK.
- **RNF-002**: Tempo por comando com o Small (ADR-0021): CPU 2,6–8,9 s, Intel Graphics 0,74–1,4 s, NVIDIA MX570 0,09–0,27 s. Carga com aquecimento: Intel ~1,6 s, NVIDIA ~1,7 s, CPU ~0,6 s.
- **RNF-003**: Memória do `jarvis.exe` de release (ADR-0021): ~857 MB privados na CPU; ~1.007 MB privados + ~500 MB compartilhados na Intel; ~1.030 MB + 443 MB de VRAM na MX570.
- **RNF-004**: O `jarvis.exe` de release passa de 12,8 MB para 64,3 MB com `vulkan` (shaders do ggml embutidos).
- **RNF-005**: Compilar exige CMake, libclang e VS Build Tools com C++; com GPU, também o Vulkan SDK e o Ninja. A primeira compilação leva minutos.
- **RNF-006**: Offline: nenhuma rede em tempo de execução.
- **RNF-007**: Licenças Unlicense (bindings) e MIT (whisper.cpp).

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/voice/transcriber.rs` | `Transcriber` (carga, aquecimento, transcrição), `gpu_devices`, `pick_device`, `build_prompt`, `is_prompt_echo` |
| `src-tauri/src/voice/mod.rs` | Carrega o `Transcriber` na thread de voz; testes reais `speech_*` |
| `src-tauri/src/lib.rs` | Comando `voice_devices` |
| `src-tauri/src/settings.rs` | `voice_device` (`AUTO_DEVICE`, `CPU_DEVICE`) |
| `src/components/SettingsPanel.tsx` | Seletor "Processamento da voz" e a dica |
| `src-tauri/Cargo.toml` | Dependência, feature `vulkan`, `opt-level = 3` do `whisper-rs-sys` |
| `scripts/tauri.mjs` | CMake, libclang, Vulkan SDK, Ninja, `--features vulkan` |
| `.cargo/config.toml` | `target-dir = "t"` |

### Testes

Rode de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados (e `VULKAN_SDK`, `CMAKE_GENERATOR=Ninja` para `--features vulkan`).

- `cargo test --lib -- voice::transcriber`: escolha do dispositivo e eco do prompt.
- `cargo test --lib -- --ignored speech --nocapture`: as fixtures reais (`speech_wake_word_mode`, `speech_window_commands`, `speech_always_listening_mode`); baixa ~190 MB na primeira vez. `JARVIS_TEST_MODEL=<id>` troca o modelo.
- `cargo test --lib --features vulkan -- --ignored speech_lists_gpus --nocapture`: os nomes das GPUs como o Vulkan os chama.
- `npx playwright test tests/settings.spec.ts -g "speech recognition runs on the CPU or a GPU"`: o seletor "Processamento da voz" com o fake do navegador.

### Atualização e reversão

- **Comando:** em `src-tauri`, `cargo update -p whisper-rs --precise <versão>`; para outra minor, troque `"0.16"` no `Cargo.toml`. Confira se `whisper_rs::vulkan::list_devices`, `gpu_device` e `install_logging_hooks` continuam lá.
- **Prova:** critérios 1, 3 e 7; `--ignored speech` na CPU e com `--features vulkan` na Intel e na NVIDIA, com o mesmo texto nas fixtures; `npm run perf` no release, comparado com a tabela de memória do ADR-0021.
- **Sinal de volta:** texto diferente nas fixtures, tempos acima da tabela do ADR-0021, a GPU caindo sempre para a CPU, ou o build voltando a bater no `MAX_PATH`.
- **Reversão:** volte `src-tauri/Cargo.toml` e `src-tauri/Cargo.lock`, rode `cargo clean -p whisper-rs-sys` (o CMake reconfigura do zero) e recompile. Confira o critério 1.

### Decisões relacionadas

- [ADR-0002 — Reconhecimento de voz offline com whisper.cpp na CPU](../../../arch/adr/0002-stt-whisper-offline-cpu.md)
- [ADR-0003 — Motor de voz numa thread Rust independente da WebView](../../../arch/adr/0003-motor-de-voz-thread-rust.md)
- [ADR-0021 — Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)

## Dependências

- Vendor: [whisper-models](../whisper-models/spec.md) (os arquivos `ggml-*.bin`), [cpal](../cpal/spec.md) (o áudio a 16 kHz), [sherpa-onnx](../sherpa-onnx/spec.md) e [silero-vad](../silero-vad/spec.md) (o porteiro antes do Whisper), [serde](../serde/spec.md) (`GpuDevice` no IPC), [tauri](../tauri/spec.md) (o CLI que o `scripts/tauri.mjs` chama).
- Specs: [voice-engine](../../../features/voice-engine/spec.md), [dictation](../../../features/dictation/spec.md), [voice-commands](../../../features/voice-commands/spec.md), [settings](../../../features/settings/spec.md), [build-and-env](../../../arch/build-and-env.md).
- Sistema: CMake (o do VS Build Tools serve), LLVM/libclang, Vulkan SDK e Ninja (builds com GPU), driver Vulkan (`vulkan-1.dll` em `System32`), ~15 GB livres para compilar.

## Pendências

- [ ] Nenhum teste cobre a volta para a CPU de `Transcriber::load` quando a GPU recusa o modelo ou falha no aquecimento; só a escolha do dispositivo (`pick_device`) tem teste. Arquivo: `src-tauri/src/voice/transcriber.rs`.
