# ADR-0013: Núcleo 2D por padrão, 3D opcional, ou desligado

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-26 |
| **Origem** | commit `c4ccc57` ("2D reactor core by default"); `src/lib/core.ts` |

## Contexto

O holograma 3D (Three.js com bloom, partículas, anéis orbitais e shaders próprios) é a assinatura visual do jvOS, mas é o que mais consome GPU e memória. Ele disputa recursos com o Whisper, com o `claude.exe` e com os apps num notebook com uma MX570 de 2 GB.

## Decisão

- `CoreMode = "3d" | "2d" | "off"`, guardado em `jarvis.core`. O **padrão é `2d`**: o `FlatCore`, um reator vetorial sem WebGL.
- O `3d` carrega `JarvisScene` de forma preguiçosa, só quando escolhido. A qualidade (`jarvis.quality`) segue esta ordem: parâmetro `?quality=`, depois o valor salvo, depois um palpite pela GPU. Ela rebaixa sozinha com FPS baixo, e Ctrl+Shift+Q alterna os níveis.
- O `off` não desenha o núcleo.
- O texto de ajuda do menu explica a troca: o 3D "é o que mais usa memória".

## Consequências

- **Positivas:**
  - leve por padrão;
  - quem quer o visual completo liga o 3D no Menu avançado → Núcleo;
  - o chunk Three.js não é baixado no modo 2D.
- **Negativas:**
  - dois renderizadores do mesmo núcleo para manter em sincronia: reação à voz, estados da conversa e cores do tema;
  - os testes de pixel (`core.spec`, `ui.spec`) usam o 3D, semeado pelo `storageState` do Playwright.
- **Regras:** toda reação visual do núcleo (fase, voz, tema) precisa existir no 2D e no 3D.

## Alternativas consideradas

O 3D como padrão: foi o comportamento até `c4ccc57`, e foi trocado pelo custo.

## Referências

- `src/lib/core.ts`, `src/lib/quality.ts`, `src/components/FlatCore.tsx`, `src/components/JarvisScene.tsx`
- Spec: [holographic-core](../../features/holographic-core/spec.md)
