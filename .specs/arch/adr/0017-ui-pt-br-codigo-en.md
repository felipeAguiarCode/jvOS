# ADR-0017: Interface em PT-BR, código em inglês

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-23 |
| **Origem** | prática observada desde o commit inicial; memória `user-profile` |

## Contexto

O usuário escreve em português do Brasil e espera a interface, a voz e as respostas do JARVIS em PT-BR. O ecossistema (bibliotecas, APIs, o próprio Claude Code), os nomes técnicos e as mensagens de commit funcionam melhor em inglês.

## Decisão

| Em PT-BR | Em inglês |
|---|---|
| Texto da UI, aria-labels, mensagens de erro ao usuário (inclusive as do Rust), frases de voz, persona e falas do JARVIS, lições do jv_lab, conteúdo de `.specs` | Identificadores, nomes de arquivo, comentários e JSDoc, títulos de testes, mensagens de commit, chaves de armazenamento (`jarvis.*`), nomes de comando e evento |

- Os nomes de produto seguem o estilo `jv_*` (jv_ide, jv_sh, jv_T4p3, jv_lab, jv_agent), mais o Jarvis Mark.
- Datas e números na UI usam o formato pt-BR. A calculadora formata no padrão brasileiro.

## Consequências

- **Positivas:** a experiência fica nativa para o usuário, e o código fica legível e pesquisável em inglês.
- **Negativas:**
  - os testes usam locators em PT-BR: rótulos curtos colidem ("Iniciar" casa com "Reiniciar"), por isso `exact: true`;
  - o matcher precisa normalizar acentos.
- **Regras:**
  - nenhuma string visível ao usuário em inglês;
  - nenhum identificador em português, salvo dados de domínio como `Memória.md`, `Notas` e `Agentes`.

## Alternativas consideradas

Não registradas.

## Referências

- [coding-style](../coding-style.md), [constituição P7](../constitution.md#p7--pt-br-para-o-usuário-inglês-no-código)
