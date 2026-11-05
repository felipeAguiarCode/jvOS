# Vendor: CodeMirror 6

O CodeMirror 6 é o editor de texto do jvOS: código no jv_ide, Markdown no Jarvis Mark e o rascunho de agente na aba `[2]` do jv_agent.

| | |
|---|---|
| **ID** | `vendor/codemirror` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `@codemirror/autocomplete` 6.20.4 (declarada `^6.20.4`)<br>`@codemirror/commands` 6.11.1 (declarada `^6.11.1`)<br>`@codemirror/lang-markdown` 6.5.2 (declarada `^6.5.2`)<br>`@codemirror/language` 6.13.1 (declarada `^6.13.1`)<br>`@codemirror/language-data` 6.5.2 (declarada `^6.5.2`)<br>`@codemirror/legacy-modes` 6.5.5 (declarada `^6.5.5`)<br>`@codemirror/search` 6.7.2 (declarada `^6.7.2`)<br>`@codemirror/state` 6.7.6 (declarada `^6.7.6`)<br>`@codemirror/view` 6.43.15 (declarada `^6.43.15`)<br>`@lezer/highlight` 1.2.5 (declarada `^1.2.5`)<br>`@lezer/common` 1.5.4 vem por transitividade |
| **Licença** | MIT (todos) |
| **Fonte** | https://codemirror.net (repositórios em `code.haverbeke.berlin/codemirror/*`; `language-data` em https://github.com/codemirror/language-data) |
| **Onde roda** | WebView2 (chunks lazy dos apps) · testes (`tests/outline.spec.ts` importa `@codemirror/state` e `@codemirror/language-data` no Node) |

## Objetivo

Três apps editam texto dentro de janelas TUI, com o tema trocado em tempo de execução e sem pesar na abertura do jvOS. O CodeMirror 6 é modular (cada recurso é uma extensão), aceita um tema feito só de variáveis CSS e carrega cada linguagem sob demanda. O [ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md) cita os "editores CodeMirror" como parte da UI; por que ele e não outro editor não está registrado (⚠ inferido — confirmar).

## Não-objetivos

- Sem autocompletar e sem servidor de linguagem. Do `@codemirror/autocomplete`, o jvOS usa só `closeBrackets` ([jv_ide](../../../apps/jv_ide/spec.md)).
- Sem dobra de código (`foldGutter`), sem lint e sem o `basicSetup` do pacote `codemirror`. O jvOS monta o próprio `editorBasics()`.
- Sem temas prontos (one-dark e afins): os temas são `hudTheme`, `hudHighlight` e `ideTheme`, feitos dos tokens `hud-*`.
- Arquivos binários ou com mais de 5 MiB não entram no editor.

## Critérios de aceite

### Critério 1 (RF-002)

- **Dado** um projeto aberto no jv_ide
- **Quando** abro `inventory/report.py`, `web/app.tsx`, `src/main.rs`, `cmd/server.go`, `docs/guide.md`, `scripts/build.ps1`, `legacy/latin1.txt` e `cs/Program.cs`
- **Então** a barra de status mostra "Sintaxe: Python", "TSX", "Rust", "Go", "Markdown", "PowerShell", "Texto" e "C#", e o Python ganha mais de 20 `span` de realce em `.cm-line`. Prova: `tests/ide.spec.ts`, "each language gets its highlighter, indentation, line ending and encoding".

### Critério 2 (RF-003)

- **Dado** duas abas abertas, `report.py` com "# A" digitado e `models.py` com "# B"
- **Quando** volto para `report.py` e aperto Ctrl+Z
- **Então** só o "# A" some, e `models.py` continua com "# B". Prova: `tests/ide.spec.ts`, "each tab keeps its own undo history".

### Critério 3 (RF-001)

- **Dado** o Jarvis Mark aberto (chunk lazy, até 15 s no primeiro carregamento)
- **Quando** digito "# Olá JARVIS", Enter, Enter, "- item", seleciono "item" e aperto Ctrl+B
- **Então** o texto vira `- **item**`, a barra mostra "Ln 3" e "●", e o rascunho vai para `jarvis.editor.markdown`. Prova: `tests/desktop.spec.ts`, "the markdown editor previews what is typed, formats with Ctrl+B and keeps the draft".

### Critério 4 (RF-004)

- **Dado** um documento com mais de 2 MiB, uma linguagem desconhecida ("Brainfuck") e um TOML com 2500 chaves
- **Quando** peço o outline
- **Então** os dois primeiros dão lista vazia, e o TOML para em 2000 símbolos (`MAX_SYMBOLS`). Prova: `tests/outline.spec.ts`, "limits: no language, unknown languages and huge documents give nothing; long outlines stop at the cap".

### Critério 5 (RF-005)

- **Dado** `assets/logo.png` e `logs/big.log` (12 MB) no projeto
- **Quando** tento abrir os dois no jv_ide
- **Então** nenhum chega ao CodeMirror: aparecem "arquivo binário (2 KB)" e "grande demais (12.0 MB)", e a barra mostra "Modo: Binário | Edição: Não". Prova: `tests/ide.spec.ts`, "binary and huge files are not opened as text".

### Critério 6 (RNF-001)

- **Dado** o `package-lock.json` atual
- **Quando** rodo `npm ls @codemirror/state @codemirror/view @codemirror/language`
- **Então** há uma cópia de cada (as outras saem `deduped`). Duas cópias de `@codemirror/state` fariam o editor recusar extensões de outra instância.

### Critério 7 (RF-006)

- **Dado** o jv_ide aberto
- **Quando** troco o acento TUI ou a cor do JARVIS
- **Então** o editor muda de cor sem recriar a `EditorView`, porque o tema só usa `var(--color-hud-*)`. Prova: `tests/tui.spec.ts`, "the TUI tab switches the editors' glow and aberration and sets their accent".

## Casos de borda

- **Vazio/nulo:**
  - sem linguagem, o editor abre como texto simples ("Sintaxe: Texto"), e o outline fica vazio;
  - documento vazio no Jarvis Mark mostra o placeholder "# Escreva em Markdown…".
- **Duplicidade/idempotência:**
  - o StrictMode monta o `CodeMirror` duas vezes em DEV; a limpeza chama `destroy()` e sobra uma `EditorView`;
  - um `doc` igual ao último texto não gera `dispatch` (`doc === lastDoc`);
  - duas cópias de `@codemirror/state` quebrariam as extensões (critério 6).
- **Concorrência/corrida:**
  - o JARVIS escreve no Jarvis Mark ou no jv_agent enquanto o texto chega: a troca vinda de fora substitui o documento inteiro e não volta como `onChange` (flag `syncing`), para não desfazer uma troca mais nova;
  - a linguagem carrega de forma assíncrona (`description.load()`). Se a aba trocou antes, `reconfigure` atualiza o estado guardado da aba, e não a vista;
  - o outline tem 50 ms (`PARSE_BUDGET`) para terminar o parse; depois usa o que já foi lido.
- **Permissões/visibilidade:**
  - os editores levam `data-allow-context-menu` e `select-text`, então o menu de copiar e colar funciona também no build de produção;
  - abas virtuais (diff, log do git) e arquivos binários ou grandes ficam somente leitura (`EditorState.readOnly`).

## Uso no jvOS

### Base compartilhada (`src/components/desktop/apps/CodeMirror.tsx`)

- **Comportamento:**
  - **RF-001**: Todo editor do jvOS DEVE partir de `editorBasics()`: `lineNumbers`, `highlightActiveLineGutter`, `highlightSpecialChars`, `history`, `drawSelection`, `dropCursor`, `indentOnInput`, `bracketMatching`, `closeBrackets`, `highlightActiveLine`, `highlightSelectionMatches`, o keymap (`closeBracketsKeymap`, `defaultKeymap`, `searchKeymap`, `historyKeymap`, `indentWithTab`), `hudTheme` e `syntaxHighlighting(hudHighlight)`.
  - O componente `CodeMirror` cria uma `EditorView` por montagem e troca linguagem e quebra de linha por `Compartment`, sem recriar o editor.

### Tema (`src/lib/editorTheme.ts`)

- **Comportamento:**
  - **RF-006**: `hudTheme` (`EditorView.theme`, `dark: true`), `hudHighlight` (`HighlightStyle` com as tags de `@lezer/highlight`) e `ideTheme` DEVEM usar só `var(--color-hud-*)` e `color-mix`, com fundo transparente e a fonte `var(--font-mono)`.

### jv_ide (`ide/store.ts`, `ide/editorRuntime.ts`, `ide/EditorPanel.tsx`, `ide/languages.ts`)

- **Comportamento:**
  - **RF-002**: A linguagem DEVE ser escolhida nesta ordem: a escolha manual, o nome `.diff`/`.patch` (linguagem `Diff`, do `StreamLanguage.define(diff)` dos `legacy-modes`), `LanguageDescription.matchFilename` do `language-data` e a linha `#!`. "Linguagem…" oferece 29 nomes mais texto simples.
  - **RF-003**: Uma `EditorView` mostra a aba ativa, e cada aba tem o próprio `EditorState`, trocado por `view.setState`. Assim cada aba guarda o seu histórico e a sua seleção. Os `Compartment` `idSlot`, `languageSlot`, `indentSlot`, `readOnlySlot` e `prefsSlot` mudam uma aba sem recriá-la.
  - A indentação vem de `detectIndent` (tab ou 2, 4, 8 espaços); o tamanho da fonte e o cursor em bloco vêm das prefs.

### Outline (`ide/outline.ts`, `ide/outlineRegex.ts`)

- **Comportamento:**
  - **RF-004**: O outline DEVE ler a árvore com `ensureSyntaxTree(state, length, 50)` ou `syntaxTree(state)`, parar em 2000 símbolos e não rodar em documentos com mais de 2 MiB. As linguagens de `legacy-modes` (C#, Kotlin, Ruby, Shell, PowerShell, Lua, Swift, Dart, SQL, TOML, Dockerfile) são lidas linha a linha.

### Jarvis Mark e jv_agent (`MarkdownEditor.tsx`, `agent/AgentEditor.tsx`)

- **Comportamento:**
  - O Jarvis Mark usa `markdown({ base: markdownLanguage, codeLanguages: languages })`, que realça os blocos de código pela linguagem.
  - O jv_agent usa `markdown()` num chunk próprio, buscado quando o ponteiro ou o foco chega à aba `[2]` (`loadEditor`).

### Limite de tamanho (`src-tauri/src/workspace/mod.rs`)

- **Comportamento:**
  - **RF-005**: Arquivos com mais de 5 MiB (`MAX_TEXT_BYTES`) ou binários NÃO DEVEM chegar ao CodeMirror: abrem como "grande demais" ou "arquivo binário", somente leitura.

## Restrições

- **RNF-001**: Todos os `@codemirror/*` na major 6, com uma cópia de `state`, `view` e `language` no lock.
- **RNF-002**: Nada do CodeMirror carrega com o holograma ([ADR-0012](../../../arch/adr/0012-apps-lazy-com-preload.md)). No build de 04/11, `CodeMirror-*.js` tem 61.870 bytes e `IdeApp-*.js` 125.353 bytes, e cada linguagem do `language-data` é um chunk próprio (`clike-*.js`, `cobol-*.js`, `css-*.js`…).
- **RNF-003**: Limites: 5 MiB para abrir, 2 MiB para o outline, 2000 símbolos, 50 ms de parse por outline.
- **RNF-004**: Licença MIT.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/desktop/apps/CodeMirror.tsx` | `editorBasics()` e o componente `CodeMirror` |
| `src/lib/editorTheme.ts` | `hudTheme`, `hudHighlight`, `ideTheme` |
| `src/components/desktop/apps/ide/editorRuntime.ts` | Extensões por aba, `Compartment`s, `detectIndent` |
| `src/components/desktop/apps/ide/store.ts` · `EditorPanel.tsx` | Uma `EditorView`, um `EditorState` por aba, carga da linguagem |
| `src/components/desktop/apps/ide/languages.ts` | `PICKER`, `DIFF`, `describe` (nome, `#!`) |
| `src/components/desktop/apps/ide/outline.ts` · `outlineRegex.ts` | Outline pela árvore e pelos modos legados |
| `src/components/desktop/apps/MarkdownEditor.tsx` | Jarvis Mark |
| `src/components/desktop/apps/agent/AgentEditor.tsx` | Aba `[2]` do jv_agent |
| `src-tauri/src/workspace/mod.rs` | `MAX_TEXT_BYTES` |

### Testes

- `npx playwright test tests/ide.spec.ts` (critérios 1, 2 e 5).
- `npx playwright test tests/desktop.spec.ts` (critério 3).
- `npx playwright test tests/outline.spec.ts`: 16 testes de outline por linguagem, rodando o CodeMirror no Node (critério 4).
- `npx playwright test tests/tui.spec.ts` (critério 7).
- `npx playwright test tests/agent.spec.ts`: o editor da aba `[2]`.
- `npm ls @codemirror/state @codemirror/view @codemirror/language` (critério 6).

### Atualização e reversão

- **Comando:** `npm i @codemirror/<pacote>@<versão>`, de preferência todos juntos, e `npm i @lezer/highlight@<versão>`. Depois, reinicie o `npm run dev:web`.
- **Prova:** `npm ls` sem cópia dupla de `state` ou `view`; `npm run build`; `ide.spec.ts`, `outline.spec.ts`, `desktop.spec.ts` e `agent.spec.ts`.
- **Sinal de volta:** "Unrecognized extension value" ou erro parecido no console (cópias duplicadas); uma linguagem some do `language-data` e o critério 1 falha; o outline muda de símbolos em `outline.spec.ts`; as classes `.cm-*` mudam e o tema quebra.
- **Reversão:** `npm i @codemirror/autocomplete@6.20.4 @codemirror/commands@6.11.1 @codemirror/lang-markdown@6.5.2 @codemirror/language@6.13.1 @codemirror/language-data@6.5.2 @codemirror/legacy-modes@6.5.5 @codemirror/search@6.7.2 @codemirror/state@6.7.6 @codemirror/view@6.43.15 @lezer/highlight@1.2.5`.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0012 — Apps lazy com preload](../../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0014 — Linguagem visual TUI](../../../arch/adr/0014-linguagem-visual-tui.md)

## Dependências

- **Vendor:** [react](../react/spec.md) (o componente `CodeMirror`), [tailwind](../tailwind/spec.md) (os tokens que o tema lê), [vite-typescript](../vite-typescript/spec.md) (um chunk por linguagem), [workspace-fs](../workspace-fs/spec.md) (leitura dos arquivos no Rust).
- **Specs:** [jv_ide](../../../apps/jv_ide/spec.md), [jarvis-mark](../../../apps/jarvis-mark/spec.md), [jv_agent](../../../apps/jv_agent/spec.md), [dictation](../../../features/dictation/spec.md) (o ditado escreve no editor do Jarvis Mark), [appearance](../../../features/appearance/spec.md).
- **Sistema:** a fonte de `--font-mono` (Cascadia Code ou Consolas).

## Pendências

- [ ] `src/components/desktop/apps/ide/outline.ts` importa tipos de `@lezer/common` (1.5.4), que não está no `package.json`. Ele chega por transitividade, via `@codemirror/language`.
