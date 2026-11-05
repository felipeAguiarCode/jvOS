# ADR-0001: Tauri 2 + Rust como casca do desktop

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-23 |
| **Origem** | commit `42e671a` (commit inicial) |

## Contexto

O jvOS é uma área de trabalho de tela cheia, sem moldura, inspirada no JARVIS. A interface é pesada: núcleo WebGL, janelas internas, editores CodeMirror e xterm. O trabalho nativo também é pesado: reconhecimento de voz contínuo, síntese de fala, PTY, git, watcher de arquivos e Win32 FFI para os medidores. O alvo é uma única máquina Windows 11, e a voz precisa continuar funcionando com a janela minimizada.

## Decisão

Usar **Tauri 2**, com a UI em React/TypeScript dentro da WebView2 e todo o trabalho nativo em **Rust** no mesmo processo:
- uma janela `main` sem moldura (`decorations: false`), maximizada e oculta até o primeiro frame (`visible: false`, com revelação de fallback após 2,5 s);
- nenhum plugin `fs` ou `shell`: cada capacidade nativa é um comando próprio em `lib.rs`;
- capabilities mínimas: controles de janela e diálogo abrir/salvar;
- uma CSP que bloqueia origens de terceiros na WebView, de modo que o HTTP externo passa pelo Rust (`feeds.rs`, `music.rs`, `download.rs`).

## Consequências

- **Positivas:**
  - whisper.cpp, sherpa-onnx, ConPTY e a Win32 rodam em processo, sem serviço auxiliar;
  - um binário só, e a WebView2 já vem no Windows;
  - a superfície de ataque é explícita: 75 comandos listados em [ipc-contract](../ipc-contract.md).
- **Negativas:**
  - só Windows/WebView2 é suportado e testado;
  - compilar exige CMake, LLVM/libclang e o VS Build Tools (ver [build-and-env](../build-and-env.md));
  - a primeira compilação leva minutos por causa do whisper.cpp.
- **Regras:**
  - nada nativo na WebView;
  - todo acesso a SO, processo, arquivo ou rede externa vira um comando Tauri ([P2](../constitution.md#p2--o-rust-é-dono-de-tudo-que-é-nativo)).

## Alternativas consideradas

Não registradas. Nada no repositório menciona Electron ou outras opções.

> ⚠ inferido — confirmar: a escolha provavelmente pesou o tamanho do binário e o acesso direto ao Rust para whisper.cpp e sherpa-onnx.

## Referências

- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`
- [overview](../overview.md)
