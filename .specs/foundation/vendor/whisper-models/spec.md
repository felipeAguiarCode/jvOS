# Vendor: Modelos Whisper (ggml)

Os pesos do Whisper no formato ggml do whisper.cpp, que o motor de voz carrega para transcrever cada comando, ditado e pergunta falada.

| | |
|---|---|
| **ID** | `vendor/whisper-models` |
| **Tipo** | Modelo |
| **Status** | Em uso |
| **Versão** | `ggml-small-q5_1.bin`: 190.085.487 bytes (~190 MB), **padrão** · `ggml-base-q5_1.bin`: 59.707.625 bytes (~60 MB) · `ggml-large-v3-turbo-q5_0.bin`: 574.041.195 bytes (~574 MB). Tamanho e SHA-256 fixos em `MODELS` (`src-tauri/src/models.rs`). Ficam em `%LOCALAPPDATA%\dev.jarvis.os\models\`; nesta máquina os três estão baixados, e o SHA-256 do Small e do Base bate com o catálogo (conferido em 2026-11-05) |
| **Licença** | MIT ⚠ inferido — confirmar (nenhum arquivo local traz a licença dos pesos; o código do whisper.cpp vendorizado no `whisper-rs-sys` 0.15.0 é MIT) |
| **Fonte** | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<arquivo>` (`WHISPER_SOURCE`) |
| **Onde roda** | processo Rust (thread `jarvis-voice`, via `whisper-rs`), na CPU ou numa GPU com Vulkan |

## Objetivo

Transcrever a fala em pt-BR offline e sem chave de API, com um catálogo fixo de três tamanhos que troca precisão por tempo. O Small é o padrão: na CPU ele leva ~2,4 s por comando contra ~20 s do Large V3 Turbo ([ADR-0002](../../../arch/adr/0002-stt-whisper-offline-cpu.md)), e na GPU o Turbo não acertou mais frases que o Small e entrou em laços de repetição ([ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).

## Não-objetivos

- Só três arquivos quantizados e multilíngues (q5_1 e q5_0). Sem `tiny`, `medium` (aposentado: `sanitize` o troca por `small`), `.en` ou modelos sem quantização.
- Sem tradução (`set_translate(false)`), sem timestamps e sem contexto entre frases (`set_no_context(true)`).
- O Whisper não é baixado sozinho: o download só começa no botão "Baixar" das Configurações (ao contrário do [Silero](../silero-vad/spec.md)).
- Sem caminho de modelo escolhido pelo usuário: só os ids do catálogo valem.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o catálogo `MODELS` em `src-tauri/src/models.rs`
- **Quando** `cargo test --lib -- models::` roda em `src-tauri`
- **Então** `catalog_is_consistent` passa: cada modelo tem SHA-256 de 64 caracteres e arquivo `.bin`, `find` acha cada id e `find("missing")` é `None`.

### Critério 2 (RF-002)

- **Dado** um `ggml-small-q5_1.bin` com 9 bytes (`b"truncated"`) na pasta
- **Quando** `is_downloaded` é consultado
- **Então** devolve `false` (teste `partial_files_do_not_count_as_downloaded`), e ligar a escuta com esse modelo responde `model-missing`.

### Critério 3 (RF-003)

- **Dado** um download cujo SHA-256 não bate com o catálogo
- **Quando** `fetch_verified` termina de ler o corpo
- **Então** o `.part` é apagado, o arquivo final não aparece e o cartão do modelo troca a descrição por "Arquivo corrompido (verificação SHA-256 falhou)".

### Critério 4 (RF-009)

- **Dado** um `settings.json` com `model` `"huge"` ou o aposentado `"medium"`
- **Quando** `cargo test --lib -- settings::` roda
- **Então** `invalid_language_model_and_theme_are_reset` passa: os dois viram `small`, e `base` e `large-v3-turbo` são mantidos.

### Critério 5 (RF-004)

- **Dado** o download do Small em andamento
- **Quando** o usuário pede `download_model("small")` de novo
- **Então** o segundo pedido volta `Ok` sem abrir outro download, e só um `model:done` chega.

### Critério 6 (RNF-002)

- **Dado** um build com `--features vulkan` e o Small baixado nesta máquina (Core 7 150U, Intel Graphics, NVIDIA MX570 A)
- **Quando** `JARVIS_TEST_DEVICE=auto JARVIS_TEST_MODEL=small cargo test --lib --features vulkan -- --ignored speech --nocapture` roda
- **Então** a carga imprime "loaded in … ms on Intel(R) Graphics" e nenhuma linha "<ms> ms for <s> s of audio" passa de 2.600 ms (faixa medida: 0,74–1,4 s); com `JARVIS_TEST_DEVICE=cpu`, a faixa medida é 2,6–8,9 s.

## Casos de borda

- **Vazio/nulo:** nenhum modelo baixado, ou o escolhido não está na pasta → `voice_start` e `voice_push` devolvem `model-missing`; as Configurações abrem e a dock diz "Baixe um modelo de voz". Sem rede, o cartão mostra "Falha no download: <motivo>" e nada fica na pasta.
- **Duplicidade/idempotência:** um arquivo com o mesmo nome e outro tamanho (versão antiga, cópia cortada) conta como não baixado e o "Baixar" o substitui só depois do hash conferido. Um arquivo fora do catálogo na mesma pasta (ex.: um `ggml-large-v3-turbo.bin` sem quantização) é ignorado e só ocupa disco.
- **Concorrência/corrida:** dois modelos diferentes podem baixar ao mesmo tempo, cada um no seu `.part`. Trocar o modelo com o motor ligado reinicia o motor com o arquivo novo. Listar as GPUs e carregar o modelo se revezam no `Mutex` `VULKAN`, porque o backend Vulkan do ggml inicia sem trava.
- **Permissões/visibilidade:** a pasta é do usuário (`%LOCALAPPDATA%`), sem admin. Um proxy que bloqueie o Hugging Face impede o download; um arquivo copiado à mão com o nome e o tamanho exatos conta como baixado, porque o hash só é conferido no download.

## Uso no jvOS

### Catálogo e download verificado (`src-tauri/src/models.rs`)

Fixa os três arquivos e os baixa por `download::fetch_verified`.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE oferecer só os modelos de `MODELS`, nesta ordem: `small` ("Small", "Rápido e preciso, recomendado"), `base` ("Base", "O mais rápido, erra mais palavras") e `large-v3-turbo` ("Large V3 Turbo", "O mais preciso, muito lento sem GPU"), cada um com tamanho e SHA-256 fixos.
  - **RF-002**: Um modelo DEVE contar como baixado só quando o arquivo tem exatamente o tamanho do catálogo (`is_downloaded`). O hash é conferido no download, não a cada carga.
  - **RF-003**: O download DEVE gravar em `<arquivo>.part` (ex.: `ggml-small-q5_1.part`), recusar um corpo maior que `size + 1` bytes e só renomear para o nome final quando tamanho e SHA-256 batem. Senão, apaga o `.part` e devolve "Arquivo corrompido (verificação SHA-256 falhou)".
  - Se a conexão cair, então o erro é "Falha no download: <motivo>" e o `.part` é apagado.

### Pasta, comandos e eventos (`src-tauri/src/lib.rs`)

Liga o catálogo às Configurações e ao motor de voz.

- **Comportamento:**
  - **RF-004**: `download_model` DEVE baixar numa thread própria, emitir `model:progress { id, received, total }` a cada 200 ms e `model:done { id, error }` no fim. Um segundo pedido do mesmo id durante o download DEVE ser ignorado (`downloading`).
  - **RF-005**: A pasta DEVE ser `app_local_data_dir()/models` (`%LOCALAPPDATA%\dev.jarvis.os\models`). `selected_model` DEVE devolver `model-missing` quando o modelo de `Settings.model` não está baixado.
  - Se `model` ou `voiceDevice` mudar com o motor rodando, então `save_settings` reinicia o motor com o arquivo novo.

### Carga e transcrição (`src-tauri/src/voice/transcriber.rs`)

Abre o arquivo no whisper.cpp e transcreve uma frase por vez.

- **Comportamento:**
  - **RF-006**: O jvOS DEVE carregar o arquivo com `WhisperContext::new_with_params`, flash attention ligada, no dispositivo que `voiceDevice` pede (`auto`, `cpu` ou o nome da GPU). Se a GPU falhar ao carregar, o modelo carrega na CPU sem erro.
  - **RF-007**: Na GPU, a carga DEVE incluir uma transcrição de 2 s de silêncio, que compila os pipelines Vulkan: sem ela, a primeira frase custava 34,7 s na MX570 e 6,6 s na Intel.
  - **RF-008**: Cada frase DEVE usar decodificação gulosa, janela do encoder de 384 a 1500 frames (50 por segundo de áudio mais 128), teto de 10 tokens por segundo mais 24, `no_speech_thold` 0,6 e o prompt `"Hey Jarvis. <palavras-chave>"`. São 10 threads na CPU e 4 na GPU.
  - Se a saída só repetir o prompt (3 palavras ou mais), então ela é descartada.

### Escolha nas Configurações (`src/hooks/useSettings.ts`, `src/components/SettingsPanel.tsx`)

Mostra o catálogo, o progresso e os erros.

- **Comportamento:**
  - A seção "Reconhecimento de voz" mostra um cartão por modelo no `radiogroup` "Modelo Whisper": "Small · 190 MB", "Base · 60 MB" e "Large V3 Turbo · 574 MB", com a descrição do catálogo e, à direita, "Baixado", o progresso em % ou o botão "Baixar".
  - Se o download falhar, então o erro de `model:done` toma o lugar da descrição no cartão.

### Ajuste do `settings.json` (`src-tauri/src/settings.rs`)

Mantém `Settings.model` dentro do catálogo.

- **Comportamento:**
  - **RF-009**: `sanitize` DEVE trocar por `small` qualquer `model` que `models::find` não conheça, inclusive o aposentado `medium`. O padrão de `Settings::default()` é `small`.

## Restrições

- **RNF-001**: Offline: a rede só é usada no download, do Hugging Face (`ggerganov/whisper.cpp`, ramo `main`). O SHA-256 fixo prende o arquivo exato, mesmo que o `main` mude.
- **RNF-002**: Tempo por comando, 5 frases reais de `speech_wake_word_mode`, 2026-11-04 ([ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)):

  | Modelo | CPU (10 threads) | Intel Graphics | NVIDIA MX570 |
  |---|---|---|---|
  | Small (padrão) | 2,6–8,9 s | 0,74–1,4 s (2,6 s com o clock baixo) | 0,09–0,27 s |
  | Base | 1,5–2,2 s | 0,51–0,71 s | 0,07–0,15 s |
  | Large V3 Turbo | 17–48 s | 3,3–5,8 s | 0,34–2,3 s |

  Em 2026-10-27, só CPU ([ADR-0002](../../../arch/adr/0002-stt-whisper-offline-cpu.md)): Small ~2,4 s, Base ~0,75 s, Turbo ~20 s (o encoder de 32 camadas faz cerca de 1 TFLOP).
- **RNF-003**: O padrão é o Small, e não o Turbo: o Turbo não acertou mais frases que o Small, entrou em laços de repetição na Intel e na CPU e custa ~20 s por comando na CPU. Com o Small, o texto saiu igual nos três dispositivos. Trocar o padrão exige medir de novo (regra do ADR-0002).
- **RNF-004**: Memória do `jarvis.exe` de release com o Small (2D ocioso): ~857 MB de RAM privada na CPU; ~1.007 MB mais ~500 MB de memória compartilhada da GPU na Intel (~650 MB a mais que na CPU); ~1.030 MB mais 443 MB de VRAM na NVIDIA. A carga com aquecimento leva ~1,6 s na Intel, ~1,7 s na NVIDIA e ~0,6 s na CPU.
- **RNF-005**: Disco: ~824 MB com os três modelos. O C: desta máquina já zerou durante builds; confira o espaço antes de baixar o Turbo.
- **RNF-006**: Licença MIT ⚠ inferido — confirmar.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/models.rs` | Catálogo `MODELS`, `find`, `path`, `is_downloaded`, `download` |
| `src-tauri/src/download.rs` | `fetch_verified`: `.part`, SHA-256, limite de tamanho e progresso |
| `src-tauri/src/lib.rs` | `models_dir`, `selected_model`, `models_status`, `download_model`, eventos `model:*` e reinício do motor em `save_settings` |
| `src-tauri/src/voice/transcriber.rs` | `Transcriber::load`, aquecimento na GPU, parâmetros do encoder e do decoder |
| `src-tauri/src/voice/mod.rs` | Carrega o modelo escolhido na thread de voz; testes `speech_*` com `JARVIS_TEST_MODEL` |
| `src-tauri/src/settings.rs` | `Settings.model` (padrão `small`) e `sanitize` |
| `src/hooks/useSettings.ts` | `useModels`: lista, progresso e erros |
| `src/components/SettingsPanel.tsx` | `ModelCard` e a seção "Reconhecimento de voz" |

### Testes

- `cargo test --lib -- models::` (em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados): catálogo consistente e arquivo parcial não conta como baixado.
- `cargo test --lib -- settings::`: `small` é o padrão, e um id inválido ou aposentado volta para `small`.
- `JARVIS_TEST_MODEL=<small|base|large-v3-turbo> JARVIS_TEST_DEVICE=<cpu|auto|nome da GPU> cargo test --lib --features vulkan -- --ignored speech --nocapture`: fixtures reais com o modelo e o dispositivo escolhidos, com o tempo de carga e o dispositivo impressos. Baixa o modelo na primeira vez (~190 MB o Small). Sem `--features vulkan`, sempre CPU.
- `npx playwright test tests/shortcuts.spec.ts -g "JARVIS's model is chosen"`: os cartões dos modelos Whisper nas Configurações, no modo web.
- Conferência manual: `(Get-FileHash "$env:LOCALAPPDATA\dev.jarvis.os\models\ggml-small-q5_1.bin" -Algorithm SHA256).Hash` igual a `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`.

### Atualização e reversão

- **Comando:** trocar `file`, `size` e `sha256` da entrada em `MODELS` (a URL segue `WHISPER_SOURCE`) e baixar pelo botão "Baixar" das Configurações.
- **Prova:** `cargo test --lib -- models:: settings::` e a medição `--ignored speech` em CPU, Intel e NVIDIA, comparada com a tabela do ADR-0021.
- **Sinal de volta:** mais frases erradas nas fixtures, laços de repetição, tempo por comando acima da faixa do RNF-002, ou "Falha ao carregar o modelo de voz".
- **Reversão:** voltar a entrada de `MODELS` ao commit anterior. O arquivo antigo continua valendo enquanto estiver na pasta com o tamanho exato; se ele foi substituído, o "Baixar" o traz de novo.

### Decisões relacionadas

- [ADR-0002 — Reconhecimento de voz offline com whisper.cpp na CPU, modelo Small por padrão](../../../arch/adr/0002-stt-whisper-offline-cpu.md) (substituído)
- [ADR-0021 — Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)

## Dependências

- [whisper-rs](../whisper-rs/spec.md): carrega e roda o ggml; a feature `vulkan` leva o modelo para a GPU.
- [http](../http/spec.md): o `ureq` faz o download. [archives](../archives/spec.md): o `sha2` confere o hash.
- [silero-vad](../silero-vad/spec.md): mora na mesma pasta e filtra o que chega ao Whisper nos modos de escuta.
- [voice-engine](../../../features/voice-engine/spec.md), [dictation](../../../features/dictation/spec.md), [settings](../../../features/settings/spec.md) e [assistant](../../../features/assistant/spec.md) (perguntas faladas).
- Sistema: `%LOCALAPPDATA%\dev.jarvis.os\models` ([persistence](../../../domain/persistence.md)), rede até o Hugging Face no download e, para a GPU, o `vulkan-1.dll` do driver de vídeo.

## Pendências

- [ ] O comentário de `MODELS` em `src-tauri/src/models.rs` ainda diz que o Whisper roda na CPU; desde o ADR-0021 ele roda na GPU quando o build tem a feature `vulkan`.
- [ ] A licença dos pesos não tem arquivo local que a confirme.
