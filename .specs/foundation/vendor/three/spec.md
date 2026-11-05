# Vendor: three.js e React Three Fiber

O three.js, o React Three Fiber e o postprocessing desenham o holograma 3D do JARVIS (núcleo em malha, anéis orbitais, partículas, onda de voz e bloom), carregado só quando o núcleo está no modo `3d`.

| | |
|---|---|
| **ID** | `vendor/three` |
| **Tipo** | Lib npm |
| **Status** | Opcional (só com o núcleo 3D; o padrão é o 2D) |
| **Versão** | `three` 0.186.1 (declarada `~0.186.1`)<br>`@types/three` 0.186.0 (declarada `~0.186.0`, dev)<br>`@react-three/fiber` 9.8.2 (declarada `^9.8.2`)<br>`@react-three/postprocessing` 3.2.1 (declarada `^3.2.1`)<br>`postprocessing` 6.39.5 (declarada `^6.39.5`) |
| **Licença** | MIT (`three`, `@types/three`, `@react-three/fiber`, `@react-three/postprocessing`) · Zlib (`postprocessing`) |
| **Fonte** | https://threejs.org (https://github.com/mrdoob/three.js) · https://github.com/pmndrs/react-three-fiber · https://github.com/pmndrs/react-postprocessing · https://github.com/pmndrs/postprocessing |
| **Onde roda** | WebView2, em WebGL 2 sobre ANGLE/D3D11 (o padrão do WebView2 no Windows) |

## Objetivo

O holograma 3D é a assinatura visual do jvOS, mas é o que mais gasta GPU e memória. Por isso ele é opcional: o padrão é o núcleo 2D sem WebGL, e o chunk do three.js só baixa quando o usuário escolhe o 3D ([ADR-0013](../../../arch/adr/0013-nucleo-2d-padrao.md)). Quando ligado, desenha com relógio de quadros limitado e num canvas recortado em volta do núcleo ([ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)).

## Não-objetivos

- Sem `@react-three/drei`. Ele saiu no [ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md), e o `PerformanceMonitor` foi reescrito em `JarvisScene.tsx`.
- Sem modelos, texturas ou loaders (GLTF e afins). A geometria é procedural (`IcosahedronGeometry`, `WireframeGeometry`, `src/lib/geometry.ts`, `src/lib/rings.ts`), e os materiais são `ShaderMaterial` próprios em `src/shaders/hologram/`.
- Sem o `Vignette` do postprocessing: a vinheta virou um `radial-gradient` estático em CSS, igual a 1 nível de cor.
- Sem fundo animado: a grade e a chuva Matrix saíram ([ADR-0015](../../../arch/adr/0015-remocao-do-fundo-shader.md)).
- Sem o laço próprio do fiber (`frameloop="always"`) e sem `powerPreference: "high-performance"`.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o núcleo no modo 2D, o padrão
- **Quando** recarrego a página
- **Então** nenhum pedido casa com `/JarvisScene|react-three|three\.module|postprocessing/`, e nenhum contexto WebGL é criado (`webglContexts` fica em 0). Prova: `tests/core.spec.ts`, "the core opens as the 2D rings, the Núcleo tab swaps the 3D hologram in and out live, and a restart never loads the 3D" e "the 2D core never creates a WebGL context; the 3D draws only around the core, at most 60 fps, and slower behind other apps".

### Critério 2 (RF-002)

- **Dado** o 3D ligado numa tela de 1920×1080
- **Quando** meço o `<canvas>`
- **Então** ele é um quadrado com menos de 1000 px de lado, centrado em x = 960, e `[data-core="3d"]` está visível. Mesma prova do critério 1.

### Critério 3 (RF-003)

- **Dado** o 3D ligado com a janela em foco
- **Quando** conto os quadros (`window.__JARVIS__.signals.frames`) por 2 s
- **Então** a taxa fica em até 62 por segundo. Com um `blur` na janela, fica em até 32 e acima de 5. Mesma prova do critério 1.

### Critério 4 (RNF-001)

- **Dado** o `package-lock.json` atual
- **Quando** rodo `npm ls three postprocessing @react-three/fiber`
- **Então** sai um só `three@0.186.1`, `deduped` sob o fiber, o postprocessing, o `maath` e o `n8ao`, sem `invalid`. O peer do `postprocessing` 6.39.5 é `three >= 0.168.0 < 0.187.0`.

### Critério 5 (RNF-002)

- **Dado** o `npm run build`
- **Quando** olho `dist/assets`
- **Então** o three.js, o fiber e o postprocessing estão no chunk `JarvisScene-*.js` (1.044.572 bytes no build de 04/11), abaixo do `chunkSizeWarningLimit` de 1100 kB, e fora do `index-*.js`.

### Critério 6 (RF-004)

- **Dado** o 3D numa GPU que não segura a taxa (por exemplo o Edge headless no SwiftShader), sem qualidade escolhida à mão
- **Quando** passam os 5 s de assentamento (`MONITOR_DELAY_MS`) e mais algumas janelas de medida
- **Então** o `dpr` desce 0,25 por vez até 1 e, depois de mais de 3 trocas, `onQualityFallback` rebaixa a qualidade um nível (`high` → `medium` → `low`). Com `?quality=` na URL ou um nível escolhido por Ctrl+Shift+Q, a qualidade não cai. Conferência manual.

### Critério 7 (RF-006)

- **Dado** o 3D ligado
- **Quando** troco a cor do JARVIS nas Configurações
- **Então** o holograma muda de cor no mesmo quadro, sem recriar materiais: `sceneColors.ts` atualiza as instâncias de `THREE.Color` que os shaders seguram. Prova: `tests/settings.spec.ts`, "the JARVIS color recolours the hologram and the interface, and persists" (o `storageState` dos testes liga o 3D).

## Casos de borda

- **Vazio/nulo:**
  - sem WebGL, `detectFromGpu` escolhe `low`, e o POST do boot mostra "sem WebGL";
  - o que o `<Canvas>` faz sem WebGL não foi verificado (⚠ a confirmar), e não há error boundary em volta dele.
- **Duplicidade/idempotência:**
  - ir de 2D para 3D e voltar desmonta o canvas, e `useDisposables` libera geometrias e materiais. Voltar ao 3D reaproveita o chunk já baixado;
  - duas cópias do three.js no lock dariam objetos de classes diferentes. O critério 4 garante uma só.
- **Concorrência/corrida:**
  - um só relógio (`runFrames`) chama `advance()` do fiber: 60 quadros por segundo em foco, 30 com outro app em foco e 0 com a janela escondida, minimizada ou atrás de um app maximizado;
  - a compilação dos shaders na partida não entra na medida de desempenho, porque o monitor só começa 5 s depois;
  - a troca de tema muda as cores no lugar, entre dois quadros (`onPalette`).
- **Permissões/visibilidade:**
  - num notebook com duas GPUs, `powerPreference: "default"` mantém o 3D na integrada e deixa a dedicada para o Whisper;
  - o Edge headless sem GPU cai no SwiftShader e no perfil `low`. O Playwright passa `--enable-gpu --ignore-gpu-blocklist`;
  - nenhum código trata `webglcontextlost` (ver Pendências);
  - Zlib (`postprocessing`): permissiva, só pede que o aviso não seja removido do código-fonte.

## Uso no jvOS

### Carga sob demanda e qualidade (`src/App.tsx`, `src/lib/quality.ts`)

- **Comportamento:**
  - **RF-001**: O `JarvisScene` DEVE ser `lazy()` e só montar com `jarvis.core` igual a `3d`. `useQuality(probe)` só cria o contexto WebGL descartável que lê o nome da GPU quando o 3D está em uso.
  - A qualidade segue esta ordem: `?quality=`, depois `jarvis.quality`, depois o palpite pela GPU. Os presets são `low` (DPR 1, 350 partículas, 5 níveis de bloom), `medium` (DPR 1,25, 800, 6) e `high` (DPR 1,5, 1400, 6), todos com MSAA 2×.

### Cena (`src/components/JarvisScene.tsx`)

- **Comportamento:**
  - **RF-002**: O `<Canvas>` DEVE cobrir só um quadrado de 1,6 diâmetros da composição (`CANVAS_SPAN`) em volta do núcleo, com as bordas em múltiplos de 4 px. A câmera `manual` enquadra a tela inteira e mostra o recorte com `setViewOffset`, então os pixels saem iguais aos de um canvas de tela cheia.
  - O `gl` sai com `antialias: false`, `alpha: false`, `stencil: false` e `powerPreference: "default"`. O fundo é a cor `void` do tema, e a névoa preta escurece o lado de trás do holograma.
  - **RF-003**: O fiber DEVE rodar com `frameloop="never"`, e o `FrameDriver` chama `advance()` a partir de `runFrames(frameRate(paused, focused))`.
  - **RF-004**: O `PerformanceMonitor` próprio DEVE medir janelas de 250 ms, 10 por rodada, com limite de 75%: abaixo de 40 (ou de 60, numa tela acima de 100 Hz) baixa o `dpr` em 0,25, acima de 60 (ou 100) sobe até o DPR da tela. Depois de mais de 3 trocas, chama `onQualityFallback`.
  - O `EffectComposer` usa `multisampling` igual ao MSAA do preset (no máximo 2 com DPR acima de 1,25) e um `Bloom` com `mipmapBlur`, `luminanceThreshold: 0.95`, `luminanceSmoothing: 0.08`, `radius: 0.62` e intensidade de 0,9 somada aos sinais de voz.

### Malha do holograma (`JarvisCore.tsx`, `OrbitalRings.tsx`, `HudFragments.tsx`, `HolographicParticles.tsx`, `VoiceWave.tsx`, `AudioDriver.tsx`)

- **Comportamento:**
  - **RF-005**: A geometria DEVE ser procedural, e os materiais DEVEM ser `ShaderMaterial` com `AdditiveBlending` de `src/shaders/hologram/`. As linhas grossas dos anéis e dos fragmentos vêm de `three/addons/lines` (`LineSegments2`, `LineMaterial`, `LineSegmentsGeometry`), com o esmaecimento de trás injetado no shader (`src/lib/fatLines.ts`).
  - Geometrias e materiais criados em `useMemo` são liberados com `useDisposables` quando trocam ou quando o componente desmonta.

### Cores (`src/lib/sceneColors.ts`)

- **Comportamento:**
  - **RF-006**: As cores do 3D DEVEM ser instâncias de `THREE.Color` compartilhadas por referência e atualizadas por `onPalette`. Elas ficam fora de `theme.ts` para o three.js só carregar com o 3D.

## Restrições

- **RNF-001**: `three` e `@types/three` ficam travados no minor 0.186 (`~`). O teto vem do peer do `postprocessing` 6.39.5 (`three >= 0.168.0 < 0.187.0`); o do fiber 9.8.2 é `three >=0.156` e `react >=19 <19.4`. O motivo do `~` não está escrito (⚠ inferido — confirmar: casar com esses peers).
- **RNF-002**: Chunk `JarvisScene-*.js` de 1.044.572 bytes, abaixo de 1100 kB, só baixado com o 3D.
- **RNF-003**: Custo medido no release a 1920×1080, em foco e ocioso ([ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)): 3D com 161 ms de CPU por segundo, 24% da iGPU e 89 MB de memória de GPU, contra 92 ms/s e 53 MB do 2D.
- **RNF-004**: A UI fica no ANGLE/D3D11. O `--use-angle=vulkan` foi recusado no [ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md).
- **RNF-005**: Os shaders dependem de partes internas do three.js (`UniformsLib`, `UniformsUtils`, o código do `LineMaterial`), que podem mudar entre minors.
- **RNF-006**: Licenças MIT e Zlib.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/JarvisScene.tsx` | `Canvas` recortado, `FrameDriver`, `PerformanceMonitor`, `Composition`, `Effects` (bloom), vinheta em CSS |
| `src/components/JarvisCore.tsx` | Núcleo em malha (icosaedro, grade, treliça) |
| `src/components/OrbitalRings.tsx` · `HudFragments.tsx` | Anéis e fragmentos em linhas grossas |
| `src/components/HolographicParticles.tsx` · `VoiceWave.tsx` · `AudioDriver.tsx` | Partículas, onda de voz, amostragem dos sinais e primeiro quadro |
| `src/shaders/hologram/*.ts` | `haloMaterial`, `holoLineMaterial`, `holoPointsMaterial`, `voiceWaveMaterial`, `sharedUniforms` |
| `src/lib/fatLines.ts` · `geometry.ts` · `rings.ts` | Linhas grossas e geometria procedural |
| `src/lib/sceneColors.ts` | Cores do tema como `THREE.Color` |
| `src/lib/quality.ts` · `frameClock.ts` | Presets, palpite pela GPU, relógio de quadros |
| `src/hooks/useDisposables.ts` | Libera recursos da GPU |

### Testes

- `npx playwright test tests/core.spec.ts` (critérios 1 a 3).
- `npx playwright test tests/ui.spec.ts`: composição em 1366×768, 1920×1080, 2560×1440 e 3440×1440 com `?quality=high`, e o log do renderer e da taxa.
- `npx playwright test tests/settings.spec.ts` (critério 7).
- `npm ls three postprocessing @react-three/fiber` (critério 4).
- `npm run build` e olhar o tamanho de `JarvisScene-*.js` (critério 5).
- `npm run perf` no build de release, nos cenários de [testing](../../../arch/testing.md#desempenho) (RNF-003).

### Atualização e reversão

- **Comando:** `npm i three@~<versão> @react-three/fiber@<versão> @react-three/postprocessing@<versão> postprocessing@<versão>` e `npm i -D @types/three@~<versão>`. Antes, confira se o peer do `postprocessing` aceita o three novo.
- **Prova:** `npm ls` sem `invalid`; `npm run build` sem aviso de chunk; `core.spec.ts`, `ui.spec.ts` e `settings.spec.ts`; o roteiro do [ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md) (render em tela cheia contra o recortado, nada aceso fora do quadrado); `npm run perf` contra os números de RNF-003.
- **Sinal de volta:** erro de compilação de shader no console; o `LineMaterial` ou o bloom mudam de aparência; a iGPU ou a CPU passam dos números de RNF-003; o chunk passa de 1100 kB.
- **Reversão:** `npm i three@0.186.1 @react-three/fiber@9.8.2 @react-three/postprocessing@3.2.1 postprocessing@6.39.5` e `npm i -D @types/three@0.186.0`.

### Decisões relacionadas

- [ADR-0012 — Apps lazy com preload](../../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0013 — Núcleo 2D por padrão, 3D opcional](../../../arch/adr/0013-nucleo-2d-padrao.md)
- [ADR-0015 — Remoção dos fundos animados](../../../arch/adr/0015-remocao-do-fundo-shader.md)
- [ADR-0022 — Núcleo com relógio de quadros limitado, canvas 3D recortado e UI em D3D11](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)

## Dependências

- **Vendor:** [react](../react/spec.md) (o fiber limita o React a `<19.4`), [vite-typescript](../vite-typescript/spec.md) (o chunk lazy), [tauri](../tauri/spec.md) (a WebView2 e o ANGLE).
- **Specs:** [holographic-core](../../../features/holographic-core/spec.md), [appearance](../../../features/appearance/spec.md) (as cores do tema), [boot](../../../features/boot/spec.md) (o 3D liga depois do POST), [settings](../../../features/settings/spec.md) (Menu avançado → Núcleo).
- **Sistema:** GPU com WebGL 2 (aqui uma Intel integrada e uma NVIDIA MX570 de 2 GB), driver de vídeo atualizado.

## Pendências

- [ ] Nenhum código em `src/` trata `webglcontextlost`. Se o driver derrubar o contexto (troca de GPU, reinício do driver), não há caminho para recriar a cena. Arquivo: `src/components/JarvisScene.tsx`.
