# Glossário (linguagem ubíqua)

Termos usados no código, na UI e nas specs. Quando um termo tem tipo nos dois lados do IPC, as duas colunas aparecem, e o TypeScript leva o comentário `Mirrors` (ver [ADR-0009](../arch/adr/0009-tipos-espelhados-ts-rust.md)).

## Produto e superfícies

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **jvOS / JARVIS OS** | A área de trabalho inteira: núcleo, dock, barra, janelas e voz. O app id é `dev.jarvis.os`. | — | — |
| **JARVIS** | O assistente: persona de mordomo sobre o Claude Code. Fala por falas locais ou pelo Claude. Ver [persona](jarvis-persona.md). | `src/lib/assistant.ts` | `assistant.rs` |
| **Núcleo (Core)** | O holograma central: reator 3D, versão vetorial 2D ou desligado. Reage à voz e é clicável para falar. | `CoreMode` em `src/lib/core.ts` | — |
| **Fase do núcleo (CorePhase)** | Estado visual da conversa: ocioso, ouvindo, pensando, respondendo… | `CorePhase` em `src/hooks/useAssistant.ts` | — |
| **Dock** | Barra inferior de lançamento: voz, navegador, VS Code, terminal, widgets, apps, Claude e configurações. | `DockPrefs` em `src/lib/dock.ts`; `DockItemId` e `DockNotice` em `QuickDock.tsx` | — |
| **Aviso da dock (DockNotice)** | Mensagem transitória sobre um item da dock (alarme, erro, alerta). | `useDockNotice` | — |
| **Barra superior (Taskbar)** | Barra opcional no estilo Waybar, com 9 módulos. | `TaskbarModules` em `src/lib/taskbar.ts` | `Settings.taskbar` |
| **Busca (Spotlight)** | Paleta aberta com `/`, que lista comandos agrupados. | `Command` em `src/lib/search.ts`; `CommandContext` em `src/lib/commands.ts` | — |
| **Menu avançado** | Abas de ajuste fino: cores, núcleo, janelas, layout, TUI, barra, dock e voz. | `AdvancedMenu.tsx` | — |

## Janelas

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **WindowKind** | Identificador de uma janela: 11 widgets + 6 apps. Só existe **uma janela por kind**. | `WindowKind`, `WINDOW_KINDS` em `src/lib/desktop.ts` | `WINDOW_KINDS` em `settings.rs` |
| **WindowSpec** | Título, ícone, tamanho padrão, tamanho mínimo e grupo de um kind. | `WINDOW_SPECS` em `src/lib/desktop.ts` | — |
| **Widget** | Janela pequena do grupo `widgets` (relógio, pomodoro, clima…). Não maximiza e é arrastada pelo corpo inteiro. | `DesktopGroup = "widgets"` | — |
| **App** | Janela do grupo `apps` (jv_ide, jv_sh, jv_T4p3, Jarvis Mark, jv_lab, jv_agent). Maximiza e é carregada sob demanda. | `DesktopGroup = "apps"`; `lazyApps.tsx` | — |
| **Desktop** | As janelas abertas, a ordem delas (que também é o z-order), a geometria salva por kind e as preferências. | `DesktopState` em `desktop.ts`; API `Desktop` em `useDesktop.ts` | — |
| **Opções de widget** | Liga/desliga de partes de um widget, pelo menu do botão direito. | `useWidgetOptions`, `WidgetMenu.tsx` | — |
| **Estilo de janela** | `tui` (padrão) ou `holo`. | prefs em `desktop.ts` | — |
| **Requests** | Canal que entrega a uma janela, talvez ainda fechada, um arquivo que o JARVIS está escrevendo. | `src/lib/requests.ts` | — |

## Voz

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **Ativação (Activation)** | Como o microfone escuta: `wakeWord`, `always` ou `pushToTalk` (padrão). | `Activation` em `src/lib/settings.ts` | `Activation` em `settings.rs` |
| **Estado do motor (EngineState / VoiceState)** | `standby`, `awake`, `talking`, `asking`… emitidos em `voice:state`. | `src/hooks/useVoiceAssistant.ts` | `voice/mod.rs` |
| **Palavra de ativação** | "hey jarvis" e apelidos ("jarbas"…). Abre uma janela acordada de 8 s. | — | `voice/matcher.rs` |
| **Comando de voz (VoiceCommand)** | Frases que disparam uma ação: `window`, `group`, `music`, `pomodoro`, `playlist`, `shortcut`, `verbs` ou `playVerbs`. | `VoiceCommand` em `settings.ts` | `VoiceCommand` em `settings.rs` |
| **Built-in / custom** | Comando vindo de `voice-commands.json` (pode trocar as frases, não a ação) / criado pelo usuário (`custom-*`). | — | `sanitize_voice_commands` |
| **Decisão (Decision)** | Saída do matcher: `Launch`, `Window`, `CloseGroup`, `Music`, `Pomodoro`, `Shortcut`, `Ask`… | eventos `voice:*` | `Decision` em `matcher.rs` |
| **Atalho (Shortcut)** | Uma das 18 ações faladas do JARVIS (pesquisa, nota, lembrete, briefing…). | `ShortcutAction`, `ShortcutEvent` em `src/lib/shortcuts.ts` | `SHORTCUT_TARGETS` em `settings.rs` |
| **Ditado (Dictation)** | Transcrição pura, sem matcher, para o editor ou para o assistente. | `src/lib/dictation.ts` | `voice_dictate` |
| **Ensurdecer (deafen)** | Silenciar o reconhecimento enquanto o JARVIS fala, para ele não ouvir a si mesmo. | `src/lib/speech.ts` | `voice_deafen` |
| **Modelo Whisper** | Modelo de reconhecimento (`small` padrão, `base`, `large-v3-turbo`). | `ModelStatus` em `settings.ts` | `models.rs` |
| **Voz de fala (speech voice)** | Voz Piper ou Kokoro do sherpa-onnx (`miro` padrão). | `src/lib/speech.ts` | `speech.rs` |

## Assistente

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **Pergunta (ask)** | Um turno enviado ao `claude.exe`. Só um por vez. | `AssistantEvent` em `assistant.ts` | `AssistantEvent` em `assistant.rs` |
| **Sessão** | Id de conversa do Claude Code, retomado com `--resume`. | `HistoryItem` | `assistant.rs` |
| **Perfil (Profile)** | Modelo + nome do usuário. Se mudar, o processo reinicia. | — | `Profile` em `assistant.rs` |
| **Pasta do JARVIS (Folder)** | `Documentos\JARVIS`, com `Memória.md`, `Notas\` e `Agentes\`. | — | `Folder` em `assistant.rs` |
| **Memória** | `Memória.md`, injetada no prompt. Não confundir com a **limpeza de memória** (RAM). | `AssistantMemory` | `assistant.rs` |
| **Ferramenta MCP (tool)** | Ação que o Claude pede ao jvOS (`jvos_run`, `agenda_add`…). A UI executa. | `ToolReply` em `src/lib/agents.ts` | `ActionRequest`, `Bridge` em `mcp.rs` |
| **Ação jvOS** | Um comando da busca, executável pelo JARVIS via `jvos_run`. | `src/lib/commands.ts` | — |
| **Agente** | Subagente do Claude Code que o JARVIS rascunha em `Agentes/<nome>.md`, o usuário revisa no jv_agent e que roda numa aba do jv_sh. | `AgentAsk`, `AgentLaunch` em `src/lib/agents.ts` | `agents.rs` |
| **Falas locais (LINES)** | Respostas do JARVIS sem o Claude. | `src/lib/jarvisLines.ts` | — |

## Dados do dia a dia

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **Lembrete (Reminder)** | Texto + vencimento. Texto vazio quer dizer **timer**. Vence mesmo com o app fechado (dispara ao abrir). | `Reminder` em `src/hooks/useReminders.ts` | — |
| **Compromisso (AgendaEvent)** | Item datado (com ou sem hora), com aviso `notify` minutos antes (padrão 10). | `AgendaEvent` em `src/lib/agenda.ts` | — |
| **Tarefa (Task)** | Coisa a fazer sem horário. Tem um número curto (o menor livre), e as concluídas somem no dia seguinte. | `Task` em `src/lib/tasks.ts` | — |
| **Watchlist** | Códigos acompanhados no widget Ações (até 20). | `src/hooks/useWatchlist.ts` | — |
| **Alerta de preço (PriceAlert)** | Limite `above`/`below` que toca uma vez. | `PriceAlert` em `useWatchlist.ts` | — |
| **Cotação (Quote)** | Preço, variação e série intradiária (Yahoo). | `Quote` em `src/lib/feeds.ts` | `Quote` em `feeds.rs` |
| **Clima (Weather)** | Condição atual + 5 dias (Open-Meteo) de uma cidade. | `Weather` em `feeds.ts` | `Weather` em `feeds.rs` |
| **Pomodoro** | Fases foco/pausa curta/pausa longa, 4 ciclos por série, com relógio de parede. | `src/hooks/usePomodoro.ts` | — |

## Apps

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **Workspace** | Pasta aberta no jv_ide: raiz + caminhos relativos, carimbos (`Stamp`), codificação e EOL. | `WorkspaceInfo`, `FileContent` em `src/lib/workspace.ts` | `workspace/mod.rs` |
| **Stamp** | Carimbo de mtime/tamanho que detecta alteração externa (erro `file-changed`). | `workspace.ts` | `workspace/mod.rs` |
| **Perfil de terminal (TerminalProfile)** | Perfil do Windows Terminal (ou fallback) que o jv_sh abre numa aba. | `src/lib/terminal.ts` | `terminal.rs` |
| **Estação / Playlist / Faixa** | Rádios do GTA Vice City ou playlists do usuário com links do YouTube. | `src/lib/music/stations.ts` | `music.rs` (resolução) |
| **Fita (Cassette)** | Animação ASCII da fita, ligada ao player. | `CassetteState` em `src/lib/music/cassette.ts` | — |
| **Lição / Passo / Comando de lab** | Aula do jv_lab, desafio e comando do terminal simulado. | `src/lib/lab/types.ts` | — |

## Aparência

| Termo | Definição | TypeScript | Rust |
|---|---|---|---|
| **Tema** | `blue`, `green`, `yellow` ou `custom` (matiz OKLCH). Sobrescreve `--color-hud-*`. | `src/lib/theme.ts` | `Settings.theme`, `accentHue` |
| **TUI** | Linguagem visual de terminal: aberração cromática, brilho e acento. | `TuiPrefs` em `src/lib/tui.ts` | — |
| **Qualidade** | Nível gráfico do núcleo 3D. Rebaixa sozinho com FPS baixo. | `src/lib/quality.ts` | — |
