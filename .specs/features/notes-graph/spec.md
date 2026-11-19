# Feature Specification: Grafo de notas

## Metadata

| Field | Value |
|---|---|
| Feature ID | `feature/notes-graph` |
| Product | JARVIS OS (jvOS) |
| Feature Status | Implementado |
| Document Status | Plano escrito em 2026-11-19, antes do código, e fechado no mesmo dia com o que foi construído; sem decisões em aberto |
| Source Commit | não commitado |
| Uncommitted Changes | Tudo: feature nova |
| Voice Shortcut | — |
| Assistant Tool | — (a persona passa a pedir links e tags nas notas que o JARVIS escreve) |
| Target Platforms | Windows 11 com WebView2; no navegador (modo web) usa os fakes da [área de notas](../notes-area/spec.md) |
| Language | PT-BR no conteúdo e nas falas; inglês nos títulos das seções e em Given / When / Then |
| Last Editorial Revision | 2026-11-19 |
| Verification Scope | Conferido com o código em 2026-11-19: `src/lib/notesGraph.ts`, `src/components/chat/NotesGraph.tsx`, `NotesPanel.tsx`, `NotesList.tsx`, `ChatView.tsx`, `src/hooks/useNotes.ts` (`create` com nome), `src/App.tsx`, `src-tauri/assistant-persona.md`. Testes rodados: `npx tsc --noEmit` sem erros; `tests/notes-graph.spec.ts` 3 de 3, com `notes-area`, `chat-mode`, `core` e `taskbar` (25 de 25 no total). O visual foi conferido por capturas de tela no modo web. O teste Rust da persona e o app real ficam para o build final: KL-001 |

Especificação no formato inspirado no GitHub Spec Kit, com seções de desenho técnico ([ADR-0025](../../arch/adr/0025-features-formato-feature-specification.md)). Os IDs começam em US1, RF-001, RNF-001, SC-001, AC-001 e T001. KL-* registra limitações conhecidas; OQ-*, decisões de produto em aberto. Nenhum dos dois acrescenta escopo.

## Overview

Terceira fase do [modo chat](../chat-mode/spec.md), sobre a [área de notas](../notes-area/spec.md). As notas passam a se ligar umas às outras, como no Obsidian: `[[Nome da nota]]` cria um link e `#tag` junta notas pelo assunto. As ligações aparecem de três jeitos: como links clicáveis na leitura da nota, como a lista "Mencionada em" (os backlinks) e como um grafo 3D holográfico, as "sinapses", em que cada nota é um nó.

| Input | Expected Behavior | Execution Path |
|---|---|---|
| Escrever `[[Ideias]]` numa nota | Na leitura, vira um link que abre a nota "Ideias" | Local (`notesGraph.ts`) |
| Clicar num link para uma nota que não existe | A nota é criada com esse nome e abre | `workspace_create` |
| Escrever `#projeto` | Na leitura, vira uma tag clicável que filtra a lista | Local |
| Abrir uma nota citada por outras | O rodapé "Mencionada em" lista quem a cita | Local |
| Clicar em "Grafo" | O grafo 3D toma o lugar do editor | Local (three.js) |
| Clicar num nó do grafo | A nota abre no editor; uma tag filtra a lista | Local |

## Goals and Success Criteria

### Goals

- Ligar notas sem sair do texto, com a sintaxe que quem usa Obsidian já conhece.
- Ver de onde uma nota é citada.
- Enxergar o acervo inteiro como uma rede, e navegar por ela.

### Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| SC-001 | Um link escrito numa nota leva à outra com um clique | `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed" |
| SC-002 | O grafo mostra todas as notas e as ligações entre elas, e abre a nota do nó clicado | `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note" |

## Scope and Non-Goals

### In Scope

- `[[Nota]]`, `[[Nota|texto]]` e `[[Nota#seção]]`; `#tag` com letras, números, `_`, `-` e `/`.
- Links e tags clicáveis na leitura; criar a nota de um link que não existe.
- Backlinks ("Mencionada em") na nota aberta.
- O grafo 3D: notas, tags e notas ainda não criadas como nós; links e tags como arestas; girar, aproximar, passar o mouse, clicar.
- A regra na persona do JARVIS para ele escrever links e tags.

### Out of Scope

- Ligações automáticas por conteúdo (o usuário escolheu só links e tags explícitos).
- Autocompletar `[[` no editor e destacar links no modo de escrita.
- Renomear uma nota não reescreve os links que apontam para ela.
- Filtros, grupos de cor e profundidade local do grafo.
- Links para seções: `[[Nota#seção]]` abre a nota, sem rolar até a seção.

## User Stories

### US1 — Ligar notas

**Priority:** P1.

**User Story:** Como usuário, quero escrever `[[Nota]]` e `#tag` nas minhas notas e clicar neles, para ir de uma ideia a outra.

**Why This Priority:** sem ligações não há grafo.

**Independent Test:** `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed".

**Acceptance Criteria:** AC-001, AC-002, AC-003 e AC-004.

### US2 — Ver as sinapses

**Priority:** P1.

**User Story:** Como usuário, quero ver minhas notas como uma rede 3D, para perceber como os assuntos se conectam e navegar por ela.

**Why This Priority:** é o pedido central da fase.

**Independent Test:** `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note".

**Acceptance Criteria:** AC-005, AC-006, AC-007 e AC-008.

### US3 — O agente liga as notas

**Priority:** P2.

**User Story:** Como usuário, quero que as notas que o JARVIS escreve já venham com links e tags, para o grafo crescer sozinho.

**Why This Priority:** multiplica o valor do grafo, mas depende do modelo seguir a instrução.

**Independent Test:** `cargo test --lib the_persona_asks_for_links_and_tags`.

**Acceptance Criteria:** AC-009.

### US4 — Um cérebro, não um diagrama (2026-11-19)

**Como** usuário, **quero** que o grafo pareça um cérebro em atividade (neurônios, axônios e impulsos), **para** ver as minhas notas como a memória viva do JARVIS.

**Priority:** P2.

**Independent Test:** `tests/notes-graph.spec.ts` — "the graph is alive: impulses run along the links, and hold still under the pointer".

**Acceptance:** AC-010, AC-011.

### US5 — As notas como base de conhecimento do JARVIS (2026-11-19)

**Como** usuário, **quero** que o JARVIS consulte as minhas notas antes de responder sobre os meus assuntos e que eu veja quais ele leu, **para** confiar na resposta e achar a fonte.

**Priority:** P1.

**Independent Test:** `tests/notes-graph.spec.ts` — "the notes JARVIS read for an answer are named in the chat and fire in the graph".

**Acceptance:** AC-012, AC-013.

## Requirements

### Functional Requirements

| ID | Requirement | Related Stories |
|---|---|---|
| RF-001 | O sistema DEVE reconhecer `[[alvo]]`, `[[alvo|texto]]` e `[[alvo#seção]]` como links para a nota `alvo`, e `#tag` (um `#` no começo do texto ou depois de um espaço, seguido de uma letra e de letras, números, `_`, `-` ou `/`) como tag. Nada é reconhecido dentro de blocos de código (cercas ```` ``` ````) nem de código em linha. Um cabeçalho (`# Título`) não é tag. | US1 |
| RF-002 | Um link DEVE ser resolvido pelo título da nota, sem diferenciar maiúsculas nem acentos; se não houver, pelo título sem o prefixo de data `AAAA-MM-DD ` (as notas do JARVIS). Com mais de uma candidata, vale a alterada mais recentemente. | US1 |
| RF-003 | Na leitura da nota, um link DEVE aparecer como um link clicável que abre a nota; um link sem nota aparece esmaecido e, ao clicar, cria a nota com esse nome e a abre. Uma tag aparece como uma etiqueta clicável que põe `#tag` na busca da lista. | US1 |
| RF-004 | A nota aberta DEVE listar, no rodapé "Mencionada em", as notas que têm um link para ela, cada uma clicável. Sem menções, o rodapé não aparece. | US1 |
| RF-005 | A lista de notas DEVE ter o botão "Grafo", que troca o editor pelo grafo e de volta; a escolha fica em `jarvis.notesGraph`. | US2 |
| RF-006 | O grafo DEVE ter um nó por nota, um por tag e um por alvo de link sem nota; uma aresta por link (nota → nota, com direção: A citar B e B citar A são duas) e uma por tag (nota → tag), sem repetir. O tamanho do nó cresce com o número de ligações. | US2 |
| RF-007 | O grafo DEVE ser desenhado em 3D, com as cores do tema: notas em `hud-holo`, tags em `hud-amber`, notas ainda não criadas em `hud-text` esmaecido, e a nota aberta em `hud-light`. Arrastar gira, a roda aproxima e afasta. Parado, ele gira devagar (menos com "reduzir movimento"). | US2 |
| RF-008 | Passar o ponteiro sobre um nó DEVE mostrar o nome dele e destacar o nó e os vizinhos, esmaecendo o resto. Os nós com mais ligações e a nota aberta mostram o nome sempre. | US2 |
| RF-009 | Clicar num nó de nota DEVE abri-la no editor (saindo do grafo); num nó de tag, pôr a tag na busca; num nó sem nota, criar a nota e abri-la. | US2 |
| RF-010 | O grafo DEVE ter uma lista equivalente para leitores de tela e teclado: um botão por nó, com o nome e o número de ligações, que faz o mesmo que o clique. Desde 2026-11-19 a `nav` tem o botão "Listar os nós do grafo", e a lista só é montada depois dele (RNF-007). | US2 |
| RF-011 | A persona do JARVIS DEVE pedir que as notas que ele escreve citem notas relacionadas com `[[Nome da nota]]` e terminem com uma linha de `#tags`. | US3 |
| RF-012 | O grafo DEVE ter a forma de um cérebro: a simulação puxa os nós para um elipsoide (mais comprido de frente para trás, mais baixo que largo) com uma fenda no meio que separa dois hemisférios; as ligações entre os hemisférios continuam. | US4 |
| RF-013 | Cada ligação DEVE ser desenhada como um axônio: uma curva (8 trechos retos) arqueada para fora do centro, mais clara junto dos nós e mais fraca no meio. | US4 |
| RF-014 | O grafo DEVE estar vivo: em média a cada 0,8 s um nó com ligações dispara (brilha por 0,7 s) e manda impulsos por até 3 das suas ligações, a 60 unidades por segundo; um impulso que chega faz o nó de destino brilhar e, com 55% de chance e enquanto houver saltos (2 no disparo espontâneo), dispara adiante por até 2 ligações, nunca de volta. No máximo 64 impulsos e 48 brilhos ao mesmo tempo. | US4 |
| RF-015 | Com um nó sob o ponteiro, ou com "reduzir movimento" ligado no sistema, NÃO DEVE haver impulsos nem brilhos (o grafo fica parado, como já ficava a rotação). | US4 |
| RF-016 | A persona DEVE mandar o JARVIS tratar `Notas` como a sua base de conhecimento: antes de responder sobre projetos, pessoas, decisões, ideias ou qualquer coisa que o usuário possa ter anotado, procurar nas notas (Grep e Glob), ler as que servem (Read) e dizer de qual nota veio, citando-a como `[[Nome da nota]]`; se as notas não dizem nada, dizer isso em vez de inventar. | US5 |
| RF-017 | Cada arquivo que o JARVIS lê com Read numa resposta DEVE chegar à UI como evento `source{path}` e ficar guardado na resposta (`sources`). No chat, as fontes que podem ser abertas aparecem sob a resposta em "Consultou:", cada uma um botão que abre a nota. | US5 |
| RF-018 | No grafo, as notas lidas na resposta em andamento (ou, sem uma em andamento, na última resposta com fontes da conversa ativa) DEVEM aparecer destacadas: cor própria, nome sempre visível, um disparo a cada 1,5 s com impulsos da cor do destaque por até 5 ligações e 3 saltos, e a linha "N notas consultadas pelo JARVIS na última resposta". | US5 |
| RF-019 | Em volta dos nós DEVE aparecer o contorno de um cérebro, em pontos tênues: dois hemisférios enrugados (800 pontos cada, mais achatados embaixo) com a fenda entre eles, e o cerebelo atrás e embaixo (260 pontos). O contorno tem o tamanho que os nós pedem (1,3 vez a distância típica deles ao centro, medida em proporções de cérebro: 1,1 de meia largura, 0,8 de meia altura, 1,3 de meio comprimento), e um nó jogado para longe do resto (uma tag solta) fica na superfície. A câmera enquadra o contorno. | US4 |
| RF-020 | O desenho DEVE lembrar o grafo do Obsidian (pedido do usuário em 2026-11-19): nós pequenos e chapados, com um halo fraco; ligações finas, de cor neutra e quase retas (arco de 10% do comprimento); o nome de cada nó logo abaixo dele, centrado, mais apagado quanto mais ao fundo. Num grafo de até 40 nós todos os nomes aparecem; acima disso, só os dos mais ligados (RF-007), da nota aberta, das consultadas e de quem está sob o ponteiro com os vizinhos. O contorno de cérebro e os impulsos continuam, mais discretos. | US2, US4 |
| RF-021 | Um nó DEVE poder ser arrastado: ele segue o ponteiro (na profundidade em que estava) e a simulação volta a rodar com ele preso, de modo que os vizinhos o acompanham como molas; solto, o grafo assenta de novo. Um clique sem arrasto continua abrindo o nó; arrastar o fundo continua girando o grafo. | US2 |

### Non-Functional Requirements

| ID | Requirement | Scope |
|---|---|---|
| RNF-001 | O grafo cria um contexto WebGL só enquanto está na tela e o destrói ao sair ([ADR-0027](../../arch/adr/0027-grafo-notas-pode-criar-contexto-web.md)). | `NotesGraph` |
| RNF-002 | O three.js do grafo carrega em chunk próprio, ao abrir o grafo. | `NotesGraph` |
| RNF-006 | Com o grafo assentado, um quadro NÃO DEVE reenviar posições à GPU (matrizes das esferas e pontas das arestas só são refeitas enquanto a simulação move os nós), e a rotação lenta sozinha é desenhada a cada dois quadros (30 fps em foco). Arrastar, a roda e o destaque continuam a 60 fps. Medido em 2026-11-19 com 400 notas: de 235 para 158 a 170 ms de CPU por segundo (KL-001). | `NotesGraph` |
| RNF-003 | O desenho roda no `runFrames` com `frameRate(paused, focused)`: 60 fps em foco, 30 com outro app na frente, 0 com a janela oculta. `devicePixelRatio` até 1,5; sem pós-processamento. | `NotesGraph` |
| RNF-004 | No máximo 400 nós (`MAX_NODES`): com mais, ficam as notas mais recentes e o que se liga a elas. A simulação de forças para quando assenta. | `notesGraph.ts` |
| RNF-005 | O índice de links e tags é refeito só quando o texto de alguma nota muda. | `ChatView` |
| RNF-007 | O que não está na tela NÃO DEVE pesar em cada quadro do grafo: a lista de nós para o teclado só existe depois de pedida (eram 2 elementos por nó sempre montados), e o tamanho da caixa do grafo vem do `ResizeObserver`, não de uma leitura de layout por quadro. Medido com 400 notas, no tempo da thread principal da página: a lista de nós custava 26 ms por segundo e a lista de 400 notas ao lado, 50 ms (tratada em [notes-area](../notes-area/spec.md), RNF-001 de lá). | `NotesGraph` |
| RNF-008 | O nome de um nó só é reposicionado quando o nó andou mais de 0,8 px na tela, e a sua opacidade muda em passos de 0,1: com os 26 nomes de um grafo pequeno, mover todos a cada quadro levava o app a 161 ms de CPU por segundo; com a regra, 69 a 74 ms (medido em 2026-11-19, 18 notas, build final). | `NotesGraph` |

### Operational Constraints

- O grafo só enxerga as notas que a área de notas listou e já leu.
- Preferência em `jarvis.notesGraph`, gravada com 250 ms de debounce.
- Textos e rótulos em PT-BR.

## Acceptance Criteria

### AC-001 — Follow a Link

**Related Story:** US1.

- **Given** uma nota com `[[Ideias]]` no texto e a nota "Ideias" na pasta
- **When** o usuário clica no link, na leitura
- **Then** a nota "Ideias" abre.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed".

### AC-002 — Resolve a Dated Note and an Alias

**Related Story:** US1.

- **Given** `[[reuniao|a reunião de segunda]]` e a nota "2026-11-17 Reunião"
- **When** a nota é lida
- **Then** o link mostra "a reunião de segunda" e abre "2026-11-17 Reunião".

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed".

### AC-003 — Create the Note of a Missing Link

**Related Story:** US1.

- **Given** `[[Projeto Órion]]` sem nenhuma nota com esse nome
- **When** o usuário clica no link
- **Then** `Projeto Órion.md` é criada e abre.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed".

### AC-004 — Tags and Backlinks

**Related Story:** US1.

- **Given** duas notas com `#projeto` e uma delas com um link para "Ideias"
- **When** o usuário clica na tag, e depois abre "Ideias"
- **Then** a busca mostra `#projeto` e a lista fica só com as duas notas; em "Ideias", "Mencionada em" lista a nota que a cita.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed".

### AC-005 — Open the Graph

**Related Story:** US2.

- **Given** a seção Notas com notas ligadas
- **When** o usuário clica em "Grafo"
- **Then** o grafo aparece no lugar do editor, com um nó por nota, tag e link sem nota, e um contexto WebGL existe; a escolha continua depois de recarregar.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note".

### AC-006 — Open a Note From a Node

**Related Story:** US2.

- **Given** o grafo aberto
- **When** o usuário clica no nó de uma nota
- **Then** o editor volta com essa nota aberta.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note".

### AC-007 — Filter by a Tag Node

**Related Story:** US2.

- **Given** o grafo aberto
- **When** o usuário aciona o nó de uma tag
- **Then** a busca da lista recebe a tag e a lista fica só com as notas dela.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note".

### AC-008 — Release the WebGL Context

**Related Story:** US2.

- **Given** o grafo aberto com o núcleo 2D
- **When** o usuário volta ao editor
- **Then** não há mais nenhum `canvas` do grafo na página.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note".

### AC-009 — JARVIS Is Told to Link

**Related Story:** US3.

- **Given** a persona embutida no app
- **When** o prompt do JARVIS é montado
- **Then** ele contém a instrução de usar `[[Nome da nota]]` e `#tags` nas notas.

**Coverage Status:** coberto — `src-tauri/src/assistant.rs` — `the_persona_asks_for_links_and_tags`.

### AC-010 — The Graph Is Alive

**Related Story:** US4.

- **Given** o grafo aberto com notas ligadas e o ponteiro fora dele
- **When** passam alguns segundos
- **Then** impulsos correm pelas ligações (o contador de impulsos enviados cresce) e o grafo continua sendo desenhado.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph is alive: impulses run along the links, and hold still under the pointer" (AC-010, AC-011) e `tests/notes-graph.spec.ts` — "the notes JARVIS read for an answer are named in the chat and fire in the graph" (AC-012, AC-013).

### AC-011 — Still Under the Pointer and With Reduced Motion

**Related Story:** US4.

- **Given** o grafo vivo
- **When** o ponteiro para sobre um nó, ou o sistema pede menos movimento
- **Then** não há impulso em curso e nenhum novo é enviado.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph is alive: impulses run along the links, and hold still under the pointer" (AC-010, AC-011) e `tests/notes-graph.spec.ts` — "the notes JARVIS read for an answer are named in the chat and fire in the graph" (AC-012, AC-013).

### AC-012 — Sources of an Answer

**Related Story:** US5.

- **Given** uma pergunta no chat
- **When** o JARVIS lê `Notas\Ideias.md` para responder
- **Then** a resposta mostra "Consultou:" com o botão "Ideias", que abre a nota na seção Notas, e a fonte continua lá depois de recarregar.

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the notes JARVIS read for an answer are named in the chat and fire in the graph" e `src-tauri/src/assistant.rs` — `a_file_read_is_a_source_of_the_answer`.

### AC-013 — Recalled Notes Fire in the Graph

**Related Story:** US5.

- **Given** uma resposta que leu a nota Ideias
- **When** o usuário abre o grafo
- **Then** aparece "1 nota consultada pelo JARVIS na última resposta", o nó de Ideias tem o nome à vista e a legenda ganha "consultadas".

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "the graph is alive: impulses run along the links, and hold still under the pointer" (AC-010, AC-011) e `tests/notes-graph.spec.ts` — "the notes JARVIS read for an answer are named in the chat and fire in the graph" (AC-012, AC-013).

### AC-014 — Drag a Node

**Related Story:** US2.

- **Given** o grafo assentado
- **When** o usuário arrasta o nó de Ideias 150 px para o lado e solta
- **Then** o nó acompanha o ponteiro, um vizinho ligado a ele também sai do lugar, e a nota não é aberta (o grafo continua na tela).

**Coverage Status:** coberto — `tests/notes-graph.spec.ts` — "a node is dragged with the pointer, and its neighbours follow".

## Behavior and Flows

### Regras (`src/lib/notesGraph.ts`)

- **Behavior:** tudo puro, sem three.js.
  - `parseLinks(content)` e `parseTags(content)` (RF-001).
  - `resolveLink(target, notes)` (RF-002).
  - `buildGraph(notes)`: nós (`note`, `tag`, `missing`) com o grau, e arestas (`link`, `tag`) sem repetição (RF-006), limitado a `MAX_NODES` (RNF-004).
  - `backlinks(graph, path)` (RF-004).
  - `linkedMarkdown(content, notes)`: troca cada link e tag do texto por um link Markdown com destino `#note=<nome>` ou `#tag=<tag>`, para a leitura (RF-003); o código fica como está.
  - `createSimulation(count, edges)`: posições 3D num `Float32Array`, começando numa esfera de Fibonacci; cada `step()` aplica repulsão entre todos os nós, molas nas arestas e uma gravidade que cresce com a distância (`GRAVITY` 0,35: grupos sem ligação entre si ficam perto em vez de se afastarem), mantém o conjunto centrado na origem e esfria a temperatura (× 0,97 por passo); devolve `false` quando assentou. `extent()` dá a distância do nó mais afastado, para a câmera.
  - `useNotesGraphPrefs`: `{ open }` em `jarvis.notesGraph` (RF-005).

### Leitura da nota (`NotesPanel`)

- **Behavior:** o texto passa por `linkedMarkdown` antes do `react-markdown`. O componente `a` da leitura trata `#note=` (abre ou cria a nota, RF-003) e `#tag=` (busca); os outros links seguem como eram. O rodapé "Mencionada em" vem de `backlinks` (RF-004).
- **Style:** link de nota em `text-hud-holo` sublinhado; sem nota, `text-hud-text/50` tracejado; tag em `text-hud-amber`.

### `NotesGraph` (`src/components/chat/NotesGraph.tsx`)

- **Behavior:**
  - Cria o `WebGLRenderer` (alpha, antialias), a câmera em perspectiva e um grupo com: esferas instanciadas para os nós (escala pelo grau, cor pelo tipo) e segmentos de linha para as arestas (RF-006, RF-007).
  - A cada quadro do `runFrames`: dois passos da simulação enquanto ela não assentou, a câmera se afastando o bastante para caber o grafo inteiro (até o usuário usar a roda), a rotação lenta se ninguém está arrastando nem apontando um nó, o desenho e a posição dos rótulos (elementos HTML sobre o canvas, movidos por `transform`) (RNF-003). Parado e sem rotação (movimento reduzido), nada é redesenhado.
  - Ponteiro: arrastar gira o grupo; a roda muda a distância da câmera; parado sobre um nó (o mais próximo a até 16 px na tela), destaca-o com os vizinhos (RF-008); um clique sem arrasto aciona o nó (RF-009).
  - As cores vêm dos tokens `--color-hud-*`, lidos uma vez ao montar (convertidos por um canvas 2D, porque o three.js não entende todas as notações de cor do CSS).
  - Ao desmontar: para o laço, solta geometrias e materiais, `renderer.dispose()` e `forceContextLoss()`, e tira o canvas (RNF-001).
  - A lista equivalente (RF-010) fica numa `nav` "Nós do grafo", visível só para leitores de tela e para o foco do teclado.
- **Layout:** ocupa a área do editor; a legenda (notas, tags, a criar) e a contagem ficam no canto inferior esquerdo.

### Interaction Flow

1. O usuário escreve `[[Ideias]]` e `#projeto` numa nota; na leitura, eles viram link e etiqueta.
2. Abre o grafo: a nota nova aparece ligada a "Ideias" e ao nó `#projeto`.
3. Clica num nó vizinho: o editor volta com aquela nota, e "Mencionada em" mostra de onde ela veio.

### User Feedback

| Situation | Feedback |
|---|---|
| Sem notas | "Nenhuma nota para ligar ainda" no lugar do grafo |
| Notas sem nenhuma ligação | O grafo com os nós soltos e a dica "Escreva [[Nome da nota]] ou #tag para criar ligações" |
| WebGL indisponível | "Não foi possível desenhar o grafo" e a lista de nós continua utilizável |

### Voice and Keyboard

- Sem atalho de voz. No grafo, Tab percorre a lista de nós e Enter aciona o nó.

## Data Model and Persistence

### NotesGraphPrefs

```ts
interface NotesGraphPrefs {
  /** The graph is on screen instead of the editor. */
  open: boolean;
}
```

### Graph (em memória)

```ts
interface GraphNode {
  /** A note's path, "#tag", or "?name" for a link with no note yet. */
  id: string;
  kind: "note" | "tag" | "missing";
  label: string;
  /** How many edges touch it. */
  degree: number;
}

interface GraphEdge {
  source: number; // index into nodes
  target: number;
  kind: "link" | "tag";
}
```

### Storage Rules

| Property | Value |
|---|---|
| State | `$grafoAberto` |
| Storage | `localStorage` |
| Key | `jarvis.notesGraph` |
| Write Debounce | 250 ms |
| Reader | `parseNotesGraph`: campo inválido vira `false` |
| Missing or Invalid Storage | Grafo fechado |

Links e tags não são guardados à parte: vivem no texto das notas.

Ver [persistência](../../domain/persistence.md).

## Technical Design

### Component Responsibilities

| File or Component | Responsibility |
|---|---|
| `src/lib/notesGraph.ts` | Links, tags, grafo, backlinks, simulação e preferências |
| `src/components/chat/NotesGraph.tsx` | O grafo 3D e a lista equivalente (novo, lazy) |
| `src/components/chat/NotesPanel.tsx` | Links e tags clicáveis na leitura; "Mencionada em" |
| `src/components/chat/NotesList.tsx` | Botão "Grafo"; a busca passa a ser controlada de fora (uma tag clicada a preenche) |
| `src/components/chat/ChatView.tsx` | O índice (`buildGraph`), a busca e a troca editor ↔ grafo |
| `src/App.tsx` | Repassa `paused` e `focused` ao chat, para o relógio de quadros |
| `src-tauri/assistant-persona.md`, `src-tauri/src/assistant.rs` | A regra dos links e o teste dela |
| `tests/notes-graph.spec.ts` | Testes |

### Related Architecture Decisions

- [ADR-0027 — O grafo de notas pode criar um contexto WebGL enquanto está na tela](../../arch/adr/0027-grafo-notas-pode-criar-contexto-web.md)
- [ADR-0022 — Núcleo com relógio de quadros](../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md): `runFrames` e `frameRate`
- [ADR-0012 — Apps carregados sob demanda](../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0010 — Persistência](../../arch/adr/0010-persistencia-settings-vs-localstorage.md)

## Interfaces and Contracts

Nenhum comando, evento ou tipo novo no IPC. O grafo usa as notas de `useNotes` ([notes-area](../notes-area/spec.md)) e `create` para os links sem nota.

## Edge Cases and Error Handling

| Case | Behavior | Reference |
|---|---|---|
| `[[ ]]` vazio, `[[` sem fechar | Não é link | RF-001 |
| Link para a própria nota | Ignorado: sem aresta | RF-006 |
| O mesmo link ou tag várias vezes na nota | Uma aresta só | RF-006 |
| `#123`, `#` solto, `texto#ancora`, `https://x/#a`, `[link](#secao)` | Não são tags | RF-001 |
| Link e tag dentro de código | Ignorados e mostrados como texto | RF-001 |
| Nome de link com caracteres que não servem em arquivo | A nota criada usa o nome limpo por `noteFileName`; nome que fica vazio não cria nada | RF-003 |
| Duas notas com o mesmo nome sem data | Vale a mais recente | RF-002 |
| Mais de 400 nós | Ficam as notas mais recentes e os vizinhos delas | RNF-004 |
| Notas ainda sendo lidas | O grafo cresce conforme os textos chegam | RNF-005 |
| WebGL indisponível ou contexto perdido | Mensagem no lugar do canvas; a lista de nós continua | User Feedback |
| Concorrência | Uma nota alterada por fora refaz o índice; o grafo é reconstruído mantendo a câmera | RNF-005 |
| Permissões | Não se aplica: só lê as notas já carregadas | — |

## Dependencies

### Feature Dependencies

| Dependency | Purpose |
|---|---|
| [notes-area](../notes-area/spec.md) | As notas, o editor e a lista |
| [holographic-core](../holographic-core/spec.md) | `runFrames`, `frameRate` e a regra de WebGL |

### Runtime Dependencies

- [three](../../foundation/vendor/three/spec.md) (já usado pelo núcleo 3D; aqui direto, sem `@react-three/fiber`)
- [Markdown](../../foundation/vendor/markdown/spec.md)

## Test Strategy and Coverage

### Reported Tests

| Test Reference | Coverage | Acceptance Mapping |
|---|---|---|
| `tests/notes-graph.spec.ts` — "notes-graph helpers" | `parseLinks`, `parseTags`, `resolveLink`, `buildGraph`, `backlinks`, `linkedMarkdown`, simulação, parser | RF-001, RF-002, RF-006, RNF-004 |
| `tests/notes-graph.spec.ts` — "the graph is alive: impulses run along the links, and hold still under the pointer" | Impulsos enviados com o ponteiro fora; nenhum em curso nem enviado com um nó sob o ponteiro; voltam ao sair; nenhum com "reduzir movimento" | AC-010, AC-011 |
| `tests/notes-graph.spec.ts` — "the notes JARVIS read for an answer are named in the chat and fire in the graph" | "Consultou:" só com o que pode ser aberto; `sources` gravado na conversa; a linha e o nome da nota consultada no grafo; a fonte abre a nota depois de recarregar | AC-012, AC-013 |
| `src-tauri/src/assistant.rs` — `a_file_read_is_a_source_of_the_answer`, `the_persona_treats_the_notes_as_its_knowledge_base` | Read vira `source{path}`; Grep é só um passo; a regra da base de conhecimento na persona | RF-016, RF-017 |
| `tests/notes-graph.spec.ts` — "a node is dragged with the pointer, and its neighbours follow" | Todos os nomes num grafo pequeno; o nó segue o ponteiro; um vizinho ligado sai do lugar; arrastar não abre a nota | AC-014, RF-020 |
| `tests/notes-graph.spec.ts` — "links and tags are clickable in the rendered note, and backlinks are listed" | Link, alias, nota criada, tag, backlinks | AC-001 a AC-004 |
| `tests/notes-graph.spec.ts` — "the graph draws the notes and their links in 3D, and a node opens its note" | Grafo, contexto WebGL, nó → nota, tag → busca, contexto liberado | AC-005 a AC-008 |
| `src-tauri/src/assistant.rs` — `the_persona_asks_for_links_and_tags` | A regra na persona | AC-009 |

### Verification Commands

```powershell
npm run build
npx playwright test tests/notes-graph.spec.ts tests/notes-area.spec.ts tests/core.spec.ts --project ui
```

Em `src-tauri`: `cargo test --lib -- assistant::`.

### Coverage Gaps

| Gap | Evidence Status | Suggested Verification |
|---|---|---|
| `the_persona_asks_for_links_and_tags` | Escrito; roda com o `cargo test` do build final | `cargo test --lib the_persona_asks_for_links_and_tags` |
| O JARVIS de verdade escrevendo links e tags (AC-009 cobre só o texto da persona) | Sem teste: depende do modelo | Pedir uma pesquisa no app real e ler a nota |
| Custo do grafo (CPU, memória de GPU) e a liberação do contexto no processo de GPU | Sem teste automático; medido à mão em 2026-11-19 com 61 e com 400 notas (KL-001) | `npm run perf` com o grafo aberto e depois de fechá-lo |
| Limite de 400 nós com um acervo grande | Só o corte, com 3 notas e limite 2, no teste dos helpers | Semear centenas de notas |
| A roda (zoom) e o "reduzir movimento" | Sem teste | À mão |

## Implementation Plan

**Status Convention:** `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. Uma tarefa nova traz Aceite, Arquivos permitidos, Comando de teste e Evidência.

### Phase 1 — Skeleton (`npm run new`)

- [x] T001 Spec e ADR-0027
  - Arquivos permitidos: `.specs/features/notes-graph/spec.md`, `.specs/arch/adr/0027-grafo-notas-pode-criar-contexto-web.md`
  - Evidência: criados por `npm run new` e preenchidos em 2026-11-19
- [x] T002 [P] Módulo da feature
  - Arquivos permitidos: `src/lib/notesGraph.ts`
  - Evidência: criado por `npm run new`
- [x] T003 [P] Teste Playwright dos helpers
  - Arquivos permitidos: `tests/notes-graph.spec.ts`
  - Evidência: criado por `npm run new`

### Phase 2 — Registration (CLI checklist)

- [x] T004 Chave nova no `localStorage`
  - Arquivos permitidos: `.specs/domain/persistence.md`
- [x] T005 `tests/notes-graph.spec.ts` no `testMatch` do projeto `ui`
  - Arquivos permitidos: `playwright.config.ts`
- [x] T006 Linhas nos índices (features e ADRs)
  - Arquivos permitidos: `.specs/README.md`, `.specs/arch/adr/README.md`

### Phase 3 — Links, tags e grafo

- [x] T007 [US1] [US2] Regras puras e a simulação
  - Aceite: AC-002
  - Arquivos permitidos: `src/lib/notesGraph.ts`
- [x] T008 [US1] Links, tags e backlinks na leitura; busca controlada
  - Aceite: AC-001 a AC-004
  - Arquivos permitidos: `src/components/chat/NotesPanel.tsx`, `NotesList.tsx`, `ChatView.tsx`
- [x] T009 [US2] `NotesGraph` e o botão "Grafo"
  - Aceite: AC-005 a AC-008
  - Arquivos permitidos: `src/components/chat/NotesGraph.tsx`, `NotesList.tsx`, `ChatView.tsx`, `src/App.tsx`

### Phase 4 — Verification

- [x] T010 Playwright dos links, tags e backlinks (AC-001 a AC-004)
- [x] T011 Playwright do grafo (AC-005 a AC-008)
  - Arquivos permitidos (T010–T011): `tests/notes-graph.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-graph.spec.ts --project ui`
- [x] T012 [US3] A regra na persona e o teste
  - Arquivos permitidos: `src-tauri/assistant-persona.md`, `src-tauri/src/assistant.rs`
  - Comando de teste: `cargo test --lib the_persona_asks_for_links_and_tags`
- [x] T013 Specs tocadas: `holographic-core` (regra de WebGL), vendor `three`, `notes-area`

### Phase 5 — Cérebro e base de conhecimento (2026-11-19)

Pedido do usuário: "melhore o efeito de animações de sinapses, deixe mais parecido com um cérebro, leve em consideração que o jarvis pode usar essas notas como base de conhecimento (tipo um rag)".

- [x] T014 [US4] Forma de cérebro, axônios curvos, impulsos e brilhos; lista de nós sob demanda
  - Aceite: AC-010, AC-011
  - Arquivos permitidos: `src/lib/notesGraph.ts`, `src/components/chat/NotesGraph.tsx`
- [x] T015 [US5] Evento `source`, `sources` na resposta, "Consultou:" no chat, notas consultadas no grafo e a regra na persona
  - Aceite: AC-012, AC-013
  - Arquivos permitidos: `src-tauri/src/assistant.rs`, `src-tauri/assistant-persona.md`, `src/lib/assistant.ts`, `src/hooks/useAssistant.ts`, `src/components/chat/ChatThread.tsx`, `src/components/chat/ChatView.tsx`
  - Comando de teste: `cargo test --lib assistant::`
- [x] T016 Playwright do grafo vivo e das fontes
  - Aceite: AC-010 a AC-013
  - Arquivos permitidos: `tests/notes-graph.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-graph.spec.ts --project ui`
- [x] T017 Contratos: `ipc-contract.md` (evento `source`), `persistence.md` (`sources`), spec `assistant` (RF-006)

### Phase 6 — Mais parecido com o Obsidian (2026-11-19)

- [x] T018 [US2] Nós chapados, ligações finas, nomes sob os nós, arrastar um nó com a simulação reagindo
  - Aceite: AC-014
  - Arquivos permitidos: `src/lib/notesGraph.ts`, `src/components/chat/NotesGraph.tsx`
- [x] T019 Playwright do arrasto
  - Aceite: AC-014
  - Arquivos permitidos: `tests/notes-graph.spec.ts`
  - Comando de teste: `npx playwright test tests/notes-graph.spec.ts --project ui`

## Rollback Plan

1. Tire o botão "Grafo" e o `NotesGraph`; apague `src/components/chat/NotesGraph.tsx`.
2. Tire `linkedMarkdown` e o rodapé de backlinks do `NotesPanel`: links e tags voltam a ser texto.
3. Apague `src/lib/notesGraph.ts` e o teste; tire `notes-graph` do `testMatch`.
4. Desfaça a regra da persona. As notas escritas com `[[links]]` continuam válidas como texto.
5. Marque o ADR-0027 como substituído por um ADR novo que restaure a regra do ADR-0022.

## Constitution Compliance

| Principle | Status | Rationale |
|---|---|---|
| P1 — Local e offline | Atendido | Tudo local |
| P2 — Rust dono do nativo | Atendido | Nenhum acesso novo |
| P5 — Persistência tolerante | Atendido | `parseNotesGraph` |
| P6 — Fora do Tauri | Atendido | Os fakes da área de notas |
| P7 — PT-BR | Atendido | UI em PT-BR |
| P8 — Linguagem visual | Atendido | Cores lidas dos tokens `hud-*` |
| P9 — Desktop leve | Exceção com ADR | Um contexto WebGL a mais, só com o grafo na tela ([ADR-0027](../../arch/adr/0027-grafo-notas-pode-criar-contexto-web.md)); chunk próprio; `runFrames` |
| P10 — Confinamento | Atendido | Só lê as notas já carregadas |
| P11 — Testes | Atendido | `tests/notes-graph.spec.ts` no `testMatch`, 6 testes; lacunas em Coverage Gaps |
| P12 — README mínimo | Atendido | Tudo em `.specs` |

## Known Limitations

| ID | Limitation | Status |
|---|---|---|
| KL-001 | Conferido no app real em 2026-11-19 (build de release, por CDP): link e tag clicáveis na leitura, o grafo desenhando num canvas WebGL e o canvas sumindo ao sair do grafo (núcleo 2D: zero canvas antes e depois). A medição pedida pelo ADR-0027 foi feita no mesmo dia, com o build final e 61 notas com 180 ligações (60 notas de teste, apagadas depois): `npm run perf` por 20 s com o grafo aberto e assentado deu 133 ms de CPU por segundo na árvore inteira do app (o editor de notas, na mesma tela, 44 ms), abaixo do orçamento de 170 ms do núcleo 3D ocioso; a memória de GPU foi de 944 para 989 MB com o grafo aberto e ficou em 943 MB depois de abrir e fechar o grafo cinco vezes, sem canvas sobrando (o contexto é liberado). Nenhum dos dois sinais de parada do ADR apareceu. No teto (400 notas de teste, 798 ligações, apagadas depois): o canvas aparece em 0,1 a 0,4 s; nos dez primeiros segundos, enquanto assenta, 60 fps com o pior quadro em 18 a 24 ms; assentado, a primeira medição deu 235 ms de CPU por segundo, acima do orçamento, e por isso o laço foi mudado (RNF-006); depois da mudança, quatro medições deram 158, 159, 165 e 170 ms, dentro do orçamento, mas sem folga. Essas medições oscilavam porque o ponteiro parado sobre um nó pausa o grafo; as seguintes foram feitas com o ponteiro estacionado fora dele. O custo vinha da página, não do grafo: cada quadro fazia o navegador reprocessar a árvore inteira (a lista de nós para o teclado, sempre montada, e a lista de 400 notas ao lado); 111 ms por segundo da thread principal, dos quais só 36 eram do grafo. Depois de RNF-007 (e do RF-017 de notes-area), já com os impulsos e o contorno do cérebro, o build final deu: com as 18 notas reais (125 ligações), 105 a 121 ms de CPU por segundo no app inteiro e 36 a 41 ms na thread principal; com 400 notas (798 ligações), 86, 86 e 92 ms no app inteiro e 43 a 44 ms na thread principal, 30 desenhos por segundo. Folga de quase metade do orçamento no teto. Também conferido no app real, com o Claude Code de verdade: uma pergunta sobre as notas ("quando o fine-tuning vale a pena e quando é melhor usar RAG?") fez o JARVIS ler `Modelos\Fine-tuning.md` e `RAG\RAG.md`, a resposta mostrou "Consultou: Fine-tuning, RAG" e o grafo, "2 notas consultadas pelo JARVIS na última resposta". Não medido: o grafo com o núcleo em modo 3D (KL-007). O teste Rust `the_persona_asks_for_links_and_tags` passou (33 de 33 em `assistant:: agents:: settings::`). | Parcialmente verificado no app |
| KL-002 | Renomear uma nota não reescreve os `[[links]]` que apontam para ela: eles passam a ser links para uma nota a criar. | Fora de escopo |
| KL-003 | O editor (modo Escrever) não destaca nem completa `[[`; os links só são clicáveis na leitura. | Fora de escopo |
| KL-004 | Cada mudança em qualquer nota refaz o índice e reconstrói o grafo do zero (a simulação recomeça; a câmera fica). | Comportamento atual |
| KL-005 | A simulação é O(n²) por passo. Medido com 400 nós (KL-001): o assentamento não trava (60 fps, pior quadro de 24 ms) e o grafo assentado e vivo custa 86 a 92 ms de CPU por segundo, de 170 do orçamento. | Medido |
| KL-006 | Uma tag logo depois de código em linha, sem espaço (`\`x\`#tag`), é lida como tag. | Comportamento atual |
| KL-007 | Com o núcleo em modo 3D, o contexto dele continua alocado (parado) enquanto o grafo está aberto: dois contextos WebGL. | Aceito no ADR-0027 |
| KL-008 | As fontes de uma resposta são só os arquivos lidos com Read. O que o JARVIS achou com Grep sem abrir não conta, e uma nota lida para outra coisa (por exemplo, antes de editá-la) conta como consultada. | Comportamento atual |
| KL-009 | O "RAG" é o do agente: o JARVIS decide o que procurar, com Grep, Glob e Read na pasta. Não há índice de embeddings nem busca por significado; com muitas notas, achar depende de as palavras da pergunta estarem nas notas. | Decisão de escopo |
| KL-010 | Com poucas notas a forma de cérebro vem só do contorno: os nós não chegam a desenhar dois hemisférios. Num grafo pequeno e denso os nomes se sobrepõem no centro; aproximar com a roda os separa. | Comportamento atual |

## Open Questions

Nenhuma.

## References

- [ADR-0027](../../arch/adr/0027-grafo-notas-pode-criar-contexto-web.md); [notes-area](../notes-area/spec.md), fase anterior.
- Template: `.specs/_templates/feature.md`; modelo pronto: [reminders](../reminders/spec.md).
