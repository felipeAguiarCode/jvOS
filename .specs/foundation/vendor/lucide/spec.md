# Vendor: Lucide

O `lucide-react` dá os ícones em SVG do jvOS: dock, Launcher, barras de ferramentas dos apps, widgets, busca e clima.

| | |
|---|---|
| **ID** | `vendor/lucide` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `lucide-react` 1.59.0 (declarada `^1.59.0`) |
| **Licença** | ISC |
| **Fonte** | https://lucide.dev (https://github.com/lucide-icons/lucide, pasta `packages/lucide-react`) |
| **Onde roda** | WebView2 (24 arquivos importam `lucide-react`, 89 ícones diferentes) |

## Objetivo

O jvOS precisa de ícones de traço fino que herdem a cor do tema `hud-*` e que só pesem pelo que usa. O `lucide-react` exporta cada ícone como um componente React que desenha em `currentColor` e sai do bundle quando não é importado. A escolha não tem ADR; o guia de estilo só registra "Ícones `lucide-react`" ([coding-style](../../../arch/coding-style.md)), e o motivo é ⚠ inferido — confirmar.

## Não-objetivos

- Sem carga dinâmica de ícones (`DynamicIcon`, `lucide-react/dynamic`): todo ícone é um import nomeado e estático.
- Sem `LucideProvider`: tamanho, traço e cor vão em cada uso (`size`, `strokeWidth`, `className`).
- Sem ícones de marca nem fonte de ícones. Os logos que o jvOS mostra (emblema do JARVIS, núcleo) são SVG e CSS próprios.

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `package-lock.json` atual
- **Quando** rodo `npm ls lucide-react`
- **Então** sai `lucide-react@1.59.0`, uma cópia só, com o `react@19.3.1` `deduped`.

### Critério 2 (RF-001)

- **Dado** o `npm run build`
- **Quando** olho `dist/assets`
- **Então** o código comum do Lucide está num chunk pequeno (`createLucideIcon-*.js`, 3.088 bytes no build de 04/11), e só os 89 ícones importados entram no bundle (`sideEffects: false`).

### Critério 3 (RF-002)

- **Dado** a troca da cor do JARVIS nas Configurações
- **Quando** o tema muda
- **Então** os ícones do dock e das janelas mudam junto, porque desenham em `currentColor` e herdam a classe `text-hud-*` do pai. Prova: `tests/settings.spec.ts`, "the JARVIS color recolours the hologram and the interface, and persists", com a captura em `test-results/screens`.

### Critério 4 (RF-003)

- **Dado** um botão só com ícone, como o "Settings" do dock
- **Quando** um leitor de tela ou um locator procura pelo nome
- **Então** o nome vem do `aria-label` ou do `title` do botão, e o `<svg>` sai com `aria-hidden="true"`, que o Lucide põe quando o ícone não recebe prop de acessibilidade. Prova: os locators `getByRole("button", { name: "Settings" })` de `tests/dock.spec.ts`.

### Critério 5 (RNF-002)

- **Dado** uma versão nova que remove ou renomeia um ícone importado (`History`, `Trash2`, `Loader2` e `Music` já são aliases na 1.59.0)
- **Quando** rodo `npm run build`
- **Então** o `tsc` falha no import nomeado, antes do `vite build`, e o nome que sumiu aparece no erro.

### Critério 6 (RF-004)

- **Dado** o código WMO 0 (céu limpo) com `day = false`
- **Quando** chamo `describeWeather(0, false)`
- **Então** sai o texto "céu limpo" com o ícone `Moon` (de dia, `Sun`), e os códigos 61 a 67 saem com `CloudRain`. O widget do clima desenha esse ícone em `text-hud-cyan`. Prova: `tests/feeds.spec.ts`, "tickers, prices and the weather in words", confere o texto; o ícone se confere à mão.

## Casos de borda

- **Vazio/nulo:** um item de registro sem ícone não compila: `icon: LucideIcon` é obrigatório em `WindowSpec` (`src/lib/desktop.ts`) e em `SearchItem` (`src/lib/search.ts`).
- **Duplicidade/idempotência:** o mesmo ícone em vários arquivos entra uma vez no bundle; um alias e o nome novo (`Loader2` e `LoaderCircle`) apontam para o mesmo módulo.
- **Concorrência/corrida:** os ícones são SVG síncronos, sem carga de rede nem de fonte, e por isso não piscam na primeira pintura.
- **Permissões/visibilidade:**
  - o `<svg>` não tem nome acessível próprio (`aria-hidden="true"`), então todo botão só com ícone precisa de `aria-label` ou `title` em PT-BR;
  - licença ISC: só o aviso de copyright, que segue no cabeçalho dos módulos (`@license lucide-react v1.59.0 - ISC`).

## Uso no jvOS

### Registros de janelas, comandos e busca (`src/lib/desktop.ts`, `src/lib/commands.ts`, `src/lib/search.ts`)

- **Comportamento:**
  - **RF-001**: O jvOS DEVE importar cada ícone por nome (`import { Clock, Music } from "lucide-react"`) e guardar o componente nos registros com o tipo `LucideIcon`: o `icon` de cada `WindowKind`, das ações de arranjo e dos itens da busca.

### Componentes (`QuickDock.tsx`, `Launcher.tsx`, `Window.tsx`, `Taskbar.tsx`, `SettingsPanel.tsx`, `AdvancedMenu.tsx`, `editorChrome.tsx`, `MarkdownEditor.tsx`, `ShellApp.tsx`, widgets)

- **Comportamento:**
  - **RF-002**: Os ícones DEVEM herdar a cor do pai (`currentColor` com `text-hud-*`), sem cor fixa. O tamanho e o traço vão em cada uso: o dock usa `size={30}`, as abas do jv_sh 10 a 12 px e a barra do Jarvis Mark 14 a 15 px.
  - **RF-003**: Um botão só com ícone DEVE ter nome acessível em PT-BR (`aria-label` ou `title`), porque o Lucide marca o `<svg>` como `aria-hidden`.
  - O `Loader2` gira com `animate-spin` no progresso de download do modelo (`SettingsPanel.tsx`).

### Clima (`src/lib/feeds.ts`)

- **Comportamento:**
  - **RF-004**: `describeWeather(code, day)` DEVE traduzir o código WMO em texto e num ícone do Lucide (`Sun`, `Moon`, `Cloud`, `CloudSun`, `CloudMoon`, `CloudFog`, `CloudDrizzle`, `CloudRain`, `CloudSnow`, `CloudLightning`), com a lua à noite.

## Restrições

- **RNF-001**: `lucide-react` 1.59.0 (`^1.59.0`). O peer aceita `react ^16.5.1 || ^17 || ^18 || ^19`.
- **RNF-002**: Quatro ícones entram por nomes que, na 1.59.0, são aliases: `History` (`RotateCcwClock`), `Trash2` (`Trash`), `Loader2` (`LoaderCircle`) e `Music` (`EighthNotes`). O `FileIcon` é o sufixo `Icon` de `File`, usado para não colidir com o `File` do DOM.
- **RNF-003**: Só os ícones importados vão para o bundle, mais o chunk `createLucideIcon-*.js` de 3.088 bytes.
- **RNF-004**: Licença ISC.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/desktop.ts` | `icon: LucideIcon` de cada `WindowKind` |
| `src/lib/commands.ts` · `src/lib/search.ts` | Ícones das ações e dos resultados da busca |
| `src/lib/feeds.ts` | `describeWeather`: código WMO → ícone |
| `src/components/QuickDock.tsx` · `Taskbar.tsx` · `desktop/Launcher.tsx` · `desktop/Window.tsx` | Dock, barra superior, Launcher e botões da janela |
| `src/components/desktop/apps/editorChrome.tsx` · `MarkdownEditor.tsx` · `ShellApp.tsx` · `agent/AgentApp.tsx` · `lab/LessonLab.tsx` | Barras de ferramentas dos apps |
| `src/components/desktop/widgets/*.tsx` | Agenda, Calculadora, Ações, Tarefas e Clima |
| `src/components/SettingsPanel.tsx` · `desktop/AdvancedMenu.tsx` · `desktop/VoiceTab.tsx` · `hud.tsx` · `Spotlight.tsx` · `AssistantDrawer.tsx` | Painéis e controles |

### Testes

- `npm ls lucide-react` (critério 1).
- `npm run build` e conferir `createLucideIcon-*.js` em `dist/assets` (critérios 2 e 5).
- `npx playwright test tests/settings.spec.ts` (critério 3).
- `npx playwright test tests/dock.spec.ts` (critério 4).
- `npx playwright test tests/feeds.spec.ts` (critério 6).

### Atualização e reversão

- **Comando:** `npm i lucide-react@<versão>`.
- **Prova:** `npm run build` sem erro de import; `npm test`; comparar as capturas de `test-results/screens` do dock, do Launcher e dos apps.
- **Sinal de volta:** o `tsc` acusa um ícone que não existe mais; um ícone muda de desenho a ponto de confundir (as capturas mostram); o chunk do Lucide cresce sem ícone novo.
- **Reversão:** `npm i lucide-react@1.59.0`.

## Dependências

- **Vendor:** [react](../react/spec.md) (peer), [tailwind](../tailwind/spec.md) (as classes `text-hud-*` que dão a cor).
- **Specs:** [dock-taskbar](../../../features/dock-taskbar/spec.md), [desktop-windows](../../../features/desktop-windows/spec.md), [search](../../../features/search/spec.md), [app-launcher](../../../features/app-launcher/spec.md), [weather](../../../widgets/weather/spec.md), [jarvis-mark](../../../apps/jarvis-mark/spec.md), [jv_sh](../../../apps/jv_sh/spec.md).
- **Sistema:** nenhum além da WebView2.

## Pendências

- [ ] Quatro ícones são importados por nomes de alias na 1.59.0 (`History`, `Trash2`, `Loader2`, `Music`). Se uma versão futura tirar os aliases, o `tsc` quebra. Arquivos: `src/components/AssistantDrawer.tsx` (`History`, `Trash2`), `src/components/SettingsPanel.tsx` (`Trash2`, `Loader2`), `src/components/desktop/VoiceTab.tsx` (`Trash2`) e `src/lib/commands.ts` (`Music`).
