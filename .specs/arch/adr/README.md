# Architecture Decision Records

Este diretório registra as decisões que moldam o código. O formato está em [`_templates/adr.md`](../../_templates/adr.md).

| # | Decisão | Status |
|---|---|---|
| [0001](0001-tauri-rust-desktop.md) | Tauri 2 + Rust como casca do desktop | Aceito |
| [0002](0002-stt-whisper-offline-cpu.md) | Voz offline com whisper.cpp na CPU, Small por padrão | Substituído por [0021](0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md) |
| [0003](0003-motor-de-voz-thread-rust.md) | Motor de voz numa thread Rust independente da WebView | Aceito |
| [0004](0004-catalogo-de-voz-compartilhado-e-fallback.md) | Catálogo de voz compartilhado em JSON, com fallback para o JARVIS | Aceito |
| [0005](0005-tts-sherpa-onnx-1-13-8.md) | Voz do JARVIS com sherpa-onnx fixado em 1.13.8 | Aceito |
| [0006](0006-jarvis-via-claude-cli.md) | O cérebro do JARVIS é o `claude.exe` local em stream-json | Aceito |
| [0007](0007-jarvis-confinado-a-documentos.md) | JARVIS confinado a `Documentos\JARVIS`, sem shell | Aceito |
| [0008](0008-mcp-http-in-process.md) | Servidor MCP HTTP dentro do app; a UI executa as tools | Aceito |
| [0009](0009-tipos-espelhados-ts-rust.md) | Tipos espelhados TS ↔ Rust por convenção | Aceito |
| [0010](0010-persistencia-settings-vs-localstorage.md) | `settings.json` (Rust) vs `localStorage` (UI), parsers tolerantes | Aceito |
| [0011](0011-fakes-de-dev-e-e2e-modo-web.md) | Fakes de DEV, E2E no modo web, app real via CDP | Aceito |
| [0012](0012-apps-lazy-com-preload.md) | Apps lazy com preload | Aceito |
| [0013](0013-nucleo-2d-padrao.md) | Núcleo 2D por padrão, 3D opcional, ou desligado | Aceito |
| [0014](0014-linguagem-visual-tui.md) | Linguagem visual TUI | Aceito |
| [0015](0015-remocao-do-fundo-shader.md) | Remoção dos fundos animados (grade e Matrix) | Aceito (não commitado) |
| [0016](0016-readme-minimo-docs-em-specs.md) | README mínimo; documentação em `.specs` | Aceito · em parte substituído pelo 0019 |
| [0017](0017-ui-pt-br-codigo-en.md) | UI em PT-BR, código em inglês | Aceito |
| [0018](0018-cli-scaffolding-so-cria-arquivos-novos.md) | CLI de scaffolding que só cria arquivos novos | Aceito · em parte substituído pelo 0019 |
| [0019](0019-specs-arquivo-unico-formato-spec-lang.md) | Specs em arquivo único no formato SpecLang | Aceito |
| [0020](0020-videos-demo-gravados-playwright-modo-web.md) | Vídeos de demo gravados pelo Playwright no modo web | Aceito |
| [0021](0021-reconhecimento-voz-gpu-via-vulkan-porteiro.md) | Reconhecimento de voz na GPU via Vulkan, com porteiro Silero e volta para a CPU | Aceito |
| [0022](0022-nucleo-relogio-quadros-limitado-canvas-3.md) | Núcleo com relógio de quadros limitado, canvas 3D recortado e UI em D3D11 | Aceito |

## Regras

- **Numeração:** sequencial com 4 dígitos. O nome do arquivo usa kebab-case em PT-BR. `npm run new -- adr --title "…"` pega o próximo número e preenche o cabeçalho.
- **Um ADR aceito não é reescrito.** Se a decisão mudar, crie outro ADR com `Status: Aceito`, marque o antigo como `Substituído por ADR-00yy` e linke os dois.
- **Motivos sem registro** levam o marcador `> ⚠ inferido — confirmar` até alguém confirmar.
- Cada ADR cita as specs afetadas, e as specs citam o ADR em Código › "Decisões relacionadas" do `spec.md`.
- **Substituição em parte:** quando um ADR novo troca só um ponto de um antigo, o antigo continua `Aceito` e a linha Status ganha "em parte substituído pelo ADR-00yy (o ponto)".
