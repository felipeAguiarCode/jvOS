# Feature Specification: Keyboard Shortcuts

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/keyboard-shortcuts` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Reescrita em 2026-11-05 no formato Feature Specification; `Ctrl+Shift+J` acrescentado em 2026-11-19 ([chat-mode](../chat-mode/spec.md)); sem decisões em aberto |
| Source Commit | `42e671a` (2026-10-23); evoluída em `c4ccc57` (2026-10-26); `useWindowControls.ts` mudou de novo em `e7151cf` (2026-11-05), sem mudar as teclas |
| Uncommitted Changes | 2026-11-19: `Ctrl+Shift+J` em `useWindowControls.ts` |
| Voice Shortcut | — |
| Assistant Tool | — |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web), `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D` são ignorados pelo jvOS, e os demais funcionam igual |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-19 |
| Verification Scope | Conferida com o código em 2026-11-05: `src/hooks/useWindowControls.ts`, `src/App.tsx`, `src/components/BootSequence.tsx`, `src/components/Spotlight.tsx`, `src/components/SettingsPanel.tsx`, `src/components/desktop/AdvancedMenu.tsx`, `src/components/desktop/Launcher.tsx`, `src/components/desktop/Window.tsx`, `src/components/desktop/widgets/WidgetMenu.tsx`, `src/components/QuickDock.tsx`, `src/components/CoreButton.tsx`, `src/hooks/useAssistant.ts`, `src/components/AssistantDrawer.tsx`, `src/components/desktop/apps/ide/IdeApp.tsx`, `src/components/desktop/apps/terminal/TerminalView.tsx`, `src/lib/commands.ts`, `src/lib/quality.ts`, `src-tauri/tauri.conf.json`, `tests/search.spec.ts`, `tests/settings.spec.ts`, `tests/voice.spec.ts`, `tests/boot.spec.ts`, `tests/ide.spec.ts`, `tests/shell.spec.ts` e `tests/widgets.spec.ts`. Os testes não foram executados nesta revisão |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os identificadores US1–US4, RF-001–RF-005, RNF-001, SC-001–SC-002 e T001–T026 são os mesmos da versão anterior. Os critérios de aceite AC-001–AC-015 são os antigos "Critério 1" a "Critério 15", na mesma ordem. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

O jvOS dá para usar inteiro sem mouse. `/` busca, `M` fala, `Ctrl+,` abre as Configurações e `Ctrl+Shift+,` o Menu avançado, `Ctrl+Shift+Q` troca a qualidade gráfica. No app desktop, `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D` controlam a janela nativa.

Os atalhos globais respeitam o contexto: não disparam enquanto o usuário digita, e um terminal fica com o teclado inteiro.

Esta spec é o mapa único dos atalhos globais. Ela aponta para as teclas próprias de cada janela, sem repeti-las.

| Input | Expected Behavior | Execution Path |
|---|---|---|
| `/` no desktop | A busca abre | Local (`useWindowControls` → `onOpenSearch`) |
| `M` segurado (segurar para falar) | O JARVIS ouve até soltar | Local → `holdVoice` → motor de voz |
| `Ctrl+Shift+,` | O Menu avançado abre, no teclado US ou ABNT2 | Local (`event.code === "Comma"`) |
| `/` dentro de um campo | O caractere entra no texto | Local (`isTyping`) |
| `F11` no app desktop | A tela cheia alterna, até num terminal | Tauri (`setFullscreen`) |
| `M` durante o boot | Só pula o boot | Local (listener em captura do `BootSequence`) |

## Goals and Success Criteria

### Goals

- Chegar à busca, à voz e aos menus pelo teclado, de qualquer lugar do desktop.
- Nunca roubar uma tecla de quem digita num campo, num editor ou num terminal.
- Controlar a janela nativa sem moldura pelo teclado.
- Fazer as mesmas teclas fazerem a mesma coisa em todos os diálogos e janelas.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Nenhum atalho global dispara enquanto o usuário digita num campo, editor ou terminal. | `/` e `m` num campo das Configurações, no Jarvis Mark, no jv_ide e no jv_sh: o texto recebe as teclas, a busca não abre e a escuta segue `idle`. |
| SC-002 | Com a dock oculta, toda função principal continua alcançável pelo teclado. | Com "Mostrar a dock" desligado: `/` abre a busca, `M` fala, `Ctrl+,` e `Ctrl+Shift+,` abrem os menus. |

## Scope and Non-Goals

### In Scope

- O listener global único de `useWindowControls` e as regras de contexto (`isTyping`, `[data-plain-keys]`, `[data-terminal]`, `isTauri()`).
- O listener em captura do boot.
- As teclas de contexto comuns: `Esc` nos diálogos, `Ctrl+W` na janela, tecla Menu e `Shift+F10` nos widgets, `Espaço` e `Enter` no item Voice e no núcleo.
- As dicas de atalho na busca e na aba Dock.

### Out of Scope

- Remapear teclas.
- Os atalhos da janela nativa fora do app desktop.
- As teclas próprias de cada app e widget, que estão nas specs deles (ver [Window-Specific Keys](#window-specific-keys)).

## User Stories

### US1 — Global Shortcuts

**Priority:** P1.

**User Story:** Como usuário, abro a busca, falo e chego aos menus pelo teclado, de qualquer lugar do desktop.

**Why This Priority:** é o caminho rápido, e o único com a dock oculta.

**Independent Test:** `tests/search.spec.ts` — "/ opens the search; typing finds a widget and Enter opens it"; `tests/settings.spec.ts` — "opens from the dock and the keyboard, closes with Escape"; `tests/voice.spec.ts` — "keyboard shortcut M toggles the microphone".

**Acceptance Criteria:** AC-001 a AC-005.

### US2 — Do Not Get in the Way of Typing

**Priority:** P1.

**User Story:** Como usuário, digito `/` ou `m` num campo, editor ou terminal sem disparar atalho.

**Why This Priority:** um atalho que rouba tecla quebra a digitação.

**Independent Test:** `tests/search.spec.ts` — "settings and layout actions run from the search; / inside a text field just types"; `tests/settings.spec.ts` — "keywords can be added and removed per program" (o `m` de "música"); `tests/ide.spec.ts` — "the tree goes by keyboard and mouse; / and m stay in the IDE"; `tests/shell.spec.ts` — "the terminal keeps the keyboard; the × closes the window and every shell".

**Acceptance Criteria:** AC-006 a AC-008.

### US3 — Native Window Controls

**Priority:** P2.

**User Story:** Como usuário do app desktop, fecho, minimizo, ponho em tela cheia e trago de volta a moldura do Windows pelo teclado.

**Why This Priority:** a janela não tem moldura (`decorations: false`).

**Independent Test:** sem teste automatizado: o Playwright roda no modo web, onde esses atalhos não fazem nada (KL-002).

**Acceptance Criteria:** AC-009 a AC-012.

### US4 — Common Context Keys

**Priority:** P2.

**User Story:** Como usuário, uso as mesmas teclas para a mesma coisa em todos os diálogos e janelas.

**Why This Priority:** previsibilidade.

**Independent Test:** `tests/search.spec.ts` — "arrow keys move the selection; menus open at the right place"; `tests/widgets.spec.ts` — "keys pressed in a widget's menu stay in the menu"; `tests/ide.spec.ts` — "tabs cycle and close; with no tab left Ctrl+W closes the window".

**Acceptance Criteria:** AC-013 a AC-015.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | Os atalhos globais DEVEM ser tratados num único listener de `keydown` em `useWindowControls`, nesta ordem: (1) terminal → sai, salvo `F11`; (2) `Ctrl+Shift+Q`; (2a) `Ctrl+Shift+J` (alterna entre o modo desktop e o modo chat, [chat-mode](../chat-mode/spec.md); acrescentado em 2026-11-19); (3) `Ctrl+Shift+,`; (4) `Ctrl+,`; (5) `/`; (6) `M`; (7) `Esc` com `M` segurado; (8) só no Tauri: `Ctrl+Q`, `Ctrl+M`, `F11`, `Ctrl+Shift+D`. | US1, US2, US3 |
| RF-002 | `/` e `M` NÃO DEVEM disparar com Ctrl, Alt ou com o foco num lugar de digitar (`isTyping`). | US2 |
| RF-003 | No segurar-para-falar, `M` DEVE iniciar no `keydown` e enviar no `keyup` ou no `blur` da janela; `Esc` cancela. Nos modos "Hey Jarvis" e "Sempre ouvindo", `M` alterna a escuta. | US1 |
| RF-004 | Os atalhos que aparecem na busca DEVEM mostrar a tecla à direita: `Ctrl ,`, `Ctrl Shift ,`, `Ctrl W`, `M`, `Ctrl Shift Q`, `F11`, `Ctrl M`, `Ctrl Q`. | US1, US4 |
| RF-005 | A aba Dock do Menu avançado DEVE lembrar os atalhos para quem esconde a dock: M, `/`, Ctrl , e Ctrl Shift ,. | US1 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | Os atalhos são fixos, não configuráveis. | Todos os atalhos globais |

### Operational Constraints

- Um listener de `keydown`, `keyup` e `blur` no `window`, registrado uma única vez; os callbacks atuais são lidos por uma ref (`handlers.current`).
- `Meta` conta como `Ctrl`.
- `Ctrl+Shift+,` casa a tecla física (`event.code === "Comma"`).
- Um toque em `M` mais curto que 350 ms (`MIN_HOLD_MS`) no segurar-para-falar não grava nada.
- Nenhum estado persistido.

## Acceptance Criteria

### AC-001 — Open the Search

**Related Story:** US1.

- **Given** o desktop, sem foco num campo
- **When** o usuário aperta `/`
- **Then** a busca abre.

### AC-002 — Toggle Listening With M

**Related Story:** US1.

- **Given** o modo "Hey Jarvis" ou "Sempre ouvindo"
- **When** o usuário aperta `M`
- **Then** a escuta liga. Outro `M` desliga.

### AC-003 — Hold M to Talk

**Related Story:** US1.

- **Given** o modo "Segurar para falar" (padrão)
- **When** o usuário segura `M`
- **Then** o JARVIS ouve até ele soltar. `Esc` antes de soltar cancela a gravação, e a dock diz "Gravação cancelada".

### AC-004 — Open the Settings and the Advanced Menu

**Related Story:** US1.

- **Given** o desktop
- **When** o usuário aperta `Ctrl+,`
- **Then** as Configurações abrem. `Ctrl+Shift+,` abre o Menu avançado, tanto no teclado US quanto no ABNT2.

### AC-005 — Cycle the Graphics Quality

**Related Story:** US1.

- **Given** o desktop
- **When** o usuário aperta `Ctrl+Shift+Q`
- **Then** a qualidade gira (low → medium → high → low) e fica salva em `jarvis.quality`.

**Coverage Status:** sem teste automatizado (KL-001).

### AC-006 — Type Without Triggering Shortcuts

**Related Story:** US2.

- **Given** o foco num `input`, `textarea`, `select`, `contenteditable` ou numa área `[data-plain-keys]` (jv_ide)
- **When** o usuário aperta `/` ou `M`
- **Then** o caractere vai para o campo, a busca não abre e a escuta segue `idle`.

### AC-007 — Leave the Keyboard to the Terminal

**Related Story:** US2.

- **Given** o foco num terminal (`[data-terminal]`)
- **When** o usuário aperta um atalho global
- **Then** nenhum dispara (nem `Ctrl+Q`, `Ctrl+M` ou `Ctrl+W`), exceto `F11`.

### AC-008 — Skip the Boot Without Leaking Keys

**Related Story:** US2.

- **Given** o boot na tela
- **When** o usuário aperta uma tecla sem modificador
- **Then** ela só pula o boot: `M` não abre o microfone. `Delete` pula e abre as Configurações.

### AC-009 — Close and Minimize the Native Window

**Related Story:** US3.

- **Given** o app desktop
- **When** o usuário aperta `Ctrl+Q`
- **Then** a janela fecha. `Ctrl+M` minimiza.

**Coverage Status:** sem teste automatizado (KL-002).

### AC-010 — Toggle Fullscreen

**Related Story:** US3.

- **Given** o app desktop
- **When** o usuário aperta `F11`
- **Then** a tela cheia alterna, até dentro de um terminal.

**Coverage Status:** sem teste automatizado (KL-002).

### AC-011 — Toggle the Native Frame

**Related Story:** US3.

- **Given** o app desktop
- **When** o usuário aperta `Ctrl+Shift+D`
- **Then** a moldura nativa liga ou desliga (saída de emergência).

**Coverage Status:** sem teste automatizado (KL-002).

### AC-012 — Ignore Native Shortcuts in the Browser

**Related Story:** US3.

- **Given** o navegador (modo web)
- **When** o usuário aperta `Ctrl+Q`, `Ctrl+M`, `F11` ou `Ctrl+Shift+D`
- **Then** o jvOS não faz nada com eles (o navegador pode tratá-los do jeito dele).

**Coverage Status:** sem teste automatizado (KL-002).

### AC-013 — Close Only the Open Dialog

**Related Story:** US4.

- **Given** um diálogo do sistema aberto (Busca, Configurações, Menu avançado, lançador, menu de opções)
- **When** o usuário aperta `Esc`
- **Then** só ele fecha.

### AC-014 — Close the Focused Window

**Related Story:** US4.

- **Given** uma janela focada
- **When** o usuário aperta `Ctrl+W`
- **Then** ela fecha, a menos que o conteúdo trate o atalho antes (o jv_ide fecha abas) ou que o foco esteja num terminal.

### AC-015 — Open the Widget Menu From the Keyboard

**Related Story:** US4.

- **Given** um widget com menu de opções, focado
- **When** o usuário aperta a tecla Menu ou `Shift+F10`
- **Then** o menu de opções abre no canto dele (+ 16 px).

**Coverage Status:** sem teste automatizado (KL-003).

## Behavior and Flows

### Global Listener (`useWindowControls`)

Um único listener de `keydown`, `keyup` e `blur` no `window`, registrado uma vez.

- **Behavior:**
  - Trata as teclas na ordem de RF-001; cada ramo que age chama `preventDefault` e retorna.
  - `/` e `M` exigem nenhum Ctrl (nem Meta), nenhum Alt e `isTyping` falso (RF-002). `Ctrl+,`, `Ctrl+Shift+,` e `Ctrl+Shift+Q` valem também com o foco num campo.
  - `Ctrl+Shift+,` casa `event.code === "Comma"`, porque com Shift a tecla vira `<` no US e no ABNT2.
  - `M` em auto-repetição (`event.repeat`) é ignorado.
  - No segurar-para-falar: `keydown` de `M` chama `onHoldVoice("start")`; `keyup` de `M` ou `blur` da janela, `"send"`; `Esc` com `M` segurado, `"cancel"` (RF-003). Nos outros modos, `M` chama `onToggleVoice`.
  - Fora do Tauri, o hook retorna antes de `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D`.
  - `Ctrl+Shift+D` é a saída de emergência: liga ou desliga a moldura nativa (`$moldura`), porque a janela nasce sem moldura (`decorations: false` em `tauri.conf.json`). Começa desligada.
  - `F11` lê `isFullscreen()` e chama `setFullscreen` com o contrário.

### Keyboard-Owning Areas

Os campos e as janelas que recebem as teclas antes dos atalhos.

- **Behavior:**
  - `isTyping` cobre `INPUT`, `TEXTAREA`, `SELECT`, `contenteditable` e qualquer elemento dentro de `[data-plain-keys]`: ali, `/` e `M` entram no texto e a escuta segue `idle`.
  - O jv_ide marca a área dele com `data-plain-keys` (`IdeApp.tsx`).
  - O terminal marca a área dele com `data-terminal` (`TerminalView.tsx`). Com o foco ali, nenhum atalho global dispara, nem o `Ctrl+W` da janela, exceto `F11`: essas teclas querem dizer algo para o shell (o `Ctrl+W` apaga uma palavra).

### Boot (`BootSequence`)

Durante o boot, as teclas só servem para pular a abertura.

- **Behavior:**
  - O boot registra um listener de `keydown` em fase de captura no `window`, que chama `preventDefault` e `stopImmediatePropagation`.
  - Uma tecla sem modificador só pula o boot: `M` não abre o microfone. `Delete` pula e abre as Configurações. Um clique também pula.
  - Teclas com Ctrl, Meta ou Alt passam para os atalhos.
  - Na tela, a BIOS diz "Pressione DEL para entrar no SETUP, qualquer tecla para pular". Para leitores de tela, um `role="status"` diz "Inicializando o sistema. Qualquer tecla pula; Delete abre as configurações.".

### Context Keys (Dialogs and Windows)

Cada diálogo e cada janela trata as próprias teclas.

- **Behavior:**
  - Busca: `↑` `↓` circulam, `Enter` executa, `Esc` fecha só a busca (`stopPropagation`, o evento não chega ao painel de trás).
  - Configurações, Menu avançado e lançador: cada um escuta `Esc` no `window` enquanto está aberto e se fecha.
  - Menu de opções: `Esc` capturado no `window` com `stopPropagation` fecha o menu e devolve o foco ao widget; dentro do menu valem `↑` `↓` `Home` `End`, e `←` `→` na barra de menus do jv_ide (`WidgetMenu.tsx`).
  - Janela: `Ctrl+W` fecha a janela focada (`Window.tsx`), a menos que o evento já tenha `defaultPrevented` (o jv_ide fecha abas) ou venha de `[data-terminal]`.
  - Widget focado: a tecla Menu ou `Shift+F10` disparam `contextmenu`, que abre o menu de opções no canto do widget.
  - Item Voice focado da dock, no segurar-para-falar: `Espaço` e `Enter` segurados falam (`HOLD_KEYS`) e `Esc` cancela (`QuickDock.tsx`).
  - Núcleo focado: `Enter` e `Espaço` pressionam e soltam como o clique (`CoreButton.tsx`).
  - Núcleo ativo ou com resposta na tela: `Esc` cancela a pergunta ou dispensa a resposta (`useAssistant.ts`). O histórico do JARVIS fecha com `Esc` se o foco estiver nele, ou, fora dele, se o núcleo não estiver ativo (`AssistantDrawer.tsx`).

### Shortcut Hints (Search and Dock Tab)

Onde o usuário vê as teclas.

- **Behavior:**
  - Na busca, os comandos "Configurações", "Menu avançado", "Fechar <janela>", "Ligar a escuta" ou "Desligar a escuta", "Alternar qualidade gráfica", "Tela cheia", "Minimizar o JARVIS" e "Fechar o JARVIS" mostram a tecla (RF-004).
  - Na aba Dock, a seção "Sem a dock" diz "Tecle M para falar, / para abrir widgets, apps e programas, Ctrl , para as Configurações e Ctrl Shift , para voltar aqui. Os avisos continuam aparecendo na base da tela." (RF-005).
- **Layout:**
  - Na busca, a tecla fica na ponta direita de cada resultado (ver [search](../search/spec.md)).
  - Na aba Dock, as teclas ficam no meio do parágrafo.
- **Style:**
  - Na busca, um `kbd` mono de 10 px, maiúsculo, em `text-hud-text/40`.
  - Na aba Dock, cada tecla é um `kbd` mono de 11 px com borda `hud-cyan/20` e texto `text-hud-light/85`, num parágrafo `text-xs text-hud-text/55`.

### Global Shortcut Map

| Key | Action | Condition | Test |
|---|---|---|---|
| `/` | Abre a busca | Fora de campos, `[data-plain-keys]` e terminais; sem Ctrl ou Alt | `search.spec.ts` |
| `M` | Liga ou desliga a escuta | Modos "Hey Jarvis" e "Sempre ouvindo" | `voice.spec.ts` "keyboard shortcut M toggles the microphone" |
| `M` (segurar) | Fala enquanto segura | "Segurar para falar" | `voice.spec.ts` "push-to-talk (the default) listens only while Voice or M is held" |
| `Esc` (com `M` segurado) | Cancela a gravação | Idem | `voice.spec.ts` "push-to-talk is cancelled by sliding left or by Esc" |
| `Ctrl+,` | Configurações | Fora de terminais | `settings.spec.ts` |
| `Ctrl+Shift+,` | Menu avançado | Fora de terminais | `boot`, `core`, `desktop`, `dock`, `taskbar`, `tui`, `voicetab` specs |
| `Ctrl+Shift+Q` | Gira a qualidade gráfica | Fora de terminais | — |
| `Ctrl+Shift+J` | Alterna entre o modo desktop e o modo chat | Fora de terminais | [chat-mode](../chat-mode/spec.md) |
| `Ctrl+Q` | Fecha o JARVIS | Só Tauri, fora de terminais | — |
| `Ctrl+M` | Minimiza | Só Tauri, fora de terminais | — |
| `F11` | Tela cheia | Só Tauri, também em terminais | — |
| `Ctrl+Shift+D` | Liga ou desliga a moldura nativa | Só Tauri, fora de terminais | — |
| Qualquer tecla / `Delete` | Pula o boot / pula e abre as Configurações | Durante o boot, sem Ctrl, Meta ou Alt | `boot.spec.ts` |

### System Context Keys

| Where | Keys | Spec |
|---|---|---|
| Busca | `↑` `↓` `Enter` `Esc` | [search](../search/spec.md) |
| Configurações e Menu avançado | `Esc` | [settings](../settings/spec.md) |
| Janela | `Ctrl+W`; duplo clique na barra (apps) | [desktop-windows](../desktop-windows/spec.md) |
| Menu de opções de widget | Menu, `Shift+F10`, `↑` `↓` `Home` `End`, `←` `→` (barra de menus), `Esc` | [desktop-windows](../desktop-windows/spec.md) |
| Lançador da dock | `Esc` | [desktop-windows](../desktop-windows/spec.md) |
| Item Voice focado | `Espaço` e `Enter` segurados, `Esc` | [voice-engine](../voice-engine/spec.md) |
| Núcleo focado ou ativo | `Enter` e `Espaço` (falar), `Esc` (cancelar, dispensar) | [assistant](../assistant/spec.md) |

### Window-Specific Keys

| Window | Where They Are Specified |
|---|---|
| jv_ide (Ctrl+P, Ctrl+O, Ctrl+W nas abas, F2…) | [apps/jv_ide](../../apps/jv_ide/spec.md) |
| jv_sh (Ctrl+Tab, Ctrl+Shift+W…) | [apps/jv_sh](../../apps/jv_sh/spec.md) |
| Jarvis Mark (Ctrl+B…) | [apps/jarvis-mark](../../apps/jarvis-mark/spec.md) |
| jv_T4p3 | [apps/jv_t4p3](../../apps/jv_t4p3/spec.md) |
| jv_lab | [apps/jv_lab](../../apps/jv_lab/spec.md) |
| Pomodoro | [widgets/pomodoro](../../widgets/pomodoro/spec.md) |
| Calculadora | [widgets/calculator](../../widgets/calculator/spec.md) |
| Fita | [widgets/tape](../../widgets/tape/spec.md) |
| Mini player | [widgets/miniplayer](../../widgets/miniplayer/spec.md) |
| Agenda e Tarefas (edição em linha: `Enter` salva, `Esc` cancela) | [widgets/agenda](../../widgets/agenda/spec.md), [widgets/tasks](../../widgets/tasks/spec.md) |

### Interaction Flow

```mermaid
sequenceDiagram
  participant K as Teclado
  participant B as BootSequence (captura)
  participant W as useWindowControls
  participant A as App
  participant T as Janela do Tauri
  K->>B: keydown (durante o boot)
  B-->>K: stopImmediatePropagation (pula)
  K->>W: keydown (depois do boot)
  W->>W: terminal? digitando? modificadores?
  alt atalho de UI
    W->>A: handlers.current.onX()
  else atalho nativo (isTauri)
    W->>T: close / minimize / setFullscreen / setDecorations
  end
```

### User Feedback

| Moment | Persona Key | Output |
|---|---|---|
| `Esc` com `M` segurado | — | Dock (Voice) "Gravação cancelada" |
| `M` solto antes de 350 ms | — | Dock (Voice) "Segure para falar"; nada é gravado |
| Modelo de voz ausente ao apertar `M` (app desktop) | — | As Configurações abrem e a dock diz "Baixe um modelo de voz" (erro) |

### Voice and Keyboard

- `/`: `onOpenSearch()`.
- `M` (alternar): `onToggleVoice()`.
- `M` segurado, solto, `Esc` e `blur`: `onHoldVoice("start" | "send" | "cancel" | "send")`.
- `Ctrl+,`: `onOpenSettings()`.
- `Ctrl+Shift+,` (`code === "Comma"`): `onOpenAdvanced()`.
- `Ctrl+Shift+Q`: `onCycleQuality()` (low → medium → high → low, salva).
- `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D`: `appWindow.close()`, `minimize()`, `setFullscreen(!x)` e `setDecorations(toggle)`.

## Data Model and Persistence

### Transient State

```ts
// useWindowControls, só em memória
const holdingVoice = useRef(false); // $segurandoM: M segurado no segurar-para-falar
const decorated = useRef(false);    // $moldura: moldura nativa ligada por Ctrl+Shift+D
```

| Field | Meaning | Rule |
|---|---|---|
| `$segurandoM` | `M` está segurado | Liga no `keydown`, desliga no `keyup`, no `blur` ou no `Esc` |
| `$moldura` | Moldura nativa ligada | Começa `false` a cada abertura do app |

`[data-plain-keys]` e `[data-terminal]` são marcadores de DOM das áreas que ficam com o teclado; não guardam estado. Ver também o [glossário](../../domain/glossary.md).

### Storage Rules

| Property | Value |
|---|---|
| State | Nenhum estado persistido |
| Storage | — |
| Key | Nenhuma própria. `jarvis.quality` é gravada pelo `cycle()` da [qualidade](../holographic-core/spec.md), não pelos atalhos |
| Missing or Invalid Storage | Não se aplica |

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src/hooks/useWindowControls.ts` | `isTyping`, listener global (`/`, `M`, `Esc`, `Ctrl+,`, `Ctrl+Shift+,`, `Ctrl+Shift+Q`, `Ctrl+Q`, `Ctrl+M`, `F11`, `Ctrl+Shift+D`), `keyup` e `blur` do `M`; também `reveal` e `paused` |
| `src/App.tsx` | `useWindowControls({ onToggleVoice, pushToTalk, onHoldVoice, onCycleQuality, onOpenSettings, onOpenAdvanced, onOpenSearch })`; `holdVoice` com `MIN_HOLD_MS` |
| `src/components/BootSequence.tsx` | Listener em captura que pula o boot |
| `src/components/Spotlight.tsx` | `↑` `↓` `Enter` `Esc` (com `stopPropagation`) |
| `src/components/SettingsPanel.tsx`, `src/components/desktop/AdvancedMenu.tsx`, `src/components/desktop/Launcher.tsx` | `Esc` fecha |
| `src/components/desktop/Window.tsx` | `Ctrl+W` (respeita `defaultPrevented` e `[data-terminal]`) |
| `src/components/desktop/widgets/WidgetMenu.tsx` | Abrir pelo `contextmenu` (tecla Menu, `Shift+F10`), `↑` `↓` `Home` `End` `←` `→` `Esc` |
| `src/components/QuickDock.tsx` | `HOLD_KEYS` (`Espaço`, `Enter`) e `Esc` no item Voice |
| `src/components/CoreButton.tsx` | `Enter` e `Espaço` pressionam e soltam |
| `src/hooks/useAssistant.ts`, `src/components/AssistantDrawer.tsx` | `Esc` do núcleo e do histórico |
| `src/components/desktop/apps/ide/IdeApp.tsx` | Marca `data-plain-keys` |
| `src/components/desktop/apps/terminal/TerminalView.tsx` | Marca `data-terminal` |
| `src/lib/commands.ts` | As teclas mostradas na busca |

### Context Rules

| Marker or Condition | Effect |
|---|---|
| `INPUT`, `TEXTAREA`, `SELECT`, `contenteditable`, `[data-plain-keys]` | `/` e `M` não disparam |
| `[data-terminal]` | Nenhum atalho global, exceto `F11`; o `Ctrl+W` da janela também não |
| Boot visível | Teclas sem modificador só pulam o boot |
| `event.repeat` em `M` | Ignorado |
| `isTauri()` falso | `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D` ignorados |

### Related Architecture Decisions

- [ADR-0001 — Tauri 2 + Rust como shell desktop](../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0011 — fakes de dev e E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0017 — UI PT-BR, código EN](../../arch/adr/0017-ui-pt-br-codigo-en.md)

## Interfaces and Contracts

### Tauri Window API

| Call | Shortcut | Notes |
|---|---|---|
| `getCurrentWindow().close()` | `Ctrl+Q` | Só com `isTauri()` |
| `getCurrentWindow().minimize()` | `Ctrl+M` | Só com `isTauri()` |
| `isFullscreen()` + `setFullscreen(!x)` | `F11` | Também dentro de um terminal |
| `setDecorations(boolean)` | `Ctrl+Shift+D` | Alterna a partir de `false` |

### Events and Channels

| Event | Payload | Producer → Consumer |
|---|---|---|
| `keydown` (captura, no `window`) | `KeyboardEvent` | Teclado → `BootSequence` (durante o boot) |
| `keydown`, `keyup`, `blur` (no `window`) | `KeyboardEvent`, `FocusEvent` | Teclado → `useWindowControls` |
| `contextmenu` | `MouseEvent` com `clientX = clientY = 0` | Tecla Menu ou `Shift+F10` → `useWidgetMenu.open` |

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| Nada focado | Os atalhos globais valem | RF-001 |
| `M` em auto-repetição | Ignorado: segurar não reinicia a gravação | RF-003 |
| Segundo `M` nos modos de alternar, ou segundo `Ctrl+Shift+D` | Desfaz o primeiro | AC-002, AC-011 |
| `M` solto antes de 350 ms no segurar-para-falar | Nada é gravado; a dock diz "Segure para falar" | User Feedback |
| A janela perde o foco com `M` segurado | A gravação é enviada, como se `M` tivesse sido solto | RF-003 |
| Settings ainda carregando | `pushToTalk` é falso e `M` alterna a escuta em vez de segurar | `settings?.activation` |
| Concorrência: tecla durante o boot | O listener em captura chega antes e para o evento | AC-008 |
| Duas camadas querem o mesmo `Esc` ou `Ctrl+W` | Vence quem trata primeiro: a busca para a propagação, o menu de opções captura, o histórico focado marca `defaultPrevented` antes do núcleo, e o jv_ide fecha a aba antes da janela | AC-013, AC-014 |
| `/` com a busca aberta | O foco está no campo da busca, então o `/` entra na consulta | `isTyping` |
| `Ctrl+,` com o foco num campo | Abre as Configurações (atalhos com modificador valem em campos) | RF-002 |
| `/` e `M` com Ctrl ou Alt | Não disparam | RF-002 |
| Foco num terminal | Nenhum atalho global, exceto `F11` | AC-007 |
| No navegador | `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D` são ignorados pelo jvOS | AC-012 |
| A moldura ligada e o app reaberto | Volta sem moldura: `$moldura` não é salvo | Transient State |
| Permissões | Não se aplica: as chamadas da janela nativa não pedem permissão ao usuário | — |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [search](../search/spec.md) | `/` e as teclas nos resultados |
| [settings](../settings/spec.md) | `Ctrl+,`, `Ctrl+Shift+,` e o `Esc` dos menus |
| [voice-engine](../voice-engine/spec.md) | O `M` que alterna ou segura |
| [holographic-core](../holographic-core/spec.md) | `Ctrl+Shift+Q` e o `cycle()` |
| [boot](../boot/spec.md) | O listener em captura |
| [desktop-windows](../desktop-windows/spec.md) | `Ctrl+W`, o lançador e o menu de opções |
| [dock-taskbar](../dock-taskbar/spec.md) | O item Voice e a aba Dock |
| [assistant](../assistant/spec.md) | O `Esc` do núcleo e do histórico |
| [jv_ide](../../apps/jv_ide/spec.md) e [jv_sh](../../apps/jv_sh/spec.md) | `data-plain-keys` e `data-terminal` |

### Runtime Dependencies

- [Tauri](../../foundation/vendor/tauri/spec.md): `@tauri-apps/api/window` (`close`, `minimize`, `isFullscreen`, `setFullscreen`, `setDecorations`) e `@tauri-apps/api/core` (`isTauri`).
- [React](../../foundation/vendor/react/spec.md).
- A janela nativa sem moldura (`decorations: false`) e os teclados US e ABNT2.

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/search.spec.ts` — "/ opens the search; typing finds a widget and Enter opens it" | `/` abre a busca com o foco no campo | AC-001 |
| `tests/search.spec.ts` — "settings and layout actions run from the search; / inside a text field just types" | `/` no Jarvis Mark só digita, escuta `idle` | AC-006, SC-001 |
| `tests/search.spec.ts` — "arrow keys move the selection; menus open at the right place" | Setas, `Enter`, `Esc` que fecha só a busca | AC-013 |
| `tests/settings.spec.ts` — "opens from the dock and the keyboard, closes with Escape" | `Ctrl+,` abre, `Esc` fecha | AC-004, AC-013 |
| `tests/settings.spec.ts` — "keywords can be added and removed per program" | O `m` de "música" num campo não liga o microfone | AC-006 |
| `tests/voice.spec.ts` — "keyboard shortcut M toggles the microphone" | `M` liga e desliga | AC-002 |
| `tests/voice.spec.ts` — "push-to-talk (the default) listens only while Voice or M is held" | Segurar `M` escuta até soltar | AC-003 |
| `tests/voice.spec.ts` — "push-to-talk is cancelled by sliding left or by Esc" | `Esc` com `M` segurado cancela, "Gravação cancelada" | AC-003 |
| `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings" | `M` só pula, `Delete` abre as Configurações | AC-008 |
| `tests/ide.spec.ts` — "the tree goes by keyboard and mouse; / and m stay in the IDE" | `/` e `m` ficam no jv_ide (`data-plain-keys`) | AC-006 |
| `tests/ide.spec.ts` — "tabs cycle and close; with no tab left Ctrl+W closes the window" | `Ctrl+W` fecha as abas antes da janela | AC-014 |
| `tests/shell.spec.ts` — "the terminal keeps the keyboard; the × closes the window and every shell" | `Ctrl+W` e "/m" vão ao shell | AC-007 |
| `tests/widgets.spec.ts` — "keys pressed in a widget's menu stay in the menu" | As teclas ficam no menu, `Esc` fecha e devolve o foco | AC-013 |
| `tests/dock.spec.ts`, `tests/desktop.spec.ts` e outros com `Control+Shift+,` | `Ctrl+Shift+,` abre o Menu avançado | AC-004 |

### Verification Commands

Na raiz do repositório:

```powershell
npx playwright test tests/search.spec.ts --project ui -g "opens the search|inside a text field|arrow keys"
npx playwright test tests/settings.spec.ts --project ui -g "opens from the dock and the keyboard|keywords can be added"
npx playwright test tests/voice.spec.ts --project voice -g "keyboard shortcut M|listens only while Voice or M|cancelled by sliding left or by Esc"
npx playwright test tests/boot.spec.ts --project ui -g "any key skips"
npx playwright test tests/ide.spec.ts --project ui -g "/ and m stay in the IDE|tabs cycle and close"
npx playwright test tests/shell.spec.ts --project ui -g "the terminal keeps the keyboard"
npx playwright test tests/widgets.spec.ts --project ui -g "keys pressed in a widget's menu"
```

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| `Ctrl+Shift+Q` (AC-005) | Sem teste | Apertar e conferir `jarvis.quality` e `__JARVIS__.quality` |
| `Ctrl+Q`, `Ctrl+M`, `F11`, `Ctrl+Shift+D` (AC-009 a AC-012) | Sem teste: o Playwright roda no modo web | Verificação manual no app, ou E2E pela porta de depuração do WebView2 |
| Tecla Menu e `Shift+F10` (AC-015) | Sem teste | Focar um widget, apertar `Shift+F10` e conferir o menu |
| Toque curto em `M` | Sem teste para o teclado (só para o clique em Voice) | Apertar `M` por menos de 350 ms e conferir "Segure para falar" |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código e dos commits `42e671a` e `c4ccc57`.

### Phase 1 — Foundation

- [x] T001 Listener global único com handlers por ref — `src/hooks/useWindowControls.ts`
- [x] T002 `isTyping` (campos, `contenteditable`, `[data-plain-keys]`) — `src/hooks/useWindowControls.ts`
- [x] T003 Saída para terminais (`[data-terminal]`), exceto `F11` — `src/hooks/useWindowControls.ts`

### Phase 2 — Global Shortcuts (US1)

- [x] T004 [US1] `/` → busca — `src/hooks/useWindowControls.ts`, `src/App.tsx`
- [x] T005 [US1] `M` alterna ou segura, `Esc` cancela, `keyup`/`blur` enviam — `src/hooks/useWindowControls.ts`
- [x] T006 [US1] `Ctrl+,` e `Ctrl+Shift+,` pela tecla física — `src/hooks/useWindowControls.ts`
- [x] T007 [US1] `Ctrl+Shift+Q` → `cycle()` — `src/hooks/useWindowControls.ts`, `src/lib/quality.ts`

### Phase 3 — Do Not Get in the Way of Typing (US2)

- [x] T008 [P] [US2] `data-plain-keys` no jv_ide — `src/components/desktop/apps/ide/IdeApp.tsx`
- [x] T009 [P] [US2] `data-terminal` no terminal — `src/components/desktop/apps/terminal/TerminalView.tsx`
- [x] T010 [P] [US2] Boot captura as teclas sem modificador — `src/components/BootSequence.tsx`

### Phase 4 — Native Window (US3)

- [x] T011 [US3] `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D` (só `isTauri()`) — `src/hooks/useWindowControls.ts`

### Phase 5 — Context Keys (US4)

- [x] T012 [P] [US4] `Esc` nos diálogos e no lançador — `src/components/Spotlight.tsx`, `src/components/SettingsPanel.tsx`, `src/components/desktop/AdvancedMenu.tsx`, `src/components/desktop/Launcher.tsx`
- [x] T013 [P] [US4] `Ctrl+W` da janela — `src/components/desktop/Window.tsx`
- [x] T014 [P] [US4] Teclado do menu de opções — `src/components/desktop/widgets/WidgetMenu.tsx`
- [x] T015 [P] [US4] Dica dos atalhos na aba Dock e "Ctrl Shift ," etc. nos resultados da busca — `src/components/desktop/AdvancedMenu.tsx`, `src/lib/commands.ts`

### Phase 6 — Verification

- [x] T016 Playwright `tests/search.spec.ts` — "/ opens the search; typing finds a widget and Enter opens it"
- [x] T017 Playwright `tests/search.spec.ts` — "settings and layout actions run from the search; / inside a text field just types"
- [x] T018 Playwright `tests/settings.spec.ts` — "opens from the dock and the keyboard, closes with Escape"
- [x] T019 Playwright `tests/voice.spec.ts` — "keyboard shortcut M toggles the microphone"
- [x] T020 Playwright `tests/voice.spec.ts` — "push-to-talk (the default) listens only while Voice or M is held"
- [x] T021 Playwright `tests/voice.spec.ts` — "push-to-talk is cancelled by sliding left or by Esc"
- [x] T022 Playwright `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings"
- [x] T023 Playwright `tests/ide.spec.ts` — "the tree goes by keyboard and mouse; / and m stay in the IDE"
- [x] T024 Playwright `tests/ide.spec.ts` — "tabs cycle and close; with no tab left Ctrl+W closes the window"
- [x] T025 Playwright `tests/shell.spec.ts` — "the terminal keeps the keyboard; the × closes the window and every shell"
- [x] T026 Playwright `tests/widgets.spec.ts` — "keys pressed in a widget's menu stay in the menu"

## Rollback Plan

1. Para tirar um atalho global, tire o ramo dele do listener de `useWindowControls`, o callback no `App.tsx` e a tecla mostrada na busca (`commands.ts`) e na aba Dock. A função continua na busca, na dock ou na barra.
2. Não tire `/`, `Ctrl+,` e `Ctrl+Shift+,` juntos: com a dock oculta, eles são o único caminho até a busca e os menus (SC-002).
3. Não tire `isTyping`, `[data-plain-keys]` nem `[data-terminal]` enquanto `/` e `M` existirem: sem eles, digitar num campo, no jv_ide ou num terminal dispara os atalhos.
4. Mantenha `Ctrl+Shift+D`: a janela nasce sem moldura (`decorations: false` em `tauri.conf.json`), e ele é a saída de emergência.
5. Nada fica órfão: os atalhos não guardam estado próprio; `jarvis.quality` é do [holographic-core](../holographic-core/spec.md).

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P2 — Rust é dono do nativo | Atendido | Fechar, minimizar, tela cheia e moldura passam pela API de janela do Tauri |
| P6 — Fora do Tauri | Atendido | Os atalhos nativos são ignorados no navegador, e os demais funcionam |
| P7 — PT-BR | Atendido | Dicas visíveis ("Pressione DEL…", "Tecle M para falar…") em PT-BR |
| P9 — Desktop leve | Atendido | Um listener, registrado uma vez, sem re-registro por render |
| P11 — Testes | Parcial | `Ctrl+Shift+Q`, os atalhos só do Tauri e a tecla Menu não têm teste (KL-001 a KL-003) |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | Nenhum teste Playwright pressiona `Ctrl+Shift+Q`. | Lacuna de verificação |
| KL-002 | `Ctrl+Q`, `Ctrl+M`, `F11` e `Ctrl+Shift+D` dependem de `isTauri()` e não são exercitados por nenhum teste, porque o Playwright roda no modo web. | Lacuna de verificação |
| KL-003 | Os testes só abrem o menu de opções com o botão direito: a tecla Menu e `Shift+F10` não são exercitados. | Lacuna de verificação |

## Open Questions

Nenhuma.

## References

- Versão anterior desta spec, no formato SpecLang: `git show e7151cf:.specs/features/keyboard-shortcuts/spec.md`. A versão intermediária, no formato do spec-coding.dev ([ADR-0023](../../arch/adr/0023-specs-formato-spec-coding-dev.md)), não chegou a ser commitada.
- Modelo de formato: [reminders](../reminders/spec.md) ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)).
- Código conferido: listado em Metadata › Verification Scope.
