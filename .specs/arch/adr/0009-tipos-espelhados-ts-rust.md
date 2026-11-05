# ADR-0009: Tipos espelhados entre TypeScript e Rust por convenção, sem geração de código

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-23 |
| **Origem** | prática observada (24 ocorrências de `Mirrors` no código) |

## Contexto

Dezenas de tipos atravessam o IPC: `Settings`, `VoiceCommand`, `AssistantEvent`, `Quote`, `WorkspaceInfo`, `Stamp`… Ferramentas de geração (ts-rs, specta) acrescentariam passo de build e dependência. O projeto tem um único autor e poucos tipos por domínio.

## Decisão

- Cada tipo que cruza o IPC é escrito **à mão nos dois lados**.
- O lado TypeScript leva o comentário `Mirrors \`<Tipo>\` in <caminho>`. Constantes compartilhadas, como `WINDOW_KINDS` e `SHORTCUT_TARGETS`, levam `Mirrors` no Rust.
- Rust com `#[serde(rename_all = "camelCase")]`. Enums com tag viram **uniões discriminadas** no TypeScript.
- Códigos de erro sentinela são strings iguais nos dois lados: `model-missing`, `voice-missing` e `file-changed`.
- Lógica que precisa rodar nos dois lados ganha um "gêmeo" explícito. Exemplo: `withBuiltinCommands` em `settings.ts` espelha `sanitize_voice_commands`.

## Consequências

- **Positivas:** zero ferramental; os tipos ficam legíveis e documentados onde são usados.
- **Negativas:**
  - divergências só aparecem em tempo de execução;
  - o `#[serde(default)]` mascara campos renomeados.
- **Regras:**
  - ao mudar um tipo, procure `Mirrors` pelo nome e atualize os dois lados na mesma mudança;
  - registre o contrato em [ipc-contract](../ipc-contract.md).

## Alternativas consideradas

Não registradas.

## Referências

- `src/lib/settings.ts`, `src/lib/assistant.ts`, `src/lib/theme.ts`, `src-tauri/src/settings.rs`, `src-tauri/src/assistant.rs`
