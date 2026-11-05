# ADR-0011: Fakes de desenvolvimento nos adaptadores; E2E no modo web; app real via CDP

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-21 (CDP) · 2026-10-23 em diante (fakes) |
| **Origem** | prática observada; memórias `desktop-app-e2e-via-cdp` e `jarvis-playwright-workflow` |

## Contexto

O app real depende do Rust, de microfone, modelos, `claude.exe`, git, rede e PTY. Nada disso roda num navegador de teste, e rodar o Tauri a cada teste é lento, além de mexer no `settings.json` real do usuário. Mesmo assim, quase todo o comportamento visível é React.

## Decisão

- **Adaptadores** em `src/lib/` escolhem entre:
  - `tauriBackend`, quando `isTauri()`;
  - um **fake de DEV** ativado por `window.__JARVIS_<X>__`, que só existe com `import.meta.env.DEV` e grava chamadas em `__JARVIS_<X>_LOG__`;
  - um fallback de navegador ou a mensagem "Disponível no app desktop".
- **Playwright** roda contra `npm run dev:web` no Edge, com 3 projetos (`ui`, `voice`, `voice-denied`). Os specs ligam os fakes com `addInitScript`. **Não se mocka `invoke`.**
- O app expõe `window.__JARVIS__` (frames, `hear`, `ask`, `voiceWindow`, `action`…) para os testes dirigirem e observarem.
- O **app real** é testado à mão via CDP na WebView2 (`--remote-debugging-port=9333`) quando a mudança toca o motor de voz ou a persistência das settings.
- O **Rust** tem testes inline. Os que dependem da máquina levam `#[ignore]`.

## Consequências

- **Positivas:**
  - a suíte cobre a UI inteira sem Rust;
  - os fakes servem também para desenvolver a UI no navegador;
  - nada de fake vai para produção.
- **Negativas:**
  - a integração UI↔Rust (nomes de comando, formas de payload) só é exercitada no app real, que não tem automação;
  - os fakes precisam acompanhar o contrato à mão.
- **Regras:**
  - comando novo = adaptador com fake ou fallback;
  - spec novo precisa entrar no `testMatch` do projeto `ui`;
  - armadilhas conhecidas em [testing](../testing.md#armadilhas-conhecidas).

## Alternativas consideradas

Mockar `invoke` globalmente nos testes: não adotado. Nenhum registro do motivo.

## Referências

- `playwright.config.ts`, `tests/helpers.ts`, `src/lib/assistant.ts`, `src/lib/workspace.ts`, `src/lib/workspaceFake.ts`
- [testing](../testing.md)
