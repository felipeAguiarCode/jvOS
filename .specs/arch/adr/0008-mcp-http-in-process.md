# ADR-0008: Servidor MCP HTTP dentro do app; a UI executa as ferramentas

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-27 |
| **Origem** | commits `750ebd0`, `048a254`; doc de `mcp.rs`; memória `claude-cli-bridge` |

## Contexto

O JARVIS (`claude.exe`) precisa agir no jvOS: abrir janelas, marcar compromissos, criar tarefas, cotar ações. Quem sabe fazer isso é a **UI**, que guarda essas coisas em `localStorage` e mostra o resultado na tela.

O Claude Code aceita servidores MCP por `--mcp-config`. Comportamento verificado do transporte HTTP:
- o cliente primeiro faz POST `server/discover` (protocolo 2026-07-28). Se a resposta for `-32601`, ele cai para `initialize` (2025-11-25);
- respostas `application/json` simples funcionam;
- o cliente manda um GET (405 serve) e nenhum `Origin`;
- as tools aparecem como `mcp__jarvis__<tool>`.

## Decisão

- Um servidor **Streamable HTTP mínimo** com `tiny_http` em **`127.0.0.1:<porta aleatória>/mcp`**:
  - respostas JSON simples, só POST, corpo de até 1 MiB;
  - **token bearer de 128 bits** novo a cada início, gravado com a URL em `%LOCALAPPDATA%\dev.jarvis.os\assistant\mcp.json`;
  - recusa qualquer requisição com `Origin` (403), o que bloqueia sites;
  - uma thread por chamada.
- **18 tools** (lista em [ipc-contract](../ipc-contract.md#ferramentas-mcp-18)). Só `open_url` é resolvida no Rust.
- As demais são **encaminhadas à UI**: evento `assistant:action {id, tool, args}`. O `useAssistantActions` executa e responde com `assistant_action_result(id, ok, text)`. O servidor espera até **20 s**.
- `jvos_run` e `jvos_commands` reaproveitam o **mesmo catálogo da busca** (`src/lib/commands.ts`). Tudo o que a busca faz, o JARVIS também faz.

## Consequências

- **Positivas:**
  - uma única implementação de cada ação (a da UI), já coberta por testes Playwright;
  - o estado continua onde está;
  - o resultado aparece na tela enquanto o JARVIS fala.
- **Negativas:**
  - **as tools só funcionam com a UI viva**: com a WebView travada, a chamada expira em 20 s;
  - duas camadas para depurar (Rust e UI).
- **Regras:**
  - tool nova = schema em `mcp.rs` + handler em `useAssistantActions` + texto de status em PT-BR (`assistant.ts`) + linha no ipc-contract + menção na persona.

## Alternativas consideradas

- **Servidor MCP stdio separado:** sem registro de avaliação.
- **Executar no Rust:** exigiria mover para o Rust o estado que hoje vive no `localStorage`. Não há registro de que foi avaliado.

## Referências

- `src-tauri/src/mcp.rs`, `src-tauri/src/lib.rs` (`run_tool`, `start_mcp`), `src/hooks/useAssistantActions.ts`
- Spec: [assistant-tools](../../features/assistant-tools/spec.md) · [security](../security.md)
