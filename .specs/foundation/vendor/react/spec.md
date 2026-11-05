# Vendor: React

O React 19 e o React DOM desenham toda a interface do jvOS dentro da WebView2: núcleo 2D, janelas, widgets, apps e painéis.

| | |
|---|---|
| **ID** | `vendor/react` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `react` 19.3.1 (declarada `~19.3.1`)<br>`react-dom` 19.3.1 (declarada `~19.3.1`)<br>`@types/react` 19.3.0 (declarada `^19.1.8`, dev)<br>`@types/react-dom` 19.3.0 (declarada `^19.1.6`, dev) |
| **Licença** | MIT (os quatro pacotes) |
| **Fonte** | https://react.dev (o `package.json` aponta `github.com/react/react`) · `@types/*`: https://github.com/DefinitelyTyped/DefinitelyTyped |
| **Onde roda** | WebView2 (app) · Edge headless (testes) · build (os `@types/*` só entram no `tsc`) |

## Objetivo

O jvOS é uma área de trabalho de tela cheia com dezenas de componentes vivos ao mesmo tempo, e o [ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md) pôs essa UI em React com TypeScript dentro da WebView2. Os apps sob demanda usam `lazy` com `Suspense`, já ajustados ao React 19, que segura o fallback por 300 ms ([ADR-0012](../../../arch/adr/0012-apps-lazy-com-preload.md)), e os componentes recebem `ref` como prop, sem `forwardRef`.

## Não-objetivos

- Sem biblioteca de estado global. O estado mora em hooks (`useStoredState`), em três contextos (`IdeContext`, `SignalsContext`, `DictationContext`) e em `useSyncExternalStore`. O `zustand` que aparece no lock vem do `@react-three/fiber`, e o jvOS não o importa.
- Sem renderização no servidor nem Server Components. Só `createRoot` no cliente, em `src/main.tsx`.
- Sem React Compiler: o `babel-plugin-react-compiler` não está instalado, e a memoização é feita à mão (`useMemo`, `useCallback`).
- Sem componentes de classe.

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `package-lock.json` atual
- **Quando** rodo `npm ls react react-dom`
- **Então** aparece uma cópia só, `react@19.3.1` e `react-dom@19.3.1`. As referências de `@react-three/fiber`, `motion`, `lucide-react` e `react-markdown` saem como `deduped`, sem `invalid`.

### Critério 2 (RF-001)

- **Dado** o `npm run dev:web` respondendo em `http://localhost:1420`
- **Quando** a página carrega
- **Então** `src/main.tsx` monta `<App />` em `#root` dentro de `<React.StrictMode>`, e `window.__JARVIS__.signals.frames` avança (o `waitForFrames` de `tests/helpers.ts` passa em todos os specs).

### Critério 3 (RF-003)

- **Dado** o chunk do jv_agent ainda não baixado
- **Quando** o JARVIS começa a escrever um agente (`onAssistantFile` em `src/App.tsx`)
- **Então** `preloadWindow("agent")` busca o chunk antes de abrir a janela, e o app aparece já montado, sem "Carregando…". Prova: `tests/agent.spec.ts`, "JARVIS writes the agent in jv_agent, shows it for review and runs it once in jv_sh".

### Critério 4 (RF-003)

- **Dado** um app lazy aberto pelo Launcher antes de o chunk chegar
- **Quando** a janela abre
- **Então** ela mostra "Carregando…" por pelo menos 300 ms (`FALLBACK_THROTTLE_MS` do React 19), e o app monta uma vez só quando o chunk chega: `lazyApp` escolhe o componente no primeiro render e não o troca depois.

### Critério 5 (RF-002)

- **Dado** um componente que recebe uma prop com o tipo errado
- **Quando** rodo `npm run build`
- **Então** o `tsc` falha com os tipos de `@types/react` 19.3.0, e o `vite build` não chega a rodar (`tsc && vite build`).

### Critério 6 (RF-004)

- **Dado** o widget Pomodoro aberto
- **Quando** clico nele com o botão direito
- **Então** o menu "Opções do widget Pomodoro" (`role="menu"`) sai por `createPortal` em `document.body`, e as setas, o Espaço e o Esc ficam no menu. Prova: `tests/widgets.spec.ts`, "keys pressed in a widget's menu stay in the menu".

### Critério 7 (RNF-002)

- **Dado** o `@react-three/fiber` 9.8.2, cujo peer é `react >=19 <19.4`
- **Quando** alguém tenta `npm i react@19.4 react-dom@19.4`
- **Então** o npm recusa com `ERESOLVE`, ou o `npm ls @react-three/fiber` passa a marcar o peer como `invalid`. A subida só entra junto com um fiber que aceite a 19.4.

## Casos de borda

- **Vazio/nulo:**
  - sem o `<div id="root">` no `index.html`, o `createRoot` lança na partida e a tela fica preta, porque `getElementById("root") as HTMLElement` não confere nada;
  - um chunk lazy que falha ao baixar: `lazyApp` zera a promessa para tentar de novo na próxima abertura, mas o erro sobe sem error boundary (ver Pendências).
- **Duplicidade/idempotência:**
  - o StrictMode monta tudo duas vezes em DEV. O `useStoredState` regrava a chave ao montar (por isso os testes esperam os quadros antes de semear o `localStorage`), o `TerminalView` fecha o shell que perdeu a corrida e o `CodeMirror` cria uma `EditorView` por montagem;
  - duas cópias do React no lock quebrariam os hooks. O critério 1 garante uma só.
- **Concorrência/corrida:**
  - um chunk que chega depois do começo de um stream do JARVIS: sem `preloadWindow`, o React 19 segura o fallback por 300 ms ou mais e o app perde o começo do texto ([ADR-0012](../../../arch/adr/0012-apps-lazy-com-preload.md));
  - `lazyApp` guarda uma única promessa (`loading ??=`), então duas aberturas seguidas baixam o chunk uma vez.
- **Permissões/visibilidade:**
  - no build de produção, o StrictMode não monta em dobro e `window.__JARVIS__` não existe (`import.meta.env.DEV` falso);
  - fora do DEV, `src/main.tsx` bloqueia o menu de contexto do navegador, exceto dentro de `[data-allow-context-menu]` (editores e terminais);
  - licença MIT: só o aviso de copyright acompanha o código.

## Uso no jvOS

### Raiz da UI (`src/main.tsx`)

Monta o `App` com o cliente do React DOM.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE montar a UI uma vez só, com `ReactDOM.createRoot(#root).render(<React.StrictMode><App /></React.StrictMode>)`.
  - Se o build não for DEV, então bloqueie o menu de contexto do navegador fora de `[data-allow-context-menu]`.

### Componentes e hooks (`src/components/`, `src/hooks/`)

Cerca de 95 arquivos importam `react`, e `src/hooks/` tem 23 hooks.

- **Comportamento:**
  - **RF-002**: Os componentes DEVEM ser funções com exports nomeados (só `App` usa `default`). Quem precisa de `ref` o recebe como prop do React 19 (`HeaderButton`, `TabStrip`, `Layer`), sem `forwardRef`. O `tsc` estrito com `jsx: "react-jsx"` confere as props.
  - Estado externo que muda muito entra por `useSyncExternalStore`: a store do jv_ide (`ide/context.ts`), o relógio da música (`useMusicPlayer`) e os medidores (`useSystemStats`). Assim só quem lê re-renderiza.
  - Medidas antes da pintura usam `useLayoutEffect` (câmera do 3D, menus).

### Apps e partes lazy (`src/components/desktop/lazyApps.tsx`)

Carrega os apps pesados só quando são usados.

- **Comportamento:**
  - **RF-003**: Cada app (Jarvis Mark, jv_ide, jv_T4p3, jv_sh, jv_lab, jv_agent) DEVE ser um `lazyApp(load)` com `preload()`. `preloadWindow(kind)` busca o chunk antes de abrir, e o componente mostrado é escolhido uma vez (`useState`), para não remontar o app.
  - O núcleo 3D (`JarvisScene`, em `src/App.tsx`), o histórico do JARVIS (`AssistantHistory`), o editor do jv_agent (`AgentEditor`) e os terminais do jv_ide e do jv_lab também são `lazy` com `Suspense`.

### Portal do menu de widget (`src/components/desktop/widgets/WidgetMenu.tsx`)

O único uso de `react-dom` além da raiz.

- **Comportamento:**
  - **RF-004**: O menu de opções de um widget DEVE sair por `createPortal` em `document.body` (ou no `container` recebido), para não ser cortado pelo `overflow` da janela.

## Restrições

- **RNF-001**: `react` e `react-dom` ficam travados no minor 19.3 (`~19.3.1`), resolvidos em 19.3.1, com uma cópia só no lock.
- **RNF-002**: O teto vem do peer do `@react-three/fiber` 9.8.2: `react >=19 <19.4` e `react-dom >=19 <19.4`. O motivo do `~` não está escrito no repositório (⚠ inferido — confirmar: casar com esse peer).
- **RNF-003**: `@types/react` e `@types/react-dom` 19.3.0 só entram no `tsc` (`strict`, `jsx: "react-jsx"`), nunca no bundle.
- **RNF-004**: Desempenho só se mede no build de release, porque o React de desenvolvimento e o StrictMode distorcem os números ([testing](../../../arch/testing.md#desempenho)).
- **RNF-005**: Licença MIT.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/main.tsx` | `createRoot`, `StrictMode`, menu de contexto bloqueado fora do DEV |
| `src/App.tsx` | Raiz da UI, `JarvisScene` lazy, `window.__JARVIS__` em DEV |
| `src/components/desktop/lazyApps.tsx` | `lazyApp`, `preloadWindow` |
| `src/components/desktop/Desktop.tsx` | `Suspense` das janelas, fallback "Carregando…" |
| `src/components/desktop/widgets/WidgetMenu.tsx` | O único `createPortal` |
| `src/components/desktop/apps/ide/context.ts` | `IdeContext` e os `useSyncExternalStore` do jv_ide |
| `src/lib/storage.ts` | `useStoredState`, a persistência com debounce |
| `src/lib/signals.ts` · `src/lib/dictation.ts` | `SignalsContext` e `DictationContext` |
| `src/hooks/use*.ts` | Os 23 hooks |
| `tsconfig.json` | `jsx: "react-jsx"`, `strict` |

### Testes

- `npm ls react react-dom @react-three/fiber`: uma cópia, sem `invalid` (critérios 1 e 7).
- `npm run build`: o `tsc` com os tipos do React (critério 5).
- `npm test`: a suíte inteira roda sobre o React, e o `waitForFrames` prova a montagem (critério 2).
- `npx playwright test tests/agent.spec.ts`: o pré-carregamento do jv_agent (critério 3).
- `npx playwright test tests/widgets.spec.ts`: o menu em portal (critério 6).
- Manual: abrir o jv_ide pelo Launcher logo depois de reiniciar o `dev:web` e ver "Carregando…" (critério 4).

### Atualização e reversão

- **Comando:** `npm i react@<versão> react-dom@<versão>` e `npm i -D @types/react@<versão> @types/react-dom@<versão>`. Depois, reinicie o `npm run dev:web` ([armadilhas](../../../arch/testing.md#armadilhas-conhecidas)).
- **Prova:** `npm ls react react-dom @react-three/fiber` sem `invalid`; `npm run build`; `npm test`, com atenção a `agent.spec.ts`, `desktop.spec.ts` e `core.spec.ts`, que dependem do `Suspense` e do 3D.
- **Sinal de volta:** `ERESOLVE` ou `invalid` no peer do fiber; o holograma 3D não monta; "Carregando…" preso ou flakes novos nos apps lazy.
- **Reversão:** `npm i react@19.3.1 react-dom@19.3.1` e `npm i -D @types/react@19.3.0 @types/react-dom@19.3.0`, ou o `package-lock.json` anterior com `npm ci`. Confira com `npm ls react`.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0011 — Fakes de DEV, E2E no modo web](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0012 — Apps lazy com preload](../../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0013 — Núcleo 2D por padrão, 3D opcional](../../../arch/adr/0013-nucleo-2d-padrao.md)

## Dependências

- **Vendor:** [vite-typescript](../vite-typescript/spec.md) (JSX, `@vitejs/plugin-react`, `tsc`), [three](../three/spec.md) (o peer do fiber limita o React), [motion](../motion/spec.md), [lucide](../lucide/spec.md), [markdown](../markdown/spec.md), [tauri](../tauri/spec.md) (a WebView2).
- **Specs:** [desktop-windows](../../../features/desktop-windows/spec.md) (apps lazy), [holographic-core](../../../features/holographic-core/spec.md), [jv_agent](../../../apps/jv_agent/spec.md), [stack](../../stack/spec.md).
- **Sistema:** WebView2 Runtime (156.0.4314.58 nesta máquina).

## Pendências

- [ ] Não há error boundary em `src/` (nenhum `componentDidCatch` ou `getDerivedStateFromError`). Um erro de render, ou um chunk lazy que falha ao baixar, desmonta a árvore inteira e deixa a tela preta. Arquivos: `src/components/desktop/lazyApps.tsx`, `src/App.tsx`.
