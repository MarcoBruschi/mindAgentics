use std::io::{BufRead, BufReader, IsTerminal, Read, Write};
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedArgs {
    command: String,
    args: Vec<String>,
    options: Map<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliRequestEnvelope {
    id: String,
    terminal_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    floor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stdin: Option<String>,
    command: String,
    args: Vec<String>,
    options: Map<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliResponseEnvelope {
    #[allow(dead_code)]
    id: String,
    ok: bool,
    output: Option<String>,
    error: Option<String>,
    exit_code: Option<i32>,
    #[allow(dead_code)]
    data: Option<Value>,
}

fn print_help_banner() {
    println!(
        r#"mindAgentics CLI v0.26.0

Usage: mindagentics <command> [options]

Commands:
  list                                          List connected agents, notes, portals, and bands
  notify <message>                              Send a desktop notification to the user
  ask <agent> <prompt>                          Send a prompt to a connected agent and get response
    --batch <json>                              Ask multiple connected agents in parallel
    --raw <string>                              Send raw input or escape sequences
  check <agent>                                 Read an agent's current terminal output
  say <message>                                 Broadcast a message to connected agents
  recall <query>                                Busca local (SQLite FTS5) na memória do agente: 3 melhores trechos
  ref <add|list|remove>                         Referências de arquivo/pasta no canvas (só caminho, nunca conteúdo)
  note <create|read|write|edit|stack|delete>    Manage sticky notes and fichários on canvas
  portal <snapshot|click|fill|type|key|...>     Automate browser and device portals
  preset <list|show|create|set|delete>          Manage agent quick-start presets
  role <list|show|create|edit|write|assign>     Manage agent role definitions and prompts
  routine <list|show|create|edit|run|delete>    Manage scheduled chrono routines
  workspace <list|create|move|rename>           Manage workspaces in the sidebar
  floor <list|create|land|delete|status|unload> Manage isolated git worktree floors
  recruit <name> [options]                      Spawn and auto-connect a new teammate terminal
  dismiss <name>                                Stop an agent and remove its terminal
  connect <from> <to>                           Wire two nodes together on canvas
  band <create|add|remove|dissolve>             Gather agents into a synchronized canvas band
  arrange <name> [options]                      Style or restyle canvas nodes
  graphify <build|query|explain|path|open>      Knowledge graph AST extraction, queries & visualizer
  status                                        Display current terminal status and health
  debug                                         Run diagnostics on named pipe and environment

Run 'mindagentics <command> --help' for details on a specific command."#
    );
}

fn parse_cli_args(argv: &[String]) -> ParsedArgs {
    let mut args = Vec::new();
    let mut options = Map::new();

    let command = argv
        .first()
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "help".to_string());

    let mut i = 1usize;
    while i < argv.len() {
        let arg = &argv[i];

        if let Some(key) = arg.strip_prefix("--") {
            if let Some((opt_key, opt_val)) = key.split_once('=') {
                options.insert(opt_key.to_string(), Value::String(opt_val.to_string()));
            } else if let Some(next) = argv.get(i + 1).filter(|n| !n.starts_with('-')) {
                options.insert(key.to_string(), Value::String(next.clone()));
                i += 1;
            } else {
                options.insert(key.to_string(), Value::Bool(true));
            }
        } else if let Some(key) = arg.strip_prefix('-').filter(|_| arg.len() > 1) {
            if let Some(next) = argv.get(i + 1).filter(|n| !n.starts_with('-')) {
                options.insert(key.to_string(), Value::String(next.clone()));
                i += 1;
            } else {
                options.insert(key.to_string(), Value::Bool(true));
            }
        } else {
            args.push(arg.clone());
        }

        i += 1;
    }

    ParsedArgs {
        command,
        args,
        options,
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn is_truthy_option(options: &Map<String, Value>, key: &str) -> bool {
    match options.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(_)) => true,
        _ => false,
    }
}

fn read_stdin_with_initial_timeout() -> Option<String> {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 8192];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    match rx.recv_timeout(Duration::from_millis(50)) {
        Ok(first_chunk) => {
            let mut all = first_chunk;
            while let Ok(chunk) = rx.recv() {
                all.extend_from_slice(&chunk);
            }
            if all.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(&all).into_owned())
            }
        }
        Err(_) => None,
    }
}

fn send_request_over_pipe(pipe_path: &str, payload_line: &str) -> Result<String, String> {
    #[cfg(windows)]
    let stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(pipe_path)
        .map_err(|e| e.to_string())?;

    #[cfg(not(windows))]
    let stream = std::os::unix::net::UnixStream::connect(pipe_path).map_err(|e| e.to_string())?;

    {
        let mut writer = &stream;
        writer
            .write_all(payload_line.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }

    let mut reader = BufReader::new(&stream);
    let mut response_line = String::new();
    let bytes_read = reader
        .read_line(&mut response_line)
        .map_err(|e| e.to_string())?;

    if bytes_read == 0 {
        return Err("connection closed before response was received".to_string());
    }

    Ok(response_line.trim().to_string())
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut parsed = parse_cli_args(&argv);

    if parsed.command.is_empty() || parsed.command == "help" || parsed.command == "--help" {
        print_help_banner();
        std::process::exit(0);
    }

    let pipe_path = non_empty_env("MINDAGENTICS_PIPE").or_else(|| non_empty_env("MINDAGENTICS_SOCKET"));
    let terminal_id = non_empty_env("MINDAGENTICS_TERMINAL_ID");

    let mut has_guard_errors = false;
    if pipe_path.is_none() {
        eprintln!(
            "mindagentics: only available inside mindAgentics terminals (MINDAGENTICS_PIPE not set)."
        );
        has_guard_errors = true;
    }
    if terminal_id.is_none() {
        eprintln!(
            "mindagentics: only available inside mindAgentics terminals (MINDAGENTICS_TERMINAL_ID not set)."
        );
        has_guard_errors = true;
    }
    if has_guard_errors {
        std::process::exit(1);
    }

    let pipe_path = pipe_path.unwrap();
    let terminal_id = terminal_id.unwrap();

    let subcmd = parsed
        .args
        .first()
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let wants_stdin = is_truthy_option(&parsed.options, "stdin")
        || parsed.args.iter().any(|a| a == "-")
        || (parsed.command == "note"
            && (subcmd == "write" || subcmd == "create")
            && !parsed.options.contains_key("file")
            && !parsed.options.contains_key("f")
            && !parsed.options.contains_key("body")
            && !parsed.options.contains_key("content")
            && parsed.args.len() <= 2
            && !std::io::stdin().is_terminal());

    let stdin_content = if wants_stdin {
        read_stdin_with_initial_timeout()
    } else {
        None
    };

    let orchestrator_mode = non_empty_env("MINDAGENTICS_ORCHESTRATOR_MODE").as_deref() == Some("1")
        || non_empty_env("MINDAGENTICS_MAESTRO_MODE").as_deref() == Some("1");
    parsed
        .options
        .insert("orchestratorMode".to_string(), Value::Bool(orchestrator_mode));
    parsed
        .options
        .insert("maestroMode".to_string(), Value::Bool(orchestrator_mode));

    let req = CliRequestEnvelope {
        id: format!("req-{}", &Uuid::new_v4().to_string()[..8]),
        terminal_id,
        workspace_id: non_empty_env("MINDAGENTICS_WORKSPACE_ID"),
        floor_id: non_empty_env("MINDAGENTICS_FLOOR_ID"),
        cwd: std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
        stdin: stdin_content,
        command: parsed.command,
        args: parsed.args.into_iter().filter(|a| a != "-").collect(),
        options: parsed.options,
    };

    let mut payload_line = match serde_json::to_string(&req) {
        Ok(json) => json,
        Err(e) => {
            eprintln!("mindagentics: failed to serialize request: {e}");
            std::process::exit(1);
        }
    };
    payload_line.push('\n');

    let response_line = match send_request_over_pipe(&pipe_path, &payload_line) {
        Ok(line) => line,
        Err(e) => {
            eprintln!("mindagentics: pipe connection error ({pipe_path}): {e}");
            std::process::exit(1);
        }
    };

    let res: CliResponseEnvelope = match serde_json::from_str(&response_line) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("mindagentics: failed to parse response: {e}");
            std::process::exit(1);
        }
    };

    if let Some(output) = res.output {
        if !output.is_empty() {
            println!("{output}");
        }
    }
    if let Some(error) = res.error {
        if !error.is_empty() {
            eprintln!("{error}");
        }
    }

    let code = res.exit_code.unwrap_or(if res.ok { 0 } else { 1 });
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_defaults_to_help_when_empty() {
        let parsed = parse_cli_args(&[]);
        assert_eq!(parsed.command, "help");
        assert!(parsed.args.is_empty());
        assert!(parsed.options.is_empty());
    }

    #[test]
    fn parse_positional_and_flags_parity() {
        let argv = vec![
            "note".to_string(),
            "create".to_string(),
            "My Note".to_string(),
            "--file=./spec.md".to_string(),
            "--color".to_string(),
            "yellow".to_string(),
            "-f".to_string(),
            "alias.md".to_string(),
            "--stdin".to_string(),
            "-".to_string(),
        ];
        let parsed = parse_cli_args(&argv);
        assert_eq!(parsed.command, "note");
        assert_eq!(parsed.args, vec!["create", "My Note", "-"]);
        assert_eq!(
            parsed.options.get("file"),
            Some(&Value::String("./spec.md".to_string()))
        );
        assert_eq!(
            parsed.options.get("color"),
            Some(&Value::String("yellow".to_string()))
        );
        assert_eq!(
            parsed.options.get("f"),
            Some(&Value::String("alias.md".to_string()))
        );
        assert_eq!(parsed.options.get("stdin"), Some(&Value::Bool(true)));
    }
}
