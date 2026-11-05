# Segurança

O modelo de ameaça é um app desktop de um único usuário, com um LLM que age na máquina. Os riscos principais são três:
1. o JARVIS (ou um prompt injetado por uma página da web que ele leu) fazer algo destrutivo;
2. outro processo ou site falar com o servidor MCP local;
3. uma entrada vinda de voz ou da UI virar linha de comando.

O princípio está em [P10](constitution.md#p10--segurança-por-confinamento).

## Barreiras

| Barreira | Onde | O que garante |
|---|---|---|
| **Confinamento do JARVIS** | `assistant.rs` | `--restricted` + cwd `Documentos\JARVIS`: Read/Edit/Write só dentro da pasta. `--tools WebSearch,WebFetch,Read,Edit,Write,Glob,Grep`, **sem Bash**. `--permission-mode dontAsk`, `--strict-mcp-config` (só o servidor `jarvis`), `--disable-slash-commands`. Ver [ADR-0007](adr/0007-jarvis-confinado-a-documentos.md) |
| **MCP local** | `mcp.rs` | Escuta só em `127.0.0.1`. Token bearer de 128 bits, novo a cada início. **Recusa qualquer requisição com `Origin` (403)**, o que bloqueia sites no navegador. Só POST, corpo de até 1 MiB. Tool desconhecida dá erro |
| **Ações do JARVIS passam pela UI** | `useAssistantActions` | As tools fazem o mesmo que o usuário faria pela busca. Nenhuma executa comando livre. `open_url` aceita só http/https, sem espaços |
| **Agentes** | `agents.rs`, persona | `agent_run` só depois de `agent_review` e de confirmação explícita. Executa apenas `claude --agent <nome> "<tarefa>"`, com aspas e quebras removidas da tarefa, numa aba visível do jv_sh onde o usuário aprova as permissões. `agent_install` nunca sobrescreve um agente que o JARVIS não instalou (`.instalados.json`). Nome `[a-z0-9-]{1,64}` |
| **Terminal** | `terminal.rs` | `terminal_open` recebe **id de perfil**, nunca linha de comando |
| **Programas externos** | `launcher.rs` | `launch_app` só aceita ids configurados. Caminhos explícitos precisam existir; URLs vão entre aspas |
| **Workspace** | `workspace/paths.rs` | Todo caminho resolve **dentro da raiz aberta**, inclusive por links. Rejeita `..`, `:`, nomes de dispositivo do Windows e raízes de drive. Exclusão vai para a Lixeira |
| **Git** | `git/` | `--literal-pathspecs`, `GIT_TERMINAL_PROMPT=0`. Caminhos sem `-` inicial e sem `..`. Arquivos untracked descartados vão para a Lixeira, nunca para `git clean`. Lock global de escrita e timeouts |
| **Downloads** | `download.rs` | Arquivo `.part` renomeado só depois de conferir SHA-256 e tamanho, com limite de corpo. Modelos Whisper e vozes têm hash fixo; o yt-dlp é conferido com o `SHA2-256SUMS` do release |
| **WebView** | `tauri.conf.json` | A CSP limita a `self`, `ipc:`, `blob:`/`data:` para mídia e imagem, e `https://*.googlevideo.com` para áudio. HTTP para terceiros só pelo Rust. Sem plugins `fs` e `shell`; capabilities mínimas (`capabilities/default.json`: controles de janela + diálogo abrir/salvar) |
| **Música** | `music.rs` | O stream resolvido precisa ser https em `*.googlevideo.com` |
| **Memória** | persona | Nada de senhas, documentos ou dados sensíveis em `Memória.md` |
| **Fakes** | `src/lib/*` | Os stand-ins `window.__JARVIS_*__` só existem com `import.meta.env.DEV` |

## Lacunas conhecidas

- [ ] `read_text_file` / `write_text_file` (`src-tauri/src/files.rs`) aceitam **qualquer caminho absoluto**: não há raiz. Hoje só o Jarvis Mark os chama, com caminhos vindos do diálogo nativo ou do canal de notas. Mesmo assim, qualquer código da WebView pode ler ou escrever até 2 MB em qualquer lugar. Ver [jarvis-mark](../apps/jarvis-mark/spec.md#pendências).
- [ ] Os comandos `workspace_*` confinam os caminhos **abaixo** do `root`, mas o próprio `root` pode ser qualquer pasta absoluta escolhida pela UI. Ver [jv_ide](../apps/jv_ide/spec.md#pendências).
- [ ] `write_text_file` não limita o tamanho, mas `read_text_file` corta em 2 MB: um arquivo salvo com mais que isso não reabre.
- [ ] O yt-dlp é baixado de `releases/latest`, sem versão fixada. O hash confere a integridade, mas não protege contra uma regressão de uma versão nova.
- [ ] O `assistant\mcp.json` guarda o token em texto puro no perfil do usuário. É aceitável no modelo de usuário único e é regravado a cada início.
