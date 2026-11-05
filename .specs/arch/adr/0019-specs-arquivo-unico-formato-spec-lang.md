# ADR-0019: Specs em arquivo único no formato SpecLang

| | |
|---|---|
| **Status** | Aceito · em parte substituído pelo [ADR-0023](0023-specs-formato-spec-coding-dev.md) (a ordem das seções e o aceite dentro das histórias) |
| **Data** | 2026-11-03 |
| **Origem** | conversa (2026-11-03): o usuário pediu as specs no padrão SpecLang da GitHub Next, um arquivo por item, mantendo os IDs e o aceite |

## Contexto

Até aqui, cada uma das 37 pastas de `features/`, `widgets/` e `apps/` tinha três arquivos no estilo spec-kit ([ADR-0016](0016-readme-minimo-docs-em-specs.md)):
- `spec.md`: histórias, aceite Dado/Quando/Então e os IDs RF, RNF e SC;
- `plan.md`: arquivos, contratos, fluxo e ADRs;
- `tasks.md`: tarefas e pendências.

Havia dois problemas:
- **Informação espalhada.** O comportamento de um componente estava dividido entre os RF da spec, as tabelas de contrato do plano e as tarefas.
- **Sem Layout e Estilo.** As specs não diziam como cada janela é montada nem que tokens usa. Isso só se descobria lendo o TSX.

Na conversa, o usuário fez quatro escolhas:
- o formato **SpecLang** da GitHub Next, um protótipo de pesquisa de 2023 e não o Spec Kit;
- manter a pasta `.specs/`, com títulos em PT-BR;
- **um arquivo só por item**;
- **manter os IDs e o aceite**, fundidos no formato novo.

No SpecLang, a spec é a fonte da verdade do programa, e o código é secundário. A spec é Markdown estruturado por telas e componentes, com bullets **Behavior / Layout / Styling**, valores com nome `$assim`, identificadores em crases e rótulos da UI entre aspas. O formato não tem IDs nem critérios de aceite.

## Decisão

- **Um `spec.md` por item.** `plan.md` e `tasks.md` deixam de existir, e o conteúdo deles vira as seções `## Código`, `## Tarefas` e `## Pendências`.
- **A parte SpecLang vem primeiro:**
  - `## Dados`: valores `$assim`, com a chave, o debounce e o parser;
  - `## Telas`: só apps;
  - `## Componentes`: um `###` por componente, com **Comportamento**, **Layout** e **Estilo**;
  - `## Voz e teclado` e `## Restrições`.
- **Os IDs ficam e não são renumerados.**
  - Cada RF mora no bullet de comportamento onde a regra vive. Os RNF ficam em Restrições.
  - US com aceite, SC e T00n continuam como antes, com o texto palavra por palavra.
  - Um RF novo pega o próximo número livre.
- **Casos de borda viram "Se …, então …"** no componente certo. Só os transversais ficam numa seção própria.
- **Layout e Estilo saem do código** (classes, kit TUI, tokens do tema). O que o código não mostra leva o marcador `⚠ inferido — confirmar`.
- **Fonte única:** `.specs/_templates/spec.md`, com as regras num comentário. `npm run new` gera o arquivo único, e o checklist de registro entra em Tarefas › Fase 2.
- **A conversão foi auditada.** Um script comparou o backup dos três arquivos com o arquivo novo em cada pasta e conferiu:
  - os IDs e o texto dos RF, RNF, SC, do aceite, das tarefas e das pendências;
  - os caminhos de código, os testes, os links de ADR e os diagramas.

## Consequências

- **Positivas:**
  - Uma página por item, lida de cima para baixo: o que é, os dados, os componentes, a prova (aceite), o código e o que falta.
  - O RF fica ao lado do comportamento que ele exige.
  - As janelas ganharam descrição de layout e estilo.
  - Os IDs que testes, tarefas e outros documentos citam continuam válidos.
- **Negativas / custos:**
  - Os arquivos ficaram maiores: o maior, `jv_ide`, junta o que eram três.
  - Parte do aceite repete o comportamento em forma de exemplo concreto. Foi de propósito, porque o aceite é o oráculo dos testes.
  - Os IDs saem da ordem numérica na leitura, porque seguem o componente.
  - Layout e Estilo envelhecem quando o TSX muda e precisam ser atualizados junto.
- **Regras que daqui decorrem:**
  - Mudou o TSX de uma janela: revise Layout e Estilo do componente.
  - Um RF novo entra no bullet do componente, com o próximo número livre.
  - Links para outra spec usam âncoras: `spec.md#código`, `#tarefas` e `#pendências`.

## Alternativas consideradas

- **GitHub Spec Kit no layout oficial** (`.specify/` e `specs/NNN-nome/`), com e sem a ferramenta `specify`. Foi oferecida e recusada pelo usuário.
- **SpecLang mantendo `plan.md` e `tasks.md` ao lado.** Também oferecida e recusada.
- **SpecLang puro, sem IDs.** Também recusada, com o pedido de manter os IDs e fazer o merge.

## Referências

- [SpecLang (GitHub Next)](https://githubnext.com/projects/speclang/)
- `.specs/_templates/spec.md`, `.cli/lib/specs.mjs`
- Modelos da conversão: [widgets/weather](../../widgets/weather/spec.md), [features/reminders](../../features/reminders/spec.md)
- Substitui em parte o [ADR-0016](0016-readme-minimo-docs-em-specs.md), no formato em três arquivos, e o [ADR-0018](0018-cli-scaffolding-so-cria-arquivos-novos.md), no checklist na Fase 2 do `tasks.md`
- Specs afetadas: todas as de `features/`, `widgets/` e `apps/`
