# ADR-0026: Toda feature começa pela spec (skill `feature`)

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-05 |
| **Origem** | conversa (2026-11-05): "deixe uma skill no projeto, uma skill local, aonde toda feature que eu pedir ele planeja primeiro na pasta de features e no formato que temos hoje, e só depois implementa" |
| **Spec** | todas as de `features/`; `.claude/skills/feature/SKILL.md`, `.specs/_templates/feature.md` |

## Contexto

As specs do projeto foram escritas **depois** do código: retroativamente em 2026-11-01 e reescritas nos formatos dos ADRs [0019](0019-specs-arquivo-unico-formato-spec-lang.md), [0023](0023-specs-formato-spec-coding-dev.md) e [0025](0025-features-formato-feature-specification.md). Ao conferir as 20 features com o código, a reescrita de 2026-11-05 achou:
- critérios que diziam ter teste e não tinham;
- defeitos que ninguém tinha visto, como a voz surda depois de "Ouvir exemplo" (tts KL-003) e o ditado descartado pelo `discard` velho (dictation KL-002).

A regra que existia era "escreva a spec antes ou junto do código" (`.specs/README.md` › Como manter). Nada a impunha numa sessão do Claude Code.

## Decisão

- **Abordagem escolhida:** uma skill do projeto, `.claude/skills/feature/SKILL.md` (versionada), que o Claude Code usa sempre que o usuário pede uma feature ou uma mudança de comportamento:
  1. classifica o pedido e lê as specs e o código;
  2. escreve ou atualiza `.specs/features/<id>/spec.md` no formato Feature Specification (`npm run new -- feature` numa feature nova), com ACs, Test Strategy e Implementation Plan;
  3. mostra o plano e pergunta só as decisões de produto que mudam o que será construído;
  4. implementa tarefa por tarefa, dentro dos arquivos do plano;
  5. verifica (`npm run build` e os testes do plano);
  6. fecha a spec com o que foi construído e os testes que rodaram.

  Widgets e apps seguem o mesmo fluxo nas pastas e no formato deles.
- **Por quê:** o usuário pediu. Com o plano escrito antes, cada AC nasce ligado a um teste e a uma tarefa. Spec e código mudam juntos, então a spec não volta a contradizer o código.
- **Alternativas rejeitadas:**
  - **Uma regra só no `CLAUDE.md`:** não traz o passo a passo nem o checklist do plano. O `CLAUDE.md` passa a apontar para a skill.
  - **Parar para aprovação do plano sempre:** o pedido foi "planeja primeiro e só depois implementa", não "espera aprovação". A skill para só quando uma Open Question muda o que será construído, ou quando o usuário pede só o plano.

## Restrições

- **Compatibilidade:** não muda o formato das specs (ADR-0025) nem o CLI. As 20 features existentes continuam como estão. Uma mudança nelas abre uma fase nova no Implementation Plan.
- **Limites operacionais:** a skill vale para o Claude Code aberto neste repositório. Quem edita à mão segue a mesma ordem pelo `.specs/README.md` › Como manter.

## Plano de rollout

- **Fase 1:** a skill, este ADR e os ponteiros no `CLAUDE.md` e no `.specs/README.md`.
- **Sinal de parada:** a skill gerar specs que o código final contradiz. Nesse caso, a etapa "Feche a spec" precisa ficar mais rígida.
- **Reversão:** apagar `.claude/skills/feature/` e as duas linhas que apontam para ela. Nenhum dado nem código depende dela.

## Consequências

- **Positivas:**
  - Cada feature nova chega com ACs, testes planejados e um plano de tarefas antes do código.
  - A spec termina conferida com o que foi construído.
- **Negativas / custos:**
  - Mais tempo antes da primeira linha de código, mesmo em features pequenas. Para ajustes de uma linha, o plano é só a mudança na spec.
- **Regras que daqui decorrem:**
  - Código de produto de uma feature só entra depois da spec dela.
  - Um desvio do plano durante a implementação atualiza a spec antes do código.

## Referências

- `.claude/skills/feature/SKILL.md`, `.specs/_templates/feature.md`, `.specs/features/reminders/spec.md` (modelo)
- [ADR-0025](0025-features-formato-feature-specification.md): o formato Feature Specification
- [ADR-0018](0018-cli-scaffolding-so-cria-arquivos-novos.md): o CLI `npm run new`
