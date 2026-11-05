# Onde cada dado vive

Mapa único do estado persistente. A decisão está no [ADR-0010](../arch/adr/0010-persistencia-settings-vs-localstorage.md).

| Camada | Dono | Para quê |
|---|---|---|
| `settings.json` | Rust | Configuração de sistema, que a thread de voz e o assistente precisam ler sem a WebView |
| `localStorage` `jarvis.*` | UI | Preferências visuais e dados do dia a dia (agenda, tarefas…) |
| Arquivos em `Documentos\JARVIS` | JARVIS / Rust | O que o usuário deve poder abrir e editar fora do app: memória, notas, agentes |
| `%LOCALAPPDATA%\dev.jarvis.os` | Rust | Binários e modelos baixados, além de arquivos de apoio |

## 1. `%APPDATA%\dev.jarvis.os\settings.json`

- **Dono:** `src-tauri/src/settings.rs`, struct `Settings`. O espelho em TypeScript fica em `src/lib/settings.ts`.
- **Gravação:** atômica, via `settings.json.tmp` e rename.
- **Leitura:** passa por `sanitize`. Valores inválidos voltam ao padrão, e os built-ins de voz são reinseridos.
- **Compatibilidade:** `#[serde(default)]` sem `deny_unknown_fields`, então campos removidos (como o antigo `background`) somem em silêncio na próxima gravação.
- **Fora do Tauri:** o mesmo objeto vai para `localStorage["jarvis.settings"]`, com debounce de 450 ms.

| Campo | Padrão | Notas |
|---|---|---|
| `voiceEnabled` | `false` | Restaurado ao iniciar. `save_settings` **nunca** muda esse valor; só `voice_start` e `voice_stop` mudam |
| `activation` | `pushToTalk` | `wakeWord` · `always` · `pushToTalk` |
| `model` | `small` | Modelo Whisper. Trocar reinicia o motor |
| `voiceDevice` | `auto` | Onde o Whisper roda: `auto`, `cpu` ou o nome de uma GPU (Vulkan). Trocar reinicia o motor; uma GPU que sumiu vale como `auto` |
| `assistantModel` | `sonnet` | `haiku` · `sonnet` · `opus` · `default` |
| `assistantName` | `""` | Como o JARVIS chama o usuário |
| `language` | `pt` | `pt` · `en` · `auto` |
| `theme` / `accentHue` | `blue` / padrão | Usado só pela UI |
| `taskbar` | `true` | Usado só pela UI |
| `apps[]` | 4 built-ins: browser, vscode, terminal (`wt`), claude (`wt claude`) | Até 12 palavras-chave por app; nomes de até 40 caracteres |
| `voiceCommands[]` | `voice-commands.json` | Até 100 custom (`custom-*`); 30 frases de até 60 caracteres. Ver [voice-intents](voice-intents.md) |

## 2. `localStorage` (`src/lib/storage.ts`)

Como funciona o helper:
- `readJson(key, parse)` nunca lança exceção.
- `writeJson` devolve `false` quando a cota estoura.
- `useStoredState(key, fallback, parse, delay = 250)` faz debounce, grava no `beforeunload` e no unmount, e não grava na primeira montagem.
- Toda chave tem um `parse(raw: unknown)` tolerante.

| Chave | Dono | Conteúdo | Debounce |
|---|---|---|---|
| `jarvis.settings` | `src/lib/settings.ts` | Settings (só fora do Tauri) | 450 ms |
| `jarvis.desktop` | `src/hooks/useDesktop.ts` | Janelas abertas e ordem, geometria por kind, maximizadas, prefs (estilo, snap, grade, opacidade) | 250 ms + flush no `beforeunload` |
| `jarvis.widget.<kind>` | `src/hooks/useWidgetOptions.ts` | Liga/desliga de partes do widget | 250 ms |
| `jarvis.meters` | `SystemMeters.tsx` | Barras visíveis, disco, detalhes | 250 ms |
| `jarvis.core` | `src/lib/core.ts` | Modo do núcleo `3d` · `2d` · `off` | 250 ms |
| `jarvis.quality` | `src/lib/quality.ts` | Nível gráfico (string crua, sem JSON) | imediato |
| `jarvis.dock` | `src/lib/dock.ts` | `{visible, magnify}` | 250 ms |
| `jarvis.taskbar` | `src/lib/taskbar.ts` | Módulos da barra superior | 250 ms |
| `jarvis.tui` | `src/lib/tui.ts` | `{aberration, glow, accent}` | 250 ms |
| `jarvis.boot` | `src/lib/boot.ts` | `{enabled, sound}` | 250 ms |
| `jarvis.greeting.recent` | `src/lib/greetings.ts` | Índices das últimas saudações, para não repetir | imediato |
| `jarvis.assistant` | `src/hooks/useAssistant.ts` | Histórico (até 200 itens) e sessão | 250 ms |
| `jarvis.speech` | `src/lib/speech.ts` | Voz e velocidade do JARVIS | 250 ms |
| `jarvis.reminders` | `src/hooks/useReminders.ts` | Lembretes e timers pendentes | **0** |
| `jarvis.agenda` | `src/hooks/useAgenda.ts` | Compromissos (até 500) | **0** |
| `jarvis.tasks` | `src/hooks/useTasks.ts` | Tarefas (até 100) | **0** |
| `jarvis.watchlist` | `src/hooks/useWatchlist.ts` | `{symbols, alerts}` (até 20 códigos) | **0** |
| `jarvis.weather` | `src/hooks/useWeather.ts` | `{city}` | **0** |
| `jarvis.pomodoro` | `src/hooks/usePomodoro.ts` | Fase, ciclo e horário de término (relógio de parede) | 250 ms |
| `jarvis.music` | `src/hooks/useMusicPlayer.ts` | `{stationId, cursor, volume, shuffle}` | 250 ms |
| `jarvis.music.playlists` | `src/hooks/useMusicPlayer.ts` | Playlists do usuário | 250 ms |
| `jarvis.editor.<key>` | `src/hooks/useEditorDocument.ts` | Rascunho do editor (`markdown` = Jarvis Mark) | 400 ms |
| `jarvis.ide` | `apps/ide/persist.ts` | Sessões, layout, favoritos e recentes do jv_ide | manual |
| `jarvis.ide.drafts` | `apps/ide/persist.ts` | Buffers não salvos do jv_ide | manual |
| `jarvis.editor.code` | `apps/ide/persist.ts` | **Legado** do Jarvis Code: lido uma vez e migrado para o jv_ide | — |
| `jarvis.lab` | `apps/lab/LabApp.tsx` | Progresso das lições e divisória | 250 ms |
| `jarvis.migrations.taskbarOn` | `src/App.tsx` | Marca a migração única que ligou a barra superior | imediato |

Os dados que o usuário espera não perder (lembretes, agenda, tarefas, watchlist, cidade) gravam com debounce **0**.

Nos testes:
- leia o storage com `expect.poll`, porque o debounce atrasa a escrita;
- para semear uma chave, espere os frames depois do `goto`, porque o StrictMode regrava o valor ao montar.

Ver [testing](../arch/testing.md).

## 3. `Documentos\JARVIS\` (cai para `~\JARVIS` se não houver Documentos)

É o cwd do `claude.exe`, a única pasta onde o JARVIS pode ler e escrever. Ver [ADR-0007](../arch/adr/0007-jarvis-confinado-a-documentos.md).

| Caminho | Quem escreve | Conteúdo |
|---|---|---|
| `Memória.md` | JARVIS (Edit/Write) | Fatos duradouros sobre o usuário, injetados no prompt (até 8000 caracteres no total) |
| `Notas\AAAA-MM-DD Assunto.md` | JARVIS | Resumos de conversa e pesquisas |
| `Notas\AAAA-MM-DD Anotações.md` | Rust `append_note` (atalho "anota que…") e JARVIS | Linhas `- **HH:MM** texto` |
| `Agentes\<nome>.md` | JARVIS e o usuário (jv_agent) | Rascunho de subagente do Claude Code (frontmatter) |
| `Agentes\.instalados.json` | Rust `agents.rs` | Agentes que o JARVIS instalou em `~/.claude/agents`. Nunca sobrescreve um agente que não seja dele |

## 4. `%LOCALAPPDATA%\dev.jarvis.os\`

| Caminho | Conteúdo |
|---|---|
| `models\ggml-*.bin` | Modelos Whisper. Contam como baixados só com o tamanho exato, e o SHA-256 é conferido no download |
| `models\silero_vad.onnx` | Silero VAD v4 (~0,6 MB), o porteiro dos modos de escuta. Baixado sozinho, com tamanho e SHA-256 fixos, na primeira vez que "Hey Jarvis" ou "Sempre ouvindo" precisa dele |
| `tts\<pasta>\` + `.ready` | Vozes sherpa-onnx extraídas |
| `bin\yt-dlp.exe` | yt-dlp próprio do app, verificado com `SHA2-256SUMS` |
| `jv_sh\` | Ferramentas do jv_sh (`jvfetch.ps1`) |
| `assistant\mcp.json` | URL e token bearer do servidor MCP da sessão atual (regravado a cada início) |

## 5. Fora do app

- `~/.claude/projects/*/<sessão>.jsonl`: sessões do Claude Code. O app só confere se existem antes de `--resume`.
- `~/.claude/agents/` (ou `CLAUDE_CONFIG_DIR`): destino de `agent_install`.
- O `settings.json` do Windows Terminal é **lido** pelo jv_sh para listar perfis.
