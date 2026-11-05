# ADR-0021: Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU

| | |
|---|---|
| **Status** | Aceito (medido em 2026-11-04 com o Vulkan SDK 1.4.363.0) |
| **Data** | 2026-11-04 |
| **Origem** | otimização de 2026-11-04 (`scripts/perf.mjs`, medições antes e depois) |

## Contexto

O [ADR-0002](0002-stt-whisper-offline-cpu.md) pôs o Whisper na CPU: Small ~2,4 s por comando em 10 threads de um Core 7 150U (2 P + 8 E), Turbo ~20 s. A máquina também tem uma NVIDIA GeForce MX570 A (2 GB) e uma Intel Graphics, ambas com driver Vulkan (`vulkan-1.dll` no System32).

Medido em 2026-11-04 no build de release com `npm run perf`, 45 s por cenário:

| Cenário | CPU do `jarvis.exe` |
|---|---|
| Push-to-talk ocioso (o padrão) | 0,3 a 2,7 ms/s |
| **"Hey Jarvis" em espera, com som ambiente** | **9.229 ms/s (77% de todas as CPUs)** |

No segundo cenário, cada trecho que a VAD de energia deixa passar (voz de uma reunião, música, ruído) vira um Whisper inteiro em dez núcleos. A RAM privada do processo é de ~860 MB com o Small na CPU.

Fatos verificados no código das dependências:
- `whisper-rs 0.16` tem a feature `vulkan` (`whisper-rs-sys` liga `GGML_VULKAN` e linka `vulkan-1` a partir do `VULKAN_SDK`), e `WhisperContextParameters::use_gpu` é ligado por padrão com ela.
- O ggml desta versão enumera as GPUs dedicadas **e** as integradas (`ggml-vulkan.cpp`, "Default to using all dedicated GPUs", condição `eDiscreteGpu || eIntegratedGpu`), na ordem em que o driver Vulkan as lista.
- O `gpu_device` do whisper.cpp conta os dispositivos `GPU` e `IGPU` na mesma ordem. Então o índice de `whisper_rs::vulkan::list_devices()` é o `gpu_device`, sem precisar de `GGML_VK_VISIBLE_DEVICES`.
- O sherpa-onnx 1.13.8 já linkado para o TTS ([ADR-0005](0005-tts-sherpa-onnx-1-13-8.md)) traz o Silero VAD (`sherpa_onnx::VoiceActivityDetector`).

## Decisão

- **Feature `vulkan`** em `src-tauri/Cargo.toml` (`whisper-rs/vulkan`), fora do padrão: o projeto continua compilando sem o SDK. O `scripts/tauri.mjs` passa `--features vulkan` ao `dev` e ao `build` quando acha o SDK.
- **Setting `voiceDevice`**, com os valores `auto` (padrão), `cpu` ou o nome de uma GPU como o Vulkan a chama. Ela fica no `settings.json` e no seletor "Processamento da voz" das Configurações.
  - O nome é mais estável que o índice.
  - Uma GPU que sumiu vale como `auto`.
  - Trocar reinicia o motor.
- **Volta para a CPU:** se a GPU escolhida falhar ao carregar o modelo, o Whisper carrega na CPU sem erro. O comando `voice_devices` informa onde o modelo está rodando.
- **4 threads na GPU** e 10 na CPU.
- **`auto` = a GPU integrada**, quando existe; senão, a primeira outra GPU.
  - Ela é reconhecida pelo nome: Intel, menos as Arc dedicadas, e as "Radeon(TM) Graphics" da AMD.
  - A ordem da lista do ggml não diz nada: nesta máquina ela vem com a Intel primeiro.
  - Critérios: na integrada, cada comando leva 1 s ou menos e a CPU fica livre, sem manter a dGPU acordada (e gastando energia) enquanto a escuta estiver ligada. A MX570 fica a um clique nas Configurações.
- **Aquecimento na GPU:** ao carregar, uma transcrição de 2 s de silêncio compila os pipelines Vulkan do ggml. A primeira frase de todas custava 34,7 s na MX570 e 6,6 s na Intel; os drivers guardam os pipelines depois disso.

### Medições (Small, 5 frases reais de `speech_wake_word_mode`)

| Modelo | CPU (10 threads) | Intel Graphics | NVIDIA MX570 |
|---|---|---|---|
| **Small** (padrão) | 2,6–8,9 s | **0,74–1,4 s** (2,6 s no pior caso, com o clock baixo) | **0,09–0,27 s** |
| Base | 1,5–2,2 s | 0,51–0,71 s | 0,07–0,15 s |
| Large V3 Turbo | 17–48 s | 3,3–5,8 s | 0,34–2,3 s |

- Carga com aquecimento, pipelines já no cache do driver: Intel ~1,6 s, NVIDIA ~1,7 s, CPU ~0,6 s.
- Com o Small, o texto saiu igual nos três dispositivos. A única frase que falha ("Claude Code" → "Clodikud") já falhava na CPU.
- O Turbo não acertou mais frases que o Small e entrou em laços de repetição na Intel e na CPU: o modelo padrão continua o Small.
- A CPU deste dia ficou mais lenta que os ~2,4 s do ADR-0002, com a mesma máquina na tomada.
- **Porteiro Silero** nos modos "Hey Jarvis" e "Sempre ouvindo":
  - a frase cortada pela VAD de energia só vai ao Whisper com ≥ 0,25 s de fala pelo Silero;
  - ele roda só sobre as candidatas, com 1 thread;
  - o modelo (~0,6 MB, tamanho e SHA-256 fixos) é baixado sozinho no primeiro uso;
  - sem ele, ou offline, vale o comportamento anterior;
  - o push-to-talk, o ditado e as perguntas não passam por ele.
- **Loop sem polling:** com o microfone fechado, o loop dorme até 1 s e os botões o acordam (`nudge`).

### Custo no app (release, `npm run perf`, 2D ocioso, mesma sessão)

| Whisper em | RAM privada do `jarvis.exe` | Memória de GPU do `jarvis.exe` | CPU total (app + WebView2) |
|---|---|---|---|
| CPU (build sem Vulkan) | ~857 MB | 0 | ~78 ms/s |
| Intel (o `auto`) | ~1.007 MB | ~500 MB compartilhada (é RAM do sistema) | ~79 ms/s |
| NVIDIA MX570 | ~1.030 MB | 443 MB dedicada na NVIDIA + ~64 MB compartilhada | ~78–109 ms/s (variação da WebView2) |

- Esperando o "Hey Jarvis" sem fala no ambiente, o `jarvis.exe` ficou em 2 ms/s (CPU) e 4 ms/s (Intel), sem nenhuma frase mandada ao Whisper. Com o `auto`, a NVIDIA ficou em 0%.
- A causa da RAM a mais (driver Vulkan, buffers do ggml) não foi investigada.
- O `jarvis.exe` de release passa de 12,8 MB para 64,3 MB: os shaders do ggml vão embutidos.

## Consequências

- **Positivas:**
  - Ruído deixa de custar um Whisper. Fala de verdade custa na GPU uma fração do tempo e deixa a CPU livre.
  - Quem não tem o SDK nem a GPU continua como antes.
  - Na GPU, o Turbo, que erra menos que o Small, pode voltar a ser viável. A troca do modelo padrão exige medir, como manda o ADR-0002.
- **Negativas / custos:**
  - O Vulkan SDK (~1 GB) passa a ser pré-requisito para compilar com GPU. O build do whisper.cpp com Vulkan compila centenas de shaders, e a primeira vez demora mais.
  - O subprojeto do gerador de shaders estoura o limite de 260 caracteres do Windows. A pasta de build passou para `t/`, na raiz, e o build com Vulkan usa o Ninja ([build-and-env](../build-and-env.md#pasta-de-build-t)).
  - Um binário com a feature linka o `vulkan-1.dll`: numa máquina sem nenhum driver Vulkan ele não abre. Aceitável para este app, mas é um limite.
  - A dGPU acordada gasta bateria (pesa no `auto`).
  - Com o modelo na Intel, o app ocupa ~650 MB de memória a mais que na CPU (~150 MB de RAM privada e ~500 MB de memória compartilhada da GPU). Quem prefere a menor memória escolhe "Processador" nas Configurações.
  - O executável fica ~5 vezes maior (64,3 MB).
- **Regras que daqui decorrem:**
  - Todo acesso ao backend Vulkan do ggml (listar dispositivos, criar contexto) passa pelo `Mutex` de `transcriber.rs`, porque a inicialização dele não tem trava.
  - Medir com `JARVIS_TEST_DEVICE=<cpu|auto|nome> JARVIS_TEST_MODEL=<id> cargo test --lib --features vulkan -- --ignored speech --nocapture`.

## Alternativas consideradas

- **Detector dedicado de palavra de ativação** (o KWS do sherpa-onnx): os modelos prontos são em inglês ou chinês, com sotaque e palavras pt-BR incertos. Não resolve o "Sempre ouvindo", onde toda frase é comando. Ficou de fora.
- **Menos threads no standby, na CPU:** limitaria o uso a ~1/3 da CPU, mas a detecção do "Hey Jarvis" demoraria 2 a 3 vezes mais. A GPU e o porteiro resolvem sem esse custo.
- **WebView2 em Vulkan** (`--use-angle=vulkan`): ver o [ADR-0022](0022-nucleo-relogio-quadros-limitado-canvas-3.md). A UI fica no D3D11.

## Referências

- Substitui o [ADR-0002 — Reconhecimento de voz offline com whisper.cpp na CPU, modelo Small por padrão](0002-stt-whisper-offline-cpu.md)
- `src-tauri/src/voice/transcriber.rs`, `src-tauri/src/voice/silero.rs`, `src-tauri/src/voice/mod.rs`, `src-tauri/src/models.rs`, `src-tauri/src/settings.rs`, `src-tauri/src/lib.rs` (`voice_devices`), `src-tauri/Cargo.toml`, `scripts/tauri.mjs`
- Specs afetadas: [voice-engine](../../features/voice-engine/spec.md), [settings](../../features/settings/spec.md), [build-and-env](../build-and-env.md)
