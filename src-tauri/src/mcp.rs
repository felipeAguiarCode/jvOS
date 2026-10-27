//! JARVIS's own MCP server: the tools Claude Code gets to act on the jvOS — any action of the
//! search bar (windows, settings, music, theme…), opening a site, reviewing and running the
//! agents it writes. Streamable HTTP on 127.0.0.1, answered with plain JSON (no SSE stream); a
//! random token keeps the other programs on the machine out. Most tools are carried out by the
//! UI, which owns the desktop: the call goes out as an event and its answer comes back by command.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

/// The server's name for Claude Code: its tools are `mcp__jarvis__<tool>`.
pub const SERVER_NAME: &str = "jarvis";
/// Answered when the client does not say which protocol version it speaks.
const LATEST_VERSION: &str = "2025-11-25";
/// The UI answers in milliseconds; a review waits for nobody either.
const UI_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY: u64 = 1 << 20;

pub type ToolResult = Result<String, String>;
/// Carries out a tool call: the tool's name and its arguments.
type Call = dyn Fn(&str, Value) -> ToolResult + Send + Sync;

/// A tool call for the UI to carry out (`assistant:action`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub id: u64,
    pub tool: String,
    pub args: Value,
}

/// Tool calls waiting for the UI's answer.
#[derive(Default)]
pub struct Bridge {
    next: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<ToolResult>>>,
}

impl Bridge {
    /// Hands a call to the UI (`emit` returns whether it went out) and waits for the answer.
    pub fn call(&self, tool: &str, args: Value, emit: impl FnOnce(ActionRequest) -> bool) -> ToolResult {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, sender);
        let result = if emit(ActionRequest { id, tool: tool.to_string(), args }) {
            receiver.recv_timeout(UI_TIMEOUT).unwrap_or_else(|_| Err("O jvOS não respondeu a tempo".into()))
        } else {
            Err("A interface do jvOS não está disponível".into())
        };
        self.pending.lock().unwrap().remove(&id);
        result
    }

    /// The UI's answer to call `id` (ignored once the call gave up waiting).
    pub fn resolve(&self, id: u64, result: ToolResult) {
        if let Some(sender) = self.pending.lock().unwrap().remove(&id) {
            let _ = sender.send(result);
        }
    }
}

/// Where Claude Code finds the server.
pub struct Server {
    pub url: String,
    pub token: String,
}

impl Server {
    /// The `--mcp-config` file's contents.
    pub fn config(&self) -> Value {
        json!({ "mcpServers": { SERVER_NAME: { "type": "http", "url": self.url, "headers": { "Authorization": format!("Bearer {}", self.token) } } } })
    }
}

/// Listens on a free local port; `call` carries out each tool call (on its own thread).
pub fn start(call: impl Fn(&str, Value) -> ToolResult + Send + Sync + 'static) -> Result<Server, String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|error| format!("Servidor MCP: {error}"))?;
    let port = server.server_addr().to_ip().map(|address| address.port()).ok_or("Servidor MCP sem porta")?;
    let token = token();
    let expected = format!("Bearer {token}");
    let call: Arc<Call> = Arc::new(call);
    std::thread::Builder::new()
        .name("jarvis-mcp".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let (call, expected) = (call.clone(), expected.clone());
                // A tool call can wait on the UI: never hold the others back.
                std::thread::spawn(move || respond(request, &expected, &*call));
            }
        })
        .map_err(|error| format!("Servidor MCP: {error}"))?;
    Ok(Server { url: format!("http://127.0.0.1:{port}/mcp"), token })
}

/// 128 random bits, from the OS-seeded keys of the standard hasher.
fn token() -> String {
    (0..2u64)
        .map(|salt| {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u64(salt);
            format!("{:016x}", hasher.finish())
        })
        .collect()
}

fn respond(mut request: tiny_http::Request, expected: &str, call: &dyn Fn(&str, Value) -> ToolResult) {
    let header = |name: &str| {
        let found = request.headers().iter().find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name));
        found.map(|header| header.value.as_str().to_string())
    };
    let (authorization, origin) = (header("Authorization"), header("Origin"));
    let status = |code: u16| tiny_http::Response::empty(code);
    // Claude Code sends no Origin; a browser page on the machine would.
    let refused = if authorization.as_deref() != Some(expected) || origin.is_some() {
        Some(403)
    } else if request.url() != "/mcp" {
        Some(404)
    } else if *request.method() != tiny_http::Method::Post {
        // No server-initiated stream: GET is not offered.
        Some(405)
    } else {
        None
    };
    if let Some(code) = refused {
        let _ = request.respond(status(code));
        return;
    }
    let mut body = String::new();
    if request.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        let _ = request.respond(status(400));
        return;
    }
    let _ = match handle(&body, call) {
        None => request.respond(status(202)),
        Some(answer) => {
            let content_type = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("valid header");
            request.respond(tiny_http::Response::from_string(answer.to_string()).with_header(content_type))
        }
    };
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// One JSON-RPC message from the client and its answer; None for notifications and responses.
pub fn handle(body: &str, call: &dyn Fn(&str, Value) -> ToolResult) -> Option<Value> {
    let Ok(message) = serde_json::from_str::<Value>(body) else {
        return Some(error(Value::Null, -32700, "Parse error"));
    };
    let id = message.get("id").cloned()?;
    let method = message["method"].as_str()?;
    let params = &message["params"];
    let result = match method {
        "initialize" => json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or(LATEST_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            if !TOOLS.contains(&name) {
                return Some(error(id, -32602, &format!("Ferramenta desconhecida: {name}")));
            }
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (text, failed) = match call(name, args) {
                Ok(text) => (text, false),
                Err(text) => (text, true),
            };
            json!({ "content": [{ "type": "text", "text": text }], "isError": failed })
        }
        // Newer clients ask `server/discover` first; "not found" makes them `initialize`.
        _ => return Some(error(id, -32601, "Method not found")),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

const TOOLS: [&str; 5] = ["jvos_run", "jvos_commands", "open_url", "agent_review", "agent_run"];

fn tools() -> Value {
    let text = |description: &str| json!({ "type": "string", "description": description });
    json!([
        {
            "name": "jvos_run",
            "description": "Executa uma ação do jvOS, a área de trabalho JARVIS: abrir ou fechar janelas e apps (Relógio, Calculadora, Jarvis Mark, jv_agent, jv_sh…), abrir as configurações ou uma seção delas, o menu avançado e suas abas, mudar tema, fundo, núcleo (2D/3D/desligado), dock, qualidade, música (estações, playlists, próxima, pausar) e abrir os programas e atalhos do usuário. Passe `query` com poucas palavras (\"relógio\", \"fechar calculadora\", \"configurações de voz\", \"núcleo 2d\", \"tema verde\") ou o `id` exato de jvos_commands. Devolve o que foi feito, ou as opções mais próximas.",
            "inputSchema": { "type": "object", "properties": { "query": text("Poucas palavras que descrevem a ação"), "id": text("Id exato de jvos_commands") } },
        },
        {
            "name": "jvos_commands",
            "description": "Lista as ações do jvOS disponíveis agora (id, título e grupo), para escolher o id certo para jvos_run.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "open_url",
            "description": "Abre um site (http ou https) no navegador do usuário.",
            "inputSchema": { "type": "object", "properties": { "url": text("Endereço completo, com https://") }, "required": ["url"] },
        },
        {
            "name": "agent_review",
            "description": "Mostra ao usuário, no jv_agent, o agente escrito em Agentes/<name>.md para revisão antes de rodar: devolve o resumo e os problemas encontrados. `folder` é a pasta onde ele vai trabalhar (padrão: Agentes/<name>/) e `task` a tarefa da primeira execução.",
            "inputSchema": { "type": "object", "properties": { "name": text("Nome do agente (minúsculas, números e hífens)"), "folder": text("Pasta de trabalho (caminho completo)"), "task": text("Tarefa da execução") }, "required": ["name"] },
        },
        {
            "name": "agent_run",
            "description": "Roda uma vez, numa aba do jv_sh, o agente que está em revisão no jv_agent (depois de agent_review e de o usuário confirmar explicitamente). Instala o agente como subagente do Claude Code do usuário.",
            "inputSchema": { "type": "object", "properties": { "name": text("Nome do agente") }, "required": ["name"] },
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(body: Value, call: &dyn Fn(&str, Value) -> ToolResult) -> Option<Value> {
        handle(&body.to_string(), call)
    }

    fn never(_: &str, _: Value) -> ToolResult {
        panic!("no tool call expected")
    }

    #[test]
    fn initializes_with_the_clients_version() {
        let reply = answer(json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": { "protocolVersion": "2025-11-25", "capabilities": {} } }), &never).unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(reply["result"]["serverInfo"]["name"], "jarvis");
        assert!(reply["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn notifications_and_responses_get_no_answer() {
        assert!(answer(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &never).is_none());
        assert!(answer(json!({ "jsonrpc": "2.0", "id": 4, "result": {} }), &never).is_none());
    }

    #[test]
    fn unknown_methods_and_bad_json_are_errors() {
        let discover = answer(json!({ "jsonrpc": "2.0", "id": "probe", "method": "server/discover" }), &never).unwrap();
        assert_eq!(discover["error"]["code"], -32601);
        assert_eq!(discover["id"], "probe");
        assert_eq!(handle("{nope", &never).unwrap()["error"]["code"], -32700);
    }

    #[test]
    fn lists_every_tool_with_a_schema() {
        let reply = answer(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }), &never).unwrap();
        let tools = reply["result"]["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|tool| tool["name"].as_str().unwrap()).collect();
        assert_eq!(names, TOOLS);
        assert!(tools.iter().all(|tool| tool["inputSchema"]["type"] == "object" && tool["description"].as_str().is_some_and(|text| !text.is_empty())));
    }

    #[test]
    fn calls_carry_the_arguments_and_report_failures() {
        let call = |tool: &str, args: Value| -> ToolResult {
            match tool {
                "jvos_run" => Ok(format!("Executado: {}", args["query"].as_str().unwrap())),
                _ => Err("não deu".into()),
            }
        };
        let ok = answer(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "jvos_run", "arguments": { "query": "relógio" } } }), &call).unwrap();
        assert_eq!(ok["result"]["content"][0]["text"], "Executado: relógio");
        assert_eq!(ok["result"]["isError"], false);
        let failed = answer(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "agent_run", "arguments": { "name": "x" } } }), &call).unwrap();
        assert_eq!(failed["result"]["isError"], true);
        let unknown = answer(json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "rm_rf" } }), &call).unwrap();
        assert_eq!(unknown["error"]["code"], -32602);
    }

    #[test]
    fn the_bridge_waits_for_the_ui() {
        let bridge = Arc::new(Bridge::default());
        let ui = bridge.clone();
        let result = bridge.call("jvos_run", json!({ "query": "relógio" }), move |request| {
            assert_eq!(request.tool, "jvos_run");
            std::thread::spawn(move || ui.resolve(request.id, Ok("Abrindo Relógio".into())));
            true
        });
        assert_eq!(result, Ok("Abrindo Relógio".into()));
        assert!(bridge.pending.lock().unwrap().is_empty());
        assert!(bridge.call("jvos_run", json!({}), |_| false).is_err());
    }

    #[test]
    fn tokens_differ() {
        let (first, second) = (token(), token());
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
    }
}
