# ADR-0006: O cérebro do JARVIS é o `claude.exe` local em stream-json, não a API

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-27 |
| **Origem** | commits `750ebd0`, `048a254`; memória `claude-cli-bridge` (comportamento verificado no claude.exe 2.1.310) |

## Contexto

O JARVIS precisa conversar, pesquisar na web, ler e escrever notas e agir no jvOS. O usuário já tem o **Claude Code instalado e logado com a assinatura**. Uma integração pela API exigiria chave, cobrança separada e reimplementar ferramentas (busca, leitura, escrita) que o Claude Code já tem.

Medições (2026-10-27, `-p --effort low`, resposta trivial):
- tempo de API: Haiku ~0,77 s, Sonnet ~0,86 s, Opus ~1,7 s;
- **iniciar o processo soma ~2,3 s**;
- com `--resume`, o primeiro turno sai em ~1 s.

O padrão do próprio usuário no Claude Code é `opus` com `effortLevel: xhigh`, lento demais para uma resposta falada.

## Decisão

- Manter **um processo `claude -p` de longa duração** com `--input-format stream-json --output-format stream-json --verbose --include-partial-messages`. Cada pergunta é uma linha no stdin, e a resposta volta por um `ipc::Channel` (`session`, `delta`, `tool`, `file`, `done`).
- **Pré-aquecer** o processo no início do app (`assistant_warm`).
- O modelo é do próprio JARVIS: `--model` vem de `Settings.assistantModel` (padrão **sonnet**; também haiku, opus ou `default`). Sempre com `--effort low`.
- Persona, nome do usuário e `Memória.md` entram por `--append-system-prompt`, com até 8000 caracteres.
- A conversa é a sessão do Claude Code. Ela é retomada com `--resume <id>` **só se** `~/.claude/projects/*/<id>.jsonl` existir, porque um id desconhecido derruba o processo.
- Uma pergunta por vez. Uma mudança de perfil (modelo ou nome) reinicia o processo. Encerrar usa `taskkill /T /F`.
- `DISABLE_AUTOUPDATER=1`, `--disable-slash-commands` e `--strict-mcp-config`.

## Consequências

- **Positivas:**
  - sem chave nem custo extra;
  - WebSearch, WebFetch e as ferramentas de arquivo vêm prontas;
  - a primeira palavra sai em ~1 s com o processo aquecido.
- **Negativas:**
  - depende do Claude Code instalado e logado (é requisito do README);
  - **o formato stream-json e as flags podem mudar a cada versão**, então é preciso testar de novo após upgrades;
  - um processo residente ocupa RAM, o que motivou [memory-cleanup](../../features/memory-cleanup/spec.md) (`assistant_sleep`).
- **Regras:**
  - eventos de subagentes são ignorados;
  - qualquer flag nova precisa ser verificada contra o CLI real antes de entrar.

## Alternativas consideradas

- **Messages API direta:** rejeitada, porque exige chave e reimplementar ferramentas.
- **Um processo por pergunta:** rejeitada, porque soma ~2,3 s de partida a frio por turno.

## Referências

- `src-tauri/src/assistant.rs`, `src/lib/assistant.ts`, `src-tauri/assistant-persona.md`
- [ADR-0007](0007-jarvis-confinado-a-documentos.md), [ADR-0008](0008-mcp-http-in-process.md), spec [assistant](../../features/assistant/spec.md)
