# Contrato IPC (UI ↔ Rust)

Este é o catálogo único da fronteira entre a WebView e o Rust. Todos os comandos ficam em `src-tauri/src/lib.rs` (P3 da [constituição](constitution.md)) e repassam a chamada ao módulo do domínio. Os tipos atravessam em camelCase e são espelhados no TypeScript ([ADR-0009](adr/0009-tipos-espelhados-ts-rust.md)).

Os erros chegam como `string`, quase sempre em PT-BR. Alguns códigos sentinela são comparados por igualdade:
- `model-missing`: falta o modelo Whisper;
- `voice-missing`: falta a voz TTS;
- `file-changed`: o arquivo mudou desde a leitura.

Um comando que lê ou grava em disco, sobe um processo ou usa a rede é `async fn` e roda o trabalho em `blocking()` (`spawn_blocking`): um comando `fn` comum roda na thread principal e segura a janela enquanto não volta. Desde 2026-11-19 isso vale também para `launch_app`, `read_text_file`, `write_text_file`, `agent_drafts`, `terminal_profiles`, `terminal_open` e `terminal_open_agent`; nomes, argumentos e retornos não mudaram. Continuam síncronos só os que respondem da memória ou repassam a chamada (`get_settings`, `voice_status`, `terminal_write`, `terminal_resize`, `terminal_close`, `webview_background`…).

## Comandos (79)

### Configurações e modelos (5) · [settings](../features/settings/spec.md), [voice-engine](../features/voice-engine/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `get_settings` | — | `Settings` |
| `save_settings` | `settings` | `Settings` (sanitizado; `voiceEnabled` preservado; trocar o modelo ou o `voiceDevice` reinicia o motor; o resto acorda o motor parado na hora) |
| `models_status` | — | `ModelStatus[]` |
| `download_model` | `id` | `()`; progresso via `model:progress` / `model:done` |
| `voice_devices` | — | `VoiceDevices`: `gpus[]` (`name`, `vramMb`), `accelerated` (build com Vulkan), `active` ("CPU", o nome da GPU, ou null com a escuta desligada) |

### Programas e arquivos (3) · [app-launcher](../features/app-launcher/spec.md), [jarvis-mark](../apps/jarvis-mark/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `launch_app` | `id` (só ids configurados) | `()` |
| `read_text_file` | `path` absoluto | `string` (UTF-8, ≤ 2 MB) |
| `write_text_file` | `path` absoluto, `contents` | `()` (atômico) |

### Voz (7) · [voice-engine](../features/voice-engine/spec.md), [dictation](../features/dictation/spec.md), [tts](../features/tts/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `voice_start` / `voice_stop` | — | `VoiceStatus` |
| `voice_status` | — | `VoiceStatus` |
| `voice_push` | `down`, `cancel` | `VoiceStatus` (push-to-talk) |
| `voice_dictate` | `down` | `VoiceStatus` (liga o motor sob demanda) |
| `voice_ask` | `down`, `cancel` | `VoiceStatus` (pergunta direta ao JARVIS) |
| `voice_deafen` | `on` | `()` (ensurdece enquanto o JARVIS fala) |

### Fala (3) · [tts](../features/tts/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `speech_status` | — | `SpeechStatus` |
| `speech_download` | `id` | `()`; progresso via `speech:progress` / `speech:done` |
| `speech_synthesize` | `text`, `voice`, `speed` (0,5–2,0) | `ipc::Response` (WAV mono 16-bit, bytes crus) |

### Assistente (9) · [assistant](../features/assistant/spec.md), [assistant-tools](../features/assistant-tools/spec.md), [quick-notes](../features/quick-notes/spec.md), [memory-cleanup](../features/memory-cleanup/spec.md), [chat-mode](../features/chat-mode/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `assistant_ask` | `text`, `sessionId?`, `conversationId?`, `agent?`, `onEvent: Channel<AssistantEvent>` | `()`. Cada `conversationId` tem o seu `claude.exe` (sem id: `"main"`); `agent` faz um contato responder ali, com o confinamento do JARVIS. Erros: "Ainda estou respondendo." (a conversa já responde), "Já estou respondendo em 5 conversas. Espere uma terminar." ([agent-contacts](../features/agent-contacts/spec.md)) |
| `assistant_warm` | `sessionId?`, `conversationId?`, `agent?` | `()` (pré-aquece o `claude.exe` da conversa e encerra os ociosos das outras) |
| `assistant_cancel` | `conversationId?` | `()` (só essa conversa) |
| `assistant_reset` | `conversationId?` | `()` (só essa conversa) |
| `assistant_forget` | `sessionId` (só dígitos hexadecimais e `-`) | `bool`: a transcrição da sessão foi para a Lixeira. Se o processo está nessa sessão, ele para e a sessão é esquecida antes. Id inválido: erro "Sessão inválida" |
| `assistant_sleep` | — | `Sleep`: `stopped{freed}` · `busy` · `idle`. Age sobre todos os processos: encerra os ociosos e soma a memória; `busy` só se nada pôde ser encerrado e algum responde |
| `assistant_folder` | — | `Folder` (caminhos de `Documentos\JARVIS`). Desde 2026-11-19 cria `Notas\` e `Agentes\` se faltarem ([notes-area](../features/notes-area/spec.md) RF-012) |
| `assistant_note` | `text`, `date`, `time` | caminho da nota do dia |
| `assistant_action_result` | `id`, `ok`, `text` | `()`: resposta da UI a um `assistant:action` |

### Agentes (5) · [jv_agent](../apps/jv_agent/spec.md), [agent-contacts](../features/agent-contacts/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `agent_drafts` | — | nomes em `Agentes\` |
| `agent_contacts` | — | `AgentContact[]` (`name`, `description`): os agentes que o JARVIS instalou, com rascunho válido |
| `agent_problems` | `name`, `text` | lista de problemas do rascunho |
| `agent_install` | `name` | caminho instalado em `~/.claude/agents` |
| `terminal_open_agent` | `name`, `task`, `cwd`, `cols`, `rows` | id do terminal (`claude --agent …`) |

### Feeds (2) · [stocks](../widgets/stocks/spec.md), [weather](../widgets/weather/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `stock_quotes` | `symbols[]` (≤ 20) | `Quote[]` |
| `weather_forecast` | `city` | `Weather` |

### Sistema (2) · [system](../widgets/system/spec.md), [holographic-core](../features/holographic-core/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `system_stats` | — | `SystemStats` (CPU, GPU, RAM, commit, discos, Wi-Fi, rede) |
| `webview_background` | `background` | `()`: meta de memória do WebView2 "low" (janela escondida há 5 s) ou "normal"; ignorada por runtimes sem a interface |

### Música (3) · [jv_t4p3](../apps/jv_t4p3/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `music_status` | — | `MusicStatus` (yt-dlp presente e versão) |
| `music_install` | — | `()`; progresso via `music:install-*` |
| `music_resolve` | `query?` ou `videoId?` | `Resolved` (URL de stream `*.googlevideo.com`) |

### Terminal (5) · [jv_sh](../apps/jv_sh/spec.md)

| Comando | Argumentos | Retorno |
|---|---|---|
| `terminal_profiles` | — | `Profiles` |
| `terminal_open` | `profile` (id), `cols`, `rows`, `cwd?` | id |
| `terminal_write` | `id`, `data` | `()` |
| `terminal_resize` | `id`, `cols`, `rows` | `()` |
| `terminal_close` | `id` | `()` |

### Workspace (15) · [jv_ide](../apps/jv_ide/spec.md)

Todos os caminhos são relativos a `root` e validados em `workspace/paths.rs`.

| Comando | Argumentos | Retorno |
|---|---|---|
| `workspace_open` / `workspace_close` | `path` / `root` | `WorkspaceInfo` / `()` (liga e desliga o watcher) |
| `workspace_list` | `root`, `path` | `Listing` |
| `workspace_read` | `root`, `path` | `FileContent` (≤ 5 MB, encoding e EOL detectados) |
| `workspace_write` | `root`, `path`, `contents`, `encoding`, `eol`, `expected?: Stamp` | `Stamp`, ou erro `file-changed` |
| `workspace_stat` | `root`, `paths[]` | `(Stamp \| null)[]` |
| `workspace_create` | `root`, `path`, `dir` | `()` |
| `workspace_rename` / `workspace_copy` | `root`, `from`, `to` | `()` / novo caminho |
| `workspace_delete` | `root`, `paths[]`, `permanent` | `()` (Lixeira por padrão) |
| `workspace_reveal` | `root`, `path` | `()` (Explorer) |
| `workspace_disk` | `root` | `Disk?` |
| `workspace_files` | `root` | `FileList` (para o Ctrl+P) |
| `workspace_search` | `root`, `query`, `onEvent: Channel<SearchEvent>` | id da busca |
| `workspace_search_cancel` | — | `()` |

### Git (20) · [jv_ide](../apps/jv_ide/spec.md)

| Comando | Argumentos |
|---|---|
| `git_status` | `root` → `GitStatus?` |
| `git_stage` / `git_unstage` / `git_discard` | `root`, `paths[]` |
| `git_stage_all` / `git_unstage_all` | `root` |
| `git_discard_all` | `root`, `untracked` |
| `git_commit` | `root`, `message`, `amend` |
| `git_push` / `git_pull` / `git_fetch` | `root` |
| `git_log` | `root`, `limit`, `skip` → `Commit[]` |
| `git_diff` | `root`, `path`, `staged` → `Diff` |
| `git_show_file` | `root`, `path`, `rev` → `string?` |
| `git_stash_list` / `git_stash_push` / `git_stash_pop` / `git_stash_drop` | `root` (+ `message?`, `untracked` / `index`) |
| `git_branches` / `git_checkout` | `root` (+ `branch`, `create`) |

## Eventos

Os nomes ficam em constantes `domínio:evento` (`lib.rs`, `voice/mod.rs`).

| Evento | Payload | Consumidor |
|---|---|---|
| `voice:state` | `{state, message}` | `useVoiceAssistant` |
| `voice:transcribing` | `bool` | legenda / núcleo |
| `voice:transcript` | `{text, millis}` | `VoiceCaption` |
| `voice:wake` | — | núcleo (janela acordada) |
| `voice:command` | `{appId, name, error}` | dock / fala (`launch`, `launchFailed`) |
| `voice:window` | `{kind, open}` | `useDesktop` |
| `voice:windows` | `{group}` | `useDesktop` (fechar grupo) |
| `voice:music` | `{action, target}` | `useMusicPlayer` |
| `voice:pomodoro` | `{action}` | `usePomodoro` |
| `voice:shortcut` | `{action, text, said}`; `action:"ask"` é o fallback | `shortcutHandler` em `App.tsx` |
| `voice:dictation` | `{text, pending, target: "editor" \| "assistant"}` | Jarvis Mark / assistente |
| `model:progress` / `model:done` | `{id, received, total}` / `{id, error?}` | Configurações |
| `speech:progress` / `speech:done` | idem | Configurações |
| `music:install-progress` / `music:install-done` | `{id:"yt-dlp", received, total}` / `{version?, error?}` | jv_T4p3 |
| `terminal:output` / `terminal:exit` | `{id, data}` / `{id, code?}` | jv_sh, terminal do jv_ide |
| `workspace:changed` | `{root, changes:[{path, kind}], git, rescan}` | jv_ide |
| `assistant:action` | `{id, tool, args}` | `useAssistantActions` → `assistant_action_result` |

## Channels (fluxos)

| Comando | Eventos do Channel |
|---|---|
| `assistant_ask` | `session{id}` → `delta{text}`* · `tool{name}`* · `source{path}`* (um arquivo lido com Read: a fonte de uma resposta, [notes-graph](../features/notes-graph/spec.md)) · `file{path, content?, done}`* → `done{text, error?, cancelled}` |
| `workspace_search` | resultados incrementais (`SearchEvent`) até o fim ou `workspace_search_cancel` |

## Ferramentas MCP (18)

O servidor fica em `src-tauri/src/mcp.rs`, e a mecânica está em [assistant-tools](../features/assistant-tools/spec.md). Só `open_url` é resolvida no Rust. As outras viram um `assistant:action` para a UI, com espera de até 20 s.

| Tool | Argumentos | Spec dona |
|---|---|---|
| `jvos_run` | `query?` · `id?` | [search](../features/search/spec.md) (mesmo catálogo de comandos) |
| `jvos_commands` | — | [search](../features/search/spec.md) |
| `open_url` | `url` (http/https) | [assistant-tools](../features/assistant-tools/spec.md) |
| `system_status` | — | [system](../widgets/system/spec.md) |
| `reminder_set` | `minutes` (1–10080), `text` | [reminders](../features/reminders/spec.md) |
| `stocks_quote` | `symbols?[]` (≤ 20) | [stocks](../widgets/stocks/spec.md) |
| `stocks_watch` | `symbol`, `remove?` | [stocks](../widgets/stocks/spec.md) |
| `stocks_alert` | `symbol`, `above?`, `below?`, `remove?` | [stocks](../widgets/stocks/spec.md) |
| `weather` | `city?` | [weather](../widgets/weather/spec.md) |
| `agenda_add` | `title`, `date` (AAAA-MM-DD), `time?` (HH:MM), `notify?` (0–1440) | [agenda](../widgets/agenda/spec.md) |
| `agenda_list` | `from?`, `to?` | [agenda](../widgets/agenda/spec.md) |
| `agenda_remove` | `id` | [agenda](../widgets/agenda/spec.md) |
| `tasks_add` | `text` | [tasks](../widgets/tasks/spec.md) |
| `tasks_list` | — | [tasks](../widgets/tasks/spec.md) |
| `tasks_done` | `id`, `done?` | [tasks](../widgets/tasks/spec.md) |
| `tasks_remove` | `id` | [tasks](../widgets/tasks/spec.md) |
| `agent_review` | `name`, `folder?`, `task?` | [jv_agent](../apps/jv_agent/spec.md) |
| `agent_run` | `name` | [jv_agent](../apps/jv_agent/spec.md) |

## Como acrescentar um comando

1. Lógica no módulo do domínio, retornando `Result<T, String>`.
2. Wrapper `#[tauri::command]` em `lib.rs`, nomeado `<domínio>_<verbo>` e com `blocking()` se bloquear. Registrar no `invoke_handler`.
3. Tipo espelhado em `src/lib/<domínio>.ts`, com `Mirrors`, e adaptador com fallback ou fake ([P6](constitution.md#p6--funciona-fora-do-tauri)).
4. Linha nova neste arquivo e em Entregáveis › Contratos do `spec.md` da spec dona.
