# ADR-0028: Um processo do Claude Code por conversa, até cinco respondendo, e agentes confinados no chat

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-19 |
| **Origem** | feature agent-contacts (2026-11-19) |
| **Spec** | [agent-contacts](../../features/agent-contacts/spec.md), [chat-mode](../../features/chat-mode/spec.md), [assistant](../../features/assistant/spec.md) |

## Contexto

O [ADR-0006](0006-jarvis-via-claude-cli.md) decidiu: "Manter um processo `claude -p` de longa duração" e "Uma pergunta por vez". Com o [modo chat](../../features/chat-mode/spec.md) e várias conversas, isso virou um limite visível: enquanto o JARVIS responde numa conversa, nenhuma outra pode perguntar, e trocar de conversa mata e recria o processo (`--resume`).

O [ADR-0007](0007-jarvis-confinado-a-documentos.md) decidiu que agentes criados no jv_agent rodam fora do JARVIS, numa aba visível do jv_sh, porque podem ter mais poder (shell, outras pastas) e o usuário precisa ver e aprovar.

Em 2026-11-19 o usuário pediu, para o jvOS como sistema agêntico: mandar o JARVIS fazer algo demorado e seguir conversando em outra conversa (até 5 ao mesmo tempo, escolha dele), e conversar com os agentes como contatos do chat, **confinados como o JARVIS** (escolha dele, entre as três oferecidas).

Medidas que pesam: um `claude.exe` ocupa de 180 a 215 MB ([memory-cleanup](../../features/memory-cleanup/spec.md)), e a máquina do usuário tem 32 GB.

## Decisão

- **Abordagem escolhida:**
  1. Manter **um processo `claude -p` por conversa** (um "slot" por id de conversa), no lugar do processo único. A regra "uma pergunta por vez" passa a valer **por conversa**.
  2. Limitar a **5 conversas respondendo ao mesmo tempo** (`MAX_ANSWERING`). A sexta pergunta é recusada com uma mensagem; não há fila.
  3. Manter no máximo **um processo ocioso**: aquecer ou perguntar numa conversa encerra os processos ociosos das outras. A sessão de cada uma fica, e é retomada com `--resume` quando ela voltar.
  4. Um **contato-agente** é uma conversa cujo processo sobe com o prompt do agente (o corpo do rascunho em `Documentos\JARVIS\Agentes\<nome>.md`) no lugar da persona do JARVIS, e com **exatamente as mesmas travas**: mesma pasta de trabalho, `--restricted`, a mesma lista de ferramentas, sem shell, `dontAsk`. O campo `tools` e o `model` do rascunho são ignorados.
- **Por quê:**
  - o pedido do usuário, e 5 × ~200 MB cabe com folga em 32 GB;
  - um processo ocioso só preserva o aquecimento da conversa em uso (a razão do pré-aquecimento do ADR-0006) sem deixar a memória crescer com o número de conversas;
  - o confinamento é dado pelas flags do processo, não pelo prompt: trocar o prompt não amplia o que o agente alcança.
- **Alternativas rejeitadas:**
  - **Fila em vez de recusa na sexta pergunta:** esconderia do usuário que nada está acontecendo. A recusa é imediata e clara.
  - **Um processo por conversa sem limite de ociosos:** a memória cresceria com cada conversa aberta.
  - **`claude --agent <nome>` no canal do chat:** aplicaria as ferramentas e o modelo do agente, e o resultado das flags de restrição combinadas com `--agent` não foi verificado. Subir o processo do JARVIS com outro prompt é o caminho que mantém as travas com certeza.
  - **Poder total para o agente no chat:** oferecida e recusada pelo usuário; o ADR-0007 continua valendo para isso (aba do jv_sh).

## Interfaces

- **Comandos Tauri:**
  - `assistant_ask` e `assistant_warm` ganham `conversationId?` e `agent?`; `assistant_cancel` e `assistant_reset` ganham `conversationId?`. Sem `conversationId`, vale a conversa `"main"` (compatível com quem chamava antes).
  - `agent_contacts` (novo): os agentes que podem ser contatos.
  - `assistant_sleep` passa a agir sobre todos os processos.
- **Eventos e Channels:** os mesmos; cada pergunta continua com o seu `Channel`.
- **Dados:** `agent` em cada conversa de `jarvis.conversations`.
- **Estados da UI:** cada conversa mostra o seu "respondendo"; uma resposta que termina fora da tela marca a conversa como não lida.

## Restrições

- **Compatibilidade:** as sessões e conversas já salvas continuam; o desktop (núcleo) usa a conversa ativa como antes.
- **Segurança:** as flags de confinamento são as mesmas para todo processo, agente ou não ([security](../security.md)). O servidor MCP continua único, com um token; as chamadas não dizem de qual conversa vêm, e a UI as executa do mesmo jeito para todas.
- **Desempenho:** até 5 processos respondendo mais 1 ocioso: cerca de 1,2 GB no pico, pelas medidas existentes. O pico real com 5 respostas simultâneas não foi medido.
- **Limites operacionais:** duas conversas nunca retomam a mesma sessão (cada conversa tem a sua); processos simultâneos podem escrever no mesmo arquivo de `Documentos\JARVIS` (`Memória.md`, as anotações do dia) sem trava.

## Plano de rollout

- **Fase 1:** os slots, o limite e os contatos, com os testes Rust e o fake do modo web com várias respostas simultâneas.
- **Sinal de parada:** `claude.exe` órfão depois de fechar o app, ou respostas de uma conversa aparecendo em outra.
- **Reversão:** fixar `MAX_ANSWERING` em 1 e ignorar `conversationId` (tudo cai no slot `"main"`) devolve o comportamento do ADR-0006 sem apagar dados.

## Consequências

- **Positivas:** tarefas em segundo plano; trocar de conversa não interrompe nada; agentes conversáveis sem abrir mão do confinamento.
- **Negativas / custos:** mais memória no pico; a "limpeza de memória" precisa olhar todos os processos; escritas concorrentes nos arquivos do JARVIS.
- **Regras que daqui decorrem:**
  - toda função do assistente recebe a conversa; nada assume um processo só;
  - nenhum processo do chat sobe sem `--restricted`, `--tools`, `--permission-mode dontAsk` e `--strict-mcp-config`, seja qual for o prompt;
  - agente que precisa de shell ou de outra pasta roda no jv_sh, como manda o ADR-0007.

## Referências

- `src-tauri/src/assistant.rs`, `src-tauri/src/agents.rs`, `src-tauri/src/lib.rs`, `src/hooks/useAssistant.ts`, `src/lib/assistant.ts`
- Substitui em parte o [ADR-0006](0006-jarvis-via-claude-cli.md) (um processo, uma pergunta por vez) e o [ADR-0007](0007-jarvis-confinado-a-documentos.md) (agentes só no jv_sh); os dois continuam aceitos no resto.
