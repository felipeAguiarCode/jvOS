# ADR-0023: Specs e templates no formato do spec-coding.dev

| | |
|---|---|
| **Status** | Aceito · em parte substituído pelo [ADR-0025](0025-features-formato-feature-specification.md) (o formato de `features/`) |
| **Data** | 2026-11-05 |
| **Origem** | conversa (2026-11-05): o usuário pediu uma área de critérios de aceite em todas as specs e depois "tanto os templates quanto todas as specs use como referência https://spec-coding.dev/tools/" |
| **Spec** | todas as de `features/`, `widgets/`, `apps/` e `foundation/`; `_templates/spec.md`, `_templates/vendor.md`, `_templates/adr.md` |

## Contexto

O [ADR-0019](0019-specs-arquivo-unico-formato-spec-lang.md) juntou as specs num arquivo só, no formato SpecLang da GitHub Next, com os IDs e o aceite do spec-kit. O aceite ficava espalhado: cada história tinha a sua lista "**Aceite**", com 525 cenários Dado/quando/então em 160 histórias, e nenhuma spec tinha uma seção de critérios de aceite.

O usuário pediu os critérios "iguais aos exemplos do GitHub SpecLang". A página do SpecLang não tem critérios de aceite. O template do Spec Kit os põe dentro de cada história, e o módulo do Spec Kit na Microsoft Learn usa uma lista solta de fatos. Em seguida, o usuário apontou a referência certa: as ferramentas do spec-coding.dev, para os templates e para todas as specs.

As ferramentas do spec-coding.dev usam estes formatos:
- **Feature Spec Generator:** `# Feature: <nome>`, `## Goal`, `## Non-Goals`, `## Acceptance Criteria` (um `### Criterion N` por critério, com bullets **Given** / **When** / **Then**), `## Edge Cases`, `## Output` e `## Dependencies`.
- **Template de feature spec:** casos de borda nas categorias null/empty, duplicates/idempotency, concurrency/race e permissions/visibility; entregáveis com as mudanças, o checklist de testes e as notas de rollback; de cinco a doze critérios, cobrindo um caminho feliz, um de falha e um caso de borda.
- **Tasks Plan:** cada tarefa com o link para o aceite, os arquivos permitidos, o comando de teste e a evidência.
- **Design Doc:** Context, Architecture Decision (escolha, motivo, alternativas rejeitadas), Interfaces, Constraints (compatibility, security, performance, operational limits) e Rollout Plan.

## Decisão

- **Abordagem escolhida:**
  - **Ordem do spec-coding.dev:** a ordem das seções de toda spec segue o Feature Spec Generator. `## Visão geral` virou `## Objetivo`, `## Fora de escopo e limitações` virou `## Não-objetivos` e `## Código` virou `## Entregáveis`. O título leva o tipo: `# Feature:`, `# Widget:`, `# App:`, `# Vendor:` ou `# Fundamento:`.
  - **Critérios de aceite:** ficam numa seção própria, com `### Critério N (USk)` e os bullets **Dado** / **Quando** / **Então**, as palavras do Gherkin em português. Cada história mostra `**Aceite:** [critérios a a b](#critérios-de-aceite)`. Os critérios das specs de vendor e de fundamentos citam o RF ou o RNF que provam.
  - **Corpo SpecLang:** Dados, Telas, Componentes, Voz e teclado e Restrições continuam, entre os casos de borda e os entregáveis. São a fonte da verdade do que o código faz.
  - **Casos de borda:** abrem com as quatro categorias do template (Vazio/nulo, Duplicidade/idempotência, Concorrência/corrida, Permissões/visibilidade). Os itens que já existiam continuam abaixo.
  - **Entregáveis:** ganham `### Testes` (o comando exato e os critérios que cada teste prova) e `### Reversão` (o que tirar e o que fica órfão sem risco).
  - **Dependências:** viram uma seção própria, com links para as specs de vendor ([ADR-0024](0024-specs-de-fundamentos-e-vendor.md)), as outras specs e os recursos do sistema.
  - **Tarefas novas:** seguem o Tasks Plan (Aceite, Arquivos permitidos, Comando de teste, Evidência). O CLI (`npm run new`) já gera assim.
  - **ADRs novos:** seguem o Design Doc, com Consequências e Referências no fim.
- **Por quê:** o usuário escolheu o spec-coding.dev como referência. O formato separa o que se prova (critérios binários, cada um virando um teste) do que se constrói (entregáveis, testes e reversão), e torna explícito o que faltava: casos de borda por categoria, o comando de cada teste e o caminho de volta.
- **Alternativas rejeitadas:**
  - **Seguir o SpecLang para o aceite:** o formato não tem critérios de aceite.
  - **Só uma lista de fatos (Microsoft Learn):** perderia os 525 cenários Dado/Quando/Então já conferidos com o código.
  - **Manter os cenários nas histórias e acrescentar uma lista:** duplicaria o aceite.
  - **Converter o spec-coding.dev ao pé da letra:** perderia Dados, Componentes, Layout e Estilo, que o formato não tem e que descrevem o código.

## Interfaces

- **Dados:** os arquivos `spec.md` mudam de forma, mas os IDs (US, RF, RNF, SC, T) e o texto deles não mudam. Os links `spec.md#código` e `#fora-de-escopo-e-limitações` viraram `#entregáveis` e `#não-objetivos`.
- **CLI:** `.cli/lib/specs.mjs` e `.cli/lib/checklist.mjs` geram o formato novo, com os critérios, os casos de borda, os testes, a reversão, as dependências e as tarefas do Tasks Plan. Os testes do CLI conferem a ordem das seções.

## Restrições

- **Compatibilidade:** nenhum ID foi renumerado nem perdido. A conversão foi feita por script, com auditoria:
  - 550 cenários viraram 550 critérios, e as palavras de cada um foram comparadas em ordem;
  - a reordenação conferiu que toda linha não vazia continua no arquivo.
  O único cenário sem palavra-chave ("Na sequência, Relógio, Agenda e Tarefas abrem…", em greeting-homecoming) ganhou um **Dado** escrito à mão.
- **Limites operacionais:** as tarefas antigas (`[x]`) ficaram na forma de uma linha. Só as novas seguem o Tasks Plan.

## Plano de rollout

- **Fase 1:** cenários das histórias para `## Critérios de aceite`, por script (550 critérios em 37 specs), e o CLI e os templates no formato novo.
- **Fase 2:** reordenação das seções por script, com marcadores onde entra conteúdo novo, preenchidos em seguida: casos de borda por categoria, testes, reversão, dependências e um critério de falha onde não havia.
- **Sinal de parada:** a auditoria apontar uma linha ou um cenário perdido.
- **Reversão:** `git checkout` dos arquivos de `.specs/` e de `.cli/` do commit anterior. Os IDs não mudaram, então nenhum link de fora quebra.

## Consequências

- **Positivas:**
  - O aceite de cada spec fica num lugar só, com números estáveis, e cada critério aponta a história e o teste que o provam.
  - Toda spec diz o que fazer quando algo falta, se repete, corre em paralelo ou não tem permissão.
  - Toda spec diz como rodar os testes e como desfazer o item.
- **Negativas / custos:**
  - As specs cresceram: cada cenário de uma linha virou um bloco de cinco.
  - Os IDs de critério seguem a história, então um critério novo de uma história antiga quebra a sequência.
  - O formato é híbrido, com o spec-coding.dev em volta e o SpecLang no meio.
- **Regras que daqui decorrem:**
  - Um critério novo pega o próximo número livre, e nenhum número é reaproveitado. A linha `**Aceite:**` da história é atualizada junto.
  - Uma spec nova tem ao menos um critério de caminho feliz, um de falha e um de borda.
  - Mudou o comportamento: atualize o componente, os critérios, os casos de borda, os testes e a reversão.

## Referências

- [spec-coding.dev — Tools](https://spec-coding.dev/tools/), [Feature Spec Generator](https://spec-coding.dev/tools/spec-generator), [Feature Spec Template](https://spec-coding.dev/templates/feature-spec), [Tasks Plan](https://spec-coding.dev/templates/sdd-tasks-plan), [Design Doc](https://spec-coding.dev/templates/sdd-design-doc)
- `.specs/_templates/spec.md`, `.specs/_templates/vendor.md`, `.specs/_templates/adr.md`, `.cli/lib/specs.mjs`
- Substitui em parte o [ADR-0019](0019-specs-arquivo-unico-formato-spec-lang.md): a ordem das seções e o aceite dentro das histórias. O arquivo único e o corpo SpecLang continuam.
