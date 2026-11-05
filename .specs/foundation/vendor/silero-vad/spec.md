# Vendor: Silero VAD

O modelo ONNX de detecção de fala que o motor de voz usa como porteiro: só deixa ir ao Whisper o trecho que tem fala de verdade.

| | |
|---|---|
| **ID** | `vendor/silero-vad` |
| **Tipo** | Modelo |
| **Status** | Em uso |
| **Versão** | `silero_vad.onnx` (Silero VAD v4, segundo o comentário de `models::SILERO`): 643.854 bytes (~0,6 MB), SHA-256 `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`. Fica em `%LOCALAPPDATA%\dev.jarvis.os\models\`, ao lado dos modelos Whisper; nesta máquina foi baixado em 2026-11-04, e o hash bate com o catálogo (conferido em 2026-11-05) |
| **Licença** | MIT ⚠ inferido — confirmar (nenhum arquivo local traz a licença) |
| **Fonte** | `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx` (release `asr-models` do sherpa-onnx) |
| **Onde roda** | processo Rust (thread `jarvis-voice`), via `sherpa_onnx::VoiceActivityDetector`, na CPU, com 1 thread |

## Objetivo

Impedir que ruído (porta, teclado, música sem voz, ventilador) custe um Whisper inteiro nos modos "Hey Jarvis" e "Sempre ouvindo". Em 2026-11-04, em espera com som ambiente, o `jarvis.exe` chegou a 9.229 ms/s de CPU (77% de todas as CPUs) transcrevendo o barulho da sala. O Silero foi escolhido porque já vem no sherpa-onnx 1.13.8 linkado para o TTS ([ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md), [ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).

## Não-objetivos

- Não substitui a VAD de energia (`src-tauri/src/voice/vad.rs`): ela continua cortando as frases, e o Silero só confere as candidatas.
- Não roda o tempo todo nem em streaming, e não passa pelo push-to-talk, pelo ditado nem pelas perguntas ao JARVIS.
- Não é detector de palavra de ativação: o KWS do sherpa-onnx ficou de fora no ADR-0021 (modelos prontos só em inglês ou chinês).
- Não aparece nas Configurações nem em `models_status`: não há botão para baixar, trocar ou apagar.

## Critérios de aceite

### Critério 1 (RF-002)

- **Dado** o `silero_vad.onnx` na pasta de modelos e as DLLs do sherpa em `t/debug/deps`
- **Quando** `cargo test --lib -- --ignored speech_gate` roda em `src-tauri`
- **Então** `speech_gate_tells_speech_from_noise` passa: as fixtures `wake_only`, `wake_command` e `terminal` têm 0,25 s de fala ou mais, e 3 s de ruído branco, 3 s de zumbido de 120 Hz e 2 s de silêncio ficam abaixo de 0,25 s.

### Critério 2 (RF-003)

- **Dado** a pasta de modelos sem `silero_vad.onnx`, com a rede ligada e o modo "Hey Jarvis"
- **Quando** a VAD de energia corta a primeira frase
- **Então** uma thread `jarvis-silero-download` baixa o arquivo (643.854 bytes, hash conferido), e essa frase vai ao Whisper sem passar pelo Silero.

### Critério 3 (RF-003)

- **Dado** a pasta sem o modelo e sem rede
- **Quando** o download falha
- **Então** o stderr mostra "[jarvis] Silero VAD: Falha no download: <motivo>", a escuta segue só com a VAD de energia e uma nova tentativa só acontece 10 s depois.

### Critério 4 (RF-004)

- **Dado** o modo push-to-talk e a pasta sem o modelo
- **Quando** o usuário segura o botão e fala um comando
- **Então** a gravação vai direto ao Whisper e o `silero_vad.onnx` continua sem ser baixado.

### Critério 5 (RNF-001)

- **Dado** o modelo baixado
- **Quando** `(Get-FileHash "$env:LOCALAPPDATA\dev.jarvis.os\models\silero_vad.onnx" -Algorithm SHA256).Hash` e `(Get-Item "$env:LOCALAPPDATA\dev.jarvis.os\models\silero_vad.onnx").Length` rodam no PowerShell
- **Então** o hash é `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` e o tamanho é 643.854 bytes.

### Critério 6 (RNF-002)

- **Dado** o release com "Hey Jarvis" em espera e nenhuma fala no ambiente
- **Quando** `npm run perf -- --seconds 45 --pid <pid do jarvis.exe>` mede o app
- **Então** o `jarvis.exe` fica perto de 2 ms/s de CPU (Whisper na CPU) ou 4 ms/s (na Intel), e nenhum `voice:transcribing` é emitido.

## Casos de borda

- **Vazio/nulo:** o modelo não está na pasta, ou está mas não carrega → `passes` devolve `true` e a VAD de energia decide sozinha, como antes do porteiro. Uma carga que falha escreve "[jarvis] Silero VAD: could not load <caminho>".
- **Duplicidade/idempotência:** várias partidas do motor na mesma execução disparam no máximo um download por vez (`DOWNLOADING`, um `AtomicBool` estático). Um arquivo do mesmo nome com outro tamanho conta como ausente e é baixado de novo por cima.
- **Concorrência/corrida:** o download roda numa thread à parte enquanto o motor segue; a pasta só é olhada de novo a cada 10 s, então o porteiro começa a valer até 10 s depois de o arquivo chegar. Cada frase começa com `reset()` do detector, sem estado da frase anterior.
- **Permissões/visibilidade:** o arquivo é do usuário (`%LOCALAPPDATA%`). Um binário sem as DLLs do sherpa ao lado carrega o `onnxruntime.dll` 1.17 do `System32` e quebra ("API version 28 not available", ACCESS_VIOLATION); por isso os testes precisam das DLLs em `t/debug/deps`.

## Uso no jvOS

### Entrada no catálogo (`src-tauri/src/models.rs`)

Descreve o arquivo com o mesmo `ModelInfo` dos modelos Whisper.

- **Comportamento:**
  - **RF-001**: `SILERO` DEVE ficar fora de `MODELS`, para não aparecer nas Configurações nem em `models_status`, e DEVE usar o mesmo `is_downloaded` (tamanho exato) e o mesmo `download` (`.part` e SHA-256) dos modelos Whisper.

### Porteiro dos modos de escuta (`src-tauri/src/voice/silero.rs`)

O `SpeechGate` decide se uma frase cortada pela VAD de energia tem fala.

- **Comportamento:**
  - **RF-002**: Uma frase DEVE passar só com 0,25 s de fala ou mais pelo Silero, com limiar 0,5, janela de 512 amostras a 16 kHz, silêncio mínimo de 0,25 s, buffer de 30 s, 1 thread e `provider` `cpu`.
  - **RF-003**: O modelo DEVE ser carregado sob demanda, na primeira frase. Se faltar, ele é baixado uma vez por execução, numa thread `jarvis-silero-download`, e a pasta é olhada de novo a cada 10 s.
  - Se o modelo não estiver disponível, então a frase passa (`true`), porque a VAD de energia já a deixou passar.

### Loop do motor de voz (`src-tauri/src/voice/mod.rs`)

Chama o porteiro antes de mandar a frase ao Whisper.

- **Comportamento:**
  - **RF-004**: O jvOS DEVE consultar o porteiro só nas frases que a VAD de energia corta com o microfone aberto, sem botão segurado (modos `wakeWord` e `always`), antes de `handle_utterance`. Gravações do push-to-talk, do ditado e das perguntas não passam por ele.
  - O porteiro usa a pasta do modelo Whisper carregado (`model.parent()`).
  - Se o JARVIS estiver falando (`voice_deafen`), então a VAD de energia é zerada e nada chega ao porteiro.

## Restrições

- **RNF-001**: Arquivo fixo de 643.854 bytes, com SHA-256 conferido no download.
- **RNF-002**: Custo de ~5 ms por segundo de áudio em 1 thread (comentário de `silero.rs`), só sobre as frases candidatas. Em espera sem fala no ambiente, medido em 2026-11-04: 2 ms/s (CPU) e 4 ms/s (Intel), contra 9.229 ms/s antes do porteiro com som ambiente ([ADR-0021](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)). Ruído deixa de custar um Whisper (~2,4 s de dez núcleos com o Small).
- **RNF-003**: Roda no sherpa-onnx `=1.13.8` com a feature `shared`, e exige as DLLs do sherpa ao lado de todo binário que o carrega ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).
- **RNF-004**: Offline depois do primeiro download; a rede só é usada para o GitHub.
- **RNF-005**: Fala real no ambiente passa o porteiro de propósito, então medições de "Hey Jarvis" com gente falando por perto não servem de comparação.
- **RNF-006**: Licença MIT ⚠ inferido — confirmar.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/models.rs` | `SILERO`: arquivo, tamanho, SHA-256 e URL |
| `src-tauri/src/voice/silero.rs` | `SpeechGate`: carga sob demanda, download em segundo plano, `speech_seconds`; teste `speech_gate_tells_speech_from_noise` |
| `src-tauri/src/voice/mod.rs` | Cria o `SpeechGate` e o consulta antes de `handle_utterance` |
| `src-tauri/src/download.rs` | `fetch_verified`, comum aos modelos |

### Testes

- `cargo test --lib -- --ignored speech_gate` (em `src-tauri`, com `CMAKE`, `LIBCLANG_PATH` e as DLLs do sherpa em `t/debug/deps`): baixa o modelo para `%LOCALAPPDATA%\dev.jarvis.os\models` se faltar e separa fala de ruído.
- `cargo test --lib -- models::`: o `is_downloaded` por tamanho exato, que o Silero também usa.
- `npm run perf -- --seconds 45 --pid <pid> --label wake --json wake.json` no build de release, com "Hey Jarvis" em espera: CPU do `jarvis.exe` e frases mandadas ao Whisper.

### Atualização e reversão

- **Comando:** trocar `file`, `size`, `sha256` (e `source`, se mudar de release) em `models::SILERO`. Um arquivo novo com outro tamanho é baixado sozinho na primeira frase de um modo de escuta.
- **Prova:** `cargo test --lib -- --ignored speech_gate` e a medição de "Hey Jarvis" em espera com `npm run perf`.
- **Sinal de volta:** comandos ditos depois do "Hey Jarvis" ignorados (fala barrada), ou a CPU em espera voltando a subir com ruído (ruído passando).
- **Reversão:** voltar `SILERO` ao commit anterior. O arquivo errado tem outro tamanho, conta como ausente e o certo é baixado de novo na próxima frase.

### Decisões relacionadas

- [ADR-0021 — Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU](../../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)
- [ADR-0005 — Voz do JARVIS local com sherpa-onnx fixado em 1.13.8](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)

## Dependências

- [sherpa-onnx](../sherpa-onnx/spec.md): `VoiceActivityDetector` e as DLLs do onnxruntime.
- [whisper-models](../whisper-models/spec.md): mesma pasta e mesmo `ModelInfo`; o Silero protege o Whisper.
- [http](../http/spec.md) e [archives](../archives/spec.md): `ureq` e `sha2` no download.
- [voice-engine](../../../features/voice-engine/spec.md) (RF-011 da spec), [persistence](../../../domain/persistence.md).
- Sistema: rede até o GitHub no primeiro uso; `%LOCALAPPDATA%\dev.jarvis.os\models`.

## Pendências

- [ ] Uma falha no download ou na carga do Silero só vai para o stderr (`eprintln!` em `src-tauri/src/voice/silero.rs`); a UI não mostra se o porteiro está ativo.
