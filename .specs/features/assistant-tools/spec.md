# Ferramentas do JARVIS (servidor MCP)

As mãos do JARVIS no jvOS: um servidor MCP local, protegido por token, com 18 ferramentas que viram ações reais na tela.

| | |
|---|---|
| **ID** | `feature/assistant-tools` |
| **Status** | Implementado |
| **Origem** | `750ebd0` (2026-10-27) · evoluída em `048a254` e não commitado (11 das 18 ferramentas) |

## Visão geral

As ferramentas são as mãos do JARVIS no jvOS. O app sobe um servidor MCP próprio, local e protegido por token, e entrega ao Claude Code (o [assistente](../assistant/spec.md)) 18 ferramentas: executar qualquer ação da busca, abrir um site, ler o estado da máquina, agendar lembretes, cuidar das ações, do clima, da agenda e das tarefas, e revisar e rodar os agentes que ele escreve. Quase todas são executadas pela UI, que é dona do desktop: o servidor repassa a chamada por evento e espera a resposta. Assim, "abre o relógio" ou "marca dentista sexta às 10" ditos ao JARVIS viram ações reais na tela, e ele confirma no personagem.

## Dados

- `$config`: `%LOCALAPPDATA%\dev.jarvis.os\assistant\mcp.json`, com a URL e o token, regravado a cada início do app.
- `$token`: o token bearer de 128 bits, gerado a cada início. Só em memória (e em $config).
- `$pendentes`: a **Bridge**, com as chamadas pendentes por id. Cada chamada vai à UI como **ActionRequest** `{ id, tool, args }` e volta como **ToolReply** `{ ok, text }`. Só em memória. Ver [glossário](../../domain/glossary.md).

## As 18 ferramentas

| Tool | O que faz | Spec dona |
|---|---|---|
| `jvos_run` | Executa uma ação da busca por `query` ou `id` | esta spec (catálogo da [busca](../search/spec.md), `src/lib/commands.ts`) |
| `jvos_commands` | Lista as ações disponíveis agora | esta spec / [busca](../search/spec.md) |
| `open_url` | Abre um site http/https no navegador (no Rust) | esta spec |
| `system_status` | CPU, GPU, RAM, discos, bateria, Wi-Fi, hora local e música tocando | esta spec (`statusReport` de [voice-shortcuts](../voice-shortcuts/spec.md)) |
| `reminder_set` | Lembrete daqui a N minutos (1–10080) | [reminders](../reminders/spec.md) |
| `stocks_quote` | Cotações (sem códigos: as do widget) | [widgets/stocks](../../widgets/stocks/spec.md) |
| `stocks_watch` | Põe ou tira um código do widget Ações | [widgets/stocks](../../widgets/stocks/spec.md) |
| `stocks_alert` | Cria ou apaga alertas `above`/`below` | [widgets/stocks](../../widgets/stocks/spec.md) |
| `weather` | Agora e próximos cinco dias (sem cidade: a do widget) | [widgets/weather](../../widgets/weather/spec.md) |
| `agenda_add` | Marca compromisso (data, hora, aviso padrão de 10 min) | [widgets/agenda](../../widgets/agenda/spec.md) |
| `agenda_list` | Lista entre duas datas (padrão: hoje a +7 dias) | [widgets/agenda](../../widgets/agenda/spec.md) |
| `agenda_remove` | Apaga pelo número | [widgets/agenda](../../widgets/agenda/spec.md) |
| `tasks_add` | Põe tarefa na lista e devolve o número | [widgets/tasks](../../widgets/tasks/spec.md) |
| `tasks_list` | Lista as tarefas do dia | [widgets/tasks](../../widgets/tasks/spec.md) |
| `tasks_done` | Marca feita (ou pendente com `done: false`) | [widgets/tasks](../../widgets/tasks/spec.md) |
| `tasks_remove` | Apaga pelo número | [widgets/tasks](../../widgets/tasks/spec.md) |
| `agent_review` | Mostra o agente para revisão no jv_agent | [apps/jv_agent](../../apps/jv_agent/spec.md) |
| `agent_run` | Roda o agente revisado numa aba do jv_sh | [apps/jv_agent](../../apps/jv_agent/spec.md) |

## Componentes

### Servidor HTTP (`mcp::start`, `respond`)

Um servidor MCP "Streamable HTTP" mínimo (`tiny_http`), dentro do processo do app.

- **Comportamento:**
  - **RF-001**: O servidor DEVE escutar só em `127.0.0.1`, numa porta livre, no caminho `/mcp`, respondendo JSON simples (sem SSE).
    - Ele roda na thread `jarvis-mcp`, em `127.0.0.1:0`.
  - **RF-002**: Um token de 128 bits DEVE ser exigido como `Authorization: Bearer`; requisições com `Origin` DEVEM ser recusadas.
    - Sem o `Bearer` certo, ou com `Origin`, responda 403.
  - **RF-003**: O corpo DEVE ser lido até 1 MiB; cada requisição DEVE rodar na própria thread.
  - Se o caminho não for `/mcp`, responda 404. Se o método não for POST, responda 405: o servidor não oferece stream iniciado por ele (GET).
  - Se o corpo não puder ser lido, responda 400. Notificações e respostas JSON-RPC recebem 202 sem corpo. As requisições recebem 200 `application/json`.

### JSON-RPC (`handle`)

Responde aos métodos MCP que o Claude Code usa.

- **Comportamento:**
  - **RF-004**: O servidor DEVE responder `initialize` (com a versão do cliente, ou `2025-11-25`), `ping`, `tools/list` e `tools/call`.
    - `tools/list` devolve as 18 de `TOOLS`, cada uma com descrição em PT-BR e `inputSchema` (`tools()`).
  - **RF-005**: `tools/call` DEVE devolver `{ content: [{ type: "text", text }], isError }`.
  - Se a ferramenta não estiver na lista, devolva o erro -32602 ("Ferramenta desconhecida: …").
  - Se o método for `server/discover` ou outro desconhecido, devolva -32601; o Claude Code recai para `initialize`.
  - Se o JSON for inválido, devolva -32700.

### Configuração do cliente (`start_mcp`)

Liga o servidor ao Claude Code do JARVIS.

- **Comportamento:**
  - **RF-007**: O arquivo `--mcp-config` DEVE ser gravado em `%LOCALAPPDATA%\dev.jarvis.os\assistant\mcp.json`, com URL e cabeçalho de autorização.
    - `Server::config` monta o bloco `mcpServers.jarvis` com `type: "http"`.
  - O `claude.exe` recebe `--strict-mcp-config --mcp-config <mcp.json>` e `mcp__jarvis` em `--allowedTools`.
  - Se o servidor não subir, o Claude Code roda sem `--mcp-config` (sem ferramentas do jvOS).

### Ponte para a UI (`run_tool`, `Bridge`)

Decide onde cada ferramenta roda e espera a resposta da UI.

- **Comportamento:**
  - **RF-006**: `open_url` DEVE ser executada no Rust; as outras 17 DEVEM ir à UI por `assistant:action` e voltar por `assistant_action_result`.
  - `open_url` só abre endereços que começam com `http://` ou `https://` e não têm espaços; senão, responda "Só abro endereços http ou https". O site abre por `launcher::launch`, e a resposta é "Aberto <url>".
  - `Bridge::call` dá um id à chamada, emite `assistant:action` e bloqueia até 20 s pela resposta.
    - Se a UI não responder em 20 s, responda "O jvOS não respondeu a tempo".
    - Se o evento não puder ser emitido, responda "A interface do jvOS não está disponível".
    - Uma resposta da UI depois do prazo é ignorada.

### Execução na UI (`useAssistantActions`)

Recebe `assistant:action`, roda a ferramenta e devolve a resposta por `assistant_action_result`.

- **Comportamento:**
  - `run(tool, args)` concentra as 17 ferramentas e as delega aos hooks dos widgets, ao catálogo da busca e ao jv_agent. Um erro lançado vira `{ ok: false, text }`.
  - `jvos_run` procura primeiro o `id` exato e, senão, usa `findCommand`: a busca inteira, depois sem as palavras iniciais (com alguma de 3+ letras).
    - Ao achar, rode a ação, avise na dock "JARVIS: <título>" e responda "Feito: <título>".
    - Sem match, responda `ok: false` com até 5 candidatos por palavra ("Nada certo para … Opções próximas:"), ou "Nenhuma ação do jvOS para "…". Veja jvos_commands.".
  - `jvos_commands` lista cada ação como `id — título (grupo)`.
  - `system_status` responde `statusReport(await machine(), new Date())`.
  - `reminder_set` valida 0 < minutos ≤ `MAX_REMINDER_MINUTES` e chama `remind`.
  - `stocks_*` e `weather` delegam a `useWatchlist` e `useWeather`; `stocks_watch` e `stocks_alert` abrem o widget.
  - `agenda_*` e `tasks_*` delegam a `useAgenda` e `useTasks`; `agenda_add` e `tasks_add` abrem o widget e avisam na dock.
  - `agent_review` e `agent_run` exigem `name` ("Falta o nome do agente"), abrem o jv_agent e esperam a resposta dele por `agentRequests`.
  - Fora do Tauri não há servidor. Os testes chamam `window.__JARVIS__.action(tool, args)`, que roda a mesma função da UI.

### Status no núcleo (`describeTool`)

O que o núcleo mostra enquanto uma ferramenta roda (a exibição é do [assistente](../assistant/spec.md)).

- **Comportamento:**
  - **RF-008**: O núcleo DEVE mostrar um status em PT-BR enquanto cada ferramenta roda (ex.: "Marcando na agenda", "Consultando a bolsa"; as outras do jvOS mostram "Executando no jvOS").

## Restrições

- **RNF-001**: Nenhuma ferramenta executa linha de comando arbitrária; `agent_run` só roda `claude --agent`.
- **RNF-002**: A UI responde em milissegundos; o prazo de 20 s cobre também a revisão de agente.
- Só `127.0.0.1`; corpo ≤ 1 MiB; espera pela UI ≤ 20 s; lista fixa de 18 ferramentas.

## Histórias de usuário

### US1 — O JARVIS age no desktop (P1)

Como usuário, peço ao JARVIS "abre o relógio" ou "configurações de voz" e ele faz.

**Por que P1:** sem isso o JARVIS só conversa.
**Teste independente:** `tests/assistant.spec.ts` — "JARVIS runs jvOS actions: windows, menus, and says what it could not find".

**Aceite**

1. **Dado** `jvos_run { query: "abre o relógio" }`, **quando** executado, **então** o Relógio abre, a dock diz "JARVIS: Relógio" e a ferramenta devolve "Feito: Relógio".
2. **Dado** `jvos_run { id: "settings:voice" }`, **quando** executado, **então** as Configurações abrem.
3. **Dado** uma busca sem resultado ("teletransporte quântico"), **quando** executada, **então** volta `ok: false` com até 5 opções próximas, ou "Nenhuma ação do jvOS para … Veja jvos_commands.".
4. **Dado** `jvos_commands`, **quando** executado, **então** lista cada ação como `id — título (grupo)` (ex.: "window:clock — Relógio (Widgets)").

### US2 — Dados do dia a dia (P1)

Como usuário, peço ao JARVIS para marcar compromissos, anotar tarefas, acompanhar ações e dizer o clima, e os widgets mudam.

**Por que P1:** é o que o torna um assistente pessoal.
**Teste independente:** `tests/feeds.spec.ts` (ações, clima, agenda), `tests/tasks.spec.ts` — "JARVIS's tools for the list: add (the widget opens), list, done, remove", `tests/shortcuts.spec.ts` — "reminders: a timer said to Voice, and one JARVIS sets that goes off".

**Aceite**

1. **Dado** `tasks_add { text }`, **quando** executado, **então** a tarefa entra na lista, o widget Tarefas abre e volta "Na lista como tarefa <n>: <texto>".
2. **Dado** `reminder_set { minutes: 0, … }`, **quando** executado, **então** volta `ok: false` ("Minutos fora do intervalo (1 a 10080)").
3. **Dado** `weather` sem cidade e o widget Clima sem cidade, **quando** executado, **então** volta `ok: false` pedindo ao JARVIS que pergunte a cidade.

### US3 — Agentes revisados antes de rodar (P2)

**Teste independente:** `tests/agent.spec.ts` — "JARVIS writes the agent in jv_agent, shows it for review and runs it once in jv_sh".

**Aceite**

1. **Dado** `agent_review { name, folder?, task? }`, **quando** executado, **então** o jv_agent abre a revisão e a ferramenta devolve o resumo e os problemas.
2. **Dado** `agent_run { name }`, **quando** executado, **então** o agente roda uma vez numa aba do jv_sh (detalhes em [jv_agent](../../apps/jv_agent/spec.md)).

### US4 — Ninguém mais usa o servidor (P1)

Como usuário, só o Claude Code que o JARVIS iniciou acessa as ferramentas.

**Por que P1:** o servidor age no desktop; outro programa ou uma página web não pode usá-lo.
**Teste independente:** Rust `tokens_differ` e a lógica de `respond` em `mcp.rs` (sem teste HTTP).

**Aceite**

1. **Dado** uma requisição sem o `Bearer` certo, ou com cabeçalho `Origin`, **quando** chega, **então** a resposta é 403.
2. **Dado** um caminho diferente de `/mcp`, **quando** chega, **então** 404. Qualquer método que não seja POST recebe 405.

## Critérios de sucesso

- **SC-001**: Toda ferramenta pedida pelo JARVIS recebe uma resposta (sucesso, erro ou prazo esgotado) em até 20 s.
- **SC-002**: Nenhuma página web nem programa sem o token consegue chamar uma ferramenta.

## Fora de escopo e limitações

- O comportamento de cada widget ao receber a chamada: ver a spec dona na tabela.
- Ferramentas de shell, de arquivo fora de `Documentos\JARVIS` ou de rede genérica.
- O servidor não oferece stream iniciado pelo servidor (GET → 405).

## Código

Um servidor MCP "Streamable HTTP" mínimo (`tiny_http`) roda dentro do processo do app e responde JSON-RPC com JSON simples. Cada `tools/call` chama `run_tool` em `lib.rs`: `open_url` é atendida ali mesmo, e o resto passa pela `Bridge`, que emite `assistant:action` e bloqueia (≤ 20 s) até a UI responder por `assistant_action_result`. Na UI, `useAssistantActions` concentra as 17 ferramentas restantes e as delega aos hooks dos widgets, ao catálogo da busca e ao jv_agent.

| | |
|---|---|
| **Camadas** | `useAssistantActions` · `useWatchlist`/`useWeather`/`useAgenda`/`useTasks`/`useReminders` · `src/lib/commands.ts` + `src/lib/search.ts` · `src/lib/agents.ts` · `lib.rs` (`run_tool`, `start_mcp`) · `src-tauri/src/mcp.rs` |
| **Dependências** | `tiny_http` 0.12, `serde_json`; cliente: `claude.exe` com `--mcp-config` e `--allowedTools mcp__jarvis` |
| **Testes** | `tests/assistant.spec.ts`, `tests/agent.spec.ts`, `tests/feeds.spec.ts`, `tests/tasks.spec.ts`, `tests/shortcuts.spec.ts`; Rust `mod tests` em `mcp.rs` |
| **Plataforma** | Windows 11 · WebView2. Fora do Tauri: sem servidor; o probe `window.__JARVIS__.action` chama `run` direto |

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/mcp.rs` | `start`, `token`, `respond` (403/404/405/400/202), `handle` (JSON-RPC), `TOOLS`, `tools()` (descrições e `inputSchema`), `Bridge` |
| `src-tauri/src/lib.rs` | `run_tool` (`open_url` no Rust), `start_mcp` (grava `mcp.json`), `assistant_action_result`; `actions` no `AppState` |
| `src-tauri/src/assistant.rs` | `--strict-mcp-config --mcp-config <mcp.json>` e `mcp__jarvis` em `--allowedTools` |
| `src/hooks/useAssistantActions.ts` | `run(tool, args)`, `findCommand`, listener de `assistant:action` |
| `src/lib/assistant.ts` | `describeTool`: status em PT-BR por ferramenta |
| `src/App.tsx` | `useAssistantActions({ commands, openAgents, notify, machine, remind, stocks, weather, agenda, tasks, show })` e probe `action` |

### Contratos

#### Comandos Tauri

| Comando | Entrada | Saída | Notas |
|---|---|---|---|
| `assistant_action_result` | `{ id, ok, text }` | — | Resolve a chamada `id`; ignorado se ela já expirou |

#### Eventos e Channels

| Nome | Payload | Emissor → consumidor |
|---|---|---|
| `assistant:action` | `{ id, tool, args }` | `Bridge::call` → `useAssistantActions` |

#### Ferramentas MCP (JARVIS)

As 18 estão na tabela [As 18 ferramentas](#as-18-ferramentas). Detalhes da execução na UI:

| Tool | O que faz |
|---|---|
| `jvos_run` | `id` exato, senão `findCommand`: a busca inteira, depois sem as palavras iniciais (com alguma de 3+ letras); sem match, até 5 candidatos por palavra |
| `system_status` | `statusReport(await machine(), new Date())` |
| `reminder_set` | Valida 0 < minutos ≤ `MAX_REMINDER_MINUTES` e chama `remind` |
| `stocks_*`, `weather` | Delegam a `useWatchlist` / `useWeather`; `stocks_watch` e `stocks_alert` abrem o widget |
| `agenda_*`, `tasks_*` | Delegam a `useAgenda` / `useTasks`; `agenda_add` e `tasks_add` abrem o widget e avisam na dock |
| `agent_review`, `agent_run` | Abrem o jv_agent e esperam a resposta dele por `agentRequests` |

#### Protocolo HTTP

| Situação | Resposta |
|---|---|
| Sem `Bearer` correto ou com `Origin` | 403 |
| Caminho ≠ `/mcp` | 404 |
| Método ≠ POST | 405 |
| Falha ao ler o corpo | 400 |
| Notificação ou resposta JSON-RPC | 202 |
| Requisição | 200 `application/json` |

### Fluxo

```mermaid
sequenceDiagram
  participant C as claude.exe
  participant S as mcp.rs (tiny_http)
  participant L as lib.rs run_tool
  participant B as Bridge
  participant UI as useAssistantActions
  C->>S: POST /mcp tools/call (Bearer)
  S->>L: call(tool, args)
  alt open_url
    L-->>S: launcher::launch(url)
  else outras
    L->>B: call(tool, args)
    B-->>UI: assistant:action { id, tool, args }
    UI->>UI: run(tool, args)
    UI->>B: assistant_action_result(id, ok, text)
    B-->>L: resultado (≤ 20 s)
  end
  S-->>C: { content: [text], isError }
```

### Constituição

- [x] P2 Rust é dono do nativo — o servidor HTTP e `open_url` (via `launcher`) ficam no Rust; a UI só executa ações de desktop.
- [x] P3 Comandos finos — `assistant_action_result` em `lib.rs` só resolve a `Bridge`; evento `assistant:action`.
- [x] P4 Contratos espelhados — `ActionRequest` com "Mirrors `ActionRequest` in `src-tauri/src/mcp.rs`".
- [x] P6 Fora do Tauri — `run` exposto no probe de DEV `__JARVIS__.action`.
- [x] P7 PT-BR — descrições das ferramentas e respostas em PT-BR.
- [x] P10 Confinamento — só `127.0.0.1`, token bearer de 128 bits, `Origin` recusado, lista fechada de ferramentas, URLs só http/https.
- [x] P11 Testes — JSON-RPC e `Bridge` com testes Rust; cada ferramenta da UI com Playwright (exceto `system_status` e `open_url`).

### Decisões relacionadas

- [ADR-0008 — servidor MCP HTTP in-process; a UI executa as tools](../../arch/adr/0008-mcp-http-in-process.md)
- [ADR-0007 — JARVIS restrito a Documentos\JARVIS](../../arch/adr/0007-jarvis-confinado-a-documentos.md)
- [ADR-0009 — tipos espelhados](../../arch/adr/0009-tipos-espelhados-ts-rust.md)
- [Segurança](../../arch/security.md)

## Tarefas

Legenda: `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código e do commit de origem.

### Fase 1 — Base

- [x] T001 Servidor `tiny_http` em `127.0.0.1:0`, thread `jarvis-mcp`, uma thread por requisição — `src-tauri/src/mcp.rs`
- [x] T002 Token de 128 bits, `Server::config` (bloco `mcpServers.jarvis` com `type: "http"`) — `src-tauri/src/mcp.rs`
- [x] T003 `handle`: `initialize`, `ping`, `tools/list`, `tools/call`, -32601/-32602/-32700 — `src-tauri/src/mcp.rs`
- [x] T004 `Bridge` (ids, espera de 20 s, `resolve`) — `src-tauri/src/mcp.rs`
- [x] T005 `start_mcp` grava `assistant\mcp.json`; `run_tool`; `assistant_action_result` — `src-tauri/src/lib.rs`
- [x] T006 `--strict-mcp-config`, `--mcp-config` e `mcp__jarvis` liberado — `src-tauri/src/assistant.rs`

### Fase 2 — US1 Ações do jvOS (P1)

- [x] T007 [US1] `jvos_run` (`findCommand`) e `jvos_commands` — `src/hooks/useAssistantActions.ts`
- [x] T008 [US1] `open_url` só http/https, sem espaços — `src-tauri/src/lib.rs`
- [x] T009 [US1] Listener de `assistant:action` → `assistant_action_result` — `src/hooks/useAssistantActions.ts`
- [x] T010 [US1] Status em PT-BR por ferramenta (`describeTool`) — `src/lib/assistant.ts`

### Fase 3 — US2 Dados do dia a dia (P1)

- [x] T011 [US2] `system_status` (`statusReport`) e `reminder_set` — `src/hooks/useAssistantActions.ts`
- [x] T012 [US2] [P] `stocks_quote`, `stocks_watch`, `stocks_alert`, `weather` — `src/hooks/useAssistantActions.ts`, `src-tauri/src/mcp.rs`
- [x] T013 [US2] [P] `agenda_add`, `agenda_list`, `agenda_remove`, `tasks_add`, `tasks_list`, `tasks_done`, `tasks_remove` — `src/hooks/useAssistantActions.ts`, `src-tauri/src/mcp.rs`
- [x] T014 [US2] Ligação com os hooks dos widgets e `show(kind)` — `src/App.tsx`

### Fase 4 — US3 Agentes (P2)

- [x] T015 [US3] `agent_review` e `agent_run` via `agentRequests`, abrindo o jv_agent — `src/hooks/useAssistantActions.ts`, `src/lib/agents.ts`

### Fase 5 — US4 Acesso fechado (P1)

- [x] T016 [US4] `respond`: 403 sem token ou com `Origin`, 404, 405, 400, 202; corpo ≤ 1 MiB — `src-tauri/src/mcp.rs`

### Fase 6 — Testes

- [x] T017 Playwright `tests/assistant.spec.ts` — "JARVIS runs jvOS actions: windows, menus, and says what it could not find"
- [x] T018 Playwright `tests/agent.spec.ts` — "JARVIS writes the agent in jv_agent, shows it for review and runs it once in jv_sh"
- [x] T019 Playwright `tests/feeds.spec.ts` — "stocks: typed into the widget or watched by JARVIS, with a price alert that goes off"
- [x] T020 Playwright `tests/feeds.spec.ts` — "the weather: the widget's city, spoken now and tomorrow, another city on request"
- [x] T021 Playwright `tests/feeds.spec.ts` — "the agenda: marked by JARVIS or by hand, numbered, edited, read back, said before it starts"
- [x] T022 Playwright `tests/tasks.spec.ts` — "JARVIS's tools for the list: add (the widget opens), list, done, remove"
- [x] T023 Playwright `tests/shortcuts.spec.ts` — "reminders: a timer said to Voice, and one JARVIS sets that goes off" (`reminder_set`)
- [x] T024 Rust `src-tauri/src/mcp.rs` — `initializes_with_the_clients_version`, `notifications_and_responses_get_no_answer`, `unknown_methods_and_bad_json_are_errors`, `lists_every_tool_with_a_schema`
- [x] T025 Rust `src-tauri/src/mcp.rs` — `calls_carry_the_arguments_and_report_failures`, `the_bridge_waits_for_the_ui`, `tokens_differ`

## Pendências

- [ ] `open_url` não tem teste: a validação (só http/https, sem espaços) vive em `run_tool` em `src-tauri/src/lib.rs`, que não tem `mod tests`, e o `run` da UI não conhece essa ferramenta (pelo probe `__JARVIS__.action` ela volta "Ferramenta desconhecida").
- [ ] `system_status` não é chamada por nenhum teste via `action`; só `statusReport` é testado em `tests/shortcuts.spec.ts`.
- [ ] As regras HTTP de `respond` (403 com `Origin` ou token errado, 404, 405) não têm teste: os testes Rust de `mcp.rs` chamam `handle` direto, sem HTTP.
