# ADR-0004: Catálogo de voz compartilhado em JSON, com fallback para o JARVIS

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-27 (fallback para o JARVIS; `RETIRED_PHRASES`) |
| **Origem** | commits `42e671a`, `048a254`; memória `voice-phrases-migration` |

## Contexto

As frases de voz são usadas em dois lugares:
- no **Rust**, pelo matcher, que roda na thread de voz;
- na **UI**, que mostra e edita as frases (Menu avançado → Voz) e precisa saber o que é built-in.

Duplicar o catálogo faria os dois lados divergirem. Além disso, um comando de voz rígido falha com qualquer frase fora da lista, e o usuário espera que o JARVIS entenda o resto.

## Decisão

1. **Uma fonte:** `src-tauri/voice-commands.json` (`{id, kind, target, label, phrases[]}`). O Rust o embute com `include_str!` (`settings.rs`) e a UI o importa (`src/lib/settings.ts`, com `withBuiltinCommands` como gêmeo do sanitizador no navegador).
2. **Built-ins editáveis só nas frases.** A ação é fixa e o built-in volta se for apagado. Comandos do usuário usam ids `custom-*`, no máximo 100.
3. **Fallback.** Uma fala endereçada ao JARVIS, com 2 palavras ou mais, que não seja comando nem alucinação conhecida, vira `Decision::Ask` → `voice:shortcut {action: "ask"}` → pergunta ao Claude.
4. **Migração de frases.** O `settings.json` guarda os comandos com as frases, e `sanitize_voice_commands` preserva as salvas. Por isso, ao mudar as frases de um built-in, a lista **anterior** entra em `RETIRED_PHRASES`. Um comando que ainda tem exatamente essa lista nunca foi editado e passa a usar as novas.

## Consequências

- **Positivas:**
  - Rust e UI nunca divergem;
  - o usuário personaliza sem quebrar a ação;
  - "qualquer outra coisa" vira uma conversa em vez de "não entendi".
- **Negativas:**
  - mudar frases de um built-in sem `RETIRED_PHRASES` **não chega** a quem já tem `settings.json`, e falha em silêncio (aconteceu com `shortcut:agenda` em 27/10);
  - o Vite ignora `src-tauri/**`, então editar o JSON exige `touch vite.config.ts`.
- **Regras:**
  - id novo é inserido automaticamente para todos;
  - frase nova em id existente precisa de `RETIRED_PHRASES` e de um teste como `untouched_builtin_phrases_follow_the_new_defaults`.

## Alternativas consideradas

Não registradas.

## Referências

- `src-tauri/voice-commands.json`, `src-tauri/src/settings.rs`, `src-tauri/src/voice/matcher.rs`, `src/lib/settings.ts`
- [voice-intents](../../domain/voice-intents.md), [voice-commands](../../features/voice-commands/spec.md)
