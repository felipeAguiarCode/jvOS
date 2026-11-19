# Feature Specification: Área de notas

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/notes-area` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Plano escrito em 2026-11-19, antes do código, e fechado no mesmo dia com o que foi construído; o ditado por voz (US5) entrou depois, no mesmo dia, a pedido do usuário; sem decisões em aberto |
| Source Commit | não commitado |
| Uncommitted Changes | Tudo: feature nova |
| Voice Shortcut | — |
| Assistant Tool | — (o JARVIS já escreve nessa pasta com `Write`/`Edit`) |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web) usa os fakes `window.__JARVIS_FS__` e `window.__JARVIS_ASSISTANT__` em DEV e, sem eles, avisa "Disponível no app desktop" |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-19 |
| Verification Scope | Conferido com o código em 2026-11-19: `src/lib/notesArea.ts`, `src/hooks/useNotes.ts`, `src/components/chat/NotesList.tsx`, `NotesPanel.tsx`, `ChatView.tsx`, `ChatSidebar.tsx`, `src/lib/chatMode.ts`, `src/App.tsx`, `src-tauri/src/lib.rs` (`assistant_folder`). Testes rodados: `npx tsc --noEmit` sem erros; `tests/notes-area.spec.ts` 6 de 6 e `tests/chat-mode.spec.ts` 8 de 8. O app real ainda não foi conferido: KL-001 |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os IDs começam em US1, RF-001, RNF-001, SC-001, AC-001 e T001. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

Segunda fase do [modo chat](../chat-mode/spec.md). O JARVIS já guarda notas em Markdown em `Documentos\JARVIS\Notas` ("anota que…", pesquisas, resumos), mas elas só abriam uma a uma no Jarvis Mark. A área de notas é uma seção do modo chat, ao lado das conversas, no estilo do Apple Notes: a lista das notas com busca à esquerda e o editor à direita. O usuário e o agente trabalham sobre o mesmo acervo, e o que o JARVIS escreve aparece na lista na hora.

| Input | Expected Behavior | Execution Path |
|---|---|---|
| Clicar em "Notas" na barra lateral do chat | A lista das notas toma o lugar das conversas e o editor toma o lugar dos balões | Local (`jarvis.chatMode.section`) |
| Clicar numa nota | Ela abre no editor | `workspace_read` |
| Digitar no editor | A nota é salva sozinha depois de 800 ms sem digitar | `workspace_write` |
| "Nova nota" | Uma nota "Sem título" é criada e aberta, com o título selecionado | `workspace_create` |
| Mudar o título | O arquivo é renomeado | `workspace_rename` |
| "Apagar nota" → confirmar | O arquivo vai para a Lixeira | `workspace_delete` |
| O JARVIS escreve uma nota | Ela aparece na lista (ou se atualiza no editor, se não houver edição pendente) | Evento `workspace:changed` |
| Segurar "Ditar" no cabeçalho da nota e falar | O que foi dito entra no texto, no cursor, e é salvo como qualquer edição | `voice_dictate` (Whisper local) → `voice:dictation` |
| "Abrir" no cartão de uma nota, numa conversa | A nota abre na área de notas, sem sair do chat | Local |

## Goals and Success Criteria

### Goals

- Ler, buscar, escrever e organizar as notas sem sair do modo chat.
- Um acervo só: o que o usuário edita e o que o JARVIS escreve são os mesmos arquivos `.md`.
- Não perder texto: salvar sozinho e avisar quando a nota mudou no disco.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Uma edição chega ao disco sem o usuário mandar salvar | `tests/notes-area.spec.ts` — "a note opens, is edited and saves itself; the preview renders it" |
| SC-002 | Uma nota escrita fora do editor aparece sem recarregar | `tests/notes-area.spec.ts` — "what JARVIS writes shows up at once; an edit in progress is never overwritten" |

## Scope and Non-Goals

### In Scope

- A seção "Notas" do modo chat: lista (título, trecho, data), busca no título e no texto, ordem pela última alteração.
- Editor de Markdown (o mesmo CodeMirror do Jarvis Mark) com três visões: escrever, dividir e ler.
- Salvar sozinho, criar, renomear pelo título e apagar para a Lixeira.
- Atualização ao vivo pelo observador da pasta, e o aviso de conflito.
- O cartão de arquivo de uma conversa abre a nota aqui.

### Out of Scope

- Links `[[nota]]`, `#tags` e o grafo: [notes-graph](../notes-graph/spec.md) (Fase 3).
- Subpastas: `Notas\` é plana, como o JARVIS a usa. Arquivos em subpastas não são listados.
- Arquivos que não são `.md`.
- Fixar, cores, anexos e imagens.
- Mudar o Jarvis Mark: ele continua abrindo arquivos pelo diálogo e pelo canal de notas.

## User Stories

### US1 — Navegar e buscar

**Priority:** P1.

**User Story:** Como usuário, quero ver todas as minhas notas numa lista, com busca, para achar o que o JARVIS e eu anotamos.

**Why This Priority:** sem a lista não há área de notas.

**Independent Test:** `tests/notes-area.spec.ts` — "the notes are listed newest first and searched by title and text".

**Acceptance Criteria:** AC-001, AC-002 e AC-003.

### US2 — Escrever

**Priority:** P1.

**User Story:** Como usuário, quero abrir uma nota, editar e vê-la salva sozinha, para escrever sem pensar em arquivos.

**Why This Priority:** é o uso principal.

**Independent Test:** `tests/notes-area.spec.ts` — "a note opens, is edited and saves itself; the preview renders it".

**Acceptance Criteria:** AC-004, AC-005 e AC-006.

### US3 — Organizar

**Priority:** P2.

**User Story:** Como usuário, quero criar, renomear e apagar notas, para manter o acervo em ordem.

**Why This Priority:** completa o ciclo, mas ler e editar já entregam valor.

**Independent Test:** `tests/notes-area.spec.ts` — "notes are created, renamed by their title and deleted to the Recycle Bin".

**Acceptance Criteria:** AC-007, AC-008 e AC-009.

### US4 — Acompanhar o agente

**Priority:** P2.

**User Story:** Como usuário, quero ver na hora as notas que o JARVIS escreve, sem perder o que estou digitando, para trabalhar junto com o agente.

**Why This Priority:** é o que torna o acervo compartilhado.

**Independent Test:** `tests/notes-area.spec.ts` — "what JARVIS writes shows up at once; an edit in progress is never overwritten".

**Acceptance Criteria:** AC-010, AC-011 e AC-012.

### US5 — Ditar na nota

**Priority:** P2.

**User Story:** Como usuário, quero segurar um botão e falar para o texto entrar na nota, para anotar sem digitar.

**Why This Priority:** pedido do usuário em 2026-11-19; o reconhecimento já existe (o ditado do Jarvis Mark).

**Independent Test:** `tests/notes-area.spec.ts` — "dictated words land at the cursor of the open note and are saved".

**Acceptance Criteria:** AC-013 e AC-014.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | A barra lateral do chat DEVE ter as seções "Conversas" e "Notas"; a escolhida fica guardada em `jarvis.chatMode` (`section`). | US1 |
| RF-002 | A lista DEVE mostrar os arquivos `.md` que estão diretamente em `Documentos\JARVIS\Notas`, da alteração mais recente para a mais antiga, com título (o nome do arquivo sem `.md`), um trecho do texto (a primeira linha de texto que não é um cabeçalho `#`, sem marcas de Markdown, até 80 caracteres; numa nota só de cabeçalhos, o primeiro que não repete o título) e a data. Desde 2026-11-19 a lista é uma árvore com as subpastas, em ordem alfabética, sem trecho nem hora (RF-018, RF-019); a nota que abre sozinha continua sendo a de alteração mais recente. | US1 |
| RF-003 | A busca DEVE filtrar pelo título e pelo texto, sem diferenciar maiúsculas nem acentos. | US1 |
| RF-004 | Abrir uma nota DEVE mostrá-la no editor de Markdown, com as visões "Escrever", "Dividir" e "Ler" (a escolhida fica em `jarvis.notesArea`). A leitura usa `MARKDOWN_COMPONENTS`. | US2 |
| RF-005 | Uma edição DEVE ser salva sozinha 800 ms depois da última tecla, e também ao trocar de nota, de seção ou de modo. O estado aparece no cabeçalho: "Salvando…", "Salvo" ou o erro. | US2 |
| RF-006 | Salvar DEVE manter a codificação e o fim de linha do arquivo, e conferir o carimbo (`Stamp`) da última leitura: se o arquivo mudou no disco, nada é sobrescrito e aparece "A nota mudou no disco", com "Recarregar" e "Manter a minha". | US2, US4 |
| RF-007 | "Nova nota" DEVE criar `Sem título.md` (ou `Sem título 2.md`, `3`…, o primeiro nome livre), abri-la e pôr o foco no título, selecionado. | US3 |
| RF-008 | Mudar o título (Enter ou sair do campo) DEVE renomear o arquivo para `<título>.md`. Caracteres que o Windows não aceita (`\ / : * ? " < > |`) e os de controle são tirados; o título é limitado a 80 caracteres. Título vazio ou igual ao de outra nota não renomeia e mostra o motivo. | US3 |
| RF-009 | "Apagar nota" DEVE pedir confirmação e mandar o arquivo para a Lixeira. A próxima nota da lista abre no lugar. | US3 |
| RF-010 | A área DEVE observar a pasta (`workspace_open` + `workspace:changed`): nota nova, alterada ou apagada por fora atualiza a lista. A nota aberta, se não tiver edição pendente, é recarregada; se tiver, vale RF-006. | US4 |
| RF-011 | O botão "Abrir" do cartão de um arquivo de `Notas\`, numa conversa, DEVE abrir a nota na área de notas, sem sair do modo chat. Arquivos de `Agentes\` continuam indo para o jv_agent, no desktop. | US4 |
| RF-013 | O cabeçalho da nota DEVE ter o botão "Ditar (segure para falar)", o mesmo do Jarvis Mark ([dictation](../dictation/spec.md)): enquanto é segurado (ponteiro, Espaço ou Enter), o motor de voz grava; ao soltar, o Whisper transcreve e o texto entra na nota. O estado aparece no cabeçalho: "Ditando… solte para inserir" e "Transcrevendo…". Fora do app desktop o botão fica desabilitado, com a dica "Disponível no app desktop". | US5 |
| RF-014 | O texto ditado DEVE entrar na posição do cursor do editor, com um espaço antes se o caractere anterior não for espaço e um espaço depois; na visão "Ler" (sem editor), entra no fim da nota. Ele conta como uma edição: é salvo sozinho (RF-005) e respeita o conflito (RF-006). Sem fala, nada é inserido. | US5 |
| RF-015 | O texto ditado DEVE chegar só ao editor que estava na tela quando foi dito: no modo chat, à nota aberta na área de notas; no modo desktop, ao Jarvis Mark. Um não recebe o ditado do outro, nem depois, ao voltar à tela. Um editor aberto depois de um ditado não o recebe (isso valia também para o Jarvis Mark sozinho: reabri-lo inseria de novo o último ditado; corrigido junto). | US5 |
| RF-016 | O botão direito do mouse (ou a tecla de menu) numa nota da lista DEVE abrir um menu com "Abrir no Explorer", que mostra o arquivo da nota selecionado no gerenciador de arquivos do sistema (`workspace_reveal`, o mesmo comando do jv_ide). Esc, um clique fora ou a janela perder o foco fecham o menu. Se falhar, o motivo aparece no topo da lista. Pedido do usuário em 2026-11-19. | US1 |
| RF-017 | As notas fora da área visível da lista NÃO DEVEM pesar no desenho da página (`content-visibility: auto` em cada item, com 64 px de altura reservada): com 400 notas, a lista custava 50 ms por segundo da thread principal enquanto o grafo girava ao lado. | US1 |
| RF-018 | As notas PODEM ficar em pastas e subpastas de `Notas`: a lista DEVE mostrar a árvore inteira (pastas ocultas e arquivos que não são `.md` ficam de fora; no máximo 200 pastas), como o explorador de um editor de código. Pedido do usuário em 2026-11-19. | US1 |
| RF-019 | A árvore DEVE seguir o explorador do tema Origamid Next do VS Code (referência dada pelo usuário em 2026-11-19, que substituiu o ícone do Markdown pedido antes): um cabeçalho "NOTAS" em maiúsculas com os ícones de ação em traço fino ("Nova nota", "Nova pasta", "Atualizar notas", "Recolher pastas"); cada linha com 28 px; uma pasta só com a seta (para a direita fechada, para baixo aberta) e o nome em cinza, sem ícone de pasta; uma nota com um traço curto colorido no lugar do ícone e o título. Em cada nível, primeiro as pastas e depois as notas, em ordem alfabética (números em ordem numérica, sem diferenciar maiúsculas). As pastas fechadas ficam guardadas em `jarvis.notesArea` (`closed`); "Recolher pastas" fecha todas e "Atualizar notas" lê a pasta de novo. Nenhum arquivo do tema é copiado: só a aparência serve de referência. | US1 |
| RF-020 | Com texto na busca, a árvore DEVE dar lugar à lista das notas encontradas em qualquer pasta, cada uma com a sua pasta ao lado do título. | US1 |
| RF-021 | "Nova nota" e "Nova pasta" (botões no topo) DEVEM criar na pasta da nota aberta (na raiz, se ela está na raiz); o menu do botão direito numa pasta tem "Nova nota aqui", "Nova pasta aqui", "Renomear", "Abrir no Explorer" e "Apagar pasta" (que pede confirmação no próprio menu e manda a pasta, com o que tem dentro, para a Lixeira). Uma pasta nova se chama "Nova pasta" (2, 3…) e entra já com o nome em edição. Renomear a nota pelo título mantém a pasta dela. | US4 |
| RF-022 | Renomear ou apagar uma pasta DEVE acompanhar a nota aberta: se ela está dentro, passa a apontar para o caminho novo, ou sai da tela se foi apagada. | US4 |
| RF-012 | `assistant_folder` DEVE garantir que `Notas\` e `Agentes\` existem antes de devolver os caminhos (até aqui elas só eram criadas na primeira subida do Claude Code). | US1 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | Nenhum comando Rust novo: a área usa `assistant_folder` e os `workspace_*` do jv_ide, com a raiz em `Notas\`. | Backend |
| RNF-002 | O editor (CodeMirror) carrega sob demanda, em chunk próprio, só quando a seção Notas é aberta. | `NotesPanel` |
| RNF-003 | O texto das notas é lido em segundo plano depois da lista, 4 arquivos por vez; a lista aparece antes, só com títulos e datas. Arquivos maiores que 5 MB ou binários ficam na lista sem trecho e não abrem para edição. | Leitura |
| RNF-004 | `jarvis.notesArea` é gravado com debounce de 250 ms e relido por parser tolerante. | Persistência |

### Operational Constraints

- A pasta é a de `assistant_folder().notes`; fora do app desktop não há pasta.
- Salvar sozinho: 800 ms (`SAVE_DELAY_MS`). Título: até 80 caracteres.
- A busca é feita na UI, sobre o texto já lido: não usa `workspace_search`, que é compartilhado com o jv_ide.
- Textos e rótulos em PT-BR.

## Acceptance Criteria

### AC-001 — List the Notes

**Related Story:** US1.

- **Given** a pasta de notas com três arquivos `.md`, um `.txt` e uma subpasta
- **When** o usuário abre a seção "Notas"
- **Then** a lista mostra as três notas, da mais recente para a mais antiga, cada uma com título, trecho e data.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "the notes are listed newest first and searched by title and text".

### AC-002 — Search by Title and Text

**Related Story:** US1.

- **Given** a lista de notas
- **When** o usuário digita na busca uma palavra que só existe no texto de uma nota, sem acento
- **Then** só essa nota fica na lista; com a busca vazia, todas voltam.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "the notes are listed newest first and searched by title and text".

### AC-003 — Outside the Desktop App

**Related Story:** US1.

- **Given** o app no navegador, sem os fakes
- **When** o usuário abre a seção "Notas"
- **Then** aparece "Disponível no app desktop" e nenhuma lista.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "in a browser the notes say they need the desktop app".

### AC-004 — Open and Edit With Autosave

**Related Story:** US2.

- **Given** uma nota aberta
- **When** o usuário digita e para por 800 ms
- **Then** o arquivo no disco tem o texto novo e o cabeçalho mostra "Salvo".

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "a note opens, is edited and saves itself; the preview renders it".

### AC-005 — Read the Rendered Note

**Related Story:** US2.

- **Given** uma nota com um título `#` e uma lista
- **When** o usuário escolhe a visão "Ler"
- **Then** o Markdown aparece renderizado (um `h1` e os itens), e a escolha continua depois de recarregar.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "a note opens, is edited and saves itself; the preview renders it".

### AC-006 — Save Before Leaving

**Related Story:** US2.

- **Given** uma edição feita há menos de 800 ms
- **When** o usuário abre outra nota
- **Then** a primeira é salva antes de a segunda abrir.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "a note opens, is edited and saves itself; the preview renders it".

### AC-007 — Create a Note

**Related Story:** US3.

- **Given** a seção "Notas", com uma nota "Sem título" já existente
- **When** o usuário clica em "Nova nota"
- **Then** `Sem título 2.md` é criada, aparece no topo da lista e abre com o título em foco.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "notes are created, renamed by their title and deleted to the Recycle Bin".

### AC-008 — Rename by the Title

**Related Story:** US3.

- **Given** uma nota aberta
- **When** o usuário troca o título para `Plano: fase 2?` e pressiona Enter
- **Then** o arquivo passa a se chamar `Plano fase 2.md`; um título já usado por outra nota não renomeia e mostra "Já existe uma nota com esse nome".

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "notes are created, renamed by their title and deleted to the Recycle Bin".

### AC-009 — Delete a Note

**Related Story:** US3.

- **Given** uma nota aberta
- **When** o usuário clica em "Apagar nota" e confirma
- **Then** o arquivo vai para a Lixeira, sai da lista e a próxima nota abre; cancelar não apaga.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "notes are created, renamed by their title and deleted to the Recycle Bin".

### AC-010 — Show What JARVIS Writes

**Related Story:** US4.

- **Given** a seção "Notas" aberta
- **When** um arquivo `.md` é criado na pasta por fora
- **Then** ele aparece na lista sem recarregar.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "what JARVIS writes shows up at once; an edit in progress is never overwritten".

### AC-011 — Reload an Untouched Note

**Related Story:** US4.

- **Given** uma nota aberta, sem edição pendente
- **When** o arquivo muda por fora
- **Then** o editor mostra o texto novo.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "what JARVIS writes shows up at once; an edit in progress is never overwritten".

### AC-012 — Never Overwrite on a Conflict

**Related Story:** US4.

- **Given** uma nota aberta com edição pendente
- **When** o arquivo muda por fora e o salvamento é tentado
- **Then** nada é gravado e aparece "A nota mudou no disco"; "Recarregar" traz o texto do disco e "Manter a minha" grava o do editor.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "what JARVIS writes shows up at once; an edit in progress is never overwritten".

### AC-013 — Dictate Into the Note

**Related Story:** US5.

- **Given** uma nota aberta com o cursor no fim do texto
- **When** chega um ditado com o texto "mais uma linha"
- **Then** a nota passa a terminar com " mais uma linha ", e o arquivo no disco também, depois do salvamento automático.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "dictated words land at the cursor of the open note and are saved".

### AC-014 — Only Where It Is on Screen

**Related Story:** US5.

- **Given** o Jarvis Mark aberto no desktop com um texto, e o app no modo chat com uma nota aberta
- **When** chega um ditado
- **Then** o texto entra na nota e o Jarvis Mark continua como estava, também quando ele é aberto ou volta à tela depois; no navegador, o botão "Ditar" da nota está desabilitado.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "dictated words land at the cursor of the open note and are saved".

### AC-015 — Open a Note in the File Manager

**Related Story:** US1.

- **Given** a lista de notas
- **When** o usuário clica com o botão direito em "Ideias" e escolhe "Abrir no Explorer"
- **Then** o sistema é chamado a mostrar `Notas\Ideias.md` e o menu fecha; Esc fecha o menu sem chamar nada.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "folders fold, are made, renamed and deleted; a right click shows a note in the Explorer".

### AC-016 — Folders as a Tree

**Related Story:** US1.

- **Given** `Notas` com `Ideias.md`, a pasta `Arquivo` com `velha.md` e, dentro dela, `2025\antiga.md`
- **When** a seção Notas abre
- **Then** a árvore mostra a pasta Arquivo (aberta) antes das notas da raiz, com `2025` e `velha` dentro; fechar Arquivo esconde o que tem dentro e isso continua depois de recarregar; buscar "antiga" mostra a nota com "Arquivo/2025" ao lado.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "folders fold, are made, renamed and deleted; a right click shows a note in the Explorer".

### AC-017 — Create, Rename and Delete Folders

**Related Story:** US4.

- **Given** a nota `Arquivo\velha.md` aberta
- **When** o usuário usa "Nova pasta", digita "Projetos" e confirma; depois cria uma nota com "Nova nota"; depois renomeia a pasta Arquivo para "Guardado"
- **Then** `Arquivo\Projetos` existe no disco, a nota nova nasce em `Arquivo`, e depois de renomear a nota aberta continua aberta em `Guardado`; "Apagar pasta" só apaga depois de confirmado.

**Coverage Status:** coberto — `tests/notes-area.spec.ts` — "folders fold, are made, renamed and deleted; a right click shows a note in the Explorer".

## Behavior and Flows

### Regras (`src/lib/notesArea.ts`)

- **Behavior:** funções puras e as preferências.
  - `noteTitle(path)`: o nome do arquivo sem `.md`.
  - `noteFileName(title)`: tira `\ / : * ? " < > |` e os caracteres de controle, junta os espaços, corta em 80 caracteres e tira pontos e espaços do fim; vazio devolve `null` (RF-008).
  - `noteExcerpt(content, title)`: a primeira linha de texto que não é cabeçalho, sem marcas de Markdown, até 80 caracteres; sem nenhuma, o primeiro cabeçalho que não repete o título (RF-002).
  - `matchesNote(note, query)`: a busca (RF-003), com `normalize` de `src/lib/search.ts`.
  - `untitledName(existing)`: `Sem título`, `Sem título 2`… (RF-007).
  - `useNotesAreaPrefs`: `{ view }` em `jarvis.notesArea` (RF-004).

### `useNotes` (`src/hooks/useNotes.ts`)

- **Behavior:**
  - Pede `assistantFolder()` e `loadWorkspaceBackend()`. Sem um dos dois, o estado é `unavailable` (AC-003).
  - `open(notes)` começa a observar; `list(notes, "")` dá os arquivos; ficam os `.md` de primeiro nível (RF-002).
  - Os textos são lidos depois, 4 por vez (RNF-003), para o trecho e a busca.
  - `onChanged` da raiz: relista e relê os caminhos alterados (RF-010). `rescan` relê tudo.
  - `read(path)` devolve texto, codificação, fim de linha e carimbo. `save` chama `write` com o carimbo esperado e devolve o novo, ou lança `file-changed` (RF-006). `create`, `rename` e `remove` chamam os comandos e atualizam a lista sem esperar o observador.
  - Ao desmontar, fecha a raiz (`close`).

### `NotesList` (na barra lateral)

- **Behavior:** busca, "Nova nota" e a lista; a nota aberta fica marcada (`aria-current`). Lista vazia: "Nenhuma nota ainda"; busca sem resultado: "Nenhuma nota encontrada".
- **Layout:** ocupa os mesmos 280 px da lista de conversas, sob o seletor de seção.

### `NotesPanel` (`src/components/chat/NotesPanel.tsx`)

- **Behavior:**
  - Cabeçalho: o título num campo (RF-008), o estado do salvamento (RF-005), as três visões (RF-004) e "Apagar nota" (RF-009).
  - Corpo: `CodeMirror` com a linguagem Markdown e quebra de linha, e/ou a leitura renderizada.
  - Guarda o texto, o carimbo, a codificação e o fim de linha da nota aberta; `dirty` enquanto há edição não salva.
  - Troca de nota, de seção ou de modo: salva antes (AC-006).
  - Conflito: a barra "A nota mudou no disco" (RF-006).
  - Ditado: o botão `DictationButton` (extraído do Jarvis Mark para `desktop/apps/DictationButton.tsx`) e `useDictation()`. Cada `DictationText` novo (pelo `id`) é inserido uma vez: no cursor do CodeMirror, ou no fim do texto sem editor (RF-014). O `App` guarda em que modo cada ditado chegou e entrega o texto só ao contexto desse modo (RF-015); os dois editores partem do `id` do ditado que já existia ao montar, para não inserir um ditado antigo.
  - Sem nota aberta: "Escolha uma nota ou crie uma nova".
- **Style:** os mesmos tokens do chat; o editor usa `hudTheme`.

### Interaction Flow

1. O usuário escolhe "Notas" na barra lateral: a lista carrega e a nota mais recente abre.
2. Ele digita; 800 ms depois a nota é salva e o cabeçalho mostra "Salvo".
3. Numa conversa, pede ao JARVIS uma pesquisa; ao voltar a "Notas", a nota nova está no topo.

### User Feedback

| Situation | Feedback |
|---|---|
| Lista carregando | "Carregando notas…" |
| Fora do app desktop | "Disponível no app desktop" |
| Salvando / salvo / erro | "Salvando…", "Salvo", ou a mensagem do erro em `text-hud-alert` |
| Conflito | "A nota mudou no disco" com "Recarregar" e "Manter a minha" |
| Título inválido ou repetido | "Dê um nome à nota" / "Já existe uma nota com esse nome" |

### Voice and Keyboard

- Sem atalho de voz próprio: "anota que…" e as pesquisas do JARVIS continuam escrevendo na pasta.
- No título: Enter renomeia e leva o foco ao editor; Esc desfaz. No editor valem as teclas do CodeMirror.

## Data Model and Persistence

### NotesAreaPrefs

```ts
interface NotesAreaPrefs {
  /** "write": only the editor; "split": editor and rendered note; "read": only the rendered note. */
  view: "write" | "split" | "read";
}
```

### Note (em memória)

```ts
interface Note {
  /** Relative to the notes folder: "2026-11-19 Fatura.md". */
  path: string;
  title: string;
  modified: number;
  size: number;
  /** null until read (or when it cannot be: binary, too large). */
  content: string | null;
}
```

### Storage Rules

| Property | Value |
|---|---|
| State | `$visão` (`jarvis.notesArea`); `$seção` (`section` em `jarvis.chatMode`) |
| Storage | `localStorage` para as preferências; as notas são arquivos `.md` em `Documentos\JARVIS\Notas` |
| Write Debounce | 250 ms nas preferências; 800 ms no salvamento da nota |
| Reader | `parseNotesArea`: visão desconhecida vira `split` |
| Missing or Invalid Storage | Visão `split`, seção `conversations` |

Ver [persistência](../../domain/persistence.md).

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src/lib/notesArea.ts` | Regras puras e preferências |
| `src/hooks/useNotes.ts` | A pasta: lista, textos, observador, ler, salvar, criar, renomear, apagar (novo) |
| `src/components/chat/NotesList.tsx` | A lista na barra lateral (novo) |
| `src/components/chat/NotesPanel.tsx` | Cabeçalho, editor e leitura (novo, lazy) |
| `src/components/chat/ChatView.tsx`, `ChatSidebar.tsx` | Seletor de seção; a lista e o painel de notas no lugar das conversas |
| `src/lib/chatMode.ts` | `section` em `ChatModePrefs` |
| `src/App.tsx` | "Abrir" de uma nota leva à seção de notas; o `DictationContext` do chat e a quem o ditado chega |
| `src/components/desktop/apps/DictationButton.tsx` | O botão de ditar, compartilhado com o Jarvis Mark (novo; saiu de `MarkdownEditor.tsx`) |
| `src-tauri/src/lib.rs` | `assistant_folder` cria `Notas\` e `Agentes\` |
| `tests/notes-area.spec.ts` | Testes |

### Related Architecture Decisions

- [ADR-0007 — O JARVIS fica confinado a `Documentos\JARVIS`](../../arch/adr/0007-jarvis-confinado-a-documentos.md): a área só enxerga `Notas\`.
- [ADR-0010 — Persistência](../../arch/adr/0010-persistencia-settings-vs-localstorage.md): notas são arquivos Markdown, não `localStorage`.
- [ADR-0011 — Fakes de desenvolvimento](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md): `__JARVIS_FS__`.
- [ADR-0012 — Apps carregados sob demanda](../../arch/adr/0012-apps-lazy-com-preload.md): o painel é lazy.

## Interfaces and Contracts

### Tauri Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `assistant_folder` | — | `Folder` | Passa a criar `Notas\` e `Agentes\` (RF-012) e a rodar por `blocking()` |
| `workspace_open`, `workspace_close`, `workspace_list`, `workspace_read`, `workspace_write`, `workspace_create`, `workspace_rename`, `workspace_delete` | como no [ipc-contract](../../arch/ipc-contract.md) | idem | Usados como estão, com `root` = pasta de notas |

### Events and Channels

| Event | Payload | Notes |
|---|---|---|
| `workspace:changed` | `ChangedEvent` | Filtrado pela raiz de notas |

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| Pasta vazia | "Nenhuma nota ainda" e o convite para criar | `NotesList` |
| Título vazio ou só com caracteres inválidos | Não renomeia; "Dê um nome à nota" | RF-008 |
| Título igual ao de outra nota (sem diferenciar maiúsculas) | Não renomeia; "Já existe uma nota com esse nome" | RF-008 |
| Duas "Nova nota" seguidas | `Sem título.md`, `Sem título 2.md` | RF-007 |
| A nota aberta é apagada por fora | Sai da lista e do editor, e a nota mais recente abre no lugar. Uma edição pendente tenta ser salva ao sair e recria o arquivo (o carimbo antigo não confere: o Rust responde `file-changed`; ver KL-003) | RF-010 |
| Arquivo binário ou maior que 5 MB | Na lista, sem trecho; ao abrir, "Esta nota não pode ser aberta aqui" | RNF-003 |
| Salvar falha (disco, permissão) | O erro no cabeçalho; o texto fica no editor e a próxima tecla tenta de novo | RF-005 |
| O Jarvis Mark (desktop) e a área de notas com a mesma nota | Cada um salva com o seu carimbo; o segundo a salvar recebe o conflito | RF-006, KL |
| Permissões | Os caminhos passam pelas guardas do workspace: nada fora de `Notas\` | RNF-001 |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [chat-mode](../chat-mode/spec.md) | A barra lateral, o modo e o cartão de arquivo |
| [jv_ide](../../apps/jv_ide/spec.md) | Os comandos `workspace_*` e o fake |
| [jarvis-mark](../../apps/jarvis-mark/spec.md) | `CodeMirror`, `editorBasics`, `MARKDOWN_COMPONENTS` |
| [quick-notes](../quick-notes/spec.md) | Quem escreve as anotações do dia |

### Runtime Dependencies

- [CodeMirror](../../foundation/vendor/codemirror/spec.md), [Markdown](../../foundation/vendor/markdown/spec.md), [workspace-fs](../../foundation/vendor/workspace-fs/spec.md)

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/notes-area.spec.ts` — "notes-area helpers" | Regras puras e o parser | RF-002, RF-003, RF-007, RF-008 |
| `tests/notes-area.spec.ts` — "the notes are listed newest first and searched by title and text" | Lista, trecho, busca, a seção lembrada | AC-001, AC-002 |
| `tests/notes-area.spec.ts` — "in a browser the notes say they need the desktop app" | Fora do app | AC-003 |
| `tests/chat-mode.spec.ts` — "a typed question is answered in a bubble, with the agent's steps and the file it wrote" | "Abrir" do cartão mostra a nota na seção Notas | RF-011 |
| `tests/notes-area.spec.ts` — "folders fold, are made, renamed and deleted; a right click shows a note in the Explorer" | A árvore com subpastas; fechar uma pasta, e isso mantido ao recarregar; a busca dentro de pastas fechadas, com a pasta ao lado; o menu da nota (Esc fecha, "Abrir no Explorer" chama o sistema); "Nova pasta" e "Nova nota" ao lado da nota aberta; renomear a nota mantém a pasta; o menu da pasta; renomear a pasta leva a nota aberta junto; nome repetido recusado; apagar só depois de confirmar; "Recolher pastas" e "Atualizar notas" | AC-015, AC-016, AC-017 |
| `tests/notes-area.spec.ts` — "notes-area helpers" | `noteFolder`, `noteRows` (ordem, pastas fechadas, pasta conhecida só pela nota, busca plana), `closed` no parser | RF-018 a RF-020 |
| `tests/notes-area.spec.ts` — "dictated words land at the cursor of the open note and are saved" | Botão desabilitado no navegador; ditado no cursor, no meio da linha e no fim (visão Ler); salvo sozinho; nada dito não insere; o Jarvis Mark não recebe o ditado do chat, nem o contrário | AC-013, AC-014 |
| `tests/notes-area.spec.ts` — "a note opens, is edited and saves itself; the preview renders it" | Editor, salvar sozinho, visões, salvar ao trocar | AC-004 a AC-006 |
| `tests/notes-area.spec.ts` — "notes are created, renamed by their title and deleted to the Recycle Bin" | Criar, renomear, apagar | AC-007 a AC-009 |
| `tests/notes-area.spec.ts` — "what JARVIS writes shows up at once; an edit in progress is never overwritten" | Observador, recarregar, conflito | AC-010 a AC-012 |

### Verification Commands

```powershell
npm run build
npx playwright test tests/notes-area.spec.ts tests/chat-mode.spec.ts --project ui
```

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| A pasta real: `assistant_folder` criando `Notas\`, o observador do `notify` e a Lixeira | Sem teste (KL-001) | Build de release: criar, editar e apagar uma nota e conferir a pasta |
| Arquivo binário ou maior que 5 MB na lista (RNF-003) | Sem teste | Semear um arquivo `binary` no fake |
| Codificação e fim de linha mantidos ao salvar (RF-006) | Sem teste próprio; o fake grava o que recebe | Nota em CRLF no app real |
| O ditado de ponta a ponta (microfone → Whisper → nota) | O teste usa `__JARVIS__.dictate` no lugar do motor de voz; o caminho do motor é o mesmo do Jarvis Mark ([dictation](../dictation/spec.md)) | App real, com um modelo de voz baixado e o microfone |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. Uma tarefa nova traz Aceite, Arquivos permitidos, Comando de teste e Evidência.

### Phase 1 — Skeleton (`npm run new`)

- [x] T001 Spec
  - Arquivos permitidos: `.specs/features/notes-area/spec.md`
  - Evidência: criado por `npm run new` e preenchido em 2026-11-19
- [x] T002 [P] Módulo da feature
  - Arquivos permitidos: `src/lib/notesArea.ts`
  - Evidência: criado por `npm run new`
- [x] T003 [P] Teste Playwright dos helpers
  - Arquivos permitidos: `tests/notes-area.spec.ts`
  - Evidência: criado por `npm run new`

### Phase 2 — Registration (CLI checklist)

- [x] T004 Chave nova no `localStorage`
  - Arquivos permitidos: `.specs/domain/persistence.md`
- [x] T005 `tests/notes-area.spec.ts` no `testMatch` do projeto `ui`
  - Arquivos permitidos: `playwright.config.ts`
- [x] T006 Linha na tabela Features do índice
  - Arquivos permitidos: `.specs/README.md`

### Phase 3 — Área de notas

- [x] T007 [US1] Regras puras, preferências e `section` no modo
  - Aceite: AC-002
  - Arquivos permitidos: `src/lib/notesArea.ts`, `src/lib/chatMode.ts`
- [x] T008 [US1] [US4] `useNotes` e `assistant_folder` criando as pastas
  - Aceite: AC-001, AC-003, AC-010
  - Arquivos permitidos: `src/hooks/useNotes.ts`, `src-tauri/src/lib.rs`
- [x] T009 [US1] [US2] [US3] `NotesList`, `NotesPanel`, seletor de seção e "Abrir" do cartão
  - Aceite: AC-001 a AC-012
  - Arquivos permitidos: `src/components/chat/*`, `src/App.tsx`

### Phase 4 — Verification

- [x] T010 Playwright da lista e da busca (AC-001 a AC-003)
- [x] T011 Playwright do editor (AC-004 a AC-006)
- [x] T012 Playwright de criar, renomear e apagar (AC-007 a AC-009)
- [x] T013 Playwright do observador e do conflito (AC-010 a AC-012)
  - Arquivos permitidos (T010–T013): `tests/notes-area.spec.ts`, `tests/chat-mode.spec.ts` (o "Abrir" do cartão)
  - Comando de teste: `npx playwright test tests/notes-area.spec.ts tests/chat-mode.spec.ts --project ui`
- [x] T014 Specs tocadas: `chat-mode` (RF-008 e a seção), `ipc-contract` (`assistant_folder`)

### Phase 5 — Ditado na nota (2026-11-19)

- [x] T015 [US5] Botão compartilhado, inserção no cursor e o contexto de ditado por modo
  - Aceite: AC-013, AC-014
  - Arquivos permitidos: `src/components/desktop/apps/DictationButton.tsx`, `src/components/desktop/apps/MarkdownEditor.tsx`, `src/components/chat/NotesPanel.tsx`, `src/App.tsx`
- [x] T016 Playwright do ditado
  - Aceite: AC-013, AC-014
  - Arquivos permitidos: `tests/notes-area.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-area.spec.ts tests/desktop.spec.ts --project ui`
- [x] T017 Spec tocada: `dictation` (quem consome o ditado)

### Phase 6 — Abrir no Explorer e lista leve (2026-11-19)

- [x] T018 [US1] Menu de contexto da nota, `reveal` no `useNotes`, `content-visibility` nos itens
  - Aceite: AC-015
  - Arquivos permitidos: `src/hooks/useNotes.ts`, `src/components/chat/NotesList.tsx`
- [x] T019 Playwright do menu
  - Aceite: AC-015
  - Arquivos permitidos: `tests/notes-area.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-area.spec.ts --project ui`

### Phase 7 — Pastas e subpastas, lista como explorador (2026-11-19)

Pedido do usuário: "as notas podem permitir pastas e subpasta, a esquerda ele deve exibir como um explorer minimalista tipo de editor de código com pastas e arquivos de md, o icon de markdown".

- [x] T020 [US1] Listagem recursiva, `folders`, criar em pasta, pastas (criar, renomear) no `useNotes`; `noteRows` e `closed` nas preferências
  - Aceite: AC-016, AC-017
  - Arquivos permitidos: `src/hooks/useNotes.ts`, `src/lib/notesArea.ts`
- [x] T021 [US1] [US4] A árvore, o ícone do Markdown, os botões e o menu de pasta
  - Aceite: AC-016, AC-017
  - Arquivos permitidos: `src/components/chat/NotesList.tsx`, `src/components/chat/ChatView.tsx`, `src-tauri/assistant-persona.md`
- [x] T022 Playwright da árvore e das pastas; ajuste dos testes que contavam com a ordem por data
  - Aceite: AC-016, AC-017
  - Arquivos permitidos: `tests/notes-area.spec.ts`, `tests/notes-graph.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-area.spec.ts tests/notes-graph.spec.ts --project ui`

## Rollback Plan

1. Tire o seletor de seção e as notas do `ChatView` e do `ChatSidebar`; o "Abrir" do cartão volta a levar ao Jarvis Mark.
2. Apague `src/components/chat/NotesList.tsx`, `NotesPanel.tsx`, `src/hooks/useNotes.ts`, `src/lib/notesArea.ts` e o teste; tire `notes-area` do `testMatch`.
3. `assistant_folder` pode continuar criando as pastas: é inofensivo.
4. A chave `jarvis.notesArea` e o campo `section` ficam órfãos e são ignorados. As notas são arquivos do usuário e não são tocadas.

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P1 — Local e offline | Atendido | Só arquivos locais |
| P2 — Rust dono do nativo | Atendido | Todo acesso a arquivo passa pelos comandos `workspace_*` |
| P3 — Comandos finos | Atendido | Nenhum comando novo; `assistant_folder` passa a usar `blocking()` |
| P4 — Contratos espelhados | Atendido | Tipos de `src/lib/workspace.ts`, sem mudança |
| P5 — Persistência tolerante | Atendido | `parseNotesArea`; `section` validado em `parseChatMode` |
| P6 — Fora do Tauri | Atendido | Fakes `__JARVIS_FS__` + `__JARVIS_ASSISTANT__`; sem eles, "Disponível no app desktop" |
| P7 — PT-BR | Atendido | UI em PT-BR, código em inglês |
| P8 — Linguagem visual | Atendido | Tokens `hud-*`, `hudTheme` |
| P9 — Desktop leve | Atendido | Painel lazy; leitura em segundo plano; a pasta só é observada com a seção aberta |
| P10 — Confinamento | Atendido | Raiz fixa em `Notas\`, vinda do Rust; guardas do workspace |
| P11 — Testes | Atendido | `tests/notes-area.spec.ts` no `testMatch`, 9 testes; lacunas em Coverage Gaps |
| P12 — README mínimo | Atendido | Tudo em `.specs` |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | Conferido no app real em 2026-11-19 (build de release, por CDP): `assistant_folder` devolvendo `Documentos\JARVIS\Notas`, "Nova nota", renomear pelo título, salvar sozinho (o arquivo no disco com o texto) e apagar (o arquivo some da pasta). Não conferidos no app: a atualização por mudança externa e o conflito. Numa rodada posterior no mesmo dia, com o build final e 18 notas em 5 pastas: a árvore mostrou as pastas antes das notas da raiz, uma pasta fechou e abriu, uma nota dentro de pasta abriu, e o botão direito numa nota mostrou "Abrir no Explorer". Em seguida, no disco de verdade: "Abrir no Explorer" numa nota abriu uma janela do Explorer em `Documentos\JARVIS\Notas` (fechada depois), sem erro na lista; "Nova pasta" criou a pasta e, com o nome digitado, renomeou-a; "Nova nota aqui" e "Nova pasta aqui" criaram dentro dela; "Renomear" levou a nota e a subpasta junto; "Apagar pasta" só apagou depois de "Sim, apagar a pasta", e a pasta foi para a Lixeira. A pasta de teste não ficou no disco. A aparência do explorador e do grafo foi conferida por captura de tela do build final. | Parcialmente verificado no app |
| KL-002 | O Jarvis Mark e a área de notas não se coordenam: com a mesma nota aberta nos dois, o segundo a salvar recebe o conflito (área de notas) ou sobrescreve (Jarvis Mark, que não usa carimbo). | Comportamento atual |
| KL-003 | Uma nota apagada por fora com edição pendente no editor: o salvamento ao sair falha com conflito e o texto digitado se perde, sem aviso. | Comportamento atual |
| KL-004 | A busca só vê o texto já lido; nos primeiros instantes, com muitas notas, só os títulos. Notas não lidas contam como "pode conter". | Comportamento atual |
| KL-005 | A pasta é observada só enquanto a seção Notas está aberta, e é fechada ao sair. Se o jv_ide estiver com a mesma pasta aberta, perde o observador dela até reabrir. | Risco conhecido |
| KL-006 | Arquivos que não são `.md` não aparecem (as subpastas aparecem desde 2026-11-19, RF-018). Não dá para mover uma nota de pasta pela lista (arrastar): isso se faz pelo Explorer. Uma nota criada por um `[[link]]` nasce na raiz. | Fora de escopo |

## Open Questions

Nenhuma.

## References

- [chat-mode](../chat-mode/spec.md), fase anterior; [notes-graph](../notes-graph/spec.md), a seguinte.
- Template: `.specs/_templates/feature.md`; modelo pronto: [reminders](../reminders/spec.md).
