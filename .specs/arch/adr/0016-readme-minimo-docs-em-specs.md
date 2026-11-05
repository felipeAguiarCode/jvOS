# ADR-0016: README mínimo; a documentação detalhada vive em `.specs`

| | |
|---|---|
| **Status** | Aceito · em parte substituído pelo [ADR-0019](0019-specs-arquivo-unico-formato-spec-lang.md) (formato das specs) |
| **Data** | 2026-10-26 (README curto) · 2026-11-01 (`.specs`) |
| **Origem** | commit `c4ccc57` ("README rewritten to be short"); memória `readme-minimal`; pedido de criação de `.specs` |

## Contexto

O README crescia a cada feature: listas de testes, tabelas de frases de voz, linhas de atalhos, locais de dados e a árvore de pastas. Chegou a ~420 linhas e ficou ilegível. Em 26/10 o usuário cortou o arquivo para ~90 linhas e, em 27/10, pediu ainda menos.

Com o corte, essas informações passaram a existir só no código e em memórias locais do assistente.

## Decisão

- O **README** contém só: logo centralizado (`app-icon.svg`), tecnologias, "O que faz", requisitos recomendados (máquina e software) e um bloco de 3 linhas para rodar.
- **Todo o resto** vai para `.specs/`:
  - comportamento: `features/`, `widgets/` e `apps/`, no formato spec-kit (`spec.md`, `plan.md` e `tasks.md`);
  - contratos e regras: `arch/`;
  - linguagem e dados: `domain/`;
  - decisões: `arch/adr/`.
- O `CLAUDE.md` na raiz aponta para `.specs` e define a regra de manutenção.

## Consequências

- **Positivas:** um README que se lê em 30 segundos e uma documentação navegável e versionada junto com o código.
- **Negativas:** a documentação só vale se for atualizada junto com o código.
- **Regras:**
  - uma feature nova acrescenta no máximo um bullet curto em "O que faz";
  - nunca recolocar no README tabelas de testes, atalhos, frases ou dados;
  - a spec é criada ou atualizada no mesmo trabalho que muda o comportamento.

## Alternativas consideradas

O README longo foi o estado anterior, abandonado.

## Referências

- `README.md`, `CLAUDE.md`, [.specs/README.md](../../README.md)
