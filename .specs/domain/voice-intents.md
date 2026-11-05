# Intents de voz

Este é o catálogo do que a voz entende e de como uma frase vira uma ação. Na fonte há duas peças:
- o catálogo `src-tauri/voice-commands.json`, com 53 entradas, embutido no binário (`settings.rs`) e importado pela UI (`src/lib/settings.ts`);
- o algoritmo `src-tauri/src/voice/matcher.rs`.

Specs relacionadas:
- [voice-commands](../features/voice-commands/spec.md): matcher, edição e comandos custom.
- [voice-shortcuts](../features/voice-shortcuts/spec.md): as ações do JARVIS.
- [ADR-0004](../arch/adr/0004-catalogo-de-voz-compartilhado-e-fallback.md).

## Forma de uma entrada

```json
{ "id": "window:clock", "kind": "window", "target": "clock", "label": "Relógio", "phrases": ["relógio", "clock"] }
```

| Campo | Significado |
|---|---|
| `id` | `<kind>:<target>` nos built-ins. Os comandos do usuário usam `custom-*` |
| `kind` | `window`, `verbs`, `group`, `music`, `playVerbs`, `pomodoro`, `shortcut` ou `playlist` (playlist só existe em comando do usuário) |
| `target` | o que a ação atinge: `WindowKind`, grupo, ação de música/pomodoro ou `ShortcutAction` |
| `label` | nome mostrado em Menu avançado → Voz |
| `phrases` | até 30 frases de até 60 caracteres cada |
| `builtin` | é preenchido ao carregar. Built-ins podem trocar as frases, mas não a ação, e voltam se forem apagados |

Os programas externos não ficam neste arquivo. As palavras-chave deles estão em `Settings.apps[].keywords`, com até 12 por app; ver [app-launcher](../features/app-launcher/spec.md).

## Catálogo por tipo

### `window` (17): abrir ou fechar uma janela

A frase de janela combina com um verbo de `verbs:open` ou `verbs:close`. Exemplos: "Jarvis, abre o relógio" e "fecha a calculadora".

| id | Janela | Exemplos de frases |
|---|---|---|
| `window:clock` | Relógio | relógio, clock |
| `window:pomodoro` | Pomodoro | pomodoro, temporizador, timer |
| `window:battery` | Bateria | bateria, battery |
| `window:calculator` | Calculadora | calculadora, calculator |
| `window:tape` | Fita | fita, cassete, fita cassete |
| `window:miniplayer` | Mini player | mini player, controle de música |
| `window:system` | Sistema | sistema, monitor do sistema, desempenho |
| `window:stocks` | Ações | ações, cotações, bolsa, carteira de ações |
| `window:weather` | Clima | clima, widget do clima, previsão |
| `window:agenda` | Agenda | agenda, calendário, compromissos |
| `window:tasks` | Tarefas | tarefas, lista de tarefas, to do list |
| `window:markdown` | Jarvis Mark | Jarvis Mark, markdown, editor de markdown |
| `window:ide` | jv_ide | jv ide, IDE, Jarvis Code, código |
| `window:music` | jv_T4p3 | jv tape, tape, player, player de música |
| `window:shell` | jv_sh | terminal, jv sh, shell, console |
| `window:lab` | jv_lab | jv lab, laboratório, lições, aulas |
| `window:agent` | jv_agent | jv agent, agentes, criador de agentes |

### `verbs` (2) e `group` (3)

| id | Uso |
|---|---|
| `verbs:open` | abre, abrir, abra, abri… |
| `verbs:close` | fecha, fechar, feche, fechem… |
| `group:widgets` | "fecha todos os widgets" |
| `group:apps` | "fecha os aplicativos" |
| `group:all` | "fecha todas as janelas" / "tudo" |

### `music` (6) e `playVerbs` (1)

| id | Ação |
|---|---|
| `music:resume` | tocar ou continuar ("dá play", "play") |
| `music:pause` | pausar |
| `music:next` / `music:previous` | próxima faixa / faixa anterior |
| `music:nextPlaylist` / `music:previousPlaylist` | trocar de estação ou playlist |
| `music:play` (`playVerbs`) | "toca …" + nome de estação (Flash FM, Wave 103, V-Rock, Fever 105, Emotion 98.3, Radio Espantoso, Wildstyle) ou de playlist do usuário |

### `pomodoro` (6)

São `start`, `pause`, `reset`, `skip`, `longer` (+5 min) e `shorter` (−5 min), com frases como "inicia o pomodoro" e "mais cinco minutos". Ver [widgets/pomodoro](../widgets/pomodoro/spec.md).

### `shortcut` (18): ações do JARVIS

Espelham `SHORTCUT_TARGETS` (`settings.rs`) e `ShortcutAction` (`src/lib/shortcuts.ts`).

| id | Rótulo | Exemplo | Precisa de texto depois? | Spec dona |
|---|---|---|---|---|
| `shortcut:research` | Pesquisar e salvar em nota | "pesquisa sobre …" | sim | [voice-shortcuts](../features/voice-shortcuts/spec.md) |
| `shortcut:note` | Anotar | "anota que …" | sim | [quick-notes](../features/quick-notes/spec.md) |
| `shortcut:reminder` | Lembrete ou timer | "me lembra de … daqui a 10 minutos" | sim | [reminders](../features/reminders/spec.md) |
| `shortcut:time` | Que horas são | "que horas são" | não | voice-shortcuts |
| `shortcut:date` | Que dia é hoje | "que dia é hoje" | não | voice-shortcuts |
| `shortcut:status` | Status do sistema | "status do sistema" | não | voice-shortcuts |
| `shortcut:briefing` | Briefing do dia | "bom dia", "resumo do dia" | não | voice-shortcuts |
| `shortcut:focus` | Protocolo foco | "protocolo foco" | não | voice-shortcuts / [pomodoro](../widgets/pomodoro/spec.md) |
| `shortcut:memory` | Guardar na memória | "lembre-se que …" | sim | voice-shortcuts |
| `shortcut:weather` | Previsão do tempo | "como está o tempo em Curitiba amanhã" | não | [widgets/weather](../widgets/weather/spec.md) |
| `shortcut:agenda` | Repassar a agenda | "minha agenda", "o que eu tenho amanhã" | não | [widgets/agenda](../widgets/agenda/spec.md) |
| `shortcut:agendaRemove` | Desmarcar compromisso pelo número | "apaga o compromisso dois" | sim | widgets/agenda |
| `shortcut:tasks` | Repassar as tarefas | "minhas tarefas" | não | [widgets/tasks](../widgets/tasks/spec.md) |
| `shortcut:taskAdd` | Adicionar tarefa | "adiciona a tarefa …" | sim | widgets/tasks |
| `shortcut:taskDone` | Concluir tarefa | "conclui a tarefa três" | sim | widgets/tasks |
| `shortcut:taskRemove` | Remover tarefa | "remove a tarefa …" | sim | widgets/tasks |
| `shortcut:cleanup` | Limpeza de memória | "limpa a memória" | não | [memory-cleanup](../features/memory-cleanup/spec.md) |
| `shortcut:homecoming` | Acorda, querido, papai chegou | "acorda, querido, papai chegou" | não; e **não precisa do nome do JARVIS** | [greeting-homecoming](../features/greeting-homecoming/spec.md) |

## Como o matcher decide (`matcher.rs`)

1. **Normalização.** Minúsculas, sem acentos e sem pontuação. Palavras de preenchimento no começo ("por favor", "ok", "então"…) são ignoradas.
2. **Palavra de ativação.** "hey jarvis", "ei jarvis" e os apelidos que o Whisper costuma ouvir no lugar: `jarbas`, `jarvas`, `djarvis`, `jarviz`, `javis`, `javiz` e `jarves`. No modo `wakeWord`, ouvir o nome abre uma **janela acordada de 8 s** (`AWAKE_WINDOW`).
3. **Ordem de checagem:**
   1. atalho sem endereçamento (`homecoming`), válido em qualquer modo;
   2. atalhos (`shortcut:*`); os de `NEEDS_TEXT` só valem se houver texto depois da frase;
   3. música e pomodoro;
   4. alvo: janela, grupo ou programa.

   Em empate vence a palavra-chave mais longa e, depois, a que aparece primeiro.
4. **Tolerância.** Palavras de 5 letras ou mais aceitam 1 edição de Levenshtein.
5. **Pergunta, não comando.** Uma palavra-chave sem verbo de abrir/fechar, numa frase de 4 palavras ou mais (`QUESTION_WITH_KEYWORD`), é tratada como pergunta. Exemplo: "como está a bateria do notebook?".
6. **Repetição.** A mesma decisão repetida em menos de **4 s** é ignorada (`RELAUNCH_COOLDOWN`).
7. **Fallback.** Uma fala endereçada ao JARVIS, com **2 palavras ou mais**, que não seja alucinação conhecida do Whisper ("amara org", "inscreva se", "legendas pela", "obrigado por assistir"), vira `Ask { text }` e vai para o [assistente](../features/assistant/spec.md).

O resultado é um `Decision`: `Ignore`, `Wake`, `Launch`, `Window`, `CannotClose`, `CloseGroup`, `Music`, `Pomodoro`, `Shortcut` ou `Ask`. A UI recebe cada um como um evento `voice:*`; ver [ipc-contract](../arch/ipc-contract.md#eventos).

## Regras de manutenção

- **Frases novas num built-in.** O `settings.json` do usuário guarda todos os comandos, e `sanitize_voice_commands` preserva as frases salvas. Ao mudar as frases de um built-in, coloque a lista **anterior** em `RETIRED_PHRASES` (`settings.rs`). Assim, um comando que o usuário não editou passa a usar as novas. Teste de referência: `untouched_builtin_phrases_follow_the_new_defaults`.
- **Comando novo** (id novo) é inserido automaticamente para todos.
- **Renomeações históricas** têm migração: `window:code` virou `window:ide` (`OLD_CODE_PHRASES`), e as palavras "terminal", "console" e "prompt de comando" passaram do Windows Terminal ao jv_sh (`OLD_TERMINAL_KEYWORDS`).
- **Vite não serve mudanças neste arquivo.** O Vite ignora `src-tauri/**`, então uma edição no `voice-commands.json` só chega à UI depois de um `touch vite.config.ts`.
