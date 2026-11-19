# Build e ambiente

## Scripts npm

| Script | O que faz |
|---|---|
| `npm run dev` | `node scripts/tauri.mjs dev`: app desktop com hot reload |
| `npm run dev:web` | Só o Vite em `:1420`, usado pelo Playwright e pela UI no navegador |
| `npm run build` | `tsc && vite build`. O `tsc` é o **único gate estático** (não há linter) |
| `npm run tauri build` | Gera o instalador |
| `npm test` | `playwright test` (ver [testing](testing.md)) |
| `npm run new` | CLI `.cli/jarvis.mjs`: cria widget, app, feature ou ADR (specs + esqueletos) e imprime o checklist de registro ([ADR-0018](adr/0018-cli-scaffolding-so-cria-arquivos-novos.md)) |
| `npm run test:cli` | Testes do CLI (`node:test`) |
| `npm run perf` | `scripts/perf.mjs`: CPU, RAM e GPU do app rodando (ver [testing](testing.md#desempenho)) |

## `scripts/tauri.mjs`

É um wrapper do Tauri CLI que prepara as ferramentas nativas que o `whisper-rs` exige no Windows:

1. **CMake.** Usa o do PATH. Se não houver, busca a cópia que vem no Visual Studio Build Tools via `vswhere` e prepende ao `Path`.
2. **libclang.** Usa `LIBCLANG_PATH` ou `C:\Program Files\LLVM\bin\libclang.dll` (`winget install LLVM.LLVM`).
3. **Vulkan SDK.** Usa `VULKAN_SDK` ou a versão mais nova em `C:\VulkanSDK` (`winget install KhronosGroup.VulkanSDK`).
   - Com ele, `dev` e `build` ganham `--features vulkan` (Whisper na GPU, ver [ADR-0021](adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)) e `CMAKE_GENERATOR=Ninja` (ver [Pasta de build](#pasta-de-build-t)). Um `--features` passado à mão é respeitado.
   - Sem ele, o script avisa e a voz roda na CPU. O SDK só é usado na compilação: o app final carrega o `vulkan-1.dll` que vem com o driver de vídeo.
4. **Vite já rodando.** No `dev`, se o Vite com título "JARVIS OS" já responde em `:1420`, o script o reaproveita (zera `beforeDevCommand`) em vez de falhar com a porta ocupada.

Rodar `cargo` direto (por exemplo `cargo test`) exige exportar `CMAKE` e `LIBCLANG_PATH` à mão. Para testar a GPU, também `VULKAN_SDK`, `CMAKE_GENERATOR=Ninja` (com o `ninja.exe` no `Path`) e `--features vulkan`.

## Pasta de build (`t/`)

O cargo compila em `t/`, na raiz do repositório, e não em `src-tauri/target` (`.cargo/config.toml` na raiz, `build.target-dir = "t"`). O `tauri`, o `cargo` direto e o rust-analyzer seguem essa config, e o Vite não observa a pasta.
- Na raiz, e não em `src-tauri/.cargo`, porque o cargo não normaliza o caminho relativo: `"../t"` virava `src-tauri\..\t`, quase do mesmo tamanho.

O motivo é o limite de 260 caracteres do Windows (`MAX_PATH`), que o `cl.exe` e o MSBuild não ultrapassam mesmo com `LongPathsEnabled`. Com o Vulkan, o whisper.cpp compila o gerador de shaders como subprojeto CMake (`…/vulkan-shaders-gen-prefix/src/vulkan-shaders-gen-build/…`):
- **com o MSBuild**, os logs `VCTargetsPath.tlog\…` passavam do limite mesmo a partir de `t\` (`MSB3491`, `MSB4018`). Por isso, com o Vulkan, o `scripts/tauri.mjs` usa o gerador **Ninja** (`CMAKE_GENERATOR=Ninja`, com o `ninja.exe` que vem com o CMake do Visual Studio);
- **com o Ninja**, o mais fundo é o teste de ABI do compilador C++, `…/CMakeScratch/TryCompile-xxxxxx/CMakeFiles/cmTC_xxxxx.dir/CMakeCXXCompilerABI.cpp.obj`. Ele tem **257 caracteres** a partir de `t\release`, e o limite é 259.

**O nome tem uma letra de propósito:** `t` de *target*, a pasta de build padrão do cargo, encurtada. Medido em 2026-11-05, reconfigurando o gerador de shaders no caminho que cada nome daria:

| Pasta | Caminho mais fundo | Teste de ABI do compilador C++ |
|---|---|---|
| `t/` | 257 | passa (`CMAKE_CXX_ABI_COMPILED TRUE`) |
| `target/` | 262 | **falha** ("Detecting CXX compiler ABI info - failed", `CMAKE_CXX_ABI_COMPILED FALSE`) |

Com `target/`, o gerador ainda compila, mas o CMake segue sem as informações de ABI. Qualquer nome com mais de 3 letras passa do limite. Um nome de 3 letras (`out`) fica exatamente em 259, sem folga.

Um clone num caminho mais fundo que `C:\www\side-projects\jarvis` (26 caracteres) pode voltar a bater no limite. Os builds só de CPU continuam no MSBuild: as pastas de build deles já foram configuradas assim, e o CMake não troca de gerador no lugar.

## Perfis de compilação (`src-tauri/Cargo.toml`)

| Perfil | Ajuste | Motivo |
|---|---|---|
| `dev.package."*"` | `debug = false` | Os PDBs deixavam os builds de dev vários GB maiores, e o disco C: chegou a zerar |
| `dev.package.whisper-rs-sys` | `opt-level = 3` | O whisper.cpp sem otimização é inutilizável |
| `release` | `codegen-units = 1`, `lto`, `opt-level = 3`, `panic = "abort"`, `strip` | Binário menor |
| `[lib] crate-type` | só `rlib` | A `staticlib` e a `cdylib` do template do Tauri são para mobile; cada build (com LTO no release) as linkava à toa |
| `[features] vulkan` | `whisper-rs/vulkan` | Whisper na GPU; ligada pelo `scripts/tauri.mjs` quando o Vulkan SDK existe |

## Dependências nativas fixadas

- **`sherpa-onnx = "=1.13.8"`** com `default-features = false, features = ["shared"]`. A versão 2.x perdeu o espeak-ng e, com ele, o português; o `static` baixaria cerca de 122 MB. Ver [ADR-0005](adr/0005-tts-sherpa-onnx-1-13-8.md).
- **DLLs do sherpa.** O Windows 11 traz um `onnxruntime.dll` 1.17 em `System32`. Um binário sem as DLLs do sherpa ao lado carrega essa versão e quebra ("API version 28 not available", ACCESS_VIOLATION).
  - O build do crate copia as DLLs para `t/debug`.
  - Os binários de teste rodam de `t/debug/deps`, então é preciso copiar `sherpa-onnx-c-api.dll`, `onnxruntime.dll` e `onnxruntime_providers_shared.dll` para lá antes dos testes que sintetizam.
- **`whisper-rs = "0.16"`**: na CPU por padrão; com a feature `vulkan`, no backend Vulkan do whisper.cpp. Ver [ADR-0021](adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md).
- **`webview2-com = "0.39"` e `windows-core = "0.62"`**, as mesmas versões do wry: as interfaces do WebView2 por trás do `webview_background` (meta de memória baixa com a janela escondida).

## Requisitos da máquina

O README lista o mínimo: Windows 11, CPU com 8 threads ou mais, 16 GB de RAM, cerca de 15 GB livres para compilar, WebView2, Node 22+, Rust MSVC, VS Build Tools com C++ e CMake, LLVM e o Claude Code com login feito.

A máquina de desenvolvimento tem particularidades conhecidas: o microfone do notebook entrega silêncio digital quando a tecla de mudo está ativa, e o disco C: enche de forma transitória. Antes de suspeitar do código, confira o nível do microfone e o espaço livre.

## Pendências

- [x] ~~`scripts/tauri.mjs` prepara o `VULKAN_SDK`, mas o `whisper-rs` não ativa a feature `vulkan`.~~ A feature `vulkan` existe e o script a liga quando acha o SDK (2026-11-04).
- [x] Vulkan SDK 1.4.363.0 instalado nesta máquina e CPU × Intel × NVIDIA medidos ([ADR-0021](adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).
- [ ] O build do instalador (`npm run tauri build`) ainda não foi verificado com as DLLs do sherpa ao lado do `jarvis.exe`. Nenhum código do repositório faz essa cópia. Ver [tts](../features/tts/spec.md#known-limitations).
  - Conferido em 2026-11-19 só para o build sem instalador (`npm run tauri build -- --no-bundle`): o build do crate deixa `sherpa-onnx-c-api.dll`, `sherpa-onnx-cxx-api.dll`, `onnxruntime.dll` e `onnxruntime_providers_shared.dll` em `t\release`, ao lado do `jarvis.exe`, e o app abre de lá. A síntese de voz e o instalador não foram testados.
