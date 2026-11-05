# Estratégia de testes

Há três níveis. A decisão está no [ADR-0011](adr/0011-fakes-de-dev-e-e2e-modo-web.md).

| Nível | Ferramenta | Cobre | Não cobre |
|---|---|---|---|
| **E2E da UI** | Playwright contra `npm run dev:web` (Vite) | Todo comportamento visível, com os backends substituídos por fakes de DEV | Rust, `claude.exe`, áudio real |
| **Unidade Rust** | `cargo test` (`mod tests` inline) | Matcher, settings, parsers, git, workspace, MCP, terminal | UI |
| **App real** | Playwright via CDP na WebView2 | Push-to-talk, estados do motor, persistência de settings | É manual e não está no CI |
| **CLI `.cli/`** | `npm run test:cli` (`node:test`) | Nomes, templates, prompts, checklist e execuções completas numa cópia temporária dos arquivos que o CLI lê | O app |

## Playwright (`playwright.config.ts`)

- `testDir: tests`, `workers: 1`, timeout de 120 s, Edge do sistema (`channel: "msedge"`) headless.
- `baseURL: http://localhost:1420`. O `webServer` sobe `npm run dev:web` com `reuseExistingServer: true`.
- O `storageState` semeia o localStorage com boot desligado, barra superior desligada e núcleo 3D.
- Projetos:

| Projeto | Specs | Particularidade |
|---|---|---|
| `ui` | **lista explícita** em `testMatch`: ui, settings, desktop, boot, search, tui, taskbar, dock, music, voicetab, shell, core, meters, widgets, outline, ide, lab, lab-engine, assistant, agent, speech, shortcuts, personality, feeds, tasks | Flags de GPU |
| `voice` | `voice.spec.ts` | Microfone falso do Chromium, permissão concedida |
| `voice-denied` | `voice-denied.spec.ts` | Microfone falso, permissão negada |

> ⚠ Um `tests/<nome>.spec.ts` novo **não roda** até entrar no regex do projeto `ui`.

### Fakes e probes

`tests/helpers.ts` **não** mocka `invoke`. Os specs ligam os fakes do próprio app antes de carregar a página:

```ts
await page.addInitScript(() => { window.__JARVIS_ASSISTANT__ = { /* roteiro */ }; });
```

| Flag | Substitui |
|---|---|
| `__JARVIS_ASSISTANT__` | `claude.exe` (stream de eventos roteirizado) |
| `__JARVIS_FS__` / `__JARVIS_FS_FAKE__` | workspace do jv_ide |
| `__JARVIS_TERMINAL__` | ConPTY |
| `__JARVIS_SPEECH__` | sherpa-onnx |
| `__JARVIS_SYSTEM__` | `system_stats` |
| `__JARVIS_QUOTES__` / `__JARVIS_WEATHER__` | feeds |
| `__JARVIS_CLEANUP__` | `assistant_sleep` |
| `__JARVIS_MUSIC__` | yt-dlp / player (`standInMusic` em helpers) |

Outros helpers:
- `waitForFrames` espera `window.__JARVIS__.signals.frames` avançar, ou seja, a cena desenhar.
- `hologramTint`, `measureHologram` e `regionLevel` medem pixels em screenshots reais.

### Convenções

- Arquivo `<feature>.spec.ts`. Títulos em inglês, como frases de comportamento ("opens the clock from the dock").
- Locators por papel e nome acessível em PT-BR. Use `exact: true` em rótulos curtos: "Iniciar" também casa com "Reiniciar".
- Spec retroativa: cada `test("…")` vira um cenário Dado/Quando/Então e uma tarefa na fase de testes, em Tarefas do `spec.md`.

### Armadilhas conhecidas

- **Não edite módulos servidos pelo Vite durante uma execução.** O HMR recarrega a página de teste. Arquivos novos, ainda não importados, não têm esse problema.
- Depois de `npm install` de dependência de frontend, **reinicie o `dev:web`**. Sem isso, o otimizador recarrega na primeira importação.
- Se o Vite responder 504 "Outdated Optimize Dep", ou servir uma transformação velha após uma rajada de edições, `touch vite.config.ts` reinicia o servidor no lugar. Confira o módulo servido com `curl localhost:1420/src/<arquivo>`.
- O Vite ignora `src-tauri/**`. Uma edição no `voice-commands.json` só chega à UI depois de `touch vite.config.ts`.
- **Persistência com debounce** (250 ms, settings 450 ms): leia o localStorage com `expect.poll`.
- **Semear uma chave:** espere os frames depois do `goto`, porque o StrictMode regrava o valor ao montar. As janelas abertas são gravadas em `jarvis.desktop` no `beforeunload`.
- **Apps lazy.** O React 19 segura o fallback do Suspense por pelo menos 300 ms. Por isso o `lazyApps.tsx` pré-carrega o chunk antes de abrir. Não "conserte" flakes desse tipo deixando o fake mais lento; meça a abertura.
- O xterm toma o foco um frame depois de montar. Espere a primeira saída do terminal antes de focar outra coisa.

## Rust

```powershell
# exporte CMAKE e LIBCLANG_PATH (ver build-and-env.md); vários filtros vão depois do --
cargo test --lib -- files:: settings::
# testes ignorados (modelos reais, rede, áudio): opt-in
cargo test --lib -- --ignored speech --nocapture
```

- As fixtures WAV ficam em `src-tauri/tests/fixtures/`: `claude`, `command_vscode`, `terminal`, `unrelated`, `wake_command`, `wake_only`, `window_open` e `window_close`.
- `JARVIS_TEST_MODEL=<id>` escolhe o modelo Whisper dos testes de fala.
- `JARVIS_TEST_DEVICE=cpu|auto|<nome da GPU>` escolhe onde ele roda (builds com `--features vulkan`); `speech_lists_gpus` imprime os nomes, e cada teste imprime o tempo de carga e o dispositivo.
- `speech_gate` roda o Silero VAD de verdade: as fixtures de fala passam, ruído branco, zumbido e silêncio não.
- Testes que sintetizam voz, e o `speech_gate`, precisam das DLLs do sherpa em `t/debug/deps` ([build-and-env](build-and-env.md)).

## Desempenho

`npm run perf -- [--seconds 60] [--label nome] [--json saida.json] [--pid N]` mede o app rodando: o `jarvis.exe` e todos os filhos (os processos do WebView2, o `claude.exe`, os terminais).

- **CPU** pelo tempo de kernel + usuário de cada processo, em ms de CPU por segundo e em % da máquina.
- **GPU** pelo tempo de execução bruto dos motores (`Win32_PerfRawData_GPUPerformanceCounters_GPUEngine`, a mesma fonte do Gerenciador de Tarefas), exato na janela medida, por adaptador (dGPU, iGPU).
- **Memória**: bytes privados no fim (os do WebView2 compartilham páginas, então o working set contaria duas vezes) e memória de GPU por processo.
- Usa as classes WMI "raw", cujos nomes não são traduzidos, ao contrário dos caminhos do `Get-Counter` num Windows em pt-BR.
- `npm run perf -- --compare antes.json depois.json` mostra a diferença dos totais.

Meça o **build de release** (`npm run tauri build -- --no-bundle`): o modo dev (React de desenvolvimento, módulos sem minificar, StrictMode) distorce os números. Os cenários de referência são 2D ocioso, 3D ocioso, 3D com uma janela TUI aberta e "Hey Jarvis" em espera, cada um depois de 15 s de assentamento, com a janela em foco. Para dirigir o app, use o CDP (seção abaixo); no release o `window.__JARVIS__` não existe, então mude o `localStorage` e use a busca e os atalhos.

## CLI (`.cli/`)

`npm run test:cli` roda `.cli/test/jarvis.test.mjs`, com `node:test` e sem dependências. As execuções completas copiam para uma pasta temporária os arquivos que o CLI lê: templates, ADRs, `desktop.ts`, o catálogo de voz, `settings.rs`, `playwright.config.ts` etc. Depois, conferem duas coisas:
- que só arquivos novos apareceram (por hash);
- que os trechos do checklist batem, por exemplo o tamanho dos arrays do Rust e o JSON da frase de voz.

Os testes Playwright que o CLI gera (`tests/<id>.spec.ts`) só rodam depois que o id entra no `testMatch` do projeto `ui`.

## App real via CDP

1. Feche o JARVIS que estiver aberto: uma segunda instância falha com `0x8007139F`. Faça backup de `%APPDATA%\dev.jarvis.os\settings.json`.
2. Rode `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required" npm run dev`. A variável sobrescreve o `additionalBrowserArgs` do `tauri.conf.json`, então repita as flags que importam.
3. Espere `http://127.0.0.1:9333/json/version` e conecte com `chromium.connectOverCDP(...)`. Use `browser.contexts()[0].pages()[0]`.
4. O aria-label do botão Voz reflete o estado do motor: "Voice · carregando", "solte para enviar", "segure para falar".
5. Ao terminar, feche com `CloseMainWindow()` e restaure o settings. Antes de matar algo na porta 1420, confira de quem é: pode ser o Vite do próprio usuário.

## Vídeos de demonstração (`demos/`)

Os roteiros em `demos/*.demo.ts` gravam vídeos mudos de 1920×1080 a 30 fps do jvOS no modo web, com os fakes de DEV. A decisão está no [ADR-0020](adr/0020-videos-demo-gravados-playwright-modo-web.md).

```powershell
npm run demo                      # grava todos, converte para MP4 e junta o tour
npm run demo -- foco papai        # só os vídeos cujo nome casa com os filtros
node demos/run.mjs --encode-only  # só reconverte os WebM que já existem
```

- **Pré-requisitos:**
  - `npx playwright install ffmpeg` (o `page.screencast` grava com ele);
  - `winget install Gyan.FFmpeg.Essentials` (o MP4). O `run.mjs` acha o ffmpeg no PATH ou na pasta do WinGet.
- **Saída** em `demos/out/` (ignorada pelo git):
  - `webm/<nome>.webm`: a gravação, em VP9;
  - `mp4/<nome>.mp4`: H.264 `yuv420p`, que abre no VLC e no Windows Media Player;
  - `mp4/00-um-dia-com-o-jarvis.mp4`: todos em ordem.
- **Config** (`demos/playwright.config.ts`):
  - Edge **headed**, para usar a GPU real. O headless cai no SwiftShader e o holograma fica sem fluidez. `DEMO_HEADLESS=1` força o headless.
  - Flags contra throttling de janela coberta ou em segundo plano.
  - `--mute-audio` e `--autoplay-policy=no-user-gesture-required`.
  - O projeto `warmup` abre cada app lazy antes das tomadas.
- **A fixture** (`demos/lib/demo.ts`, `demo.start({ at, core, boot, storage, fakes, setup })`):
  - **Relógio:** move o `Date` para o horário da cena. O rAF e o `performance.now` ficam reais, porque o `page.clock` travaria o three.js.
  - **Sementes:** grava o `localStorage` uma vez por contexto, incluindo `jarvis.desktop` com as posições de `LAYOUT`.
  - **Fakes:** liga o assistente, a fala (330 ms por palavra), os medidores com variação, a bateria a 87 % e a música muda.
  - **Holograma:** "ouve" enquanto `__DEMO__.listening` está ligado e "fala" enquanto `jarvis-reply-words` está na tela.
  - **Avisos do navegador:** esconde o aviso das Configurações e troca "modo navegador · só visual" no boot por "Whisper Small", como o app desktop mostra.
  - **Gravação:** começa depois que a dock entra. No vídeo do boot, começa numa página preta.
- **Voz sem microfone:**
  - `demo.heard(fala)`: o núcleo ouve e depois `hear()` mostra a legenda;
  - `shortcut`, `window`, `music`, `pomodoro` e `closeGroup` chamam os handlers do `__JARVIS__`;
  - `ask(fala, { reply, files })` troca o `__JARVIS_ASSISTANT__` antes de perguntar;
  - `action(tool, args)` faz o papel das ferramentas MCP.
- **Dados das cenas** (`demos/lib/fixtures.ts`): `NAME`, clima, cotações, agenda, tarefas, notas, o agente e `LAYOUT`.
  - As janelas abrem nas laterais, fora da faixa do núcleo (x 710–1210). Elas ficam acima das falas do JARVIS (`z-[15]` contra `z-[11]`).
- **Conferir uma tomada:** uma folha de contato mostra o vídeo inteiro numa imagem.

  ```bash
  ffmpeg -i demos/out/webm/02-bom-dia.webm -vf "fps=1/5,scale=480:-1,tile=4x5" -frames:v 1 folha.png
  ```

- **Armadilhas:**
  - Não edite arquivos servidos pelo Vite durante a gravação.
  - O aviso de lembrete e o da limpeza são `role="status"`; não use `dock-toast`.
  - As buscas mostram rótulos com outra caixa ("Organizar janelas lado a lado"); compare sem diferenciar maiúsculas.
  - Um app maximizado cobre o núcleo, que para de desenhar: `demo.frames()` não avança atrás dele.
