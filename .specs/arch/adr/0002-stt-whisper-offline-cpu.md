# ADR-0002: Reconhecimento de voz offline com whisper.cpp na CPU, modelo Small por padrão

| | |
|---|---|
| **Status** | Substituído por [ADR-0021](0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md) |
| **Data** | 2026-10-27 (troca do padrão para Small) |
| **Origem** | commits `42e671a`, `048a254`; memória `jarvis-machine-constraints` |

## Contexto

O usuário prefere soluções locais e offline, mesmo quando exigem ferramental extra. A voz precisa funcionar sem internet e sem chave de API. A máquina tem um Core 7 150U (2 núcleos P + 8 E) e uma NVIDIA MX570 de 2 GB, mas o whisper-rs é compilado sem backend de GPU.

Medições em CPU (2026-10-27), por comando falado de 2 a 3 s:

| Modelo | Tempo |
|---|---|
| Large V3 Turbo | ~20 s (o encoder de 32 camadas faz cerca de 1 TFLOP) |
| **Small** | **~2,4 s** |
| Base | ~0,75 s |

Para chegar a esses tempos: janela do encoder de 384 frames (dimensionada ao áudio, de 384 a 1500), 10 threads (mais rápido que 8 e 12 nessa CPU) e teto de tokens.

## Decisão

- Usar **whisper.cpp in-process** via `whisper-rs 0.16`, na **CPU**.
- O catálogo fixo tem `small` (q5_1, **padrão**), `base` (q5_1) e `large-v3-turbo` (q5_0). Os modelos são baixados do Hugging Face com tamanho e SHA-256 fixos.
- Decodificação gulosa com flash attention e prompt `"Hey Jarvis. <palavras-chave>"`.
- Descartar segmentos com probabilidade de não-fala ≥ 0,6 e saídas que só ecoam o prompt.
- Compilar `whisper-rs-sys` com `opt-level = 3` mesmo em dev.

## Consequências

- **Positivas:** privacidade e funcionamento offline; ~2,4 s por comando é aceitável para push-to-talk.
- **Negativas:**
  - o Small erra mais que o Turbo, o que leva a apelidos de wake word ("jarbas"), tolerância de Levenshtein e lista de alucinações no matcher;
  - a CPU fica ocupada durante a transcrição;
  - o build exige CMake e libclang.
- **Regras:** trocar o modelo padrão exige medir de novo nesta CPU (`JARVIS_TEST_MODEL=<id> cargo test --lib -- --ignored speech --nocapture`).

## Alternativas consideradas

- **Large V3 Turbo como padrão:** era o padrão anterior e foi rebaixado por levar ~20 s.
- **GPU via Vulkan:** o `scripts/tauri.mjs` já detecta um `VULKAN_SDK`, mas a feature não está ativa. Fica como pendência em [build-and-env](../build-and-env.md).

## Referências

- `src-tauri/src/voice/transcriber.rs`, `src-tauri/src/models.rs`, `src-tauri/Cargo.toml`
- Spec: [voice-engine](../../features/voice-engine/spec.md)
