# Vendor: serde e serde_json

Serialização do lado Rust: os tipos que atravessam o IPC do Tauri, o `settings.json`, o JSON-RPC do servidor MCP e o JSON lido de outros programas e serviços.

| | |
|---|---|
| **ID** | `vendor/serde` |
| **Tipo** | Crate Rust |
| **Status** | Em uso |
| **Versão** | `serde` 1.0.229 (declarada `{ version = "1", features = ["derive"] }`)<br>`serde_derive` 1.0.229 e `serde_core` 1.0.229 (transitivas)<br>`serde_json` 1.0.154 (declarada `"1"`, sem `preserve_order`) |
| **Licença** | MIT OR Apache-2.0 (os quatro crates) |
| **Fonte** | https://github.com/serde-rs/serde · https://github.com/serde-rs/json |
| **Onde roda** | processo Rust (comandos, eventos, arquivos, protocolos) · build (`serde_derive` é macro) |

## Objetivo

Dezenas de tipos atravessam a fronteira entre a WebView e o Rust, e o Rust lê e grava JSON em vários lugares. O serde, com `derive`, é o formato que o próprio Tauri usa no IPC; o jvOS escreve cada tipo à mão nos dois lados, em camelCase, sem gerador de código ([ADR-0009](../../../arch/adr/0009-tipos-espelhados-ts-rust.md)). O `settings.json` usa os mesmos tipos, com padrões que toleram campos faltando ([ADR-0010](../../../arch/adr/0010-persistencia-settings-vs-localstorage.md)).

## Não-objetivos

- Sem geração de tipos TypeScript (ts-rs, specta): o espelho é escrito à mão, com o comentário `Mirrors`.
- Sem outros formatos (TOML, YAML, binário): só JSON.
- Sem `deny_unknown_fields`: chaves antigas ou desconhecidas são ignoradas.
- Sem parser de JSON com comentários: o `settings.json` do Windows Terminal passa antes por `strip_jsonc` (`terminal.rs`).

## Critérios de aceite

### Critério 1 (RF-003)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- settings::` em `src-tauri`
- **Então** passam `missing_fields_fall_back_to_defaults` (`{ "activation": "always" }` vira idioma `pt`, tema `blue`, barra superior ligada e os comandos de voz padrão) e `save_and_load_round_trip`.

### Critério 2 (RF-001)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- workspace::watch` em `src-tauri`
- **Então** passa `our_temporary_files_are_ignored_and_floods_ask_for_a_rescan`, que serializa um `Changed` e encontra `changes[0].kind == "removed"`.

### Critério 3 (RF-005)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- mcp::` em `src-tauri`
- **Então** passa `unknown_methods_and_bad_json_are_errors`: o corpo `{nope` recebe o erro JSON-RPC `-32700`, e `server/discover` recebe `-32601` com o mesmo `id`.

### Critério 4 (RF-004)

- **Dado** o `src-tauri/voice-commands.json` atual
- **Quando** rodo `cargo test --lib -- settings::tests::default_voice_commands_are_valid`
- **Então** o teste passa; um JSON inválido ali faria o app entrar em pânico ao iniciar (`expect("voice-commands.json is valid")`).

### Critério 5 (RF-003)

- **Dado** um `%APPDATA%\dev.jarvis.os\settings.json` com um erro de sintaxe, ou com `"activation": "x"`
- **Quando** abro o jvOS
- **Então** ele inicia com todas as configurações no padrão (`Settings::default()`), e a próxima gravação substitui o arquivo.

### Critério 6 (RNF-001)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -i serde_json --depth 0` e `cargo tree -i serde --depth 0` em `src-tauri`
- **Então** aparecem `serde_json v1.0.154` e `serde v1.0.229`.

## Casos de borda

- **Vazio/nulo:** sem `settings.json`, valem os padrões. Um campo faltando pega o padrão do campo (`#[serde(rename_all = "camelCase", default)]` em `Settings`). Um `null` num campo que não é `Option`, um tipo errado ou uma variante de enum desconhecida derrubam a leitura do arquivo inteiro, que volta ao padrão. Uma linha do `claude.exe` ou do `yt-dlp` que não é JSON é pulada ou vira "Resposta inesperada do yt-dlp".
- **Duplicidade/idempotência:** uma chave repetida num tipo derivado é erro de leitura e, no `settings.json`, devolve o padrão. Gravar o mesmo `Settings` duas vezes gera o mesmo arquivo (`to_string_pretty`). Ler e gravar de novo passa por `sanitize`, que reinsere os comandos de voz embutidos.
- **Concorrência/corrida:** `save` grava em `settings.json.tmp` e renomeia, então uma queda nunca deixa o arquivo pela metade. Duas gravações seguidas: vale a última. O estado vive num `RwLock`, e `persist` grava uma cópia tirada sob a trava.
- **Permissões/visibilidade:** o serde não limita tamanho; os limites são de quem lê: corpo MCP até 1 MiB, `.instalados.json` e `settings.json` lidos inteiros do disco do usuário. Campos internos ficam fora do IPC com `#[serde(skip)]` (`GpuDevice.index`, `Voice.sid` e um campo de `music.rs`).

## Uso no jvOS

### Tipos do IPC (`src-tauri/src/lib.rs` e os módulos de domínio)

Tudo o que os comandos recebem e devolvem, e o que os eventos e `Channel`s levam.

- **Comportamento:**
  - **RF-001**: Todo tipo que cruza o IPC DEVE derivar `Serialize` ou `Deserialize` com `#[serde(rename_all = "camelCase")]`, espelhado em TypeScript com `Mirrors`.
    - Enums com dados usam tag: `AssistantEvent` e `SearchEvent` (`tag = "event"`), `Sleep` (`tag = "outcome"`) e `FileContent` do workspace (`tag = "kind"`), com `rename_all_fields = "camelCase"`. No TypeScript viram uniões discriminadas.
    - Códigos de erro sentinela são strings iguais nos dois lados: `model-missing`, `voice-missing` e `file-changed`.
  - **RF-002**: Campos internos DEVEM ficar fora do IPC com `#[serde(skip)]` (o índice da GPU, o `sid` da voz).

### `settings.json` (`src-tauri/src/settings.rs`)

As configurações que a thread de voz e o assistente leem sem a WebView ([persistência](../../../domain/persistence.md)).

- **Comportamento:**
  - **RF-003**: A leitura DEVE ser tolerante: campos faltando pegam o padrão (`default`), e o resultado passa por `sanitize`. Se o arquivo não existir ou não for um `Settings` válido, então valem os padrões (`unwrap_or_default`).
  - A gravação é `to_string_pretty`, num `.json.tmp` renomeado por cima.

### Catálogo de voz embutido (`settings.rs`, `src-tauri/voice-commands.json`)

Os comandos de voz padrão, compartilhados com a UI, entram no binário como texto JSON.

- **Comportamento:**
  - **RF-004**: O catálogo DEVE ser embutido com `include_str!` e lido como `Vec<VoiceCommand>` na inicialização. Um JSON inválido aqui é bug de build, coberto por `default_voice_commands_are_valid`.

### JSON-RPC do MCP (`src-tauri/src/mcp.rs`)

As mensagens que o `claude.exe` troca com o servidor MCP do jvOS.

- **Comportamento:**
  - **RF-005**: Cada mensagem DEVE ser lida como `serde_json::Value`. Um corpo que não é JSON recebe o erro `-32700` ("Parse error"); as respostas e os schemas das 18 tools são montados com `json!`.

### JSON de outros programas e serviços (`assistant.rs`, `feeds.rs`, `music.rs`, `terminal.rs`, `agents.rs`)

JSON cujo formato o jvOS não controla.

- **Comportamento:**
  - **RF-006**: JSON de terceiros DEVE ser lido como `Value` não tipado, com cada campo conferido no uso:
    - o stream-json do `claude.exe`, uma linha por evento; linhas inválidas são puladas;
    - as respostas do Yahoo Finance e do Open-Meteo ("Resposta inesperada de <host>: …" se não for JSON);
    - a saída `-j` do `yt-dlp` ("Resposta inesperada do yt-dlp");
    - o `settings.json` do Windows Terminal, depois de `strip_jsonc`;
    - o `Agentes\.instalados.json` (vazio se ilegível).

## Restrições

- **RNF-001**: `serde` 1.x com `derive` e `serde_json` 1.x, sem `preserve_order`.
- **RNF-002**: Nomes de campo em camelCase no fio; o espelho TypeScript é mantido à mão e uma divergência só aparece em tempo de execução ([ADR-0009](../../../arch/adr/0009-tipos-espelhados-ts-rust.md)).
- **RNF-003**: O `#[serde(default)]` do `Settings` mascara um campo renomeado: o valor antigo é ignorado e o novo começa no padrão. Uma migração de chave exige código em `sanitize`.
- **RNF-004**: Licença MIT OR Apache-2.0.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/settings.rs` | `Settings`, `AppEntry`, `VoiceCommand`, `Activation`; `load`, `save`, catálogo embutido |
| `src-tauri/src/lib.rs` | Tipos de eventos e respostas (`ModelProgress`, `ModelDone`, `VoiceDevices`, `TerminalOutput`…) |
| `src-tauri/src/mcp.rs` | JSON-RPC, `ActionRequest`, schemas das tools |
| `src-tauri/src/assistant.rs` | `AssistantEvent`, `Sleep`; leitura do stream-json |
| `src-tauri/src/feeds.rs` | `Quote`, `Weather`, `Current`, `Day`; leitura das APIs |
| `src-tauri/src/workspace/*.rs` · `src-tauri/src/git/*.rs` | Tipos do jv_ide (`Listing`, `Stamp`, `Changed`, `SearchEvent`, `GitStatus`…) |
| `src-tauri/src/terminal.rs` · `src-tauri/src/music.rs` · `src-tauri/src/agents.rs` | JSON do Windows Terminal, do `yt-dlp` e do registro de agentes |
| `src-tauri/src/voice/mod.rs` · `src-tauri/src/voice/transcriber.rs` · `src-tauri/src/speech.rs` · `src-tauri/src/models.rs` · `src-tauri/src/system.rs` | Tipos de voz, modelos e medidores |

### Testes

Rode de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados.

- `cargo test --lib -- settings::`: padrões, migrações, `sanitize` e o arquivo de ida e volta.
- `cargo test --lib -- mcp::`: o JSON-RPC (inicialização, notificações, erros, tools).
- `cargo test --lib -- assistant:: terminal:: feeds::`: leitura do stream-json, do Windows Terminal e das APIs.
- `cargo test --lib -- workspace::watch`: a forma de `Changed` no fio.

### Atualização e reversão

- **Comando:** em `src-tauri`, `cargo update -p serde --precise 1.0.<n>` e `cargo update -p serde_json --precise 1.0.<n>`.
- **Prova:** critérios 1 a 4 e 6, `cargo test --lib` inteiro e o app abrindo com o `settings.json` atual sem perder nada.
- **Sinal de volta:** configurações voltando ao padrão ao abrir, erros de argumento do IPC no console da WebView, ou testes de leitura falhando.
- **Reversão:** volte `src-tauri/Cargo.lock` e recompile. Confira o critério 6.

### Decisões relacionadas

- [ADR-0009 — Tipos espelhados entre TypeScript e Rust por convenção](../../../arch/adr/0009-tipos-espelhados-ts-rust.md)
- [ADR-0010 — Persistência dividida entre `settings.json` e `localStorage`, com parsers tolerantes](../../../arch/adr/0010-persistencia-settings-vs-localstorage.md)
- [ADR-0008 — Servidor MCP HTTP dentro do app](../../../arch/adr/0008-mcp-http-in-process.md)

## Dependências

- Vendor: [tauri](../tauri/spec.md) (o IPC serializa com serde), [http](../http/spec.md) (o corpo que vira `Value`), [claude-code](../claude-code/spec.md) (o stream-json), [yt-dlp](../yt-dlp/spec.md) (a saída `-j`).
- Specs: [settings](../../../features/settings/spec.md), [assistant-tools](../../../features/assistant-tools/spec.md), [voice-commands](../../../features/voice-commands/spec.md), [ipc-contract](../../../arch/ipc-contract.md), [persistência](../../../domain/persistence.md).
- Sistema: nenhum.

## Pendências

- [ ] Um `settings.json` com JSON inválido, uma chave repetida ou uma variante de enum desconhecida vira `Settings::default()` sem aviso, e a próxima gravação põe o padrão por cima, sem cópia do arquivo antigo (`load` em `src-tauri/src/settings.rs`).
