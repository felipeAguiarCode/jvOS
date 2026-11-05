# Vendor: Fonte VT323

O `@fontsource/vt323` empacota a fonte VT323, de terminal de texto antigo, que o jvOS usa no POST da tela de boot.

| | |
|---|---|
| **ID** | `vendor/vt323` |
| **Tipo** | Lib npm (fonte) |
| **Status** | Em uso |
| **Versão** | `@fontsource/vt323` 5.3.0 (declarada `^5.3.0`)<br>Só o subconjunto latino, peso 400: `vt323-latin-400-normal.woff2` (17.936 bytes) e `.woff` (9.752 bytes) |
| **Licença** | OFL-1.1 (Copyright 2011, The VT323 Project Authors) |
| **Fonte** | https://fontsource.org/fonts/vt323 (https://github.com/fontsource/font-files, pasta `fonts/google/vt323`) |
| **Onde roda** | build (o Vite copia os arquivos para `dist/assets`) · WebView2 (só na tela de boot) |

## Objetivo

A tela de boot imita o POST de uma BIOS antiga num monitor CRT, e precisa de uma fonte de modo texto que esteja sempre lá. A CSP de produção não permite fontes remotas, então a VT323 vem empacotada no app ([boot](../../../features/boot/spec.md), RNF-002). O [ADR-0014](../../../arch/adr/0014-linguagem-visual-tui.md) lista a VT323 no kit da linguagem visual TUI.

## Não-objetivos

- Sem os subconjuntos `latin-ext` e `vietnamese`: o jvOS importa só `@fontsource/vt323/latin.css`.
- Só o peso 400. A VT323 não tem outros.
- A VT323 não é a fonte das janelas TUI nem dos editores. Eles usam `--font-mono` (Cascadia Code, Consolas).
- Sem Google Fonts nem outra CDN.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o `npm run build`
- **Quando** olho `dist/assets`
- **Então** existem `vt323-latin-400-normal-*.woff2` (17.936 bytes) e `vt323-latin-400-normal-*.woff` (9.752 bytes), e o `index-*.css` tem `@font-face{font-family:VT323;font-style:normal;font-display:swap;font-weight:400;src:url(/assets/vt323-latin-400-normal-*.woff2)format("woff2"),…}`.

### Critério 2 (RF-003)

- **Dado** o boot ligado (`jarvis.boot` com `enabled: true`)
- **Quando** a tela de POST começa a "digitar"
- **Então** `document.fonts.check('1em "VT323"')` é `true`, e o texto do `data-testid="boot"`, com "BIOS Modular v0.1.0, Núcleo Holográfico", está em `font-bios`. Prova: `tests/boot.spec.ts`, "the BIOS runs its POST over two screens, comes to life with the emblem and a welcome, and reveals the hologram".

### Critério 3 (RF-003)

- **Dado** a fonte que não carrega (arquivo ausente ou corrompido)
- **Quando** o boot começa
- **Então** o POST começa mesmo assim, no máximo 1,5 s depois (`START_FALLBACK_MS`), na fonte seguinte de `--font-bios`, que é `var(--font-mono)` (Cascadia Code, Consolas).

### Critério 4 (RNF-001)

- **Dado** o `dist/` de um build
- **Quando** procuro arquivos `vt323-latin-ext-*` e `vt323-vietnamese-*`
- **Então** não há nenhum. Os caracteres do boot (ASCII, os acentos do português, `·`, `°` e `…`) estão nas faixas do subconjunto latino (`U+0000-00FF` e `U+2000-206F`, em `unicode.json`).

### Critério 5 (RF-002)

- **Dado** o boot desligado (o padrão dos testes, `{"enabled":false}`)
- **Quando** o jvOS abre
- **Então** nenhum pedido a `vt323-latin-400-normal` sai: o `@font-face` está no CSS, mas só a tela de boot usa `font-bios` e chama `document.fonts.load`. Conferência manual pela lista de requisições do Playwright.

## Casos de borda

- **Vazio/nulo:** a fonte falha ou demora → o POST começa em 1,5 s com a fonte de reserva (critério 3). `document.fonts.load` resolve ou rejeita, e os dois caminhos marcam `fontReady`.
- **Duplicidade/idempotência:**
  - o `@font-face` sai uma vez no CSS, porque só `BootSequence.tsx` importa `latin.css`;
  - importar também `@fontsource/vt323` (o `index.css`) somaria os subconjuntos `latin-ext` e `vietnamese` com `unicode-range`. Hoje o `latin.css` não tem `unicode-range` e vale para todo caractere que a fonte tem.
- **Concorrência/corrida:**
  - o boot espera duas coisas: o primeiro quadro do núcleo (`started`) e a fonte (`fontReady`). Começa quando as duas chegam, ou aos 1,5 s;
  - se o boot desmontar antes de a fonte carregar, a flag `live` ignora a resposta.
- **Permissões/visibilidade:**
  - a CSP de produção não tem `font-src`, então vale `default-src 'self'`: só fontes do próprio app;
  - OFL-1.1: a fonte pode ir embutida e ser redistribuída com o app, mas não pode ser vendida sozinha. O `LICENSE` acompanha o pacote em `node_modules/@fontsource/vt323/LICENSE`.

## Uso no jvOS

### Import da fonte (`src/components/BootSequence.tsx`)

O import é só de efeito colateral (`import "@fontsource/vt323/latin.css"`), e por isso o pacote não aparece como "importado" numa busca por símbolos.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE importar só `@fontsource/vt323/latin.css`, uma vez, em `BootSequence.tsx`. O Vite põe o `@font-face` no `index-*.css` (o `App` importa o `BootSequence` de forma estática) e copia o `.woff2` e o `.woff` para `dist/assets`.

### Token `--font-bios` (`src/styles/globals.css`)

- **Comportamento:**
  - **RF-002**: O `@theme` DEVE definir `--font-bios: "VT323", var(--font-mono)`, o que gera a classe `font-bios`. Hoje só a tela do POST usa essa classe, em `clamp(15px, 2.8vh, 34px)` com `leading-[1.2]`, `crt-text` e `crt-flicker`.

### Pré-carga antes do POST (`BootSequence`)

- **Comportamento:**
  - **RF-003**: O boot DEVE ler `document.fonts.check('1em "VT323"')` no primeiro render e chamar `document.fonts.load('1em "VT323"')`. Ele só começa a "digitar" quando a fonte e o primeiro quadro do núcleo chegaram, ou depois de `START_FALLBACK_MS` (1500 ms).

## Restrições

- **RNF-001**: Só o subconjunto latino (`U+0000-00FF`, `U+2000-206F` e alguns sinais), peso 400: 17.936 bytes em `.woff2`. O `.woff` de 9.752 bytes também vai para o `dist/`, mas a WebView2 usa o `.woff2`.
- **RNF-002**: Fonte local por causa da CSP, sem rede.
- **RNF-003**: `font-display: swap`. A pré-carga do boot evita que o POST comece na fonte de reserva.
- **RNF-004**: Licença OFL-1.1, diferente do resto do front-end (MIT, ISC, Apache-2.0).

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/BootSequence.tsx` | `import "@fontsource/vt323/latin.css"`, `BIOS_FONT`, `fontReady`, `START_FALLBACK_MS` |
| `src/styles/globals.css` | `--font-bios: "VT323", var(--font-mono)` |
| `src-tauri/tauri.conf.json` | A CSP sem `font-src` |
| `node_modules/@fontsource/vt323/latin.css` | O `@font-face` do subconjunto latino |

### Testes

- `npm run build` e `ls dist/assets | grep vt323` (critérios 1 e 4).
- `npx playwright test tests/boot.spec.ts` (critério 2).
- `npx playwright test tests/core.spec.ts`: "with the core in 2D (the default), the boot screen still plays and hands over".
- Manual: renomear o `.woff2` em `node_modules` e ver o POST começar em 1,5 s na Cascadia (critério 3); listar as requisições com o boot desligado (critério 5).

### Atualização e reversão

- **Comando:** `npm i @fontsource/vt323@<versão>`.
- **Prova:** `npm run build` com os dois arquivos `vt323-latin-400-normal-*` em `dist/assets`; `npx playwright test tests/boot.spec.ts`; olhar a captura do POST.
- **Sinal de volta:** o nome do arquivo ou do subconjunto muda e o import `@fontsource/vt323/latin.css` quebra o build; o POST começa na Cascadia; as colunas alinhadas do POST (`LABEL_WIDTH`, `PCI_COLUMNS`) desalinham.
- **Reversão:** `npm i @fontsource/vt323@5.3.0`.

### Decisões relacionadas

- [ADR-0014 — Linguagem visual TUI](../../../arch/adr/0014-linguagem-visual-tui.md)

## Dependências

- **Vendor:** [vite-typescript](../vite-typescript/spec.md) (copia os arquivos da fonte), [tailwind](../tailwind/spec.md) (o token `--font-bios` vira a classe `font-bios`), [tauri](../tauri/spec.md) (a CSP).
- **Specs:** [boot](../../../features/boot/spec.md), [appearance](../../../features/appearance/spec.md).
- **Sistema:** Cascadia Code ou Consolas do Windows, a reserva de `--font-mono`.

## Pendências

- [ ] O [ADR-0014](../../../arch/adr/0014-linguagem-visual-tui.md) põe a "fonte VT323" no kit TUI, mas no código só a tela de boot (`BootSequence.tsx`) usa `font-bios`. As janelas TUI usam `--font-mono`.
