# JARVIS OS

Desktop para Windows inspirado no JARVIS do Homem de Ferro: um núcleo holográfico que reage à voz, um assistente de voz 100% local e apps em estilo TUI.

Tauri 2 · Rust · whisper.cpp · React 19 · TypeScript · Vite · Three.js · Tailwind CSS 4 · CodeMirror 6 · xterm.js

## O que tem

- **Núcleo**: reator 2D (padrão), holograma 3D em WebGL ou desligado.
- **Voz local**: Whisper offline. Segure `M` (ou o botão Voice) para falar, ou use "Hey Jarvis" ou o modo sempre ouvindo. Abre programas, janelas, música e o Pomodoro.
- **Dock e barra superior**: dock com zoom nos ícones e uma barra no estilo Waybar.
- **Widgets**: Relógio, Pomodoro, Bateria, Calculadora, Sistema (CPU, GPU, disco, Wi-Fi, RAM), Fita e Mini player. O botão direito abre as opções de cada um, e eles arrastam por qualquer ponto.
- **Apps**:
  - **jv_ide**: IDE em TUI no estilo do termide, com árvore de arquivos, abas com destaque de sintaxe, Git, Outline, busca no projeto e terminais embutidos.
  - **jv_sh**: terminal com os perfis do Windows Terminal.
  - **jv_T4p3**: player de música com rádios e playlists do YouTube.
  - **Jarvis Mark**: editor de Markdown com ditado.

## Requisitos

- Windows 11 com WebView2
- Node.js 22+
- Rust stable (MSVC)
- Visual Studio Build Tools com C++ e CMake
- LLVM (`winget install LLVM.LLVM`)

## Uso

```powershell
npm install
npm run dev           # app desktop com hot reload
npm run dev:web       # só o frontend em http://localhost:1420
npm run tauri build   # executável e instaladores
```

A primeira compilação demora alguns minutos por causa do whisper.cpp. O modelo do Whisper é baixado pelas Configurações.

## Testes

```powershell
npm test                                       # Playwright
cd src-tauri; cargo test                       # Rust
cd src-tauri; cargo test -- --ignored speech   # fala real ponta a ponta
```

Fora do npm, defina `CMAKE` e `LIBCLANG_PATH` antes do `cargo`.

## Atalhos

| Tecla | Ação |
|---|---|
| `M` (segurar) | falar |
| `/` | busca |
| `Ctrl + ,` | Configurações |
| `Ctrl + Shift + ,` | Menu avançado |
| `Ctrl + W` | fecha a janela |
| `F11` | tela cheia |
| `Ctrl + M` | minimizar |

No jv_ide:

| Tecla | Ação |
|---|---|
| `Ctrl + O` | abrir pasta |
| `Ctrl + P` | abrir arquivo |
| `Ctrl + Shift + P` | comandos |
| `Ctrl + Shift + F` | buscar no projeto |
| ``Ctrl + ` `` | terminal |
| `F2` ou duplo clique | renomear na árvore |

## Dados

| O quê | Onde |
|---|---|
| Configurações | `%APPDATA%\dev.jarvis.os\settings.json` |
| Modelos e binários | `%LOCALAPPDATA%\dev.jarvis.os\` |
| Janelas, rascunhos e preferências | `localStorage` do WebView2, nas chaves `jarvis.*` |

## Estrutura

```
src/              interface (React): núcleo, dock, janelas, widgets e apps
src-tauri/src/    backend (Rust): voz, terminal, workspace, git, sistema
tests/            Playwright
```

Só Windows foi configurado e testado.
