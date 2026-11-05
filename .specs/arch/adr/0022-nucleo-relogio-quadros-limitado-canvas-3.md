# ADR-0022: Núcleo com relógio de quadros limitado, canvas 3D recortado e UI em D3D11

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-04 |
| **Origem** | otimização de 2026-11-04 (`scripts/perf.mjs`, medições antes e depois) |

## Contexto

No build de release, a 1920×1080, com a janela em foco e o núcleo ocioso, a medição de 2026-11-04 deu:

| Cenário | CPU total (ms/s) | iGPU | Memória de GPU |
|---|---|---|---|
| 2D | 169 | 6% | 49 MB |
| 3D | 202 | **49%** | 134 MB |
| 3D + uma janela TUI | 263 | 50% | 144 MB |

Quase todo esse custo era do processo de GPU e do renderer do WebView2, não do `jarvis.exe`. Fatos do código:
- **O 3D desenhava em tela cheia sem limite de quadros.**
  - `frameloop="always"`, numa tela de 1920×1080, com MSAA 4×, bloom de 7–8 níveis e vinheta em shader.
  - O holograma aceso ocupa ~744×667 px: medido com todos os sinais no máximo.
  - `powerPreference: "high-performance"` acordava a dGPU num notebook híbrido.
  - Uma tela de 120/144 Hz dobraria o custo.
- **Nada pausava com outro app em foco.** Só a janela escondida, minimizada ou atrás de um app maximizado parava o núcleo.
- **`backdrop-filter` permanente** em toda janela, na barra superior e no botão do histórico. Sobre um núcleo que muda a cada quadro, o desfoque é refeito a cada quadro.
- **O glow TUI tinha duas camadas desfocadas** (0,28em e 0,9em) em todo texto de janela.
- **Contextos WebGL descartáveis:** o 2D e o desligado criavam um contexto só para escolher a qualidade do 3D.
- **Segunda captura de microfone:** esperando o "Hey Jarvis", a WebView abria a própria captura e a analisava a cada quadro, além do microfone do motor Rust.

## Decisão

- **Relógio de quadros único** (`src/lib/frameClock.ts`):
  - os núcleos 2D e 3D recebem quadros a no máximo **60 por segundo em foco e 30 com outro app em foco**, qualquer que seja a taxa da tela;
  - nada roda escondido;
  - o 3D usa `frameloop="never"` e `advance()`.
- **Canvas 3D recortado:**
  - só um quadrado de 1,6 diâmetros da composição em volta do núcleo (~830 px a 1080p);
  - a câmera `manual` enquadra a tela inteira e mostra o recorte com `setViewOffset`, então os pixels saem iguais aos de um canvas de tela cheia;
  - verificado: a emenda difere no máximo 1 nível de cor, e nada aceso fica fora do recorte.
- **Vinheta em CSS:** o mesmo `smoothstep` do `Vignette` do postprocessing num `radial-gradient` estático, igual a 1 nível de cor.
- **Qualidade:** MSAA 2× e no máximo 6 níveis de bloom.
- **`powerPreference: "default"`** no WebGL.
- **O `@react-three/drei` sai do projeto:** só dava o `PerformanceMonitor`, reescrito no `JarvisScene.tsx`.
- **Sem `backdrop-filter`** em superfícies permanentes (janelas, barra superior, botão do histórico, menus quase opacos). Os painéis transitórios (Configurações, Menu avançado, busca, gavetas) mantêm o desfoque.
- **Glow TUI** com um só halo (0,36em).
- **Probe da GPU** (contexto WebGL descartável) só com o 3D em uso.
- **Captura visual fechada** no standby do "Hey Jarvis".
- **A UI fica no ANGLE/D3D11, o padrão do WebView2 no Windows.** O backend Vulkan do ANGLE (`--use-angle=vulkan`) é experimental no Chromium para Windows e arrisca travar o processo de GPU. Depois do recorte e do limite de quadros, o WebGL deixa de ser o gargalo. O Vulkan fica para o Whisper ([ADR-0021](0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md)).

## Consequências

Medido depois, nas mesmas condições ([holographic-core › Desempenho](../../features/holographic-core/spec.md#desempenho)):

| Cenário | CPU (ms/s) | iGPU | Memória de GPU |
|---|---|---|---|
| 2D | 169 → **92** | 6% → 5,5% | 49 → 53 MB |
| 3D | 202 → **161** | 49% → **24%** | 134 → **89 MB** |
| 3D + janela TUI | 263 → **232** | 50% → **24%** | 144 → **96 MB** |
| 3D minimizado | 8,5 → 6,5 | 0% | 246 → **119 MB** (o processo de GPU do WebView2 de 295 para 165 MB de RAM) |

- **Positivas:**
  - Um terço dos pixels para sombrear, multiamostrar e passar pelo bloom.
  - Uma tela rápida não multiplica o custo.
  - Com outro app em foco, o núcleo custa metade, sem congelar.
  - A dGPU fica livre e dormindo.
- **Negativas / custos:**
  - Com outro app em foco, o núcleo anda a 30 fps.
  - Atrás das janelas, o núcleo aparece nítido, a 15% de intensidade com a opacidade padrão, em vez de desfocado.
  - O glow TUI fica um pouco mais curto.
  - Esperando o "Hey Jarvis", o holograma não reage ao som da sala.
- **Regras que daqui decorrem:**
  - Animação contínua nova roda no `runFrames` (ou em CSS de compositor) e respeita `frameRate(paused, focused)`.
  - Superfície que fica sempre na tela sobre o núcleo não usa `backdrop-filter`.
  - Nada fora do 3D cria contexto WebGL, exceto o POST do boot, que mostra o nome da GPU.
  - Mudar o tamanho do holograma (camadas, halo, bloom) exige conferir o recorte com o roteiro de verificação: render em tela cheia × recortado, nada aceso fora do quadrado.

## Alternativas consideradas

- **Pausar o núcleo por completo sem foco:** congelaria o JARVIS num segundo monitor. 30 fps mantém a vida com metade do custo.
- **Parar o laço do 2D em repouso:** o teste do núcleo exige que os sinais continuem sendo amostrados (`tests/core.spec.ts`), e o custo do laço sem áudio é de microssegundos por quadro.
- **`--use-angle=vulkan` no WebView2:** recusado acima.

## Referências

- `src/lib/frameClock.ts`, `src/components/JarvisScene.tsx`, `src/components/FlatCore.tsx`, `src/hooks/useWindowControls.ts`, `src/lib/quality.ts`, `src/App.tsx`, `src/components/desktop/Window.tsx`, `src/components/Taskbar.tsx`, `src/styles/globals.css`
- Specs afetadas: [holographic-core](../../features/holographic-core/spec.md), [desktop-windows](../../features/desktop-windows/spec.md), [appearance](../../features/appearance/spec.md), [dock-taskbar](../../features/dock-taskbar/spec.md), [assistant](../../features/assistant/spec.md)
