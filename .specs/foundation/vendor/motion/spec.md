# Vendor: Motion

O Motion (antigo Framer Motion) anima as entradas e saídas da UI do jvOS: janelas, painéis, busca, dock, boot e o liga do núcleo 2D.

| | |
|---|---|
| **ID** | `vendor/motion` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `motion` 14.4.0 (declarada `^14.4.0`)<br>Traz `framer-motion` 14.4.0, `motion-dom` 14.4.0 e `motion-utils` 14.1.1 |
| **Licença** | MIT |
| **Fonte** | https://motion.dev (https://github.com/motiondivision/motion) |
| **Onde roda** | WebView2 (16 arquivos importam `motion/react`) |

## Objetivo

As janelas e os painéis do jvOS aparecem e somem com transições curtas, e o dock amplia os ícones sob o mouse como no macOS. O `motion/react` dá isso com `AnimatePresence` (animar a saída antes de desmontar), molas e `MotionConfig`, que respeita a opção de reduzir movimento do Windows. A escolha da biblioteca não tem ADR (⚠ inferido — confirmar).

## Não-objetivos

- Animação contínua não passa pelo Motion. O núcleo 2D gira em CSS (`.core-spin`) e recebe quadros do `runFrames`, e o 3D é do three.js ([ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)).
- Sem gestos de arrastar do Motion (`drag`): janelas e widgets arrastam por `usePointerDrag`.
- Sem animações de rolagem (`useScroll`) nem `Reorder`.
- O texto do JARVIS e da saudação no estilo SUPERHOT usa `@utility superhot-*` em CSS, não o Motion. Do Motion, essas telas só leem `useReducedMotion`.

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `package-lock.json` atual
- **Quando** rodo `npm ls motion framer-motion`
- **Então** sai `motion@14.4.0` com um único `framer-motion@14.4.0` embaixo, sem `invalid`.

### Critério 2 (RF-002)

- **Dado** o dock com "Ampliar ícones" ligado
- **Quando** paro o mouse sobre o botão "Settings" e espero 500 ms
- **Então** a escala do ícone passa de 1,15. Prova: `tests/dock.spec.ts`, "the icon magnification can be turned off".

### Critério 3 (RF-002)

- **Dado** o switch "Ampliar ícones" desligado na aba Dock do Menu avançado
- **Quando** paro o mouse sobre o mesmo botão
- **Então** a escala fica em 1, e `magnify: false` é gravado. Mesma prova do critério 2.

### Critério 4 (RF-003)

- **Dado** um widget aberto
- **Quando** eu o fecho
- **Então** a janela sai pela animação de saída (opacidade 0, escala 0,97, 0,15 s) e só depois deixa o DOM, porque o `Desktop` envolve as janelas em `AnimatePresence`. Prova: `tests/desktop.spec.ts`, "a widget opens once, shows the time and closes".

### Critério 5 (RF-001)

- **Dado** o Windows com "Efeitos de animação" desligados (`prefers-reduced-motion: reduce`)
- **Quando** o boot roda
- **Então** o POST aparece de uma vez e fica 1,1 s (`REDUCED_HOLD`) antes da tela de partida, a resposta do JARVIS e a saudação mostram todas as palavras de uma vez, e as janelas abrem sem animar posição e escala (`MotionConfig reducedMotion="user"`).

### Critério 6 (RF-004)

- **Dado** a busca (`/`) aberta
- **Quando** aperto Esc
- **Então**, durante a animação de saída, o painel fica `inert` e `aria-hidden` (`useIsPresent`), e nenhum locator nem o teclado o alcançam.

## Casos de borda

- **Vazio/nulo:** `useReducedMotion()` devolve `null` antes de saber a preferência → o jvOS trata como `false` (`?? false`) e anima.
- **Duplicidade/idempotência:**
  - abrir uma janela que já está aberta não cria outra: há uma janela por `WindowKind`, e a `key` do `AnimatePresence` é o `kind`;
  - o `layoutId` do indicador de aba (`advanced-tab`) e dos segmentos (`segment-<rótulo>`) existe uma vez por grupo, para a marca deslizar entre as opções.
- **Concorrência/corrida:**
  - fechar uma janela no meio da entrada: o `AnimatePresence` troca para a saída e desmonta no fim;
  - no dock, o aviso substitui o rótulo só depois de o rótulo sair, para os dois nunca se sobreporem (`QuickDock.tsx`).
- **Permissões/visibilidade:** o Motion segue a preferência do sistema (`reducedMotion="user"`). Ele não tem opção própria no jvOS. Licença MIT.

## Uso no jvOS

### Configuração global (`src/App.tsx`)

- **Comportamento:**
  - **RF-001**: A raiz da UI DEVE ficar dentro de `<MotionConfig reducedMotion="user">`, para toda animação do Motion respeitar o "reduzir movimento" do Windows.
  - Os componentes com tempo próprio leem `useReducedMotion()`: o boot (`REDUCED_HOLD` de 1100 ms), a saudação (`Greeting`), a resposta do JARVIS (`JarvisReply`) e as bobinas da fita (`useTapeTick`, que param).

### Dock (`src/components/QuickDock.tsx`)

- **Comportamento:**
  - **RF-002**: A ampliação DEVE seguir o mouse com `useMotionValue`, `useTransform` (distâncias `[-150, -70, 0, 70, 150]` para escalas `[1, 1.1, 1.32, 1.1, 1]`) e `useSpring` (`stiffness: 380`, `damping: 26`, `mass: 0.35`). O ícone sobe junto (`lift`).
  - Os rótulos e avisos do dock entram com `AnimatePresence` (0,2 s na entrada e 0,12 s na saída).

### Janelas (`src/components/desktop/Window.tsx`, `src/components/desktop/Desktop.tsx`)

- **Comportamento:**
  - **RF-003**: Cada janela DEVE ser um `motion.section` que entra de opacidade 0, escala 0,96 e 6 px abaixo em 0,2 s (`easeOut`) e sai para opacidade 0 e escala 0,97 em 0,15 s, dentro do `AnimatePresence` do `Desktop`.

### Painéis e busca (`SettingsPanel.tsx`, `AdvancedMenu.tsx`, `Spotlight.tsx`, `AssistantDrawer.tsx`, `VoiceCaption.tsx`)

- **Comportamento:**
  - Os painéis entram e saem com `AnimatePresence`.
  - **RF-004**: A busca DEVE ficar `inert` e `aria-hidden` enquanto sai (`useIsPresent`).
  - O Menu avançado e o controle segmentado de `hud.tsx` usam `layoutId` para a marca da opção ativa.

### Boot e núcleo 2D (`BootSequence.tsx`, `FlatCore.tsx`, `Taskbar.tsx`)

- **Comportamento:**
  - O `FlatCore` liga de escala 0,001, giro de -270° e opacidade 0 até o normal em 1,5 s (`ease: "backOut"`).
  - O boot usa `motion` para a tela CRT ligar e os fades.

## Restrições

- **RNF-001**: `motion` 14.4.0, com um só `framer-motion` 14.4.0 no lock. O peer aceita `react` e `react-dom` `^18 || ^19`.
- **RNF-002**: O Motion entra no chunk principal (`index-*.js`, 694.544 bytes no build de 04/11), porque a janela, o dock e o núcleo 2D o importam desde a partida.
- **RNF-003**: As transições de UI ficam entre 0,12 s e 0,2 s. A exceção é o liga do núcleo 2D, de 1,5 s.
- **RNF-004**: Licença MIT.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/App.tsx` | `MotionConfig reducedMotion="user"`, `AnimatePresence` da UI do núcleo |
| `src/components/QuickDock.tsx` | Ampliação com molas e rótulos do dock |
| `src/components/desktop/Window.tsx` · `Desktop.tsx` | Entrada e saída das janelas |
| `src/components/Spotlight.tsx` | `useIsPresent`, `inert` na saída |
| `src/components/SettingsPanel.tsx` · `desktop/AdvancedMenu.tsx` · `hud.tsx` | Painéis e `layoutId` |
| `src/components/AssistantDrawer.tsx` · `VoiceCaption.tsx` · `Taskbar.tsx` | Gaveta do histórico, legenda da voz, barra superior |
| `src/components/BootSequence.tsx` · `FlatCore.tsx` · `Greeting.tsx` · `JarvisReply.tsx` · `src/hooks/useTapeTick.ts` | Boot, liga do núcleo e `useReducedMotion` |

### Testes

- `npm ls motion framer-motion` (critério 1).
- `npx playwright test tests/dock.spec.ts` (critérios 2 e 3).
- `npx playwright test tests/desktop.spec.ts` (critério 4).
- `npx playwright test tests/search.spec.ts`: a busca abre e fecha (critério 6).
- Manual com `page.emulateMedia({ reducedMotion: "reduce" })` ou a opção do Windows (critério 5).

### Atualização e reversão

- **Comando:** `npm i motion@<versão>`. Depois, reinicie o `npm run dev:web`.
- **Prova:** `npm ls motion framer-motion`; `npm run build`; `npm test`, com atenção a `dock.spec.ts`, `desktop.spec.ts`, `search.spec.ts` e `boot.spec.ts`, que dependem do tempo das transições.
- **Sinal de volta:** a escala do dock fica abaixo de 1,15 no teste; janelas fechadas continuam no DOM; a busca recebe foco durante a saída; mudanças de API em `motion/react` quebram o `tsc`.
- **Reversão:** `npm i motion@14.4.0` e conferir com `npm ls motion`.

### Decisões relacionadas

- [ADR-0022 — Núcleo com relógio de quadros limitado, canvas 3D recortado e UI em D3D11](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)

## Dependências

- **Vendor:** [react](../react/spec.md) (peer), [tailwind](../tailwind/spec.md) (as animações em CSS que o Motion não faz).
- **Specs:** [desktop-windows](../../../features/desktop-windows/spec.md), [dock-taskbar](../../../features/dock-taskbar/spec.md), [search](../../../features/search/spec.md), [settings](../../../features/settings/spec.md), [boot](../../../features/boot/spec.md), [holographic-core](../../../features/holographic-core/spec.md), [greeting-homecoming](../../../features/greeting-homecoming/spec.md).
- **Sistema:** a opção "Efeitos de animação" do Windows (`prefers-reduced-motion`).

## Pendências

- [ ] Nenhum teste emula `prefers-reduced-motion: reduce`, então o caminho com movimento reduzido (`MotionConfig`, `REDUCED_HOLD`, palavras de uma vez) não tem cobertura em `tests/`.
