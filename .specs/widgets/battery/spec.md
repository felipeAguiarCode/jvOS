# Bateria

Widget com a carga do notebook no estilo de um status de terminal, lida da Battery Status API da WebView.

| | |
|---|---|
| **ID** | `widget/battery` |
| **Status** | Implementado |
| **Origem** | `42e671a` (2026-10-23) · evoluída em `c4ccc57` e `048a254` |
| **Window kind** | `battery` em `src/lib/desktop.ts` (300 × 150, mínimo 220 × 120, grupo `widgets`) |
| **Voz** | `window:battery` ("bateria", "battery") |

## Visão geral

O widget Bateria mostra a carga do notebook como um status de terminal: a porcentagem grande, uma barra de blocos, o estado ("na tomada", "carregando", "na bateria") e o tempo estimado para encher ou esvaziar. Quando a carga está baixa, tudo fica na cor de alerta. Os dados vêm da Battery Status API da WebView, então não há código nativo. A mesma leitura alimenta o módulo de bateria da barra superior e o que o JARVIS diz sobre a máquina.

## Dados

- `$status`: o **BatteryStatus**, `loading` · `unavailable` · `ready { level, charging, chargingTime, dischargingTime }`. Só em memória, renovado pelos eventos da API. Ver [glossário](../../domain/glossary.md).
  - `level` vai de 0 a 1. `chargingTime` e `dischargingTime` são segundos, com `Infinity` quando o tempo é desconhecido.
- `$opções`: as **Opções da Bateria**, `{ percent, bar, state, time }`, todas `true` por padrão. Ficam em `jarvis.widget.battery` (250 ms; sem migração). `parseToggles` troca pelo padrão cada chave que não for booleana.

## Componentes

### `useBattery`

O hook que lê a bateria ao vivo e publica $status.

- **Comportamento:**
  - **RF-001**: O widget DEVE ler `navigator.getBattery()` e ouvir `levelchange`, `chargingchange`, `chargingtimechange` e `dischargingtimechange`.
    - Comece em `loading`. Com o `BatteryManager` em mãos, publique `ready` e releia a cada evento (RNF-001).
  - Se não houver `navigator.getBattery`, ou se ele falhar (por exemplo num navegador headless, como diz o teste), então $status é `unavailable`.
  - **RF-004**: O widget DEVE tratar `charging && level >= 1 && chargingTime === 0` como "na tomada" (`isPlugged`).
    - É assim que um desktop sem bateria se apresenta: carregando, 100% e `chargingTime` 0.

### `Battery`

Mostra $status no estilo TUI, conforme $opções.

- **Comportamento:**
  - **RF-002**: O widget DEVE mostrar a carga arredondada em %, a barra de 18 células, o estado e o tempo, cada um com sua opção (`percent`, `bar`, `state`, `time`).
    - O estado é "na tomada" (`isPlugged`), "carregando" ou "na bateria".
    - O tempo é "<duração> para 100%" quando carrega e "<duração> restantes" quando descarrega. `formatDuration` escreve `2h05` a partir de uma hora e `40 min` abaixo disso.
  - Se o tempo for desconhecido (`Infinity` ou 0), ou se o estado for "na tomada", então a linha `tempo` não aparece.
  - **RF-003**: O widget DEVE marcar a bateria como baixa quando não estiver carregando e a carga for ≤ `LOW_BATTERY` (0,15).
    - Baixa, a porcentagem e a barra ficam na cor de alerta e o estado diz "na bateria · baixa".
    - Se estiver carregando e com a carga baixa, então não conta como baixa, porque o alerta só vale sem carregador.
  - **RF-005**: O widget DEVE mostrar "Indisponível neste ambiente" quando a API não existir ou falhar.
    - Enquanto $status for `loading`, mostre "Lendo a bateria…".
    - Se $status for `unavailable`, então o menu de opções continua funcionando.
  - Se todas as opções estiverem desligadas, então mostre "Tudo oculto · botão direito para escolher".
- **Layout:**
  - Sem leitura (`loading` ou `unavailable`): uma linha centralizada na vertical, com o prompt `$` e a mensagem.
  - Com leitura: uma coluna centralizada na vertical (`gap-1.5 px-4 pb-1`), com a porcentagem grande no topo, a `BlockBar` "Carga da bateria" embaixo e, por último, as linhas `KeyValue` `estado` e `tempo`.
  - O widget recebe foco (`tabIndex={0}`) para abrir o menu pelo teclado.
- **Estilo:**
  - A porcentagem fica em `font-mono`, `leading-none`, números tabulares e tamanho `clamp(26px, 15cqw, 72px)`. A cor é `text-hud-light`, ou `text-hud-alert` com a bateria baixa.
  - A `BlockBar` usa `tone="alert"` com a bateria baixa, e as células cheias ficam em `text-hud-alert` em vez de `text-hud-light`.
  - As linhas `KeyValue` são `font-mono` 12 px, com a chave em `text-hud-cyan`.
  - A mensagem sem leitura e o "Tudo oculto" ficam em `font-mono` 12 px, `text-hud-text/55`, e o `$` em `text-hud-cyan`.
  - Com leitura, o texto é selecionável (`select-text`).

### Menu "Opções do widget Bateria"

O menu de botão direito, feito com `useWidgetMenu`, `WidgetMenu` e `toggleItems`.

- **Comportamento:**
  - Cada item liga ou desliga uma chave de $opções e grava em `jarvis.widget.battery`. A escolha continua depois de recarregar.
  - Marcar um item deixa o menu aberto. `Esc`, um clique fora ou sair da janela fecham o menu.
- **Layout:** uma seção "Exibir" com as caixas "Porcentagem", "Barra de carga", "Estado" e "Tempo restante", nessa ordem.
- **Estilo:** o kit do `WidgetMenu`: `font-mono` 12 px, borda `hud-cyan/30`, fundo `hud-panel/95`, caixas `[x]` / `[ ]` em `text-hud-cyan` e o item em foco em vídeo reverso.

### `readBattery` (status do JARVIS)

Uma leitura única, para o status da máquina que o JARVIS fala (`readMachine()` no `App`).

- **Comportamento:**
  - Devolva `{ level, charging }`, ou `null` sem bateria.
  - Se não houver API, ou se ela falhar, então devolva `null`.
  - Se for um desktop na tomada (`isPlugged`), então essa leitura vale como "sem bateria" (`null`).

### Módulo da barra superior (`BatteryModule`)

- **Comportamento:**
  - Mostre o módulo só com $status `ready` e com o módulo ligado na barra. Um clique abre o widget (`onWindow("battery")`).
  - O rótulo é "Bateria <n>%" e o texto é `<n>%`.
- **Layout:** o ícone (12 px) e, ao lado, a porcentagem. O ícone é `Plug` na tomada, `BatteryCharging` carregando, `BatteryWarning` baixa e `BatteryMedium` no resto.
- **Estilo:** números tabulares. Com a bateria baixa, fica em `text-hud-alert`. No hover, o fundo fica `hud-cyan/10`.

## Voz e teclado

- `window:battery` ("bateria", "battery"): abre ou fecha o widget.
- Módulo de bateria da barra superior: `onWindow("battery")`.
- Botão direito, ou a tecla de menu com o widget em foco: menu "Opções do widget Bateria".

## Restrições

- **RNF-001**: Não usa polling, só eventos da API.
- **RNF-002**: Não depende do Tauri e roda igual no modo web.
- Baixa = ≤ 15% sem carregador; sem polling.

## Histórias de usuário

### US1 — Ver a carga e o estado (P1)

Como usuário de notebook, quero ver quanto de bateria resta e se está carregando.

**Por que P1:** é todo o conteúdo do widget.
**Teste independente:** `tests/desktop.spec.ts` — `the battery widget shows a level or says it is unavailable`.

**Aceite**

1. **Dado** um notebook com bateria, **quando** abro "Bateria", **então** vejo `NN%` grande, a barra "Carga da bateria" com 18 células e `estado ~ na bateria` (ou `carregando`).
2. **Dado** a máquina descarregando com tempo conhecido, **então** vejo `tempo ~ 2h05 restantes` ou `tempo ~ 40 min restantes`.
3. **Dado** a máquina carregando com tempo conhecido, **então** vejo `tempo ~ <duração> para 100%`.
4. **Dado** a carga em 15% ou menos e sem carregador, **então** a porcentagem e a barra ficam na cor de alerta e o estado diz `na bateria · baixa`.
5. **Dado** a carga mudando, **quando** o navegador dispara `levelchange` ou `chargingchange`, **então** o widget atualiza sozinho.

### US2 — Ambientes sem bateria (P1)

Como usuário de desktop ou do modo web, quero uma mensagem clara em vez de números falsos.

**Por que P1:** evita leituras enganosas.
**Teste independente:** `tests/desktop.spec.ts` — `the battery widget shows a level or says it is unavailable`.

**Aceite**

1. **Dado** um navegador sem `navigator.getBattery`, ou em que ele falha, **quando** abro o widget, **então** vejo `$ Indisponível neste ambiente`.
2. **Dado** a leitura ainda em andamento, **então** vejo `$ Lendo a bateria…`.
3. **Dado** um desktop sem bateria, que se apresenta como bateria cheia na tomada (carregando, 100%, `chargingTime` 0), **então** o estado diz `na tomada`, sem linha de tempo.

### US3 — Escolher o que aparece (P2)

**Teste independente:** `tests/widgets.spec.ts` — `Bateria: right click turns parts of the widget off, and it stays so`.

**Aceite**

1. **Dado** o menu "Opções do widget Bateria", **quando** desmarco "Porcentagem", **então** o número grande some e continua escondido depois de recarregar. Os outros itens são "Barra de carga", "Estado" e "Tempo restante".
2. **Dado** todos os itens desmarcados, **então** o widget mostra "Tudo oculto · botão direito para escolher".

## Critérios de sucesso

- **SC-001**: Num notebook, a porcentagem do widget bate com a do Windows.
- **SC-002**: Sem bateria nem API, o widget nunca mostra um número inventado.

## Fora de escopo e limitações

- Não avisa por som nem por voz quando a bateria fica baixa. Só a cor muda.
- Não lê a bateria pelo Windows (Rust). Depende do que a WebView2 expõe.
- O módulo da barra superior e o status falado pelo JARVIS usam o mesmo hook, mas são descritos nas próprias specs ([voice-shortcuts](../../features/voice-shortcuts/spec.md)).

## Código

O hook `useBattery` envolve a Battery Status API (`navigator.getBattery`, ausente do `lib.dom`, por isso a interface `BatteryManager` é declarada à mão). Ele publica um `BatteryStatus` discriminado e se atualiza pelos eventos da API. O widget `Battery` formata o resultado no estilo TUI. A função `readBattery` faz uma leitura única para o JARVIS e trata o desktop "na tomada" como sem bateria.

| | |
|---|---|
| **Camadas** | UI React (`Battery.tsx`) · hook (`useBattery`) |
| **Dependências** | Battery Status API da WebView2; kit TUI (`BlockBar`, `KeyValue`) |
| **Testes** | `tests/desktop.spec.ts`, `tests/widgets.spec.ts` |
| **Plataforma** | Windows 11 · WebView2; fora do Tauri usa a mesma API do navegador, ou mostra "Indisponível neste ambiente" |

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/hooks/useBattery.ts` | `BatteryStatus`, `LOW_BATTERY`, `isPlugged`, `useBattery`, `readBattery` |
| `src/components/desktop/widgets/Battery.tsx` | widget, `formatDuration`, menu "Exibir" |
| `src/components/Taskbar.tsx` | `BatteryModule` (ícone e `%`, abre o widget), só com `kind === "ready"` |
| `src/App.tsx` | `readMachine()` chama `readBattery()` para o status do JARVIS |

### Fluxo

```mermaid
sequenceDiagram
  participant W as Battery
  participant H as useBattery
  participant API as navigator.getBattery
  W->>H: mount
  H->>API: getBattery()
  API-->>H: BatteryManager
  H-->>W: ready { level, charging, ... }
  API-->>H: levelchange / chargingchange
  H-->>W: novo status
  Note over H: sem getBattery ou rejeitado → unavailable
```

### Constituição

- [x] P1 Offline-first: leitura local.
- [ ] P2 Rust é dono do nativo: exceção. A carga vem da Battery Status API da WebView, não de um comando Tauri.
  > ⚠ inferido — confirmar: a API da WebView2 basta no Windows, por isso não há módulo Rust.
- [ ] P3/P4: não se aplicam.
- [x] P5 Persistência tolerante: as opções passam por `parseToggles`, e o hook trata a falha da API como `unavailable`.
- [x] P6 Funciona fora do Tauri: caminho 1 (a própria API do navegador) ou 3 ("Indisponível neste ambiente").
- [x] P7 PT-BR: "na tomada", "carregando", "na bateria", "baixa", "restantes", "para 100%".
- [x] P8 Linguagem visual: `BlockBar` com `tone="alert"`, `KeyValue` e tokens `hud-*`.
- [x] P9 Desktop leve: só eventos, sem timer.
- [x] P11 Coberto por teste: nível ou indisponível, e o menu de opções.

### Decisões relacionadas

- [ADR-0011 — fakes de dev e E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0014 — linguagem visual TUI](../../arch/adr/0014-linguagem-visual-tui.md)

## Tarefas

Legenda: `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código e do commit de origem.

### Fase 1 — Base

- [x] T001 Interface `BatteryManager` e união `BatteryStatus` — `src/hooks/useBattery.ts`
- [x] T002 [P] `battery` em `WINDOW_SPECS` (300 × 150, mín. 220 × 120) e palavras de busca — `src/lib/desktop.ts`, `src/lib/commands.ts`

### Fase 2 — US1 Ver a carga e o estado (P1)

- [x] T003 [US1] `useBattery`: `getBattery()` e os quatro eventos da API — `src/hooks/useBattery.ts`
- [x] T004 [US1] Porcentagem, `BlockBar` de 18 células, estado e tempo (`formatDuration`) — `src/components/desktop/widgets/Battery.tsx`
- [x] T005 [US1] Bateria baixa (≤ `LOW_BATTERY`, sem carregador) em cor de alerta e "· baixa" — `src/components/desktop/widgets/Battery.tsx`

### Fase 3 — US2 Ambientes sem bateria (P1)

- [x] T006 [US2] Estados `loading` e `unavailable` com mensagem `$` — `src/components/desktop/widgets/Battery.tsx`
- [x] T007 [US2] `isPlugged`: o desktop "cheio na tomada" vira "na tomada" — `src/hooks/useBattery.ts`
- [x] T008 [US2] `readBattery()` para o status do JARVIS (`null` sem bateria) — `src/hooks/useBattery.ts` (`048a254`)

### Fase 4 — US3 Escolher o que aparece (P2)

- [x] T009 [US3] Opções `{ percent, bar, state, time }`, menu "Exibir" e "Tudo oculto" — `src/components/desktop/widgets/Battery.tsx` (`c4ccc57`)

### Fase 5 — Testes

- [x] T010 Playwright `tests/desktop.spec.ts` — "the battery widget shows a level or says it is unavailable"
- [x] T011 Playwright `tests/widgets.spec.ts` — "Bateria: right click turns parts of the widget off, and it stays so"

## Pendências

- [ ] Nenhum teste força um nível conhecido (não há fake `__JARVIS_*__` da bateria), então os estados "carregando", "baixa" e "na tomada" não têm cobertura determinística — `tests/desktop.spec.ts`
