# Vendor: xterm.js e portable-pty

O xterm.js desenha os terminais do jvOS na WebView2, e o `portable-pty` abre os shells de verdade num pseudoconsole (ConPTY) dentro do processo Rust.

| | |
|---|---|
| **ID** | `vendor/terminal` |
| **Tipo** | Lib npm · Crate Rust |
| **Status** | Em uso |
| **Versão** | `@xterm/xterm` 6.0.0 (declarada `^6.0.0`)<br>`@xterm/addon-fit` 0.11.0 (declarada `^0.11.0`)<br>`portable-pty` 0.9.0 (declarada `"0.9"`, em `src-tauri/Cargo.toml`) |
| **Licença** | MIT (os três) |
| **Fonte** | https://github.com/xtermjs/xterm.js (xterm e `addon-fit`) · https://github.com/wezterm/wezterm (`portable-pty`, publicado no crates.io) |
| **Onde roda** | WebView2 (xterm) · processo Rust (`portable-pty` sobre o ConPTY do Windows) · processos filhos (os shells) |

## Objetivo

O jvOS abre os shells reais do usuário (os perfis do Windows Terminal) em janelas próprias: o jv_sh, o painel de terminal do jv_ide e as execuções de agente do jv_agent (`claude --agent`). O jv_lab usa o mesmo xterm com um backend simulado. O [ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md) põe o ConPTY dentro do processo Rust, e o princípio P2 diz que todo processo passa pelo Rust. Por que estas duas bibliotecas não está registrado (⚠ inferido — confirmar).

## Não-objetivos

- Sem `@xterm/addon-webgl` nem renderizador em canvas: o xterm usa o renderizador DOM padrão. Pelo [ADR-0022](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md), nada fora do núcleo 3D cria contexto WebGL.
- Sem `addon-search`, `addon-web-links`, `addon-unicode11` e `addon-serialize`: não há busca na saída, links clicáveis nem histórico salvo entre sessões.
- A UI nunca manda uma linha de comando. `terminal_open` recebe o id de um perfil, e `terminal_open_agent` só monta `claude --agent <nome> "<tarefa>"` ([security](../../../arch/security.md)).
- O suporte a portas seriais do `portable-pty` (`serial2`) não é usado.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o modo web com o fake `__JARVIS_TERMINAL__`
- **Quando** abro o Terminal pelo dock e digito
- **Então** o jv_sh abre no perfil padrão, a saída "(simulado)" aparece no xterm e o que digito chega à sessão (`eco: …`). Prova: `tests/shell.spec.ts`, "the dock's Terminal opens jv_sh on the default profile, and what is typed reaches the shell".

### Critério 2 (RF-003)

- **Dado** uma aba do jv_sh aberta
- **Quando** maximizo a janela pelo botão ou por duplo clique
- **Então**, depois de 60 ms sem mudança de tamanho, o `FitAddon` reajusta o xterm e o shell recebe o novo número de colunas e linhas (`terminal_resize`). Prova: `tests/shell.spec.ts`, "maximised by its button or a double click, the shell learns its new size".

### Critério 3 (RF-002)

- **Dado** o Rust compilado (`CMAKE` e `LIBCLANG_PATH` exportados) e o `cmd.exe` no Windows
- **Quando** rodo `cargo test --lib -- terminal::tests::runs_a_shell_in_a_pseudoconsole` em `src-tauri`
- **Então** a saída tem "jarvis-pty", o código de saída é 0, e um `write` depois do fim falha com "Sessão encerrada".

### Critério 4 (RF-004)

- **Dado** um shell que termina com código de erro
- **Quando** o processo sai
- **Então** o xterm escreve "[processo encerrado: código N]" e a aba fica aberta. Um `exit` limpo fecha a aba, e a última aba fecha a janela. Prova: `tests/shell.spec.ts`, "exit closes its tab; an error code keeps it; the last tab closes the window".

### Critério 5 (RF-006)

- **Dado** o app desktop rodando
- **Quando** a UI chama `terminal_open` com um id que não está nos perfis
- **Então** o comando falha com "Perfil não encontrado" e nenhum processo nasce. Conferência manual pelo CDP (`__TAURI_INTERNALS__.invoke("terminal_open", { profile: "x", cols: 80, rows: 24 })`).

### Critério 6 (RF-002)

- **Dado** um caractere UTF-8 de vários bytes cortado entre duas leituras do pseudoconsole
- **Quando** rodo `cargo test --lib -- terminal::tests::keeps_characters_cut_between_reads`
- **Então** o teste passa: `decode_utf8` guarda os bytes incompletos para a leitura seguinte, e o caractere chega inteiro.

### Critério 7 (RF-005)

- **Dado** o jv_sh com várias abas
- **Quando** clico no × da janela
- **Então** a janela fecha e cada shell recebe `terminal_close`. Ao sair do JARVIS, `close_all` mata os que sobraram. Prova: `tests/shell.spec.ts`, "the terminal keeps the keyboard; the × closes the window and every shell".

## Casos de borda

- **Vazio/nulo:**
  - sem o `settings.json` do Windows Terminal, `fallback_profiles()` monta "PowerShell" (`pwsh.exe`), "Windows PowerShell", "Prompt de comando", "Git Bash" e "WSL" com o que achar no `PATH`;
  - perfil sem comando → "Perfil sem comando"; programa que não abre → "Não foi possível iniciar <perfil>: …", escrito em vermelho no xterm;
  - no navegador sem fake, `terminalBackend()` é `null` e o jv_sh mostra "Disponível no app desktop".
- **Duplicidade/idempotência:**
  - o StrictMode monta o `TerminalView` duas vezes em DEV; o shell que perdeu a corrida é fechado na hora (`started.close()`);
  - fechar uma sessão já encerrada não faz nada: ela já saiu do mapa;
  - os terminais do jv_ide e as abas do jv_sh são sessões separadas, cada uma com o seu id.
- **Concorrência/corrida:**
  - cada sessão tem uma thread que lê a saída em blocos de 64 KiB e outra que espera o fim. A segunda espera 150 ms (`DRAIN_MS`) antes de emitir `terminal:exit`, para a última saída chegar antes;
  - a saída pode chegar antes de a UI saber o id da sessão. O roteador segura a saída de uma sessão ainda não reclamada por até 10 s (`HOLD_MS`), com no máximo 256 Ki caracteres (`HOLD_CHARS`);
  - as sessões ficam num `Mutex<HashMap<u32, Session>>`, e os eventos levam o `id`, então várias abas dividem o mesmo canal.
- **Permissões/visibilidade:**
  - só perfis conhecidos abrem (P10). O `cwd` passa por `start_dir`, e a tarefa de um agente perde aspas e quebras de linha;
  - o `portable-pty` prefere um `conpty.dll` achado na busca de DLLs e, sem ele, usa o ConPTY do `kernel32.dll`;
  - colar usa `navigator.clipboard.readText()`. Se a WebView negar, a colagem falha em silêncio (o erro é ignorado).

## Uso no jvOS

### Vista do terminal (`src/components/desktop/apps/terminal/TerminalView.tsx`)

Um xterm ligado a uma sessão, usado pelo jv_sh, pelo painel do jv_ide e pelo jv_lab.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE criar o xterm com `fontFamily` de `--font-mono`, `fontSize: 13`, `cursorBlink`, `allowTransparency`, `scrollback: 5000` e a paleta lida dos `--color-hud-*`, com o `FitAddon` carregado. As teclas vão por `onData` para `backend.write`, e o título OSC por `onTitleChange`.
  - **RF-003**: Um `ResizeObserver` com 60 ms de debounce DEVE chamar `fit()` e avisar o shell só quando colunas ou linhas mudam. Uma aba escondida não mede (`offsetParent`) e se ajusta ao voltar à frente.
  - O botão direito copia a seleção ou, sem seleção, cola, como no Windows Terminal. Um `MutationObserver` recolore o xterm quando o tema ou o acento TUI mudam.
  - Desmontar fecha o shell e chama `terminal.dispose()`.

### Adaptador (`src/lib/terminal.ts`)

- **Comportamento:**
  - O backend do Tauri usa os comandos `terminal_profiles`, `terminal_open`, `terminal_open_agent`, `terminal_write`, `terminal_resize` e `terminal_close`, e os eventos `terminal:output` e `terminal:exit`.
  - Em DEV, `__JARVIS_TERMINAL__` liga um fake que faz eco. O jv_lab passa o próprio `labBackend`, que roda a lição na página.

### Sessões no Rust (`src-tauri/src/terminal.rs`)

- **Comportamento:**
  - **RF-002**: O Rust DEVE abrir cada sessão com `native_pty_system().openpty(PtySize)`, com colunas limitadas a 10–1000 e linhas a 2–500, e iniciar o perfil com `CommandBuilder` e as variáveis `TERM=xterm-256color`, `COLORTERM=truecolor`, `CHERE_INVOKING=1` e `JARVIS_*`. A saída é decodificada como UTF-8 sem cortar caracteres.
  - **RF-004**: Quando o processo sai, o Rust DEVE tirar a sessão do mapa e emitir o código de saída. Escrever ou redimensionar uma sessão encerrada responde "Sessão encerrada".
  - **RF-005**: `close(id)` DEVE matar o shell pelo `ChildKiller`, e `close_all()` DEVE matar todos quando o JARVIS sai.

### Comandos (`src-tauri/src/lib.rs`)

- **Comportamento:**
  - **RF-006**: `terminal_open` DEVE achar o perfil pelo id em `terminal::profiles()` (o `settings.json` do Windows Terminal ou a reserva) e recusar o resto com "Perfil não encontrado". `terminal_open_agent` só roda um agente instalado.

## Restrições

- **RNF-001**: O ConPTY exige o Windows 10 de outubro de 2018 ou mais novo (mensagem do `portable-pty` ao não achar a API). O alvo do jvOS é o Windows 11.
- **RNF-002**: Números fixos: 5000 linhas de histórico, fonte 13, 60 ms de debounce no resize, blocos de leitura de 64 KiB, 150 ms de dreno na saída.
- **RNF-003**: O xterm carrega sob demanda: `TerminalView-*.js` com 335.299 bytes e `TerminalView-*.css` com 3.529 bytes no build de 04/11, só com o jv_sh, o primeiro terminal do jv_ide ou a primeira lição do jv_lab.
- **RNF-004**: O `portable-pty` 0.9.0 traz `winapi` 0.3.9, `winreg` 0.10.1, `nix` 0.28.0, `serial2` 0.2.38 e `shell-words` 1.1.1 (`cargo tree -p portable-pty --depth 1`).
- **RNF-005**: Licença MIT nas três peças.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/desktop/apps/terminal/TerminalView.tsx` | xterm + `FitAddon`, tema, resize, copiar e colar, título OSC |
| `src/components/desktop/apps/ShellApp.tsx` | jv_sh: abas por perfil, atalhos, "Disponível no app desktop" |
| `src/components/desktop/apps/ide/TerminalPanel.tsx` | Terminal do jv_ide, lazy, na pasta do projeto |
| `src/components/desktop/apps/lab/LessonLab.tsx` · `src/lib/lab/backend.ts` | Terminal simulado do jv_lab |
| `src/lib/terminal.ts` | Backends (Tauri, fake de DEV), roteador de sessões, `HOLD_MS` |
| `src-tauri/src/terminal.rs` | `Terminals`, `Profile`, perfis do Windows Terminal, `decode_utf8`, jvfetch |
| `src-tauri/src/lib.rs` | `terminal_*`, eventos `terminal:output` e `terminal:exit`, `close_all` na saída |

### Testes

- `npx playwright test tests/shell.spec.ts`: 6 testes do jv_sh com o fake (critérios 1, 2, 4 e 7).
- `npx playwright test tests/ide.spec.ts`: "the terminal panel opens a shell in the project, keeps its keys and never mixes with jv_sh".
- `npx playwright test tests/lab.spec.ts`: o xterm com o backend simulado.
- `cargo test --lib -- terminal::` em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados ([build-and-env](../../../arch/build-and-env.md)): perfis, linhas de comando, WSL, UTF-8 e shells reais (critérios 3 e 6).
- `cargo test --lib -- --ignored terminal::`: os dois testes com os perfis desta máquina.
- Manual pelo CDP: critério 5.

### Atualização e reversão

- **Comando:** `npm i @xterm/xterm@<versão> @xterm/addon-fit@<versão>`; `cargo update -p portable-pty --precise <versão>` em `src-tauri`.
- **Prova:** `npm run build`; `shell.spec.ts`, `ide.spec.ts` e `lab.spec.ts`; `cargo test --lib -- terminal::`; abrir PowerShell, cmd, Git Bash e WSL no app real e redimensionar.
- **Sinal de volta:** o `fit()` erra o tamanho; o xterm perde a transparência ou o tema; caracteres acentuados quebrados; o shell não recebe o resize; o `cargo test` dos pseudoconsoles trava.
- **Reversão:** `npm i @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`; `cargo update -p portable-pty --precise 0.9.0`.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0011 — Fakes de DEV, E2E no modo web](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0012 — Apps lazy com preload](../../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0022 — Núcleo com relógio de quadros limitado, canvas 3D recortado e UI em D3D11](../../../arch/adr/0022-nucleo-relogio-quadros-limitado-canvas-3.md)

## Dependências

- **Vendor:** [tauri](../tauri/spec.md) (comandos e eventos), [react](../react/spec.md), [tailwind](../tailwind/spec.md) (a paleta `--color-hud-*` e `--font-mono`), [serde](../serde/spec.md) (`Profile`, `Profiles`, leitura do `settings.json`), [workspace-fs](../workspace-fs/spec.md) (`dunce` em `terminal.rs`), [claude-code](../claude-code/spec.md) (`claude --agent`).
- **Specs:** [jv_sh](../../../apps/jv_sh/spec.md), [jv_ide](../../../apps/jv_ide/spec.md), [jv_lab](../../../apps/jv_lab/spec.md), [jv_agent](../../../apps/jv_agent/spec.md), [security](../../../arch/security.md).
- **Sistema:** ConPTY do Windows; os shells instalados (PowerShell, cmd, Git Bash, WSL); o `settings.json` do Windows Terminal, se houver.

## Pendências

- [ ] A paleta do xterm em `readTheme` (`TerminalView.tsx`) só segue o tema em texto, cursor, seleção, azul, ciano, vermelho, branco e azul brilhante. O verde, o amarelo, o magenta, o preto e as outras variantes brilhantes são cores fixas, contra o princípio P8 (já anotado no [jv_sh](../../../apps/jv_sh/spec.md)).
