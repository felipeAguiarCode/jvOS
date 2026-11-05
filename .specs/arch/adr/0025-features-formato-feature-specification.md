# ADR-0025: Features no formato "Feature Specification"

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-05 |
| **Origem** | conversa (2026-11-05): "reescreva todas as features e deixe elas num formato mais inspirado em" um documento "Feature Specification: Reminders and Timers" colado pelo usuário |
| **Spec** | as 20 de `features/`; `_templates/feature.md` |

## Contexto

O [ADR-0023](0023-specs-formato-spec-coding-dev.md) pôs todas as specs na ordem do spec-coding.dev, com o corpo SpecLang no meio e os títulos em PT-BR. Depois disso, o usuário mandou como modelo uma versão da spec de lembretes reescrita fora do repositório, sem acesso ao código. O modelo traz:
- **Cabeçalho:** `Metadata` em tabela (status, commit, atalho, plataformas, idioma, escopo da verificação).
- **Produto:** `Overview` com uma tabela de entradas, `Goals and Success Criteria` e `Scope and Non-Goals`.
- **Histórias:** `User Stories` com Priority, Why This Priority, Independent Test e os critérios ligados.
- **Requisitos e aceite:** RF e RNF em tabela, e critérios `AC-00N` com Given / When / Then.
- **Desenho técnico:** Behavior and Flows, Data Model, Technical Design, Interfaces, Edge Cases, Dependencies e Test Strategy (com os comandos e as lacunas).
- **Execução:** Implementation Plan, Rollback Plan e Constitution Compliance.
- **Pendências:** Known Limitations (KL) e Open Questions (OQ).
- **Idioma:** títulos das seções e palavras do Gherkin em inglês, e conteúdo em PT-BR.

Como o modelo foi escrito sem o código, ele tem perguntas que o código responde. A spec de lembretes, conferida com o código, mostrou três delas:
- a ferramenta aceita frações de minuto, embora a mensagem diga "1 a 10080";
- uma duração longa demais vira tarefa, e não erro;
- o `id` de um lembrete é um número.

## Decisão

- **Abordagem escolhida:**
  - **As 20 specs de `features/`** seguem o template novo `_templates/feature.md`, com as seções e a ordem do modelo. A spec pronta de [reminders](../../features/reminders/spec.md) é a referência.
  - **Títulos em inglês:** os títulos das seções e dos campos (Priority, Related Story…) e as palavras Given / When / Then. O conteúdo, as falas e os rótulos da UI continuam em PT-BR.
  - **IDs:** US, RF, RNF, SC e T continuam com os mesmos números. Os critérios viram `AC-00N`, com o mesmo número do antigo "Critério N". Entram KL-* (limitações conhecidas) e OQ-* (decisões de produto em aberto).
  - **Conferência com o código:** cada número, rótulo, chave, limite, mensagem e título de teste foi conferido no código. O que o código responde vira fato; Open Questions ficam só para decisões de produto. O campo `Verification Scope` diz o que foi lido e que os testes não rodaram na revisão.
  - **Seção que sai:** a `Document Organization` do modelo, que propunha dividir em `spec.md`, `plan.md` e `tasks.md`, não entra. O arquivo único do [ADR-0019](0019-specs-arquivo-unico-formato-spec-lang.md) continua.
  - **CLI:** `npm run new -- feature …` gera o formato novo a partir de `_templates/feature.md`. Widgets e apps continuam no `_templates/spec.md` ([ADR-0023](0023-specs-formato-spec-coding-dev.md)).
- **Por quê:** o usuário escolheu o modelo. Ele separa o contrato de produto (o que e por quê) do desenho técnico (como) e da execução (tarefas, testes, reversão). Também deixa explícito o que antes ficava espalhado: as lacunas de teste, as limitações e as decisões em aberto.
- **Alternativas rejeitadas:**
  - **Copiar o modelo com as Open Questions dele:** manteria dúvidas que o código já responde.
  - **Títulos em PT-BR:** o modelo pede inglês nos títulos, e o usuário o deu como referência.
  - **Dividir em três arquivos:** contraria o arquivo único, que o usuário escolheu no ADR-0019.

## Interfaces

- **Dados:** os `spec.md` de `features/` mudam de forma. As âncoras dos títulos mudam, por exemplo `#pendências` → `#known-limitations` e `#entregáveis` → `#technical-design`, e os links de outras specs foram atualizados junto.
- **CLI:** `.cli/lib/specs.mjs` (`featureSpecs`, `setFeatureTasks`) e `.cli/lib/repo.mjs` (carrega `feature.md`). O teste do CLI confere a ordem das seções.

## Restrições

- **Compatibilidade:** os IDs foram auditados por script contra uma cópia de antes da reescrita. Cada US, RF, RNF, SC e T continua presente, e cada critério tem o seu AC de mesmo número.
- **Limites operacionais:** widgets e apps ficam no formato do ADR-0023 até alguém pedir a mesma reescrita.

## Plano de rollout

- **Fase 1:** template, a spec de lembretes como modelo, e o CLI.
- **Fase 2:** as outras 19 features, reescritas em paralelo a partir do modelo e do código, e a auditoria dos IDs.
- **Sinal de parada:** um ID ausente na auditoria ou um link quebrado.
- **Reversão:** `git checkout` de `.specs/features/` e de `.cli/`. Os IDs não mudaram de significado.

## Consequências

- **Positivas:**
  - Cada feature diz o que está confirmado no código, o que não tem teste e o que falta decidir.
  - Os critérios têm IDs estáveis (AC-00N), que testes e tarefas podem citar.
  - Mais erros das specs antigas apareceram ao conferir com o código, e viraram KL.
- **Negativas / custos:**
  - Dois formatos convivem: features neste, widgets e apps no do ADR-0023.
  - Os títulos em inglês divergem da regra "specs em PT-BR" do `CLAUDE.md`, agora ajustada para "conteúdo em PT-BR".
  - As specs ficaram maiores.
- **Regras que daqui decorrem:**
  - Uma feature nova nasce de `npm run new -- feature …` ou do `_templates/feature.md`.
  - Um AC, KL ou OQ novo pega o próximo número livre, e nenhum número é reaproveitado.
  - Mudou o comportamento: atualize Requirements, Acceptance Criteria, Behavior and Flows, Test Strategy, Implementation Plan e Known Limitations.

## Referências

- `.specs/_templates/feature.md`, [features/reminders](../../features/reminders/spec.md), `.cli/lib/specs.mjs`
- Substitui em parte o [ADR-0023](0023-specs-formato-spec-coding-dev.md), só para `features/`: a ordem das seções, os títulos em PT-BR e os critérios `### Critério N`.
