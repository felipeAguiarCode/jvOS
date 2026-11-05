# Feature Specification: Boot Screen

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/boot` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Reescrita em 2026-11-05 no formato Feature Specification; uma decisão de produto em [Open Questions](#open-questions) |
| Source Commit | `42e671a` (2026-10-23); evoluída em `c4ccc57` (2026-10-26, BIOS em duas telas) e `e7151cf` (2026-11-05, campo "Tema", ruído no compositor, render a ~30 fps) |
| Uncommitted Changes | Nenhuma |
| Voice Shortcut | — |
| Assistant Tool | — |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web) a tela roda igual, mas sem revelar janela nativa, com o motor de voz como "modo navegador · só visual" e, sem gesto do usuário, muda |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-05 |
| Verification Scope | Conferida com o código em 2026-11-05: `src/components/BootSequence.tsx`, `src/lib/boot.ts`, `src/lib/bootSound.ts`, `src/lib/asciiFont.ts`, `src/lib/commands.ts`, `src/lib/quality.ts`, `src/App.tsx`, `src/hooks/useWindowControls.ts`, `src/components/desktop/AdvancedMenu.tsx`, `src/components/JarvisReply.tsx`, `src/styles/globals.css`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `playwright.config.ts`, `tests/boot.spec.ts` e `tests/core.spec.ts`. Os testes não foram executados nesta revisão |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os identificadores US1–US4, RF-001–RF-010, RNF-001–RNF-003, SC-001–SC-003 e T001–T024 são os mesmos da versão anterior. Os critérios de aceite AC-001–AC-017 são os antigos "Critério 1" a "Critério 17", na mesma ordem. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

Ao abrir, o JARVIS faz o POST de uma BIOS antiga num monitor CRT, com scanlines, brilho de fósforo, flicker e a fonte VT323. A primeira tela mostra o banner, a contagem de memória e os dispositivos respondendo um a um. Depois vêm o bipe, uma tela de resumo com a listagem PCI e, por fim, a "máquina ganhando vida": um acorde, o emblema de anéis e "Bem-vindo", que se dissolvem no desktop. Em seguida o núcleo liga e o JARVIS cumprimenta ([greeting-homecoming](../greeting-homecoming/spec.md)).

A janela nativa nasce oculta e só aparece quando o núcleo desenha o primeiro quadro; é aí que o POST começa a "digitar". Qualquer tecla ou clique pula a tela. Delete pula direto para as Configurações, como o SETUP de uma BIOS. A tela pode ser desligada e revista pelo Menu avançado ou pela busca.

| Input | Expected Behavior | Execution Path |
|---|---|---|
| Abrir o JARVIS com a tela ligada (padrão) | POST em duas telas, emblema e "Bem-vindo", depois o desktop | Local (`BootSequence`); a janela é revelada pelo Tauri |
| Qualquer tecla sem Ctrl, Meta ou Alt, ou um clique | Pula para o fade de saída de 0,6 s | Local |
| Delete | Pula e abre as Configurações | Local (`onDone(true)`) |
| Menu avançado › Cores › "Ver agora", ou busca "Ver a tela de inicialização" | Toca de novo, mesmo desligada | Local (`replayBoot`) |
| Desligar "Tela de inicialização" | A próxima abertura não tem boot nem saudação | `jarvis.boot` |

## Goals and Success Criteria

### Goals

- Dar ao jvOS uma abertura com personalidade, sem atrasar quem quer trabalhar.
- Esconder o flash branco da WebView: a janela só aparece com algo desenhado.
- Mostrar dados reais da máquina e do JARVIS, sem nada sair dela.
- Deixar o usuário pular, desligar, silenciar e rever a sequência.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Uma tecla qualquer tira a tela do caminho em até 5 s, sem efeito colateral nos atalhos. | `tests/boot.spec.ts`: `M` esconde o boot em até 5 s e o status de voz continua `idle`. |
| SC-002 | Numa instalação nova, a sequência inteira termina sozinha e entrega um desktop sem texto além da barra superior. | `tests/boot.spec.ts`: o boot some, a saudação passa, e `document.body.innerText` sem a barra fica vazio. |
| SC-003 | O boot roda com qualquer modo de núcleo (3D, 2D, desligado). | `tests/core.spec.ts`, bloco "from a fresh start" (2D e desligado); os outros testes usam o 3D. |

## Scope and Non-Goals

### In Scope

- O POST em duas telas, a tela de partida e o fade de saída.
- A sonda da máquina por APIs do navegador e o resumo do JARVIS (`describeBoot`).
- Os sons sintetizados do boot (bipe e acorde) e a preferência `sound`, que também silencia a saudação e o `JarvisReply`.
- Pular por tecla ou clique; Delete abre as Configurações.
- `jarvis.boot` (`enabled`, `sound`), a seção "Inicialização" do Menu avançado e os comandos de busca.
- A revelação da janela no primeiro quadro, com as redes de segurança da UI e do Rust.
- A orquestração no `App`: o que espera o boot e o que acontece no fim.

### Out of Scope

- Sondagem real de hardware: os números são os que o navegador expõe, e o PCI é encenado.
- Dependência do Rust: no navegador a tela roda igual, só que muda (sem gesto do usuário) e com o motor de voz em "modo navegador".
- A saudação e a volta para casa ficam em [greeting-homecoming](../greeting-homecoming/spec.md).

## User Stories

### US1 — Watch the POST on Startup

**Priority:** P1.

**User Story:** Como usuário, ao abrir o JARVIS numa instalação nova, vejo a BIOS testar a máquina e passar a vez ao holograma.

**Why This Priority:** é a primeira impressão do produto e o momento em que a janela nativa aparece.

**Independent Test:** `tests/boot.spec.ts` — "the BIOS runs its POST over two screens, comes to life with the emblem and a welcome, and reveals the hologram".

**Acceptance Criteria:** AC-001, AC-002, AC-003, AC-004, AC-005 e AC-006.

### US2 — Skip the Screen

**Priority:** P1.

**User Story:** Como usuário, não quero esperar: uma tecla ou um clique me leva ao desktop, e Delete me leva às Configurações.

**Why This Priority:** a abertura não pode atrapalhar quem quer trabalhar.

**Independent Test:** `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings".

**Acceptance Criteria:** AC-007, AC-008, AC-009 e AC-010.

### US3 — Turn Off and Replay

**Priority:** P2.

**User Story:** Como usuário, posso desligar a tela ou o som e rever a sequência quando quiser.

**Why This Priority:** é uma preferência, não o fluxo principal.

**Independent Test:** `tests/boot.spec.ts` — "the advanced menu turns the boot off and replays it".

**Acceptance Criteria:** AC-011, AC-012, AC-013, AC-014 e AC-015.

### US4 — Window Without a White Flash

**Priority:** P2.

**User Story:** Como usuário, vejo a janela do Windows aparecer só quando já há algo desenhado.

**Why This Priority:** evita o flash branco da WebView ao abrir.

**Independent Test:** indireto, com o núcleo em 2D e desligado: `tests/core.spec.ts` — "with the core in 2D (the default), the boot screen still plays and hands over" e "with the core off, the boot screen still plays and hands over".

**Acceptance Criteria:** AC-016 e AC-017.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | A tela DEVE ser uma função do tempo decorrido: 70 ms por linha, 240 ms entre o nome de um dispositivo e a resposta dele, contagem de memória em 700 ms e glitch de 140 ms na troca de tela. | US1 |
| RF-002 | A caixa de resumo DEVE ter 10 campos em duas colunas: Processador, Motor de voz, Memória, Ativação, Vídeo, Tema, Tela, Widgets e apps ("<n> módulos", com n = `WINDOW_KINDS.length`), Perfil gráfico (nível de qualidade em maiúsculas) e Sessão. | US1 |
| RF-003 | O vendor PCI DEVE vir do nome da GPU (NVIDIA `10DE`, AMD `1002`, Intel `8086`, Apple `106B`, Qualcomm `5143`, SwiftShader/Google `1AE0`, outros `1414`). Os IDs de dispositivo vêm de um hash estável do nome. | US1 |
| RF-004 | Depois do POST, a tela de partida DEVE durar 2100 ms, com o acorde e o emblema 250 ms após o início dela. | US1 |
| RF-005 | Qualquer tecla sem modificador DEVE pular a tela sem se propagar (captura + `stopImmediatePropagation`). Delete DEVE abrir as Configurações ao fim do fade. | US2 |
| RF-006 | O sistema DEVE guardar `jarvis.boot` = `{enabled, sound}`, com padrão `true`/`true`. Um valor inválido volta ao padrão campo a campo. | US3 |
| RF-007 | "Ver agora" e o comando de busca DEVEM rodar o boot de novo, descartando a saudação em curso. | US3 |
| RF-008 | Durante o boot, o núcleo DEVE ficar em `standby` (apagado), e a dock, a barra superior, o botão do núcleo e o botão do histórico ficam fora. Ao terminar, o núcleo liga com dois pulsos de áudio (no fim e 1,3 s depois). | US1, US4 |
| RF-009 | Os sons DEVEM ser sintetizados com Web Audio, sem arquivos: o bipe (onda quadrada de 1000 Hz, ~150 ms) e o acorde (A, E, B, C#, E por 3,2 s). | US1, US3 |
| RF-010 | A preferência `sound` DEVE valer também para os impactos e glitches da saudação e do `JarvisReply`. | US3 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | Nenhum dado sai da máquina. CPU, GPU, tela, memória e áudio vêm de APIs do navegador (`navigator.hardwareConcurrency`, `WEBGL_debug_renderer_info`, `screen`, `deviceMemory`, `AudioContext`). | Sonda (`probeSystem`) |
| RNF-002 | A fonte VT323 vem empacotada (`@fontsource/vt323/latin.css`), porque a CSP não permite fontes remotas. | Build e CSP |
| RNF-003 | O `AudioContext` fecha 3,5 s depois de `close()` (`CHIME_SECONDS` + 300 ms), para o acorde terminar de soar. | `createBootSound` |

### Operational Constraints

- `tauri.conf.json`: janela `visible: false`, `backgroundColor: #000508` e `--autoplay-policy=no-user-gesture-required` (o som toca sem gesto no app).
- O POST só começa com o primeiro quadro do núcleo e a fonte carregada, ou depois de 1,5 s (`START_FALLBACK_MS`).
- Um quadro avança a linha do tempo no máximo 100 ms (`MAX_STEP_MS`).
- A tela re-renderiza no máximo a cada 32 ms (~30 fps); os sons são checados a cada quadro.
- `jarvis.boot` grava com 250 ms de debounce e flush no `beforeunload`.

## Acceptance Criteria

### AC-001 — Run the First POST Screen

**Related Story:** US1.

- **Given** que `jarvis.boot` não existe
- **When** o app abre
- **Then** `data-testid="boot"` mostra "BIOS Modular v<versão>, Núcleo Holográfico", depois "Teste de memória" contando até `<K>K OK` e "Detectando dispositivos...", com Vídeo primário, Tela, Áudio e Motor de voz respondendo um por vez.

### AC-002 — Show the Footer and the BIOS ID

**Related Story:** US1.

- **Given** a primeira tela
- **When** ela é desenhada
- **Then** o rodapé diz "Pressione DEL para entrar no SETUP, qualquer tecla para pular" e mostra o BIOS ID `JV-HOLO-<dígitos>-<8 hex>-00`. A tela não tem logo, nome JARVIS, data/hora nem SVG.

### AC-003 — Replace It With the Summary Screen

**Related Story:** US1.

- **Given** o fim da detecção
- **When** o bipe toca
- **Then** a segunda tela substitui a primeira com a caixa "Configuração do sistema", "Listagem de dispositivos PCI...", "Verificando dados do pool DMI ............" e "Iniciando o núcleo holográfico...".

### AC-004 — Come to Life and Fade Out

**Related Story:** US1.

- **Given** o POST completo
- **When** começa a tela de partida
- **Then** aparece `boot-startup` com o emblema e "Bem-vindo". O conjunto some num fade em tamanho cheio (escala acima de 0,9), sem "desligar o tubo" e sem o antigo `boot-flash`.

### AC-005 — Hand Over to the Desktop

**Related Story:** US1.

- **Given** o fim do boot
- **When** o fade termina
- **Then** a dock ("Quick actions") e a barra superior entram, a saudação aparece no núcleo e, sem contar a barra, nenhum texto fica na tela.

### AC-006 — Browser Mode Voice Engine

**Related Story:** US1.

- **Given** o modo navegador
- **When** o POST detecta os dispositivos
- **Then** o campo Motor de voz diz "modo navegador · só visual".

### AC-007 — Skip With Any Key

**Related Story:** US2.

- **Given** o boot na tela
- **When** aperto uma tecla sem Ctrl/Meta/Alt
- **Then** a tela some em 0,6 s e a tecla para ali: `M` não liga o microfone e o status de voz continua `idle`.

### AC-008 — Delete Opens the Settings

**Related Story:** US2.

- **Given** o boot na tela
- **When** aperto Delete
- **Then** a tela some e o diálogo "Configurações" abre.

### AC-009 — Skip With a Click

**Related Story:** US2.

- **Given** o boot na tela
- **When** clico em qualquer ponto
- **Then** ela também pula.

### AC-010 — Let Modifier Shortcuts Through

**Related Story:** US2.

- **Given** o boot na tela
- **When** aperto um atalho com Ctrl, Meta ou Alt
- **Then** o boot não o intercepta nem pula.

**Coverage Status:** sem teste automatizado (KL-006).

### AC-011 — Turn the Screen Off

**Related Story:** US3.

- **Given** o Menu avançado › aba Cores › seção "Inicialização"
- **When** desligo "Tela de inicialização"
- **Then** `jarvis.boot.enabled` vira `false`.

### AC-012 — Start Without a Boot

**Related Story:** US3.

- **Given** o boot desligado
- **When** recarrego
- **Then** não há boot nem saudação: o núcleo já está ligado.

### AC-013 — Replay Now

**Related Story:** US3.

- **Given** o menu aberto
- **When** clico "Ver agora"
- **Then** o menu fecha e o boot toca de novo, mesmo desligado.

### AC-014 — Replay and Toggle From the Search

**Related Story:** US3.

- **Given** a busca (`/`)
- **When** escolho "Ver a tela de inicialização" ou "Desativar a tela de inicialização" ("Ativar …" com ela desligada)
- **Then** o efeito é o mesmo de "Ver agora" e do switch.

**Coverage Status:** sem teste automatizado (KL-006).

### AC-015 — Mute the Boot

**Related Story:** US3.

- **Given** o switch "Sons da inicialização" desligado
- **When** o boot toca
- **Then** a sequência toca muda.

**Coverage Status:** sem teste automatizado (KL-006).

### AC-016 — Reveal on the First Frame

**Related Story:** US4.

- **Given** o app desktop
- **When** o núcleo (3D, 2D ou desligado) desenha o primeiro quadro
- **Then** a janela é mostrada e focada, e o POST começa.

### AC-017 — Reveal Without the Signal

**Related Story:** US4.

- **Given** o app desktop
- **When** o primeiro quadro não chega
- **Then** a UI mostra a janela após 500 ms e o Rust após 2,5 s, se ela ainda estiver oculta.

**Coverage Status:** sem teste automatizado (KL-006).

## Behavior and Flows

### `BootSequence`

A tela inteira: o tubo CRT, o relógio que avança o roteiro, as duas telas do POST e a tela de partida.

- **Behavior:**
  - A tela é uma função do tempo decorrido (RF-001). Um laço `requestAnimationFrame` só avança o relógio. Os sons disparam quando o relógio passa pelos instantes deles: o bipe em `clearAt` e o acorde 250 ms depois do início da tela de partida.
  - Começa a "digitar" quando o núcleo avisa o primeiro quadro (`started`) e a fonte VT323 está carregada; senão, 1,5 s depois de montar (`START_FALLBACK_MS`).
  - Um quadro travado avança a linha do tempo no máximo 100 ms (`MAX_STEP_MS`): a sequência desacelera em vez de pular fases.
  - Com movimento reduzido, tudo é impresso de uma vez e fica 1100 ms na tela (`REDUCED_HOLD`) antes do "Bem-vindo". Não há ligar do CRT nem glitch, e o relógio começa já depois de `clearAt`, então o bipe não toca (KL-004).
  - Um pulo (tecla ou clique) congela o relógio e vai direto ao fade de saída de 0,6 s. Só o primeiro pulo vale. Ao fim do fade, chama `onDone(openSettings)`.
  - O laço para quando a tela sai. Um leitor de tela ouve "Inicializando o sistema. Qualquer tecla pula; Delete abre as configurações." (`role="status"`).
  - O roteiro é recalculado quando o `BootInfo` muda (os settings chegam depois), com os mesmos instantes.
- **Layout:**
  - `data-testid="boot"` cobre a janela (`fixed inset-0 z-[60]`) sobre fundo preto.
  - Dentro, o tubo (`crt-screen`) fica a `1.4vh` das bordas, com cantos `rounded-[2.2vw]`. Por cima do texto ficam `crt-scanlines`, `crt-mask`, `crt-noise`, a faixa `crt-roll` (`24vh` de altura) e o vidro `crt-glass`.
  - O `crt-noise` é maior que a tela 64 px de cada lado e salta movendo a própria camada (`transform`, no compositor), não repintando o fundo.
  - O texto tem margem `px-[5vw]`, `pt-[5.5vh]` e `pb-[9vh]`. Só uma tela fica visível por vez: as linhas antes de `clearAt` na primeira, as de depois na segunda.
- **Style:**
  - Fonte `font-bios` (VT323, `--font-bios`) em `clamp(15px, 2.8vh, 34px)`, `leading-[1.2]`, cor `text-hud-text`, com `crt-text` (brilho de fósforo e aberração cromática) e `crt-flicker`. Na troca de tela, `crt-glitch` alarga a aberração por 140 ms.
  - O tubo liga em 0,5 s como um CRT: um ponto, uma linha, a tela inteira, com o brilho caindo de `brightness(3)` para 1 (`CRT_ON`).
  - A saída é só um fade de 0,6 s, um pouco mais claro (`brightness(1.15)`), com a escala mantida em 1 (`SCREEN_OUT`).
  - Na tela de partida, o texto some em 300 ms e a textura do tubo em 700 ms.
  - O cursor é um `_` piscante (`crt-cursor`) em `text-hud-light`, depois da última linha.

### First Screen (POST)

O banner, o processador, a contagem de memória e os dispositivos respondendo um a um.

- **Behavior:**
  - Imprime, nesta ordem: "BIOS Modular v<versão>, Núcleo Holográfico"; "Copyright (C) <ano>, Assistente Local. Nenhum dado sai desta máquina."; "Processador principal"; "Teste de memória" contando de 0 até `<K>K OK` em 700 ms; "Detectando dispositivos..." e, um por vez, Vídeo primário, Tela, Áudio e Motor de voz.
  - Cada dispositivo mostra o nome e só 240 ms depois a resposta.
  - O Áudio responde "Web Audio API" ou, sem `AudioContext`, "Nenhum" em cor de alerta.
  - O rodapé diz "Pressione DEL para entrar no SETUP, qualquer tecla para pular" e mostra o BIOS ID `JV-HOLO-<dígitos da versão>-<id da GPU><vendor>-00`.
  - A tela não tem logo, nome JARVIS, data/hora nem SVG.
- **Layout:**
  - Uma linha por item (`TerminalLine`), com os dois-pontos alinhados na coluna 22 (`LABEL_WIDTH`). Os dispositivos ficam recuados dois espaços.
  - Uma linha vazia de `0.6em` separa o banner, o processador e a memória, e a detecção.
  - O rodapé fica no canto inferior (`bottom-[4vh]`, entre `5vw` de cada lado), em duas linhas: a dica e o BIOS ID.
- **Style:**
  - O banner fica em `text-hud-light`; o copyright em `text-hud-text/55`.
  - As respostas ficam em `text-hud-light` (ok), `text-hud-alert` (aviso) ou `text-hud-text/45` (não se aplica), cortadas com reticências se não couberem.
  - O rodapé fica em `text-hud-text/70`, com "DEL" em `text-hud-light` e o BIOS ID em `text-hud-text/55`.

### Second Screen (Summary and PCI)

Depois do bipe, o resumo da configuração, a listagem PCI e a passagem para o núcleo.

- **Behavior:**
  - A caixa de resumo tem os 10 campos do RF-002. "Memória" mostra `<K>K`; "Sessão" mostra "N janela(s) restaurada(s)" ou "área de trabalho limpa".
  - Depois da caixa: "Listagem de dispositivos PCI...", o cabeçalho "Barr.", "Disp.", "Func.", "Fornec.", "Disp.", "Classe", "Descrição do dispositivo", "IRQ", um traço e as linhas "Controlador de vídeo" (classe `0300`, IRQ 16), "Controlador de áudio" (classe `0403`, IRQ 11, só com áudio) e "Controlador ACPI" (IRQ 9).
  - O vendor do vídeo segue o RF-003; o áudio usa `1022` quando a GPU é AMD e `8086` nos outros casos.
  - Em seguida, "Verificando dados do pool DMI " ganha 12 pontos em 600 ms, e a última linha é "Iniciando o núcleo holográfico...".
- **Layout:**
  - A caixa é um `fieldset` de até `100ch`, com a legenda "Configuração do sistema" centrada no topo e uma grade de duas colunas. Os dois-pontos ficam na coluna 15 (`SUMMARY_LABEL_WIDTH`).
  - A tabela PCI usa colunas de largura fixa (6, 6, 6, 8, 6, 7, 30 e 3 caracteres); a última, o IRQ, é alinhada à direita.
- **Style:**
  - A caixa e o divisor entre as colunas usam borda dupla de 3 px em `hud-text/70`; a legenda fica em `text-hud-light`.
  - Os valores usam as mesmas cores da primeira tela.

### System Probe (`probeSystem` and `describeBoot`)

Monta o que as duas telas dizem da máquina e do JARVIS.

- **Behavior:**
  - O processador é "<n> núcleos lógicos" (`navigator.hardwareConcurrency`, 4 sem o valor). A tela é "<largura> × <altura> @ <escala>x".
  - O nome da GPU vem do renderer WebGL (um contexto descartável), sem o invólucro do ANGLE, sem o `(0x…)` e sem o sufixo "Direct3D…/OpenGL…/Vulkan…"; acima de 46 caracteres, vira 45 mais "…".
  - Sem WebGL, o vídeo aparece como "sem WebGL"; uma exceção na leitura dá "WebGL". Nos dois casos, o vendor PCI cai em `1414`.
  - A memória vem de `navigator.deviceMemory`, que o Chromium limita a 8 GB; sem o valor, 8 GB.
  - O tema mostra o nome da paleta ou "Personalizada <matiz>°".
  - A ativação mostra "Segurar para falar", "Hey Jarvis" ou "Sempre ouvindo".
  - O motor de voz mostra "Whisper <rótulo>" (ok), "Whisper <rótulo> · não baixado" (alerta), "verificando…" com os settings ainda carregando, ou "modo navegador · só visual" no navegador.
  - Com os settings ainda carregando, Ativação e Tema mostram "…".
  - O Perfil gráfico é o nível atual de `useQuality`, em maiúsculas (KL-005).
  - A versão vem de `__APP_VERSION__` (a versão do `package.json`).

### `Startup`

A "máquina ganhando vida" depois do POST: o emblema de anéis e "Bem-vindo" (RF-004).

- **Behavior:**
  - O emblema entra 250 ms depois do início da tela, junto com o acorde; "Bem-vindo" entra 350 ms depois do emblema.
  - Um pulo antes do fim do POST vai direto ao fade de saída, sem passar por esta tela.
- **Layout:** `data-testid="boot-startup"` centraliza, numa coluna com espaço de `3.2vh`, o emblema `Rings` (`20vh`) e o texto "Bem-vindo" embaixo.
- **Style:**
  - Um brilho radial de `hud-cyan` a 16%, centrado um pouco acima do meio, aparece em 0,9 s.
  - O emblema e o texto ficam em `text-hud-light`. Cada um entra em 0,8 s de `opacity 0`, `scale 0.94` e `blur(6px)`; com movimento reduzido, só a opacidade, em 0,3 s.
  - `Rings` é um SVG em `currentColor`: dois arcos girando em 9 s, um anel tracejado girando ao contrário em 5 s, um anel fixo e um ponto central, com sombra `hud-holo` a 60%.
  - "Bem-vindo" usa `font-sans` leve em `clamp(16px, 2.6vh, 30px)`, com `tracking-[0.08em]`.

### Sounds (`createBootSound`)

O bipe, o acorde e os efeitos da saudação e do `JarvisReply`, sintetizados (RF-009, RF-010).

- **Behavior:**
  - `beep`: onda quadrada de 1000 Hz por um passa-baixa de 2400 Hz, ~150 ms.
  - `chime`: A2, E3, B3, C#4 e E4, cada nota um seno e um triângulo levemente desafinados, por 3,2 s, com o filtro descendo de 3200 para 800 Hz.
  - `hit` e `glitch`: o impacto de cada palavra e os zaps da saída, usados pela saudação e pelo `JarvisReply`.
  - Com `sound` desligado, ou sem Web Audio, todos os sons são vazios (`SILENT`).
  - Sem gesto do usuário no navegador, o `AudioContext` fica suspenso e os sons não tocam.
  - `close()` fecha o contexto com atraso (RNF-003).

### Orchestration in `App`

Liga o boot ao resto do desktop (RF-008).

- **Behavior:**
  - `booting` começa igual a `jarvis.boot.enabled`, lido de forma síncrona. Com o boot desligado, não há boot nem saudação: o núcleo já está ligado.
  - Durante o boot, o núcleo fica em `standby`; a dock (`entered`), a barra superior, o `CoreButton` e o botão do histórico ficam fora.
  - `finishBoot` desliga `booting`, marca `ignitedAt`, inicia a saudação, dá dois pulsos (no fim e 1,3 s depois) e, se Delete foi apertado, abre as Configurações.
  - `replayBoot` fecha o Menu avançado, descarta a saudação pendente e o que viria depois dela, e liga `booting`, mesmo com o boot desligado (RF-007).
  - O boot roda com qualquer modo de núcleo: o núcleo é sempre desenhado, porque é ele que avisa o primeiro quadro.

### Window Reveal

A janela do Windows nasce oculta e só aparece quando já há algo desenhado.

- **Behavior:**
  - Quando o núcleo desenha o primeiro quadro (`onFirstFrame`), o `App` chama `reveal()`: mostra e foca a janela uma vez, e marca `firstFrame` para o POST começar.
  - Se esse sinal não chegar, a UI chama `reveal()` 500 ms depois de montar (`REVEAL_FALLBACK_MS`), e uma thread do `setup` no Rust mostra e foca a janela após 2,5 s (`REVEAL_FALLBACK`), se ela ainda estiver oculta.
  - Fora do Tauri, `reveal()` não faz nada.

### Advanced Menu "Inicialização" Section

As preferências do boot, no topo da aba Cores do Menu avançado.

- **Behavior:**
  - O switch "Tela de inicialização" ("BIOS num monitor CRT ao abrir o JARVIS; qualquer tecla pula") troca `enabled`.
  - O switch "Sons da inicialização" ("Bipe de POST e o acorde ao ligar") troca `sound`.
  - O botão "Ver agora" chama `replayBoot`.
- **Layout:** uma `Section` "Inicialização" com dois `SwitchRow` e um `ActionButton`.
- **Style:** os controles do kit do Menu avançado, sem estilo próprio.

### Interaction Flow

```mermaid
sequenceDiagram
  participant R as Rust (setup)
  participant A as App
  participant C as Núcleo (2D/3D/off)
  participant B as BootSequence
  R->>R: janela visible:false; thread dorme 2,5 s
  A->>C: render (ignition "standby")
  C-->>A: onFirstFrame()
  A->>A: reveal() (show + focus) · firstFrame = true
  A->>B: started = true
  B->>B: fonte VT323 carregada → relógio rAF
  B->>B: 1ª tela → clearAt: beep + glitch → resumo + PCI
  B->>B: startupAt + 250 ms: chime + emblema "Bem-vindo"
  B-->>A: onDone(openSettings) após fade 0,6 s
  A->>C: ignitedAt = now · pulse · pulse(+1,3 s)
  A->>A: Greeting · dock e barra entram
  R->>R: 2,5 s: se ainda oculta, show()
```

### User Feedback

| Moment | Persona Key | Output |
|---|---|---|
| Fim da detecção | — | Bipe e glitch de 140 ms; a segunda tela entra |
| Tela de partida | — | Acorde, emblema e "Bem-vindo" |
| Leitor de tela | — | "Inicializando o sistema. Qualquer tecla pula; Delete abre as configurações." |
| Fim do boot | — | Núcleo liga com dois pulsos; a saudação começa |

### Voice and Keyboard

- Qualquer tecla sem Ctrl, Meta ou Alt: pula. O listener fica na fase de captura e chama `preventDefault` + `stopImmediatePropagation`, então `M` não liga o microfone (RF-005).
- `Delete`: pula e abre as Configurações (`onDone(true)`).
- Ctrl, Meta ou Alt: o boot não intercepta o atalho.
- Clique (`pointerdown`) na tela: pula.
- Busca: "Ver a tela de inicialização" (`boot-replay`) e "Desativar a tela de inicialização" ou "Ativar a tela de inicialização" (`boot-toggle`), no grupo Sistema; "Menu avançado › Cores" abre a aba.
- Não há frase de voz.

## Data Model and Persistence

### Boot Preferences

```ts
interface BootPrefs {
  enabled: boolean; // a BIOS toca ao abrir o JARVIS
  sound: boolean;   // bipe, acorde, e os sons da saudação e do JarvisReply
}
```

### Boot Info and System Probe

```ts
type BootStatus = "ok" | "warn" | "skip";

interface BootInfo {
  version: string;
  quality: string;                               // nível em maiúsculas
  voice: { value: string; status: BootStatus };
  activation: string;
  theme: string;
  modules: number;                               // WINDOW_KINDS.length
  windows: number;                               // janelas restauradas
}

interface SystemProbe {
  cpu: string;
  gpu: string;
  screen: string;
  memoryKb: number;
  audio: boolean;
}
```

`BootInfo` é montado por `describeBoot` a cada render; `SystemProbe` é lido uma vez por `probeSystem` quando a tela monta. O roteiro (`Script`) traz as linhas com o instante de cada uma, `printed` (tudo na tela), `clearAt` (o bipe e a troca de tela), `glitches` e o BIOS ID. Ver a [persistência](../../domain/persistence.md).

### Storage Rules

| Property | Value |
|---|---|
| State | `$prefs` (`BootPrefs`) |
| Storage | `localStorage` |
| Key | `jarvis.boot` |
| Write Debounce | 250 ms (`useStoredState`), com flush no `beforeunload` |
| Reader | `parseBoot`: cada campo que não é booleano volta ao padrão sem mexer no outro |
| Missing or Invalid Storage | `{ enabled: true, sound: true }` |
| First Read | Síncrona, para valer desde o primeiro quadro |

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src/components/BootSequence.tsx` | Roteiro do POST (`buildScript`), relógio, render das linhas (`TerminalLine`), tela de partida (`Startup`, `Rings`), teclas e clique para pular |
| `src/lib/boot.ts` | `BootPrefs` e `useBootPrefs` (`jarvis.boot`), `describeBoot`, `probeSystem` e `gpuName` |
| `src/lib/bootSound.ts` | `createBootSound(enabled)`: `beep`, `chime`, `hit`, `glitch`, `close`; `SILENT` quando desligado ou sem Web Audio |
| `src/lib/asciiFont.ts` | Letras "ANSI Shadow" (`asciiWord`), sem nenhum importador (KL-001) |
| `src/App.tsx` | `booting`, `firstFrame`, `onFirstFrame` → `reveal()`, `finishBoot`, `replayBoot`, `bootInfo`, e o que espera o boot |
| `src/hooks/useWindowControls.ts` | `reveal()` e o fallback de 500 ms (`REVEAL_FALLBACK_MS`) |
| `src-tauri/src/lib.rs` | `REVEAL_FALLBACK` (2,5 s): mostra e foca a janela se ela ainda estiver oculta |
| `src-tauri/tauri.conf.json` | `visible: false`, `backgroundColor`, `--autoplay-policy`, CSP |
| `src/styles/globals.css` | `@utility crt-screen`, `crt-text`, `crt-flicker`, `crt-glitch`, `crt-cursor`, `crt-scanlines`, `crt-mask`, `crt-noise`, `crt-roll`, `crt-glass`; `--font-bios` |
| `src/components/desktop/AdvancedMenu.tsx` | Seção "Inicialização" na aba Cores |
| `src/lib/commands.ts` | `boot-replay`, `boot-toggle` (grupo Sistema) |

### Script Constants

| Constant | Value | Usage |
|---|---|---|
| `LINE_MS` | 70 ms | Por linha de texto |
| `DETECT_MS` | 240 ms | Do nome do dispositivo à resposta |
| `GLITCH_MS` | 140 ms | Glitch na troca de tela |
| `STARTUP_MS` | 2100 ms | Tela de partida |
| `CHIME_DELAY` | 250 ms | Acorde e emblema |
| `REDUCED_HOLD` | 1100 ms | Pausa com movimento reduzido |
| `START_FALLBACK_MS` | 1500 ms | Começa sem primeiro quadro ou fonte |
| `MAX_STEP_MS` | 100 ms | Avanço máximo por quadro |
| `RENDER_STEP_MS` | 32 ms | Intervalo mínimo entre renders da tela |

### Script Algorithm

1. `buildScript` monta a lista de linhas, cada uma com o instante em que aparece; a memória e os pontos do DMI têm início e fim.
2. `clearAt` fica 450 ms depois do fim da detecção do Motor de voz; a caixa de resumo nasce nele.
3. `printed` é o fim do roteiro (570 ms depois de "Iniciando o núcleo holográfico..." aparecer); `startupAt` = `printed`, mais 1100 ms com movimento reduzido; o fim é `startupAt + 2100`.
4. A cada quadro, `agora = último + min(Δ, 100)`; um som toca se o instante dele caiu entre o último e o agora.
5. Ao chegar ao fim, `exit` dispara o fade e o laço para.

### Related Architecture Decisions

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0011 — fakes de dev e E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0013 — núcleo 2D por padrão](../../arch/adr/0013-nucleo-2d-padrao.md)
- [ADR-0014 — linguagem visual TUI](../../arch/adr/0014-linguagem-visual-tui.md)

## Interfaces and Contracts

### Native Window

| Contract | Value | Notes |
|---|---|---|
| `tauri.conf.json` › janela | `visible: false`, `backgroundColor: #000508` | Sem flash branco |
| `tauri.conf.json` › `additionalBrowserArgs` | `--autoplay-policy=no-user-gesture-required` | O som toca sem gesto no app |
| `getCurrentWindow().show()` + `setFocus()` | Chamados por `reveal()` | Só com `isTauri()` |
| `REVEAL_FALLBACK` | 2500 ms | Thread do `setup` em `lib.rs` |

### Search Commands

| Command ID | Title | Action |
|---|---|---|
| `boot-replay` | "Ver a tela de inicialização" | `replayBoot` |
| `boot-toggle` | "Desativar a tela de inicialização" / "Ativar a tela de inicialização" | Troca `enabled` |
| `advanced:colors` | "Menu avançado › Cores" | Abre a aba com a seção "Inicialização" |

### Component Contract

| Prop of `BootSequence` | Meaning |
|---|---|
| `started` | O núcleo desenhou o primeiro quadro (a janela está visível) |
| `sound` | `jarvis.boot.sound` |
| `info` | `BootInfo` de `describeBoot` |
| `onDone(openSettings)` | Fim do fade; `true` se Delete foi apertado |

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| `jarvis.boot` ausente ou com JSON inválido | `{enabled: true, sound: true}` | Storage Rules |
| Um campo de `jarvis.boot` inválido | Só ele volta ao padrão (`parseBoot`) | RF-006 |
| Settings ainda não carregados | Ativação e Tema mostram "…"; no desktop, o motor de voz mostra "verificando…" | System Probe |
| Sem WebGL | Vídeo "sem WebGL"; vendor PCI `1414` | RF-003 |
| Sem `AudioContext` | Áudio "Nenhum" em alerta; sem linha de áudio no PCI; sons `SILENT` | First Screen |
| Sem `hardwareConcurrency` / `deviceMemory` | 4 núcleos / 8 GB | System Probe |
| Várias teclas ou cliques | Só o primeiro pulo vale (`current ?? …`): um Delete depois de outra tecla não abre as Configurações | AC-007, AC-008 |
| Teclas durante o fade | Continuam engolidas pelo listener até a tela sair | RF-005 |
| "Ver agora" com uma saudação pendente | Ela e o que viria depois são descartados; o boot toca de novo, mesmo desligado | RF-007 |
| Fonte VT323 ou primeiro quadro não chegam | O POST começa após 1,5 s | `START_FALLBACK_MS` |
| Primeiro quadro não avisa | A UI revela a janela após 500 ms; o Rust após 2,5 s, se ainda oculta | AC-017 |
| Quadro travado | A linha do tempo avança no máximo 100 ms | `MAX_STEP_MS` |
| Movimento reduzido | Tudo de uma vez, 1100 ms de pausa, sem CRT nem glitch, e sem bipe | KL-004 |
| Núcleo em 2D ou desligado | O boot roda igual; o Perfil gráfico mostra o nível provisório | SC-003, KL-005 |
| Navegador sem gesto do usuário | `AudioContext` suspenso; os sons não tocam | Sounds |
| Fora do Tauri | `reveal()` não faz nada | Window Reveal |
| Atalhos com Ctrl, Meta ou Alt | Não são interceptados | AC-010 |
| Permissões | Nenhum dado sai da máquina; a VT323 vem empacotada porque a CSP não permite fontes remotas; a leitura da GPU usa um contexto WebGL descartável | RNF-001, RNF-002 |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [holographic-core](../holographic-core/spec.md) | O primeiro quadro do núcleo libera o POST e revela a janela; o núcleo fica em `standby` até a ignição |
| [greeting-homecoming](../greeting-homecoming/spec.md) | A saudação começa no fim do boot e usa `hit`/`glitch` e a preferência `sound` |
| [settings](../settings/spec.md) | O Menu avançado e as Configurações que o Delete abre |
| [appearance](../appearance/spec.md) | Tokens `hud-*`, utilitários `crt-*` e `--font-bios` |
| [search](../search/spec.md) | `boot-replay`, `boot-toggle` |
| [dock-taskbar](../dock-taskbar/spec.md) | A dock e a barra entram depois |
| [voice-engine](../voice-engine/spec.md) | O modelo Whisper mostrado no campo Motor de voz |

### Runtime Dependencies

- [React](../../foundation/vendor/react/spec.md) e [motion](../../foundation/vendor/motion/spec.md) (o CRT ligando e os fades).
- [VT323](../../foundation/vendor/vt323/spec.md) (`@fontsource/vt323`).
- [Tailwind CSS 4](../../foundation/vendor/tailwind/spec.md) (`@utility crt-*`).
- [Tauri](../../foundation/vendor/tauri/spec.md) (mostrar e focar a janela).
- WebView2: WebGL só para ler o nome da GPU, Web Audio e `--autoplay-policy=no-user-gesture-required`.

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/boot.spec.ts` — "the BIOS runs its POST over two screens, comes to life with the emblem and a welcome, and reveals the hologram" | POST em duas telas, "modo navegador", rodapé e BIOS ID, sem JARVIS/data/SVG, resumo e PCI, DMI, "Bem-vindo", fade sem colapso e sem `boot-flash`, dock e barra, tela sem texto | AC-001–AC-006 |
| `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings" | `M` pula sem ligar o microfone; Delete abre "Configurações" | AC-007, AC-008 |
| `tests/boot.spec.ts` — "the advanced menu turns the boot off and replays it" | O clique pula; o switch grava `enabled: false`; "Ver agora" toca de novo; recarregado, sem boot nem saudação | AC-009, AC-011–AC-013 |
| `tests/core.spec.ts` — "with the core in 2D (the default), the boot screen still plays and hands over" e "with the core off, the boot screen still plays and hands over" | O POST começa no primeiro quadro e entrega o desktop com o núcleo em 2D ou desligado | AC-016 (indireto), SC-003 |

### Verification Commands

Na raiz do repositório:

```powershell
npx playwright test tests/boot.spec.ts --project ui
npx playwright test tests/core.spec.ts --project ui -g "from a fresh start"
```

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| Atalhos com modificador (AC-010) | Sem teste | Apertar `Control+Shift+,` no boot e conferir que ele continua e o Menu avançado abre |
| Comandos de busca (AC-014) | Sem teste | `/`, "ver a tela" e Enter |
| Boot mudo (AC-015) | Sem teste | Espionar `AudioContext` com `sound: false` |
| Fallbacks de revelação (AC-017) | Sem teste | Só no app real (via CDP) |
| Movimento reduzido | Sem teste | `page.emulateMedia({ reducedMotion: "reduce" })` e conferir a pausa de 1100 ms |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código e dos commits `42e671a`, `c4ccc57` e `e7151cf`.

### Phase 1 — Foundation

- [x] T001 `BootPrefs`, `parseBoot` e `useBootPrefs` (`jarvis.boot`) — `src/lib/boot.ts`
- [x] T002 [P] `probeSystem` e `gpuName` (renderer WebGL sem o invólucro ANGLE, até 46 caracteres) — `src/lib/boot.ts`
- [x] T003 [P] `describeBoot`: voz, ativação, tema (com "Personalizada <matiz>°"), versão `__APP_VERSION__` — `src/lib/boot.ts`
- [x] T004 [P] Sons sintetizados `beep`, `chime`, `hit`, `glitch` e `close` com fechamento atrasado — `src/lib/bootSound.ts`
- [x] T005 [P] Utilitários `crt-*` e `--font-bios` — `src/styles/globals.css`

### Phase 2 — Watch the POST (US1)

- [x] T006 [US1] `buildScript`: banner, memória, detecção, resumo, PCI, DMI e hand-over — `src/components/BootSequence.tsx`
- [x] T007 [US1] Relógio rAF com `MAX_STEP_MS` e disparo de `beep`/`chime` ao passar dos instantes — `src/components/BootSequence.tsx`
- [x] T008 [US1] `TerminalLine` (text, memory, field, summary, dots, gap) e cursor piscante — `src/components/BootSequence.tsx`
- [x] T009 [US1] Tela de partida `Startup` com o emblema `Rings` e "Bem-vindo". Saída por fade, sem colapsar o tubo — `src/components/BootSequence.tsx`
- [x] T010 [US1] Integração: `booting`, `bootInfo`, `finishBoot`, e dock/barra/botão do núcleo esperando o boot — `src/App.tsx`
- [x] T011 [US1] BIOS "mais realista" em duas telas (evolução) — `c4ccc57`
- [x] T012 [US1] Campo "Tema" no lugar de "Tema e fundo" após a remoção do fundo — `e7151cf`

### Phase 3 — Skip (US2)

- [x] T013 [US2] Listener de teclado em captura: modificadores passam, Delete abre Configurações — `src/components/BootSequence.tsx`
- [x] T014 [US2] Clique pula (`onPointerDown`) e o fade de 0,6 s chama `onDone` — `src/components/BootSequence.tsx`

### Phase 4 — Turn Off and Replay (US3)

- [x] T015 [US3] Seção "Inicialização" (switches e "Ver agora") — `src/components/desktop/AdvancedMenu.tsx`
- [x] T016 [P] [US3] Comandos `boot-replay` e `boot-toggle` — `src/lib/commands.ts`
- [x] T017 [US3] `replayBoot` descarta a saudação pendente — `src/App.tsx`

### Phase 5 — Window Without a White Flash (US4)

- [x] T018 [US4] `reveal()` no primeiro quadro e fallback de 500 ms — `src/hooks/useWindowControls.ts`
- [x] T019 [P] [US4] `REVEAL_FALLBACK` de 2,5 s numa thread do `setup` — `src-tauri/src/lib.rs`
- [x] T020 [US4] POST só depois do primeiro quadro e da fonte, ou após `START_FALLBACK_MS` — `src/components/BootSequence.tsx`

### Phase 6 — Verification

- [x] T021 Playwright `tests/boot.spec.ts` — "the BIOS runs its POST over two screens, comes to life with the emblem and a welcome, and reveals the hologram"
- [x] T022 Playwright `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings"
- [x] T023 Playwright `tests/boot.spec.ts` — "the advanced menu turns the boot off and replays it"
- [x] T024 Playwright `tests/core.spec.ts` — "with the core in 2D (the default), the boot screen still plays and hands over" e "with the core off, the boot screen still plays and hands over"

## Rollback Plan

1. Tire `BootSequence` e o estado `booting` do `App.tsx`, a seção "Inicialização" do Menu avançado e `boot-replay`/`boot-toggle` de `commands.ts`. O desktop segue o caminho que já existe com o boot desligado: o núcleo nasce ligado e não há saudação, porque ela começa no `finishBoot`.
2. Mantenha `reveal()` (`useWindowControls.ts`) e o `REVEAL_FALLBACK` do `lib.rs`: a janela nasce com `visible: false`, e sem eles ela só apareceria após 2,5 s, ou nunca.
3. Mantenha `bootSound.ts` e os utilitários `crt-*`: a saudação e o `JarvisReply` usam `hit` e `glitch`; `crt-text` e `crt-cursor` também aparecem no `JarvisReply`, no histórico do JARVIS, no jv_agent e na calculadora; e a preferência `sound` silencia a saudação e o `JarvisReply`.
4. A chave `jarvis.boot` fica órfã e é ignorada. Sem o import em `BootSequence.tsx`, a VT323 não carrega, e `--font-bios` cai em `--font-mono`.

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P1 — Offline-first | Atendido | Sondagem por APIs do navegador, sons sintetizados, fonte empacotada |
| P2 — Rust dono do nativo | Atendido | Mostrar a janela é do Tauri (`getCurrentWindow().show()`, `REVEAL_FALLBACK` em `lib.rs`) |
| P5 — Persistência tolerante | Atendido | `parseBoot` valida campo a campo e volta ao padrão |
| P6 — Fora do Tauri | Atendido | A mesma tela roda no Vite; `reveal()` só age com `isTauri()` |
| P7 — PT-BR | Atendido | Todo o texto do POST e os rótulos estão em PT-BR |
| P8 — Linguagem visual | Atendido | Cores dos tokens `hud-*`, utilitários `crt-*` em `globals.css`, emblema em `currentColor` |
| P9 — Desktop leve | Atendido | O laço para quando a tela sai; render a ~30 fps; ruído no compositor; o `AudioContext` fecha depois do acorde |
| P11 — Testes | Atendido, com lacunas | Três testes em `boot.spec.ts` e os dois do bloco "from a fresh start"; AC-010, AC-014, AC-015 e AC-017 sem teste (KL-006) |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | `src/lib/asciiFont.ts` (`asciiWord`) não é importado por nenhum arquivo de `src/` nem de `tests/`. | Código morto |
| KL-002 | O comentário de `BootPrefs.sound` em `src/lib/boot.ts` cita "keyboard clicks", que `src/lib/bootSound.ts` não sintetiza. | Comentário desatualizado |
| KL-003 | O switch "Sons da inicialização" ("Bipe de POST e o acorde ao ligar") também silencia os impactos da saudação e os zaps do `JarvisReply`, mas o texto não diz isso. | Ver OQ-001 |
| KL-004 | Com movimento reduzido, o relógio começa em `printed`, já depois de `clearAt`, então o bipe nunca toca; só o acorde. | Comportamento atual, efeito colateral do `REDUCED_HOLD` |
| KL-005 | O campo "Perfil gráfico" mostra o nível de `useQuality` mesmo com o núcleo em 2D ou desligado; sem `?quality=` nem `jarvis.quality`, é o `MEDIUM` provisório, porque a GPU não é consultada fora do 3D. | Informação imprecisa no resumo |
| KL-006 | AC-010, AC-014, AC-015 e AC-017 não têm teste automatizado; AC-016 é coberto só indiretamente. | Lacuna de verificação |

## Open Questions

| ID | Question | Evidence and Impact | Suggested Resolution |
|---|---|---|---|
| OQ-001 | A preferência `sound` deve continuar valendo para a saudação e para o `JarvisReply`, ou cada um deve ter o seu switch? | Um só switch, rotulado como do boot, silencia três coisas (KL-003, RF-010). | Ou renomear e explicar o switch ("Sons do JARVIS"), ou separar as preferências. |

## References

- Versão anterior desta spec, no formato SpecLang: `git show e7151cf:.specs/features/boot/spec.md`. A versão intermediária, no formato do spec-coding.dev ([ADR-0023](../../arch/adr/0023-specs-formato-spec-coding-dev.md)), não chegou a ser commitada.
- Modelo de formato: [reminders](../reminders/spec.md) ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)).
- Código conferido: listado em Metadata › Verification Scope.
