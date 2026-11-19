# Specs do JARVIS OS

Esta pasta documenta tudo o que o jvOS faz, como faz e por quê. Cada feature, widget, app e item de fundamento tem a sua pasta com **um único `spec.md`**, no formato das ferramentas do [spec-coding.dev](https://spec-coding.dev/tools/) ([ADR-0023](arch/adr/0023-specs-formato-spec-coding-dev.md)). No meio da spec fica o corpo **SpecLang** da [GitHub Next](https://githubnext.com/projects/speclang/), a fonte da verdade do que o código faz, escrita em prosa estruturada por componente ([ADR-0019](arch/adr/0019-specs-arquivo-unico-formato-spec-lang.md)). As specs de `features/` usam o formato **Feature Specification** ([ADR-0025](arch/adr/0025-features-formato-feature-specification.md)): Metadata, Overview, Goals, Scope, User Stories, Requirements, Acceptance Criteria (`AC-00N`, Given / When / Then), Behavior and Flows, Data Model, Technical Design, Interfaces, Edge Cases, Dependencies, Test Strategy, Implementation Plan, Rollback Plan, Constitution Compliance, Known Limitations (`KL`) e Open Questions (`OQ`). Os títulos ficam em inglês e o conteúdo em PT-BR; o modelo é [reminders](features/reminders/spec.md) e o template, [`_templates/feature.md`](_templates/feature.md). A tabela abaixo descreve o formato de widgets, apps e fundamentos.

| Seção do `spec.md` | Conteúdo |
|---|---|
| `# Tipo: Nome`, linha de abertura e cabeçalho | Feature, Widget, App, Vendor ou Fundamento; o que é em uma frase; ID, status, origem, window kind e ids de voz |
| `Objetivo` · `Não-objetivos` | O resultado observável · o que o item não faz de propósito e as limitações |
| `Histórias de usuário` | US1… com prioridade, teste independente e o link para os critérios |
| `Critérios de aceite` | `### Critério N (USk)` com **Dado** / **Quando** / **Então**: binários, cada um vira um teste; caminho feliz, falha e borda |
| `Casos de borda` | As quatro categorias do spec-coding.dev (Vazio/nulo, Duplicidade/idempotência, Concorrência/corrida, Permissões/visibilidade) e os transversais |
| `Dados` | Cada valor com um nome `$assim`: forma, chave `jarvis.*`, debounce e parser tolerante |
| `Telas` (apps) e `Componentes` | Um `###` por tela ou componente, com **Comportamento** (onde moram os RF), **Layout** e **Estilo** tirados do código |
| `Voz e teclado` · `Restrições` · `Critérios de sucesso` | Frases, teclas e os RF de voz · os RNF · SC-001… |
| `Entregáveis` | Abordagem, camadas, arquivos, contratos (comandos, eventos, tools MCP), fluxo, **Testes** (comando e critérios), **Reversão**, checagem da [constituição](arch/constitution.md), ADRs |
| `Dependências` | Specs de vendor, outras specs e recursos do sistema |
| `Tarefas` · `Pendências` | Fases com `T001…` (as novas com Aceite, Arquivos permitidos, Comando de teste e Evidência) · as lacunas `[ ]` |

Valores com nome aparecem como `$cidade`, código entre crases e rótulos da UI "entre aspas". Os modelos estão em [`_templates/`](_templates/): `spec.md` (feature, widget e app), `vendor.md` (lib, modelo ou ferramenta) e `adr.md` (Design Doc do spec-coding.dev).

As specs foram escritas **retroativamente** em 2026-11-01 e cobrem o projeto inteiro até o trabalho de 27/10, incluindo o que ainda não está commitado. Em 2026-11-03, os três arquivos de cada pasta (`spec.md`, `plan.md`, `tasks.md`) foram fundidos neste formato, sem perder nenhum ID, aceite, tarefa ou pendência, e ganharam Layout e Estilo tirados dos componentes. Em 2026-11-05, passaram para o formato do spec-coding.dev: os 550 cenários das histórias viraram critérios numerados (por script, com auditoria palavra a palavra), e as seções novas (casos de borda por categoria, testes, reversão e dependências) foram escritas a partir do código. Os motivos que não estão registrados no código, em commits ou em notas levam o marcador `⚠ inferido — confirmar`.

## Comece por aqui

- [arch/overview.md](arch/overview.md): camadas, processos e fluxos principais.
- [arch/constitution.md](arch/constitution.md): os 12 princípios que todo código segue.
- [domain/glossary.md](domain/glossary.md): a linguagem do projeto.
- [foundation/architecture](foundation/architecture/spec.md) e [foundation/stack](foundation/stack/spec.md): as regras das camadas e as versões, com critérios conferíveis.
- [arch/adr/](arch/adr/README.md): as 28 decisões de arquitetura.
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
| [adr/](arch/adr/README.md) | ADR-0001 … ADR-0028 |

## Fundamentos (`foundation/`)

Specs do que sustenta o app inteiro ([ADR-0024](arch/adr/0024-specs-de-fundamentos-e-vendor.md)). Toda dependência direta do `package.json` e do `Cargo.toml` aparece em exatamente uma spec de `vendor/`.

| Spec | O que é |
|---|---|
| [architecture](foundation/architecture/spec.md) | WebView2 desenha, Rust é dono do nativo: camadas, IPC, processos externos, persistência |
| [stack](foundation/stack/spec.md) | Linguagens, frameworks, toolchain, versões travadas e comandos |

### Vendor (`foundation/vendor/`)

| Tipo | Specs |
|---|---|
| Libs do front-end | [react](foundation/vendor/react/spec.md) · [vite-typescript](foundation/vendor/vite-typescript/spec.md) · [tailwind](foundation/vendor/tailwind/spec.md) · [motion](foundation/vendor/motion/spec.md) · [lucide](foundation/vendor/lucide/spec.md) · [vt323](foundation/vendor/vt323/spec.md) · [three](foundation/vendor/three/spec.md) · [codemirror](foundation/vendor/codemirror/spec.md) · [markdown](foundation/vendor/markdown/spec.md) · [playwright](foundation/vendor/playwright/spec.md) |
| Plataforma e Rust | [tauri](foundation/vendor/tauri/spec.md) · [terminal](foundation/vendor/terminal/spec.md) · [whisper-rs](foundation/vendor/whisper-rs/spec.md) · [sherpa-onnx](foundation/vendor/sherpa-onnx/spec.md) · [cpal](foundation/vendor/cpal/spec.md) · [serde](foundation/vendor/serde/spec.md) · [http](foundation/vendor/http/spec.md) · [workspace-fs](foundation/vendor/workspace-fs/spec.md) · [archives](foundation/vendor/archives/spec.md) |
| Modelos | [whisper-models](foundation/vendor/whisper-models/spec.md) · [silero-vad](foundation/vendor/silero-vad/spec.md) · [piper-voices](foundation/vendor/piper-voices/spec.md) · [kokoro](foundation/vendor/kokoro/spec.md) |
| Ferramentas externas | [claude-code](foundation/vendor/claude-code/spec.md) (CLI e modelos Claude) · [yt-dlp](foundation/vendor/yt-dlp/spec.md) · [git](foundation/vendor/git/spec.md) |

## Domínio (`domain/`)

| Documento | Conteúdo |
|---|---|
| [glossary.md](domain/glossary.md) | Termos, com o tipo correspondente em TS e em Rust |
| [model.md](domain/model.md) | Entidades, relações e ciclos de vida (lembrete, tarefa, compromisso, agente, pergunta) |
| [persistence.md](domain/persistence.md) | `settings.json`, todas as chaves `jarvis.*`, `Documentos\JARVIS`, `%LOCALAPPDATA%` |
| [voice-intents.md](domain/voice-intents.md) | Catálogo das 53 entradas de voz e como o matcher decide |
| [jarvis-persona.md](domain/jarvis-persona.md) | Personagem, regras do prompt e falas locais (`LINES`) |

## Features (`features/`)

No formato Feature Specification ([ADR-0025](arch/adr/0025-features-formato-feature-specification.md)).

| Spec | O que é | Status |
|---|---|---|
| [boot](features/boot/spec.md) | Tela de inicialização estilo BIOS | Implementado |
| [greeting-homecoming](features/greeting-homecoming/spec.md) | Saudação, "acorda, querido, papai chegou" e falas locais | Implementado |
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
| [assistant-tools](features/assistant-tools/spec.md) | Servidor MCP e as 18 ferramentas | Implementado |
| [voice-shortcuts](features/voice-shortcuts/spec.md) | Os 18 atalhos de voz do JARVIS | Implementado |
| [reminders](features/reminders/spec.md) | Lembretes e timers | Implementado |
| [quick-notes](features/quick-notes/spec.md) | "Anota que…" | Implementado |
| [memory-cleanup](features/memory-cleanup/spec.md) | "Limpa a memória" (RAM do Claude) | Implementado |
| [chat-mode](features/chat-mode/spec.md) | Modo chat: o JARVIS como mensageiro, com várias conversas | Implementado · não commitado |
| [notes-area](features/notes-area/spec.md) | Área de notas do modo chat (`Documentos\JARVIS\Notas`) | Implementado · não commitado |
| [notes-graph](features/notes-graph/spec.md) | `[[links]]`, `#tags`, backlinks e o grafo 3D das notas | Implementado · não commitado |
| [agent-contacts](features/agent-contacts/spec.md) | Respostas em segundo plano (até 5 conversas) e agentes como contatos do chat | Implementado · não commitado |

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
| [stocks](widgets/stocks/spec.md) | Ações e FIIs, alertas de preço | Implementado |
| [weather](widgets/weather/spec.md) | Clima | Implementado |
| [agenda](widgets/agenda/spec.md) | Agenda | Implementado |
| [tasks](widgets/tasks/spec.md) | Tarefas do dia | Implementado |

## Apps (`apps/`)

| Spec | O que é | Status |
|---|---|---|
| [jv_ide](apps/jv_ide/spec.md) | IDE TUI (workspace, git, busca, terminal) | Implementado |
| [jv_sh](apps/jv_sh/spec.md) | Terminal com os perfis do Windows Terminal | Implementado |
| [jv_t4p3](apps/jv_t4p3/spec.md) | Player de música (estações e YouTube) | Implementado |
| [jarvis-mark](apps/jarvis-mark/spec.md) | Editor de Markdown e notas do JARVIS | Implementado |
| [jv_lab](apps/jv_lab/spec.md) | Lições de IA com terminal simulado | Implementado |
| [jv_agent](apps/jv_agent/spec.md) | Oficina de agentes do Claude Code | Implementado |

A origem exata (commit e data) e as evoluções de cada item estão no cabeçalho do seu `spec.md`.

## Como manter

0. **Spec primeiro:** toda feature, nova ou mudança, começa pela spec. O plano é escrito em `features/<id>/spec.md`, e só depois vem o código ([ADR-0026](arch/adr/0026-feature-comeca-pela-spec.md)). No Claude Code, a skill do projeto `.claude/skills/feature/` (`/feature <pedido>`) faz o ciclo: planejar, implementar, verificar e fechar a spec.
1. **Item novo:** rode `npm run new`. O assistente pergunta o tipo e os dados e mostra um resumo antes de gravar. Em seguida:
   - cria o `spec.md` a partir de `_templates/feature.md` (feature) ou `_templates/spec.md` (widget e app) e os esqueletos de código (componente, lib/hook, teste);
   - imprime o **checklist de registro**: o que colar em `desktop.ts`, no catálogo de voz, no Rust, no `testMatch` e nos docs.

   O CLI não edita nenhum arquivo existente. O checklist também fica em Tarefas › Fase 2 da spec.
   - Sem perguntas: `npm run new -- widget <kind> --title "…" --yes`. O `--dry-run` mostra o que seria feito e `--help` lista as flags.
   - Widgets usam o `WindowKind` como nome da pasta. Apps usam o nome do produto (`jv_*`).
   - Preencha a spec antes do código (item 0).
2. **Mudança de comportamento:** no `spec.md`, atualize o bullet do componente (e o RF dele), os Critérios de aceite (e o link `**Aceite:**` da história), os Casos de borda, os Entregáveis (Testes e Reversão) e as Tarefas (tarefa nova, teste e pendência resolvida). Um RF ou critério novo pega o próximo número livre, e nenhum número é reaproveitado.
   - **Dependência nova ou trocada:** atualize a spec de `foundation/vendor/` da família (ou crie uma a partir de `_templates/vendor.md`), a tabela de [stack](foundation/stack/spec.md) e a seção `Dependências` das specs que a usam.
3. **Mudança de contrato:** atualize também [ipc-contract](arch/ipc-contract.md), [persistence](domain/persistence.md) ou [voice-intents](domain/voice-intents.md).
4. **Decisão de arquitetura:** crie um ADR novo a partir de `_templates/adr.md`. Nunca reescreva um ADR aceito ([regras](arch/adr/README.md#regras)).
5. **Status:** `Em desenvolvimento` (spec criada, código ainda não pronto), `Implementado`, `Implementado · não commitado` (o arquivo principal ainda não está em commit) ou `Removido`. Quando o trabalho for commitado, troque "não commitado" pelo hash.
6. **Pendências:** ficam no fim do `spec.md`, como `- [ ]`. Só se registra o que foi visto no código, nunca um desejo vago.
