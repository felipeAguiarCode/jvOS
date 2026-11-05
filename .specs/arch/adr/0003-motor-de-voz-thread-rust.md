# ADR-0003: Motor de voz numa thread Rust independente da WebView

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-23 |
| **Origem** | commit `42e671a`; doc do módulo `src-tauri/src/voice/mod.rs` |

## Contexto

Os comandos de voz ("Jarvis, abre o VS Code") precisam funcionar com a janela minimizada ou atrás de outros programas. Uma WebView minimizada pode ser estrangulada, e captura de áudio, VAD e inferência não devem disputar a thread da UI.

## Decisão

Rodar todo o pipeline (microfone cpal, VAD, Whisper e matcher) numa **thread Rust dedicada** (`jarvis-voice`), dona do seu estado.
- **Programas** são abertos ali mesmo, pelo `launcher.rs`.
- **Todo o resto** vira um **evento** `voice:*`, que a UI segue.
- A UI controla o motor por comandos curtos: `voice_start`, `voice_stop`, `voice_push`, `voice_dictate`, `voice_ask` e `voice_deafen`.

## Consequências

- **Positivas:**
  - funciona minimizado;
  - a UI não trava durante a transcrição;
  - um único dono do microfone evita conflitos entre push-to-talk, ditado e pergunta.
- **Negativas:**
  - **a lógica do push-to-talk e dos estados do motor não roda no navegador**, então o Playwright no modo web não a cobre;
  - o teste real é manual, via CDP na WebView2 (ver [testing](../testing.md#app-real-via-cdp)).
- **Regras:**
  - a UI nunca grava áudio por conta própria para comandos;
  - o estado exibido vem sempre de `voice:state`;
  - `voice_deafen(true)` enquanto o JARVIS fala, para ele não ouvir a si mesmo.

## Alternativas consideradas

Não registradas.

## Referências

- `src-tauri/src/voice/mod.rs`, `src/hooks/useVoiceAssistant.ts`
- Spec: [voice-engine](../../features/voice-engine/spec.md)
