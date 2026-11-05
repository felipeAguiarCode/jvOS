# Vendor: notify, ignore, regex, trash e dunce

Crates de sistema de arquivos por trás do jv_ide: seguir as mudanças da pasta aberta, listar e buscar respeitando o `.gitignore`, buscar texto com expressões regulares, mandar arquivos para a Lixeira e dar ao Windows caminhos sem o prefixo `\\?\`.

| | |
|---|---|
| **ID** | `vendor/workspace-fs` |
| **Tipo** | Crate Rust |
| **Status** | Em uso |
| **Versão** | `notify` 8.2.1 (declarada `"8.2.1"`)<br>`ignore` 0.4.33 (declarada `"0.4.33"`)<br>`regex` 1.13.1 (declarada `"1.13"`)<br>`trash` 5.2.9 (declarada `"5.2.9"`)<br>`dunce` 1.0.5 (declarada `"1.0.5"`) |
| **Licença** | `notify`: CC0-1.0 · `ignore`: Unlicense OR MIT · `regex`: MIT OR Apache-2.0 · `trash`: MIT · `dunce`: CC0-1.0 OR MIT-0 OR Apache-2.0 |
| **Fonte** | https://github.com/notify-rs/notify · https://github.com/BurntSushi/ripgrep/tree/master/crates/ignore · https://github.com/rust-lang/regex · https://github.com/ArturKovacs/trash · https://gitlab.com/kornelski/dunce |
| **Onde roda** | processo Rust (comandos `workspace_*` e `git_*` em `blocking()`, thread do watcher, threads da busca) |

## Objetivo

O jv_ide abre pastas de projeto reais, e o que muda no disco (por ele, por um terminal, pelo git, por outro editor) precisa chegar à árvore, às abas e ao painel Git ([jv_ide](../../../apps/jv_ide/spec.md)). Estes crates dão ao Rust o watcher, o percurso com `.gitignore` e a busca do ripgrep, a Lixeira do Windows e caminhos que o Explorer, o `cmd` e o WSL entendem, sem plugin `fs` na WebView ([ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md)). A escolha de cada crate não está registrada: ⚠ inferido — confirmar.

## Não-objetivos

- Sem seguir links simbólicos ao percorrer a pasta (`follow_links(false)`).
- Sem buscar dentro de `.git` e `node_modules`, nem em arquivos acima de 2 MB.
- Sem esvaziar nem restaurar a Lixeira: só mover para ela.
- Sem watcher fora do jv_ide: o resto do jvOS não observa pastas.
- As operações de git em si são do CLI do git ([git](../git/spec.md)); aqui só a Lixeira e os caminhos que ele usa.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- workspace::watch` em `src-tauri`
- **Então** passa `follows_a_real_folder` (um arquivo gravado em `sub/` chega como `sub/novo.txt` em até 5 s, e depois de derrubar o watcher nada chega em 1,5 s) e `our_temporary_files_are_ignored_and_floods_ask_for_a_rescan` (mais de 500 caminhos ou de 2.000 eventos num lote viram `rescan: true`, e os `.~jv-*` são ignorados).

### Critério 2 (RF-003)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- workspace::search` em `src-tauri`
- **Então** passam `lists_files_honouring_gitignore`, `finds_text_literally_by_default_ignoring_case`, `honours_case_whole_words_regex_and_globs` e `a_newer_search_cancels_this_one`.

### Critério 3 (RF-004)

- **Dado** a busca do jv_ide com "Regex" ligado
- **Quando** procuro `(`
- **Então** a busca responde "Expressão regular inválida: <erro>" sem percorrer a pasta, e um texto vazio responde "Digite algo para buscar" (testado em `honours_case_whole_words_regex_and_globs`).

### Critério 4 (RF-006)

- **Dado** um arquivo numa pasta temporária
- **Quando** rodo `cargo test --lib -- --ignored deletes_to_the_recycle_bin`
- **Então** o arquivo sai da pasta e aparece na Lixeira do Windows (o teste usa a Lixeira do usuário, por isso é opt-in).

### Critério 5 (RF-007)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- workspace::paths a_shell_starts_in_the_folder_it_is_given`
- **Então** os testes passam: caminhos fora da raiz e links que levam para fora são recusados, e o shell abre na pasta pedida, sem `\\?\`.

### Critério 6 (RNF-002)

- **Dado** uma pasta com mais de 5.000 entradas num nível
- **Quando** abro essa pasta na árvore do jv_ide
- **Então** a listagem para em 5.000 itens e vem com `truncated: true`; o "abrir rápido" (`Ctrl+P`) para em 50.000 arquivos do mesmo jeito.

### Critério 7 (RNF-001)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -i notify --depth 0`, e o mesmo para `ignore`, `regex`, `trash` e `dunce`, em `src-tauri`
- **Então** aparecem `notify v8.2.1`, `ignore v0.4.33`, `regex v1.13.1`, `trash v5.2.9` e `dunce v1.0.5`.

## Casos de borda

- **Vazio/nulo:** um erro do watcher (pasta apagada, permissão) vira `rescan: true` no lote, e a UI recarrega o que mostra. Uma busca sem texto responde "Digite algo para buscar". A raiz de um drive é recusada ao abrir (`opening_refuses_drive_roots`). Um link quebrado aparece como arquivo.
- **Duplicidade/idempotência:** abrir de novo a mesma pasta mantém um só watcher (`watching: true`). Eventos do mesmo caminho se fundem no lote: criado + modificado = criado; apagado + criado = modificado. Copiar para um nome que já existe usa o primeiro "nome (n)" livre.
- **Concorrência/corrida:** uma busca nova (ou `workspace_search_cancel`) avança o contador e a anterior para (`WalkState::Quit`). A busca percorre em paralelo com até 8 threads e manda os resultados em lotes de 100 ou a cada 50 ms. O watcher junta eventos por 200 ms de silêncio ou no máximo 1 s. A Lixeira roda numa thread própria, porque a operação de arquivo do shell precisa do COM iniciado do jeito dela.
- **Permissões/visibilidade:** no Windows o `notify` não avisa quando o buffer do sistema transborda, por isso mais de 2.000 eventos num lote pedem `rescan`. Links e junções que levam para fora da raiz são recusados, mas podem ser apagados sozinhos, sem tocar no destino. O `.gitignore` vale mesmo fora de um repositório (`require_git(false)`), e os arquivos ocultos aparecem (`hidden(false)`).

## Uso no jvOS

### Watcher da pasta com `notify` (`src-tauri/src/workspace/watch.rs`)

Cada pasta aberta no jv_ide tem um watcher, que manda lotes no evento `workspace:changed`.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE observar a pasta aberta de forma recursiva (`recommended_watcher`, `RecursiveMode::Recursive`) e também a pasta `.git` do repositório quando ela fica fora da pasta aberta (subpasta ou worktree).
    - Um lote sai depois de 200 ms sem eventos ou 1 s depois do primeiro.
    - Leituras (`Access`) são ignoradas; renomear vira apagar + criar.
    - Dentro do `.git`, só `HEAD`, `index`, `packed-refs`, `ORIG_HEAD`, `MERGE_HEAD`, `FETCH_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `refs/` e `rebase-*` marcam `git: true`.
    - Mais de 500 caminhos, mais de 2.000 eventos, um erro ou `need_rescan` marcam `rescan: true` e mandam a lista vazia.
  - **RF-002**: Derrubar o `Watch` (`workspace_close`, ou fechar o app) DEVE parar o watcher e a thread dele.

### Árvore e lista de arquivos com `ignore` (`src-tauri/src/workspace/mod.rs`, `workspace/search.rs`)

O que a árvore, o "abrir rápido" e a busca enxergam da pasta.

- **Comportamento:**
  - **RF-003**: A listagem de uma pasta DEVE marcar o que o `.gitignore` (da pasta e das de cima) deixa de fora, com `max_depth(1)`, `parents(true)`, `hidden(false)` e `require_git(false)`. O "abrir rápido" e a busca percorrem a pasta com o mesmo `WalkBuilder`, sem seguir links e pulando `.git` e `node_modules`.
  - Os filtros de inclusão e exclusão da busca são globs (`OverrideBuilder`, sem diferenciar maiúsculas). Um glob inválido responde "Filtro inválido: <erro>".

### Busca de texto com `regex` (`src-tauri/src/workspace/search.rs`)

A busca no projeto (`Ctrl+Shift+F`), que manda os resultados por `Channel`.

- **Comportamento:**
  - **RF-004**: O padrão DEVE ser literal por padrão (`regex::escape`), virar `\b(?:…)\b` com "palavra inteira", ignorar maiúsculas a menos que o usuário peça, e ter limite de 10 MiB de tamanho compilado (`size_limit`). Um padrão inválido responde "Expressão regular inválida: <erro>".
  - Cada arquivo de texto (até 2 MB) é decodificado e testado com `is_match` antes de listar as linhas. As posições vão em unidades UTF-16, como o editor conta, com no máximo 1.000 resultados por arquivo e 2.000 no total (padrão).

### Lixeira com `trash` (`workspace::recycle` em `workspace/mod.rs`, `src-tauri/src/git/mod.rs`)

Apagar no jv_ide e descartar arquivos novos no Git não apaga de vez.

- **Comportamento:**
  - **RF-005**: Apagar no jv_ide DEVE mandar para a Lixeira, a menos que o usuário peça "apagar de vez" (`permanent`).
  - **RF-006**: `trash::delete_all` DEVE rodar numa thread própria, com caminhos sem `\\?\`. Se falhar, responda "Não foi possível mover para a Lixeira: <erro>". Descartar arquivos não rastreados no Git (`git_discard`, `git_discard_all`) usa o mesmo caminho.

### Caminhos sem `\\?\` com `dunce` (`src-tauri/src/workspace/paths.rs`, `git/mod.rs`, `src-tauri/src/terminal.rs`)

O `fs::canonicalize` do Windows devolve caminhos `\\?\…`, que o Explorer, o `cmd` e o WSL não entendem.

- **Comportamento:**
  - **RF-007**: Todo caminho que sai para o Explorer, o `git`, o shell, o watcher ou a Lixeira DEVE passar por `dunce::simplified` (`paths::plain`). As verificações internas continuam no caminho canônico com `\\?\` (`Root.canonical`).
  - O `git` e o jv_sh canonizam o caminho com `dunce::canonicalize`: a pasta inicial de um shell precisa existir ("Pasta não encontrada") e ser uma pasta ("Não é uma pasta").

## Restrições

- **RNF-001**: Versões `notify` 8.2.1, `ignore` 0.4.33, `regex` 1.13.1, `trash` 5.2.9 e `dunce` 1.0.5, com licenças CC0-1.0, Unlicense OR MIT, MIT OR Apache-2.0, MIT e CC0-1.0 OR MIT-0 OR Apache-2.0.
- **RNF-002**: Limites: 5.000 entradas por pasta listada, 50.000 arquivos no "abrir rápido", busca só em arquivos de até 2 MB, 2.000 resultados (padrão) e 1.000 por arquivo, padrão compilado de até 10 MiB, até 8 threads de busca.
- **RNF-003**: Lotes do watcher a cada 200 ms de silêncio ou 1 s; mais de 500 caminhos ou 2.000 eventos viram `rescan`.
- **RNF-004**: Windows: a Lixeira é a do usuário, pelo shell; caminhos com `\\?\` não saem do Rust.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/workspace/watch.rs` | `Watch`, `Batch`, `Scope`, `Changed` (`notify`) |
| `src-tauri/src/workspace/search.rs` | `files`, `prepare`, `run`, `find` (`ignore`, `regex`) |
| `src-tauri/src/workspace/mod.rs` | `Workspaces`, `kept_names` (`ignore`), `recycle` (`trash`), `delete`, `copy`, `reveal` |
| `src-tauri/src/workspace/paths.rs` | `Root`, `resolve`, `resolve_new`, `plain` (`dunce`) |
| `src-tauri/src/git/mod.rs` | `local_path` (`dunce`), `discard` e `discard_all` (Lixeira) |
| `src-tauri/src/terminal.rs` | `start_dir` (`dunce`) |
| `src-tauri/src/lib.rs` | Comandos `workspace_*`, `git_discard*` e o evento `workspace:changed` |

### Testes

Rode de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados.

- `cargo test --lib -- workspace::`: watcher (com um watcher real em `follows_a_real_folder`), busca, listagem, gravação, links e junções.
- `cargo test --lib -- git::`: uma sessão inteira num repositório real, incluindo o descarte para a Lixeira.
- `cargo test --lib -- --ignored deletes_to_the_recycle_bin`: a Lixeira do usuário (opt-in).
- `npx playwright test tests/ide.spec.ts`: a UI do jv_ide com o fake `__JARVIS_FS_FAKE__` (não passa por estes crates).

### Atualização e reversão

- **Comando:** em `src-tauri`, `cargo update -p notify --precise <versão>` (o mesmo para `ignore`, `regex`, `trash` e `dunce`). Como a declaração fixa a versão mínima, uma versão abaixo dela exige mudar o `Cargo.toml`.
- **Prova:** critérios 1 a 5 e 7 e, no `npm run dev`, abrir uma pasta no jv_ide, editar um arquivo por fora e ver a árvore e a aba acompanharem.
- **Sinal de volta:** a árvore deixa de acompanhar mudanças externas, `follows_a_real_folder` falha, a busca passa a ignorar ou incluir arquivos diferentes do `.gitignore`, ou apagar dá "Não foi possível mover para a Lixeira".
- **Reversão:** volte `src-tauri/Cargo.toml` e `src-tauri/Cargo.lock` e recompile. Confira o critério 7.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)

## Dependências

- Vendor: [serde](../serde/spec.md) (`Changed`, `SearchEvent` e os outros tipos no fio), [tauri](../tauri/spec.md) (o `Channel` da busca e o evento `workspace:changed`), [git](../git/spec.md) (o CLI que o painel Git chama), [terminal](../terminal/spec.md) (o jv_sh que usa `start_dir`).
- Specs: [jv_ide](../../../apps/jv_ide/spec.md), [jv_sh](../../../apps/jv_sh/spec.md), [jv_agent](../../../apps/jv_agent/spec.md) (pasta de trabalho de um agente), [security](../../../arch/security.md).
- Sistema: `ReadDirectoryChangesW` do Windows (pelo `notify`), a Lixeira do usuário e o COM do shell (pelo `trash`).

## Pendências

- Nenhuma por enquanto.
