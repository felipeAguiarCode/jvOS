# Vendor: Vite e TypeScript

O Vite serve a UI em desenvolvimento e gera o `dist/` do app, e o TypeScript é o único gate estático do front-end (`npm run build`).

| | |
|---|---|
| **ID** | `vendor/vite-typescript` |
| **Tipo** | Lib npm |
| **Status** | Em uso |
| **Versão** | `vite` 8.3.4 (declarada `^8.0.16`, dev)<br>`@vitejs/plugin-react` 6.1.2 (declarada `^6.0.2`, dev)<br>`typescript` 6.0.3 (declarada `~6.0.3`, dev)<br>`@types/node` 22.20.5 (declarada `^22.20.5`, dev) |
| **Licença** | MIT (`vite`, `@vitejs/plugin-react`, `@types/node`) · Apache-2.0 (`typescript`) |
| **Fonte** | https://vite.dev · https://github.com/vitejs/vite-plugin-react · https://www.typescriptlang.org · https://github.com/DefinitelyTyped/DefinitelyTyped (`@types/node`) |
| **Onde roda** | build e desenvolvimento (Node) · servidor de dev em `:1420`, usado pelo `tauri dev` e pelo Playwright |

## Objetivo

O jvOS precisa de um servidor de desenvolvimento com recarga rápida para a WebView2 do `tauri dev` e para o Playwright no modo web ([ADR-0011](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)), e de um build que corte os apps em chunks sob demanda ([ADR-0012](../../../arch/adr/0012-apps-lazy-com-preload.md)). O TypeScript estrito é a única checagem estática, porque não há linter. Por que o Vite e não outro bundler não está registrado (⚠ inferido — confirmar: é o padrão do template do Tauri, de onde vêm os comentários do `vite.config.ts`).

## Não-objetivos

- Sem linter nem formatador. O `tsc` estrito do `npm run build` é o único gate ([coding-style](../../../arch/coding-style.md)).
- Sem aliases de caminho: nem `resolve.alias` no `vite.config.ts` nem `paths` no `tsconfig.json`. Os imports são relativos.
- Sem Babel, esbuild ou React Compiler instalados. O `@vitejs/plugin-react` 6.1.2 depende só de `@rolldown/pluginutils`.
- O `tsc` não emite nada (`noEmit`): quem transpila é o Vite.
- Sem SSR, modo biblioteca ou `vite preview` no fluxo do app. O script `preview` existe, mas o Tauri usa `dev:web` e `build`.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o código de `src/` sem erros de tipo
- **Quando** rodo `npm run build`
- **Então** o `tsc` passa e o `vite build` gera `dist/index.html`, `dist/assets/index-*.js`, `dist/assets/index-*.css` e os chunks lazy, sem o aviso de chunk grande: o maior, `JarvisScene-*.js` (1.044.572 bytes no build de 04/11), fica abaixo de `chunkSizeWarningLimit: 1100` kB.

### Critério 2 (RF-006)

- **Dado** um erro de tipo em qualquer arquivo de `src/`
- **Quando** rodo `npm run build`
- **Então** o `tsc` sai com erro, o `vite build` não roda (`tsc && vite build`) e o `dist/` fica como estava.

### Critério 3 (RF-002)

- **Dado** a porta 1420 livre
- **Quando** rodo `npm run dev:web`
- **Então** `http://localhost:1420` responde com `<title>JARVIS OS</title>`. Com a porta ocupada por outro processo, o Vite falha com "Port 1420 is already in use" em vez de pular para a 1421 (`strictPort: true`).

### Critério 4 (RF-003)

- **Dado** o boot ligado e o `npm run dev:web` (o npm define `npm_package_version`)
- **Quando** a tela de POST aparece
- **Então** ela mostra "BIOS Modular v0.1.0, Núcleo Holográfico", com a versão do `package.json` injetada em `__APP_VERSION__`. Prova: `tests/boot.spec.ts` espera `/BIOS Modular v\d+\.\d+\.\d+/`.

### Critério 5 (RF-004)

- **Dado** o `dist/` de um `npm run build`
- **Quando** procuro `__JARVIS_` em `dist/assets/*.js`
- **Então** não aparece nenhum fake ligado por `import.meta.env.DEV` (`__JARVIS_ASSISTANT__`, `__JARVIS_TERMINAL__`, `__JARVIS_FS__`…) nem o `window.__JARVIS__`, porque o Vite troca `import.meta.env.DEV` por `false` e o código morto sai. A exceção hoje é `__JARVIS_GPUS__` (ver Pendências).

### Critério 6 (RF-005)

- **Dado** o `npm run dev:web` rodando
- **Quando** edito `src-tauri/voice-commands.json`, que a UI importa
- **Então** a UI só recebe a mudança depois de `touch vite.config.ts`, porque o watcher ignora `**/src-tauri/**` e `**/t/**`.

## Casos de borda

- **Vazio/nulo:** o build rodado fora do npm (`npx vite build`) não tem `npm_package_version` → `__APP_VERSION__` vira `"0.0.0"` e o boot mostra "BIOS Modular v0.0.0". O `npm run tauri build` passa pelo `beforeBuildCommand` (`npm run build`) e não tem esse problema.
- **Duplicidade/idempotência:**
  - o Vite já aberto em `:1420` com o título "JARVIS OS" → o `npm run dev` o reaproveita (`scripts/tauri.mjs` zera o `beforeDevCommand`);
  - um segundo `npm run dev:web` → falha pela porta ocupada (critério 3);
  - o Playwright reaproveita qualquer servidor em `:1420` (`reuseExistingServer: true`), inclusive o do `tauri dev` do usuário.
- **Concorrência/corrida:**
  - editar um módulo servido enquanto o Playwright roda dispara o HMR e recarrega a página de teste;
  - depois de um `npm install`, o primeiro import de uma dependência nova pode deixar o servidor respondendo 504 "Outdated Optimize Dep". `touch vite.config.ts` reinicia o Vite no lugar ([armadilhas](../../../arch/testing.md#armadilhas-conhecidas)).
- **Permissões/visibilidade:**
  - o `node_modules` traz binários nativos de Windows x64 (`@rolldown/binding-win32-x64-msvc`, `@tailwindcss/oxide-win32-x64-msvc`): uma cópia vinda de outro SO ou arquitetura não roda, e é preciso reinstalar;
  - o servidor só escuta em `localhost` (`host: false`), salvo com `TAURI_DEV_HOST`, que também liga o HMR na porta 1421;
  - a CSP de produção (`script-src 'self'`) não aceita script inline, e o `devCsp: null` desliga a CSP só no dev.

## Uso no jvOS

### Configuração do Vite (`vite.config.ts`)

Liga os plugins, a constante de versão, o alvo do build e o servidor fixo do Tauri.

- **Comportamento:**
  - **RF-001**: O build DEVE usar `plugins: [react(), tailwindcss()]`, `build.target: "chrome120"` (a WebView2 e o Edge dos testes são Chromium evergreen) e `chunkSizeWarningLimit: 1100`, o tamanho do chunk do 3D com folga.
  - **RF-002**: O servidor DEVE escutar na porta 1420 com `strictPort: true` e `clearScreen: false`, para o `tauri dev` achar o `devUrl` e não esconder os erros do Rust.
  - **RF-003**: O Vite DEVE injetar `__APP_VERSION__` a partir de `process.env.npm_package_version`, com `"0.0.0"` quando não houver. O tipo está em `src/vite-env.d.ts`.
  - **RF-005**: O watcher DEVE ignorar `**/src-tauri/**` e `**/t/**` (a pasta de build do Cargo).

### Recursos do Vite no código (`src/`)

- **Comportamento:**
  - **RF-004**: Os fakes de DEV e o `window.__JARVIS__` DEVEM ficar atrás de `import.meta.env.DEV`, para sumirem do build ([ADR-0011](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)).
  - Cada `import()` dinâmico vira um chunk: os apps de `lazyApps.tsx`, o `JarvisScene`, o `AssistantHistory`, o editor do jv_agent e cada linguagem do `@codemirror/language-data`.
  - As lições do jv_lab entram com `import.meta.glob("…/lessons/*.md", { query: "?raw", import: "default", eager: true })` (`lessonText.ts`).
  - `src/lib/settings.ts` importa `src-tauri/voice-commands.json` direto (`resolveJsonModule`).
  - CSS de pacotes entra por import: `@xterm/xterm/css/xterm.css` e `@fontsource/vt323/latin.css`.

### TypeScript (`tsconfig.json`, `tsconfig.node.json`)

- **Comportamento:**
  - **RF-006**: O `tsc` DEVE checar `src/` com `strict`, `noUnusedLocals`, `noUnusedParameters` e `noFallthroughCasesInSwitch`, em `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `isolatedModules` e `noEmit`. O `target` e o `lib` são ES2020 + DOM.
  - `tsconfig.node.json` (`composite`) cobre só o `vite.config.ts` e é referenciado pelo `tsconfig.json`.
  - `@types/node` dá os tipos de `node:process` no `vite.config.ts` e de `node:*` em `tests/lab-engine.spec.ts` e `demos/`.

### Ligação com o Tauri e o Playwright (`src-tauri/tauri.conf.json`, `scripts/tauri.mjs`, `playwright.config.ts`)

- **Comportamento:**
  - O `tauri.conf.json` usa `beforeDevCommand: "npm run dev:web"`, `devUrl: "http://localhost:1420"`, `beforeBuildCommand: "npm run build"` e `frontendDist: "../dist"`.
  - Se o `npm run dev` achar o Vite do JARVIS já respondendo em `:1420`, então o `scripts/tauri.mjs` passa `--config {"build":{"beforeDevCommand":""}}` e o reaproveita.
  - O `webServer` do Playwright sobe `npm run dev:web` e espera até 60 s por `http://localhost:1420`.

## Restrições

- **RNF-001**: `vite` 8.3.4 e `@vitejs/plugin-react` 6.1.2 exigem Node `^20.19.0 || >=22.12.0` (`engines`). Esta máquina roda Node 24.22.2 e npm 11.19.1.
- **RNF-002**: `typescript` fica travado no minor 6.0 (`~6.0.3`). O motivo não está escrito (⚠ inferido — confirmar: um minor novo do TypeScript pode trazer erros novos no gate).
- **RNF-003**: O build mira `chrome120`. A WebView2 desta máquina é a 156.0.4314.58.
- **RNF-004**: O build de 04/11 gerou 142 arquivos em `dist/assets`: `index-*.js` com 694.544 bytes, `index-*.css` com 95.376 bytes e `JarvisScene-*.js` com 1.044.572 bytes, o maior.
- **RNF-005**: Porta 1420 fixa; HMR na 1421 só com `TAURI_DEV_HOST`.
- **RNF-006**: Licenças MIT e Apache-2.0. Nada disso vai no instalador: são ferramentas de build.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `vite.config.ts` | Plugins, `__APP_VERSION__`, `chrome120`, limite de chunk, porta 1420, watcher |
| `tsconfig.json` | Opções do `tsc` para `src/` |
| `tsconfig.node.json` | Projeto do `vite.config.ts` |
| `src/vite-env.d.ts` | `vite/client` e a declaração de `__APP_VERSION__` |
| `index.html` | Entrada (`/src/main.tsx`), `lang="pt-BR"`, título "JARVIS OS" |
| `package.json` | `dev:web` (`vite`), `build` (`tsc && vite build`), `preview` |
| `src-tauri/tauri.conf.json` | `beforeDevCommand`, `devUrl`, `beforeBuildCommand`, `frontendDist` |
| `scripts/tauri.mjs` | Reaproveita o Vite já aberto em `:1420` |
| `src/components/desktop/apps/lab/lessonText.ts` | `import.meta.glob` com `?raw` |

### Testes

- `npm run build`: o `tsc` e o build (critérios 1 e 2).
- `npm run dev:web` e `curl -s http://localhost:1420/`: o título "JARVIS OS" e a porta fixa (critério 3).
- `npx playwright test tests/boot.spec.ts`: a versão no POST (critério 4).
- `npm run build` e depois `grep -o "__JARVIS_[A-Z_]*" dist/assets/*.js`: os fakes fora do bundle (critério 5).
- Manual: editar `src-tauri/voice-commands.json` com o `dev:web` rodando e conferir que só `touch vite.config.ts` traz a mudança (critério 6).
- `npx tsc --listFilesOnly`: mostra o que o gate cobre (ver Pendências).

### Atualização e reversão

- **Comando:** `npm i -D vite@<versão> @vitejs/plugin-react@<versão>`; `npm i -D typescript@~<versão>`. Depois, reinicie o `npm run dev:web`.
- **Prova:** `npm run build` sem erro e sem aviso de chunk; `npm test`; `npm run dev` abrindo o app em `:1420`; `npm ls @tailwindcss/vite` sem `invalid` (o peer dele aceita `vite ^5.2.0 || ^6 || ^7 || ^8`).
- **Sinal de volta:** erros novos do `tsc` em código que não mudou; aviso de chunk acima de 1100 kB; HMR quebrado no `tauri dev`; peer `invalid` do `@tailwindcss/vite`.
- **Reversão:** `npm i -D vite@8.3.4 @vitejs/plugin-react@6.1.2 typescript@6.0.3 @types/node@22.20.5`, ou o `package-lock.json` anterior com `npm ci`.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0011 — Fakes de DEV, E2E no modo web](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0012 — Apps lazy com preload](../../../arch/adr/0012-apps-lazy-com-preload.md)

## Dependências

- **Vendor:** [react](../react/spec.md) (`@vitejs/plugin-react`), [tailwind](../tailwind/spec.md) (`@tailwindcss/vite`), [tauri](../tauri/spec.md) (`devUrl`, `beforeBuildCommand`), [playwright](../playwright/spec.md) (`webServer`), [codemirror](../codemirror/spec.md) e [vt323](../vt323/spec.md) (assets e chunks que o build emite).
- **Specs:** [boot](../../../features/boot/spec.md) (versão no POST), [jv_lab](../../../apps/jv_lab/spec.md) (lições por `import.meta.glob`), [voice-commands](../../../features/voice-commands/spec.md) (o JSON importado), [stack](../../stack/spec.md), [build-and-env](../../../arch/build-and-env.md).
- **Sistema:** Node.js 22.12 ou mais novo, npm, porta 1420 livre.

## Pendências

- [ ] O `npm run build` roda `tsc` sem `-b`, então o `tsconfig.node.json` referenciado não é checado: `npx tsc --listFilesOnly` não lista o `vite.config.ts`. O mesmo vale para `playwright.config.ts`, `tests/` e `demos/`, fora do `include` (`src`).
- [ ] O README pede "Node.js 22+", mas o `vite` 8.3.4 exige `^20.19.0 || >=22.12.0`: um Node 22.0 a 22.11 passa pelo README e falha no Vite.
- [ ] `__JARVIS_GPUS__` (`src/lib/settings.ts`, `loadVoiceDevices`) não fica atrás de `import.meta.env.DEV` e aparece em `dist/assets/index-*.js` (build de 04/11), ao contrário da regra do [ADR-0011](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md).
