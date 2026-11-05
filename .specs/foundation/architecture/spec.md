# Fundamento: Arquitetura

Como o jvOS se divide entre a WebView2, que desenha, e o processo Rust, que faz tudo o que é nativo, e as regras que mantêm essa divisão.

| | |
|---|---|
| **ID** | `foundation/architecture` |
| **Status** | Implementado |
| **Origem** | `42e671a` (23/10), com as evoluções até `e7151cf` (05/11) |
| **Detalhe** | [overview](../../arch/overview.md) (diagrama e fluxos) · [ipc-contract](../../arch/ipc-contract.md) · [constituição](../../arch/constitution.md) · [security](../../arch/security.md) |

## Objetivo

O jvOS é um app de janela única em que a WebView2 só desenha e o Rust é dono de tudo que é nativo. Cada feature cabe numa camada conhecida, funciona offline e pode ser testada no navegador sem o Tauri.

## Não-objetivos

- Janelas nativas múltiplas. Existe uma janela Tauri (`main`), e as "janelas" do desktop são componentes React.
- Acesso nativo direto da WebView. Os plugins `fs` e `shell` do Tauri não entram, e o HTTP para terceiros não sai da WebView.
- Servidor ou nuvem próprios. Os únicos serviços de rede são de terceiros (Yahoo, Open-Meteo, Hugging Face, GitHub, YouTube), chamados pelo Rust, e o `claude.exe` do próprio usuário.
- Mobile, macOS ou Linux. O alvo é o Windows 11 com WebView2, e o `[lib] crate-type` é só `rlib`.
- Gerar tipos TS a partir do Rust. Os contratos são espelhados por convenção ([ADR-0009](../../arch/adr/0009-tipos-espelhados-ts-rust.md)).

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o código de `src/components/`
- **Quando** procuro chamadas de comando com `grep -rln "invoke" src/components`
- **Então** não aparece nenhum arquivo: só `src/App.tsx`, `src/hooks/` e `src/lib/` chamam `invoke`.

### Critério 2 (RF-002)

- **Dado** só o Vite rodando (`npm run dev:web`, porta 1420), fora do Tauri
- **Quando** a suíte `npx playwright test --project ui` abre a UI no Chromium
- **Então** o boot, o desktop, os widgets e os apps funcionam com os fakes `window.__JARVIS_*__` ou com o estado "indisponível", e a suíte passa.

### Critério 3 (RF-003)

- **Dado** o modo de ativação "Sempre ouvindo" e a janela do jvOS minimizada
- **Quando** digo "Jarvis, abre o relógio"
- **Então** a thread `jarvis-voice` transcreve a frase e emite `voice:*`, e o Relógio está aberto quando a janela volta.

### Critério 4 (RF-004)

- **Dado** o app aberto, com a porta e o token do servidor MCP em `assistant\mcp.json`
- **Quando** um POST chega em `127.0.0.1:<porta>/mcp` com o cabeçalho `Origin`, ou sem o token bearer
- **Então** o servidor recusa o pedido (403 com `Origin`) e nenhuma tool roda.

### Critério 5 (RF-005)

- **Dado** a CSP de `src-tauri/tauri.conf.json` (`default-src 'self' ipc: http://ipc.localhost`)
- **Quando** o código da WebView tenta um `fetch` para um serviço de terceiros
- **Então** a WebView bloqueia o pedido, e cotações, clima, modelos e músicas chegam só pelos comandos do Rust.

### Critério 6 (RNF-001)

- **Dado** o JARVIS aquecido (um `claude.exe`) e uma aba aberta no jv_sh
- **Quando** fecho o jvOS
- **Então** nenhum `claude.exe` nem shell aberto pelo app continua rodando no Gerenciador de Tarefas.

### Critério 7 (RNF-002)

- **Dado** uma chave `jarvis.*` com JSON quebrado no `localStorage` ou um campo inválido no `settings.json`
- **Quando** o jvOS abre
- **Então** só aquela parte volta ao padrão, e o resto do estado salvo continua igual.

### Critério 8 (RF-006)

- **Dado** um PC sem o `claude.exe`
- **Quando** clico no núcleo e faço uma pergunta
- **Então** o JARVIS mostra "Claude Code não encontrado. Instale-o (claude.ai/code) e entre na sua conta rodando `claude` uma vez.", e o desktop, a voz local e os widgets continuam funcionando.

## Casos de borda

- **Vazio/nulo:** primeiro início, sem `settings.json` e sem nenhuma chave `jarvis.*` → tudo vem dos padrões (`settings.rs`, `src/lib/*`), e a janela aparece no primeiro quadro desenhado ou, no máximo, depois de 2,5 s (`REVEAL_FALLBACK` em `lib.rs`).
- **Duplicidade/idempotência:** o app não usa trava de instância única (nenhum `tauri-plugin-single-instance` no `Cargo.toml`) → duas instâncias sobem dois servidores MCP e dois motores de voz. ⚠ inferido — confirmar: os dois disputam o mesmo microfone.
- **Concorrência/corrida:**
  - As configurações ficam em `Arc<RwLock>` no `AppState` e são gravadas no `settings.json` por troca atômica de arquivo.
  - Uma tool MCP espera a resposta da UI por até 20 s.
  - As escritas do git passam por um lock global.
- **Permissões/visibilidade:**
  - O JARVIS fica confinado a `Documentos\JARVIS`, sem Bash ([ADR-0007](../../arch/adr/0007-jarvis-confinado-a-documentos.md)).
  - As capabilities da janela se limitam aos controles de janela e aos diálogos de abrir e salvar (`capabilities/default.json`).
  - As lacunas conhecidas estão em [security](../../arch/security.md#lacunas-conhecidas).

## Componentes

### Janela e WebView2 (`src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`)

A janela única que o jvOS ocupa.

- **Comportamento:**
  - **RF-007**: O app DEVE abrir uma única janela `main`, sem moldura (`decorations: false`), maximizada, com fundo `#000508` e mínimo de 1024 × 640.
  - A janela nasce invisível. A UI a mostra depois do primeiro quadro, e o Rust a revela sozinho depois de 2,5 s se a UI não o fizer.
  - Com a janela escondida, o `webview_background` pede à WebView2 a meta de memória baixa (`webview2-com`).
  - `Ctrl+Shift+D` liga a moldura nativa como saída de emergência ([keyboard-shortcuts](../../features/keyboard-shortcuts/spec.md)).

### Front-end React (`src/`)

Tudo o que o usuário vê: núcleo, dock, barra, janelas internas.

- **Comportamento:**
  - **RF-001**: Os componentes de `src/components/` NÃO DEVEM chamar `invoke`. O acesso ao Rust passa pelos adaptadores de `src/lib/` e pelos hooks de `src/hooks/`.
  - `App.tsx` monta uma vez os hooks que precisam viver com a janela fechada: pomodoro, lembretes, watchlist, player, voz, assistente e ações MCP.
  - Os apps e o núcleo 3D carregam sob demanda ([ADR-0012](../../arch/adr/0012-apps-lazy-com-preload.md), [ADR-0013](../../arch/adr/0013-nucleo-2d-padrao.md)).
  - **RF-002**: Fora do Tauri, cada adaptador DEVE responder com um fake de DEV (`window.__JARVIS_*__`, só com `import.meta.env.DEV`) ou com o estado "indisponível", sem quebrar a tela ([ADR-0011](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)).

### Ponte IPC (`invoke`, eventos e Channels)

O único caminho entre as duas camadas.

- **Comportamento:**
  - Um comando Tauri é fino e chama o módulo do domínio (P3). A lista completa está em [ipc-contract](../../arch/ipc-contract.md).
  - Os eventos seguem `domínio:evento` (`voice:*`, `assistant:action`). As respostas longas, como as do JARVIS, vêm por `Channel` (`delta`, `tool`, `file`, `done`).
  - Os tipos de cada lado são espelhados à mão: mudou um, muda o outro e o `ipc-contract` (P4).

### Núcleo Rust (`src-tauri/src/lib.rs`)

O dono do estado nativo e do ciclo de vida.

- **Comportamento:**
  - O `AppState` guarda as configurações em `Arc<RwLock>` e um `Arc`/`Mutex` por subsistema.
  - Na partida, o núcleo escreve as ferramentas do jv_sh, sobe o MCP, restaura a voz e revela a janela.
  - **RNF-001** (ver Restrições): ao sair, encerra o motor de voz, o `claude.exe` (`taskkill /T /F`) e os shells.

### Motor de voz (`src-tauri/src/voice/`)

O ouvido do JARVIS, independente da WebView.

- **Comportamento:**
  - **RF-003**: O motor DEVE rodar numa thread própria (`jarvis-voice`), que continua com a janela minimizada ([ADR-0003](../../arch/adr/0003-motor-de-voz-thread-rust.md)).
  - O caminho é cpal → porteiro Silero → Whisper → `matcher.rs` → `Decision` ([ADR-0021](../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)). Programas abrem no próprio Rust; o resto vira `voice:*`, e o texto não reconhecido vai para o JARVIS.

### Processos externos (`assistant.rs`, `mcp.rs`, `terminal.rs`, `git/`, `music.rs`)

O que roda fora do jvOS e como ele controla.

- **Comportamento:**
  - O `claude.exe` sobe aquecido, um por app, com as ferramentas restritas ([ADR-0006](../../arch/adr/0006-jarvis-via-claude-cli.md)).
  - **RF-006**: Sem o `claude.exe`, o JARVIS DEVE mostrar a mensagem `NOT_FOUND` de `assistant.rs`, e o resto do app continua igual.
  - **RF-004**: O servidor MCP DEVE escutar só em `127.0.0.1`, numa porta aleatória e com token novo a cada início, e recusar pedidos com `Origin` ([ADR-0008](../../arch/adr/0008-mcp-http-in-process.md)).
  - Os shells rodam em ConPTY, um por aba. O `git.exe` e o `yt-dlp.exe` rodam um por chamada, com timeout.
  - **RF-005**: Todo HTTP para terceiros DEVE sair do Rust (`feeds.rs`, `download.rs`, `music.rs`). A CSP da WebView não permite outro caminho.

### Persistência

Onde cada dado mora ([ADR-0010](../../arch/adr/0010-persistencia-settings-vs-localstorage.md), [persistence](../../domain/persistence.md)).

- **Comportamento:**
  - O `settings.json` é do Rust: esquema, sanitização e gravação atômica em `settings.rs`.
  - As chaves `jarvis.*` do `localStorage` são da UI, cada uma com o seu parser tolerante.
  - O JARVIS escreve em `Documentos\JARVIS`. Os modelos e as vozes ficam em `%LOCALAPPDATA%`.

## Restrições

Nas categorias do Design Doc do spec-coding.dev:

- **RNF-001** (compatibilidade): fechar o app encerra todo processo que ele abriu. Nada fica órfão.
- **RNF-002** (compatibilidade): um dado salvo inválido derruba só a parte dele para o padrão (P5).
- **RNF-003** (segurança): CSP restrita a `self`, `ipc:`, `blob:`/`data:` para mídia e imagem e `https://*.googlevideo.com` para áudio. Os plugins `fs` e `shell` não entram, e as capabilities ficam no mínimo ([security](../../arch/security.md)).
- **RNF-004** (desempenho): o orçamento medido no build de release é de 92 ms/s de CPU no núcleo 2D ocioso, 161 ms/s no 3D ocioso e 119 MB de memória de GPU com o 3D minimizado ([ADR-0022](../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)). `npm run perf` mede de novo.
- **RNF-005** (limites operacionais): Windows 11 com WebView2. O cargo compila em `t/` por causa do `MAX_PATH` ([build-and-env](../../arch/build-and-env.md#pasta-de-build-t)).

## Critérios de sucesso

- **SC-001**: Uma feature nova cabe nas camadas existentes sem um comando Tauri que faça mais de uma coisa.
- **SC-002**: A suíte `ui` inteira roda no navegador, sem o Tauri e sem rede.

## Entregáveis

A arquitetura é a de um Tauri 2 com o front-end em React 19 + TypeScript, servido pelo Vite. O Rust (edição 2024) concentra o nativo em módulos por domínio, e três processos externos ficam sob controle dele. A stack com versões está em [stack](../stack/spec.md).

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/tauri.conf.json` | Janela `main`, CSP, comandos de build e dev |
| `src-tauri/capabilities/default.json` | Permissões da janela: controles e diálogos |
| `src-tauri/src/lib.rs` | Comandos, `AppState`, partida e saída |
| `src-tauri/src/voice/` | Motor de voz na thread `jarvis-voice` |
| `src-tauri/src/assistant.rs` · `mcp.rs` | `claude.exe` e servidor MCP |
| `src/App.tsx` | Orquestra os hooks globais |
| `src/lib/` · `src/hooks/` | Adaptadores de backend, fakes de DEV e estado |
| `.specs/arch/overview.md` | Diagrama das camadas e fluxos principais |

### Testes

- `grep -rln "invoke" src/components`: sem saída prova o critério 1.
- `npx playwright test --project ui`: a UI inteira no modo web, com os fakes (critérios 2 e 7).
- `cargo test --lib` (em `src-tauri`): sanitização das configurações, servidor MCP (`tokens_differ`, `the_bridge_waits_for_the_ui`…), matcher e o resto dos módulos.
- `npm run build`: o `tsc` é o único gate estático.
- `npm run perf` num build de release: o orçamento do RNF-004.
- Critérios 3, 4, 6 e 8: conferência manual no app real (ou via CDP, ver [testing](../../arch/testing.md)).

### Reversão

- A arquitetura não se reverte de uma vez. Cada escolha tem o seu ADR, e voltar atrás numa delas é um ADR novo que a substitui.
- A única peça opcional é a voz na GPU: um build sem a feature `vulkan` volta a transcrever na CPU, sem mudar mais nada ([ADR-0021](../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0003 — Motor de voz numa thread Rust](../../arch/adr/0003-motor-de-voz-thread-rust.md)
- [ADR-0006 — O cérebro do JARVIS é o `claude.exe`](../../arch/adr/0006-jarvis-via-claude-cli.md)
- [ADR-0007 — JARVIS confinado a `Documentos\JARVIS`](../../arch/adr/0007-jarvis-confinado-a-documentos.md)
- [ADR-0008 — Servidor MCP HTTP dentro do app](../../arch/adr/0008-mcp-http-in-process.md)
- [ADR-0009 — Tipos espelhados TS ↔ Rust](../../arch/adr/0009-tipos-espelhados-ts-rust.md)
- [ADR-0010 — `settings.json` vs `localStorage`](../../arch/adr/0010-persistencia-settings-vs-localstorage.md)
- [ADR-0011 — Fakes de DEV e E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0012 — Apps lazy com preload](../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0021 — Voz na GPU via Vulkan, com porteiro Silero](../../arch/adr/0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)
- [ADR-0022 — Núcleo com relógio de quadros limitado](../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)

## Dependências

- **Vendor:** [Tauri](../vendor/tauri/spec.md), [React](../vendor/react/spec.md), [Vite e TypeScript](../vendor/vite-typescript/spec.md), [serde](../vendor/serde/spec.md), [HTTP](../vendor/http/spec.md), [cpal](../vendor/cpal/spec.md), [whisper-rs](../vendor/whisper-rs/spec.md), [sherpa-onnx](../vendor/sherpa-onnx/spec.md), [Claude Code](../vendor/claude-code/spec.md)
- **Specs:** [stack](../stack/spec.md) (versões e toolchain), [voice-engine](../../features/voice-engine/spec.md), [assistant](../../features/assistant/spec.md), [assistant-tools](../../features/assistant-tools/spec.md), [desktop-windows](../../features/desktop-windows/spec.md)
- **Sistema:** Windows 11, WebView2 Runtime, microfone, `Documentos` e `%LOCALAPPDATA%` do usuário

## Pendências

- [ ] Sem trava de instância única: nada impede duas instâncias do jvOS ao mesmo tempo (ver Casos de borda).
- [ ] As lacunas de segurança de [security](../../arch/security.md#lacunas-conhecidas): `read_text_file`/`write_text_file` sem raiz, `root` do workspace livre, yt-dlp sem versão fixa.
- [ ] O instalador (`npm run tauri build`) ainda não foi conferido com as DLLs do sherpa ao lado do `jarvis.exe` ([build-and-env](../../arch/build-and-env.md#pendências)). O `bundle` do `tauri.conf.json` não tem `resources` que as levem ([tauri](../vendor/tauri/spec.md#pendências)).
- [ ] O fake `window.__JARVIS_GPUS__` (`loadVoiceDevices`, `src/lib/settings.ts`) não está atrás de `import.meta.env.DEV`, ao contrário do que pede o RF-002, e vai para o bundle de produção. Ele só é lido fora do Tauri.
