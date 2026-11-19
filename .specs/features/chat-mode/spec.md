# Feature Specification: Modo chat

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/chat-mode` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Plano escrito em 2026-11-19, antes do código, e fechado no mesmo dia com o que foi construído; sem decisões em aberto |
| Source Commit | não commitado |
| Uncommitted Changes | Tudo: feature nova |
| Voice Shortcut | `shortcut:chatMode` ("modo chat") e `shortcut:desktopMode` ("modo desktop") |
| Assistant Tool | — |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web) o chat usa o fake `window.__JARVIS_ASSISTANT__` em DEV e, sem ele, avisa "Disponível no app desktop" |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-19 |
| Verification Scope | Conferido com o código em 2026-11-19: `src/lib/chatMode.ts`, `src/lib/assistant.ts`, `src/hooks/useAssistant.ts`, `src/hooks/useChatSpeech.ts`, `src/components/chat/*`, `src/App.tsx`, `src/components/Taskbar.tsx`, `src/hooks/useWindowControls.ts`, `src/lib/shortcuts.ts`, `src/lib/jarvisLines.ts`, `src-tauri/src/assistant.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/settings.rs`, `src-tauri/voice-commands.json`. Testes rodados: `npm run build` (tsc) sem erros; `tests/chat-mode.spec.ts` 8 de 8; projeto `ui` inteiro 176 testes (171 na primeira rodada; os 5 restantes passaram depois: 3 do `tasks.spec.ts`, que lia a chave antiga, e 2 instáveis sob carga); `cargo test --lib -- assistant:: settings:: voice::matcher` 53 de 53. O app real (build de release) ainda não foi conferido: KL-001 |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os IDs começam em US1, RF-001, RNF-001, SC-001, AC-001 e T001. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

O jvOS é um sistema agêntico: o JARVIS (Claude Code) age no computador pelo usuário. Até aqui ele só tinha o **modo desktop** (núcleo holográfico, dock, janelas) e uma conversa única, feita por voz. O **modo chat** é a outra face do mesmo app: uma tela cheia no formato de mensageiro (referência visual em `.inspo/chat.png`), com a lista de conversas à esquerda, os balões da conversa no centro e o campo de mensagem embaixo. É a central de comando do agente: cada resposta mostra o que ele fez (os passos) e o que produziu (os arquivos).

Esta é a primeira de quatro fases. As seguintes têm spec própria: a área de notas (`notes-area`), o grafo das notas (`notes-graph`) e os agentes como contatos com tarefas em segundo plano (`agent-contacts`).

| Input | Expected Behavior | Execution Path |
|---|---|---|
| Botão "Modo chat" na barra superior | O app troca para o chat; o botão vira "Modo desktop" | Local (`useChatModePrefs`) |
| `Ctrl+Shift+J` | Alterna o modo | Local (`useWindowControls`) |
| "Jarvis, modo chat" / "modo desktop" | Troca o modo e o JARVIS confirma | Motor de voz local → `voice:shortcut` |
| Texto + Enter no campo de mensagem | A pergunta vai para o JARVIS na conversa ativa e a resposta chega no balão | `assistant_ask` (Claude Code) |
| "Nova conversa" | Uma conversa vazia vira a ativa; a próxima pergunta abre outra sessão do Claude Code | Local + `assistant_reset` |
| Clicar numa conversa da lista | Ela vira a ativa e o Claude Code é preparado na sessão dela | Local + `assistant_warm` |
| "Apagar conversa" → confirmar | Sai da lista e a sessão dela vai para a Lixeira | Local + `assistant_forget` |

## Goals and Success Criteria

### Goals

- Conversar com o JARVIS por texto, com várias conversas guardadas, sem perder a conversa por voz do desktop.
- Ver o que o agente fez em cada resposta (ferramentas usadas e arquivos escritos).
- Trocar de modo por um botão, um atalho ou a voz, e voltar no modo em que o app foi fechado.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Alternar o modo não perde nada: janelas abertas, música e a resposta em andamento continuam | `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat" |
| SC-002 | Cada conversa retoma a sua própria sessão do Claude Code | `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another" |
| SC-003 | O histórico de antes da feature aparece como conversas, sem perda | `tests/chat-mode.spec.ts` — "the old single history becomes conversations" |

## Scope and Non-Goals

### In Scope

- O modo (`desktop` ou `chat`), lembrado entre execuções, e os quatro jeitos de trocar: botão da barra superior, botão no cabeçalho do chat, `Ctrl+Shift+J` e voz.
- Várias conversas: criar, selecionar, buscar, renomear e apagar; migração do histórico único.
- Balões com Markdown, passos do agente, cartões de arquivo, erro e resposta interrompida.
- Campo de mensagem (Enter envia, Shift+Enter quebra a linha), parar a resposta e o microfone do JARVIS.
- Fala: um botão liga a fala automática das respostas novas; cada resposta tem "Ouvir".
- O núcleo 2D em miniatura como avatar do JARVIS.

### Out of Scope

- Anexar arquivos à mensagem (o clipe da referência).
- Agentes como contatos e mais de uma resposta ao mesmo tempo: Fase 4. Aqui vale a regra do backend: uma resposta por vez no app inteiro ([ADR-0006](../../arch/adr/0006-jarvis-via-claude-cli.md)).
- Notas e grafo: Fases 2 e 3.
- Abrir janelas do desktop por cima do chat. O que o JARVIS abre fica no desktop, atrás do chat.
- Ação na busca (`/`) para trocar o modo.

## User Stories

### US1 — Alternar entre desktop e chat

**Priority:** P1.

**User Story:** Como usuário, quero um botão que troque o JARVIS OS para um modo chat e de volta, para usar o agente como um mensageiro quando não preciso do desktop.

**Why This Priority:** é a porta de entrada de todo o resto.

**Independent Test:** `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat".

**Acceptance Criteria:** AC-001, AC-002, AC-003 e AC-004.

### US2 — Conversar por texto

**Priority:** P1.

**User Story:** Como usuário, quero digitar para o JARVIS e ler a resposta em balões, com o que ele fez e os arquivos que escreveu, para acompanhar o agente sem depender da voz.

**Why This Priority:** sem isso o modo chat é só uma tela.

**Independent Test:** `tests/chat-mode.spec.ts` — "a typed question is answered in a bubble, with the agent's steps and the file it wrote".

**Acceptance Criteria:** AC-005, AC-006, AC-007, AC-008 e AC-009.

### US3 — Várias conversas

**Priority:** P1.

**User Story:** Como usuário, quero várias conversas guardadas, cada uma com o seu assunto, para retomar um trabalho sem misturar contextos.

**Why This Priority:** é o que separa um chat de um histórico.

**Independent Test:** `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another".

**Acceptance Criteria:** AC-010, AC-011, AC-012, AC-013, AC-014 e AC-015.

### US4 — Ouvir as respostas

**Priority:** P2.

**User Story:** Como usuário, quero ligar a fala das respostas ou ouvir uma resposta específica, para usar o chat sem olhar para a tela.

**Why This Priority:** a voz é a identidade do JARVIS, mas o chat funciona sem ela.

**Independent Test:** `tests/chat-mode.spec.ts` — "answers are spoken when the voice is on, and any answer can be heard again".

**Acceptance Criteria:** AC-016 e AC-017.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | O sistema DEVE ter dois modos, `desktop` (padrão) e `chat`, guardados em `jarvis.chatMode`; ao abrir, o app volta no último modo. | US1 |
| RF-002 | A barra superior DEVE ter um botão fixo, ao lado da busca, com o nome "Modo chat" no desktop e "Modo desktop" no chat. O cabeçalho do chat DEVE ter sempre o botão "Voltar ao desktop". | US1 |
| RF-003 | `Ctrl+Shift+J` DEVE alternar o modo, menos dentro de um terminal (`[data-terminal]`). | US1 |
| RF-004 | Os atalhos de voz `shortcut:chatMode` ("modo chat") e `shortcut:desktopMode` ("modo desktop") DEVEM trocar o modo e o JARVIS confirma com uma fala local. | US1 |
| RF-005 | No modo chat, a camada do desktop (núcleo, botão do núcleo, legenda, resposta no núcleo, janelas, dock e aba do histórico) DEVE ficar coberta e inerte (`inert`), com o núcleo e os widgets pausados. As janelas continuam montadas. Voz, lembretes, música, agenda e ferramentas MCP continuam funcionando. | US1 |
| RF-006 | O chat DEVE mostrar a conversa ativa em balões: a pergunta à direita; a resposta à esquerda, com o avatar, em Markdown (`MARKDOWN_COMPONENTS`), com a hora. | US2 |
| RF-007 | Cada resposta DEVE listar, na ordem, os passos do agente: as ferramentas usadas, descritas por `describeTool`, sem repetir a mesma em sequência. Os passos ficam guardados com a resposta. | US2 |
| RF-008 | Cada arquivo que o JARVIS escreve DEVE aparecer na resposta como um cartão com o nome do arquivo. Para notas (`Notas\`) e agentes (`Agentes\*.md`), o cartão tem "Abrir": uma nota abre na seção Notas do próprio chat ([notes-area](../notes-area/spec.md) RF-011; até a Fase 2 abria o Jarvis Mark no desktop); um agente troca para o modo desktop e abre o jv_agent. Nada troca de modo sozinho. | US2 |
| RF-009 | O campo de mensagem DEVE enviar com Enter e quebrar a linha com Shift+Enter; texto vazio não envia. Enquanto a conversa ativa é respondida, o botão de enviar vira "Parar", que interrompe a resposta (Esc também). | US2 |
| RF-010 | Cada conversa que está sendo respondida DEVE levar um indicador na lista, e as outras continuam abertas para ler **e para perguntar**. Na Fase 1 o campo de mensagem das outras ficava bloqueado ("O JARVIS está respondendo em outra conversa"); a Fase 4 ([agent-contacts](../agent-contacts/spec.md) RF-005) tirou o bloqueio: cada conversa tem o seu processo. | US2, US3 |
| RF-011 | O microfone do campo de mensagem DEVE usar o mesmo fluxo do núcleo (`press`/`release`): a pergunta falada entra na conversa ativa. | US2 |
| RF-012 | "Nova conversa" DEVE criar uma conversa vazia e torná-la ativa; se a ativa já está vazia, ela é reaproveitada. A primeira pergunta abre uma sessão nova do Claude Code. | US3 |
| RF-013 | O título de uma conversa DEVE ser "Nova conversa" até a primeira pergunta, e então os primeiros 48 caracteres dela, até o usuário renomear. Um título renomeado não muda mais sozinho. O título é posto quando a pergunta é enviada, não quando a resposta termina (corrigido em 2026-11-19, com as respostas em segundo plano). | US3 |
| RF-014 | Selecionar uma conversa DEVE torná-la ativa e, com o JARVIS ocioso, preparar o Claude Code na sessão dela (`warm`). Perguntar numa conversa retoma a sessão dela. | US3 |
| RF-015 | A busca da lista DEVE filtrar as conversas pelo título e pelo texto das perguntas e respostas, sem diferenciar maiúsculas nem acentos. | US3 |
| RF-016 | Apagar uma conversa DEVE pedir confirmação, tirá-la da lista e mandar a sessão dela para a Lixeira (`assistant_forget`). Apagar a conversa que está sendo respondida interrompe a resposta antes. Apagar a última deixa uma conversa vazia. | US3 |
| RF-017 | Na primeira execução com a feature, o histórico de `jarvis.assistant` DEVE virar conversas: cada trecho entre divisores "Nova conversa" vira uma, com o título da primeira pergunta; só o último trecho mantém a `sessionId`. | US3 |
| RF-018 | No desktop, o painel "Histórico do JARVIS" DEVE mostrar a conversa ativa; "Nova conversa" cria outra (RF-012) e "Limpar histórico" apaga a ativa (RF-016, sem confirmação, como hoje). | US3 |
| RF-019 | Com a fala automática ligada (`speak`), cada resposta nova no modo chat DEVE ser falada inteira quando termina, com a voz das Configurações. Cada resposta tem "Ouvir", que a fala na hora, e vira "Parar de ouvir" enquanto fala. | US4 |
| RF-020 | Os avisos que no desktop aparecem na dock DEVEM aparecer no chat numa linha de aviso. | US1, US2 |
| RF-021 | A barra lateral do chat DEVE poder ser recolhida: o botão "Recolher a barra lateral", no topo dela, deixa só uma faixa estreita (48 px) com o botão "Mostrar a barra lateral", e a conversa (ou a nota, ou o grafo) ocupa o resto. A escolha fica em `jarvis.chatMode` (`collapsed`) e vale para as três seções. Pedido do usuário em 2026-11-19. | US1 |
| RF-022 | Sob uma resposta, "Consultou:" DEVE listar os arquivos que o JARVIS leu para responder e que podem ser abertos (as notas), cada um um botão que abre a nota na seção Notas ([notes-graph](../notes-graph/spec.md), RF-017). | US2 |
| RF-023 | O botão direito do mouse (ou a tecla de menu) numa resposta já terminada e com texto DEVE abrir um menu com "Adicionar à nota…" e "Salvar como nova nota". Pedido do usuário em 2026-11-19. "Salvar como nova nota" cria em `Notas` uma nota com o nome tirado da pergunta (até 60 caracteres, sem o que o Windows recusa; com 2, 3… se o nome já existe) e o conteúdo `# <nome>` seguido da resposta em Markdown. "Adicionar à nota…" troca o menu pela lista das notas (as de alteração mais recente primeiro, com a pasta ao lado e um campo que filtra pelo título); a escolhida recebe a resposta no fim, separada por uma linha em branco. Nos dois casos o chat continua na tela e a linha de aviso diz onde ficou ("Resposta salva em …", "Resposta adicionada a …"); uma falha (a nota mudou no disco, sem acesso) aparece ali como erro e nada é escrito por cima. Esc, um clique fora ou a janela perder o foco fecham o menu. No navegador os dois itens ficam desabilitados. | US2 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | No máximo 50 conversas (`MAX_CONVERSATIONS`) e 200 perguntas por conversa (`MAX_ITEMS`). Ao passar de 50, a mais antiga que não é a ativa sai da lista e tem a sessão esquecida. | `jarvis.conversations` |
| RNF-002 | `jarvis.conversations` e `jarvis.chatMode` são gravados com debounce de 250 ms e relidos por parsers tolerantes. | Persistência |
| RNF-003 | O chat é carregado sob demanda (chunk próprio), só quando o modo chat é usado. | `ChatView` |
| RNF-004 | O texto da resposta em andamento é redesenhado no máximo a cada 32 ms (`STREAM_STEP_MS`, já existente). | Resposta ao vivo |
| RNF-005 | `assistant_forget` só aceita ids de dígitos hexadecimais e `-`, e só toca em `<config do Claude>\projects\*\<id>.jsonl`. | Segurança |

### Operational Constraints

- Uma resposta por vez no app inteiro (regra do backend).
- Trocar de conversa reinicia o `claude.exe` com `--resume` (cerca de 1 s com o aquecimento).
- Textos, rótulos e falas em PT-BR.

## Acceptance Criteria

### AC-001 — Switch with the Top Bar Button

**Related Story:** US1.

- **Given** o app no modo desktop com a barra superior ligada
- **When** o usuário clica em "Modo chat"
- **Then** o chat aparece, o botão passa a se chamar "Modo desktop" e `jarvis.chatMode` guarda `mode: "chat"`.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat".

### AC-002 — Switch with the Keyboard

**Related Story:** US1.

- **Given** o app em qualquer modo, com o foco fora de um terminal
- **When** o usuário pressiona `Ctrl+Shift+J`
- **Then** o modo alterna.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat".

### AC-003 — Switch by Voice

**Related Story:** US1.

- **Given** o app no modo desktop
- **When** chega o atalho de voz `chatMode` (ou `desktopMode`, no chat)
- **Then** o modo troca e a fala do JARVIS entra na conversa ativa.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat".

### AC-004 — Remember the Mode and Keep the Desktop

**Related Story:** US1.

- **Given** uma janela aberta no desktop e o app no modo chat
- **When** a página recarrega e depois o usuário volta ao desktop pelo botão do cabeçalho do chat
- **Then** o app reabre no chat, e no desktop a janela continua aberta.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat".

### AC-005 — Ask by Text

**Related Story:** US2.

- **Given** o modo chat com o JARVIS ocioso
- **When** o usuário digita uma pergunta e pressiona Enter
- **Then** a pergunta aparece num balão à direita, a resposta chega num balão à esquerda e o campo fica vazio.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "a typed question is answered in a bubble, with the agent's steps and the file it wrote".

### AC-006 — Show the Agent's Steps and Files

**Related Story:** US2.

- **Given** uma resposta em que o JARVIS escreve um arquivo em `Notas\`
- **When** a resposta termina
- **Then** o balão mostra o passo "Escrevendo" e um cartão com o nome do arquivo e o botão "Abrir"; clicar em "Abrir" mostra a nota na seção Notas, sem sair do chat.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "a typed question is answered in a bubble, with the agent's steps and the file it wrote".

### AC-007 — Stop an Answer

**Related Story:** US2.

- **Given** uma resposta em andamento na conversa ativa
- **When** o usuário clica em "Parar"
- **Then** a resposta para e o balão fica marcado "Interrompida".

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "an answer stops with Parar or Esc, and a failure shows in its bubble".

### AC-008 — Failure Path

**Related Story:** US2.

- **Given** o Claude Code falha ao responder
- **When** a resposta termina com erro
- **Then** o balão mostra o erro em `text-hud-alert` e o campo volta a aceitar perguntas.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "an answer stops with Parar or Esc, and a failure shows in its bubble".

### AC-009 — Outside the Desktop App

**Related Story:** US2.

- **Given** o app no navegador sem o fake do assistente
- **When** o usuário envia uma pergunta
- **Then** a linha de aviso mostra "Disponível no app desktop" e nenhum balão é criado.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "in a browser the chat says the conversation needs the desktop app".

### AC-010 — New Conversation, New Session

**Related Story:** US3.

- **Given** uma conversa com uma pergunta respondida
- **When** o usuário clica em "Nova conversa" e pergunta de novo
- **Then** a lista tem duas conversas e a segunda pergunta foi enviada sem `sessionId`.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another".

### AC-011 — Resume a Conversation's Session

**Related Story:** US3.

- **Given** duas conversas, cada uma com a sua sessão
- **When** o usuário seleciona a primeira e pergunta
- **Then** a pergunta é enviada com a `sessionId` da primeira.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another".

### AC-012 — Read but Not Send While Another Answers

**Related Story:** US3.

- **Given** uma resposta em andamento na conversa A
- **When** o usuário seleciona a conversa B
- **Then** os balões de B aparecem, o campo de mensagem de B continua livre (até a Fase 4 ficava desabilitado), e a resposta termina em A.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another".

### AC-013 — Rename and Search

**Related Story:** US3.

- **Given** duas conversas
- **When** o usuário renomeia uma e digita parte do nome novo na busca
- **Then** só essa conversa fica na lista, e o título renomeado não muda com perguntas novas.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another".

### AC-014 — Delete a Conversation

**Related Story:** US3.

- **Given** uma conversa com sessão
- **When** o usuário clica em apagar e confirma
- **Then** ela sai da lista e `assistant_forget` é chamado com a sessão dela; cancelar a confirmação não apaga nada.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another".

### AC-015 — Migrate the Old History

**Related Story:** US3.

- **Given** um `jarvis.assistant` com duas perguntas, um divisor "Nova conversa" e mais uma pergunta, e nenhuma `jarvis.conversations`
- **When** o app carrega
- **Then** a lista tem duas conversas, a ativa é a do último trecho e só ela tem a `sessionId` antiga.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "the old single history becomes conversations".

### AC-016 — Speak New Answers

**Related Story:** US4.

- **Given** o modo chat com "Falar as respostas" ligado e uma voz disponível
- **When** uma resposta termina
- **Then** ela é sintetizada e tocada.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "answers are spoken when the voice is on, and any answer can be heard again".

### AC-017 — Hear an Answer Again

**Related Story:** US4.

- **Given** uma resposta antiga na conversa e a fala automática desligada
- **When** o usuário clica em "Ouvir" nessa resposta
- **Then** ela é falada, e o botão vira "Parar de ouvir" enquanto toca.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "answers are spoken when the voice is on, and any answer can be heard again".

### AC-018 — Collapse the Side Bar

**Related Story:** US1.

- **Given** o modo chat com a barra lateral aberta
- **When** o usuário clica em "Recolher a barra lateral"
- **Then** a lista some, fica a faixa com "Mostrar a barra lateral" e a conversa ocupa a largura liberada; a escolha continua depois de recarregar, e "Mostrar a barra lateral" traz a lista de volta.

**Coverage Status:** coberto — `tests/chat-mode.spec.ts` — "the side bar folds away and comes back, and the choice is kept".

### AC-019 — Save an Answer as a New Note

**Related Story:** US2.

- **Given** uma resposta terminada à pergunta "O que é RAG?"
- **When** o usuário clica nela com o botão direito e escolhe "Salvar como nova nota"
- **Then** existe `Notas\O que é RAG.md` com `# O que é RAG` e a resposta, o aviso diz "Resposta salva em “O que é RAG”" e o chat continua na tela; repetir cria "O que é RAG 2".

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "a right click on an answer saves it as a new note or adds it to one".

### AC-020 — Add an Answer to a Note

**Related Story:** US2.

- **Given** o menu de uma resposta
- **When** o usuário escolhe "Adicionar à nota…", filtra por "idei" e escolhe "Ideias"
- **Then** `Ideias.md` termina com a resposta, depois do que já tinha e de uma linha em branco, e o aviso diz "Resposta adicionada a “Ideias”"; Esc fecha o menu sem escrever nada.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "a right click on an answer saves it as a new note or adds it to one".

## Behavior and Flows

### Modo (`src/lib/chatMode.ts`)

- **Behavior:** `useChatModePrefs` guarda `{ mode, section, speak, collapsed }` em `jarvis.chatMode` (RF-001, RF-021). `matchesConversation(conversation, query)` é a busca (RF-015), com o `normalize` de `src/lib/search.ts`; `conversationPreview` é o trecho mostrado na lista (até 80 caracteres, sem marcas de Markdown). O título (`conversationTitle`, RF-013: 48 caracteres, cortado numa palavra e com "…") fica em `src/lib/assistant.ts`, junto dos tipos.

### Conversas (`src/lib/assistant.ts`, `src/hooks/useAssistant.ts`)

- **Behavior:**
  - `useAssistant` guarda `ConversationStore` em `jarvis.conversations`. Sempre existe ao menos uma conversa, e `activeId` aponta para uma delas.
  - `ask` grava na conversa que era a ativa no envio, mesmo que o usuário troque depois (RF-010). A `sessionId` que chega no evento `session` é a dessa conversa.
  - O hook lembra em que sessão o processo do Claude Code está. Perguntar numa conversa sem sessão quando o processo está em outra chama `reset` antes: o Rust só troca de sessão quando recebe uma `sessionId` diferente.
  - `create` (RF-012): ocioso, chama `reset` e `warm(null)`; ocupado, só cria e seleciona.
  - `select` (RF-014): ocioso, chama `warm(sessionId)`.
  - `remove` (RF-016): interrompe a resposta se for a dessa conversa, chama `forget(sessionId)` e garante que sobra uma conversa.
  - `rename` marca `renamed: true`.
  - O `turn` ganha `conversationId`, `steps` e `files`; ao terminar, vão para o item da conversa (RF-007, RF-008).
  - `items` continua sendo a lista da conversa ativa, para o painel do desktop e o jv_agent. Não há mais divisores "Nova conversa".
  - `reset` passa a ser `create`, e `clear` apaga a conversa ativa (RF-018).

### `ChatView` (`src/components/chat/`)

- **Behavior:** junta a lista (`ChatSidebar`), a conversa (`ChatThread`) e o campo (`ChatComposer`). Recebe o assistente, o modo, a fala e os avisos pelo `App`.
- **Layout:** `fixed`, do topo (abaixo da barra superior de 28 px, quando ela está ligada) até a base, em `z-[21]`, depois da camada do desktop no DOM. O cabeçalho (56 px) tem o avatar, o título da conversa, "Falar as respostas" e "Voltar ao desktop", e é `data-tauri-drag-region`: sem a barra superior, é por ele que a janela se move. Entre os balões e o campo fica a linha de aviso (`role="status"`, RF-020). A lista tem 320 px; a conversa ocupa o resto, com os balões numa coluna de até 820 px.
- **Style:** a pele de mensageiro da referência `.inspo/chat.png`, pedida pelo usuário em 2026-11-19 (a primeira versão usava a paleta holográfica do desktop):
  - A classe `.chat-skin` (`src/styles/globals.css`), na raiz do chat, troca os tokens `hud-*` pela paleta do mensageiro: fundo `#0e1621`, superfícies `#17212b`, destaque azul `#5eb5f7`, texto branco e cinza-azulado. Todo componente do chat, o editor de notas e o grafo seguem sem nomear cores. A paleta é a mesma em todos os temas do desktop.
  - Tokens próprios em `@theme`: `chat-mine` (`#2b5278`, o balão do usuário), `chat-theirs` (`#182533`, o balão do JARVIS), `chat-active` (a conversa ou a nota na tela) e `chat-field` (a busca).
  - Lista de 320 px com avatar redondo de 46 px em cada conversa, título em negrito e a conversa ativa num retângulo azul arredondado; busca em pílula (`.chat-search`); seções como pílulas.
  - Balões sem borda, com a hora dentro, à direita; cartão de arquivo com o ícone num círculo azul; campo de mensagem numa barra arredondada, com o microfone e o enviar redondos.
  - Texto selecionável (`select-text`). Nenhuma cor fica nos componentes: só no arquivo de tema (P8).

### `ChatSidebar`

- **Behavior:** busca (RF-015), "Nova conversa" (RF-012), a lista ordenada pela última atividade, com título, um trecho da última mensagem e a hora. A conversa ativa fica marcada (`aria-current`); a que está sendo respondida mostra um ponto pulsando (RF-010). Cada item tem "Renomear" (edição no lugar; Enter grava, Esc desiste) e "Apagar" (pede "Apagar?" com "Sim" e "Não") (RF-016).

### `ChatThread`

- **Behavior:** balões da conversa ativa e, por último, a resposta em andamento se for dela. Rola para a última mensagem. Cada resposta mostra os passos, o Markdown, os cartões de arquivo, "Interrompida" ou o erro, a hora e "Ouvir" (RF-006 a RF-008, RF-019). Sem mensagens, mostra o avatar grande e "Como posso ajudar?".

### `ChatComposer`

- **Behavior:** `textarea` com `hud-input` que cresce até 6 linhas. Enter envia; Shift+Enter quebra a linha; Esc, com a resposta em andamento, interrompe e não chega ao listener global. Botões: microfone (`press`/`release`, RF-011) e enviar, que vira "Parar" (RF-009). Bloqueado conforme RF-010.

### `CoreAvatar`

- **Behavior:** o núcleo 2D em miniatura (aro segmentado, anel interno e triângulo), em SVG sem filtros nem WebGL. Gira (classe `core-spin`) só enquanto o JARVIS responde.

### Fala (`useChatSpeech`)

- **Behavior:** fala um texto frase a frase com `paginate` (de `JarvisReply.tsx`, sem mudanças) e `createSpeechPlayer`. Uma fala nova interrompe a anterior, e sair do chat a cala. A voz usada é a das Configurações; basta ela estar baixada (`voiceReady`), mesmo com "Voz do JARVIS" desligada no desktop. No modo chat, o `App` chama `speak` quando uma resposta termina e `speak` está ligado, e tira o `turn` terminado da tela (no desktop quem faz isso é o `JarvisReply`, que não é montado no chat). Uma resposta que já estava no núcleo quando o chat entrou não é falada de novo.

### Interaction Flow

1. O usuário entra no modo chat (botão, atalho ou voz).
2. Digita e envia. O balão da pergunta aparece; o do JARVIS mostra "Pensando", depois os passos e o texto chegando.
3. Ao terminar, a resposta é gravada na conversa, com passos e arquivos, e é falada se a fala estiver ligada.
4. O usuário pode abrir outra conversa para ler enquanto isso, criar uma nova, ou voltar ao desktop.

### User Feedback

| Situation | Feedback |
|---|---|
| Resposta em andamento | "Pensando", o passo atual ou "Respondendo", com o cursor piscando |
| Outra conversa respondendo | Campo bloqueado: "O JARVIS está respondendo em outra conversa" |
| Fora do app desktop | Aviso "Disponível no app desktop" |
| Voz troca o modo | "Modo chat ativado." / "De volta ao desktop." (variações em `jarvisLines.ts`) |

### Voice and Keyboard

- `shortcut:chatMode` reconhece "modo chat", "abre o chat", "modo conversa"; `shortcut:desktopMode` reconhece "modo desktop", "volta para o desktop", "modo área de trabalho" (RF-004).
- `Ctrl+Shift+J` alterna (RF-003). No campo: Enter, Shift+Enter e Esc (RF-009).

## Data Model and Persistence

### ChatModePrefs

```ts
interface ChatModePrefs {
  mode: "desktop" | "chat";
  /** Answers are spoken as they end, in the chat. */
  speak: boolean;
  /** The side bar is folded away (RF-021). */
  collapsed: boolean;
}
```

### ConversationStore

```ts
interface ConversationEntry {
  id: number;
  at: number;
  question: string;
  answer: string;
  error?: string;
  cancelled?: boolean;
  /** Tools the agent used, in order ("WebSearch", "Write"). */
  steps?: string[];
  /** Files it wrote (absolute paths). */
  files?: string[];
}

interface Conversation {
  id: string;
  title: string;
  /** The user named it: the first question no longer does. */
  renamed?: boolean;
  /** Claude Code's session, to continue it (null: none yet, or lost). */
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  items: ConversationEntry[];
}

interface ConversationStore {
  activeId: string;
  conversations: Conversation[];
}
```

### Storage Rules

| Property | Value |
|---|---|
| State | `$modo`, `$conversas` |
| Storage | `localStorage` |
| Keys | `jarvis.chatMode`, `jarvis.conversations` |
| Write Debounce | 250 ms |
| Reader | `parseChatMode` e `parseConversations`: campo inválido vira o padrão; conversa sem id é descartada; `activeId` inválido vira a conversa mais recente |
| Missing or Invalid Storage | Modo desktop, fala desligada; conversas migradas de `jarvis.assistant` (RF-017) ou uma conversa vazia |
| Migration | Sem `jarvis.conversations`, o estado inicial vem de `migrateMemory(jarvis.assistant)`. A chave antiga não é apagada nem regravada |
| Limits | 50 conversas, 200 perguntas por conversa (RNF-001) |

Ver [persistência](../../domain/persistence.md).

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src/lib/chatMode.ts` | Preferências do modo, busca e trecho das conversas |
| `src/lib/assistant.ts` | Tipos e parser de `jarvis.conversations`, `conversationTitle`, `migrateMemory`, `forget` no backend e no fake |
| `src/hooks/useAssistant.ts` | Conversas (criar, selecionar, renomear, apagar), passos e arquivos no `turn` |
| `src/hooks/useChatSpeech.ts` | Fala de um texto no chat (novo) |
| `src/components/chat/ChatView.tsx`, `ChatSidebar.tsx`, `ChatThread.tsx`, `ChatComposer.tsx`, `CoreAvatar.tsx` | A tela do chat (novos) |
| `src/App.tsx` | O modo, a camada do desktop inerte, o `ChatView` lazy, os atalhos de voz, a fala ao terminar |
| `src/components/Taskbar.tsx` | Botão do modo |
| `src/hooks/useWindowControls.ts` | `Ctrl+Shift+J` |
| `src/components/AssistantHistory.tsx`, `desktop/apps/agent/AgentSession.tsx` | Continuam lendo `items`; sem divisores novos |
| `src/lib/shortcuts.ts`, `src/lib/jarvisLines.ts` | Ações `chatMode` e `desktopMode` e as falas |
| `src-tauri/src/settings.rs`, `src-tauri/voice-commands.json` | Alvos e frases dos atalhos |
| `src-tauri/src/assistant.rs`, `src-tauri/src/lib.rs` | `forget` e o comando `assistant_forget` |
| `tests/chat-mode.spec.ts`, `tests/helpers.ts` e os specs que liam `jarvis.assistant` | Testes |

### Related Architecture Decisions

- [ADR-0004 — Catálogo de voz compartilhado em JSON, com fallback para o JARVIS](../../arch/adr/0004-catalogo-de-voz-compartilhado-e-fallback.md)
- [ADR-0006 — O cérebro do JARVIS é o `claude.exe` local](../../arch/adr/0006-jarvis-via-claude-cli.md): um processo, uma pergunta por vez. Mantido nesta fase.
- [ADR-0007 — O JARVIS fica confinado a `Documentos\JARVIS`](../../arch/adr/0007-jarvis-confinado-a-documentos.md): o texto digitado vai para o mesmo `claude.exe` confinado.
- [ADR-0009 — Tipos espelhados](../../arch/adr/0009-tipos-espelhados-ts-rust.md)
- [ADR-0010 — Persistência](../../arch/adr/0010-persistencia-settings-vs-localstorage.md)
- [ADR-0011 — Fakes de desenvolvimento](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0012 — Apps carregados sob demanda](../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0022 — Núcleo com relógio de quadros](../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md): o avatar não cria WebGL e o núcleo fica pausado sob o chat.

## Interfaces and Contracts

### Tauri Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `assistant_forget` | `sessionId: string` | `bool` (havia um arquivo e ele foi para a Lixeira) | Id inválido: erro "Sessão inválida". Se for a sessão em que o processo está, ele é encerrado e a sessão esquecida antes. No fake de DEV, registra em `__JARVIS_ASSISTANT_LOG__.forgets` |

Os demais (`assistant_ask`, `assistant_warm`, `assistant_cancel`, `assistant_reset`) são usados como estão.

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| Pergunta vazia ou só espaços | Não envia | RF-009 |
| `jarvis.conversations` corrompido | O parser descarta o que não serve; sem conversa válida, tenta a migração e depois uma conversa vazia | RNF-002 |
| "Nova conversa" com a ativa vazia | Reaproveita a vazia; não cria duas | RF-012 |
| Enviar enquanto outra conversa responde | Envia: cada conversa responde por si, até 5 ao mesmo tempo ([agent-contacts](../agent-contacts/spec.md)). Na mesma conversa, "Ainda estou respondendo" | RF-010 |
| Apagar a conversa que está respondendo | Interrompe, depois apaga | RF-016 |
| Apagar a única conversa | Fica uma conversa vazia | RF-016 |
| Sessão que não existe mais no disco | O Rust abre uma sessão nova; a conversa passa a apontar para ela | RF-014 |
| `assistant_forget` falha (arquivo em uso, sem Lixeira) | A conversa sai da lista assim mesmo; o erro vai para o aviso | RF-016, KL-003 |
| Mais de 50 conversas | A mais antiga não ativa sai | RNF-001 |
| `localStorage` cheio | A gravação falha em silêncio, como nas outras chaves | KL-002 |
| Permissões | O chat não dá ao JARVIS nenhuma ferramenta nova; `assistant_forget` só apaga transcrições por id validado | RNF-005 |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [assistant](../assistant/spec.md) | O backend, o `turn` e o histórico, que passam a ser por conversa |
| [voice-shortcuts](../voice-shortcuts/spec.md) | Os atalhos de voz e o `shortcutHandler` |
| [tts](../tts/spec.md) | `createSpeechPlayer` |
| [dock-taskbar](../dock-taskbar/spec.md) | O botão na barra superior |
| [keyboard-shortcuts](../keyboard-shortcuts/spec.md) | `Ctrl+Shift+J` |

### Runtime Dependencies

- [Tauri](../../foundation/vendor/tauri/spec.md) (o comando)
- [Claude Code](../../foundation/vendor/claude-code/spec.md)
- [Markdown](../../foundation/vendor/markdown/spec.md)
- crate `trash`, já usada pelo workspace ([workspace-fs](../../foundation/vendor/workspace-fs/spec.md))

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/chat-mode.spec.ts` — "the side bar folds away and comes back, and the choice is kept" | Barra de 320 px vira faixa de 48 px e a conversa ganha a largura; enviar com a barra recolhida; `collapsed` gravado e mantido ao recarregar; "Mostrar a barra lateral" traz a lista de volta | AC-018 |
| `tests/notes-area.spec.ts` — "a right click on an answer saves it as a new note or adds it to one" | O menu e os seus dois itens; Esc não escreve nada; nota nova com o nome da pergunta e o próximo nome livre na segunda vez; a resposta no fim de uma nota escolhida pelo filtro; a pasta ao lado do título na lista; o aviso de cada caso; o chat continua na tela | AC-019, AC-020 |
| `tests/chat-mode.spec.ts` — "chat-mode helpers" | Parser do modo, título, busca, parser e migração das conversas | AC-015 |
| `tests/chat-mode.spec.ts` — "the top bar button and Ctrl+Shift+J switch between the desktop and the chat" | Botão, atalho, voz, modo lembrado, janela mantida | AC-001 a AC-004 |
| `tests/chat-mode.spec.ts` — "a typed question is answered in a bubble, with the agent's steps and the file it wrote" | Envio, Shift+Enter, vazio não envia, balões, Markdown, passos, cartão, "Abrir", título | AC-005, AC-006 |
| `tests/chat-mode.spec.ts` — "each conversation keeps its own session; a new one starts another" | Nova, retomar, ler sem enviar, renomear, buscar, apagar | AC-010 a AC-014 |
| `tests/chat-mode.spec.ts` — "the old single history becomes conversations" | Migração | AC-015 |
| `tests/chat-mode.spec.ts` — "answers are spoken when the voice is on, and any answer can be heard again" | Fala automática e "Ouvir" | AC-016, AC-017 |
| `src-tauri/src/assistant.rs` — `forgetting_a_session_only_takes_valid_ids` | Validação do id; id bem formado sem transcrição não apaga nada | RNF-005 |
| `tests/chat-mode.spec.ts` — "an answer stops with Parar or Esc, and a failure shows in its bubble" | "Parar", Esc no campo, "Interrompida", erro no balão | AC-007, AC-008 |
| `tests/chat-mode.spec.ts` — "in a browser the chat says the conversation needs the desktop app" | Aviso fora do app | AC-009 |
| `tests/assistant.spec.ts` — "a follow-up continues the conversation; Nova conversa starts another" | "Nova conversa" e "Limpar histórico" do painel do desktop sobre as conversas; `forgets` | RF-018 |
| `src-tauri/src/settings.rs` — `default_voice_commands_are_valid` | Os alvos `chatMode` e `desktopMode` têm frases válidas | RF-004 |

### Verification Commands

Na raiz do repositório:

```powershell
npm run build
npx playwright test tests/chat-mode.spec.ts tests/assistant.spec.ts tests/shortcuts.spec.ts tests/personality.spec.ts tests/feeds.spec.ts tests/speech.spec.ts tests/agent.spec.ts tests/taskbar.spec.ts tests/core.spec.ts --project ui
```

Em `src-tauri` (ambiente de `build-and-env.md`):

```powershell
cargo test --lib -- assistant:: settings::
```

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| O app real: sessões de verdade retomadas com `--resume` ao trocar de conversa, e o `.jsonl` indo para a Lixeira | Sem teste (KL-001) | Build de release, duas conversas, apagar uma e conferir `~/.claude/projects` |
| Microfone do campo de mensagem (RF-011) | Sem teste automático: o modo web não tem motor de voz. Conferido à mão no app real (KL-001) | App real via CDP |
| Limite de 50 conversas (RNF-001) | Sem teste | Semear 50 conversas e criar mais uma |
| `Ctrl+Shift+J` dentro de um terminal (RF-003) | Sem teste próprio; a guarda é a mesma dos outros atalhos | `tests/shell.spec.ts` |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. Uma tarefa nova traz Aceite, Arquivos permitidos, Comando de teste e Evidência.

### Phase 1 — Skeleton (`npm run new`)

- [x] T001 Spec
  - Arquivos permitidos: `.specs/features/chat-mode/spec.md`
  - Evidência: criado por `npm run new` e preenchido em 2026-11-19
- [x] T002 [P] Módulo da feature
  - Arquivos permitidos: `src/lib/chatMode.ts`
  - Evidência: criado por `npm run new`
- [x] T003 [P] Teste Playwright dos helpers
  - Arquivos permitidos: `tests/chat-mode.spec.ts`
  - Evidência: criado por `npm run new`

### Phase 2 — Registration (CLI checklist)

- [x] T004 Ações `chatMode` e `desktopMode` em `ShortcutAction` e `SHORTCUT_ACTIONS`
  - Arquivos permitidos: `src/lib/shortcuts.ts`
- [x] T005 Alvos dos atalhos no Rust (18 → 20)
  - Arquivos permitidos: `src-tauri/src/settings.rs`
- [x] T006 Frases de `shortcut:chatMode` e `shortcut:desktopMode`
  - Arquivos permitidos: `src-tauri/voice-commands.json`
- [x] T007 O que o JARVIS faz quando ouve os atalhos, e as falas
  - Arquivos permitidos: `src/App.tsx`, `src/lib/jarvisLines.ts`
- [x] T008 Catálogo de voz
  - Arquivos permitidos: `.specs/domain/voice-intents.md`
- [x] T009 Comando Tauri `assistant_forget`
  - Arquivos permitidos: `src-tauri/src/lib.rs`, `src-tauri/src/assistant.rs`
- [x] T010 Comando no contrato e na segurança
  - Arquivos permitidos: `.specs/arch/ipc-contract.md`, `.specs/arch/security.md`
- [x] T011 Chaves novas no `localStorage`
  - Arquivos permitidos: `.specs/domain/persistence.md`
- [x] T012 `tests/chat-mode.spec.ts` no `testMatch` do projeto `ui`
  - Arquivos permitidos: `playwright.config.ts`
- [x] T013 Linha na tabela Features do índice
  - Arquivos permitidos: `.specs/README.md`

### Phase 3 — Conversas (US3)

- [x] T014 [US3] Tipos, parser, limites e migração das conversas; `forget` no backend e no fake
  - Aceite: AC-015
  - Arquivos permitidos: `src/lib/assistant.ts`, `src/lib/chatMode.ts`
  - Comando de teste: `npx playwright test tests/chat-mode.spec.ts --project ui`
- [x] T015 [US3] `useAssistant` por conversa: `create`, `select`, `rename`, `remove`, passos e arquivos
  - Aceite: AC-010 a AC-014
  - Arquivos permitidos: `src/hooks/useAssistant.ts`, `src/components/AssistantHistory.tsx`, `src/components/desktop/apps/agent/AgentSession.tsx`
  - Comando de teste: `npx playwright test tests/assistant.spec.ts tests/agent.spec.ts --project ui`

### Phase 4 — Modo e tela (US1, US2, US4)

- [x] T016 [US1] Modo, camada do desktop inerte, botão na barra, `Ctrl+Shift+J`
  - Aceite: AC-001, AC-002, AC-004
  - Arquivos permitidos: `src/App.tsx`, `src/components/Taskbar.tsx`, `src/hooks/useWindowControls.ts`, `src/lib/chatMode.ts`
- [x] T017 [US2] `ChatView`, `ChatSidebar`, `ChatThread`, `ChatComposer`, `CoreAvatar`
  - Aceite: AC-005 a AC-014
  - Arquivos permitidos: `src/components/chat/*`
- [x] T018 [US4] `useChatSpeech`, fala automática e "Ouvir"
  - Aceite: AC-016, AC-017
  - Arquivos permitidos: `src/hooks/useChatSpeech.ts`, `src/components/chat/*`, `src/App.tsx`, `src/components/JarvisReply.tsx` (só exportar o que já existe)

### Phase 5 — Verification

- [x] T019 Ajustar os specs que liam `jarvis.assistant`
  - Arquivos permitidos: `tests/helpers.ts`, `tests/assistant.spec.ts`, `tests/agent.spec.ts`, `tests/feeds.spec.ts`, `tests/personality.spec.ts`, `tests/shortcuts.spec.ts`, `tests/speech.spec.ts`
- [x] T020 Playwright do modo (AC-001 a AC-004)
- [x] T021 Playwright da conversa por texto (AC-005 a AC-009)
- [x] T022 Playwright das conversas (AC-010 a AC-015)
- [x] T023 Playwright da fala (AC-016, AC-017)
  - Arquivos permitidos (T020–T023): `tests/chat-mode.spec.ts`
  - Comando de teste: `npx playwright test tests/chat-mode.spec.ts --project ui`
- [x] T024 `cargo test --lib -- assistant:: settings::`
- [x] T025 Specs tocadas: `assistant`, `keyboard-shortcuts`, `dock-taskbar`

### Phase 6 — Barra lateral recolhível (2026-11-19)

- [x] T026 [US1] `collapsed` nas preferências, o botão e a faixa
  - Aceite: AC-018
  - Arquivos permitidos: `src/lib/chatMode.ts`, `src/components/chat/ChatSidebar.tsx`, `src/components/chat/ChatView.tsx`, `src/App.tsx`
- [x] T027 Playwright da barra recolhida
  - Aceite: AC-018
  - Arquivos permitidos: `tests/chat-mode.spec.ts`, `tests/agent-contacts.spec.ts` (o parser)
  - Evidência: 9 de 9 em 2026-11-19
  - Comando de teste: `npx playwright test tests/chat-mode.spec.ts --project ui`

### Phase 7 — Resposta para as notas (2026-11-19)

- [x] T028 [US2] Menu do botão direito na resposta, salvar e adicionar
  - Aceite: AC-019, AC-020
  - Arquivos permitidos: `src/lib/notesArea.ts`, `src/components/chat/AnswerMenu.tsx`, `src/components/chat/ChatThread.tsx`, `src/components/chat/ChatView.tsx`
- [x] T029 Playwright do menu da resposta
  - Aceite: AC-019, AC-020
  - Arquivos permitidos: `tests/notes-area.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-area.spec.ts --project ui`

## Rollback Plan

1. Desfaça o checklist da Phase 2 ao contrário (atalhos de voz, comando, `testMatch`, docs).
2. Tire o `ChatView`, o botão da barra e o `Ctrl+Shift+J`; apague `src/components/chat/`, `src/hooks/useChatSpeech.ts` e `src/lib/chatMode.ts`.
3. Para voltar à conversa única, restaure `useAssistant.ts` e `assistant.ts`. `jarvis.assistant` nunca foi apagado nem regravado: o histórico de antes da feature volta como estava; o que foi conversado depois fica só em `jarvis.conversations`, que passa a ser ignorada.
4. As chaves `jarvis.chatMode` e `jarvis.conversations` ficam órfãs e são ignoradas.

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P1 — Local e offline | Atendido | Nada novo usa a rede; o Claude Code é a exceção de sempre |
| P2 — Rust dono do nativo | Atendido | Apagar a sessão é um comando Tauri |
| P3 — Comandos finos | Atendido | `assistant_forget` em `lib.rs`, lógica em `assistant.rs`, por `blocking()` |
| P4 — Contratos espelhados | Atendido | `forget` em `AssistantBackend`; sem tipos novos no IPC |
| P5 — Persistência tolerante | Atendido | `parseChatMode`, `parseConversations` e migração explícita |
| P6 — Fora do Tauri | Atendido | Fake `__JARVIS_ASSISTANT__` com `forgets`; sem ele, "Disponível no app desktop" |
| P7 — PT-BR | Atendido | UI e falas em PT-BR; código e testes em inglês |
| P8 — Linguagem visual | Atendido, com uma paleta própria | As cores continuam só no tema (`globals.css`): o chat troca os tokens `hud-*` pela paleta de mensageiro (`.chat-skin`) e ganha quatro tokens `chat-*`. A paleta do chat não acompanha o tema escolhido no desktop (KL-008) |
| P9 — Desktop leve | Atendido | Chat em chunk próprio; núcleo e widgets pausados sob o chat |
| P10 — Confinamento | Atendido | Mesmo `claude.exe` confinado; `assistant_forget` valida o id |
| P11 — Testes | Atendido | `tests/chat-mode.spec.ts` no `testMatch`, 9 testes; lacunas em Coverage Gaps |
| P12 — README mínimo | Atendido | Tudo em `.specs` |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | Conferido no app real em 2026-11-19 (build de release, por CDP, com o Claude Code de verdade): `Ctrl+Shift+J`, o modo lembrado, pergunta digitada e respondida, a pergunta seguinte retomando a sessão da própria conversa, e `assistant_forget` tirando os dois `.jsonl` de `~/.claude/projects`. Numa segunda rodada no mesmo dia, com o build final: o botão da barra superior, nos dois sentidos, e o microfone do campo de mensagem (o botão foi de "Falar com o JARVIS" a "Ouvindo · clique para enviar", a "Transcrevendo…" e de volta, com o Whisper baixado; sem fala no ambiente, nada foi enviado). Numa terceira rodada: a fala real virando mensagem (o microfone aberto pelos testes captou a conversa do ambiente; o Whisper a transcreveu e cada trecho entrou como pergunta na conversa ativa, com resposta); os atalhos de voz, entregando ao app o evento `voice:shortcut` que o reconhecedor emite (`desktopMode` saiu do chat, `chatMode` voltou, repetido no chat ficou no chat, nenhuma conversa criada); e a fala das respostas, com a voz Piper Miro baixada para o teste (21 MB, ficou instalada): "Falar as respostas" habilitou, "Ouvir" virou "Parar de ouvir" e voltou ao fim da fala, e com a fala automática ligada uma resposta nova foi falada sozinha. As frases faladas foram conferidas com áudio de verdade, sem o microfone: três gravações de voz ("modo chat", "modo desktop", "Jarvis, modo chat", em `src-tauri/tests/fixtures/`) passam pelo detector de voz, pelo Whisper da máquina (large-v3-turbo) e pelo reconhecedor no teste `speech_chat_and_desktop_modes`, que deu `chatMode` e `desktopMode` (e `chatMode` depois da palavra de ativação). Único trecho não conferido de ponta a ponta numa só execução: essas duas frases entrando pelo microfone físico ; cada parte do caminho (microfone → Whisper, áudio → Whisper → atalho, atalho → app) foi conferida em separado. Uma última tentativa tocou as gravações em todas as saídas de som da máquina com o microfone aberto (e com uma resposta longa em andamento na conversa ativa, para o app recusar qualquer pergunta falada: nada do que foi captado virou pergunta): o microfone não ouviu, porque as saídas desta máquina são o fone do próprio HyperX QuadCast e uma saída digital, sem alto-falante ao alcance dele. Fechado pelo usuário em 2026-11-19, com a própria voz no app real: "modo desktop", dito segurando o microfone do campo de mensagem, saiu do chat, e "modo chat", dito segurando o núcleo no desktop, voltou para ele. O menu da resposta também foi conferido no app real, no disco: "Salvar como nova nota" numa resposta existente criou `Notas\Alô Jarvis, você consegue me ouvir.md` com o título e a resposta, e "Adicionar à nota…" pôs a resposta no fim de uma nota de teste, depois do que ela tinha; as duas notas foram removidas em seguida. | Verificado no app |
| KL-002 | `jarvis.conversations` pode chegar a 50 conversas de 200 respostas longas e passar da cota do `localStorage`; a gravação falha em silêncio (`quotaExceeded` não é mostrado), e o que não coube se perde ao fechar. | Risco conhecido |
| KL-003 | Se `assistant_forget` falhar, a conversa sai da lista e a transcrição fica no disco, sem nova tentativa. O erro aparece uma vez no aviso. | Comportamento atual |
| KL-004 | A fala automática do chat começa quando a resposta termina, não frase a frase como no núcleo. | Decisão de escopo |
| KL-005 | O que o JARVIS abre durante uma resposta no chat (nota no Jarvis Mark, widget de tarefas) abre no desktop, atrás do chat, e só é visto ao voltar. A saudação do boot e o "papai chegou" também acontecem atrás do chat. | Decisão de produto (nada troca de modo sozinho) |
| KL-006 | Sem anexos: o JARVIS só lê o que já está em `Documentos\JARVIS`. | Fora de escopo |
| KL-008 | O chat tem uma paleta só (a do mensageiro de referência): o tema e a matiz escolhidos nas Configurações valem para o desktop, não para o chat. | Decisão de produto (2026-11-19) |
| KL-009 | A resposta vai para a nota como texto: os passos, os arquivos escritos e as fontes ("Consultou:") não vão junto, nem a pergunta (só no nome da nota nova). A nota nova nasce na raiz de `Notas`. | Decisão de escopo |
| KL-007 | Fora do StrictMode (produção), a migração do histórico antigo só é gravada em `jarvis.conversations` na primeira mudança; até lá é refeita a cada abertura, com o mesmo resultado. | Comportamento atual |

## Open Questions

Nenhuma. As decisões de produto foram tomadas com o usuário em 2026-11-19 e estão no Overview, no Scope e nos requisitos.

## References

- Referência visual: `.inspo/chat.png`.
- Template: `.specs/_templates/feature.md`; modelo pronto: [reminders](../reminders/spec.md).
