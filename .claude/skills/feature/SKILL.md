---
name: feature
description: Planeja e implementa uma feature do JARVIS OS com a spec primeiro. Use sempre que o usuário pedir uma funcionalidade nova ou uma mudança de comportamento ("quero que o JARVIS…", "adicione…", "implemente…", "faz o app…", "/feature …"). Antes de tocar no código de produto, escreve ou atualiza `.specs/features/<id>/spec.md` no formato Feature Specification e só depois implementa, seguindo o Implementation Plan dessa spec.
argument-hint: <o que a feature deve fazer>
---

# Feature: spec primeiro, código depois

Pedido: $ARGUMENTS (se vier vazio, o pedido está na conversa).

**Regra:** nenhuma linha de código de produto antes de a spec estar escrita e conferida com o código atual ([ADR-0026](../../../.specs/arch/adr/0026-feature-comeca-pela-spec.md)). A spec é o plano antes e o registro do que foi feito depois.

## 0. Classifique o pedido

| Pedido | Onde planejar |
|---|---|
| Feature nova | Pasta nova `.specs/features/<id>/`. O id é em kebab-case, em inglês, como `quick-notes` |
| Mudança numa feature existente | A spec dela (índice em `.specs/README.md` › Features) |
| Widget ou app | Mesmo fluxo, mas na pasta e no formato dele (`.specs/widgets/` ou `.specs/apps/`, ADR-0023, `npm run new -- widget\|app`) |
| Ajuste pequeno (texto, bug de uma linha) | O plano é a mudança na spec (AC, KL ou tarefa), feita antes do código, sem cerimônia |

Se o pedido for ambíguo a ponto de mudar o que será construído, pergunte antes, com uma recomendação.

## 1. Entenda antes de escrever

Leia:
- `.specs/README.md` e, em `.specs/arch/`, `constitution.md`, `coding-style.md` e `testing.md`;
- o modelo `.specs/features/reminders/spec.md` e o template `.specs/_templates/feature.md`;
- as specs que a feature toca (voice-commands, assistant-tools, settings…) e `.specs/domain/` (persistence, voice-intents, model);
- o código que vai mudar e um item parecido já implementado, para seguir o mesmo padrão.

Tudo o que o código responde entra na spec como fato. Não invente nomes, números, mensagens nem títulos de teste.

## 2. Planeje na spec

**Feature nova:**
1. Rode `npm run new -- feature <id> --dry-run` (as flags estão em `--help`: `--touches voice,data,command,tool`, `--voice`, `--command`, `--tool`, `--lib`) e confira o resumo.
2. Rode de novo com `--yes`, sem `--dry-run`. O CLI cria o `spec.md` e os esqueletos e imprime o checklist de registro, que também vai para Implementation Plan › Phase 2.
3. Preencha a spec inteira.

**Feature existente:**
- Acrescente US, RF, RNF, AC e T com o próximo número livre. Nenhum número é reaproveitado.
- Crie uma fase nova no Implementation Plan (`### Phase N — <mudança> (AAAA-MM-DD)`) com as tarefas em `[ ]`.
- Cada AC novo leva `**Coverage Status:** planejado — <teste> (T00x)`.
- Atualize Document Status e Last Editorial Revision.

**O plano precisa ter:**
- **Metadata:** Feature Status `Em desenvolvimento` numa feature nova; Verification Scope dizendo o que foi conferido no código.
- **Overview:** com a tabela Input / Expected Behavior / Execution Path.
- **User Stories:** prioridade, Independent Test (arquivo e título do teste planejado) e os ACs.
- **Requirements:** RF e RNF com os números reais (limites, timeouts, debounces).
- **Acceptance Criteria:**
  - formato `### AC-00N — Title` com `**Related Story:** USk.`, em Given / When / Then binários;
  - ao menos um caminho feliz, uma falha e um caso de borda.
- **Desenho:**
  - Behavior and Flows;
  - Data Model (chaves `jarvis.*` com parser tolerante, `settings.json`);
  - Technical Design (arquivos, camadas, Related Architecture Decisions);
  - Interfaces (comandos Tauri, eventos, tools MCP, tipos espelhados `Mirrors`).
- **Edge Cases:** vazio ou inválido, duplicidade, concorrência e permissões, ou "não se aplica" com o motivo.
- **Test Strategy:** cada AC ligado a um teste, com o comando exato (Playwright no projeto `ui` e no `testMatch`; `cargo test` em `src-tauri`).
- **Implementation Plan:** tarefas pequenas `T00n`, cada uma com Aceite, Arquivos permitidos, Comando de teste e Evidência.
- **Fechamento:**
  - Rollback Plan;
  - Constitution Compliance (P1–P12, com honestidade);
  - Known Limitations (o que fica de fora ou sem teste);
  - Open Questions (só decisões de produto);
  - References.
- **ADR:** decisão de arquitetura (dependência nova, processo externo, modelo de persistência, permissão) → `npm run new -- adr --title "…"`.

## 3. Ponto de controle

- Mostre ao usuário um resumo curto: o caminho da spec, as histórias, os ACs, as tarefas e as OQ.
- **OQ que muda o que será construído:** pergunte (AskUserQuestion, com a opção recomendada primeiro) e registre a resposta na spec antes de codar.
- **OQ que não muda nada agora:** fica na tabela e o trabalho segue.
- Se o usuário pediu só o plano ("só planeje", "não implemente"), pare aqui.

## 4. Implemente seguindo o plano

- **Ordem:** siga as tarefas do Implementation Plan. Ao concluir uma, marque `[x]` e preencha a Evidência.
- **Arquivos:** mexa só nos Arquivos permitidos. Precisou de outro arquivo ou de outro caminho? Atualize primeiro a spec (tarefa e Technical Design), depois o código. Spec e código nunca divergem.
- **Padrões:** siga a constituição e o coding-style:
  - tipos espelhados e parser tolerante;
  - fake de DEV para o modo web;
  - UI em PT-BR, código e comentários em inglês;
  - o final de linha de cada arquivo preservado.
- **Registro:** aplique o checklist do CLI (`desktop.ts`, catálogo de voz, `invoke_handler` no Rust, `testMatch` e docs).
- **Contrato:** se mudou, atualize `.specs/arch/ipc-contract.md`, `.specs/domain/persistence.md` ou `voice-intents.md`.
- **Dependência nova ou trocada:** atualize `.specs/foundation/vendor/` e `.specs/foundation/stack/`.

## 5. Verifique

- `npm run build` (o `tsc` estrito).
- Cada teste da Test Strategy:
  - `npx playwright test tests/<x>.spec.ts --project ui`;
  - `cargo test --lib <filtro>` em `src-tauri`, com o ambiente de `.specs/arch/build-and-env.md`.
- Se mexeu no CLI, `npm run test:cli`.
- O que só aparece no app real (voz, janela nativa) é conferido pelo app via CDP (`testing.md`). Se não der, vira KL "não verificado no app".
- Teste que falhou: corrija ou registre. Nunca marque `[x]` sem evidência.

## 6. Feche a spec

- A spec descreve o que foi construído, não o que foi planejado: ajuste RF, AC e fluxos ao código final.
- Na Metadata, preencha:
  - Feature Status `Implementado`;
  - Uncommitted Changes;
  - Verification Scope, com a data, os arquivos e os testes rodados com o resultado.
- Em Reported Tests, ponha os títulos reais. Tire os "planejado" de Coverage Status. O que ficou sem teste ou de fora vai para Coverage Gaps e KL.
- No `.specs/README.md`, na tabela Features, ponha a linha nova ou atualize o status (`Implementado · não commitado`).
- Não faça commit, a menos que o usuário peça.
- No relatório final, diga:
  - o que foi feito;
  - os testes rodados e o resultado;
  - o que ficou de fora (KL);
  - as OQ.
