# Feature Specification: Agentes como contatos

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/agent-contacts` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Plano escrito em 2026-11-19, antes do código, e fechado no mesmo dia com o que foi construído; sem decisões em aberto |
| Source Commit | não commitado |
| Uncommitted Changes | Tudo: feature nova |
| Voice Shortcut | — |
| Assistant Tool | — |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web) usa o fake `window.__JARVIS_ASSISTANT__` (com `agents`) em DEV |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-19 |
| Verification Scope | Conferido com o código em 2026-11-19: `src-tauri/src/assistant.rs`, `src-tauri/src/agents.rs`, `src-tauri/src/lib.rs`, `src/lib/assistant.ts`, `src/lib/agentContacts.ts`, `src/hooks/useAssistant.ts`, `src/components/chat/AgentsList.tsx`, `AgentAvatar.tsx`, `ChatSidebar.tsx`, `ChatView.tsx`, `ChatThread.tsx`, `ChatComposer.tsx`, `src/App.tsx`. Testes rodados: `npx tsc --noEmit` sem erros; `cargo test --lib -- assistant:: agents:: settings::` 33 de 33; `tests/agent-contacts.spec.ts` 4 de 4, com `chat-mode`, `assistant` e `agent` (23 de 23). Nenhum `claude.exe` real foi usado nesses testes: KL-001 |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os IDs começam em US1, RF-001, RNF-001, SC-001, AC-001 e T001. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

Quarta fase do [modo chat](../chat-mode/spec.md). Duas mudanças, que dependem da mesma base ([ADR-0028](../../arch/adr/0028-processo-claude-code-conversa-ate-cinco.md)):

1. **Segundo plano.** Cada conversa passa a ter o seu próprio processo do Claude Code. Dá para pedir algo demorado numa conversa e seguir em outra: até 5 respondem ao mesmo tempo. Uma resposta que termina fora da tela marca a conversa como não lida e avisa.
2. **Agentes como contatos.** Os agentes que o JARVIS instalou (jv_agent) aparecem na seção "Agentes" do chat. Conversar com um deles abre uma conversa em que quem responde é o agente, com as instruções dele e as mesmas travas do JARVIS (só `Documentos\JARVIS`, sem shell). O que precisa de mais poder continua no terminal.

| Input | Expected Behavior | Execution Path |
|---|---|---|
| Perguntar numa conversa enquanto outra responde | As duas respondem, cada uma no seu balão | `assistant_ask` com `conversationId` |
| Sexta pergunta com 5 conversas respondendo | Recusa: "Já estou respondendo em 5 conversas. Espere uma terminar." | Local e Rust (`MAX_ANSWERING`) |
| Uma resposta termina em outra conversa | A conversa ganha a marca de não lida e o aviso "Resposta pronta em …" | Local |
| Seção "Agentes" → clicar num agente | Uma conversa com esse agente abre na seção Conversas | Local + `assistant_warm` com `agent` |
| Perguntar numa conversa de agente | O agente responde, confinado | `assistant_ask` com `agent` |
| "Rodar no terminal", numa conversa de agente | O desktop abre o jv_sh com o agente, como hoje | `terminal_open_agent` |

## Goals and Success Criteria

### Goals

- Não esperar: o agente trabalha numa conversa enquanto o usuário usa outra.
- Falar com os agentes criados no jv_agent como se fala com o JARVIS, sem afrouxar o confinamento.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Duas conversas respondem ao mesmo tempo, cada resposta na sua | `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread" |
| SC-002 | Uma conversa de agente manda as perguntas com o nome do agente e a própria sessão | `tests/agent-contacts.spec.ts` — "an installed agent is a contact: its conversation is answered by the agent" |
| SC-003 | Nenhum `claude.exe` do chat sobe sem as flags de confinamento | `src-tauri/src/assistant.rs` — `every_conversation_starts_confined` |

## Scope and Non-Goals

### In Scope

- Um processo por conversa; até 5 respondendo; no máximo um processo ocioso.
- "Respondendo" por conversa, não lida e aviso ao terminar fora da tela.
- A seção "Agentes" com os contatos; conversas de agente; "Rodar no terminal".
- A limpeza de memória e o fechamento do app sobre todos os processos.

### Out of Scope

- Fila de perguntas além do limite.
- Agentes com shell ou acesso fora de `Documentos\JARVIS` no chat ([ADR-0007](../../arch/adr/0007-jarvis-confinado-a-documentos.md): isso é no jv_sh).
- Usar o `model` e o `tools` do rascunho do agente: o processo usa o modelo das Configurações e as ferramentas do JARVIS.
- Criar ou editar agentes pelo chat: continua no jv_agent (pedindo ao JARVIS).
- Agentes do Claude Code que o JARVIS não instalou.
- Travar arquivos compartilhados entre processos simultâneos.

## User Stories

### US1 — Tarefas em segundo plano

**Priority:** P1.

**User Story:** Como usuário, quero pedir algo demorado ao JARVIS e continuar em outra conversa enquanto ele trabalha, para não ficar esperando.

**Why This Priority:** é a base que os contatos também usam.

**Independent Test:** `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread".

**Acceptance Criteria:** AC-001, AC-002, AC-003 e AC-004.

### US2 — Conversar com um agente

**Priority:** P1.

**User Story:** Como usuário, quero conversar com os agentes que criei com o JARVIS como contatos do chat, para usá-los sem abrir o terminal.

**Why This Priority:** é o pedido de produto da fase.

**Independent Test:** `tests/agent-contacts.spec.ts` — "an installed agent is a contact: its conversation is answered by the agent".

**Acceptance Criteria:** AC-005, AC-006, AC-007 e AC-008.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | Cada conversa DEVE ter o seu processo do Claude Code e a sua resposta em andamento: perguntar numa conversa não depende das outras. Numa mesma conversa continua valendo uma pergunta por vez ("Ainda estou respondendo"). | US1 |
| RF-002 | No máximo 5 conversas DEVEM responder ao mesmo tempo (`MAX_ANSWERING`); a sexta pergunta é recusada com "Já estou respondendo em 5 conversas. Espere uma terminar.", na UI (antes de enviar) e no Rust. | US1 |
| RF-003 | Aquecer ou perguntar numa conversa DEVE encerrar os processos ociosos das outras: sobra no máximo um processo sem resposta em andamento. | US1 |
| RF-004 | A lista de conversas DEVE mostrar "Respondendo" em cada conversa que está sendo respondida. Uma resposta que termina numa conversa que não está na tela (ou com o chat fechado) DEVE marcá-la como não lida (um ponto, e o título em destaque) até ela ser aberta, e mostrar o aviso "Resposta pronta em "<título>"". | US1 |
| RF-005 | O campo de mensagem de uma conversa DEVE ficar livre enquanto outras respondem; só fica em "Parar" enquanto ela mesma é respondida. A regra "pode ler, não pode enviar" da Fase 1 deixa de existir. | US1 |
| RF-006 | Interromper, apagar e "Nova conversa" DEVEM agir só sobre a conversa em questão: as outras respostas continuam. | US1 |
| RF-007 | "Limpa a memória" DEVE encerrar todos os processos ociosos e somar a memória devolvida; responde "ocupado" só se nada pôde ser encerrado e algum processo está respondendo. Fechar o app encerra todos. | US1 |
| RF-008 | A barra lateral DEVE ter a seção "Agentes", com os contatos: os agentes que o JARVIS instalou (`Agentes\.instalados.json`) cujo rascunho `Agentes\<nome>.md` existe e é válido. Cada um mostra o nome e a descrição. Sem nenhum: "Nenhum agente ainda. Peça ao JARVIS para criar um.". | US2 |
| RF-009 | Clicar num contato DEVE abrir uma conversa com esse agente (a conversa vazia dele, se já houver uma) e ir para a seção Conversas. Uma conversa de agente mostra o nome do agente no cabeçalho ("agente <nome>"), um selo na lista e um avatar diferente do núcleo. | US2 |
| RF-010 | Numa conversa de agente, quem responde DEVE ser um processo que usa as instruções do agente (o corpo do rascunho) no lugar da persona do JARVIS, com as mesmas travas do JARVIS: mesma pasta, `--restricted`, as mesmas ferramentas, sem shell. | US2 |
| RF-011 | O cabeçalho de uma conversa de agente DEVE ter "Rodar no terminal", que vai para o desktop e abre o jv_sh com `claude --agent <nome>` na pasta do agente, com a última pergunta da conversa como tarefa. | US2 |
| RF-012 | Um agente que não é mais contato (rascunho apagado ou inválido) DEVE fazer a pergunta falhar com o motivo no balão; a conversa continua na lista. | US2 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | Toda conversa, de agente ou não, sobe o `claude.exe` com `--restricted`, `--tools` (a lista do JARVIS), `--permission-mode dontAsk`, `--strict-mcp-config` e a pasta `Documentos\JARVIS`. | `assistant.rs` |
| RNF-002 | O nome do agente é validado (`agents::valid_name`) antes de virar caminho de arquivo. | `agents.rs` |
| RNF-003 | Memória: até 5 processos respondendo e 1 ocioso, cerca de 200 MB cada. | [ADR-0028](../../arch/adr/0028-processo-claude-code-conversa-ate-cinco.md) |
| RNF-004 | Os contatos são relidos ao abrir a seção Agentes. | UI |

### Operational Constraints

- A conversa sem id (chamadas antigas) é a `"main"`.
- O modelo de todo processo é o das Configurações (`assistantModel`).
- Textos e rótulos em PT-BR.

## Acceptance Criteria

### AC-001 — Answer Two Conversations at Once

**Related Story:** US1.

- **Given** uma resposta em andamento na conversa A
- **When** o usuário abre a conversa B e pergunta
- **Then** B também responde; as duas aparecem como "Respondendo" e cada resposta termina na sua conversa.

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread".

### AC-002 — Mark What Ended Out of Sight

**Related Story:** US1.

- **Given** a conversa A respondendo e a conversa B na tela
- **When** a resposta de A termina
- **Then** A fica marcada como não lida e o aviso diz "Resposta pronta em …"; ao abrir A, a marca some.

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread".

### AC-003 — Refuse the Sixth Answer

**Related Story:** US1.

- **Given** cinco conversas respondendo
- **When** o usuário pergunta numa sexta
- **Then** nada é enviado e o aviso diz "Já estou respondendo em 5 conversas. Espere uma terminar.".

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread".

### AC-004 — Stop Only One

**Related Story:** US1.

- **Given** duas conversas respondendo
- **When** o usuário clica em "Parar" numa delas
- **Then** só ela fica "Interrompida"; a outra termina normalmente.

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread".

### AC-005 — List the Contacts

**Related Story:** US2.

- **Given** dois agentes instalados pelo JARVIS
- **When** o usuário abre a seção "Agentes"
- **Then** os dois aparecem, com nome e descrição; sem agentes, aparece "Nenhum agente ainda. Peça ao JARVIS para criar um.".

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "an installed agent is a contact: its conversation is answered by the agent" e `tests/agent-contacts.spec.ts` — "without agents the section says how to get one".

### AC-006 — Talk to an Agent

**Related Story:** US2.

- **Given** o contato "revisor-pr"
- **When** o usuário clica nele e envia uma pergunta
- **Then** a conversa mostra "agente revisor-pr", a pergunta é enviada com `agent: "revisor-pr"`, e a seguinte continua na sessão dessa conversa.

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "an installed agent is a contact: its conversation is answered by the agent".

### AC-007 — Keep JARVIS and the Agent Apart

**Related Story:** US2.

- **Given** uma conversa com o JARVIS e outra com um agente
- **When** o usuário pergunta em cada uma
- **Then** a do JARVIS vai sem `agent` e a do agente com o nome dele; clicar de novo no contato com uma conversa vazia dele não cria outra.

**Coverage Status:** coberto — `tests/agent-contacts.spec.ts` — "an installed agent is a contact: its conversation is answered by the agent".

### AC-008 — An Agent Is Confined Like JARVIS

**Related Story:** US2.

- **Given** um rascunho de agente com `tools: Bash` no cabeçalho
- **When** a linha de comando do processo dele é montada
- **Then** ela tem `--restricted`, as ferramentas do JARVIS (sem `Bash`) e as instruções do agente no prompt; um nome inválido ou sem rascunho devolve erro.

**Coverage Status:** coberto — `src-tauri/src/assistant.rs` — `every_conversation_starts_confined` e `an_agent_answers_with_its_own_prompt`.

## Behavior and Flows

### Slots (`src-tauri/src/assistant.rs`)

- **Behavior:**
  - `Assistant` guarda `slots: HashMap<conversa, Slot>`; cada `Slot` tem o processo e o estado (`turn`, `session`, `stderr`, `generation`) que antes eram únicos.
  - `ask(conversa, texto, sessão, perfil, agente, canal)`: recusa se a conversa já responde (`BUSY`) ou se 5 outras respondem (`TOO_MANY`); reserva o `turn`, encerra os ociosos das outras, garante o processo (`ensure`) e escreve a pergunta. Se o processo não sobe, devolve o erro e libera o `turn`.
  - `warm(conversa, sessão, perfil, agente)`: encerra os ociosos das outras e garante o processo; não mexe numa conversa que responde.
  - `cancel(conversa)` e `reset(conversa)`: como antes, só nesse slot. `forget(sessão)`: acha o slot que está nessa sessão.
  - `sleep()`: encerra todo processo ocioso e soma a memória (RF-007). `close()`: encerra todos.
  - `ensure` recria o processo também quando o agente do slot mudou.
  - A linha de comando é montada por `command_line(perfil, prompt, retomar)`, igual para todos (RNF-001); só o prompt muda: `system_prompt(nome, agente)` devolve a persona com a memória (JARVIS) ou as regras de contato com as instruções do agente.

### Contatos (`src-tauri/src/agents.rs`)

- **Behavior:** `contacts(pasta)` devolve `{ name, description }` de cada agente do registro `.instalados.json` com rascunho válido (`problems` vazio), em ordem alfabética. `prompt(pasta, nome)` devolve o corpo do rascunho (depois do cabeçalho), ou o erro "O agente "<nome>" não está disponível".

### `useAssistant`

- **Behavior:**
  - `turns`: a resposta em andamento (ou a última, ainda na tela) de cada conversa. `turn` e `busy` continuam sendo os da conversa ativa, para o núcleo e o painel do desktop.
  - `answering`: as conversas que estão respondendo. `ask` recusa na UI a sexta (RF-002).
  - Toda chamada ao backend leva a conversa e o agente dela. O controle de "em que sessão o processo está" da Fase 1 sai: cada conversa tem o seu processo.
  - Ao terminar numa conversa que não é a ativa: `unread: true` e o aviso (RF-004); o `turn` dela sai na hora. `select` limpa `unread`.
  - `startWith(agente)`: a conversa vazia desse agente, ou uma nova com `agent` (RF-009). "Vazia" é sem perguntas, sem sessão e sem resposta em andamento.
  - A conversa ganha o título e sobe na lista quando a pergunta é enviada, não quando a resposta termina: com as respostas em segundo plano, uma primeira resposta longa deixava a conversa como "Nova conversa" até o fim.

### Seção Agentes (`ChatSidebar`, `AgentsList`)

- **Behavior:** a terceira seção da barra lateral. Lista os contatos (RF-008), relidos ao abrir. Clicar chama `startWith` e volta para Conversas.

### Conversa de agente (`ChatView`, `ChatThread`)

- **Behavior:** cabeçalho com "agente <nome>" e "Rodar no terminal" (RF-011); avatar `AgentAvatar` (um robô num círculo) no lugar do núcleo; selo com o nome na lista.

### Interaction Flow

1. O usuário pede uma pesquisa longa ao JARVIS e abre outra conversa; pergunta algo rápido e recebe a resposta.
2. O aviso diz que a pesquisa ficou pronta; a conversa dela está marcada.
3. Na seção Agentes, clica em "revisor-pr" e conversa com ele; para rodá-lo num projeto, usa "Rodar no terminal".

### User Feedback

| Situation | Feedback |
|---|---|
| Sexta resposta simultânea | "Já estou respondendo em 5 conversas. Espere uma terminar." |
| Resposta pronta fora da tela | Ponto de não lida e "Resposta pronta em "<título>"" |
| Agente indisponível | O erro no balão: "O agente "<nome>" não está disponível" |
| Sem agentes | "Nenhum agente ainda. Peça ao JARVIS para criar um." |

### Voice and Keyboard

- Sem atalho de voz. A voz continua perguntando na conversa ativa.

## Data Model and Persistence

### Conversation (campos novos)

```ts
interface Conversation {
  // … os campos de chat-mode
  /** The agent that answers here (absent: JARVIS). */
  agent?: string;
  /** An answer ended here while it was out of sight. */
  unread?: boolean;
}
```

### AgentContact

```ts
/** Mirrors `Contact` in src-tauri/src/agents.rs. */
interface AgentContact {
  name: string;
  description: string;
}
```

### Storage Rules

| Property | Value |
|---|---|
| State | `agent` e `unread` em cada conversa de `jarvis.conversations` |
| Reader | `parseConversations`: `agent` só se for um nome de agente válido; `unread` só se for `true` |
| Missing or Invalid Storage | Conversa com o JARVIS, lida |

A chave `jarvis.agentContacts` criada pelo esqueleto do CLI não é usada: a feature não tem preferências próprias.

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src-tauri/src/assistant.rs` | Slots, limite, ociosos, prompt de agente, linha de comando única |
| `src-tauri/src/agents.rs` | `contacts` e `prompt` |
| `src-tauri/src/lib.rs` | `conversation_id` e `agent` nos comandos; `agent_contacts` |
| `src/lib/assistant.ts` | Backend com conversa e agente; fake com várias respostas simultâneas e `agents`; `agent` e `unread` no parser |
| `src/lib/agentContacts.ts` | `AgentContact` e `listContacts` |
| `src/hooks/useAssistant.ts` | `turns`, `answering`, `startWith`, não lida |
| `src/components/chat/AgentsList.tsx`, `AgentAvatar.tsx` | A seção e o avatar (novos) |
| `src/components/chat/ChatSidebar.tsx`, `ChatView.tsx`, `ChatThread.tsx`, `ChatComposer.tsx` | Terceira seção, selo, não lida, cabeçalho de agente, campo livre |
| `src/App.tsx` | "Rodar no terminal" |
| `tests/agent-contacts.spec.ts`, `tests/chat-mode.spec.ts`, `tests/assistant.spec.ts` | Testes |

### Related Architecture Decisions

- [ADR-0028 — Um processo do Claude Code por conversa, até cinco respondendo, e agentes confinados no chat](../../arch/adr/0028-processo-claude-code-conversa-ate-cinco.md)
- [ADR-0006](../../arch/adr/0006-jarvis-via-claude-cli.md) e [ADR-0007](../../arch/adr/0007-jarvis-confinado-a-documentos.md), substituídos em parte pelo ADR-0028
- [ADR-0008 — Servidor MCP HTTP dentro do app](../../arch/adr/0008-mcp-http-in-process.md): um servidor só, para todos os processos
- [ADR-0009 — Tipos espelhados](../../arch/adr/0009-tipos-espelhados-ts-rust.md)

## Interfaces and Contracts

### Tauri Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `assistant_ask` | `text`, `sessionId?`, `conversationId?`, `agent?`, `onEvent` | `()` | Erros: `BUSY` (a conversa já responde), `TOO_MANY` (5 respondendo), agente indisponível |
| `assistant_warm` | `sessionId?`, `conversationId?`, `agent?` | `()` | Encerra os ociosos das outras conversas |
| `assistant_cancel` | `conversationId?` | `()` | Só essa conversa |
| `assistant_reset` | `conversationId?` | `()` | Só essa conversa |
| `assistant_sleep` | — | `Sleep` | Todos os processos (RF-007) |
| `agent_contacts` | — | `AgentContact[]` | Novo |

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| Perguntar duas vezes na mesma conversa | "Ainda estou respondendo" | RF-001 |
| Sexta resposta simultânea | Recusada na UI; o Rust recusa também se a UI falhar | RF-002 |
| Duas perguntas quase juntas disputando a quinta vaga | A contagem e a reserva do `turn` são feitas sob uma trava: só uma entra | `ask` |
| Apagar uma conversa que responde | Interrompe só ela | RF-006 |
| Fechar o app com respostas em andamento | Todos os processos são encerrados | RF-007 |
| Agente apagado depois de a conversa existir | A pergunta falha com o motivo; a conversa fica | RF-012 |
| Nome de agente inválido vindo da UI | Erro, nenhum arquivo é lido | RNF-002 |
| Dois processos escrevendo o mesmo arquivo | Sem trava: o último grava por cima | KL |
| Permissões | Agente no chat nunca recebe shell nem outra pasta | RNF-001 |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [chat-mode](../chat-mode/spec.md) | Conversas, barra lateral, balões |
| [assistant](../assistant/spec.md) | O processo e o canal |
| [jv_agent](../../apps/jv_agent/spec.md) | Quem cria e instala os agentes |
| [memory-cleanup](../memory-cleanup/spec.md) | `assistant_sleep` |

### Runtime Dependencies

- [Claude Code](../../foundation/vendor/claude-code/spec.md), [Tauri](../../foundation/vendor/tauri/spec.md)

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/agent-contacts.spec.ts` — "agent-contacts helpers" | Parser de `agent` e `unread` | Storage Rules |
| `tests/agent-contacts.spec.ts` — "two conversations are answered at once; one that ends out of sight is marked unread" | Simultâneas, não lida, limite, parar uma | AC-001 a AC-004 |
| `tests/agent-contacts.spec.ts` — "an installed agent is a contact: its conversation is answered by the agent" | Seção Agentes, conversa de agente, `agent` nas perguntas, avatar, conversa vazia reaproveitada, "Rodar no terminal" | AC-005 a AC-007, RF-011 |
| `tests/agent-contacts.spec.ts` — "without agents the section says how to get one" | Seção vazia | AC-005 |
| `src-tauri/src/assistant.rs` — `every_conversation_starts_confined`, `an_agent_answers_with_its_own_prompt`, `conversations_have_their_own_slots` | Flags, prompt de agente, slots e limite | AC-008, RNF-001 |
| `src-tauri/src/agents.rs` — `contacts_are_the_installed_agents_with_a_valid_draft` | Contatos e prompt | RF-008, RNF-002 |

### Verification Commands

```powershell
npm run build
npx playwright test tests/agent-contacts.spec.ts tests/chat-mode.spec.ts tests/assistant.spec.ts tests/agent.spec.ts --project ui
```

Em `src-tauri`: `cargo test --lib -- assistant:: agents::`.

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| Vários `claude.exe` de verdade ao mesmo tempo: memória no pico, respostas sem se misturar, nenhum órfão ao fechar (sinais de parada do ADR-0028) | Sem teste (KL-001) | App real: duas perguntas longas em conversas diferentes, `npm run perf`, fechar e listar os processos |
| Processos ociosos encerrados ao trocar de conversa (RF-003) | Sem teste: precisa de processo real | App real, com o Gerenciador de Tarefas |
| Um agente real respondendo confinado (RF-010) | Só a linha de comando e o prompt, nos testes Rust | App real: pedir a um agente para rodar um comando e ver a recusa |
| Agente indisponível depois de a conversa existir (RF-012) | Só `agents::prompt`, no teste Rust | Apagar o rascunho e perguntar |
| "Limpa a memória" com vários processos vivos (RF-007) | Só `busy` e `idle` no teste Rust | App real |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. Uma tarefa nova traz Aceite, Arquivos permitidos, Comando de teste e Evidência.

### Phase 1 — Skeleton (`npm run new`)

- [x] T001 Spec e ADR-0028
  - Arquivos permitidos: `.specs/features/agent-contacts/spec.md`, `.specs/arch/adr/0028-processo-claude-code-conversa-ate-cinco.md`
  - Evidência: criados por `npm run new` e preenchidos em 2026-11-19
- [x] T002 [P] Módulo da feature
  - Arquivos permitidos: `src/lib/agentContacts.ts`
  - Evidência: criado por `npm run new`
- [x] T003 [P] Teste Playwright dos helpers
  - Arquivos permitidos: `tests/agent-contacts.spec.ts`
  - Evidência: criado por `npm run new`

### Phase 2 — Registration (CLI checklist)

- [x] T004 Comando Tauri `agent_contacts` e os parâmetros novos dos `assistant_*`
  - Arquivos permitidos: `src-tauri/src/lib.rs`
- [x] T005 Comandos no contrato
  - Arquivos permitidos: `.specs/arch/ipc-contract.md`
- [x] T006 Campos novos de `jarvis.conversations`
  - Arquivos permitidos: `.specs/domain/persistence.md`
- [x] T007 `tests/agent-contacts.spec.ts` no `testMatch` do projeto `ui`
  - Arquivos permitidos: `playwright.config.ts`
- [x] T008 Linhas nos índices (features e ADRs)
  - Arquivos permitidos: `.specs/README.md`, `.specs/arch/adr/README.md`

### Phase 3 — Segundo plano (US1)

- [x] T009 [US1] Slots, limite e ociosos no Rust
  - Aceite: AC-001, AC-003
  - Arquivos permitidos: `src-tauri/src/assistant.rs`, `src-tauri/src/lib.rs`
  - Comando de teste: `cargo test --lib -- assistant::`
- [x] T010 [US1] Backend, fake e `useAssistant` por conversa; não lida; campo livre
  - Aceite: AC-001 a AC-004
  - Arquivos permitidos: `src/lib/assistant.ts`, `src/hooks/useAssistant.ts`, `src/components/chat/*`, `src/App.tsx`

### Phase 4 — Contatos (US2)

- [x] T011 [US2] `contacts`, `prompt`, prompt de agente e a seção Agentes
  - Aceite: AC-005 a AC-008
  - Arquivos permitidos: `src-tauri/src/agents.rs`, `src-tauri/src/assistant.rs`, `src/lib/agentContacts.ts`, `src/components/chat/*`, `src/App.tsx`, `src/lib/chatMode.ts`

### Phase 5 — Verification

- [x] T012 Playwright do segundo plano (AC-001 a AC-004)
- [x] T013 Playwright dos contatos (AC-005 a AC-007)
  - Arquivos permitidos (T012–T013): `tests/agent-contacts.spec.ts`, `tests/chat-mode.spec.ts`, `tests/assistant.spec.ts`
- [x] T014 Testes Rust (AC-008, RNF-001, RF-008)
  - Arquivos permitidos: `src-tauri/src/assistant.rs`, `src-tauri/src/agents.rs`
- [x] T015 Specs tocadas: `chat-mode` (RF-010), `assistant`, `memory-cleanup`, `security`, ADR-0006 e ADR-0007 (linha Status)

## Rollback Plan

1. Fixar `MAX_ANSWERING` em 1 e fazer os comandos ignorarem `conversationId` devolve "uma resposta por vez" sem tocar em dados (ADR-0028 › Reversão).
2. Tire a seção Agentes, `AgentsList` e `AgentAvatar`; as conversas com `agent` passam a ser respondidas pelo JARVIS.
3. Os campos `agent` e `unread` ficam nas conversas e são ignorados.

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P1 — Local e offline | Atendido | Só o Claude Code, como antes |
| P2 — Rust dono do nativo | Atendido | Processos e arquivos de agente no Rust |
| P3 — Comandos finos | Atendido | `agent_contacts` e os parâmetros novos em `lib.rs`, por `blocking()` |
| P4 — Contratos espelhados | Atendido | `AgentContact` com `Mirrors` |
| P5 — Persistência tolerante | Atendido | `agent` e `unread` validados no parser |
| P6 — Fora do Tauri | Atendido | Fake com respostas simultâneas e `agents` |
| P7 — PT-BR | Atendido | UI e mensagens em PT-BR |
| P8 — Linguagem visual | Atendido | Tokens `hud-*` |
| P9 — Desktop leve | Exceção com ADR | Até 5 processos respondendo e 1 ocioso ([ADR-0028](../../arch/adr/0028-processo-claude-code-conversa-ate-cinco.md)) |
| P10 — Confinamento | Atendido | As mesmas flags para todo processo; teste `every_conversation_starts_confined` |
| P11 — Testes | Atendido | `tests/agent-contacts.spec.ts` no `testMatch`, 4 testes; 4 testes Rust novos; lacunas em Coverage Gaps |
| P12 — README mínimo | Atendido | Tudo em `.specs` |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | Conferido no app real em 2026-11-19 (build de release, por CDP, com o Claude Code de verdade): duas conversas perguntadas em seguida, com dois `claude.exe` sob o `jarvis.exe`; cada resposta na sua conversa e a que terminou fora da tela marcada como não lida; sessões diferentes; depois de voltar a uma delas e perguntar, um só `claude.exe` (o ocioso da outra foi encerrado); nenhum `claude.exe` órfão ao fechar o app. Numa segunda rodada no mesmo dia, com o build final: cinco conversas respondendo ao mesmo tempo (cinco indicadores "Respondendo", cinco `claude.exe`, de 1126 a 1184 MB somados em quatro medições, cerca de 230 MB cada); a sexta pergunta recusada com "Já estou respondendo em 5 conversas. Espere uma terminar.", sem mensagem enviada (a conversa nova tinha o seu processo aquecido e ocioso: seis `claude.exe` no pico, perto de 1,4 GB); "Parar" em cada uma deixando as outras respondendo; um só `claude.exe` ocioso ao fim. Um agente de teste instalado para a ocasião (`teste-jvos`, com `tools: Bash` no cabeçalho, removido depois) apareceu em `agent_contacts` e na seção Agentes, abriu a sua conversa, respondeu com a instrução do próprio prompt e recusou rodar `whoami` ("Não consigo rodar comandos…"): o confinamento vale apesar do cabeçalho. "Rodar no terminal", numa conversa do agente de teste: o app foi para o desktop, abriu o jv_sh com uma aba rodando `claude.exe --agent teste-jvos "<a última pergunta>"` na pasta `Documentos\JARVIS\Agentes\teste-jvos` (o Claude Code parou na pergunta de confiança da pasta, que é dele), e `agent_install` copiou o rascunho para `~/.claude/agents`; tudo removido depois. | Verificado no app |
| KL-002 | Sem fila: a sexta pergunta é recusada e precisa ser reenviada pelo usuário. | Decisão do ADR-0028 |
| KL-003 | Processos simultâneos podem escrever o mesmo arquivo de `Documentos\JARVIS` (`Memória.md`, as anotações do dia) sem trava: o último grava por cima. | Risco conhecido |
| KL-004 | As chamadas MCP não dizem de qual conversa vêm: uma ação pedida por uma conversa em segundo plano (abrir uma janela, um lembrete) acontece do mesmo jeito, sem indicar a origem. | Comportamento atual |
| KL-005 | O agente no chat usa o modelo das Configurações e as ferramentas do JARVIS; o `model` e o `tools` do rascunho só valem no terminal. | Decisão do ADR-0028 |
| KL-006 | Um slot fica no mapa do Rust depois de a conversa ser apagada (sem processo, alguns bytes) até o app fechar. | Comportamento atual |
| KL-007 | A memória de longo prazo (`Memória.md`) não entra no prompt dos agentes, só no do JARVIS. | Comportamento atual |
| KL-008 | A chave `jarvis.agentContacts` prevista pelo esqueleto do CLI não existe: a feature não guarda preferências. | Sem efeito |

## Open Questions

Nenhuma.

## References

- [ADR-0028](../../arch/adr/0028-processo-claude-code-conversa-ate-cinco.md); [chat-mode](../chat-mode/spec.md).
- Template: `.specs/_templates/feature.md`; modelo pronto: [reminders](../reminders/spec.md).
