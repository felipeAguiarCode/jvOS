# Vendor: ureq e tiny_http

Os dois lados de HTTP do Rust: o `ureq` faz as requisições para fora (cotações, clima e downloads verificados) e o `tiny_http` serve o MCP local por onde o JARVIS age no jvOS.

| | |
|---|---|
| **ID** | `vendor/http` |
| **Tipo** | Crate Rust |
| **Status** | Em uso |
| **Versão** | `ureq` 3.4.2 (declarada `"3"`; features padrão `rustls` e `gzip`; raízes `webpki-roots` 1.0.10)<br>`ureq` 2.12.1 (só no build: dependência de build do `sherpa-onnx-sys`)<br>`tiny_http` 0.12.0 (declarada `"0.12"`, sem a feature `ssl`) |
| **Licença** | `ureq`: MIT OR Apache-2.0 · `tiny_http`: MIT OR Apache-2.0 |
| **Fonte** | https://github.com/algesten/ureq · https://github.com/tiny-http/tiny-http |
| **Onde roda** | processo Rust (threads de `blocking()`, de download e `jarvis-mcp`) |

## Objetivo

A CSP da WebView bloqueia origens de terceiros, então todo HTTP externo sai do Rust ([ADR-0001](../../../arch/adr/0001-tauri-rust-desktop.md)); o `ureq` faz isso de forma bloqueante, sem runtime assíncrono. O JARVIS (`claude.exe`) aceita servidores MCP por HTTP, e um servidor mínimo em `127.0.0.1` com `tiny_http` dentro do app basta, com respostas JSON simples ([ADR-0008](../../../arch/adr/0008-mcp-http-in-process.md)). Por que estes dois crates e não outros não está registrado: ⚠ inferido — confirmar.

## Não-objetivos

- Sem cliente HTTP na WebView: nem `fetch` a terceiros, nem plugin `http` do Tauri.
- Sem TLS no servidor MCP: ele só escuta em loopback.
- Sem streaming SSE nem GET no MCP: só POST com resposta JSON.
- Sem retentativas automáticas: um download que falha é refeito pelo usuário.
- O que é baixado (modelos, vozes, `yt-dlp`) é de outras specs: [whisper-models](../whisper-models/spec.md), [silero-vad](../silero-vad/spec.md), [piper-voices](../piper-voices/spec.md), [kokoro](../kokoro/spec.md), [yt-dlp](../yt-dlp/spec.md).

## Critérios de aceite

### Critério 1 (RNF-001)

- **Dado** o `src-tauri/Cargo.lock` atual
- **Quando** rodo `cargo tree -i ureq@3.4.2 --depth 1` e `cargo tree -e normal,build -i ureq@2.12.1` em `src-tauri`
- **Então** o `ureq` 3.4.2 aparece como dependência direta do `jarvis`, e o 2.12.1 só sob `[build-dependencies]` do `sherpa-onnx-sys`.

### Critério 2 (RF-005)

- **Dado** o código atual
- **Quando** rodo `cargo test --lib -- mcp::` em `src-tauri`
- **Então** passam os 7 testes, entre eles `initializes_with_the_clients_version`, `the_bridge_waits_for_the_ui` e `tokens_differ` (token de 32 caracteres hex, diferente a cada geração).

### Critério 3 (RF-006)

- **Dado** o app rodando e a URL e o token lidos de `%LOCALAPPDATA%\dev.jarvis.os\assistant\mcp.json`
- **Quando** mando `curl.exe -i -X POST <url> -H "Authorization: Bearer <token>" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}"`
- **Então** a resposta é `200` com `{"id":1,"jsonrpc":"2.0","result":{}}` e `Content-Type: application/json`.

### Critério 4 (RF-006)

- **Dado** o mesmo servidor MCP
- **Quando** repito a chamada com `-H "Origin: https://example.com"`, depois com um token errado, depois com `-X GET`, depois em `/outra`
- **Então** as respostas são `403`, `403`, `405` e `404`, sem corpo.

### Critério 5 (RF-001)

- **Dado** a máquina sem rede
- **Quando** o widget de ações e o widget do clima atualizam
- **Então** cada cotação volta com `error` "Sem resposta de query1.finance.yahoo.com: <erro>" e o clima com "Sem resposta de geocoding-api.open-meteo.com: <erro>", cada um em no máximo 10 s.

### Critério 6 (RF-003)

- **Dado** Configurações › modelo de voz "Small" ainda não baixado
- **Quando** clico para baixar
- **Então** chegam eventos `model:progress` (o primeiro em 0, depois no máximo um a cada 200 ms, e o último com o total), o `model:done` vem com `error: null`, e `%LOCALAPPDATA%\dev.jarvis.os\models\ggml-small-q5_1.bin` tem 190.085.487 bytes, sem `.part` ao lado.

## Casos de borda

- **Vazio/nulo:** sem rede, as cotações e o clima dão "Sem resposta de <host>: …" e os downloads, "Falha no download: …"; o MCP não precisa de rede (loopback). Sem `Content-Length`, o progresso usa o tamanho do catálogo ou 0. Um corpo que não é JSON dá "Resposta inesperada de <host>: …". Um corpo MCP que não se lê como texto UTF-8 dá `400`; um que não é JSON recebe o erro `-32700`; uma notificação (sem `id`) dá `202`.
- **Duplicidade/idempotência:** um segundo `download_model` ou `speech_download` do mesmo id volta `Ok` sem outra thread. Um `.part` antigo é truncado pelo download novo, e o nome final só aparece depois do SHA-256. A cada início, o MCP escolhe outra porta e outro token e regrava o `mcp.json`.
- **Concorrência/corrida:** o `tiny_http` entrega cada requisição numa thread nova, então uma tool que espera a UI por até 20 s não segura as outras. As cotações e o clima dividem um único `ureq::Agent` (`OnceLock`), cujo pool mantém as conexões TLS entre as atualizações; as cotações de uma lista (até 20, `MAX_SYMBOLS`) saem em paralelo, uma thread cada. Uma resposta da UI que chega depois dos 20 s é ignorada.
- **Permissões/visibilidade:** o MCP escuta só em `127.0.0.1`, exige o token bearer de 128 bits e recusa qualquer `Origin` (`403`), o que bloqueia páginas no navegador. O `ureq` confere o TLS com as raízes embutidas do `webpki-roots`, não com o repositório do Windows: um proxy que intercepta TLS com raiz própria faz as requisições falharem ⚠ inferido — confirmar. Um proxy das variáveis de ambiente é usado (`Proxy::try_from_env`). O Yahoo responde "Too Many Requests" a quem não parece navegador, por isso o `User-Agent` de Chrome.

## Uso no jvOS

### Cotações e clima (`src-tauri/src/feeds.rs`)

As duas fontes sem chave dos widgets ([stocks](../../../widgets/stocks/spec.md), [weather](../../../widgets/weather/spec.md)).

- **Comportamento:**
  - **RF-001**: Todas as consultas DEVEM usar um único `ureq::Agent` com `timeout_global` de 10 s e o cabeçalho `User-Agent` de Chrome 130.
    - Yahoo Finance: `https://query1.finance.yahoo.com/v8/finance/chart/<símbolo>`.
    - Open-Meteo: `https://geocoding-api.open-meteo.com/v1/search` e `https://api.open-meteo.com/v1/forecast`.
    - Se a requisição falhar, então responda "Sem resposta de <host>: <erro>"; se o corpo não for JSON, "Resposta inesperada de <host>: <erro>".
  - **RF-002**: As chamadas DEVEM rodar fora da thread principal (`blocking()` em `stock_quotes` e `weather_forecast`).

### Downloads verificados (`src-tauri/src/download.rs`)

Usado pelos modelos do Whisper e do Silero (`models.rs`), pelas vozes (`speech.rs`) e pelo `yt-dlp` (`music.rs`).

- **Comportamento:**
  - **RF-003**: `fetch_verified` DEVE gravar o corpo num `.part` em blocos de 256 KiB, informar o progresso no máximo a cada 200 ms e só renomear para o nome final se o tamanho (quando conhecido) e o SHA-256 conferirem.
    - Se o hash ou o tamanho não conferirem, então apague o `.part` e responda "Arquivo corrompido (verificação SHA-256 falhou)".
    - Se a rede falhar, então apague o `.part` e responda "Falha no download: <erro>".
  - **RF-004**: Todo corpo DEVE ter limite: o tamanho do catálogo + 1 byte para modelos e vozes, 64 MiB para o `yt-dlp.exe` e 64 KiB para o `SHA2-256SUMS` (`fetch_text`).

### Servidor MCP (`src-tauri/src/mcp.rs`, `start_mcp` em `src-tauri/src/lib.rs`)

Por onde o `claude.exe` chama as 18 tools do jvOS ([assistant-tools](../../../features/assistant-tools/spec.md)).

- **Comportamento:**
  - **RF-005**: O servidor DEVE escutar em `127.0.0.1:0` (porta livre), numa thread `jarvis-mcp`, com um token de 128 bits novo a cada início, e gravar `{ "mcpServers": { "jarvis": { "type": "http", "url", "headers": { "Authorization": "Bearer <token>" } } } }` em `%LOCALAPPDATA%\dev.jarvis.os\assistant\mcp.json`.
  - **RF-006**: Cada requisição DEVE ser filtrada nesta ordem: token errado ou `Origin` presente, `403`; caminho diferente de `/mcp`, `404`; método diferente de POST, `405`; corpo (lido até 1 MiB) que não é texto UTF-8, `400`. As notificações recebem `202` sem corpo; as demais, `200` com `Content-Type: application/json`.
  - Se o servidor não subir, então o stderr mostra "[jarvis] JARVIS's tools unavailable: <erro>" e o JARVIS roda sem as tools.

## Restrições

- **RNF-001**: `ureq` 3.x com as features padrão (`rustls` e `gzip`) e `tiny_http` 0.12 sem TLS. O `ureq` 2.12.1 do lock é só do build do `sherpa-onnx-sys`.
- **RNF-002**: Cotações e clima com no máximo 10 s por consulta.
- **RNF-003**: Limites de corpo: tamanho do catálogo + 1 (modelos e vozes), 64 MiB (`yt-dlp.exe`), 64 KiB (`SHA2-256SUMS`), 1 MiB (MCP). Espera da UI no MCP: 20 s.
- **RNF-004**: A rede só é usada pelos widgets online e pelos downloads; o resto do jvOS funciona offline ([constituição](../../../arch/constitution.md)).
- **RNF-005**: Licença MIT OR Apache-2.0 nos dois crates.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/feeds.rs` | `agent()`, `get()`, cotações do Yahoo e clima do Open-Meteo |
| `src-tauri/src/download.rs` | `fetch_verified`, `fetch_text`, `hex` |
| `src-tauri/src/models.rs` · `src-tauri/src/speech.rs` · `src-tauri/src/music.rs` | Quem chama `fetch_verified` (e `fetch_text`, no `music.rs`) |
| `src-tauri/src/mcp.rs` | `start`, `respond`, `handle`, `Bridge`, `token` |
| `src-tauri/src/lib.rs` | `start_mcp`, `run_tool`, comandos `stock_quotes`, `weather_forecast`, `download_model`, `speech_download`, `music_install` |
| `src-tauri/Cargo.toml` | `ureq = "3"`, `tiny_http = "0.12"` |

### Testes

Rode de `src-tauri`, com `CMAKE` e `LIBCLANG_PATH` exportados.

- `cargo test --lib -- mcp::`: JSON-RPC, a ponte com a UI e o token (não sobe o `tiny_http`).
- `cargo test --lib -- feeds:: download::`: leitura das respostas do Yahoo e do Open-Meteo e o hex do SHA-256.
- `cargo test --lib -- --ignored feeds_answer_for_real`: as APIs de verdade (precisa de rede).
- `cargo test --lib -- --ignored installs_and_resolves_for_real`: baixa o `yt-dlp` verificado (precisa de rede).
- Critérios 3 e 4 com `curl.exe` contra o app rodando (manual).

### Atualização e reversão

- **Comando:** em `src-tauri`, `cargo update -p ureq@3.4.2 --precise 3.<n>.<p>` e `cargo update -p tiny_http --precise 0.12.<n>`. O `ureq` 2 sai do lock só quando o `sherpa-onnx-sys` deixar de usá-lo.
- **Prova:** critérios 1 a 6, `cargo test --lib` e os dois testes `--ignored` com rede.
- **Sinal de volta:** o widget de ações ou o clima sem resposta com rede boa, downloads parando em "Arquivo corrompido", ou o `claude.exe` sem as tools `mcp__jarvis__*`.
- **Reversão:** volte `src-tauri/Cargo.toml` e `src-tauri/Cargo.lock` e recompile. Confira o critério 1.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como casca do desktop](../../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0008 — Servidor MCP HTTP dentro do app; a UI executa as ferramentas](../../../arch/adr/0008-mcp-http-in-process.md)

## Dependências

- Vendor: [serde](../serde/spec.md) (JSON das respostas e do JSON-RPC), [archives](../archives/spec.md) (SHA-256 e extração do que é baixado), [claude-code](../claude-code/spec.md) (o cliente do MCP), [tauri](../tauri/spec.md) (a CSP que manda o HTTP para o Rust), [whisper-models](../whisper-models/spec.md), [silero-vad](../silero-vad/spec.md), [piper-voices](../piper-voices/spec.md), [kokoro](../kokoro/spec.md) e [yt-dlp](../yt-dlp/spec.md) (o que é baixado).
- Specs: [stocks](../../../widgets/stocks/spec.md), [weather](../../../widgets/weather/spec.md), [assistant-tools](../../../features/assistant-tools/spec.md), [voice-engine](../../../features/voice-engine/spec.md), [tts](../../../features/tts/spec.md), [jv_t4p3](../../../apps/jv_t4p3/spec.md), [security](../../../arch/security.md).
- Sistema: rede para Yahoo Finance, Open-Meteo, Hugging Face e GitHub releases; porta livre em `127.0.0.1`.

## Pendências

- [ ] `download.rs` usa o agente padrão do `ureq` 3, que não tem nenhum timeout (o `Timeouts::default()` do crate só define `await_100`). Uma conexão que trava no meio de um download prende a thread, e o modelo fica como "baixando" até o app fechar (`src-tauri/src/download.rs`).
- [ ] Nenhum teste sobe o `tiny_http`: as respostas `403`, `404`, `405`, `400` e `202` de `respond` só são conferidas à mão (`src-tauri/src/mcp.rs`).
