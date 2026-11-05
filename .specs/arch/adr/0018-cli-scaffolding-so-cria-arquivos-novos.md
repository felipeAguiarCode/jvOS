# ADR-0018: CLI de scaffolding que só cria arquivos novos

| | |
|---|---|
| **Status** | Aceito · em parte substituído pelo [ADR-0019](0019-specs-arquivo-unico-formato-spec-lang.md) (o checklist vai para Tarefas › Fase 2 do `spec.md`) |
| **Data** | 2026-11-03 |
| **Origem** | conversa (2026-11-03): o usuário pediu um CLI em `.cli/` para criar feature e widget no padrão do projeto, com ASCII no formato do JARVIS e specs nos formatos atuais |

## Contexto

Criar um widget hoje toca de 6 a 10 arquivos existentes: `src/lib/desktop.ts` (union, `WINDOW_KINDS`, `WINDOW_SPECS`), `src/lib/commands.ts`, `src-tauri/src/settings.rs`, `src-tauri/voice-commands.json`, `Desktop.tsx` e, com dados, `App.tsx`, além do `testMatch` e dos docs.

As falhas não aparecem da mesma forma:
- **No build:** faltar no union, em `WINDOW_SPECS` ou em `WINDOW_KEYWORDS` quebra o `tsc`, e um array de tamanho errado em `settings.rs` quebra o `cargo`.
- **Num teste Rust:** sem a entrada no catálogo de voz, o `default_voice_commands_are_valid` falha.
- **Em silêncio:** sem `WINDOW_KINDS` ou sem o `case` do `WindowContent`, o build passa, mas a janela não abre ou abre vazia. Um teste fora do `testMatch` simplesmente não roda.

As specs (`.specs/`) seguem templates que hoje são copiados e preenchidos à mão.

Na conversa, o usuário escolheu "specs + arquivos novos": o CLI cria as specs e os arquivos novos, mas **não mexe em nenhum arquivo existente**, e imprime o checklist dos registros.

## Decisão

- **Onde:** manter o CLI em `.cli/` (`npm run new`), em Node ESM sem dependências, no estilo de `scripts/tauri.mjs`.
- **O que cria:** widget, app, feature e ADR. Cada execução gera:
  - a pasta da spec, preenchida a partir de **`.specs/_templates/`, que continua sendo a fonte única** (linhas do cabeçalho e seções trocadas por chave);
  - os esqueletos de código, a partir de `.cli/templates/`: componente com o kit TUI, lib e hook com parser tolerante quando há dados, e teste Playwright.
- **Nunca editar arquivo existente.** O CLI grava com a flag `wx` e recusa qualquer caminho que já exista. Os registros saem como um checklist com o trecho pronto para colar, calculado a partir do conteúdo atual de cada arquivo. O mesmo checklist entra como tarefas `[ ]` na Fase 2 do `tasks.md`. Cada item tem uma tag que diz o que falha sem ele: `TSC`, `CARGO`, `CARGO-TEST`, `FUNC` ou `DOC`.
- **Visual do boot:** usar as letras ANSI Shadow da tela de boot e a paleta azul, espelhadas de `src/lib/asciiFont.ts` e `src/lib/theme.ts` com o comentário `Mirrors`. Ver [ADR-0009](0009-tipos-espelhados-ts-rust.md).
- **Status novo:** as specs criadas pelo CLI começam com `Em desenvolvimento`.

## Consequências

- **Positivas:**
  - Um item novo nasce com spec, plano, tarefas, código que compila sozinho e teste.
  - Os dois registros que falham em silêncio ficam visíveis no checklist.
  - O CLI não corre o risco de corromper arquivos com CRLF misturado ou editados à mão.
- **Negativas / custos:**
  - Colar os trechos ainda é manual.
  - Os trechos assumem o arquivo como estava na hora da geração. Dois itens gerados em seguida mostram as mesmas linhas de referência, então o segundo precisa ser ajustado ao colar.
  - O CLI lê os arquivos por padrões de texto (a linha de `WINDOW_KINDS`, `WINDOW_SPECS`, `SHORTCUT_TARGETS`…). Se o formato desses arquivos mudar, os testes do CLI apontam a quebra.
- **Regras que daqui decorrem:**
  - Item novo começa com `npm run new`.
  - Mudou um template de `.specs/_templates/` ou o formato de um arquivo que o CLI lê: rode `npm run test:cli`.
  - Os esqueletos em `.cli/templates/` seguem o [coding-style](../coding-style.md).

## Alternativas consideradas

- **Specs + código + registro automático:** editar os arquivos existentes por âncoras. Foi oferecida e recusada pelo usuário.
- **Só specs.** Também oferecida e recusada.
- **Bibliotecas de prompt** (por exemplo `@clack/prompts`): não registradas; ficou zero dependências, seguindo P9 (desktop leve) e o padrão de `scripts/`.

## Referências

- `.cli/jarvis.mjs`, `.cli/lib/checklist.mjs`, `.cli/lib/specs.mjs`, `.cli/templates/`
- `.cli/test/jarvis.test.mjs` (`npm run test:cli`)
- [build-and-env](../build-and-env.md), [testing](../testing.md#cli-cli), [coding-style](../coding-style.md#checklist-de-uma-mudança)
- Specs afetadas: [desktop-windows](../../features/desktop-windows/spec.md), [voice-commands](../../features/voice-commands/spec.md)
