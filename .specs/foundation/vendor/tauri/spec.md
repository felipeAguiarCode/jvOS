# Vendor: Tauri 2 e WebView2

Casca do desktop do jvOS: a janela sem moldura com a UI React dentro da WebView2, a ponte de comandos e eventos com o Rust, os diálogos nativos de abrir e salvar e o CLI que compila e empacota o app.

| | |
|---|---|
| **ID** | `vendor/tauri` |
| **Tipo** | Crate Rust · Lib npm · Ferramenta externa (runtime WebView2) |
| **Status** | Em uso |
| **Versão** | `tauri` 2.12.4 (declarada `"2.12"`)<br>`tauri-build` 2.7.3 (declarada `"2"`, build-dependency)<br>`tauri-runtime-wry` 2.12.2 e `wry` 0.57.0 (transitivas)<br>`tauri-plugin-dialog` 2.8.3 (declarada `"2"`)<br>`@tauri-apps/api` 2.12.4 (declarada `^2.12.4`)<br>`@tauri-apps/plugin-dialog` 2.8.3 (declarada `^2.8.3`)<br>`@tauri-apps/cli` 2.12.3 (declarada `^2.12.3`, dev)<br>`webview2-com` 0.39.1 (declarada `"0.39"`, só Windows)<br>`windows-core` 0.62.2 (declarada `"0.62"`, só Windows)<br>WebView2 Runtime 156.0.4314.58 (Evergreen, instalado nesta máquina) |
| **Licença** | `tauri`, `tauri-build`, `tauri-plugin-dialog`, `@tauri-apps/api`, `@tauri-apps/cli`: Apache-2.0 OR MIT · `@tauri-apps/plugin-dialog`: MIT OR Apache-2.0 · `webview2-com`: MIT · `windows-core`: MIT OR Apache-2.0 · WebView2 Runtime: licença da Microsoft ⚠ inferido — confirmar |
| **Fonte** | https://github.com/tauri-apps/tauri · https://github.com/tauri-apps/plugins-workspace · https://github.com/wravery/webview2-rs · https://github.com/microsoft/windows-rs |
| **Onde roda** | processo Rust (`jarvis.exe`) · WebView2 (`msedgewebview2.exe`) · build (`tauri-build` e CLI) |

## Objetivo

O jvOS precisa de uma UI web pesada (WebGL, CodeMirror, xterm) e de trabalho nativo pesado no mesmo processo (Whisper, sherpa-onnx, ConPTY, Win32). O Tauri 2 junta os dois num binário só: a UI roda na WebView2, que já vem no Windows, e todo o nativo fica em Rust ([ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md)). Por que Tauri e não outra casca não está registrado: ⚠ inferido — confirmar (tamanho do binário e acesso direto ao Rust).

## Não-objetivos

- Nenhum plugin além do `dialog`: sem `fs`, `shell` ou `http`. Cada capacidade nativa é um comando próprio em `lib.rs`.
- Sem mobile: `crate-type = ["rlib"]`, sem a `staticlib` e a `cdylib` do template.
- Sem macOS e Linux: só Windows com WebView2 é suportado e testado.
- Uma janela só (`main`): sem bandeja, sem atualizador automático, sem janelas nativas extras. As janelas do jvOS são componentes React.
- A WebView não fala com sites de terceiros: o HTTP externo passa pelo Rust.

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `package-lock.json` e o `src-tauri/Cargo.lock` atuais
- **Quando** rodo `npm ls @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/cli` na raiz e `cargo tree -i tauri-plugin-dialog --depth 0` em `src-tauri`
- **Então** o npm mostra `@tauri-apps/api@2.12.4`, `@tauri-apps/plugin-dialog@2.8.3` e `@tauri-apps/cli@2.12.3`, e o cargo mostra `tauri-plugin-dialog v2.8.3`, a mesma versão do pacote npm.

### Critério 2 (RF-001)

- **Dado** o app aberto com `npm run dev`
- **Quando** a janela aparece
- **Então** ela vem maximizada e sem moldura, só depois do primeiro quadro da UI (ou em até 2,5 s, pelo fallback do Rust), e `Ctrl+Shift+D` traz a moldura nativa de volta.

### Critério 3 (RF-003)

- **Dado** o build de release (`npm run tauri build -- --no-bundle`) dirigido via CDP ([testing](../../../arch/testing.md))
- **Quando** a página roda `fetch("https://api.open-meteo.com/v1/forecast")`
- **Então** a CSP recusa a requisição, enquanto `__TAURI_INTERNALS__.invoke("weather_forecast", { city: "Curitiba" })` devolve um `Weather` vindo do Rust.

### Critério 4 (RF-004)

- **Dado** o app rodando e dirigido via CDP
- **Quando** a página chama `__TAURI_INTERNALS__.invoke("plugin:window|unminimize")`
- **Então** a ACL recusa a chamada, porque `core:window:allow-unminimize` não está em `capabilities/default.json`.

### Critério 5 (RF-010)

- **Dado** a UI no navegador (`npm run dev:web`), onde `isTauri()` é falso
- **Quando** clico em "VS Code" na dock
- **Então** aparece "Disponível no app desktop", que some em até 4 s (`tests/ui.spec.ts`, "dock hover, tooltip and click feedback").

### Critério 6 (RNF-003)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -i webview2-com` e `cargo tree -i windows-core` em `src-tauri`
- **Então** cada comando responde com uma única versão (0.39.1 e 0.62.2), a mesma que o `wry` 0.57.0 usa, sem pedir para escolher entre versões.

### Critério 7 (RF-008)

- **Dado** o app com uma aba do jv_sh aberta, uma pasta aberta no jv_ide e uma pergunta feita ao JARVIS
- **Quando** fecho o jvOS com `Ctrl+Q`
- **Então** `Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq <pid do jarvis.exe>` não lista nenhum processo que tenha sobrado (shell, `claude.exe`).

## Casos de borda

- **Vazio/nulo:** fora do Tauri (navegador, Playwright), `isTauri()` é falso e cada adaptador usa o fake de DEV (`__JARVIS_*__`) ou mostra "Disponível no app desktop". Um diálogo cancelado devolve `null` e nada muda. Sem o WebView2 Runtime a janela não abre ⚠ inferido — confirmar (o Windows 11 já traz o runtime).
- **Duplicidade/idempotência:** `npm run dev` com o Vite já respondendo em `:1420` (título "JARVIS OS") reaproveita o servidor e avisa "[jarvis] Using the Vite dev server already running at http://localhost:1420." em vez de falhar com a porta ocupada. A UI revela a janela uma vez só (`revealed`). Um segundo `download_model` ou `speech_download` do mesmo id volta `Ok` sem abrir outra thread.
- **Concorrência/corrida:** comandos lentos vão para `spawn_blocking` (`blocking()`) ou para uma thread própria, então a thread da janela não trava. O `show()` da UI e o fallback de 2,5 s do Rust podem disputar: o Rust só mostra a janela se `is_visible()` ainda for falso.
- **Permissões/visibilidade:** em dev (`devCsp: null`) não há CSP, então um `fetch` a terceiros que funciona em `npm run dev` falha no release. A ACL recusa APIs de janela fora das oito listadas. Microfone e leitura da área de transferência são liberados sem o prompt da WebView, mas as configurações de privacidade do Windows continuam valendo. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` substitui o `additionalBrowserArgs` inteiro ([testing](../../../arch/testing.md)).

## Uso no jvOS

### Janela principal (`src-tauri/tauri.conf.json`)

A janela `main` é a tela inteira do jvOS.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE abrir uma única janela `main` sem moldura (`decorations: false`), maximizada, com mínimo de 1024 × 640, fundo `#000508`, tema escuro e oculta (`visible: false`) até a UI desenhar o primeiro quadro.
    - A UI chama `show()` e `setFocus()` no primeiro quadro, ou 500 ms depois (`REVEAL_FALLBACK_MS` em `useWindowControls.ts`).
    - Se a janela ainda estiver oculta 2,5 s depois do `setup` (`REVEAL_FALLBACK` em `lib.rs`), o Rust a mostra.
    - `Ctrl+Shift+D` liga e desliga a moldura nativa (`setDecorations`).
  - **RF-002**: A janela DEVE passar à WebView2 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required`.
    - As três features desligadas são o padrão do wry, que deixa de valer quando `additionalBrowserArgs` é definido (doc de `additional_browser_args` no `tauri-utils`), por isso são repetidas.
    - O autoplay deixa o som tocar sem gesto ([boot](../../../features/boot/spec.md)).
  - O `identifier` `dev.jarvis.os` define as pastas: `%APPDATA%\dev.jarvis.os` (`settings.json`) e `%LOCALAPPDATA%\dev.jarvis.os` (modelos, binários e o `EBWebView` da WebView2). Ver [persistência](../../../domain/persistence.md).

### Segurança da WebView (`tauri.conf.json` › `security`, `capabilities/default.json`, `lib.rs`)

O que a página pode carregar e chamar.

- **Comportamento:**
  - **RF-003**: O build de release DEVE aplicar a CSP `default-src 'self' ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream: https://*.googlevideo.com`. O único destino externo é o áudio do YouTube ([jv_t4p3](../../../apps/jv_t4p3/spec.md)).
  - **RF-004**: A capability `default` DEVE valer só para a janela `main` e liberar só `core:default`, oito permissões de janela (`allow-show`, `allow-set-focus`, `allow-start-dragging`, `allow-minimize`, `allow-close`, `allow-toggle-maximize`, `allow-set-fullscreen`, `allow-set-decorations`), `dialog:allow-open` e `dialog:allow-save`.
  - **RF-005**: `on_permission_request` DEVE responder `Allow` ao microfone (a página só chama `getUserMedia` depois que a escuta é ligada) e à leitura da área de transferência (o jv_sh cola com `Ctrl+V` e com o botão direito). O resto fica com o padrão da WebView.
  - Se uma API de janela não estiver na lista, então a ACL recusa a chamada.

### Ponte de comandos e eventos (`src-tauri/src/lib.rs`)

Tudo o que a UI pede ao Rust passa por aqui ([ipc-contract](../../../arch/ipc-contract.md)).

- **Comportamento:**
  - **RF-006**: O jvOS DEVE registrar os 77 comandos em `generate_handler!` e tirar da thread principal todo trabalho lento: `blocking()` (`tauri::async_runtime::spawn_blocking`) para arquivo, git, rede e síntese, e `std::thread::spawn` para downloads.
  - **RF-007**: Respostas longas DEVEM sair por `Channel` (`assistant_ask`, `workspace_search`), progresso e avisos por eventos (`model:*`, `speech:*`, `music:install-*`, `terminal:*`, `workspace:changed`, `assistant:action`, `voice:*`) e o WAV da voz como bytes crus (`tauri::ipc::Response` em `speech_synthesize`).
  - **RF-008**: No `RunEvent::Exit`, o jvOS DEVE fechar todos os terminais, os watchers e a busca do jv_ide e o Claude Code.
  - O `setup` monta o estado com `app_config_dir()` (`settings.json`), `app_local_data_dir()` (`models`, `bin`, `tts`, `jv_sh`, `assistant\mcp.json`) e `document_dir()` (`JARVIS`, ou a pasta do usuário se não houver Documentos).

### Meta de memória da WebView2 (`webview_background` em `lib.rs`, `src/hooks/useWindowControls.ts`)

Devolve memória ao sistema quando o jvOS fica fora de vista.

- **Comportamento:**
  - **RF-009**: Com a janela oculta ou minimizada por 5 s (`TRIM_AFTER_MS`), a UI DEVE chamar `webview_background(true)`, e o Rust DEVE pôr a meta de memória da WebView2 em `COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW` via `ICoreWebView2_19` (`webview2-com`). De volta à tela, `NORMAL`.
  - Se o runtime não tiver `ICoreWebView2_19` (antes de 1.0.2210), então o comando não faz nada e volta `Ok`.
  - Fora do Windows o comando também não faz nada (`#[cfg(not(windows))]`).

### API JS na UI (`src/lib/*.ts`, `src/hooks/*.ts`, `src/App.tsx`)

Os 17 arquivos que importam `@tauri-apps/api`.

- **Comportamento:**
  - **RF-010**: Toda chamada nativa DEVE passar por `invoke`, `listen` ou `Channel` (`@tauri-apps/api/core` e `event`), e cada adaptador DEVE decidir com `isTauri()` (ou com a flag `desktop` derivada dele) entre o Tauri, o fake de DEV e o aviso "Disponível no app desktop", para a UI rodar no navegador ([ADR-0011](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)).
  - A janela é controlada só por `getCurrentWindow()`: `show`, `setFocus`, `close` (`Ctrl+Q`), `minimize` (`Ctrl+M`), `isFullscreen`/`setFullscreen` (`F11`), `setDecorations` (`Ctrl+Shift+D`), `isMinimized` e `onResized` ([keyboard-shortcuts](../../../features/keyboard-shortcuts/spec.md)).
  - O arraste da janela é pelo atributo `data-tauri-drag-region` (barra superior e faixa de 28 px no topo do `App`).

### Diálogos nativos (`src/lib/files.ts`, `src/lib/workspace.ts`)

O plugin `dialog` escolhe caminhos; quem lê e grava é o Rust.

- **Comportamento:**
  - **RF-011**: `open` e `save` do `@tauri-apps/plugin-dialog` DEVEM servir só para escolher o caminho. O conteúdo vai por `read_text_file` e `write_text_file` (caminho absoluto, UTF-8, até 2 MB) ou pelos comandos `workspace_*`.
  - Títulos usados: "Abrir arquivo", "Salvar arquivo", "Abrir pasta", "Pasta para abrir por voz", "Arquivo para abrir por voz" e "Pasta onde o agente vai trabalhar".
  - Se o usuário cancelar, então o diálogo devolve `null` e nada é lido ou gravado.

### CLI e build (`scripts/tauri.mjs`, `package.json`, `src-tauri/build.rs`)

Como o app é compilado e empacotado.

- **Comportamento:**
  - **RF-012**: `npm run dev` e `npm run tauri` DEVEM chamar `node_modules/@tauri-apps/cli/tauri.js` pelo `scripts/tauri.mjs`, que prepara CMake, libclang e o Vulkan SDK para o [whisper-rs](../whisper-rs/spec.md) e reaproveita um Vite já rodando.
  - `tauri dev` sobe `npm run dev:web` (`beforeDevCommand`) e abre `http://localhost:1420` (`devUrl`). `tauri build` roda `npm run build` (`beforeBuildCommand`) e empacota `../dist` com `bundle.targets: "all"`.
  - `build.rs` só chama `tauri_build::build()`, que gera `src-tauri/gen/schemas` (ignorado pelo git).

## Restrições

- **RNF-001**: `tauri` 2.12.x e `@tauri-apps/api` 2.12.x. O plugin `dialog` fica com a mesma versão no crate e no npm (2.8.3 nos dois).
- **RNF-002**: Só Windows 11 com o WebView2 Runtime Evergreen (156.0.4314.58 nesta máquina). `ICoreWebView2_19` exige runtime 1.0.2210 ou mais novo.
- **RNF-003**: `webview2-com` 0.39 e `windows-core` 0.62, as mesmas versões do wry (comentário em `Cargo.toml`): uma única entrada de cada no lock.
- **RNF-004**: Superfície mínima: 1 plugin (`dialog`), 1 capability com 11 permissões (contando `core:default`) e 77 comandos.
- **RNF-005**: Perfil de release com `codegen-units = 1`, `lto = true`, `opt-level = 3`, `panic = "abort"` e `strip = true`. O `jarvis.exe` tem 12,8 MB sem Vulkan e 64,3 MB com ele (67.414.528 bytes hoje em `t/release`).
- **RNF-006**: Porta fixa 1420 para o Vite (`devUrl` e `DEV_URL` em `scripts/tauri.mjs`).
- **RNF-007**: Todo o código Tauri tem licença permissiva (Apache-2.0 OR MIT, MIT).

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/tauri.conf.json` | Janela `main`, CSP, `devUrl`, `beforeDevCommand`, `beforeBuildCommand`, `bundle` |
| `src-tauri/capabilities/default.json` | ACL da janela `main` |
| `src-tauri/build.rs` | `tauri_build::build()` |
| `src-tauri/src/main.rs` | Entrada (`windows_subsystem = "windows"` no release) que chama `jarvis_lib::run()` |
| `src-tauri/src/lib.rs` | Builder, plugin `dialog`, permissões da WebView, 77 comandos, `setup`, `RunEvent::Exit`, `webview_background` |
| `src-tauri/Cargo.toml` | `tauri`, `tauri-build`, `tauri-plugin-dialog`, `webview2-com`, `windows-core`, perfis de build |
| `scripts/tauri.mjs` | Wrapper do CLI (ferramentas nativas, Vulkan, reuso do Vite) |
| `package.json` | Scripts `dev`, `tauri`, `build`; dependências `@tauri-apps/*` |
| `src/hooks/useWindowControls.ts` | Revelação da janela, atalhos de janela, `webview_background` |
| `src/App.tsx` | `getCurrentWindow` (tela cheia, minimizar, sair) e faixa `data-tauri-drag-region` |
| `src/components/Taskbar.tsx` | Arraste da janela pela barra superior |
| `src/lib/files.ts` · `src/lib/workspace.ts` | `open` e `save` do plugin `dialog` |
| `src/lib/*.ts` · `src/hooks/*.ts` | `invoke`, `listen`, `Channel` e `isTauri` nos adaptadores |

### Testes

- `npm run build`: o `tsc` confere os tipos de `@tauri-apps/api` e do plugin `dialog` em toda a UI.
- `npx playwright test tests/ui.spec.ts`: o caminho fora do Tauri ("Disponível no app desktop" na dock).
- `npm test`: toda a UI no modo web, com os adaptadores em fake (prova o `isTauri()` de cada um).
- `cargo test --lib` em `src-tauri` (com `CMAKE` e `LIBCLANG_PATH` exportados): os módulos por trás dos comandos.
- App real via CDP: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required" npm run dev` ([testing](../../../arch/testing.md)). Prova os critérios 2, 3, 4 e 7.
- `npm run tauri build -- --no-bundle` e depois `npm run perf`: tamanho do binário e custo do app.

### Atualização e reversão

- **Comando:** `npm i @tauri-apps/api@<versão> @tauri-apps/plugin-dialog@<versão>` e `npm i -D @tauri-apps/cli@<versão>`; em `src-tauri`, `cargo update -p tauri --precise <versão>` e `cargo update -p tauri-plugin-dialog --precise <versão>`. Se o `wry` novo mudar de `webview2-com` ou `windows-core`, acompanhe em `Cargo.toml` (`cargo tree -i webview2-com`).
- **Prova:** critérios 1 e 6, `npm run build`, `npm test`, `cargo test --lib` e um `npm run dev` conferindo a revelação da janela, um diálogo "Abrir arquivo", `F11`, `Ctrl+M` e `Ctrl+Q`.
- **Sinal de volta:** a janela não aparece ou pisca branca, a ACL recusa uma permissão que antes passava, `webview_background` deixa de compilar (duas versões de `webview2-com`), ou o CLI avisa que o crate e o pacote npm do plugin estão em versões diferentes.
- **Reversão:** volte `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` e `src-tauri/Cargo.lock` (`git checkout -- <arquivos>`), rode `npm ci` e recompile. Confira de novo os critérios 1 e 6.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0009 — Tipos espelhados entre TypeScript e Rust](../../../arch/adr/0009-tipos-espelhados-ts-rust.md)
- [ADR-0011 — Fakes de desenvolvimento; E2E no modo web; app real via CDP](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0022 — Núcleo com relógio de quadros limitado e UI em D3D11](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)

## Dependências

- Vendor: [react](../react/spec.md) e [vite-typescript](../vite-typescript/spec.md) (a UI servida em `devUrl` e empacotada de `dist`), [serde](../serde/spec.md) (os tipos que atravessam o IPC), [whisper-rs](../whisper-rs/spec.md) (o motivo das ferramentas nativas do `scripts/tauri.mjs`), [sherpa-onnx](../sherpa-onnx/spec.md) (DLLs ao lado do `jarvis.exe`), [playwright](../playwright/spec.md) (testes no modo web e via CDP).
- Specs: [desktop-windows](../../../features/desktop-windows/spec.md), [keyboard-shortcuts](../../../features/keyboard-shortcuts/spec.md), [boot](../../../features/boot/spec.md), [holographic-core](../../../features/holographic-core/spec.md) (`webview_background`), [jarvis-mark](../../../apps/jarvis-mark/spec.md) e [jv_ide](../../../apps/jv_ide/spec.md) (diálogos), [settings](../../../features/settings/spec.md), [ipc-contract](../../../arch/ipc-contract.md), [security](../../../arch/security.md), [build-and-env](../../../arch/build-and-env.md).
- Sistema: Windows 11 com WebView2 Runtime, Node 22+, Rust MSVC e VS Build Tools com C++.

## Pendências

- [ ] O `bundle` de `src-tauri/tauri.conf.json` não declara `resources`: o instalador de `npm run tauri build` não leva as DLLs do sherpa-onnx para o lado do `jarvis.exe`, e isso nunca foi verificado. Ver [sherpa-onnx](../sherpa-onnx/spec.md#pendências).
