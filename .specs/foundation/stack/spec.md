# Fundamento: Stack

As linguagens, os frameworks, o toolchain e as versões com que o jvOS é construído, testado e empacotado.

| | |
|---|---|
| **ID** | `foundation/stack` |
| **Status** | Implementado |
| **Origem** | `42e671a` (23/10), com as evoluções até `e7151cf` (05/11) |
| **Fonte das versões** | `package.json` + `package-lock.json` · `src-tauri/Cargo.toml` + `Cargo.lock` (resolvidas em 05/11) |
| **Detalhe** | [build-and-env](../../arch/build-and-env.md) · [testing](../../arch/testing.md) · [coding-style](../../arch/coding-style.md) |

## Objetivo

Qualquer pessoa com os requisitos do README compila, testa e empacota o jvOS a partir de um clone limpo, com as mesmas versões travadas nos locks e um único comando por tarefa.

## Não-objetivos

- Linter ou formatador. O `tsc` em modo estrito é o único gate estático do front-end (`npm run build`).
- Outro gerenciador de pacotes. O projeto usa só o npm e o `package-lock.json`.
- Build para outro SO ou arquitetura. Só Windows 11 64-bit com o toolchain MSVC.
- Versão mínima do Rust declarada. O `Cargo.toml` não tem `rust-version`, e o README pede o Rust stable.

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** um clone limpo e o `npm ci`
- **Quando** rodo `npm ls react three typescript vite @tauri-apps/api`
- **Então** saem as versões do lock: `react@19.3.1`, `three@0.186.1`, `typescript@6.0.3`, `vite@8.3.4` e `@tauri-apps/api@2.12.4`.

### Critério 2 (RNF-002)

- **Dado** o `Cargo.lock` do repositório
- **Quando** rodo `cargo tree -p sherpa-onnx --depth 0` em `src-tauri`
- **Então** sai `sherpa-onnx v1.13.8`, a versão travada com `=` ([ADR-0005](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).

### Critério 3 (RF-001)

- **Dado** o código de `src/` sem erros de tipo
- **Quando** rodo `npm run build`
- **Então** o `tsc` passa em modo estrito e o Vite gera `dist/`.

### Critério 4 (RF-002)

- **Dado** uma máquina sem o Vulkan SDK
- **Quando** rodo `npm run dev` ou `npm run tauri build`
- **Então** o script avisa "[jarvis] Vulkan SDK not found (winget install KhronosGroup.VulkanSDK): speech recognition runs on the CPU." e compila sem a feature `vulkan`.

### Critério 5 (RF-002)

- **Dado** o Vulkan SDK em `C:\VulkanSDK` e o `ninja.exe` do CMake do Visual Studio
- **Quando** rodo `npm run tauri build`
- **Então** o log mostra "[jarvis] Vulkan SDK at C:\VulkanSDK\<versão>: speech recognition can run on the GPU.", e o build sai com `--features vulkan` e o gerador Ninja.

### Critério 6 (RF-003)

- **Dado** a máquina sem o LLVM e sem `LIBCLANG_PATH`
- **Quando** rodo `npm run dev`
- **Então** o script avisa "[jarvis] libclang not found: install LLVM (winget install LLVM.LLVM) or set LIBCLANG_PATH." antes de o `whisper-rs` falhar na compilação.

### Critério 7 (RNF-003)

- **Dado** qualquer build do Rust (`tauri`, `cargo` direto ou rust-analyzer)
- **Quando** a compilação termina
- **Então** os artefatos estão em `t/`, na raiz do repositório, e não em `src-tauri/target`.

## Casos de borda

- **Vazio/nulo:** sem CMake no `Path` → o `scripts/tauri.mjs` busca o do Visual Studio Build Tools com `vswhere`; sem nenhum, avisa "[jarvis] CMake not found: install it or add the 'C++ CMake tools' component of Visual Studio.".
- **Duplicidade/idempotência:** o Vite já aberto em `:1420` com o título "JARVIS OS" → o `npm run dev` o reaproveita em vez de falhar com a porta ocupada.
- **Concorrência/corrida:** um build com Vulkan depois de um só de CPU na mesma pasta → as pastas CMake do whisper.cpp ficam no gerador em que nasceram, e o CMake não troca de gerador no lugar ([build-and-env](../../arch/build-and-env.md#pasta-de-build-t)).
- **Permissões/visibilidade:**
  - um clone mais fundo que `C:\www\side-projects\jarvis` (26 caracteres) pode voltar a passar dos 260 caracteres do `MAX_PATH` no build com Vulkan;
  - o `onnxruntime.dll` 1.17 do `System32` quebra os binários de teste que sintetizam voz sem as DLLs do sherpa ao lado ([build-and-env](../../arch/build-and-env.md#dependências-nativas-fixadas)).

## Componentes

### Front-end (`package.json`, `tsconfig.json`, `vite.config.ts`)

| Camada | Tecnologia | Versão resolvida | Spec |
|---|---|---|---|
| UI | React + React DOM | 19.3.1 | [react](../vendor/react/spec.md) |
| Linguagem | TypeScript, `strict`, alvo ES2020, `moduleResolution: bundler` | 6.0.3 | [vite-typescript](../vendor/vite-typescript/spec.md) |
| Dev server e bundler | Vite + `@vitejs/plugin-react` | 8.3.4 · 6.1.2 | [vite-typescript](../vendor/vite-typescript/spec.md) |
| Estilo | Tailwind CSS 4 (`@tailwindcss/vite`), tokens `@theme hud-*` | 4.3.3 | [tailwind](../vendor/tailwind/spec.md) |
| Animação | motion | 14.4.0 | [motion](../vendor/motion/spec.md) |
| 3D | three + @react-three/fiber + postprocessing | 0.186.1 · 9.8.2 · 6.39.5 | [three](../vendor/three/spec.md) |
| Editores | CodeMirror 6 | `@codemirror/view` 6.43.15 | [codemirror](../vendor/codemirror/spec.md) |
| Terminal | xterm.js | 6.0.0 | [terminal](../vendor/terminal/spec.md) |
| Markdown | react-markdown + remark-gfm | 10.1.0 · 4.0.1 | [markdown](../vendor/markdown/spec.md) |
| Ícones e fonte | lucide-react · VT323 | 1.59.0 · 5.3.0 | [lucide](../vendor/lucide/spec.md), [vt323](../vendor/vt323/spec.md) |

- **Comportamento:**
  - **RF-001**: O front-end DEVE passar no `tsc` estrito (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) antes de qualquer build.
  - O `package.json` é ESM (`"type": "module"`), e os scripts de `scripts/`, `.cli/` e `demos/` são Node puro.

### Desktop e Rust (`src-tauri/Cargo.toml`, `tauri.conf.json`)

| Camada | Tecnologia | Versão resolvida | Spec |
|---|---|---|---|
| Casca | Tauri 2 (`tauri`, `tauri-build`, CLI, `@tauri-apps/api`) | 2.12.4 · 2.7.3 · 2.12.3 · 2.12.4 | [tauri](../vendor/tauri/spec.md) |
| Linguagem | Rust, edição 2024, toolchain stable MSVC | rustc 1.97.1 nesta máquina | — |
| Reconhecimento de voz | whisper-rs → whisper.cpp | 0.16.0 (`whisper-rs-sys` 0.15.0) | [whisper-rs](../vendor/whisper-rs/spec.md) |
| Síntese de voz e porteiro | sherpa-onnx (`shared`) | 1.13.8 | [sherpa-onnx](../vendor/sherpa-onnx/spec.md) |
| Áudio | cpal | 0.18.2 | [cpal](../vendor/cpal/spec.md) |
| Terminal | portable-pty (ConPTY) | 0.9.0 | [terminal](../vendor/terminal/spec.md) |
| HTTP | ureq (cliente) · tiny_http (MCP) | 3.4.2 · 0.12.0 | [http](../vendor/http/spec.md) |
| Serialização | serde + serde_json | 1.0.229 · 1.0.154 | [serde](../vendor/serde/spec.md) |
| Arquivos | notify, ignore, regex, trash, dunce | 8.2.1 · 0.4.33 · 1.13.1 · 5.2.9 · 1.0.5 | [workspace-fs](../vendor/workspace-fs/spec.md) |
| Downloads | tar, bzip2, sha2 | 0.4.46 · 0.6.1 · 0.10.9 | [archives](../vendor/archives/spec.md) |

- **Comportamento:**
  - **RF-002**: O `scripts/tauri.mjs` DEVE ligar `--features vulkan` e `CMAKE_GENERATOR=Ninja` quando acha o Vulkan SDK, e compilar só para a CPU quando não acha, com um aviso. Um `--features` passado à mão é respeitado.
  - **RF-003**: O script DEVE preparar o CMake (do `Path` ou do Visual Studio, via `vswhere`) e o libclang (`LIBCLANG_PATH` ou `C:\Program Files\LLVM\bin\libclang.dll`) antes de chamar o Tauri CLI, e avisar quando faltar algum.
  - Os perfis de compilação estão em [build-and-env](../../arch/build-and-env.md#perfis-de-compilação-src-tauricargotoml): `debug = false` nas dependências de dev, `opt-level = 3` no `whisper-rs-sys` e LTO com `strip` no release.

### Modelos e programas externos

Baixados ou encontrados em tempo de execução, nunca compilados:

| Item | Spec |
|---|---|
| Modelos Whisper (Small por padrão, Base, Large V3 Turbo) | [whisper-models](../vendor/whisper-models/spec.md) |
| Silero VAD | [silero-vad](../vendor/silero-vad/spec.md) |
| Vozes Piper em pt-BR · Kokoro | [piper-voices](../vendor/piper-voices/spec.md), [kokoro](../vendor/kokoro/spec.md) |
| Claude Code (`claude.exe`) e os modelos Claude | [claude-code](../vendor/claude-code/spec.md) |
| yt-dlp · git | [yt-dlp](../vendor/yt-dlp/spec.md), [git](../vendor/git/spec.md) |

### Testes e ferramentas de desenvolvimento

| Ferramenta | Uso | Spec |
|---|---|---|
| Playwright 1.64.1 | E2E no modo web (`npm test`), vídeos de demo (`npm run demo`) e o app real via CDP | [playwright](../vendor/playwright/spec.md) |
| `node:test` | Testes do CLI (`npm run test:cli`) | — |
| `cargo test --lib` | Testes Rust, rodados de `src-tauri` | — |
| `scripts/perf.mjs` | CPU, RAM e GPU do app rodando (`npm run perf`) | — |
| `.cli/jarvis.mjs` | Scaffolding de specs e esqueletos (`npm run new`) | — |

## Restrições

- **RNF-001**: As versões instaladas são as do `package-lock.json`. Faixas `~` travam o minor de `react`, `react-dom`, `three`, `@types/three` e `typescript`. As outras usam `^`.
- **RNF-002**: `sherpa-onnx = "=1.13.8"`, sem `default-features`, só com `shared`. A 2.x perdeu o português ([ADR-0005](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)).
- **RNF-003**: O Cargo compila em `t/` (`.cargo/config.toml`, `build.target-dir = "t"`) por causa do `MAX_PATH` do Windows.
- **RNF-004**: Requisitos da máquina (README): Windows 11 64-bit, 8 threads ou mais, 16 GB de RAM, cerca de 15 GB livres para compilar mais cerca de 1 GB de modelos, Node.js 22+, Rust stable (MSVC), Visual Studio Build Tools com C++ e CMake, LLVM, WebView2. O Vulkan SDK é opcional.
- **RNF-005**: O `jarvis.exe` de release tem 12,8 MB só com CPU e 64,3 MB com Vulkan, porque leva os shaders da GPU ([ADR-0021](../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).

## Critérios de sucesso

- **SC-001**: Um clone limpo numa máquina com os requisitos chega ao app rodando com `npm install` e `npm run dev`, sem passos à mão.
- **SC-002**: Toda versão usada está num lock, e a troca de uma delas aparece no diff.

## Entregáveis

A stack é declarada em quatro arquivos versionados e montada por um wrapper. Os detalhes de ambiente e as armadilhas da máquina estão em [build-and-env](../../arch/build-and-env.md).

### Arquivos

| Arquivo | Papel |
|---|---|
| `package.json` · `package-lock.json` | Dependências npm e scripts |
| `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` | Crates, feature `vulkan` e perfis de compilação |
| `.cargo/config.toml` | Pasta de build `t/` |
| `scripts/tauri.mjs` | Wrapper do Tauri CLI: CMake, libclang, Vulkan, Ninja e o Vite já aberto |
| `tsconfig.json` · `tsconfig.node.json` · `vite.config.ts` | TypeScript e Vite |
| `src-tauri/tauri.conf.json` | Janela, CSP e os comandos de build do front-end |
| `playwright.config.ts` | Projetos `ui`, `voice` e `voice-denied` |

### Testes

- `npm ci && npm ls react three typescript vite @tauri-apps/api`: versões do lock (critério 1).
- `cargo tree -p sherpa-onnx --depth 0` (em `src-tauri`): o pin do sherpa (critério 2).
- `npm run build`: o gate do `tsc` (critério 3).
- `npm run dev` com e sem o Vulkan SDK e sem o LLVM: as mensagens do `scripts/tauri.mjs` (critérios 4 a 6).
- `cargo build` (em `src-tauri`) e conferir que `t/debug` foi criado: critério 7.
- `npm test`, `npm run test:cli` e `cargo test --lib`: a stack inteira de testes.

### Reversão

- Uma dependência volta de versão com o lock anterior (`git checkout <commit> -- package-lock.json` ou `Cargo.lock`) e o `npm ci` ou `cargo build` seguinte. Cada spec de vendor diz o sinal de volta da sua.
- A pasta `t/` volta a ser `src-tauri/target` apagando `.cargo/config.toml`. Isso só é seguro sem o Vulkan, por causa do `MAX_PATH`.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0005 — sherpa-onnx fixado em 1.13.8](../../arch/adr/0005-tts-sherpa-onnx-1-13-8.md)
- [ADR-0011 — Fakes de DEV, E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0017 — UI em PT-BR, código em inglês](../../arch/adr/0017-ui-pt-br-codigo-en.md)
- [ADR-0021 — Voz na GPU via Vulkan](../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)

## Dependências

- **Vendor:** todas as specs de [`foundation/vendor/`](../vendor/), listadas nas tabelas acima
- **Specs:** [architecture](../architecture/spec.md) (como as peças se encaixam)
- **Sistema:** Windows 11, WebView2 Runtime, Node.js 22+, Rust stable MSVC, Visual Studio Build Tools (C++ e CMake), LLVM, Vulkan SDK (opcional)

## Pendências

- [ ] O `README` pede Node.js 22+, mas o Vite 8.3.4 exige `^20.19.0 || >=22.12.0`: um Node 22.0 a 22.11 cumpre o README e não roda o Vite. Nenhum `engines` no `package.json` avisa.
- [ ] O `npm run build` roda o `tsc` sem `-b`, então `vite.config.ts`, `playwright.config.ts`, `tests/` e `demos/` não passam pela checagem de tipos ([vite-typescript](../vendor/vite-typescript/spec.md#pendências)).
- [ ] Sem `rust-version` no `Cargo.toml`: a edição 2024 exige o Rust 1.85 ou mais novo, e isso não está escrito em lugar nenhum do repositório.
