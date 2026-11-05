# Vendor: Vozes Piper pt-BR

As quatro vozes Piper (VITS) em português do Brasil, no pacote int8 do sherpa-onnx, com que o JARVIS fala as respostas; a Miro é a voz padrão.

| | |
|---|---|
| **ID** | `vendor/piper-voices` |
| **Tipo** | Modelo |
| **Status** | Em uso |
| **Versão** | `vits-piper-pt_BR-miro-high-int8.tar.bz2`: 21.341.456 bytes (`pt_BR-miro-high.onnx`, **padrão**) · `vits-piper-pt_BR-cadu-medium-int8.tar.bz2`: 21.135.464 bytes (`pt_BR-cadu-medium.onnx`) · `vits-piper-pt_BR-jeff-medium-int8.tar.bz2`: 21.211.448 bytes (`pt_BR-jeff-medium.onnx`) · `vits-piper-pt_BR-dii-high-int8.tar.bz2`: 21.117.576 bytes (`pt_BR-dii-high.onnx`). Tamanho e SHA-256 fixos em `speech::MODELS`. Extraídos em `%LOCALAPPDATA%\dev.jarvis.os\tts\<pacote sem .tar.bz2>\` com um `.ready`; nesta máquina estão a Miro (37,3 MB extraída, `.onnx` de 19.320.506 bytes) e o Jeff (36,3 MB, `.onnx` de 18.343.851 bytes), ambos a 22.050 Hz |
| **Licença** | Miro: CC-BY-NC-SA-4.0 (do `README.md` do pacote extraído). Jeff: dataset CC0 segundo o `MODEL_CARD`; a licença do modelo ⚠ inferido — confirmar. Cadu e Dii: ⚠ inferido — confirmar (não baixadas aqui) |
| **Fonte** | `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/<pacote>` (`BASE_URL` em `src-tauri/src/speech.rs`); o README da Miro aponta para `huggingface.co/OpenVoiceOS/pipertts_pt-BR_miro` |
| **Onde roda** | processo Rust (`speech_synthesize` em `spawn_blocking`), via sherpa-onnx `OfflineTts` (VITS), na CPU |

## Objetivo

Dar ao JARVIS uma voz neural local em pt-BR rápida o bastante para falar frase a frase sem espera: RTF ≈ 0,25–0,3 no Core 7 150U, cerca de 4 vezes mais rápido que o tempo real ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)). A Miro é a padrão por ser a mais grave (~110 Hz); a Faber caiu por soar ambígua (~160 Hz).

## Não-objetivos

- Só as quatro vozes pt-BR do catálogo: sem pt-PT, sem outras línguas e sem a Faber.
- Não usa o executável do Piper nem o `piper-phonemize`: a fonetização é do espeak-ng do sherpa-onnx 1.13.8, com o `espeak-ng-data` que vem em cada pacote.
- Não lê o `.onnx.json` de cada voz: o sherpa usa só o `.onnx`, o `tokens.txt` e o `espeak-ng-data`.
- Sem streaming dentro da frase (`max_num_sentences` 1, sem callback): a UI pede uma frase por vez.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o catálogo `speech::MODELS` e `speech::VOICES`
- **Quando** `cargo test --lib -- speech::` roda em `src-tauri`
- **Então** `catalog_is_consistent` passa: todo pacote termina em `.tar.bz2` e tem SHA-256 de 64 caracteres, toda voz aponta para um modelo do catálogo e `VOICES[0]` é `miro`.

### Critério 2 (RF-002)

- **Dado** um `.tar.bz2` pequeno com uma pasta `voz/tokens.txt`
- **Quando** `extract` o abre em `tts\`
- **Então** o arquivo aparece em `tts\voz\tokens.txt`, a voz só conta como baixada depois do `.ready` na pasta (teste `extracts_an_archive_and_counts_it_once_ready`).

### Critério 3 (RF-003)

- **Dado** a voz `miro` escolhida sem a pasta pronta
- **Quando** o JARVIS responde
- **Então** `speech_synthesize` devolve `voice-missing`, a resposta fica só em texto e o botão "Ouvir exemplo" fica desabilitado com o título "Baixe a voz primeiro".

### Critério 4 (RF-004)

- **Dado** `speed` 3,0 chegando em `speech_synthesize`
- **Quando** a frase é gerada
- **Então** a síntese usa 2,0 (`clamp(0.5, 2.0)`); pela UI, o controle "Velocidade da voz" nem passa de 1,3.

### Critério 5 (RNF-001)

- **Dado** as vozes Piper baixadas e as DLLs do sherpa em `t/debug/deps`
- **Quando** `JARVIS_TTS_DIR=<tts> JARVIS_TTS_OUT=<pasta> JARVIS_TTS_VOICES=miro,cadu,jeff,dii cargo test --lib -- --ignored speech_samples --nocapture` roda
- **Então** cada linha impressa das vozes Piper mostra RTF de 0,3 ou menos, e a Miro fica perto de 110 Hz.

### Critério 6 (RNF-005)

- **Dado** a pasta `vits-piper-pt_BR-miro-high-int8` extraída
- **Quando** se lê o `README.md` dela
- **Então** a licença é CC BY-NC-SA 4.0, sem uso comercial e com a licença junto em qualquer redistribuição.

## Casos de borda

- **Vazio/nulo:** voz não baixada ou sem rede → `voice-missing` e respostas só em texto; o cartão do modelo mostra "Baixar" e, se o download falhar, "Falha no download: <motivo>".
- **Duplicidade/idempotência:** um segundo `speech_download` do mesmo id durante o download é ignorado (`speech_downloading`). Um pacote republicado com o mesmo nome não é baixado de novo enquanto a pasta tiver `.ready`; é preciso apagar a pasta.
- **Concorrência/corrida:** um modelo carregado por vez, atrás de um `Mutex`: trocar de voz entre Piper e Kokoro, ou entre duas Piper, descarrega o anterior na próxima frase. Enquanto o JARVIS fala, `voice_deafen(true)` impede que a escuta tome a voz dele por comando.
- **Permissões/visibilidade:** as entradas do `.tar.bz2` não escapam de `tts\` (`tar::Archive::unpack`). A Miro é CC BY-NC-SA 4.0 e é a padrão. Sem as DLLs do sherpa ao lado do binário, o `onnxruntime.dll` 1.17 do `System32` derruba o processo.

## Uso no jvOS

### Catálogo de vozes (`src-tauri/src/speech.rs`)

Fixa os quatro pacotes Piper e as vozes que eles oferecem.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE oferecer só os pacotes `piper-miro` ("Piper Miro", "Voz grave e rápida, recomendada"), `piper-cadu`, `piper-jeff` e `piper-dii` ("Leve e rápida"), com tamanho e SHA-256 fixos, e as vozes "Miro · masculina, grave", "Cadu · masculina", "Jeff · masculina" e "Dii · feminina", todas com `sid` 0. A `miro` vem primeiro e é a padrão (`DEFAULT_SPEECH` em `src/lib/speech.ts`).

### Download e extração (`src-tauri/src/speech.rs`, `src-tauri/src/lib.rs`)

Baixa o pacote, confere e extrai uma vez.

- **Comportamento:**
  - **RF-002**: `speech_download` DEVE baixar o `.tar.bz2` por `fetch_verified` (`.part`, tamanho e SHA-256), extrair em `tts\`, apagar o pacote e só então gravar `.ready` na pasta. Uma voz conta como baixada só com o `.ready`. O progresso vai em `speech:progress` e o fim em `speech:done`.
  - Se o pacote vier sem a pasta esperada, então o erro é "O pacote da voz veio sem a pasta esperada"; se a extração falhar, "Falha ao extrair a voz: <motivo>".

### Síntese (`src-tauri/src/speech.rs`, `Speaker`)

Transforma uma frase em WAV.

- **Comportamento:**
  - **RF-003**: Sem a pasta pronta, `synthesize` DEVE devolver `voice-missing`; texto vazio é "Nada para falar", carga que falha é "Não consegui carregar a voz" e geração que falha é "A voz falhou".
  - **RF-004**: O modelo DEVE ser montado como VITS: `model` = `<voz>.onnx`, `tokens.txt`, `data_dir` = `espeak-ng-data`, `noise_scale` 0,667, `noise_scale_w` 0,8, `length_scale` 1,0, `silence_scale` 0,2 e `max_num_sentences` 1. A velocidade fica entre 0,5 e 2,0, e as threads são metade dos núcleos, de 1 a 4.
  - O resultado é um WAV PCM de 16 bits, mono, na taxa do modelo (22.050 Hz nas vozes vistas aqui).

### Configurações e reprodução (`src/lib/speech.ts`, `src/components/SettingsPanel.tsx`)

Escolhe a voz e baixa o pacote.

- **Comportamento:**
  - A seção "Voz do JARVIS" tem "Falar as respostas", o `radiogroup` "Voz do JARVIS", o cartão do pacote da voz escolhida ("Piper Miro · 21 MB" com "Baixar" ou "Baixado"), "Velocidade da voz" (0,8 a 1,3) e "Ouvir exemplo".
  - Se a voz escolhida não estiver baixada, então "Ouvir exemplo" fica desabilitado com o título "Baixe a voz primeiro" (`voiceReady`).

## Restrições

- **RNF-001**: RTF ≈ 0,25–0,3 no Core 7 150U (2026-10-27), com o Whisper entendendo todas as vozes.
- **RNF-002**: ~21 MB por pacote (~84 MB as quatro); extraída, cada voz ocupa ~37 MB, a maior parte no `espeak-ng-data`.
- **RNF-003**: Runtime travado no sherpa-onnx `=1.13.8` com `shared`: a 2.x tirou o espeak-ng e, com ele, o pt-BR ([ADR-0005](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)). As DLLs do sherpa ficam ao lado de todo binário que sintetiza.
- **RNF-004**: Offline depois do download; a rede só é usada para o release `tts-models` do sherpa-onnx no GitHub.
- **RNF-005**: Licença da Miro: CC BY-NC-SA 4.0 (sem uso comercial). O jvOS não redistribui o arquivo: ele é baixado da fonte na máquina do usuário. As outras ⚠ inferido — confirmar.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/speech.rs` | `MODELS`, `VOICES`, `download`, `extract`, `Speaker`, `config` (VITS) e `wav` |
| `src-tauri/src/lib.rs` | `speech_dir` (`tts\`), `speech_status`, `speech_download`, `speech_synthesize`, eventos `speech:*` |
| `src-tauri/src/download.rs` | `fetch_verified`: `.part`, tamanho e SHA-256 |
| `src/lib/speech.ts` | `DEFAULT_SPEECH` (`miro`, velocidade 1), `SPEEDS`, `voiceReady`, backend Tauri |
| `src/components/SettingsPanel.tsx` | `SpeechSection`: vozes, cartão do pacote, velocidade e "Ouvir exemplo" |

### Testes

- `cargo test --lib -- speech::` (em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH`): catálogo, WAV de 16 bits e extração com `.ready`.
- `JARVIS_TTS_DIR=<tts> JARVIS_TTS_OUT=<pasta> [JARVIS_TTS_VOICES=miro,cadu,jeff,dii] [JARVIS_WHISPER=<ggml>] cargo test --lib -- --ignored speech_samples --nocapture`: salva os WAVs e imprime RTF, tom e o que o Whisper ouve. Precisa das DLLs do sherpa em `t/debug/deps`.
- `npx playwright test tests/speech.spec.ts`: frase a frase, Esc, voz desligada e "Voz do JARVIS", com o backend falso do modo web.

### Atualização e reversão

- **Comando:** trocar `archive`, `size`, `sha256` (e `onnx`, se o nome mudar) da voz em `speech::MODELS` e baixar pelo cartão em "Voz do JARVIS". Um pacote de outro nome cria outra pasta; a antiga fica em `tts\` até ser apagada.
- **Prova:** `cargo test --lib -- speech::`, `speech_samples` (RTF de 0,3 ou menos, o Whisper entende as três frases) e `npx playwright test tests/speech.spec.ts`.
- **Sinal de volta:** "Não consegui carregar a voz", RTF acima de 0,3, tom diferente do rótulo ou frases que o Whisper não entende.
- **Reversão:** voltar a entrada ao commit anterior e apagar a pasta nova em `tts\`. Se a pasta antiga ainda tiver o `.ready`, ela volta a valer sem download.

### Decisões relacionadas

- [ADR-0005 — Voz do JARVIS local com sherpa-onnx fixado em 1.13.8](../../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)

## Dependências

- [sherpa-onnx](../sherpa-onnx/spec.md): `OfflineTts` (VITS), espeak-ng e as DLLs do onnxruntime.
- [archives](../archives/spec.md): `tar`, `bzip2` e `sha2`. [http](../http/spec.md): `ureq` no download.
- [kokoro](../kokoro/spec.md): mesmo catálogo, mesma pasta e mesmo `Speaker`.
- [tts](../../../features/tts/spec.md), [assistant](../../../features/assistant/spec.md) (respostas faladas), [voice-engine](../../../features/voice-engine/spec.md) (`voice_deafen`), [settings](../../../features/settings/spec.md).
- Sistema: `%LOCALAPPDATA%\dev.jarvis.os\tts` ([persistence](../../../domain/persistence.md)), rede até o GitHub no download.

## Pendências

- [ ] A voz padrão (`miro` em `src-tauri/src/speech.rs` e `DEFAULT_SPEECH` em `src/lib/speech.ts`) é CC BY-NC-SA 4.0: um uso comercial do jvOS exige trocar a padrão.
- [ ] Sem arquivo local que confirme a licença dos modelos Jeff, Cadu e Dii.
