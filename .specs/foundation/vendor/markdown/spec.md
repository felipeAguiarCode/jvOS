# Vendor: react-markdown e remark-gfm

O `react-markdown` com o `remark-gfm` transforma Markdown em elementos React nas três telas do jvOS que mostram texto formatado: o histórico do JARVIS, a visualização do Jarvis Mark e as lições do jv_lab.

| | |
|---|---|
| **ID** | `vendor/markdown` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `react-markdown` 10.1.0 (declarada `^10.1.0`)<br>`remark-gfm` 4.0.1 (declarada `^4.0.1`) |
| **Licença** | MIT (os dois) |
| **Fonte** | https://github.com/remarkjs/react-markdown · https://github.com/remarkjs/remark-gfm |
| **Onde roda** | WebView2 (num chunk lazy, `markdownComponents-*.js`) |

## Objetivo

As respostas do JARVIS chegam em Markdown do Claude Code ([ADR-0006](../../../arch/adr/0006-jarvis-via-claude-cli.md)), o Jarvis Mark edita Markdown e as lições do jv_lab são arquivos `.md`. As três telas precisam de títulos, listas, código e tabelas na paleta `hud-*`, sem injetar HTML. O `react-markdown` gera elementos React (sem `dangerouslySetInnerHTML`) e aceita trocar cada elemento por um componente estilizado; o `remark-gfm` acrescenta as tabelas, o tachado e as listas de tarefas do GitHub. A escolha não está registrada (⚠ inferido — confirmar).

## Não-objetivos

- Sem HTML cru: não há `rehype-raw`. O HTML escrito no Markdown aparece como texto.
- Sem realce de sintaxe nos blocos de código da visualização (nem `rehype-highlight` nem `rehype-prism`). O realce fica no editor do Jarvis Mark, que é CodeMirror.
- Sem matemática, notas de rodapé estilizadas ou diagramas (`remark-math`, Mermaid).
- Sem `urlTransform` nem `allowedElements` próprios: valem os padrões do `react-markdown`.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o Jarvis Mark aberto
- **Quando** digito "# Olá JARVIS", duas vezes Enter e "- item"
- **Então** a visualização (`data-testid="markdown-preview"`) mostra um `heading` de nível 1 "Olá JARVIS" e um `listitem` "item". Depois de Ctrl+B, "item" aparece em `<strong>`. Prova: `tests/desktop.spec.ts`, "the markdown editor previews what is typed, formats with Ctrl+B and keeps the draft".

### Critério 2 (RF-002)

- **Dado** o catálogo do jv_lab
- **Quando** abro a lição "LLM por dentro"
- **Então** o `article` "Conteúdo da lição" mostra o `heading` de nível 1 "LLM por dentro", tirado de `src/lib/lab/lessons/llm.md`. Prova: `tests/lab.spec.ts`, "the catalog lists five lessons; a lesson shows its text beside a terminal that checks its challenges".

### Critério 3 (RF-003)

- **Dado** uma resposta do JARVIS já terminada
- **Quando** abro "Histórico do JARVIS"
- **Então** a pergunta "Status dos sistemas?" e o texto "Os sistemas estão operacionais" aparecem no `assistant-history`. Prova: `tests/assistant.spec.ts`, "the core answers SUPERHOT style, word by word, and the answer lands in the history".

### Critério 4 (RF-004)

- **Dado** o Jarvis Mark com `| a | b |`, `|---|---|`, `| 1 | 2 |`, `~~velho~~` e `- [ ] tarefa`
- **Quando** olho a visualização
- **Então** saem uma `table` com `th` em `text-hud-light` e bordas `hud-cyan/15`, um `del` em `text-hud-text/50` e uma caixa de seleção com `accent-hud-cyan`. Conferência manual (sem teste).

### Critério 5 (RF-005)

- **Dado** o texto `<b>oi</b>` e o link `[clique](javascript:alert(1))` no Jarvis Mark
- **Quando** olho a visualização
- **Então** o `<b>oi</b>` aparece como texto, sem elemento `b`, e o link sai com `href` vazio, porque o `defaultUrlTransform` só aceita `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp` ou caminhos relativos. Conferência manual.

### Critério 6 (RNF-001)

- **Dado** o `npm run build`
- **Quando** olho `dist/assets`
- **Então** o `react-markdown`, o `remark-gfm` e os estilos estão em `markdownComponents-*.js` (156.888 bytes no build de 04/11), puxado só pelos chunks lazy `AssistantHistory-*.js`, `MarkdownEditor-*.js` e `LabApp-*.js`, e não pelo `index-*.js`.

## Casos de borda

- **Vazio/nulo:**
  - resposta vazia não renderiza nada: o histórico só monta o `Markdown` quando há `answer`;
  - documento vazio no Jarvis Mark deixa a visualização em branco.
- **Duplicidade/idempotência:** o mesmo `MARKDOWN_COMPONENTS` serve as três telas. Mudar um estilo ali muda as três.
- **Concorrência/corrida:** durante o stream do JARVIS, o histórico re-renderiza o Markdown a cada pedaço de texto. Um bloco ainda aberto (uma tabela pela metade, uma crase sem par) aparece cru até o resto chegar.
- **Permissões/visibilidade:**
  - HTML cru vira texto, e URLs com protocolo fora da lista ficam vazias (critério 5);
  - uma imagem remota (`![](https://…)`) não carrega no app desktop, porque a CSP só permite `img-src 'self' data: blob:`;
  - os links abrem com `target="_blank"` e `rel="noreferrer"`. O que a WebView2 do Tauri faz com essa nova janela não foi verificado (ver Pendências).

## Uso no jvOS

### Estilos comuns (`src/components/desktop/apps/markdownComponents.tsx`)

- **Comportamento:**
  - **RF-004**: `MARKDOWN_COMPONENTS` DEVE trocar `h1`–`h4`, `p`, `a`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre`, `hr`, `table`, `th`, `td`, `img` e `del` por elementos com classes de tokens `hud-*`. O `code` distingue bloco de trecho pela classe `language-*`; o `pre` rola na horizontal (`hud-scroll`).
  - Os links saem com `target="_blank"` e `rel="noreferrer"`.

### Visualização do Jarvis Mark (`src/components/desktop/apps/MarkdownEditor.tsx`)

- **Comportamento:**
  - **RF-001**: A visualização DEVE renderizar `document.content` com `remarkPlugins={[remarkGfm]}` e `MARKDOWN_COMPONENTS` sempre que o modo não for só o editor (`mode` `split` ou `preview`), com o texto selecionável (`select-text`).

### Lições do jv_lab (`src/components/desktop/apps/lab/LessonLab.tsx`)

- **Comportamento:**
  - **RF-002**: Cada lição DEVE renderizar `lessonText(id)`, o `.md` embutido por `import.meta.glob` com `?raw`, com o mesmo plugin e os mesmos componentes.

### Histórico do JARVIS (`src/components/AssistantHistory.tsx`)

- **Comportamento:**
  - **RF-003**: Cada resposta do histórico, inclusive a que ainda está chegando, DEVE ser renderizada com `remarkGfm` e `MARKDOWN_COMPONENTS`. O componente é `lazy` dentro do `AssistantDrawer`.

### Segurança do conteúdo (`AssistantHistory.tsx`, `MarkdownEditor.tsx`, `LessonLab.tsx`)

- **Comportamento:**
  - **RF-005**: O jvOS NÃO DEVE ligar `rehype-raw`, nem trocar o `urlTransform` padrão: o texto vem do Claude, do usuário ou de arquivos, e não pode virar HTML nem `javascript:`.

## Restrições

- **RNF-001**: O Markdown só carrega com o histórico, o Jarvis Mark ou o jv_lab: 156.888 bytes num chunk lazy.
- **RNF-002**: `react-markdown` 10.1.0 pede `react >=18` e `@types/react >=18` como peers. Ele e o `remark-gfm` 4.0.1 dividem um só `unified` 11.0.5 (`npm ls unified`).
- **RNF-003**: Licença MIT.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/desktop/apps/markdownComponents.tsx` | `MARKDOWN_COMPONENTS`, os estilos HUD |
| `src/components/desktop/apps/MarkdownEditor.tsx` | Visualização do Jarvis Mark |
| `src/components/desktop/apps/lab/LessonLab.tsx` · `lessonText.ts` | Texto das lições |
| `src/components/AssistantHistory.tsx` | Respostas do JARVIS no histórico |
| `src/lib/lab/lessons/*.md` | As cinco lições |
| `src-tauri/tauri.conf.json` | `img-src 'self' data: blob:` |

### Testes

- `npx playwright test tests/desktop.spec.ts` (critério 1).
- `npx playwright test tests/lab.spec.ts` (critério 2).
- `npx playwright test tests/assistant.spec.ts` (critério 3).
- `npm run build` e olhar `markdownComponents-*.js` (critério 6).
- Manual no Jarvis Mark: tabela, tachado, tarefa, HTML e `javascript:` (critérios 4 e 5).

### Atualização e reversão

- **Comando:** `npm i react-markdown@<versão> remark-gfm@<versão>`, os dois juntos, para continuarem com um só `unified`.
- **Prova:** `npm run build`; `desktop.spec.ts`, `lab.spec.ts` e `assistant.spec.ts`; a conferência manual dos critérios 4 e 5.
- **Sinal de volta:** tabelas ou tarefas deixam de renderizar (o plugin não casa com o `unified` do `react-markdown`); o tipo de `components` muda e o `tsc` quebra em `markdownComponents.tsx`; HTML cru passa a virar elemento.
- **Reversão:** `npm i react-markdown@10.1.0 remark-gfm@4.0.1`.

### Decisões relacionadas

- [ADR-0006 — O cérebro do JARVIS é o `claude.exe` local em stream-json](../../../arch/adr/0006-jarvis-via-claude-cli.md)
- [ADR-0012 — Apps lazy com preload](../../../arch/adr/0012-apps-lazy-com-preload.md)

## Dependências

- **Vendor:** [react](../react/spec.md) (peer), [tailwind](../tailwind/spec.md) (as classes de `MARKDOWN_COMPONENTS`), [codemirror](../codemirror/spec.md) (o editor ao lado da visualização), [claude-code](../claude-code/spec.md) (o texto das respostas).
- **Specs:** [jarvis-mark](../../../apps/jarvis-mark/spec.md), [jv_lab](../../../apps/jv_lab/spec.md), [assistant](../../../features/assistant/spec.md), [quick-notes](../../../features/quick-notes/spec.md) (notas que abrem no Jarvis Mark).
- **Sistema:** nenhum além da WebView2.

## Pendências

- [ ] Nenhum teste cobre as extensões do GFM (tabela, tachado, lista de tarefas) nem o tratamento de HTML cru e de `javascript:` (critérios 4 e 5).
- [ ] Os links do Markdown usam `target="_blank"` (`markdownComponents.tsx`), e nenhum código do Rust trata pedidos de nova janela da WebView2. O comportamento no app desktop não foi verificado.
