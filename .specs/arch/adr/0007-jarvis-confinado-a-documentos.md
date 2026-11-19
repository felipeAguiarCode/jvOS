# ADR-0007: O JARVIS fica confinado a `Documentos\JARVIS`, sem ferramentas de shell

| | |
|---|---|
| **Status** | Aceito; em parte substituído pelo [ADR-0028](0028-processo-claude-code-conversa-ate-cinco.md) (um agente também pode responder no chat, com o confinamento do JARVIS; com ferramentas próprias continua só no jv_sh) |
| **Data** | 2026-10-27 |
| **Origem** | commit `750ebd0` ("JARVIS only writes under Documentos\JARVIS"); doc de `assistant.rs`; memória `claude-cli-bridge` |

## Contexto

O JARVIS é um LLM que lê páginas da web e recebe fala transcrita, então pode ser induzido a agir mal por prompt injection ou por um mal-entendido. Ele precisa escrever notas, memória e rascunhos de agentes, mas não precisa tocar no resto do disco nem rodar comandos.

Comportamento verificado do CLI:
- `--restricted` funciona com o login OAuth da assinatura e confina Read, Edit e Write ao cwd;
- dentro do cwd é preciso um `--allowedTools Read Edit Write` sem padrão, porque `Edit(./**)` não casava quando o cwd era um caminho curto 8.3 (`FELIPE~1`).

## Decisão

- cwd do processo: **`Documentos\JARVIS`** (ou `~\JARVIS`), com `Memória.md`, `Notas\` e `Agentes\`.
- Flags:
  - `--restricted`;
  - `--tools WebSearch,WebFetch,Read,Edit,Write,Glob,Grep` (**sem Bash**);
  - `--permission-mode dontAsk`;
  - `--allowedTools` com as ferramentas de arquivo + `mcp__jarvis`;
  - `--strict-mcp-config` (só o servidor do jvOS).
- Tudo que age fora da pasta passa pelas **ferramentas MCP** ([ADR-0008](0008-mcp-http-in-process.md)), que só fazem o que o usuário faria pela UI.
- Agentes que precisem de mais poder rodam **fora** do JARVIS, como `claude --agent` numa aba visível do jv_sh, onde o usuário aprova as permissões.

## Consequências

- **Positivas:**
  - o pior caso de uma injeção é sujar a própria pasta do JARVIS ou acionar ações de UI reversíveis;
  - as notas ficam em Markdown comum, que o usuário abre fora do app.
- **Negativas:**
  - o JARVIS não pode ler um arquivo que o usuário mencione fora da pasta;
  - não pode rodar scripts.
- **Regras:**
  - nenhuma ferramenta MCP nova pode virar "rodar comando" ou "ler qualquer caminho";
  - pedidos assim viram um agente revisado ([jv_agent](../../apps/jv_agent/spec.md)).

## Alternativas consideradas

Não registradas.

## Referências

- `src-tauri/src/assistant.rs`, `src-tauri/assistant-persona.md`
- [security](../security.md), [persistence](../../domain/persistence.md#3-documentosjarvis-cai-para-jarvis-se-não-houver-documentos)
