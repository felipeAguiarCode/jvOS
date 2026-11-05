# ADR-0005: Voz do JARVIS local com sherpa-onnx fixado em 1.13.8

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-27 |
| **Origem** | commit `750ebd0`; comentário em `Cargo.toml`; memória `jarvis-tts` |

## Contexto

O JARVIS precisa falar em português do Brasil com voz neural, sem nuvem e sem chave.

- O sherpa-onnx roda Piper e Kokoro em processo, a partir do Rust.
- **A versão 2.x removeu o espeak-ng.** Com isso, `lang = "pt-br"` é ignorado, e o português exigiria um léxico que ninguém publica.
- A feature padrão `static` baixa um arquivo de ~122 MB, demais para o disco desta máquina.
- O Windows 11 traz um `onnxruntime.dll` 1.17 em `System32`, que conflita com o do sherpa.
- Velocidade medida nesta CPU: Piper com RTF ≈ 0,25–0,3; Kokoro int8 com RTF ≈ 1,1–1,2, que piora com mais threads (núcleos E).

## Decisão

- **Fixar `sherpa-onnx = "=1.13.8"`** com `default-features = false, features = ["shared"]`. Essa versão ainda faz a fonetização pelo `espeak-ng-data` de cada modelo.
- Catálogo fixo de 5 arquivos do release `tts-models`: Piper miro, cadu, jeff e dii (~21 MB cada) e Kokoro int8 multi-língua (132 MB), somando 8 vozes.
- **Padrão: Piper `miro`**, grave (~110 Hz). A Faber caiu por soar ambígua.
- Um modelo carregado por vez. Threads = metade dos núcleos, limitado a 1–4. Velocidade 0,5–2,0.
- A UI sintetiza frase a frase (`speech_synthesize` devolve WAV cru) e toca enquanto pede a próxima.

## Consequências

- **Positivas:** voz offline, rápida com Piper e em português de verdade.
- **Negativas:**
  - preso à 1.x até existir um fonetizador de português na 2.x;
  - **as DLLs do sherpa precisam ficar ao lado de todo binário que as carrega**: app, testes em `target/debug/deps` e, ainda não verificado, o instalador;
  - Kokoro fica disponível, mas é lento.
- **Regras:**
  - não subir para a 2.x sem um fonetizador de português;
  - manter `voice_deafen` ligado durante a reprodução.

## Alternativas consideradas

- **sherpa-onnx 2.x:** sem português.
- **Feature `static`:** download grande demais.
- **Voz SAPI do Windows (Microsoft Maria):** usada só em testes acústicos antigos. Ela deixava "relógio" e "pomodoro" irreconhecíveis para o Whisper.

## Referências

- `src-tauri/src/speech.rs`, `src/lib/speech.ts`, `src-tauri/Cargo.toml`
- Spec: [tts](../../features/tts/spec.md) · [build-and-env](../build-and-env.md)
