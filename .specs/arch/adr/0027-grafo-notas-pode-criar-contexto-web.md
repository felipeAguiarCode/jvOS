# ADR-0027: O grafo de notas pode criar um contexto WebGL enquanto está na tela

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-19 |
| **Origem** | feature notes-graph (2026-11-19) |
| **Spec** | [notes-graph](../../features/notes-graph/spec.md) |

## Contexto

O [ADR-0022](0022-nucleo-relogio-quadros-limitado-canvas-3.md) deixou como regra: "Nada fora do 3D cria contexto WebGL, exceto o POST do boot, que mostra o nome da GPU." A regra existe para o desktop ficar leve: cada contexto WebGL custa memória no processo de GPU do WebView2 (a medição do próprio ADR-0022: de 295 para 165 MB ao enxugar o 3D), e o núcleo 2D foi feito justamente para não ter nenhum.

A fase 3 do modo chat pede o grafo das notas ("sinapses", como o do Obsidian) e o usuário escolheu, em 2026-11-19, a versão 3D holográfica, sabendo da regra. Um grafo 3D com dezenas ou centenas de nós, linhas e rotação não tem substituto razoável em SVG ou canvas 2D.

## Decisão

- **Abordagem escolhida:** abrir uma segunda exceção à regra do ADR-0022. O grafo de notas pode criar **um** contexto WebGL, com three.js, **só enquanto está na tela**.
- **Por quê:** é pedido explícito do usuário para uma visão que só existe sob demanda (um botão dentro da seção Notas do modo chat). Ela não fica ligada o dia inteiro como o núcleo, e o modo chat já deixa o núcleo parado.
- **Alternativas rejeitadas:**
  - **Canvas 2D, como o Obsidian:** mantinha a regra intacta e era a recomendação técnica. O usuário preferiu o 3D.
  - **Reaproveitar o canvas do núcleo 3D:** exigiria o núcleo em modo 3D (o padrão é 2D) e misturaria duas cenas com orçamentos diferentes.
  - **Desmontar o núcleo 3D enquanto o grafo está aberto, para haver um contexto só:** a volta ao desktop pagaria de novo a criação da cena e a compilação dos shaders, o engasgo que o ADR-0022 quis evitar. O núcleo fica montado e parado.

## Interfaces

- **Comandos Tauri:** nenhum.
- **Eventos e Channels:** nenhum.
- **Dados:** `jarvis.notesGraph` (se o grafo está aberto).
- **Estados da UI:** o grafo aparece no lugar do editor de notas; ao sair dele (editor, conversas, modo desktop), o contexto é destruído.

## Restrições

- **Compatibilidade:** com o núcleo 2D ou desligado, o app continua sem nenhum contexto WebGL até o grafo ser aberto, e volta a zero ao fechá-lo. O teste "the 2D core never creates a WebGL context" (`tests/core.spec.ts`) continua valendo, porque não abre o grafo.
- **Segurança:** nada muda; o grafo só lê as notas já carregadas pela área de notas.
- **Desempenho:**
  - o three.js do grafo vai num chunk próprio, carregado ao abrir o grafo;
  - o laço de desenho roda no `runFrames` com `frameRate(paused, focused)`: 60 fps em foco, 30 com outro app na frente, 0 com a janela oculta;
  - `devicePixelRatio` limitado a 1,5; sem pós-processamento (sem bloom, sem MSAA extra);
  - a simulação de forças é O(n²) por passo e para quando assenta; o grafo mostra no máximo 400 nós.
- **Limites operacionais:** com o núcleo em modo 3D, existem dois contextos enquanto o grafo está aberto (o do núcleo parado, sem desenhar). O custo de memória de GPU desse caso não foi medido.

## Plano de rollout

- **Fase 1:** o grafo com a exceção descrita aqui.
- **Sinal de parada:** `npm run perf` com o grafo aberto e parado acima do orçamento do núcleo 3D ocioso (170 ms de CPU por segundo, RNF-005 de holographic-core), ou o processo de GPU do WebView2 crescendo a cada abertura do grafo (contexto não liberado).
- **Reversão:** trocar o desenho por canvas 2D mantendo o resto (links, tags, índice), e substituir este ADR.

## Consequências

- **Positivas:** o grafo holográfico pedido; a regra do ADR-0022 segue valendo para todo o resto.
- **Negativas / custos:** um contexto WebGL a mais enquanto o grafo está aberto; o three.js passa a ser carregado também por quem usa o núcleo 2D, mas só ao abrir o grafo.
- **Regras que daqui decorrem:**
  - a regra do ADR-0022 passa a ser: nada fora do núcleo 3D cria contexto WebGL, exceto o POST do boot e o grafo de notas **enquanto está na tela**;
  - quem cria o contexto do grafo o destrói ao desmontar (`dispose` de geometrias e materiais, `renderer.dispose()` e `forceContextLoss()`);
  - o grafo não ganha pós-processamento nem laço próprio fora do `runFrames` sem um ADR novo.

## Referências

- `src/components/chat/NotesGraph.tsx`, `src/lib/notesGraph.ts`, `src/lib/frameClock.ts`
- Specs afetadas: [features/notes-graph](../../features/notes-graph/spec.md), [features/holographic-core](../../features/holographic-core/spec.md), [foundation/vendor/three](../../foundation/vendor/three/spec.md)
- Substitui em parte a regra de WebGL do [ADR-0022](0022-nucleo-relogio-quadros-limitado-canvas-3.md), que continua aceito no resto.
