# Vendor: Playwright

O Playwright roda a suíte E2E do jvOS no modo web, grava os vídeos de demonstração e dirige o app real pela porta de depuração da WebView2.

| | |
|---|---|
| **ID** | `vendor/playwright` |
| **Tipo** | Lib npm (dev) |
| **Status** | Em uso |
| **Versão** | `@playwright/test` 1.64.1 (declarada `^1.64.1`, dev)<br>Traz `playwright` e `playwright-core` 1.64.1 |
| **Licença** | Apache-2.0 |
| **Fonte** | https://playwright.dev (https://github.com/microsoft/playwright) |
| **Onde roda** | testes (Node + o Edge instalado no Windows, `channel: "msedge"`) · vídeos de demo (Edge com janela) · CDP na WebView2 do app real |

## Objetivo

Quase todo o comportamento visível do jvOS é React, mas o app real depende de Rust, microfone, modelos e `claude.exe`. O [ADR-0011](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md) escolheu testar a UI no `npm run dev:web` com os fakes de DEV ligados por `addInitScript`, e o Playwright é a ferramenta disso. O mesmo Playwright grava os vídeos de demonstração ([ADR-0020](../../../arch/adr/0020-videos-demo-gravados-playwright-modo-web.md)) e conecta no app real por CDP quando a mudança toca o motor de voz.

## Não-objetivos

- Sem baixar navegador: os testes usam o Edge do Windows (`channel: "msedge"`). Em `%LOCALAPPDATA%\ms-playwright` só há `ffmpeg-1013` e `winldd-1007`.
- Sem mock de `invoke` nem `page.route`: nenhum spec intercepta rede ou IPC. Os fakes são do próprio app (`window.__JARVIS_<X>__`).
- Sem paralelismo e sem novas tentativas: `workers: 1`, e o `retries` fica no padrão (0).
- Sem teste de componente (`@playwright/experimental-ct-react`) e sem CI configurado.
- Nas demos, sem `page.clock`, que travaria o three.js. A fixture troca só o `Date`.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** nada escutando em `:1420`
- **Quando** rodo `npm test`
- **Então** o `webServer` sobe `npm run dev:web`, espera até 60 s por `http://localhost:1420` e roda os três projetos (`ui`, `voice` e `voice-denied`) em série, com 120 s por teste. Com um servidor já em `:1420`, ele é reaproveitado (`reuseExistingServer: true`).

### Critério 2 (RF-002)

- **Dado** a config padrão
- **Quando** um teste abre a página
- **Então** o `localStorage` já tem `jarvis.boot` = `{"enabled":false,"sound":false}`, `jarvis.settings` = `{"taskbar":false}` e `jarvis.core` = `{"mode":"3d"}`. Os testes que precisam do boot ou do núcleo padrão usam `test.use({ storageState: { cookies: [], origins: [] } })` (`tests/core.spec.ts`, "from a fresh start").

### Critério 3 (RF-003)

- **Dado** um arquivo novo `tests/foo.spec.ts`
- **Quando** rodo `npx playwright test --list`
- **Então** ele não aparece em nenhum projeto até `foo` entrar na lista do `testMatch` do projeto `ui`. Hoje a lista tem 25 nomes, e os 27 specs de `tests/` estão cobertos (25 no `ui`, `voice.spec.ts` no `voice` e `voice-denied.spec.ts` no `voice-denied`).

### Critério 4 (RF-003)

- **Dado** o projeto `voice-denied`
- **Quando** rodo `npx playwright test --project voice-denied`
- **Então** o Edge sobe com o microfone falso (`--use-fake-device-for-media-stream`) e `--deny-permission-prompts`, e passa "denied microphone shows a discreet error and keeps rendering". No projeto `voice`, a permissão é concedida (`--use-fake-ui-for-media-stream`).

### Critério 5 (RF-005)

- **Dado** o ffmpeg do Playwright instalado (`npx playwright install ffmpeg`) e o ffmpeg completo no `PATH` ou na pasta do WinGet
- **Quando** rodo `npm run demo -- foco`
- **Então** saem `demos/out/webm/07-foco.webm` (VP9, 1920×1080, 30 fps, mudo) e `demos/out/mp4/07-foco.mp4` (H.264 `yuv420p`). Sem o ffmpeg do Playwright, `demos/run.mjs` para com "O ffmpeg do Playwright não está instalado. Rode: npx playwright install ffmpeg".

### Critério 6 (RF-004)

- **Dado** o Vite respondendo 504 "Outdated Optimize Dep" depois de um `npm install`
- **Quando** rodo a suíte
- **Então** o `waitForFrames` estoura o tempo em todos os specs, porque `window.__JARVIS__.signals.frames` não avança. `touch vite.config.ts` reinicia o servidor no lugar, e a suíte volta a passar ([armadilhas](../../../arch/testing.md#armadilhas-conhecidas)).

### Critério 7 (RF-006)

- **Dado** o app desktop aberto com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required" npm run dev`
- **Quando** conecto com `chromium.connectOverCDP("http://127.0.0.1:9333")` e pego `browser.contexts()[0].pages()[0]`
- **Então** o botão Voz expõe o estado do motor no `aria-label` ("Voice · carregando", "segure para falar", "solte para enviar"). Conferência manual ([testing](../../../arch/testing.md#app-real-via-cdp)).

## Casos de borda

- **Vazio/nulo:**
  - sem o Edge instalado, o `channel: "msedge"` não abre e nenhum teste roda;
  - sem servidor em `:1420`, o `webServer` sobe o Vite; se outro programa responder em `:1420`, o Playwright o reaproveita do mesmo jeito, porque só confere se a URL responde.
- **Duplicidade/idempotência:**
  - o `reuseExistingServer` usa o Vite do `tauri dev` do usuário, se estiver aberto. Depois de uma rajada de edições, esse servidor já serviu código velho; confira com `curl -s localhost:1420/src/<arquivo>`;
  - semear uma chave logo depois do `goto` não vale: o StrictMode regrava o valor ao montar. Espere os quadros antes.
- **Concorrência/corrida:**
  - editar um módulo servido pelo Vite durante a execução dispara o HMR e derruba testes ao acaso. Arquivos novos, ainda não importados, não têm esse problema;
  - a persistência tem debounce (250 ms; 450 ms nas settings): leia o `localStorage` com `expect.poll`;
  - o xterm toma o foco um quadro depois de montar: espere a primeira saída do terminal antes de focar outra coisa.
- **Permissões/visibilidade:**
  - no modo web, `isTauri()` é falso: o Rust, o `claude.exe` e o áudio real nunca rodam na suíte;
  - o Edge headless sem GPU cai no SwiftShader. Os projetos passam `--enable-gpu --ignore-gpu-blocklist`, e as demos rodam com janela pelo mesmo motivo;
  - o CDP grava o `%APPDATA%\dev.jarvis.os\settings.json` real (faça backup antes), e uma segunda instância do JARVIS falha com `0x8007139F`.

## Uso no jvOS

### Suíte E2E (`playwright.config.ts`)

- **Comportamento:**
  - **RF-001**: A suíte DEVE usar `testDir: "tests"`, `outputDir: "test-results/artifacts"`, `timeout: 120_000`, `workers: 1`, `reporter: list`, `baseURL: "http://localhost:1420"` e o `webServer` `npm run dev:web` com `reuseExistingServer: true` e 60 s de espera.
  - **RF-002**: O `storageState` DEVE semear o boot desligado, a barra superior desligada e o núcleo 3D em todo teste.
  - **RF-003**: Os projetos DEVEM ser `ui` (lista explícita de 25 nomes no `testMatch`, com `--enable-gpu --ignore-gpu-blocklist`), `voice` e `voice-denied` (microfone falso, permissão concedida ou negada), todos no Edge headless.

### Helpers e fakes (`tests/helpers.ts`, `tests/*.spec.ts`)

- **Comportamento:**
  - **RF-004**: Os specs DEVEM ligar os fakes com `page.addInitScript` antes de carregar a página (`__JARVIS_ASSISTANT__`, `__JARVIS_TERMINAL__`, `__JARVIS_FS__`, `__JARVIS_SPEECH__`…) e esperar a cena com `waitForFrames`, que lê `window.__JARVIS__.signals.frames` (45 quadros por padrão).
  - `hologramTint`, `regionLevel` e `measureHologram` medem pixels de capturas reais. As capturas vão para `test-results/screens`.
  - Os specs que medem a tela chamam `page.setViewportSize({ width: 1920, height: 1080 })`; os outros ficam no 1280×720 padrão.
  - Os títulos dos testes são frases em inglês, e os locators usam papéis e nomes em PT-BR, com `exact: true` em rótulos curtos.

### Vídeos de demo (`demos/playwright.config.ts`, `demos/run.mjs`, `demos/lib/demo.ts`)

- **Comportamento:**
  - **RF-005**: As demos DEVEM rodar no Edge com janela (`DEMO_HEADLESS=1` força o headless), a 1920×1080 e `deviceScaleFactor: 1`, com 300 s por roteiro, `--mute-audio` e as flags contra o throttling de janela coberta. O projeto `warmup` abre cada app lazy antes das tomadas.
  - `demos/run.mjs` acha o ffmpeg do Playwright em `PLAYWRIGHT_BROWSERS_PATH` ou em `%LOCALAPPDATA%\ms-playwright` e chama `npx playwright test -c demos/playwright.config.ts`.

### App real via CDP (`.specs/arch/testing.md`, procedimento manual)

- **Comportamento:**
  - **RF-006**: Mudanças no motor de voz ou na persistência das settings DEVEM ser conferidas no app real, com o Playwright conectado por `connectOverCDP` na porta 9333 da WebView2 ([ADR-0011](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)).
  - Nas medições do `npm run perf`, o release é dirigido pelo mesmo CDP, mudando o `localStorage` e usando a busca e os atalhos, porque o `window.__JARVIS__` não existe no release ([testing](../../../arch/testing.md#desempenho)).

## Restrições

- **RNF-001**: Um spec novo só roda se entrar no `testMatch` do projeto `ui` ([testing](../../../arch/testing.md)).
- **RNF-002**: `@playwright/test` 1.64.1 exige Node 20 ou mais novo (`engines`).
- **RNF-003**: O Edge do sistema é o 156.0.4314.58 nesta máquina. Ele atualiza sozinho, fora do lock.
- **RNF-004**: 27 specs com 162 chamadas `test(`, em série, até 120 s cada.
- **RNF-005**: Licença Apache-2.0. É dependência de dev e nunca entra no bundle.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `playwright.config.ts` | Projetos `ui`, `voice` e `voice-denied`, `storageState`, `webServer` |
| `tests/helpers.ts` | `waitForFrames`, `frames`, `hologramTint`, `regionLevel`, `measureHologram`, `standInMusic`, `SCREENS` |
| `tests/*.spec.ts` | Os 27 specs |
| `demos/playwright.config.ts` · `demos/warmup.setup.ts` · `demos/*.demo.ts` | As 14 demos e o aquecimento |
| `demos/lib/demo.ts` · `demos/lib/fixtures.ts` · `demos/run.mjs` | Fixture, dados das cenas, gravação e conversão para MP4 |
| `.gitignore` | `test-results`, `playwright-report` |

### Testes

- `npm test`: a suíte inteira (critérios 1 e 2).
- `npx playwright test --list`: o que cada projeto pega (critério 3).
- `npx playwright test --project voice` e `--project voice-denied` (critério 4).
- `npm run demo -- foco` e `node demos/run.mjs --encode-only` (critério 5).
- Manual: o 504 do Vite (critério 6) e o CDP no app real (critério 7).

### Atualização e reversão

- **Comando:** `npm i -D @playwright/test@<versão>`; depois, `npx playwright install ffmpeg`, porque a revisão do ffmpeg acompanha a versão.
- **Prova:** `npx playwright test --list` com o mesmo número de testes; `npm test` verde; `npm run demo -- boot` gerando o MP4.
- **Sinal de volta:** o `channel: "msedge"` deixa de abrir o Edge instalado; o `page.screencast` muda e as demos quebram; flakes novos de tempo; o `demos/run.mjs` não acha o ffmpeg.
- **Reversão:** `npm i -D @playwright/test@1.64.1` e `npx playwright install ffmpeg`.

### Decisões relacionadas

- [ADR-0011 — Fakes de DEV, E2E no modo web](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0013 — Núcleo 2D por padrão, 3D opcional](../../../arch/adr/0013-nucleo-2d-padrao.md)
- [ADR-0020 — Vídeos de demo gravados pelo Playwright no modo web](../../../arch/adr/0020-videos-demo-gravados-playwright-modo-web.md)

## Dependências

- **Vendor:** [vite-typescript](../vite-typescript/spec.md) (o `dev:web` que a suíte testa), [react](../react/spec.md) (o `StrictMode` e o `__JARVIS__`), [tauri](../tauri/spec.md) (a WebView2 do CDP).
- **Specs:** [testing](../../../arch/testing.md), todas as specs de [features](../../../features/), [widgets](../../../widgets/) e [apps](../../../apps/) (cada uma cita o seu `tests/<nome>.spec.ts`), [stack](../../stack/spec.md).
- **Sistema:** Microsoft Edge instalado; o ffmpeg do Playwright e o ffmpeg completo (`winget install Gyan.FFmpeg.Essentials`) para as demos; porta 1420 livre ou com o Vite do JARVIS; porta 9333 para o CDP.

## Pendências

- [ ] O `tsc` do `npm run build` só cobre `src/`: `tests/`, `demos/` e `playwright.config.ts` não passam por checagem de tipos, e o Playwright os transpila sem checar.
- [ ] `tests/ui.spec.ts`, "renderer and frame rate", não tem nenhum `expect`: só imprime o renderer e a taxa de quadros.
