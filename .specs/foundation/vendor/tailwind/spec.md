# Vendor: Tailwind CSS

O Tailwind CSS 4 gera, no build, as classes utilitárias com que toda a UI do jvOS é estilizada, a partir dos tokens `hud-*` e das `@utility` de `src/styles/globals.css`.

| | |
|---|---|
| **ID** | `vendor/tailwind` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `tailwindcss` 4.3.3 (declarada `^4.3.3`, dev)<br>`@tailwindcss/vite` 4.3.3 (declarada `^4.3.3`, dev) |
| **Licença** | MIT (os dois pacotes) |
| **Fonte** | https://tailwindcss.com (https://github.com/tailwindlabs/tailwindcss) |
| **Onde roda** | build (plugin do Vite, com o binário nativo `@tailwindcss/oxide-win32-x64-msvc`) · WebView2 (o CSS gerado) |

## Objetivo

Toda janela, widget e painel do jvOS segue uma linguagem visual única, com as cores vindas só dos tokens `hud-*` e trocadas em tempo de execução pelo tema ([ADR-0014](../../../arch/adr/0014-linguagem-visual-tui.md), princípio P8). O Tailwind 4 resolve isso com classes inline que leem `var(--color-hud-*)`, configuradas no próprio CSS, sem arquivo JavaScript. A escolha do Tailwind em si não tem ADR (⚠ inferido — confirmar).

## Não-objetivos

- Sem `tailwind.config.js`, `@plugin`, `@source` ou `@custom-variant`. A configuração é só `@import "tailwindcss"`, um bloco `@theme` e 20 `@utility` em `src/styles/globals.css`.
- Sem cores fixas nas classes (`bg-[#…]`): as classes usam os tokens `hud-*`.
- Sem tema claro nem variante `dark:`. O jvOS é só escuro (`<meta name="color-scheme" content="dark">`).
- Sem fontes remotas. As famílias de `--font-hud` e `--font-mono` são do Windows, e a VT323 vem empacotada.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o `npm run build`
- **Quando** abro `dist/assets/index-*.css`
- **Então** ele tem `.text-hud-cyan{color:var(--color-hud-cyan)}`, e as 11 cores de `@theme` saem como variáveis `--color-hud-*` (95.376 bytes no build de 04/11).

### Critério 2 (RF-002)

- **Dado** o jvOS no tema azul
- **Quando** troco a cor do JARVIS nas Configurações
- **Então** `getComputedStyle(document.documentElement).getPropertyValue("--color-hud-cyan")` muda, e as classes `text-hud-*`, `bg-hud-*` e `border-hud-*` mudam junto, sem re-render. Prova: `tests/settings.spec.ts`, "the JARVIS color recolours the hologram and the interface, and persists".

### Critério 3 (RF-003)

- **Dado** uma classe com opacidade, como `border-hud-cyan/10`
- **Quando** o build gera o CSS
- **Então** saem duas regras: `border-color:#00cafd1a` (o azul fixo, fallback) e, dentro de `@supports (color:color-mix(in lab, red, red))`, `border-color:color-mix(in oklab, var(--color-hud-cyan) 10%, transparent)`. A WebView2 aplica a segunda, e por isso a opacidade também segue o tema.

### Critério 4 (RF-004)

- **Dado** o jv_ide aberto e um acento TUI escolhido no Menu avançado
- **Quando** leio `--color-hud-light` em `[data-window="ide"]`
- **Então** o valor difere do de `document.documentElement`: `tuiSurface()` redefine os tokens só naquela subárvore. Prova: `tests/tui.spec.ts`, "the TUI tab switches the editors' glow and aberration and sets their accent".

### Critério 5 (RF-001)

- **Dado** uma classe com um token que não existe, como `text-hud-cian`
- **Quando** rodo `npm run build`
- **Então** o build passa e o `index-*.css` não tem regra para ela. O erro só aparece na tela, porque o Tailwind ignora classes que não reconhece.

### Critério 6 (RNF-003)

- **Dado** o Windows com "Efeitos de animação" desligados (`prefers-reduced-motion: reduce`)
- **Quando** o boot ou o núcleo 2D aparecem
- **Então** as utilidades `crt-flicker`, `crt-noise` e `crt-roll` e a classe `.core-spin` ficam sem animação, pelos blocos `@media (prefers-reduced-motion: reduce)` de `globals.css`.

## Casos de borda

- **Vazio/nulo:**
  - classe com token inexistente → nenhuma regra, sem erro (critério 5);
  - antes de `applyTheme` rodar, valem os valores do `@theme` (tema azul), e o `index.html` já pinta o `body` de `#000508` para a janela não piscar.
- **Duplicidade/idempotência:**
  - a mesma classe em muitos arquivos vira uma regra só;
  - o `@theme` define os tokens em `:root`, e `applyTheme` os sobrescreve no `style` inline de `<html>`, que tem precedência. Chamar o tema duas vezes só regrava os mesmos valores.
- **Concorrência/corrida:** a troca de tema com janelas abertas recolore as classes na hora. O CodeMirror lê as mesmas variáveis por `var()`, e o xterm as relê por um `MutationObserver` no `style` de `<html>` e da janela.
- **Permissões/visibilidade:**
  - a CSP de produção tem `style-src 'self' 'unsafe-inline'`, o que permite o `style` inline que `applyTheme` e `tuiSurface()` escrevem;
  - num navegador sem `color-mix` (antes do Chromium 111), as classes com opacidade ficariam presas no azul do fallback. A WebView2 desta máquina é a 156;
  - o `@tailwindcss/vite` depende de um binário nativo de Windows x64.

## Uso no jvOS

### Plugin do Vite (`vite.config.ts`)

- **Comportamento:**
  - O Vite carrega `tailwindcss()` de `@tailwindcss/vite` depois de `react()`. O plugin acha as classes nos fontes sozinho, sem `@source`.

### Tokens e utilidades (`src/styles/globals.css`)

O único arquivo de configuração do Tailwind, importado em `src/main.tsx`.

- **Comportamento:**
  - **RF-001**: O `@theme` DEVE definir as 11 cores `--color-hud-{void,abyss,panel,cyan,holo,light,line,glow,text,alert,amber}` e as três fontes `--font-hud` (Segoe UI Variable), `--font-mono` (Cascadia Code, Consolas) e `--font-bios` (VT323). Delas saem `text-hud-*`, `bg-hud-*`, `border-hud-*`, `font-mono` e `font-bios`.
  - As 20 `@utility` próprias são `hud-input`, `hud-range`, `hud-scroll`, `crt-screen`, `crt-text`, `crt-flicker`, `crt-glitch`, `crt-cursor`, `crt-scanlines`, `crt-mask`, `crt-noise`, `crt-roll`, `crt-glass`, `superhot-text`, `superhot-word`, `superhot-out`, `lights-on`, `tui-surface`, `tui-glow` e `tui-aberration`.
  - A base fixa `html`, `body` e `#root` em 100% de altura, sem rolagem, com fundo `--color-hud-void` e `user-select: none`.
  - **RF-003**: As cores com opacidade (`/10`, `/25`…) DEVEM depender de `color-mix` sobre a variável, e não do hex do fallback.

### Tema em tempo de execução (`src/lib/theme.ts`)

- **Comportamento:**
  - **RF-002**: `applyTheme(theme, hue)` DEVE escrever cada `--color-hud-<token>` em `document.documentElement.style` e avisar os ouvintes (as cores do 3D). As classes mudam sem re-render.

### Acento TUI por janela (`src/lib/tui.ts`)

- **Comportamento:**
  - **RF-004**: `tuiSurface(prefs)` DEVE devolver as classes `tui-surface`, `tui-glow` e `tui-aberration` conforme as prefs, e, com um acento escolhido, um `style` com os `--color-hud-*` de `paletteFromHue(hue)`, que vale só dentro da janela.

### Código fora das classes (`src/lib/editorTheme.ts`, `src/components/desktop/apps/terminal/TerminalView.tsx`)

- **Comportamento:**
  - O CodeMirror e o xterm não usam classes do Tailwind. Eles leem os mesmos `--color-hud-*` (`var()` no tema do editor, `getComputedStyle` no terminal), e por isso esses nomes de variável são o contrato.

## Restrições

- **RNF-001**: `tailwindcss` e `@tailwindcss/vite` andam juntos na 4.3.3. O peer do plugin aceita `vite ^5.2.0 || ^6 || ^7 || ^8`.
- **RNF-002**: O CSS gerado tem 95.376 bytes (`index-*.css`, build de 04/11), já com o `@font-face` da VT323. O CSS do xterm sai à parte, em `TerminalView-*.css` (3.529 bytes).
- **RNF-003**: Toda animação contínua em CSS respeita `prefers-reduced-motion: reduce`.
- **RNF-004**: Superfícies que ficam sempre na tela sobre o núcleo não usam `backdrop-filter`, e o glow TUI tem um só halo de 0,36em ([ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)).
- **RNF-005**: Licença MIT. O Tailwind só roda no build.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/styles/globals.css` | `@import "tailwindcss"`, `@theme`, as 20 `@utility`, keyframes e base |
| `vite.config.ts` | Plugin `tailwindcss()` |
| `src/main.tsx` | Importa `./styles/globals.css` |
| `src/lib/theme.ts` | `applyTheme`, `currentPalette`, `onPalette` |
| `src/lib/tui.ts` | `tuiSurface`, os acentos TUI por janela |
| `src/components/**/*.tsx` | As classes inline (`text-hud-text` é a mais usada) |

### Testes

- `npm run build` e conferir `dist/assets/index-*.css` (critérios 1, 3 e 5).
- `npx playwright test tests/settings.spec.ts`: a troca de cor (critério 2).
- `npx playwright test tests/tui.spec.ts`: o acento por janela (critério 4).
- `npx playwright test tests/desktop.spec.ts`: "the advanced menu tunes snapping, arranges windows and sets a custom hue".
- Manual com `page.emulateMedia({ reducedMotion: "reduce" })` ou a opção do Windows: critério 6.

### Atualização e reversão

- **Comando:** `npm i -D tailwindcss@<versão> @tailwindcss/vite@<versão>`, sempre a mesma versão nos dois. Depois, reinicie o `npm run dev:web`.
- **Prova:** `npm run build`; a regra `.text-hud-cyan{color:var(--color-hud-cyan)}` e o bloco `@supports` de `color-mix` no CSS gerado; `npm test`, com atenção às capturas em `test-results/screens` e aos testes que medem pixels (`core.spec.ts`, `ui.spec.ts`).
- **Sinal de volta:** uma `@utility` deixa de ser gerada; as opacidades saem só com o hex fixo; diferenças visuais nas capturas.
- **Reversão:** `npm i -D tailwindcss@4.3.3 @tailwindcss/vite@4.3.3`.

### Decisões relacionadas

- [ADR-0014 — Linguagem visual TUI](../../../arch/adr/0014-linguagem-visual-tui.md)
- [ADR-0022 — Núcleo com relógio de quadros limitado, canvas 3D recortado e UI em D3D11](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)

## Dependências

- **Vendor:** [vite-typescript](../vite-typescript/spec.md) (o plugin roda dentro do Vite), [vt323](../vt323/spec.md) (`--font-bios`), [codemirror](../codemirror/spec.md) e [terminal](../terminal/spec.md) (leem os mesmos tokens).
- **Specs:** [appearance](../../../features/appearance/spec.md) (temas e TUI), [desktop-windows](../../../features/desktop-windows/spec.md), [boot](../../../features/boot/spec.md) (utilidades `crt-*`), [holographic-core](../../../features/holographic-core/spec.md) (`core-spin` do núcleo 2D), [stack](../../stack/spec.md).
- **Sistema:** fontes Segoe UI Variable e Cascadia Code do Windows 11; WebView2 com `color-mix` (Chromium 111 ou mais novo).

## Pendências

- Nenhuma por enquanto.
