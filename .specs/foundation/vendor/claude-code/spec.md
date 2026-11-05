# Vendor: Claude Code CLI

O `claude.exe` local, logado na assinatura do usuário, que o jvOS roda em stream-json como o cérebro do JARVIS e numa aba do jv_sh para os agentes do jv_agent.

| | |
|---|---|
| **ID** | `vendor/claude-code` |
| **Tipo** | Ferramenta externa |
| **Status** | Em uso |
| **Versão** | `claude.exe` 2.1.318 nesta máquina (`claude --version` em 2026-11-05), 342.408.352 bytes em `%USERPROFILE%\.local\bin\claude.exe`; as versões 2.1.316 a 2.1.318 estão em `%USERPROFILE%\.local\share\claude\versions\`. As flags e o formato stream-json foram verificados no 2.1.310 (memória `claude-cli-bridge`, linhas de teste em `assistant.rs`). Não é fixada: o instalador nativo atualiza fora do jvOS. Modelos: os aliases `sonnet` (padrão), `haiku` e `opus`, ou `default` (o do usuário) |
| **Licença** | Proprietária (Anthropic) ⚠ inferido — confirmar |
| **Fonte** | https://claude.ai/code (o endereço que o README e o erro "Claude Code não encontrado" dão) |
| **Onde roda** | processo externo: filho do `jarvis.exe`, sem janela, com cwd em `Documentos\JARVIS`; e numa aba do jv_sh (`claude --agent`) |

## Objetivo

Dar ao JARVIS conversa, busca na web, leitura e escrita de notas e ações no jvOS sem chave de API nem cobrança à parte, reaproveitando o Claude Code que o usuário já tem instalado e logado ([ADR-0006](../../../arch/adr/0006-jarvis-via-claude-cli.md)). Um único processo fica vivo entre as perguntas, porque iniciar custa ~2,3 s, e o modelo é escolhido pelo jvOS, porque o padrão do próprio usuário (`opus` com `effortLevel: xhigh`) é lento demais para uma resposta falada.

## Não-objetivos

- Não usa a Messages API nem guarda chave: a conta é a do login do Claude Code.
- O JARVIS não roda comandos: `--tools` não tem `Bash`, e os conectores MCP do usuário ficam de fora (`--strict-mcp-config`) ([ADR-0007](../../../arch/adr/0007-jarvis-confinado-a-documentos.md)).
- O jvOS não instala nem atualiza o Claude Code; o processo do JARVIS roda com `DISABLE_AUTOUPDATER=1`.
- Sem slash commands (`--disable-slash-commands`), sem `CLAUDE.md` de projeto (o cwd é `Documentos\JARVIS`) e sem os eventos de subagentes na UI.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** nenhum `claude.exe` no `PATH` nem em `%USERPROFILE%\.local\bin\`
- **Quando** o usuário faz uma pergunta ao JARVIS
- **Então** `assistant_ask` falha com "Claude Code não encontrado. Instale-o (claude.ai/code) e entre na sua conta rodando `claude` uma vez."

### Critério 2 (RF-002)

- **Dado** o perfil padrão (`sonnet`) e o servidor MCP de pé
- **Quando** o processo do JARVIS inicia e `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Select-Object CommandLine` é lido
- **Então** a linha tem `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --restricted --tools WebSearch,WebFetch,Read,Edit,Write,Glob,Grep --permission-mode dontAsk --allowedTools WebSearch WebFetch Read Edit Write Glob Grep mcp__jarvis --strict-mcp-config --mcp-config <…\assistant\mcp.json> --model sonnet --disable-slash-commands --effort low --append-system-prompt <persona>`.

### Critério 3 (RF-003)

- **Dado** um `sessionId` do histórico cujo `<id>.jsonl` não existe em `%USERPROFILE%\.claude\projects\*\`
- **Quando** a próxima pergunta inicia o processo
- **Então** ele sobe sem `--resume`, numa sessão nova, em vez de morrer com "No conversation found"; um id com caracteres fora de hexadecimais e hífens nunca é procurado (teste `only_session_ids_are_looked_up`).

### Critério 4 (RF-004)

- **Dado** `assistantModel` no `settings.json`
- **Quando** `cargo test --lib -- settings::` roda em `src-tauri`
- **Então** `jarvis_models_are_checked` passa: o padrão é `sonnet`, `haiku`, `sonnet`, `opus` e `default` são mantidos e `gpt` volta para `sonnet`.

### Critério 5 (RF-005)

- **Dado** linhas de stream-json como o `claude` 2.1.310 as escreveu
- **Quando** `cargo test --lib -- assistant::` roda
- **Então** elas viram os eventos `session`, `delta`, `tool`, `file` e `done`, e as linhas de subagentes são ignoradas (`subagents_and_other_lines_are_ignored`).

### Critério 6 (RF-006)

- **Dado** o processo vivo com `sonnet` e uma conversa em andamento
- **Quando** o usuário escolhe "Opus" em "Modelo do JARVIS" e pergunta de novo
- **Então** o processo antigo é encerrado com `taskkill /T /F` e outro sobe com `--model opus --resume <mesma sessão>`.

### Critério 7 (RNF-001)

- **Dado** o processo já aquecido por `assistant_warm`
- **Quando** o usuário faz uma pergunta trivial
- **Então** a primeira palavra chega em ~1 s; sem aquecimento, a partida soma ~2,3 s (medido em 2026-10-27).

## Casos de borda

- **Vazio/nulo:** sem `claude.exe` → "Claude Code não encontrado…". Se o processo morrer no meio da resposta, o `done` traz as últimas 12 linhas do stderr, ou "O Claude Code encerrou sem responder"; um `result` com erro (sem login, por exemplo ⚠ inferido — confirmar) chega como o `done` com o erro. Sem o servidor MCP, o processo sobe sem `--mcp-config` e o stderr do app diz "[jarvis] JARVIS's tools unavailable".
- **Duplicidade/idempotência:** uma pergunta por vez: outra durante a resposta recebe "Ainda estou respondendo.". `assistant_warm` com uma resposta em andamento não faz nada, e com o processo vivo no mesmo perfil e na mesma sessão não reinicia.
- **Concorrência/corrida:** ao trocar o processo, `generation` sobe e os leitores do processo antigo param de mandar eventos. Fechar o jvOS encerra o `claude.exe` e os filhos dele (`taskkill /T /F`). Um `claude.exe` rodando não pode ser substituído pelo instalador; as sessões do próprio usuário o atualizam.
- **Permissões/visibilidade:** `--restricted` prende Read, Edit e Write ao cwd `Documentos\JARVIS`, e dentro dele vale o `--allowedTools` sem padrão, porque `Edit(./**)` não casava com o caminho curto `FELIPE~1`. O servidor MCP só aceita o token bearer do `mcp.json` e recusa qualquer requisição com `Origin`.

## Uso no jvOS

### Localizar o executável (`src-tauri/src/assistant.rs`, `claude_exe`)

Acha o `claude.exe` do instalador nativo.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE procurar `claude.exe` no `PATH` e, se não achar, em `%USERPROFILE%\.local\bin\claude.exe`. Sem nenhum, o erro é "Claude Code não encontrado. Instale-o (claude.ai/code) e entre na sua conta rodando `claude` uma vez."
  - O mesmo `claude_exe` serve ao JARVIS e às abas de agente do jv_sh.

### Processo do JARVIS (`src-tauri/src/assistant.rs`, `Assistant::spawn` e `ensure`)

Um processo `claude -p` de longa duração por vez.

- **Comportamento:**
  - **RF-002**: O processo DEVE iniciar com as flags do Critério 2, nessa ordem, `--resume <id>` no fim quando houver sessão, cwd em `Documentos\JARVIS` (ou `~\JARVIS`, criando `Notas\` e `Agentes\`), `DISABLE_AUTOUPDATER=1`, sem janela (`CREATE_NO_WINDOW`) e com stdin, stdout e stderr em pipe.
  - Cada pergunta é uma linha JSON no stdin: `{"type":"user","message":{"role":"user","content":…},"parent_tool_use_id":null}`.
  - A persona, o nome do usuário e o `Memória.md` (até 8000 caracteres) vão em `--append-system-prompt`, relidos a cada partida.
  - **RF-006**: O processo DEVE ser trocado quando morreu, quando o perfil (modelo ou nome) mudou ou quando a pergunta vem de outra sessão. Cancelar, "Nova conversa", a limpeza de memória e o fechamento do app o encerram com `taskkill /T /F` (`git::kill_tree`).

### Sessões (`src-tauri/src/assistant.rs`, `session_exists` e `read_output`)

Retoma a conversa só quando o Claude Code ainda a tem.

- **Comportamento:**
  - **RF-003**: `--resume <id>` DEVE ser usado só quando o id tem apenas hexadecimais e hífens e `<config>/projects/*/<id>.jsonl` existe, com `<config>` = `CLAUDE_CONFIG_DIR` ou `%USERPROFILE%\.claude`. Se a pasta `projects` não puder ser lida, a sessão é tomada como existente.
  - O id vem do `system/init`. Um `done` que chega antes de qualquer `init` apaga a sessão, e a próxima pergunta começa outra.

### Leitura do stream-json (`src-tauri/src/assistant.rs`, `parse_line`)

Transforma cada linha do stdout em eventos para a UI, por um `ipc::Channel`.

- **Comportamento:**
  - **RF-005**: Só as linhas com `parent_tool_use_id` nulo DEVEM virar eventos: `system/init` vira `session`; `text_delta` vira `delta` (com parágrafo novo depois de uma ferramenta); `tool_use` e `server_tool_use` viram `tool`; o `input_json_delta` de um Write vira `file` com o conteúdo parcial, em passos de 24 caracteres ou 1/32 do que já chegou; o `tool_result` sem erro de um Write ou Edit vira `file` com `done`; e `result` vira `done`.
  - Se o `result` vier com erro, então o `done` traz `errors`, o `result` ou "O Claude Code falhou (<subtipo>)".

### Modelo do JARVIS (`src-tauri/src/settings.rs`, `src/lib/settings.ts`, `src/components/SettingsPanel.tsx`)

O usuário escolhe o modelo em "Cérebro do JARVIS".

- **Comportamento:**
  - **RF-004**: `Settings.assistantModel` DEVE ser `haiku`, `sonnet`, `opus` ou `default`, com padrão `sonnet` (`ASSISTANT_MODELS`, espelhado em Rust e TypeScript). O processo recebe `--model <alias>`, menos com `default`, e sempre `--effort low`.
  - O seletor "Modelo do JARVIS" mostra "Haiku" ("O mais rápido"), "Sonnet" ("Rápido e capaz, recomendado"), "Opus" ("O mais inteligente, responde mais devagar") e "Padrão" ("O modelo e o esforço do seu Claude Code").

### Servidor MCP do jvOS (`src-tauri/src/lib.rs` `start_mcp`, `src-tauri/src/mcp.rs`)

Dá ao JARVIS as ferramentas que agem no jvOS.

- **Comportamento:**
  - **RF-007**: Ao iniciar, o jvOS DEVE gravar `%LOCALAPPDATA%\dev.jarvis.os\assistant\mcp.json` com `{"mcpServers":{"jarvis":{"type":"http","url":"http://127.0.0.1:<porta>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`, com porta e token de 128 bits novos a cada início, e passá-lo em `--mcp-config`. As ferramentas aparecem como `mcp__jarvis__<tool>` e são liberadas por `--allowedTools mcp__jarvis`.
  - O cliente HTTP do Claude Code tenta `server/discover` primeiro e cai para `initialize` (2025-11-25) com a resposta `-32601`.

### Agentes no jv_sh (`src-tauri/src/lib.rs` `terminal_open_agent`, `src-tauri/src/agents.rs`)

Roda um agente instalado numa aba visível, onde o usuário aprova as permissões.

- **Comportamento:**
  - **RF-008**: O jvOS DEVE rodar só `claude --agent <nome> "<tarefa>"`, e só para agentes que existem em `<config>\agents\<nome>.md`. A tarefa perde aspas e quebras de linha. `agent_install` copia `Agentes\<nome>.md` para lá e nunca sobrescreve um agente que o JARVIS não instalou.

### Programa "Claude Code" (`src-tauri/src/settings.rs`, `default_apps`)

Um dos quatro programas que a voz abre.

- **Comportamento:**
  - O programa embutido `claude` ("claude code", "claude", "cloud code") roda `wt claude`: abre o Claude Code do usuário no Windows Terminal, fora do jvOS.

### Limpeza de memória (`src-tauri/src/assistant.rs`, `Assistant::sleep`)

Devolve a RAM do processo parado.

- **Comportamento:**
  - Com o processo ocioso, o jvOS mede o working set dele, o encerra e devolve `stopped { freed }`; a sessão fica, e a próxima pergunta o inicia de novo.

## Restrições

- **RNF-001**: Latência medida em 2026-10-27 (`-p --effort low`, resposta trivial): tempo de API Haiku ~0,77 s, Sonnet ~0,86 s, Opus ~1,7 s; iniciar o processo soma ~2,3 s; com `--resume`, o primeiro turno sai em ~1 s. Por isso o processo é pré-aquecido no início do app e fica vivo.
- **RNF-002**: Versão sem trava: o stream-json e as flags podem mudar a cada versão, e qualquer flag nova precisa ser verificada contra o CLI real ([ADR-0006](../../../arch/adr/0006-jarvis-via-claude-cli.md)).
- **RNF-003**: Precisa do login do usuário (OAuth da assinatura, com o qual `--restricted` funciona) e de rede até a Anthropic: é a única parte do JARVIS que não é offline.
- **RNF-004**: A linha de comando do Windows tem até 32.767 caracteres; por isso a memória injetada fica em 8000.
- **RNF-005**: Só o `claude.exe` é procurado (instalador nativo). Uma instalação que deixe só um `claude.cmd` no `PATH` não é achada ⚠ inferido — confirmar.
- **RNF-006**: Um processo residente ocupa RAM enquanto o jvOS estiver aberto; a [limpeza de memória](../../../features/memory-cleanup/spec.md) a devolve.
- **RNF-007**: Licença proprietária ⚠ inferido — confirmar.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/assistant.rs` | `claude_exe`, `Assistant` (flags, sessão, troca de processo, sono), `session_exists`, `parse_line` |
| `src-tauri/assistant-persona.md` | Persona injetada por `--append-system-prompt` |
| `src-tauri/src/lib.rs` | `assistant_*`, `start_mcp`, `terminal_open_agent`, encerramento no `RunEvent::Exit` |
| `src-tauri/src/mcp.rs` | Servidor MCP HTTP e o `mcp.json` (`config`) |
| `src-tauri/src/agents.rs` | Pasta de agentes do Claude Code (`CLAUDE_CONFIG_DIR` ou `~\.claude`) e `install` |
| `src-tauri/src/settings.rs` | `assistant_model` (padrão `sonnet`), `ASSISTANT_MODELS`, programa `claude` (`wt claude`) |
| `src-tauri/src/git/mod.rs` | `kill_tree` (`taskkill /T /F`), usado para encerrar o `claude.exe` |
| `src/lib/settings.ts` | `ASSISTANT_MODELS` com rótulos e dicas |
| `src/lib/assistant.ts` | Backend Tauri (`assistant_ask`, `assistant_warm`…) e o falso do modo web |

### Testes

- `cargo test --lib -- assistant::` (em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH`): stream-json do 2.1.310, Write e Edit, memória na persona, ids de sessão e subagentes ignorados.
- `cargo test --lib -- settings:: mcp:: agents::`: modelos do JARVIS, servidor MCP (versão do cliente, ferramentas, tokens diferentes) e regras de instalação de agentes.
- `npx playwright test tests/assistant.spec.ts tests/shortcuts.spec.ts tests/agent.spec.ts`: a UI com o backend falso `__JARVIS_ASSISTANT__`, sem o `claude.exe` real.
- Conferência manual: `claude --version`, e a linha de comando do processo com o JARVIS aberto (Critério 2).

### Atualização e reversão

- **Comando:** `claude update` numa sessão do usuário; o processo do JARVIS não se atualiza e pega a versão nova na próxima partida. Para mudar a lista de modelos, edite `ASSISTANT_MODELS` em `src-tauri/src/settings.rs` e em `src/lib/settings.ts` juntos.
- **Prova:** `cargo test --lib -- assistant:: mcp::` e uma nova sondagem do CLI real: uma pergunta com `--resume`, um Write em `Notas\`, uma ferramenta `mcp__jarvis__*` e um Read fora do cwd negado.
- **Sinal de volta:** "O Claude Code encerrou sem responder", uma opção desconhecida no stderr, nenhum `system/init`, as ferramentas do jvOS sumindo ou um arquivo fora de `Documentos\JARVIS` lido sem erro.
- **Reversão:** reinstalar a versão anterior pelo instalador nativo (`claude install <versão>` ⚠ inferido — confirmar); as versões 2.1.316 e 2.1.317 ainda estão em `%USERPROFILE%\.local\share\claude\versions\`.

### Decisões relacionadas

- [ADR-0006 — O cérebro do JARVIS é o `claude.exe` local em stream-json, não a API](../../../arch/adr/0006-jarvis-via-claude-cli.md)
- [ADR-0007 — O JARVIS fica confinado a `Documentos\JARVIS`, sem ferramentas de shell](../../../arch/adr/0007-jarvis-confinado-a-documentos.md)
- [ADR-0008 — Servidor MCP HTTP dentro do app; a UI executa as ferramentas](../../../arch/adr/0008-mcp-http-in-process.md)

## Dependências

- [tauri](../tauri/spec.md): `ipc::Channel` e eventos. [serde](../serde/spec.md): o `serde_json` lê e escreve o stream-json.
- [http](../http/spec.md): o `tiny_http` serve o MCP. [terminal](../terminal/spec.md): a aba do agente no jv_sh.
- [assistant](../../../features/assistant/spec.md), [assistant-tools](../../../features/assistant-tools/spec.md), [memory-cleanup](../../../features/memory-cleanup/spec.md), [voice-shortcuts](../../../features/voice-shortcuts/spec.md), [settings](../../../features/settings/spec.md), [app-launcher](../../../features/app-launcher/spec.md), [jv_agent](../../../apps/jv_agent/spec.md), [jv_sh](../../../apps/jv_sh/spec.md).
- Sistema: login da assinatura, rede até a Anthropic, `%USERPROFILE%\.claude` (sessões e agentes), `Documentos\JARVIS` e o Windows Terminal (`wt`) para o programa embutido ([persistence](../../../domain/persistence.md), [security](../../../arch/security.md)).

## Pendências

- [ ] O comportamento foi verificado no 2.1.310 (memória `claude-cli-bridge`, linhas de teste em `src-tauri/src/assistant.rs`), e a máquina roda o 2.1.318 sem registro de nova sondagem, como o ADR-0006 pede depois de um upgrade.
