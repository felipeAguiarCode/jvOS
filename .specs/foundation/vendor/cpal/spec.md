# Vendor: cpal

Biblioteca de áudio em Rust que abre o microfone padrão do Windows (WASAPI) para o motor de voz, fora da WebView.

| | |
|---|---|
| **ID** | `vendor/cpal` |
| **Tipo** | Crate Rust |
| **Status** | Em uso |
| **Versão** | `cpal` 0.18.2 (declarada `"0.18"`, features padrão, sem `asio` nem `jack`) |
| **Licença** | Apache-2.0 |
| **Fonte** | https://github.com/RustAudio/cpal |
| **Onde roda** | processo Rust (thread de áudio do WASAPI, que entrega à thread `jarvis-voice`) |

## Objetivo

Os comandos de voz precisam funcionar com a janela minimizada, e captura, VAD e Whisper não devem disputar a thread da UI. Por isso o microfone é aberto no Rust, pelo cpal, numa thread dedicada ([ADR-0003](../../../arch/adr/0003-motor-de-voz-thread-rust.md)). Por que cpal e não outra biblioteca não está registrado: ⚠ inferido — confirmar.

## Não-objetivos

- Sem saída de áudio: a voz do JARVIS toca na WebView ([tts](../../../features/tts/spec.md)).
- Sem escolha de dispositivo: sempre o microfone padrão do Windows.
- Sem ASIO, JACK ou outros hosts: só o host padrão (WASAPI no Windows).
- Sem o resampler de terceiros: a conversão para 16 kHz é do próprio jvOS (`Resampler`).
- O analisador de áudio do holograma (`useAudioAnalyzer`, via `getUserMedia` na WebView) não usa o cpal e nunca grava comandos.

## Critérios de aceite

### Critério 1 (RF-003)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- voice::audio` em `src-tauri`
- **Então** passam `downsamples_to_16k` (1 s a 48.000, 44.100, 32.000 e 16.000 Hz, em blocos de 997 amostras, vira 16.000 ± 1 amostras com o mesmo valor) e `upsamples_low_rates` (8.000 Hz vira 16.000 ± 1).

### Critério 2 (RNF-001)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -e features -i cpal` em `src-tauri`
- **Então** aparece `cpal v0.18.2` sem as features `asio` e `jack`, e `cargo tree -i windows-core` responde com uma única versão (0.62.2), a mesma do WebView2.

### Critério 3 (RF-001)

- **Dado** um Windows sem nenhum dispositivo de entrada ativo
- **Quando** ligo a escuta
- **Então** o motor de voz vai para erro com "Nenhum microfone encontrado".

### Critério 4 (RF-004)

- **Dado** a escuta ligada com um microfone USB
- **Quando** desconecto o microfone
- **Então** o motor de voz vai para erro com "O microfone parou de responder".

### Critério 5 (RF-005)

- **Dado** o microfone do notebook com a tecla de mudo ativa (o Windows o mostra ligado, mas ele entrega zeros exatos)
- **Quando** o microfone fica aberto por 4 s
- **Então** aparece "O microfone não está captando som. Verifique a tecla de mudo do microfone.".

## Casos de borda

- **Vazio/nulo:** sem dispositivo de entrada, "Nenhum microfone encontrado". Se o Windows não der a configuração padrão do dispositivo, ou o stream não abrir ou não tocar, "Microfone indisponível: <erro>". Um formato de amostra fora de F32, I16, I32, U16 e U8 dá "Formato de áudio não suportado: <formato>". Um microfone mudo entrega silêncio digital: o motor avisa depois de 4 s.
- **Duplicidade/idempotência:** o motor só abre o microfone quando não há um aberto (`mic.is_none()`), então existe no máximo um stream por motor. Reiniciar o motor derruba o `Capture` antigo junto com a thread.
- **Concorrência/corrida:** o callback do cpal roda na thread de áudio e só manda um `Vec<f32>` mono pelo canal `mpsc`. Quando o motor para, o receptor some, o `send` falha em silêncio e o stream é derrubado logo depois. A WebView pode abrir o mesmo microfone ao mesmo tempo para o holograma; o WASAPI em modo compartilhado aceita os dois ⚠ inferido — confirmar.
- **Permissões/visibilidade:** a privacidade do Windows ("acesso ao microfone" para apps da área de trabalho) desligada faz o stream falhar ⚠ inferido — confirmar a mensagem exata ("Microfone indisponível: …" na abertura ou "O microfone parou de responder" com `PermissionDenied`). Engasgos (xruns) e a troca do dispositivo padrão não derrubam o motor.

## Uso no jvOS

### Captura do microfone (`src-tauri/src/voice/audio.rs`)

`open` abre o microfone padrão e entrega amostras mono na taxa nativa.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE abrir o dispositivo de entrada padrão do host padrão (`cpal::default_host().default_input_device()`) com a configuração padrão dele (`default_input_config`).
    - Se não houver dispositivo, então responda "Nenhum microfone encontrado".
    - Se a configuração, a criação ou o `play()` do stream falhar, então responda "Microfone indisponível: <erro>".
  - **RF-002**: O callback DEVE aceitar amostras F32, I16, I32, U16 e U8, converter para `f32` (`FromSample`) e fazer a média dos canais (mono), mandando um buffer por callback. Outro formato responde "Formato de áudio não suportado: <formato>".
  - O stream vive dentro do `Capture`; derrubar o `Capture` para a captura.

### Conversão para 16 kHz (`audio.rs` › `Resampler`)

O Whisper e as VADs trabalham a 16 kHz mono (`SAMPLE_RATE` em `vad.rs`).

- **Comportamento:**
  - **RF-003**: O `Resampler` DEVE converter a taxa nativa para 16 kHz com um filtro de caixa (média das amostras de cada período de saída) e passo fracionário, e repetir amostras quando a entrada for menor que 16 kHz.

### Erros do stream (`audio.rs`, `src-tauri/src/voice/mod.rs`)

Como o motor reage a um microfone que some.

- **Comportamento:**
  - **RF-004**: Os erros `DeviceNotAvailable`, `HostUnavailable`, `PermissionDenied` e `StreamInvalidated` DEVEM marcar `device_lost`, e o motor vai para erro com "O microfone parou de responder". Os demais erros (engasgos, troca do dispositivo padrão) são ignorados.
  - **RF-005**: Com o microfone aberto e sem nenhuma amostra diferente de zero por 4 s (`SILENT_MIC_AFTER`), o motor DEVE avisar "O microfone não está captando som. Verifique a tecla de mudo do microfone.".

### Quando o microfone fica aberto (`voice/mod.rs` › `Mic`)

O modo de ativação decide quanto tempo o stream do cpal vive.

- **Comportamento:**
  - **RF-006**: Nos modos "Hey Jarvis" e "Sempre ouvindo" o stream DEVE ficar aberto o tempo todo. No push-to-talk, só enquanto o botão (ou `M`) estiver pressionado: ao soltar, `Mic::close` derruba o stream e o motor processa o que foi gravado.
    - O ditado e as perguntas abrem o microfone enquanto o botão está pressionado. Fora dos modos de escuta, ele fecha ao soltar.
  - Com o microfone fechado, o laço de voz dorme até 1 s (`IDLE_POLL`) e os botões o acordam (`nudge`).

## Restrições

- **RNF-001**: `cpal` 0.18.x com as features padrão: host WASAPI no Windows, sem `asio` e sem `jack`. Ele divide o `windows` e o `windows-core` 0.62.2 com o WebView2.
- **RNF-002**: A saída para o motor é sempre 16 kHz mono (`SAMPLE_RATE = 16_000`).
- **RNF-003**: Um único dono do microfone para comandos: a UI nunca grava áudio para comandos ([ADR-0003](../../../arch/adr/0003-motor-de-voz-thread-rust.md)).
- **RNF-004**: Licença Apache-2.0.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/voice/audio.rs` | `open`, `build`, `Capture`, `Resampler` e seus testes |
| `src-tauri/src/voice/mod.rs` | `Mic` (abre, resampleia, fecha), `device_lost`, aviso de microfone mudo |
| `src-tauri/src/voice/vad.rs` | `SAMPLE_RATE = 16_000` |
| `src-tauri/Cargo.toml` | `cpal = "0.18"` |

### Testes

- `cargo test --lib -- voice::audio` (de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados): o `Resampler`.
- App real via CDP ([testing](../../../arch/testing.md)): push-to-talk com `M`, microfone desconectado e tecla de mudo (critérios 3 a 5). É manual.
- Os testes `--ignored speech` usam as fixtures WAV e não abrem o microfone; o Playwright (`tests/voice.spec.ts`) usa o microfone falso do Chromium e também não passa pelo cpal.

### Atualização e reversão

- **Comando:** em `src-tauri`, `cargo update -p cpal --precise 0.18.<n>`. Para 0.19 ou mais, troque `"0.18"` no `Cargo.toml` e confira `ErrorKind`, `SampleFormat` e `sample_rate()`.
- **Prova:** critérios 1 e 2; no `npm run dev`, um comando por push-to-talk transcrito, e os critérios 3 a 5 à mão.
- **Sinal de volta:** "O microfone não está captando som" com o microfone ligado, "Formato de áudio não suportado" num microfone que funcionava, ou o motor caindo em engasgos.
- **Reversão:** volte `src-tauri/Cargo.toml` e `src-tauri/Cargo.lock` e recompile. Confira o critério 2.

### Decisões relacionadas

- [ADR-0003 — Motor de voz numa thread Rust independente da WebView](../../../arch/adr/0003-motor-de-voz-thread-rust.md)

## Dependências

- Vendor: [whisper-rs](../whisper-rs/spec.md) (quem transcreve o áudio), [sherpa-onnx](../sherpa-onnx/spec.md) (o porteiro Silero sobre as mesmas amostras), [tauri](../tauri/spec.md) (o `windows-core` em comum).
- Specs: [voice-engine](../../../features/voice-engine/spec.md), [dictation](../../../features/dictation/spec.md), [assistant](../../../features/assistant/spec.md) (perguntas pelo microfone do núcleo).
- Sistema: microfone padrão do Windows, WASAPI, permissão de microfone para apps da área de trabalho.

## Pendências

- [ ] Nenhum teste automático abre o microfone pelo cpal: `audio::open`, os erros do stream e o aviso de microfone mudo só são conferidos à mão no app real (`src-tauri/src/voice/audio.rs`, `src-tauri/src/voice/mod.rs`).
