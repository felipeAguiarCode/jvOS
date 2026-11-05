# ADR-0010: Persistência dividida entre `settings.json` (Rust) e `localStorage` (UI), com parsers tolerantes

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-23 |
| **Origem** | prática observada; `src-tauri/src/settings.rs`, `src/lib/storage.ts` |

## Contexto

Parte da configuração precisa ser lida **sem a WebView**: a thread de voz precisa do modo de ativação, do modelo, dos programas e das frases, e o assistente precisa do modelo e do nome. Outra parte só interessa à UI: geometria das janelas, tema da TUI, agenda, tarefas, histórico. O formato muda a cada feature, e um dado velho não pode quebrar a inicialização.

## Decisão

- **`%APPDATA%\dev.jarvis.os\settings.json`** pertence ao Rust (`Settings`) e guarda o que o backend precisa: voz, programas, comandos de voz, modelo e nome do assistente, além de tema e barra, que vêm junto.
  - Sanitizado em toda leitura e gravação, com gravação atômica.
  - `#[serde(default)]` sem `deny_unknown_fields`.
  - Fora do Tauri vai para `localStorage["jarvis.settings"]`.
- **`localStorage` com chaves `jarvis.*`** guarda o resto, sempre por `src/lib/storage.ts` (`readJson` / `writeJson` / `useStoredState`).
  - Cada chave tem um `parse(raw: unknown)` que valida campo a campo e cai no padrão.
  - Debounce de 250 ms por padrão, **0** para dados que o usuário não pode perder.
  - Flush no `beforeunload`.
- **Migrações explícitas:** o mapa `RENAMED` (`code` → `ide`), chaves `jarvis.migrations.*`, `OLD_CODE_PHRASES`, `OLD_TERMINAL_KEYWORDS` e `RETIRED_PHRASES`.
- **O que o usuário edita fora do app** fica em arquivos Markdown em `Documentos\JARVIS`.

## Consequências

- **Positivas:**
  - o backend funciona sem a UI;
  - dado corrompido volta ao padrão em vez de quebrar;
  - os testes semeiam o estado escrevendo no `localStorage`.
- **Negativas:**
  - os dados da UI ficam presos ao perfil da WebView2: não há exportação, e limpar os dados do site apaga a agenda;
  - campos removidos do `Settings` somem em silêncio;
  - há duas fontes de verdade para o tema (settings + `jarvis.tui`).
- **Regras:**
  - chave nova = parser tolerante + linha em [persistence](../../domain/persistence.md);
  - se o Rust precisa ler, vai para o `Settings`.

## Alternativas consideradas

Não registradas.

## Referências

- [persistence](../../domain/persistence.md), [coding-style](../coding-style.md#persistência)
