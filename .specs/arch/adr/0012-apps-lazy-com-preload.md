# ADR-0012: Apps carregados sob demanda, com pré-carregamento

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-27 (`lazyApps.tsx`, commitado em `e7151cf`) |
| **Origem** | `src/components/desktop/lazyApps.tsx`; memória `jarvis-playwright-workflow` |

## Contexto

Os apps (jv_ide com CodeMirror e várias linguagens, jv_sh com xterm, Jarvis Mark, jv_lab, jv_agent, jv_T4p3) somam a maior parte do JavaScript. Carregar tudo com o holograma atrasa a abertura e gasta memória à toa.

O primeiro `React.lazy` direto tinha um problema: o React 19 mantém o fallback do Suspense por **pelo menos 300 ms** (`FALLBACK_THROTTLE_MS`), por mais rápido que o chunk chegue. No `agent.spec.ts`, o chunk do jv_agent puxava o CodeMirror e montava depois do fim do stream do fake, e o teste falhava de forma intermitente.

## Decisão

- Cada app é um `lazyApp(load)`, que expõe `preload()`. `preloadWindow(kind)` busca o chunk **antes** de abrir a janela. Se ele já chegou, a janela mostra o app na hora, sem passar pelo Suspense.
- Hoje só a abertura disparada por um arquivo que o JARVIS está escrevendo (`onAssistantFile` em `App.tsx`: Notas → Jarvis Mark, Agentes → jv_agent) chama `preloadWindow` e só então abre. É o caminho em que perder o começo do stream importa. Pelo Launcher, pela voz ou pela busca, o app abre direto e passa pelo fallback "Carregando…".
- Partes pesadas e opcionais de um app ficam em chunk próprio. Exemplo: o editor CodeMirror do jv_agent vive na aba [2].
- O núcleo 3D (`JarvisScene`) também é lazy e só carrega quando o modo é `3d` ([ADR-0013](0013-nucleo-2d-padrao.md)).

## Consequências

- **Positivas:** abertura rápida do jvOS; os apps aparecem sem "Carregando…" quando pré-carregados.
- **Negativas:** a primeira abertura de cada app ainda paga o download do chunk, e há mais um caminho de código (preload + open).
- **Regras:**
  - app novo entra em `lazyApps.tsx`;
  - não "conserte" flakes de estado transitório deixando os fakes mais lentos; meça a abertura.

## Alternativas consideradas

`React.lazy` simples: substituído pelo motivo acima.

## Referências

- `src/components/desktop/lazyApps.tsx`, `src/components/desktop/Desktop.tsx`, `src/App.tsx`
- Spec: [desktop-windows](../../features/desktop-windows/spec.md)
