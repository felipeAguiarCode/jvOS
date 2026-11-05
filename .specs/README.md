# Specs do JARVIS OS

Esta pasta documenta tudo o que o jvOS faz, como faz e por quê. Cada feature, widget e app tem a sua pasta com **um único `spec.md`**, no formato **SpecLang** da [GitHub Next](https://githubnext.com/projects/speclang/): a spec é a fonte da verdade do que o código faz, escrita em prosa estruturada por componente. Os IDs e o aceite do estilo spec-kit continuam, fundidos no mesmo arquivo ([ADR-0019](arch/adr/0019-specs-arquivo-unico-formato-spec-lang.md)).

| Seção do `spec.md` | Conteúdo |
|---|---|
| Título, linha de abertura e cabeçalho | O que é em uma frase; ID, status, origem, window kind e ids de voz |
| `Visão geral` | Para quem é e por quê |
| `Dados` | Cada valor com um nome `$assim`: forma, chave `jarvis.*`, debounce e parser tolerante |
| `Telas` (apps) e `Componentes` | Um `###` por tela ou componente, com **Comportamento** (onde moram os RF), **Layout** e **Estilo** tirados do código |
| `Casos de borda` (opcional) | Só os que não pertencem a um componente; os outros são "Se …, então …" no componente |
| `Voz e teclado` · `Restrições` | Frases, teclas e os RF de voz · os RNF |
| `Histórias de usuário` | US1… com prioridade, teste independente e aceite Dado/Quando/Então |
| `Critérios de sucesso` · `Fora de escopo e limitações` | SC-001… · o que o item não faz |
| `Código` | Abordagem, camadas, arquivos, contratos (comandos, eventos, tools MCP), fluxo, checagem da [constituição](arch/constitution.md), ADRs |
| `Tarefas` · `Pendências` | Fases com `T001…` `[x]`, os testes que as cobrem, e as lacunas `[ ]` |

Valores com nome aparecem como `$cidade`, código entre crases e rótulos da UI "entre aspas". O modelo está em [`_templates/spec.md`](_templates/spec.md).

As specs foram escritas **retroativamente** em 2026-11-01 e cobrem o projeto inteiro até o trabalho de 27/10, incluindo o que ainda não está commitado. Em 2026-11-03, os três arquivos de cada pasta (`spec.md`, `plan.md`, `tasks.md`) foram fundidos neste formato, sem perder nenhum ID, aceite, tarefa ou pendência, e ganharam Layout e Estilo tirados dos componentes. Os motivos que não estão registrados no código, em commits ou em notas levam o marcador `⚠ inferido — confirmar`.

## Comece por aqui

- [arch/overview.md](arch/overview.md): camadas, processos e fluxos principais.
- [arch/constitution.md](arch/constitution.md): os 12 princípios que todo código segue.
- [domain/glossary.md](domain/glossary.md): a linguagem do projeto.
- [arch/adr/](arch/adr/README.md): as 22 decisões de arquitetura.
- `npm run new`: o CLI que cria um widget, app, feature ou ADR já no formato destas specs ([ADR-0018](arch/adr/0018-cli-scaffolding-so-cria-arquivos-novos.md)).

## Arquitetura (`arch/`)

| Documento | Conteúdo |
|---|---|
| [constitution.md](arch/constitution.md) | Princípios P1–P12 (offline, Rust nativo, contratos espelhados, persistência tolerante, PT-BR…) |
| [overview.md](arch/overview.md) | Diagrama de camadas, módulos do Rust, processos e portas |
| [ipc-contract.md](arch/ipc-contract.md) | Os 75 comandos Tauri, os eventos, os Channels e as 18 ferramentas MCP |
| [coding-style.md](arch/coding-style.md) | Estilo de TS/React, Rust e CSS, e o checklist de uma mudança |
| [testing.md](arch/testing.md) | Playwright no modo web, fakes `__JARVIS_*__`, `cargo test`, app real via CDP, vídeos de demo, armadilhas |
| [build-and-env.md](arch/build-and-env.md) | `scripts/tauri.mjs`, CMake/LLVM, perfis de build, DLLs do sherpa |
| [security.md](arch/security.md) | Confinamento do JARVIS, MCP local, guardas de caminho e lacunas conhecidas |
| [adr/](arch/adr/README.md) | ADR-0001 … ADR-0022 |

## Domínio (`domain/`)

| Documento | Conteúdo |
|---|---|
| [glossary.md](domain/glossary.md) | Termos, com o tipo correspondente em TS e em Rust |
| [model.md](domain/model.md) | Entidades, relações e ciclos de vida (lembrete, tarefa, compromisso, agente, pergunta) |
| [persistence.md](domain/persistence.md) | `settings.json`, todas as chaves `jarvis.*`, `Documentos\JARVIS`, `%LOCALAPPDATA%` |
| [voice-intents.md](domain/voice-intents.md) | Catálogo das 53 entradas de voz e como o matcher decide |
| [jarvis-persona.md](domain/jarvis-persona.md) | Personagem, regras do prompt e falas locais (`LINES`) |

## Features (`features/`)

| Spec | O que é | Status |
|---|---|---|
| [boot](features/boot/spec.md) | Tela de inicialização estilo BIOS | Implementado |
| [greeting-homecoming](features/greeting-homecoming/spec.md) | Saudação, "acorda, querido, papai chegou" e falas locais | Implementado · volta para casa não commitada |
| [holographic-core](features/holographic-core/spec.md) | Núcleo 2D/3D/off, qualidade, reação à voz | Implementado |
| [desktop-windows](features/desktop-windows/spec.md) | Gerenciador de janelas, snap, menu de opções, apps lazy | Implementado |
| [dock-taskbar](features/dock-taskbar/spec.md) | Dock e barra superior | Implementado |
| [search](features/search/spec.md) | Busca (`/`) e catálogo de ações do jvOS | Implementado |
| [settings](features/settings/spec.md) | Configurações e Menu avançado | Implementado |
| [appearance](features/appearance/spec.md) | Tema, TUI e tokens | Implementado |
| [keyboard-shortcuts](features/keyboard-shortcuts/spec.md) | Teclas globais e índice das teclas locais | Implementado |
| [app-launcher](features/app-launcher/spec.md) | Programas, sites e pastas externos | Implementado |
| [voice-engine](features/voice-engine/spec.md) | Microfone → VAD → Whisper, modelos, modos de ativação | Implementado |
| [voice-commands](features/voice-commands/spec.md) | Matcher, catálogo e aba Voz | Implementado |
| [dictation](features/dictation/spec.md) | Ditado no Jarvis Mark | Implementado |
| [tts](features/tts/spec.md) | Voz do JARVIS (sherpa-onnx) | Implementado |
| [assistant](features/assistant/spec.md) | JARVIS no Claude Code | Implementado |
| [assistant-tools](features/assistant-tools/spec.md) | Servidor MCP e as 18 ferramentas | Implementado · 11 tools não commitadas |
| [voice-shortcuts](features/voice-shortcuts/spec.md) | Os 18 atalhos de voz do JARVIS | Implementado · 9 atalhos não commitados |
| [reminders](features/reminders/spec.md) | Lembretes e timers | Implementado |
| [quick-notes](features/quick-notes/spec.md) | "Anota que…" | Implementado |
| [memory-cleanup](features/memory-cleanup/spec.md) | "Limpa a memória" (RAM do Claude) | Implementado · não commitado |

## Widgets (`widgets/`)

| Spec | O que é | Status |
|---|---|---|
| [clock](widgets/clock/spec.md) | Relógio | Implementado |
| [pomodoro](widgets/pomodoro/spec.md) | Pomodoro | Implementado |
| [battery](widgets/battery/spec.md) | Bateria | Implementado |
| [calculator](widgets/calculator/spec.md) | Calculadora | Implementado |
| [tape](widgets/tape/spec.md) | Fita cassete do player | Implementado |
| [miniplayer](widgets/miniplayer/spec.md) | Mini player | Implementado |
| [system](widgets/system/spec.md) | Medidores do sistema | Implementado |
| [stocks](widgets/stocks/spec.md) | Ações e FIIs, alertas de preço | Implementado · não commitado |
| [weather](widgets/weather/spec.md) | Clima | Implementado · não commitado |
| [agenda](widgets/agenda/spec.md) | Agenda | Implementado · não commitado |
| [tasks](widgets/tasks/spec.md) | Tarefas do dia | Implementado · não commitado |

## Apps (`apps/`)

| Spec | O que é | Status |
|---|---|---|
| [jv_ide](apps/jv_ide/spec.md) | IDE TUI (workspace, git, busca, terminal) | Implementado |
| [jv_sh](apps/jv_sh/spec.md) | Terminal com os perfis do Windows Terminal | Implementado |
| [jv_t4p3](apps/jv_t4p3/spec.md) | Player de música (estações e YouTube) | Implementado |
| [jarvis-mark](apps/jarvis-mark/spec.md) | Editor de Markdown e notas do JARVIS | Implementado |
| [jv_lab](apps/jv_lab/spec.md) | Lições de IA com terminal simulado | Implementado |
| [jv_agent](apps/jv_agent/spec.md) | Oficina de agentes do Claude Code | Implementado · partes não commitadas |

A origem exata (commit e data) e as evoluções de cada item estão no cabeçalho do seu `spec.md`.

## Como manter

1. **Item novo:** rode `npm run new`. O assistente pergunta o tipo e os dados e mostra um resumo antes de gravar. Em seguida:
   - cria o `spec.md` a partir de `_templates/spec.md` e os esqueletos de código (componente, lib/hook, teste);
   - imprime o **checklist de registro**: o que colar em `desktop.ts`, no catálogo de voz, no Rust, no `testMatch` e nos docs.

   O CLI não edita nenhum arquivo existente. O checklist também fica em Tarefas › Fase 2 da spec.
   - Sem perguntas: `npm run new -- widget <kind> --title "…" --yes`. O `--dry-run` mostra o que seria feito e `--help` lista as flags.
   - Widgets usam o `WindowKind` como nome da pasta. Apps usam o nome do produto (`jv_*`).
   - Escreva a spec antes ou junto do código.
2. **Mudança de comportamento:** no `spec.md`, atualize o bullet do componente (e o RF dele), o aceite, o Código e as Tarefas (tarefa nova, teste e pendência resolvida). Um RF novo pega o próximo número livre, e nenhum número é reaproveitado.
3. **Mudança de contrato:** atualize também [ipc-contract](arch/ipc-contract.md), [persistence](domain/persistence.md) ou [voice-intents](domain/voice-intents.md).
4. **Decisão de arquitetura:** crie um ADR novo a partir de `_templates/adr.md`. Nunca reescreva um ADR aceito ([regras](arch/adr/README.md#regras)).
5. **Status:** `Em desenvolvimento` (spec criada, código ainda não pronto), `Implementado`, `Implementado · não commitado` (o arquivo principal ainda não está em commit) ou `Removido`. Quando o trabalho for commitado, troque "não commitado" pelo hash.
6. **Pendências:** ficam no fim do `spec.md`, como `- [ ]`. Só se registra o que foi visto no código, nunca um desejo vago.
