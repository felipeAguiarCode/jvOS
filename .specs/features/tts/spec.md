# Feature Specification: JARVIS Voice (Text-to-Speech)

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/tts` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Reescrita em 2026-11-05 no formato Feature Specification; sem decisões em aberto |
| Source Commit | `750ebd0` (2026-10-27); em `e7151cf` (2026-11-05) só o teste ignorado `speech_samples` mudou, para o `Transcriber::load` com dispositivo |
| Uncommitted Changes | Nenhuma |
| Voice Shortcut | — |
| Assistant Tool | — |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web) não há voz e as respostas ficam só em texto, salvo o fake silencioso `window.__JARVIS_SPEECH__` em DEV |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-05 |
| Verification Scope | Conferida com o código em 2026-11-05: `src-tauri/src/speech.rs`, `src-tauri/src/download.rs`, `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/speech.ts`, `src/lib/storage.ts`, `src/components/JarvisReply.tsx`, `src/components/SettingsPanel.tsx`, `src/hooks/useAssistant.ts`, `src/lib/commands.ts`, `src/App.tsx`, `tests/speech.spec.ts` e o ADR-0005. Os testes não foram executados nesta revisão |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os identificadores US1–US4, RF-001–RF-008, RNF-001–RNF-003, SC-001–SC-003 e T001–T021 são os mesmos da versão anterior. Os critérios de aceite AC-001–AC-010 são os antigos "Critério 1" a "Critério 10", na mesma ordem. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

O JARVIS fala as próprias respostas com uma voz neural que roda na máquina, sem nuvem. A síntese usa o sherpa-onnx com vozes Piper (pt-BR) ou com o Kokoro multilíngue. O usuário escolhe a voz e a velocidade em Configurações → Voz do JARVIS e baixa o modelo uma vez, como no Whisper.

A resposta é falada frase por frase: enquanto uma toca, a próxima já está sendo sintetizada, e o texto em letras grandes aparece no ritmo da fala. Enquanto ele fala, os modos de escuta ficam surdos para não tomar a voz dele por comando. A exibição das respostas é da spec [assistant](../assistant/spec.md); a persona, de [jarvis-persona](../../domain/jarvis-persona.md).

| Input | Expected Behavior | Execution Path |
|---|---|---|
| Uma resposta do JARVIS (do Claude ou local), com a voz ligada | Cada página é sintetizada em ordem e tocada; as palavras aparecem durante a fala | `JarvisReply` → `SpeechPlayer` → `speech_synthesize` (Rust) → Web Audio |
| Esc com a resposta na tela | O áudio para na hora e a escuta volta | `useAssistant` (cancelar ou dispensar) → `SpeechPlayer.close` |
| "Falar as respostas" desligado | Nada é sintetizado; o texto segue o próprio ritmo | `JarvisReply` sem voz |
| "Ouvir exemplo" | "Às suas ordens. É assim que eu soo agora." na voz escolhida | `previewVoice` |
| "Baixar" no cartão da voz | Download verificado, extração e marcador `.ready` | `speech_download` (Rust) |

## Goals and Success Criteria

### Goals

- Dar voz ao JARVIS sem nuvem e sem chave de API.
- Começar a falar logo: a próxima frase fica pronta antes de a atual terminar.
- Mostrar o texto no ritmo da fala.
- Nunca deixar a voz dele virar um comando.
- Calar na hora, com Esc.
- Deixar o usuário escolher voz e velocidade, e ouvir um exemplo.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Com uma voz Piper, sintetizar uma frase leva cerca de um quarto da duração dela na CPU de referência, então a próxima frase fica pronta antes de a atual terminar. | `speech_samples` (ignorado) imprime o RTF de cada voz; medido RTF ≈ 0,25–0,3 no Core 7 150U ([ADR-0005](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)). |
| SC-002 | O JARVIS nunca dispara um comando com a própria voz. | `tests/speech.spec.ts` — "each sentence is spoken, and stays on screen as long as JARVIS says it" confere `deafen(true)` durante a fala; o motor zera a VAD com `deaf` ([voice-engine](../voice-engine/spec.md)). Ver KL-003. |
| SC-003 | Esc silencia na hora e devolve a escuta. | `tests/speech.spec.ts` — "Esc silences him at once". Ver KL-003. |

## Scope and Non-Goals

### In Scope

- Catálogo de 5 modelos e 8 vozes, download verificado e extração.
- Síntese no Rust (um modelo em memória), WAV mono de 16 bits.
- Reprodução em ordem, com preparo adiantado, `AnalyserNode` para o holograma e surdez do motor de voz.
- Sincronia das palavras com a duração da fala no `JarvisReply`.
- Seção "Voz do JARVIS" nas Configurações e o comando da busca para silenciar.

### Out of Scope

- Vozes de outros idiomas além das listadas; o Kokoro só com `lang = "pt-br"` (e a voz `bm_george`, com sotaque britânico).
- Atualizar o sherpa-onnx para a 2.x: ela perdeu o espeak-ng e, com ele, o pt-BR; a dependência fica em `=1.13.8` ([ADR-0005](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).
- Falar no navegador fora dos testes.
- O layout das respostas no núcleo: [assistant](../assistant/spec.md).

## User Stories

### US1 — Hear the Answer

**Priority:** P1.

**User Story:** Como usuário, ouço o JARVIS dizer a resposta enquanto as palavras aparecem no núcleo.

**Why This Priority:** é o que faz dele um assistente de voz.

**Independent Test:** `tests/speech.spec.ts` — "each sentence is spoken, and stays on screen as long as JARVIS says it".

**Acceptance Criteria:** AC-001, AC-002 e AC-003.

### US2 — Silence JARVIS

**Priority:** P1.

**User Story:** Como usuário, aperto Esc e ele para de falar na hora.

**Why This Priority:** uma voz que não para é intolerável.

**Independent Test:** `tests/speech.spec.ts` — "Esc silences him at once".

**Acceptance Criteria:** AC-004.

### US3 — No Voice

**Priority:** P2.

**User Story:** Como usuário, desligo "Falar as respostas" e leio o texto no ritmo próprio.

**Why This Priority:** em reunião ou à noite, a voz atrapalha.

**Independent Test:** `tests/speech.spec.ts` — "with the voice off nothing is spoken and the text keeps its own pace".

**Acceptance Criteria:** AC-005 e AC-006.

### US4 — Choose the Voice

**Priority:** P2.

**User Story:** Como usuário, escolho entre oito vozes, ajusto a velocidade e ouço um exemplo.

**Why This Priority:** a voz é a identidade do JARVIS.

**Independent Test:** `tests/speech.spec.ts` — "Settings › Voz do JARVIS: the voice, its pace, a sample, on and off".

**Acceptance Criteria:** AC-007, AC-008, AC-009 e AC-010.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | O sistema DEVE oferecer 5 modelos fixos (Piper Miro, Cadu, Jeff, Dii e Kokoro int8 multi-lang v1.0) e 8 vozes; a padrão é `miro`. | US4 |
| RF-002 | O download DEVE conferir tamanho e SHA-256, extrair o `.tar.bz2` em `tts\<pasta>` e só então gravar o marcador `.ready`. | US4 |
| RF-003 | Um modelo DEVE contar como baixado somente com `.ready` presente. | US4 |
| RF-004 | `speech_synthesize` DEVE devolver um WAV PCM 16-bit mono como resposta binária. | US1 |
| RF-005 | A UI DEVE sintetizar as frases em ordem, uma por vez, preparando as próximas enquanto a atual toca. | US1 |
| RF-006 | Durante a fala, o sistema DEVE chamar `voice_deafen(true)` e, 400 ms após o fim, `voice_deafen(false)`. | US1, US2 |
| RF-007 | A voz DEVE alimentar um `AnalyserNode` para o holograma seguir a fala do JARVIS. | US1 |
| RF-008 | A velocidade DEVE ficar entre 0,8 e 1,3 na UI (o Rust aceita 0,5–2,0). | US4 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | Offline; só o download do modelo usa a rede (releases `tts-models` do k2-fsa/sherpa-onnx). | Síntese e reprodução. |
| RNF-002 | Desempenho medido no Core 7 150U: Piper com RTF ~0,25–0,3; Kokoro ~1,1–1,2 (cerca de 1 s por segundo de fala), que piora com mais threads. | CPU de referência ([ADR-0005](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)). |
| RNF-003 | Síntese com metade dos processadores lógicos, limitada a 1–4 threads. | `Speaker::default`. |

### Operational Constraints

- Um modelo em memória por vez.
- Threads: metade de `available_parallelism`, entre 1 e 4.
- Velocidade: 0,8–1,3 na UI, em passos de 0,05; o Rust limita a 0,5–2,0.
- `max_num_sentences` 1 e `silence_scale` 0,2.
- Surdez: até 400 ms depois do fim de cada frase (`DEAF_TAIL_MS`).
- Guarda contra áudio travado: duração da frase + 1,5 s.
- Página: até 14 palavras; uma frase com menos de 4 palavras divide a página com a seguinte.
- Palavras faladas: passo de 85% da duração dividido pelas palavras, entre 90 e 400 ms; a página fica até o fim da fala + 250 ms (`SPOKEN_GAP_MS`).
- Sem voz: uma palavra a cada 170 ms (`WORD_MS`).
- Preferências gravadas com debounce de 250 ms.

## Acceptance Criteria

### AC-001 — Sentences Spoken in Order

**Related Story:** US1.

- **Given** uma resposta com duas frases
- **When** ela chega
- **Then** cada frase é sintetizada em ordem, uma de cada vez.

### AC-002 — Words Follow the Speech

**Related Story:** US1.

- **Given** uma frase sendo falada
- **When** olho o núcleo
- **Then** as palavras surgem espalhadas pela duração da fala, e a página fica até ele terminar de falar + 250 ms.

### AC-003 — Deaf While Speaking

**Related Story:** US1.

- **Given** que ele começou a falar
- **When** o microfone de escuta está aberto
- **Then** o motor fica surdo (`voice_deafen(true)`) e volta a ouvir 400 ms depois da última palavra de cada frase, se a próxima não começar antes.

### AC-004 — Esc Silences

**Related Story:** US2.

- **Given** o JARVIS falando
- **When** aperto Esc
- **Then** o áudio para, a resposta some em até 2 s e a escuta volta (`deafen(false)`).

### AC-005 — Voice Off

**Related Story:** US3.

- **Given** a voz desligada
- **When** chega uma resposta
- **Then** nada é sintetizado e as palavras entram no ritmo do texto (uma a cada 170 ms).

### AC-006 — Failed Sentence Falls Back to Text

**Related Story:** US3.

- **Given** uma frase que falhou ao sintetizar ou tocar
- **When** chega a vez dela
- **Then** a página fica `silent` e segue o ritmo do texto, sem travar.

**Coverage Status:** sem teste automatizado (KL-004).

### AC-007 — Default Voice

**Related Story:** US4.

- **Given** uma instalação nova
- **When** abro Voz do JARVIS
- **Then** "Miro · masculina, grave" está marcada.

### AC-008 — Voice Sample

**Related Story:** US4.

- **Given** outra voz escolhida
- **When** clico "Ouvir exemplo"
- **Then** ele diz "Às suas ordens. É assim que eu soo agora.".

### AC-009 — Sample Needs the Model

**Related Story:** US4.

- **Given** a voz cujo modelo não foi baixado
- **When** olho "Ouvir exemplo"
- **Then** o botão está desabilitado (dica "Baixe a voz primeiro") e o cartão do modelo oferece o download.

**Coverage Status:** sem teste automatizado (KL-004).

### AC-010 — Preferences Persist

**Related Story:** US4.

- **Given** uma mudança
- **When** recarrego
- **Then** voz, velocidade e liga/desliga persistem em `jarvis.speech`.

## Behavior and Flows

### Catalog (`speech.rs`)

| Model | Label | Description | Archive | Size | Kind |
|---|---|---|---|---|---|
| `piper-miro` | "Piper Miro" | "Voz grave e rápida, recomendada" | `vits-piper-pt_BR-miro-high-int8.tar.bz2` | 21.341.456 bytes | Piper (`pt_BR-miro-high.onnx`) |
| `piper-cadu` | "Piper Cadu" | "Leve e rápida" | `vits-piper-pt_BR-cadu-medium-int8.tar.bz2` | 21.135.464 bytes | Piper |
| `piper-jeff` | "Piper Jeff" | "Leve e rápida" | `vits-piper-pt_BR-jeff-medium-int8.tar.bz2` | 21.211.448 bytes | Piper |
| `piper-dii` | "Piper Dii" | "Leve e rápida" | `vits-piper-pt_BR-dii-high-int8.tar.bz2` | 21.117.576 bytes | Piper |
| `kokoro` | "Kokoro (neural)" | "Mais natural, mas leva cerca de 1 s por segundo de fala" | `kokoro-int8-multi-lang-v1_0.tar.bz2` | 132.353.410 bytes | Kokoro (`lang` "pt-br") |

| Voice | Label | Model | Speaker (`sid`) |
|---|---|---|---|
| `miro` | "Miro · masculina, grave" | `piper-miro` | 0 |
| `cadu` | "Cadu · masculina" | `piper-cadu` | 0 |
| `jeff` | "Jeff · masculina" | `piper-jeff` | 0 |
| `dii` | "Dii · feminina" | `piper-dii` | 0 |
| `pm_alex` | "Alex · neural, masculina" | `kokoro` | 43 |
| `pm_santa` | "Santa · neural, masculina" | `kokoro` | 44 |
| `pf_dora` | "Dora · neural, feminina" | `kokoro` | 42 |
| `bm_george` | "George · neural, sotaque britânico" | `kokoro` | 26 |

Cada modelo tem SHA-256 fixo (RF-001). A primeira voz do catálogo é a padrão da UI.

### Download and Extraction

- `speech_download` acha o modelo ("Voz desconhecida" se o id não existe) e ignora um download que já está rodando.
- O arquivo vem de `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/<arquivo>` por `fetch_verified`, o mesmo do Whisper: `.part`, tamanho e SHA-256 conferidos (RF-002).
- O `.tar.bz2` é extraído em `tts\` (as entradas não escapam da pasta) e apagado. Sem a pasta esperada, o erro é "O pacote da voz veio sem a pasta esperada"; uma extração com erro é "Falha ao extrair a voz: …".
- Só no fim é gravado o marcador vazio `tts\<pasta>\.ready` (RF-003). Uma extração interrompida não grava `.ready`, e o download pode ser refeito.
- O progresso sai em `speech:progress` e o fim em `speech:done`, que faz `useSpeechStatus` recarregar o status e guardar o erro, se houver.

### Synthesis (`Speaker`)

Mantém um `OfflineTts` carregado e transforma uma frase num WAV.

- Ordem das verificações: voz desconhecida → "Voz desconhecida"; modelo não baixado → `voice-missing`; texto vazio (depois de aparado) → "Nada para falar".
- Mantém um só modelo em memória. Uma voz de outro modelo troca o `OfflineTts`; uma voz do mesmo modelo não recarrega. Falha ao carregar: "Não consegui carregar a voz". Falha ao gerar: "A voz falhou".
- `speech_synthesize` roda a síntese fora da thread da UI (`blocking`) e devolve os bytes do WAV como `ipc::Response` binária (RF-004), na taxa que o modelo der.

### sherpa-onnx Configuration

- Piper (VITS): `model` = o `.onnx` do modelo, `tokens.txt`, `espeak-ng-data`, `noise_scale` 0,667, `noise_scale_w` 0,8, `length_scale` 1.
- Kokoro: `model.int8.onnx`, `voices.bin`, `tokens.txt`, `espeak-ng-data`, `lang` "pt-br", `length_scale` 1; falantes `pm_alex` 43, `pm_santa` 44, `pf_dora` 42, `bm_george` 26.
- `max_num_sentences` 1 e `silence_scale` 0,2; velocidade limitada a 0,5–2,0; o `espeak-ng-data` de cada modelo faz a fonetização do português.

### `SpeechPlayer`

Na UI, pede as frases ao Rust, toca o áudio e controla a surdez do motor de voz.

- `prepare(n, texto)` enfileira a síntese: uma de cada vez, na ordem (RF-005). `ready(n)` devolve o áudio decodificado, ou nulo se falhou.
- O WAV é decodificado com Web Audio e tocado por um `AnalyserNode` (FFT 1024), que o `App` passa ao holograma por `setVoiceSource` (RF-007).
- `play` liga `deafen(true)` ao começar e, no fim de cada frase, agenda `deafen(false)` para 400 ms depois (RF-006); uma frase nova cancela o agendamento.
- Se a WebView bloquear o áudio (sem gesto do usuário), `play` devolve nulo e a página segue no ritmo do texto.
- Se o áudio travar, uma guarda encerra a frase em duração + 1,5 s.
- `close` para o áudio na hora, chama `deafen(false)` se uma frase estava tocando, solta o analisador e fecha o `AudioContext`. É chamado ao cancelar ou desmontar a resposta (KL-003).

### Speech in `JarvisReply`

Decide o que falar de uma resposta e sincroniza as palavras com o áudio. O layout da resposta é da spec [assistant](../assistant/spec.md).

- Só fala quando `replyVoice` existe: "Falar as respostas" ligado e a voz pronta (`voiceReady`, o modelo dela baixado). A voz é lida quando a resposta começa; mudar depois só vale para a próxima.
- Cada página completa é preparada adiante (`prepare`), e a página atual começa a falar quando a voz dela fica pronta (`ready`). Enquanto isso, o núcleo mostra os três pontos.
- As palavras da página se espalham pela duração da fala: o passo é 85% da duração dividido pelas palavras, entre 90 e 400 ms. Com movimento reduzido, entram todas de uma vez.
- A página fica até ele terminar de falar + 250 ms (`SPOKEN_GAP_MS`) e sai sem o som de "glitch" (a voz é o som).
- Sem voz, as palavras entram no ritmo do texto, uma a cada 170 ms (`WORD_MS`), e a página fica 1,1 s + 230 ms por palavra.
- Se a síntese ou o áudio de uma página falharem, a página fica `silent` e volta ao ritmo do texto (AC-006).

### `SpeechSection` (Configurações → Voz do JARVIS)

A voz, a velocidade, o modelo e um exemplo para ouvir.

- **Behavior:**
  - "Falar as respostas" liga ou desliga `$prefs.enabled`. A dica é "Voz neural local: as frases aparecem no ritmo da fala" no app e "Disponível no app desktop" fora dele.
  - Clicar numa voz a torna `$prefs.voice`. Numa instalação nova, "Miro · masculina, grave" está marcada.
  - Mostra só o cartão do modelo da voz escolhida, o mesmo `ModelCard` do Whisper ([voice-engine](../voice-engine/spec.md)), com o download e o progresso.
  - RF-008: o controle "Velocidade da voz" anda em passos de 0,05 entre 0,8 e 1,3 e mostra o valor com duas casas ("1.00×").
  - "Ouvir exemplo" diz "Às suas ordens. É assim que eu soo agora." (`previewVoice`). Sem o modelo da voz, o botão fica desabilitado, com a dica "Baixe a voz primeiro". Se a fala falhar, a dock diz "Não consegui falar com esta voz" (erro).
- **Layout:**
  - De cima para baixo: o `SwitchRow` "Falar as respostas"; um `radiogroup` "Voz do JARVIS" com as vozes em duas colunas; o cartão do modelo; o rótulo "Velocidade" com o valor à direita e o controle deslizante; e o botão "Ouvir exemplo" na largura toda.
- **Style:**
  - Cada voz é um botão `rounded-xl border px-3 py-2 text-xs`. A escolhida fica em `border-hud-cyan/40 bg-hud-cyan/[0.06] text-hud-light`; as outras em `border-hud-cyan/12 bg-white/[0.02] text-hud-text/75`.
  - O rótulo "Velocidade" fica em `text-xs text-hud-text/60`, o valor em `text-hud-text/80` e o controle usa `hud-range`.
  - "Ouvir exemplo" tem borda `hud-cyan/25`, texto em maiúsculas `tracking-[0.16em]` com o ícone `Volume2`, e fica com opacidade 40% quando desabilitado.

### Interaction Flow

```mermaid
sequenceDiagram
  participant J as JarvisReply
  participant P as SpeechPlayer
  participant R as Rust (speech.rs)
  participant V as Motor de voz
  J->>P: prepare(página n) (para cada página completa)
  P->>R: speech_synthesize(texto, voz, velocidade)
  R-->>P: WAV
  J->>P: ready(n) → play(buffer)
  P->>V: voice_deafen(true)
  P-->>J: { duration, ended }
  J->>J: palavras espalhadas pela duração
  P->>V: voice_deafen(false) 400 ms após o fim
```

### User Feedback

| Moment | Persona Key | Output |
|---|---|---|
| Resposta com voz | — (o texto é da resposta) | Áudio, palavras no ritmo da fala e o holograma seguindo a voz |
| Resposta sem voz, ou frase que falhou | — | Palavras a cada 170 ms, sem áudio |
| "Ouvir exemplo" | — | "Às suas ordens. É assim que eu soo agora." |
| Exemplo que falhou | — | Dock "Não consegui falar com esta voz" (erro) |
| Download de voz com erro | — | O erro no cartão do modelo |

### Voice and Keyboard

- `Esc` com resposta na tela: cancela uma resposta em andamento ou dispensa a que terminou; nos dois casos a fala para (`SpeechPlayer.close`).
- Busca `/` → "Silenciar o JARVIS" / "Ligar a voz do JARVIS" (grupo "Voz", "Ele fala as respostas"): `toggleSpeaking` inverte `enabled` (comando `speaking` em `src/lib/commands.ts`).

## Data Model and Persistence

### Speech Preferences

```ts
interface SpeechPrefs {
  enabled: boolean; // padrão true
  voice: string;    // padrão "miro"
  speed: number;    // padrão 1; 0,8–1,3
}
```

### Speech Status

```ts
/** Mirrors `speech::ModelStatus` in Rust. */
interface SpeechModel { id: string; label: string; description: string; size: number; downloaded: boolean; downloading: boolean }
interface SpeechVoice { id: string; label: string; model: string } // o `sid` fica só no Rust
interface SpeechStatus { models: SpeechModel[]; voices: SpeechVoice[] }
```

Ver o [glossário](../../domain/glossary.md).

### Storage Rules

| Property | Value |
|---|---|
| State | `$prefs` |
| Storage | `localStorage` |
| Key | `jarvis.speech` |
| Write Debounce | 250 ms (`useStoredState`) |
| Reader | `parseSpeech`: campo a campo; `enabled` não booleano e `voice` vazia ou não texto voltam ao padrão; velocidade não numérica volta a 1 e fora da faixa é limitada a 0,8–1,3 |
| Missing or Invalid Storage | `{ enabled: true, voice: "miro", speed: 1 }` |

### Model Files

| Item | Location | Rule |
|---|---|---|
| Modelo extraído | `%LOCALAPPDATA%\dev.jarvis.os\tts\<pasta>\` | A pasta é o nome do arquivo sem `.tar.bz2` |
| Marcador | `tts\<pasta>\.ready` | Vazio; gravado só depois de extrair; é o que conta como baixado |
| Arquivo baixado | `tts\<arquivo>.tar.bz2` (e o `.part` durante o download) | Apagado depois da extração |

Ver [persistência](../../domain/persistence.md).

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src-tauri/src/speech.rs` | `MODELS`, `VOICES`, `find_model`, `find_voice`, `download`/`extract`, `Speaker::synthesize`, `config`, `wav`, `MISSING` |
| `src-tauri/src/download.rs` | `fetch_verified` (compartilhado com o Whisper) |
| `src-tauri/src/lib.rs` | `speech_status`, `speech_download`, `speech_synthesize`, `voice_deafen`; `speaker`, `speech_dir` e `speech_downloading` no `AppState` |
| `src/lib/speech.ts` | Backends (Tauri e fake), `useSpeechPrefs`, `useSpeechStatus`, `voiceReady`, `SpeechPlayer`, `createSpeechPlayer` |
| `src/components/JarvisReply.tsx` | Prepara as páginas completas, `speak(page)`, palavras sobre a duração (passo de 90–400 ms), espera de 250 ms, página `silent` |
| `src/components/SettingsPanel.tsx` | `SpeechSection`: "Falar as respostas", vozes, cartão do modelo, "Velocidade da voz", "Ouvir exemplo" |
| `src/App.tsx` | `replyVoice`, `previewVoice`, `setVoiceSource` do `useAudioAnalyzer`, `toggleSpeaking` |

### Related Architecture Decisions

- [ADR-0005 — TTS sherpa-onnx fixado em 1.13.8](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)
- [ADR-0010 — settings.json vs localStorage](../../arch/adr/0010-persistencia-settings-vs-localstorage.md)
- [ADR-0011 — fakes de dev e E2E modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)

## Interfaces and Contracts

### Tauri Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `speech_status` | — | `{ models: SpeechModel[], voices: SpeechVoice[] }` | `downloaded` = `.ready` presente |
| `speech_download` | `{ id }` (id do modelo) | — | Em segundo plano; repetido é ignorado; erro "Voz desconhecida" |
| `speech_synthesize` | `{ text, voice, speed }` | WAV (`ArrayBuffer`) | Erros "Voz desconhecida", `voice-missing`, "Nada para falar", "Não consegui carregar a voz", "A voz falhou" |
| `voice_deafen` | `{ on }` | — | Liga ou desliga a surdez do [motor de voz](../voice-engine/spec.md); a UI ignora erros |

A UI não trata `voice-missing` por nome: ela só pede uma fala quando `voiceReady` é verdadeiro.

### Events and Channels

| Event | Payload | Producer → Consumer |
|---|---|---|
| `speech:progress` | `{ id, received, total }` | thread de download → `useSpeechStatus` |
| `speech:done` | `{ id, error }` | thread de download → `useSpeechStatus` (recarrega o status) |

### Development Fake

Só em DEV, `window.__JARVIS_SPEECH__` (verdadeiro, ou `{ msPerWord, fail }`) troca o backend por uma voz falsa e silenciosa: duas vozes ("Miro · masculina, grave" e "Dii · feminina") num modelo já baixado, um WAV de silêncio proporcional às palavras (250 ms por palavra por padrão) e, em `window.__JARVIS_SPEECH_LOG__`, os textos pedidos e as chamadas de `deafen` ([ADR-0011](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)).

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| Texto vazio | "Nada para falar" | Synthesis |
| Modelo da voz não baixado | As respostas ficam só em texto e "Ouvir exemplo" fica desabilitado ("Baixe a voz primeiro"); o Rust devolveria `voice-missing` | AC-009 |
| Voz salva que não existe no catálogo | Nenhuma voz marcada, nenhum cartão, respostas só em texto | `parseSpeech`, `voiceReady` |
| `jarvis.speech` ausente ou inválido | `parseSpeech` valida campo a campo e volta ao padrão `{ true, "miro", 1 }`; velocidade fora da faixa é limitada a 0,8–1,3 | Storage Rules |
| `speech_download` repetido durante o download | Ignorado | Download and Extraction |
| Extração interrompida | Sem `.ready`: não conta como baixado e pode ser refeita | RF-003 |
| Voz do mesmo modelo já carregado | Não recarrega; só uma voz de outro modelo troca o `OfflineTts` | Synthesis |
| Concorrência entre frases | Sintetizadas em ordem, uma por vez; a próxima é preparada enquanto a atual toca | RF-005 |
| Esc durante a fala | `close` para o áudio na hora e devolve a escuta | AC-004 |
| Esc nos 400 ms depois do fim de uma frase, ou "Ouvir exemplo" terminado | A escuta não volta: o motor fica surdo até o JARVIS falar de novo | KL-003 |
| Áudio travado | A guarda encerra a frase em duração + 1,5 s | `SpeechPlayer` |
| Logo depois da última palavra | O motor continua surdo por 400 ms (`DEAF_TAIL_MS`) | RF-006 |
| Permissões: a WebView bloqueia o áudio sem gesto do usuário | `play` devolve nulo e a página segue no ritmo do texto | AC-006 |
| Rede | Só para baixar os modelos | RNF-001 |
| Sem as DLLs do sherpa ao lado do executável | O Windows carrega o `onnxruntime.dll` 1.17 de System32 e o app quebra | KL-001 |
| Fora do Tauri | Sem voz; com `__JARVIS_SPEECH__` em DEV, a voz falsa | Development Fake |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [voice-engine](../voice-engine/spec.md) | A surdez por `voice_deafen`, o `fetch_verified` e o `ModelCard` |
| [assistant](../assistant/spec.md) | O `JarvisReply` e as respostas que são faladas |
| [holographic-core](../holographic-core/spec.md) | Segue a voz pelo `AnalyserNode` |
| [settings](../settings/spec.md) | A seção "Voz do JARVIS" |
| [search](../search/spec.md) | O comando `speaking` |
| [dock-taskbar](../dock-taskbar/spec.md) | O aviso quando o exemplo falha |

### Runtime Dependencies

- [sherpa-onnx](../../foundation/vendor/sherpa-onnx/spec.md) (`=1.13.8`, feature `shared`), [vozes Piper](../../foundation/vendor/piper-voices/spec.md), [Kokoro](../../foundation/vendor/kokoro/spec.md).
- [archives](../../foundation/vendor/archives/spec.md) (`tar`, `bzip2`, `sha2`), [HTTP](../../foundation/vendor/http/spec.md) (`ureq` em `fetch_verified`), [serde](../../foundation/vendor/serde/spec.md), [Tauri](../../foundation/vendor/tauri/spec.md).
- [React](../../foundation/vendor/react/spec.md), [motion](../../foundation/vendor/motion/spec.md) (`useReducedMotion` no `JarvisReply`), [lucide](../../foundation/vendor/lucide/spec.md), [Tailwind](../../foundation/vendor/tailwind/spec.md).
- Web Audio da WebView2; a rede para baixar os modelos; as DLLs do sherpa (`sherpa-onnx-c-api.dll`, `onnxruntime.dll`, `onnxruntime_providers_shared.dll`) ao lado de `jarvis.exe`; o `espeak-ng-data` de cada modelo.

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/speech.spec.ts` — "each sentence is spoken, and stays on screen as long as JARVIS says it" | As duas frases faladas em ordem, a primeira página na tela pela duração da fala (mais de 8,5 s), `deafen(true)` no começo e `false` no fim | AC-001–AC-003, SC-002 |
| `tests/speech.spec.ts` — "Esc silences him at once" | Esc some com a resposta em até 2 s e devolve a escuta | AC-004, SC-003 |
| `tests/speech.spec.ts` — "with the voice off nothing is spoken and the text keeps its own pace" | Nada é sintetizado e as 14 palavras entram no ritmo do texto | AC-005 |
| `tests/speech.spec.ts` — "Settings › Voz do JARVIS: the voice, its pace, a sample, on and off" | "Miro · masculina, grave" por padrão, "Ouvir exemplo" com a frase de exemplo, voz e liga/desliga gravados em `jarvis.speech` | AC-007, AC-008, AC-010 |
| `src-tauri/src/speech.rs` — `catalog_is_consistent`, `writes_a_playable_wav`, `extracts_an_archive_and_counts_it_once_ready` | Catálogo consistente (SHA-256, `.tar.bz2`, `miro` primeiro, falantes do Kokoro), WAV 16-bit mono tocável e a extração que só conta com `.ready` | RF-001–RF-004 |
| `src-tauri/src/speech.rs` (ignorado) — `speech_samples` | Sintetiza cada voz, mede o RTF e o tom e transcreve com o Whisper | RNF-002, SC-001 |

### Verification Commands

Na raiz do repositório:

```powershell
npx playwright test tests/speech.spec.ts --project ui -g "each sentence is spoken"
npx playwright test tests/speech.spec.ts --project ui -g "Esc silences him"
npx playwright test tests/speech.spec.ts --project ui -g "with the voice off"
npx playwright test tests/speech.spec.ts --project ui -g "Voz do JARVIS"
```

Em `src-tauri`:

```powershell
cargo test --lib speech::tests
cargo test --lib -- --ignored speech_samples --nocapture
```

O segundo é opt-in: precisa de `JARVIS_TTS_DIR`, `JARVIS_TTS_OUT` e, opcional, `JARVIS_WHISPER` (`JARVIS_TTS_VOICES` e `JARVIS_TTS_THREADS` filtram), dos modelos e das DLLs do sherpa em `t/debug/deps` (KL-002).

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| Página `silent` depois de uma falha (AC-006) | Sem teste; o fake já tem a opção `fail` | `__JARVIS_SPEECH__ = { fail: true }` e conferir as palavras a cada 170 ms |
| "Baixe a voz primeiro" (AC-009) | Sem teste | Fake com o modelo não baixado e conferir o botão desabilitado |
| Velocidade gravada (AC-010) | Só voz e liga/desliga são conferidos | Mover "Velocidade da voz" e conferir `speed` em `jarvis.speech` |
| Esc entre duas frases e o fim de "Ouvir exemplo" (KL-003) | Sem teste; o teste do exemplo não confere `deaf` | Conferir `__JARVIS_SPEECH_LOG__.deaf.at(-1)` depois do exemplo e de um Esc logo após a primeira frase |
| DLLs do sherpa no instalador | Não verificado (KL-001) | `npm run tauri build` e rodar o instalador numa máquina limpa |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código e do commit de origem.

### Phase 1 — Foundation

- [x] T001 [P] Dependência `sherpa-onnx = "=1.13.8"` com a feature `shared`, `tar` e `bzip2` — `src-tauri/Cargo.toml`
- [x] T002 [P] Catálogo de 5 modelos (tamanho e SHA-256) e 8 vozes; `find_model`, `find_voice` — `src-tauri/src/speech.rs`
- [x] T003 [P] Download verificado, extração em `tts\<pasta>` e marcador `.ready` — `src-tauri/src/speech.rs`
- [x] T004 `Speaker` (um modelo em memória, 1–4 threads), `config` Piper/Kokoro, `wav` 16-bit mono, `MISSING` — `src-tauri/src/speech.rs`
- [x] T005 Comandos `speech_status`, `speech_download`, `speech_synthesize` (`ipc::Response`), `voice_deafen`; eventos `speech:*` — `src-tauri/src/lib.rs`

### Phase 2 — Hear the Answer (US1)

- [x] T006 [US1] Backends Tauri e fake (`__JARVIS_SPEECH__`, `__JARVIS_SPEECH_LOG__`) — `src/lib/speech.ts`
- [x] T007 [US1] `SpeechPlayer`: fila de síntese em ordem, `AnalyserNode`, `play` com guarda e `deafen` (cauda de 400 ms) — `src/lib/speech.ts`
- [x] T008 [US1] Páginas completas preparadas adiante; palavras sobre a duração; espera de 250 ms — `src/components/JarvisReply.tsx`
- [x] T009 [US1] `replyVoice` (só com voz pronta) e `setVoiceSource` para o holograma — `src/App.tsx`
- [x] T010 [US1] Surdez do motor (`deaf` zera a VAD) — `src-tauri/src/voice/mod.rs`

### Phase 3 — Silence (US2)

- [x] T011 [US2] `SpeechPlayer.close` ao cancelar ou desmontar a resposta, devolvendo a escuta — `src/lib/speech.ts`, `src/components/JarvisReply.tsx`

### Phase 4 — No Voice (US3)

- [x] T012 [US3] Página `silent` volta ao ritmo do texto quando a síntese ou o áudio falham — `src/components/JarvisReply.tsx`

### Phase 5 — Choose the Voice (US4)

- [x] T013 [US4] `useSpeechPrefs` (`jarvis.speech`, `parseSpeech`, `SPEEDS` 0,8–1,3) e `useSpeechStatus` — `src/lib/speech.ts`
- [x] T014 [US4] `SpeechSection`: "Falar as respostas", vozes, cartão do modelo, "Velocidade da voz", "Ouvir exemplo" — `src/components/SettingsPanel.tsx`
- [x] T015 [US4] `previewVoice` ("Às suas ordens. É assim que eu soo agora.") — `src/App.tsx`

### Phase 6 — Verification

- [x] T016 Playwright `tests/speech.spec.ts` — "each sentence is spoken, and stays on screen as long as JARVIS says it"
- [x] T017 Playwright `tests/speech.spec.ts` — "Esc silences him at once"
- [x] T018 Playwright `tests/speech.spec.ts` — "with the voice off nothing is spoken and the text keeps its own pace"
- [x] T019 Playwright `tests/speech.spec.ts` — "Settings › Voz do JARVIS: the voice, its pace, a sample, on and off"
- [x] T020 Rust `src-tauri/src/speech.rs` — `catalog_is_consistent`, `writes_a_playable_wav`, `extracts_an_archive_and_counts_it_once_ready`
- [x] T021 Rust ignorado `src-tauri/src/speech.rs` — `speech_samples` (precisa dos modelos; mede RTF e tom e transcreve com Whisper)

## Rollback Plan

1. Na UI, tire a `SpeechSection` do painel, `replyVoice`, `previewVoice` e `setVoiceSource` do `App`, a fala do `JarvisReply` (que fica só com o ritmo do texto, o caminho sem voz) e o comando `speaking` da busca; depois, `src/lib/speech.ts`.
2. No Rust, tire `speech_status`, `speech_download` e `speech_synthesize` (e o registro no `invoke_handler`), `speaker`, `speech_dir` e `speech_downloading` do `AppState` e `speech.rs`. `voice_deafen` pode ficar: é do motor de voz.
3. Mantenha a dependência `sherpa-onnx` e as DLLs dela: o Silero VAD do [voice-engine](../voice-engine/spec.md) (`voice/silero.rs`) usa o mesmo runtime. `download.rs` (`fetch_verified`) também fica, porque o Whisper o usa.
4. Ficam órfãos e são ignorados: a chave `jarvis.speech` no `localStorage` e os modelos extraídos em `%LOCALAPPDATA%\dev.jarvis.os\tts\`, que podem ser apagados à mão.

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P1 — Offline-first | Atendido | Síntese local; download único verificado |
| P2 — Rust é dono do nativo | Atendido | Modelos, extração e síntese no Rust |
| P3 — Comandos finos | Atendido | `speech_*` em `lib.rs`; síntese via `blocking()`; downloads em thread própria; eventos `speech:*` |
| P4 — Contratos espelhados | Atendido | `SpeechModel` espelha `speech::ModelStatus`; sentinela `voice-missing` |
| P5 — Persistência tolerante | Atendido | `parseSpeech` valida campo a campo e limita a velocidade |
| P6 — Fora do Tauri | Atendido | Fake de DEV `window.__JARVIS_SPEECH__` (WAV de silêncio proporcional às palavras) |
| P7 — PT-BR | Atendido | Vozes, rótulos e erros em PT-BR |
| P11 — Testes | Atendido, com lacunas | Playwright com a voz falsa; Rust para catálogo, WAV e extração; ver KL-004 |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | O build do instalador não foi verificado com as DLLs do sherpa (`sherpa-onnx-c-api.dll`, `onnxruntime.dll`, `onnxruntime_providers_shared.dll`) ao lado de `jarvis.exe`: nem `src-tauri/build.rs` (só `tauri_build::build()`) nem o `bundle` de `tauri.conf.json` as copiam, e sem elas o Windows carrega o `onnxruntime.dll` 1.17 de System32 e o app quebra. | Não verificado |
| KL-002 | Os binários de teste rodam de `t/debug/deps` (a pasta de build, ver [build-and-env](../../arch/build-and-env.md)), onde o build não copia as DLLs; `speech_samples` só roda depois de copiá-las à mão. | Limite do ambiente de teste |
| KL-003 | Um `close` nos 400 ms depois do fim de uma frase deixa o motor de voz surdo: ele cancela o `deafen(false)` agendado e só chama `deafen(false)` se uma frase estava tocando. Acontece com Esc entre duas frases e sempre depois de "Ouvir exemplo", porque `previewVoice` chama `close` assim que a frase termina. Os modos de escuta ignoram tudo até o JARVIS falar de novo (o push-to-talk, o ditado e o núcleo não são afetados); nem desligar e religar a escuta zera a flag `deaf`, que fica no `VoiceEngine`. | Defeito; sem teste |
| KL-004 | AC-006 (página `silent`) e AC-009 ("Baixe a voz primeiro") não têm teste automatizado, e a velocidade gravada em AC-010 não é conferida. | Lacuna de verificação |
| KL-005 | Fora do app (sem o fake), a seção mostra a lista de vozes vazia e "Ouvir exemplo" desabilitado com a dica "Baixe a voz primeiro", que não se aplica no navegador. | Texto impreciso |

## Open Questions

Nenhuma.

## References

- Versão anterior desta spec, no formato SpecLang: `git show e7151cf:.specs/features/tts/spec.md`. A versão intermediária, no formato do spec-coding.dev ([ADR-0023](../../arch/adr/0023-specs-formato-spec-coding-dev.md)), não chegou a ser commitada.
- Modelo de formato: [reminders](../reminders/spec.md) ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)).
- Medições e a fixação da versão: [ADR-0005](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md).
- Código conferido: listado em Metadata › Verification Scope.
