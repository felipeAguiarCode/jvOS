# Vendor: Kokoro multi-lang v1.0 (int8)

O modelo neural Kokoro-82M, quantizado em int8 e empacotado pelo sherpa-onnx, que dá ao JARVIS quatro vozes opcionais mais naturais e mais lentas que as do Piper.

| | |
|---|---|
| **ID** | `vendor/kokoro` |
| **Tipo** | Modelo |
| **Status** | Opcional (não é a voz padrão; só é baixado se o usuário escolher uma voz neural) |
| **Versão** | `kokoro-int8-multi-lang-v1_0.tar.bz2`: 132.353.410 bytes, SHA-256 fixo em `speech::MODELS`. Extraído em `%LOCALAPPDATA%\dev.jarvis.os\tts\kokoro-int8-multi-lang-v1_0\` com um `.ready`: 189.881.734 bytes nesta máquina (`model.int8.onnx` 114.202.993, `voices.bin` 28.200.960, `tokens.txt`, `espeak-ng-data`, `dict`, léxicos `en`/`zh` e `.fst`). Tabela de 54 falantes da v1.0 (`em_santa` no id 53, segundo o `README.md` do pacote) |
| **Licença** | Apache-2.0 (do `LICENSE` do pacote extraído) |
| **Fonte** | `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2` (`BASE_URL` em `src-tauri/src/speech.rs`); o `README.md` do pacote cita o diretório oficial `Kokoro-82M/voices` |
| **Onde roda** | processo Rust (`speech_synthesize` em `spawn_blocking`), via sherpa-onnx `OfflineTts` (Kokoro), na CPU |

## Objetivo

Oferecer uma voz neural mais natural que a do Piper para quem aceita esperar. O Kokoro fica fora do padrão porque é lento: RTF ≈ 1,1–1,2 no Core 7 150U (cerca de 1 s de espera por segundo de fala), contra 0,25–0,3 do Piper, e ele fica mais lento com mais threads, por causa dos núcleos E ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).

## Não-objetivos

- Só 4 dos 54 falantes: `pm_alex` (43), `pm_santa` (44), `pf_dora` (42) e `bm_george` (26).
- Só `lang = "pt-br"`. Os léxicos em inglês e chinês, o `dict` e os `.fst` vêm no pacote, mas o jvOS não os usa.
- Não é a voz padrão, e o jvOS não mistura vozes nem ajusta estilo.
- Sem streaming dentro da frase: a UI pede uma frase por vez.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o catálogo `speech::MODELS` e `speech::VOICES`
- **Quando** `cargo test --lib -- speech::` roda em `src-tauri`
- **Então** `catalog_is_consistent` passa: as vozes do modelo `kokoro` têm `sid` entre 0 e 53, e o pacote termina em `.tar.bz2` com SHA-256 de 64 caracteres.

### Critério 2 (RF-003)

- **Dado** a pasta do Kokoro com `.ready`
- **Quando** `speech_synthesize` é chamado com a voz `pm_alex`
- **Então** o sherpa carrega `model.int8.onnx`, `voices.bin`, `tokens.txt` e `espeak-ng-data` com `lang` `pt-br` e devolve um WAV de 16 bits mono.

### Critério 3 (RF-002)

- **Dado** o Kokoro não baixado e a voz "Alex · neural, masculina" escolhida
- **Quando** o usuário abre "Voz do JARVIS"
- **Então** aparece o cartão "Kokoro (neural) · 132 MB" com "Mais natural, mas leva cerca de 1 s por segundo de fala" e "Baixar", "Ouvir exemplo" fica desabilitado e as respostas saem só em texto (`voice-missing`).

### Critério 4 (RF-004)

- **Dado** a Miro (Piper) carregada
- **Quando** a próxima frase pede a voz `pf_dora`
- **Então** o Piper sai da memória e o Kokoro carrega no lugar; voltar para a Miro recarrega o Piper.

### Critério 5 (RNF-001)

- **Dado** o Kokoro baixado e as DLLs do sherpa em `t/debug/deps`
- **Quando** `JARVIS_TTS_DIR=<tts> JARVIS_TTS_OUT=<pasta> JARVIS_TTS_VOICES=pm_alex,pm_santa,pf_dora,bm_george cargo test --lib -- --ignored speech_samples --nocapture` roda
- **Então** cada linha impressa mostra RTF de 1,3 ou menos (medido em 2026-10-27: 1,1–1,2, contra 0,25–0,3 das vozes Piper).

### Critério 6 (RNF-002)

- **Dado** o download do Kokoro pelo cartão
- **Quando** `speech:done` chega sem erro
- **Então** o pacote de 132.353.410 bytes foi apagado e só a pasta `kokoro-int8-multi-lang-v1_0\` fica em `tts\`, com o `.ready`.

## Casos de borda

- **Vazio/nulo:** Kokoro não baixado ou sem rede → `voice-missing` e respostas só em texto; o cartão mostra "Baixar" e, se falhar, "Falha no download: <motivo>" ou "Falha ao extrair a voz: <motivo>".
- **Duplicidade/idempotência:** um segundo pedido de download durante o primeiro é ignorado (`speech_downloading`). As quatro vozes neurais usam o mesmo pacote, então baixar uma vale para todas. Um pacote republicado com o mesmo nome não é baixado de novo enquanto a pasta tiver `.ready`.
- **Concorrência/corrida:** um modelo carregado por vez, atrás de um `Mutex`. Alternar entre Piper e Kokoro recarrega o modelo a cada troca, o que custa tempo na frase seguinte.
- **Permissões/visibilidade:** as entradas do `.tar.bz2` não escapam de `tts\`. A licença é Apache-2.0. Sem as DLLs do sherpa ao lado do binário, o `onnxruntime.dll` 1.17 do `System32` derruba o processo.

## Uso no jvOS

### Catálogo (`src-tauri/src/speech.rs`)

Fixa o pacote e as quatro vozes.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE oferecer o pacote `kokoro` ("Kokoro (neural)", `Kind::Kokoro { lang: "pt-br" }`) com tamanho e SHA-256 fixos, e as vozes "Alex · neural, masculina" (`pm_alex`, 43), "Santa · neural, masculina" (`pm_santa`, 44), "Dora · neural, feminina" (`pf_dora`, 42) e "George · neural, sotaque britânico" (`bm_george`, 26). O gênero foi dado pelo tom medido (masculino ~100–155 Hz, feminino ~200 Hz).

### Download e extração (`src-tauri/src/speech.rs`, `src-tauri/src/lib.rs`)

O mesmo caminho das vozes Piper.

- **Comportamento:**
  - **RF-002**: `speech_download("kokoro")` DEVE baixar por `fetch_verified` (`.part`, tamanho e SHA-256), extrair em `tts\`, apagar o pacote e gravar `.ready`; sem `.ready`, `synthesize` devolve `voice-missing`.

### Síntese (`src-tauri/src/speech.rs`, `Speaker`)

Gera a frase com o falante escolhido.

- **Comportamento:**
  - **RF-003**: O modelo DEVE ser montado como Kokoro: `model.int8.onnx`, `voices.bin`, `tokens.txt`, `data_dir` = `espeak-ng-data`, `lang` `pt-br` e `length_scale` 1,0, com o `sid` da voz, `silence_scale` 0,2 e `max_num_sentences` 1.
  - **RF-004**: Um só modelo DEVE ficar na memória; ele é mantido entre frases e trocado só quando a voz pede outro pacote. As threads são metade dos núcleos, de 1 a 4, e a velocidade fica entre 0,5 e 2,0.

### Configurações (`src/lib/speech.ts`, `src/components/SettingsPanel.tsx`)

Mostra as vozes neurais junto das Piper.

- **Comportamento:**
  - O `radiogroup` "Voz do JARVIS" lista as quatro vozes neurais depois das Piper, e o cartão mostra o pacote da voz escolhida.
  - Se o pacote não estiver baixado, então "Ouvir exemplo" fica desabilitado com o título "Baixe a voz primeiro".

## Restrições

- **RNF-001**: RTF ≈ 1,1–1,2 no Core 7 150U (2026-10-27): cerca de 1 s por segundo de fala, e pior com mais threads (núcleos E). Por isso as threads param em 4.
- **RNF-002**: 132 MB de download e ~190 MB extraído.
- **RNF-003**: Runtime travado no sherpa-onnx `=1.13.8` com `shared` (a 2.x ignora `lang = "pt-br"`), com as DLLs do sherpa ao lado de todo binário que sintetiza ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).
- **RNF-004**: Offline depois do download; a rede só é usada para o release `tts-models` no GitHub.
- **RNF-005**: Licença Apache-2.0, conferida no `LICENSE` do pacote.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/speech.rs` | Entrada `kokoro` em `MODELS`, as quatro vozes em `VOICES`, `config` (Kokoro) e `Speaker` |
| `src-tauri/src/lib.rs` | `speech_status`, `speech_download`, `speech_synthesize` |
| `src-tauri/src/download.rs` | `fetch_verified` |
| `src/lib/speech.ts` | `voiceReady` e o backend Tauri |
| `src/components/SettingsPanel.tsx` | `SpeechSection` e `ModelCard` |

### Testes

- `cargo test --lib -- speech::` (em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH`): catálogo e falantes de 0 a 53.
- `JARVIS_TTS_DIR=<tts> JARVIS_TTS_OUT=<pasta> JARVIS_TTS_VOICES=pm_alex,pm_santa,pf_dora,bm_george [JARVIS_TTS_THREADS=<n>] cargo test --lib -- --ignored speech_samples --nocapture`: RTF, tom e o que o Whisper ouve; `JARVIS_TTS_THREADS` mostra o efeito das threads.
- `npx playwright test tests/speech.spec.ts`: a seção "Voz do JARVIS" com o backend falso do modo web.

### Atualização e reversão

- **Comando:** trocar `archive`, `size` e `sha256` da entrada `kokoro` em `speech::MODELS`, conferir os `sid` contra a tabela do pacote novo e baixar pelo cartão.
- **Prova:** `cargo test --lib -- speech::` e `speech_samples` com as quatro vozes (o Whisper entende as frases, o tom bate com o rótulo).
- **Sinal de volta:** voz trocada (um `sid` que mudou de dono na tabela), "Não consegui carregar a voz" ou RTF bem acima de 1,2.
- **Reversão:** voltar a entrada ao commit anterior e apagar a pasta nova em `tts\`; a pasta antiga com `.ready` volta a valer.

### Decisões relacionadas

- [ADR-0005 — Voz do JARVIS local com sherpa-onnx fixado em 1.13.8](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)

## Dependências

- [sherpa-onnx](../sherpa-onnx/spec.md): `OfflineTts` (Kokoro), espeak-ng e as DLLs do onnxruntime.
- [archives](../archives/spec.md) e [http](../http/spec.md): extração e download.
- [piper-voices](../piper-voices/spec.md): mesmo catálogo, mesma pasta e mesmo `Speaker`.
- [tts](../../../features/tts/spec.md), [assistant](../../../features/assistant/spec.md), [settings](../../../features/settings/spec.md).
- Sistema: `%LOCALAPPDATA%\dev.jarvis.os\tts` ([persistence](../../../domain/persistence.md)), rede até o GitHub no download.

## Pendências

Nenhuma por enquanto.
