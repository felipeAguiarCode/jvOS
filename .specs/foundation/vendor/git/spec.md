# Vendor: Git (CLI)

O `git.exe` do próprio usuário (Git for Windows), que o painel Git do jv_ide roda a cada operação; o mesmo pacote dá o perfil "Git Bash" do jv_sh.

| | |
|---|---|
| **ID** | `vendor/git` |
| **Tipo** | Ferramenta externa |
| **Status** | Opcional (sem ele, só o painel Git do jv_ide e o perfil "Git Bash" do jv_sh ficam de fora) |
| **Versão** | Git for Windows 2.50.0.windows.2 nesta máquina (`git --version` em 2026-11-05), em `C:\Program Files\Git\cmd\git.exe`. O jvOS não instala nem fixa versão; o código trata o Git anterior a 2.35, que não conta os stashes no `status` |
| **Licença** | GPL-2.0-only (do `C:\Program Files\Git\LICENSE.txt`) |
| **Fonte** | https://gitforwindows.org (o Git for Windows que a mensagem "Git não encontrado — instale o Git for Windows" pede) |
| **Onde roda** | processo externo: um `git.exe` por operação, sem janela, filho do `jarvis.exe`, em `spawn_blocking` |

## Objetivo

Dar ao jv_ide um painel Git completo sem reimplementar o Git, usando o Git do usuário para que a config, os credential helpers e os hooks dele valham (comentário de `src-tauri/src/git/mod.rs`). O trabalho nativo pesado, git incluso, fica no Rust ([ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md)).

## Não-objetivos

- Não usa libgit2 nem outra biblioteca: tudo passa pelo CLI.
- Nunca roda `git clean`: arquivos novos descartados vão para a Lixeira.
- Não toca a rede sem pedido do usuário: só push, pull e fetch.
- Sem merge, rebase ou resolução de conflito pela UI: o painel só mostra a operação em andamento (`merge`, `rebase`, `cherry-pick`, `revert`).
- Não pede senha (`GIT_TERMINAL_PROMPT=0`): a autenticação vem dos helpers do usuário. O JARVIS não roda git ([ADR-0007](../../../arch/adr/0007-jarvis-confinado-a-documentos.md)).

## Critérios de aceite

### Critério 1 (RF-003)

- **Dado** o Git instalado
- **Quando** `cargo test --lib -- git::` roda em `src-tauri`
- **Então** `a_whole_session_in_a_real_repository` passa num repositório temporário: unstage antes do primeiro commit, commit "Primeiro commit: relatório", "Nada para commitar", diff de arquivo novo, `show HEAD:`, stash e pop, branch `feature/csv`, "Nome de branch inválido" para `-x` e `a..b`, e "Nenhum remoto configurado" no push.

### Critério 2 (RF-002)

- **Dado** um repositório com uma alteração numa subpasta
- **Quando** o painel pede o status a partir de `app\`
- **Então** o `prefix` é `app` e o índice não muda de data, porque `GIT_OPTIONAL_LOCKS=0` (teste `a_subfolder_knows_its_place_and_status_leaves_the_index_alone`).

### Critério 3 (RF-001)

- **Dado** nenhum `git.exe` no `PATH` nem em `%ProgramFiles%\Git\cmd`, `%ProgramW6432%\Git\cmd` ou `%LOCALAPPDATA%\Programs\Git\cmd`
- **Quando** o jv_ide abre um projeto e pede o status
- **Então** o erro é "Git não encontrado — instale o Git for Windows", e os testes de `git::` que precisam de um repositório real saem sem falhar.

### Critério 4 (RF-005)

- **Dado** caminhos vindos da UI
- **Quando** `cargo test --lib -- git::` roda
- **Então** `refuses_paths_that_are_options_or_lead_out` passa: `-rf`, `--all`, `../x`, `/etc/passwd`, `C:\x` e o vazio são recusados.

### Critério 5 (RF-006)

- **Dado** mensagens do Git em inglês
- **Quando** `explain` as traduz
- **Então** `explains_git_errors_in_portuguese` passa nos 17 casos: "fatal: Authentication failed for 'https://x'" vira "Falha de autenticação no remoto", "detected dubious ownership" vira a dica do `safe.directory`, uma mensagem desconhecida de 4 linhas vira "Git: " com as 3 primeiras e a vazia vira "O Git falhou".

### Critério 6 (RNF-001)

- **Dado** um push preso (um ssh ou helper esperando)
- **Quando** passam 180 s
- **Então** `taskkill /T /F` encerra o git e os filhos dele e o erro é "O Git demorou demais e foi interrompido".

### Critério 7 (RF-003)

- **Dado** uma pasta fora de qualquer repositório
- **Quando** o painel pede o status e o usuário tenta um stage
- **Então** o status é `None` e o stage falha com "Esta pasta não é um repositório Git" (teste `a_folder_outside_any_repository_has_no_status`).

## Casos de borda

- **Vazio/nulo:** sem Git → "Git não encontrado — instale o Git for Windows" e o perfil "Git Bash" some do jv_sh. O caminho do `git.exe` é procurado uma vez por execução (`OnceLock`), então instalar o Git com o jvOS aberto só vale depois de reabrir o app. Um repositório sem commits tem `initial` e log vazio; o unstage usa `rm --cached`.
- **Duplicidade/idempotência:** um stash sem alterações dá "Nada para guardar no stash", e um commit sem nada preparado dá "Nada para commitar" ou "Nenhuma alteração preparada (stage) para o commit". Um push sem upstream cria um (`push -u <remoto> HEAD`) só quando há um remoto; com mais de um, "Este branch não tem upstream".
- **Concorrência/corrida:** uma escrita por vez, atrás do `Mutex` `WRITING`, porque duas brigariam pelo `index.lock`. O `status` não grava o índice (`GIT_OPTIONAL_LOCKS=0`); sem isso, o watcher veria a escrita e pediria outro status, sem fim. Outro processo com o `index.lock` dá "Outro processo Git está usando o repositório".
- **Permissões/visibilidade:** uma pasta de outro dono dá "O Git não confia nesta pasta (dono diferente). Rode no terminal: git config --global --add safe.directory <pasta>". Hooks e helpers do usuário rodam (o commit tem 120 s por causa deles). Caminhos começando com `-` ou saindo do repositório são recusados antes de chegar ao Git, e vão sempre depois de `--`.

## Uso no jvOS

### Localizar o `git.exe` (`src-tauri/src/git/mod.rs`, `git_exe`)

Acha o Git do usuário.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE procurar `git.exe` no `PATH` e, se não achar, em `%ProgramFiles%\Git\cmd\git.exe`, `%ProgramW6432%\Git\cmd\git.exe` e `%LOCALAPPDATA%\Programs\Git\cmd\git.exe`, guardando a resposta para a execução inteira. Sem nenhum, o erro é `NO_GIT`.

### Execução (`src-tauri/src/git/mod.rs`, `run` e `kill_tree`)

Roda uma operação com saída previsível.

- **Comportamento:**
  - **RF-002**: Toda chamada DEVE ser `git --no-pager --literal-pathspecs -C <pasta> -c core.quotepath=false -c color.ui=false -c log.showSignature=false <args>`, com `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_MERGE_AUTOEDIT=no`, `GIT_EDITOR=true`, `LC_ALL` e `LANG` em `en_US.UTF-8` (mensagens em inglês, para serem reconhecidas), sem janela e com stdin nulo, menos na mensagem do commit.
  - stdout e stderr são lidos em threads próprias. Passado o limite (20 s local, 120 s commit, 180 s rede), `kill_tree` roda `taskkill /T /F /PID <pid>`, que também derruba ssh e helpers que seguram os pipes.
  - O mesmo `kill_tree` encerra o `claude.exe` do JARVIS.

### Operações do painel (`src-tauri/src/git/mod.rs`, `src-tauri/src/git/status.rs`)

Os 20 comandos `git_*` do jv_ide.

- **Comportamento:**
  - **RF-003**: Cada operação DEVE usar o comando fixo do Git:
    - status: `status --porcelain=v2 --branch --show-stash -z --untracked-files=all`, até 10.000 entradas; no Git anterior a 2.35, os stashes vêm de `rev-list --walk-reflogs --count refs/stash`;
    - stage `add` e `add -A`; unstage `restore --staged`, ou `rm --cached -r -q` antes do primeiro commit; `reset -q` para tudo;
    - descartar: `restore --worktree`, e os arquivos novos vão para a Lixeira;
    - commit: `commit -F -` com a mensagem no stdin, ou `--amend --no-edit`; devolve `rev-parse --short HEAD`;
    - push `push` ou `push -u <remoto> HEAD`; pull `pull --no-edit`; fetch `fetch --prune`;
    - log `log --format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e -n<1 a 1000> --skip=<n>`;
    - diff `diff --no-color --no-ext-diff [--cached] -- <caminho>`, com arquivo novo por `--no-index /dev/null`, cortado em 2 MB;
    - `show HEAD:<caminho>` ou `show :<caminho>`; `stash list|push|pop|drop`; branches por `for-each-ref`;
    - troca de branch por `switch`, `switch -c` ou `switch -c <local> --track <remoto>`, com o nome validado por `check-ref-format --branch`.
  - **RF-004**: Uma só escrita no repositório DEVE rodar por vez (`WRITING`).
  - **RF-005**: Os caminhos da UI DEVEM ser relativos ao repositório, nunca começar com `-`, ir depois de `--` e ser mandados em blocos de até 8000 caracteres, por causa do limite da linha de comando do Windows.

### Mensagens em português (`src-tauri/src/git/mod.rs`, `explain`)

Traduz o que o Git disse.

- **Comportamento:**
  - **RF-006**: O jvOS DEVE trocar 16 padrões conhecidos do Git em inglês por frases em PT-BR ("Push rejeitado: faça pull primeiro", "Sem conexão com o remoto", "Conflitos de merge: resolva e faça commit"…). Fora deles, mostra "Git: <até 3 primeiras linhas>" ou "O Git falhou".

### Perfil "Git Bash" do jv_sh (`src-tauri/src/terminal.rs`, `git_bash`)

O jv_sh também usa o pacote do Git for Windows.

- **Comportamento:**
  - O jv_sh procura `Git\bin\bash.exe` em `%ProgramFiles%`, `%ProgramW6432%` e `%LOCALAPPDATA%\Programs`, e o abre como "Git Bash" com `--login -i`; o perfil dinâmico "Git" do Windows Terminal ganha esse mesmo comando.
  - Se o Git for Windows não estiver instalado, então o perfil fica de fora.

### Comandos Tauri e UI (`src-tauri/src/lib.rs`, `src/lib/git.ts`, `src/lib/workspace.ts`)

Ligam o painel ao Rust.

- **Comportamento:**
  - Os 20 comandos `git_*` rodam em `spawn_blocking`. A UI usa `tauriGit` no app e o falso de `src/lib/workspaceFake.ts` no modo web.

## Restrições

- **RNF-001**: Limites de tempo: 20 s local, 120 s commit (hooks podem rodar testes) e 180 s push, pull e fetch. Diff até 2 MB, status até 10.000 entradas, log de 1 a 1000 commits por página.
- **RNF-002**: O código não confere a versão do Git. `switch` e `restore` existem desde o Git 2.23 ⚠ inferido — confirmar; abaixo de 2.35, só a contagem de stash tem caminho alternativo.
- **RNF-003**: A config do usuário vale (hooks, helpers, `safe.directory`); a do jvOS só força `core.quotepath`, `color.ui` e `log.showSignature` por chamada.
- **RNF-004**: Licença GPL-2.0-only. O jvOS não distribui o Git: roda o que o usuário instalou.
- **RNF-005**: Só Windows: `git.exe`, `CREATE_NO_WINDOW` e `taskkill`.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/git/mod.rs` | `git_exe`, `run`, `kill_tree`, `explain`, as operações e os testes com repositório real |
| `src-tauri/src/git/status.rs` | Parser do `status --porcelain=v2`, corte em 10.000 entradas |
| `src-tauri/src/lib.rs` | Os 20 comandos `git_*` |
| `src-tauri/src/terminal.rs` | `git_bash` e o perfil "Git Bash" do jv_sh |
| `src/lib/git.ts` | Tipos e o backend `tauriGit` |
| `src/lib/workspaceFake.ts` | Git falso do modo web (Playwright) |

### Testes

- `cargo test --lib -- git::` (em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH`): sessão inteira num repositório real, subpasta e índice intacto, pasta fora de repositório, caminhos recusados e mensagens em português. Sem Git, os testes com repositório saem sem falhar.
- `cargo test --lib -- terminal::`: o perfil "Git Bash" a partir do `settings.json` do Windows Terminal, e a ausência dele sem o Git for Windows.
- `npx playwright test tests/ide.spec.ts -g "git:"`: o painel Git com o backend falso, sem o Git real.
- Conferência manual: `git --version`.

### Atualização e reversão

- **Comando:** fora do jvOS, pelo instalador do Git for Windows (ou `winget upgrade Git.Git` ⚠ inferido — confirmar); reabra o jvOS, porque o caminho do `git.exe` fica guardado na execução.
- **Prova:** `cargo test --lib -- git::` e o painel Git do jv_ide num repositório real: status, stage, commit, diff e troca de branch.
- **Sinal de volta:** mensagens novas que `explain` não reconhece ("Git: …" no lugar da frase em português), `status` com campos que o parser não lê, ou contagens erradas no painel.
- **Reversão:** reinstalar a versão anterior do Git for Windows; o jvOS não guarda versão nem estado do Git.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0007 — O JARVIS fica confinado a `Documentos\JARVIS`, sem ferramentas de shell](../../../arch/adr/0007-jarvis-confinado-a-documentos.md)
- [ADR-0011 — Fakes de desenvolvimento nos adaptadores; E2E no modo web; app real via CDP](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)

## Dependências

- [workspace-fs](../workspace-fs/spec.md): `dunce` normaliza os caminhos do Git e `trash` manda os arquivos novos descartados para a Lixeira.
- [serde](../serde/spec.md): os tipos do painel vão para a UI. [tauri](../tauri/spec.md): os comandos. [terminal](../terminal/spec.md): o perfil "Git Bash".
- [jv_ide](../../../apps/jv_ide/spec.md) (painel Git, RF-015 e RNF-004/005 da spec), [jv_sh](../../../apps/jv_sh/spec.md).
- Sistema: Git for Windows instalado pelo usuário, com a config, os helpers e os hooks dele; `taskkill`.

## Pendências

- [ ] O jvOS não confere a versão do Git (`src-tauri/src/git/mod.rs`): num Git antigo sem `switch` ou `restore`, o painel falha com a mensagem crua do Git.
