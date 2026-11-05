# Constituição do JARVIS OS

Princípios que todo código novo segue. Cada `spec.md` se checa contra esta lista em Código › Constituição. Uma exceção precisa de justificativa ali ou de um ADR.

## P1 — Local e offline primeiro

A voz roda inteira na máquina: ouvir com whisper.cpp e falar com sherpa-onnx. A rede só é usada no que é online por natureza: Claude Code, clima, cotações, músicas do YouTube e download de modelos. Nenhuma integração exige chave de API.

Ver [ADR-0002](adr/0002-stt-whisper-offline-cpu.md), [ADR-0005](adr/0005-tts-sherpa-onnx-1-13-8.md) e [ADR-0006](adr/0006-jarvis-via-claude-cli.md).

## P2 — O Rust é dono de tudo que é nativo

Sistema operacional, processos, arquivos, git, PTY, áudio e HTTP para terceiros passam por comandos Tauri próprios. Não há plugin `fs` nem `shell`, e a CSP bloqueia outras origens na WebView.

Ver [ADR-0001](adr/0001-tauri-rust-desktop.md).

## P3 — Comandos finos, um módulo por domínio

Todo `#[tauri::command]` mora em `src-tauri/src/lib.rs` e só repassa para o módulo do domínio:
- o nome segue `<domínio>_<verbo>`;
- trabalho bloqueante vai por `blocking()`;
- o estado fica em um único `AppState`;
- eventos se chamam `domínio:evento`;
- fluxos longos usam `ipc::Channel`.

## P4 — Contratos espelhados TS ↔ Rust

Um tipo que cruza o IPC existe nos dois lados, e o TypeScript leva o comentário `Mirrors \`X\` in <caminho>`. O serde usa `rename_all = "camelCase"`. Enums com tag viram uniões discriminadas no TypeScript. Os códigos de erro sentinela (`model-missing`, `file-changed`, `voice-missing`) são compartilhados.

Ver [ADR-0009](adr/0009-tipos-espelhados-ts-rust.md).

## P5 — Persistência tolerante

Todo estado lido do disco passa por um `parse(raw: unknown)` que valida campo a campo e, na dúvida, usa o padrão. Dado velho ou corrompido nunca quebra a UI. Renomeações têm migração explícita (mapa `RENAMED`, chaves `jarvis.migrations.*`, `RETIRED_PHRASES`).

Ver [ADR-0010](adr/0010-persistencia-settings-vs-localstorage.md) e [persistence.md](../domain/persistence.md).

## P6 — Funciona fora do Tauri

Cada adaptador de backend escolhe um destes três caminhos:
1. um fallback de navegador;
2. um fake de desenvolvimento ligado por `window.__JARVIS_<X>__`, que só existe com `import.meta.env.DEV` e por isso nunca chega à produção;
3. uma mensagem clara ("Disponível no app desktop").

É isso que permite testar a UI inteira no Vite.

Ver [ADR-0011](adr/0011-fakes-de-dev-e-e2e-modo-web.md).

## P7 — PT-BR para o usuário, inglês no código

Ficam em PT-BR: texto da UI, aria-labels, mensagens de erro, frases de voz, persona e lições. Ficam em inglês: identificadores, comentários, títulos de teste e mensagens de commit.

Ver [ADR-0017](adr/0017-ui-pt-br-codigo-en.md).

## P8 — Linguagem visual única

As cores vêm dos tokens `hud-*` (`src/styles/globals.css`) e mudam em tempo de execução pelo tema. As janelas seguem o estilo TUI por padrão e usam o kit `src/lib/tui.ts` e `src/components/desktop/widgets/tui.tsx`. Nenhuma cor fica fixa no código fora do tema.

Ver [ADR-0014](adr/0014-linguagem-visual-tui.md).

## P9 — Desktop leve

- Há uma janela por `WindowKind`.
- Os apps carregam sob demanda, com pré-carregamento.
- O núcleo 2D é o padrão, e o 3D só carrega se for escolhido.
- Timers e polls param quando a janela está oculta, salvo quando há motivo, como um alerta pendente.

Ver [ADR-0012](adr/0012-apps-lazy-com-preload.md) e [ADR-0013](adr/0013-nucleo-2d-padrao.md).

## P10 — Segurança por confinamento

Nenhuma entrada vinda de voz, do JARVIS ou da UI vira linha de comando arbitrária:
- o JARVIS fica restrito a `Documentos\JARVIS`, sem ferramentas de shell;
- o servidor MCP aceita só `127.0.0.1`, exige token bearer e recusa `Origin`;
- caminhos de workspace e de git são validados;
- o terminal abre só perfis conhecidos;
- agentes rodam só via `claude --agent`.

Ver [ADR-0007](adr/0007-jarvis-confinado-a-documentos.md), [ADR-0008](adr/0008-mcp-http-in-process.md) e [security.md](security.md).

## P11 — Comportamento coberto por teste

- Todo comportamento visível tem um teste Playwright no modo web, e o spec precisa estar no `testMatch` do projeto `ui`.
- A lógica Rust tem testes `mod tests` dentro do próprio arquivo.
- Testes que dependem da máquina, de modelos ou da rede levam `#[ignore = "motivo"]`.

Ver [testing.md](testing.md).

## P12 — README mínimo, documentação em `.specs`

O README só traz logo, tecnologias, o que o app faz, requisitos e como rodar. O resto fica aqui: comportamento, contratos, atalhos, frases e decisões.

Ver [ADR-0016](adr/0016-readme-minimo-docs-em-specs.md).
