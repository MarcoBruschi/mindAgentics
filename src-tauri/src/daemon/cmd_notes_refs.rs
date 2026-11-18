use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::security::path_safety::resolve_workspace_path;
use crate::security::sanitizer::sanitize_label;

use super::named_pipe::*;

impl DaemonServer {
    pub(super) async fn note_disk_path(&self, ws_id: &str, note_id: &str) -> PathBuf {
        let safe_id = sanitize_file_stem(note_id);
        self.storage_engine()
            .get_data_dir()
            .join("workspaces")
            .join(ws_id)
            .join("notes")
            .join(format!("{safe_id}.md"))
    }

    pub(super) async fn write_note_files(&self, ws_id: &str, note_id: &str, content: &str) {
        let ws_note_path = self.note_disk_path(ws_id, note_id).await;
        let _ = self
            .storage_engine()
            .replace_file_atomically(&ws_note_path, content.as_bytes())
            .await;
        let _ = self
            .storage_engine()
            .write_note(ws_id, &sanitize_file_stem(note_id), content)
            .await;
    }

    pub(super) async fn read_note_files(&self, ws_id: &str, note_id: &str) -> Option<String> {
        let ws_note_path = self.note_disk_path(ws_id, note_id).await;
        if ws_note_path.exists() {
            if let Ok(s) = tokio::fs::read_to_string(&ws_note_path).await {
                return Some(s);
            }
        }
        if let Ok(s) = self
            .storage_engine()
            .read_note(ws_id, &sanitize_file_stem(note_id))
            .await
        {
            if !s.is_empty() {
                return Some(s);
            }
        }
        None
    }

    pub(super) async fn find_note_node(&self, ws_id: &str, name_or_id: &str) -> Option<Value> {
        let norm = name_or_id.trim().to_lowercase();
        if norm.is_empty() {
            return None;
        }
        let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;

        // Exact match
        for n in &nodes {
            if n.get("kind").and_then(|v| v.as_str()) == Some("note") {
                let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
                let c = n.get("content").unwrap_or(&Value::Null);
                let note_id = c.get("noteId").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
                let title = c.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
                if nid == norm || note_id == norm || title == norm {
                    return Some(n.clone());
                }
            }
        }
        // Partial match
        for n in &nodes {
            if n.get("kind").and_then(|v| v.as_str()) == Some("note") {
                let c = n.get("content").unwrap_or(&Value::Null);
                let title = c.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
                if !title.is_empty() && (title.contains(&norm) || norm.contains(&title)) {
                    return Some(n.clone());
                }
            }
        }
        None
    }

    pub(super) async fn resolve_note_input_content(
        &self,
        req: &CliRequestEnvelope,
        fallback: Option<String>,
    ) -> std::result::Result<Option<String>, String> {
        let file_opt = req.options.get("file").or_else(|| req.options.get("f"));
        if let Some(fval) = file_opt {
            let fstr = fval
                .as_str()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    "mindagentics note: a flag --file requer um caminho de arquivo válido.".to_string()
                })?;

            let base_cwd = if let Some(ref c) = req.cwd {
                PathBuf::from(c)
            } else if let Some(c) = self.pty().get_session_cwd(&req.terminal_id).await {
                c
            } else {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            };

            let resolved = if Path::new(fstr).is_absolute() {
                PathBuf::from(fstr)
            } else {
                base_cwd.join(fstr)
            };

            if !resolved.exists() {
                return Err(format!(
                    "mindagentics note: arquivo não encontrado: \"{}\"",
                    resolved.display()
                ));
            }
            let content = tokio::fs::read_to_string(&resolved).await.map_err(|e| {
                format!(
                    "mindagentics note: falha ao ler arquivo \"{}\": {e}",
                    resolved.display()
                )
            })?;
            return Ok(Some(content));
        }

        if let Some(ref s) = req.stdin {
            if !s.is_empty() {
                return Ok(Some(s.clone()));
            }
        }
        if let Some(s) = opt_str(&req.options, "stdin") {
            if !s.is_empty() {
                return Ok(Some(s));
            }
        }

        Ok(fallback)
    }

    pub(super) async fn cmd_note(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req
            .args
            .first()
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 {
            &req.args[1..]
        } else {
            &[]
        };

        if action.is_empty() || action == "help" || action == "--help" || action == "-h" || opt_bool(&req.options, "help") {
            return CliResponseEnvelope::ok(
                &req.id,
                "Uso: mindagentics note <create|read|write|edit|stack|unstack|delete|list> [argumentos] [opções]",
            );
        }

        match action.as_str() {
            "create" => {
                let explicit_name = opt_str(&req.options, "title").or_else(|| opt_str(&req.options, "name"));
                let mut title = explicit_name.clone();
                let mut fallback_content = opt_str(&req.options, "body").or_else(|| opt_str(&req.options, "content"));

                if title.is_none() && !rest.is_empty() && !rest[0].starts_with('-') {
                    title = Some(rest[0].clone());
                    if fallback_content.is_none() && rest.len() > 1 {
                        fallback_content = Some(rest[1..].join(" "));
                    }
                }

                let resolved = match self.resolve_note_input_content(req, fallback_content).await {
                    Ok(c) => c,
                    Err(e) => return CliResponseEnvelope::err(&req.id, e),
                };

                let mut content = resolved
                    .or_else(|| opt_str(&req.options, "body"))
                    .or_else(|| opt_str(&req.options, "content"))
                    .unwrap_or_default();

                let final_title = title.unwrap_or_else(|| {
                    let first = content
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .trim_start_matches('#')
                        .trim();
                    if first.is_empty() {
                        let short = short_id(&uuid::Uuid::new_v4().to_string(), 6);
                        format!("Note-{short}")
                    } else {
                        first.to_string()
                    }
                });

                if content.is_empty() {
                    content = final_title.clone();
                }

                let stack = opt_str(&req.options, "stack");
                let color = opt_str(&req.options, "color").unwrap_or_else(|| "yellow".to_string());
                let note_id = uuid::Uuid::new_v4().to_string();
                let node_id = format!("node-note-{}", short_id(&note_id, 8));

                let caller_node_id = self.resolve_caller_node_id(ws_id, &req.terminal_id).await;
                let (existing_nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let (x, y) = place_node(320.0, 280.0, &existing_nodes, Some(&caller_node_id), "right");

                let note_node = json!({
                    "id": node_id,
                    "kind": "note",
                    "x": x,
                    "y": y,
                    "width": 320,
                    "height": 280,
                    "zIndex": 10,
                    "content": {
                        "noteId": note_id,
                        "title": final_title,
                        "isNamePinned": explicit_name.is_some(),
                        "color": color,
                        "stackId": stack,
                        "text": content,
                        "body": content,
                        "locked": false,
                    }
                });

                self.write_note_files(ws_id, &note_id, &content).await;
                self.persist_node_to_workspace(ws_id, &note_node).await;

                if !caller_node_id.is_empty() {
                    let tie_id = format!("tie-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
                    let tie = json!({
                        "id": tie_id,
                        "fromNodeId": caller_node_id,
                        "toNodeId": node_id,
                        "label": "Connected Note",
                    });
                    self.persist_tie_to_workspace(ws_id, &tie).await;
                    self.emit_event("mindagentics:canvas:cableTieCreated", tie);
                }

                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({
                        "workspaceId": ws_id,
                        "node": note_node,
                    }),
                );

                // Manage NoteStackNode if --stack specified
                if let Some(ref stack_name) = stack {
                    self.upsert_note_into_stack(ws_id, &caller_node_id, stack_name, &note_id, &final_title, &content, &color)
                        .await;
                }

                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!(
                        "Created note \"{}\" (ID: {}) [color: {}]{}. Placed and connected on canvas.",
                        final_title,
                        short_id(&note_id, 8),
                        color,
                        stack
                            .as_ref()
                            .map(|s| format!(" in stack \"{s}\""))
                            .unwrap_or_default()
                    ),
                    json!({ "title": final_title, "noteId": note_id, "nodeId": node_id }),
                )
            }

            "read" => {
                let note_name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim(),
                    _ => {
                        return CliResponseEnvelope::err(
                            &req.id,
                            "mindagentics note read: note name required. Usage: mindagentics note read \"Note Name\" [startLine] [count]",
                        );
                    }
                };

                let node = self.find_note_node(ws_id, note_name).await;
                let (note_id, inline_text) = if let Some(ref n) = node {
                    let c = n.get("content").unwrap_or(&Value::Null);
                    let nid = c.get("noteId").and_then(|v| v.as_str()).unwrap_or(note_name).to_string();
                    let txt = c
                        .get("body")
                        .or_else(|| c.get("text"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    (nid, txt)
                } else {
                    (note_name.to_string(), None)
                };

                let disk_text = self.read_note_files(ws_id, &note_id).await;
                let text = match (disk_text, inline_text) {
                    (Some(d), _) if !d.is_empty() => d,
                    (_, Some(i)) => i,
                    _ => {
                        return CliResponseEnvelope::err(
                            &req.id,
                            format!("Note \"{note_name}\" not found. Run \"mindagentics list\" to see connected notes."),
                        );
                    }
                };

                let lines: Vec<&str> = text.split('\n').collect();
                let start_line: usize = rest.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
                let count: usize = rest.get(2).and_then(|s| s.parse().ok()).unwrap_or(lines.len());
                let slice_start = start_line.saturating_sub(1).min(lines.len());
                let slice_end = slice_start.saturating_add(count).min(lines.len());

                let numbered: Vec<String> = lines[slice_start..slice_end]
                    .iter()
                    .enumerate()
                    .map(|(idx, l)| format!("{:>4} | {}", slice_start + idx + 1, l))
                    .collect();

                CliResponseEnvelope::ok(&req.id, numbered.join("\n"))
            }

            "write" => {
                let note_name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim(),
                    _ => {
                        return CliResponseEnvelope::err(
                            &req.id,
                            "mindagentics note write: note name required. Usage: mindagentics note write \"Note Name\" [\"content\"] [--file <path>]",
                        );
                    }
                };

                let fallback = if rest.len() > 1 {
                    rest[1..].join(" ")
                } else {
                    opt_str(&req.options, "content")
                        .or_else(|| opt_str(&req.options, "body"))
                        .unwrap_or_default()
                };

                let new_content = match self.resolve_note_input_content(req, Some(fallback)).await {
                    Ok(c) => c.unwrap_or_default(),
                    Err(e) => return CliResponseEnvelope::err(&req.id, e),
                };

                let mut node = match self.find_note_node(ws_id, note_name).await {
                    Some(n) => n,
                    None => {
                        return CliResponseEnvelope::err(
                            &req.id,
                            format!("Note \"{note_name}\" not found."),
                        );
                    }
                };

                let locked = node
                    .get("content")
                    .and_then(|c| c.get("locked"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let current_title = node
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(note_name)
                    .to_string();

                if locked {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("Cannot write to \"{current_title}\": note is locked (read-only)."),
                    );
                }

                let note_id = node
                    .get("content")
                    .and_then(|c| c.get("noteId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(note_name)
                    .to_string();

                let mut msg = format!("Updated note \"{current_title}\".");
                if let Some(c) = node.get_mut("content").and_then(|v| v.as_object_mut()) {
                    c.insert("text".to_string(), Value::String(new_content.clone()));
                    c.insert("body".to_string(), Value::String(new_content.clone()));

                    let is_pinned = c
                        .get("isNamePinned")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if !is_pinned {
                        let first_line = new_content
                            .lines()
                            .next()
                            .unwrap_or_default()
                            .trim_start_matches('#')
                            .trim()
                            .to_string();
                        if !first_line.is_empty() && first_line != current_title {
                            c.insert("title".to_string(), Value::String(first_line.clone()));
                            msg.push_str(&format!(
                                " Note automatically renamed from \"{current_title}\" to \"{first_line}\"."
                            ));
                        }
                    }
                }

                self.write_note_files(ws_id, &note_id, &new_content).await;
                self.persist_node_to_workspace(ws_id, &node).await;
                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": node }),
                );

                CliResponseEnvelope::ok(&req.id, msg)
            }

            "edit" => {
                let note_name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                let old_text = rest.get(1);
                let new_text = rest.get(2).map(|s| s.as_str()).unwrap_or("");
                if note_name.is_empty() || old_text.is_none() {
                    return CliResponseEnvelope::err(
                        &req.id,
                        "mindagentics note edit: required args missing. Usage: mindagentics note edit \"Note Name\" \"old text\" \"new text\"",
                    );
                }
                let Some(old_text) = old_text else {
                    return CliResponseEnvelope::err(&req.id, "mindagentics note edit: missing old text");
                };

                let mut node = match self.find_note_node(ws_id, note_name).await {
                    Some(n) => n,
                    None => return CliResponseEnvelope::err(&req.id, format!("Note \"{note_name}\" not found.")),
                };

                let locked = node
                    .get("content")
                    .and_then(|c| c.get("locked"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let title = node
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(note_name)
                    .to_string();
                if locked {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("Cannot edit \"{title}\": note is locked (read-only)."),
                    );
                }

                let note_id = node
                    .get("content")
                    .and_then(|c| c.get("noteId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(note_name)
                    .to_string();
                let current_text = match self.read_note_files(ws_id, &note_id).await {
                    Some(t) => t,
                    None => node
                        .get("content")
                        .and_then(|c| c.get("body").or_else(|| c.get("text")))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                };

                if !current_text.contains(old_text.as_str()) {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("Target substring not found in note \"{title}\"."),
                    );
                }
                let updated = current_text.replacen(old_text.as_str(), new_text, 1);
                if let Some(c) = node.get_mut("content").and_then(|v| v.as_object_mut()) {
                    c.insert("text".to_string(), Value::String(updated.clone()));
                    c.insert("body".to_string(), Value::String(updated.clone()));
                }

                self.write_note_files(ws_id, &note_id, &updated).await;
                self.persist_node_to_workspace(ws_id, &node).await;
                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": node }),
                );

                CliResponseEnvelope::ok(&req.id, format!("Successfully updated note \"{title}\"."))
            }

            "stack" => {
                let note_name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics note stack: note name required."),
                };
                let stack_name = rest
                    .get(1)
                    .cloned()
                    .or_else(|| opt_str(&req.options, "stack"))
                    .unwrap_or_else(|| "Fichário".to_string());

                let mut node = match self.find_note_node(ws_id, note_name).await {
                    Some(n) => n,
                    None => return CliResponseEnvelope::err(&req.id, format!("Note \"{note_name}\" not found.")),
                };

                let (note_id, title, body, color) = {
                    let c = node.get("content").unwrap_or(&Value::Null);
                    (
                        c.get("noteId").and_then(|v| v.as_str()).unwrap_or(note_name).to_string(),
                        c.get("title").and_then(|v| v.as_str()).unwrap_or(note_name).to_string(),
                        c.get("body").or_else(|| c.get("text")).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        c.get("color").and_then(|v| v.as_str()).unwrap_or("yellow").to_string(),
                    )
                };

                if let Some(c) = node.get_mut("content").and_then(|v| v.as_object_mut()) {
                    c.insert("stackId".to_string(), Value::String(stack_name.clone()));
                }
                self.persist_node_to_workspace(ws_id, &node).await;

                let caller_node_id = self.resolve_caller_node_id(ws_id, &req.terminal_id).await;
                self.upsert_note_into_stack(ws_id, &caller_node_id, &stack_name, &note_id, &title, &body, &color)
                    .await;

                CliResponseEnvelope::ok(
                    &req.id,
                    format!("Filed note \"{title}\" into stack \"{stack_name}\". Placed on canvas."),
                )
            }

            "unstack" => {
                let note_name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics note unstack: note name required."),
                };
                let mut node = match self.find_note_node(ws_id, note_name).await {
                    Some(n) => n,
                    None => return CliResponseEnvelope::err(&req.id, format!("Note \"{note_name}\" not found.")),
                };
                let prev_stack = node
                    .get("content")
                    .and_then(|c| c.get("stackId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("stack")
                    .to_string();
                let title = node
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(note_name)
                    .to_string();

                if let Some(c) = node.get_mut("content").and_then(|v| v.as_object_mut()) {
                    c.insert("stackId".to_string(), Value::Null);
                }
                self.persist_node_to_workspace(ws_id, &node).await;
                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": node }),
                );

                CliResponseEnvelope::ok(
                    &req.id,
                    format!("Unstacked note \"{title}\" from \"{prev_stack}\"."),
                )
            }

            "delete" => {
                let note_name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics note delete: note name required."),
                };
                let node = match self.find_note_node(ws_id, note_name).await {
                    Some(n) => n,
                    None => return CliResponseEnvelope::err(&req.id, format!("Note \"{note_name}\" not found.")),
                };
                let node_id = node.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let title = node
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(note_name)
                    .to_string();
                let note_id = node
                    .get("content")
                    .and_then(|c| c.get("noteId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                if !note_id.is_empty() {
                    let disk_path = self.note_disk_path(ws_id, note_id).await;
                    let _ = tokio::fs::remove_file(disk_path).await;
                }

                self.remove_node_from_workspace(ws_id, &node_id).await;
                self.emit_event(
                    "mindagentics:canvas:nodeDeleted",
                    json!({ "workspaceId": ws_id, "nodeId": node_id }),
                );

                CliResponseEnvelope::ok(&req.id, format!("Deleted note \"{title}\" from canvas."))
            }

            "list" => {
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let mut notes = Vec::new();
                let mut stacks = Vec::new();
                for n in &nodes {
                    let kind = n.get("kind").and_then(|v| v.as_str()).unwrap_or_default();
                    let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                    let c = n.get("content").unwrap_or(&Value::Null);
                    if kind == "note" {
                        let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("Sem título");
                        let color = c.get("color").and_then(|v| v.as_str()).unwrap_or("yellow");
                        let stack = c
                            .get("stackId")
                            .and_then(|v| v.as_str())
                            .map(|s| format!(", no fichário: \"{s}\""))
                            .unwrap_or_default();
                        notes.push(format!("- [Nota] \"{title}\" (ID: {nid}, cor: {color}{stack})"));
                    } else if kind == "noteStack" {
                        let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("Fichário");
                        let count = c
                            .get("pages")
                            .and_then(|v| v.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0);
                        stacks.push(format!("- [Fichário] \"{title}\" (ID: {nid}, páginas: {count})"));
                    }
                }
                let total = notes.len() + stacks.len();
                if total == 0 {
                    return CliResponseEnvelope::ok(
                        &req.id,
                        "Nenhuma nota ou fichário encontrado no workspace atual.",
                    );
                }
                let mut out = vec![format!(
                    "Total no canvas: {total} ({} notas, {} fichários)",
                    notes.len(),
                    stacks.len()
                )];
                if !stacks.is_empty() {
                    out.push("\nFichários:".to_string());
                    out.extend(stacks);
                }
                if !notes.is_empty() {
                    out.push("\nNotas:".to_string());
                    out.extend(notes);
                }
                CliResponseEnvelope::ok(&req.id, out.join("\n"))
            }

            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown note subcommand: \"{action}\". Valid: create, read, write, edit, stack, unstack, delete, list, help."),
            ),
        }
    }

    pub(super) async fn upsert_note_into_stack(
        &self,
        ws_id: &str,
        caller_node_id: &str,
        stack_name: &str,
        note_id: &str,
        title: &str,
        body: &str,
        color: &str,
    ) {
        let (existing_nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
        let existing_stack = existing_nodes.iter().find(|n| {
            n.get("kind").and_then(|v| v.as_str()) == Some("noteStack")
                && (n
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(stack_name))
                    .unwrap_or(false)
                    || n.get("content")
                        .and_then(|c| c.get("stackId"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.eq_ignore_ascii_case(stack_name))
                        .unwrap_or(false))
        });

        let stack_node = if let Some(mut st) = existing_stack.cloned() {
            if let Some(c) = st.get_mut("content").and_then(|v| v.as_object_mut()) {
                let mut pages = c
                    .get("pages")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let already = pages.iter().any(|p| {
                    p.get("id").and_then(|v| v.as_str()) == Some(note_id)
                        || p.get("title").and_then(|v| v.as_str()) == Some(title)
                });
                if !already {
                    pages.push(json!({
                        "id": note_id,
                        "title": title,
                        "body": body,
                        "color": color,
                    }));
                }
                let note_ids: Vec<Value> = pages
                    .iter()
                    .filter_map(|p| p.get("id").cloned())
                    .collect();
                c.insert("pages".to_string(), Value::Array(pages));
                c.insert("noteIds".to_string(), Value::Array(note_ids));
            }
            st
        } else {
            let (sx, sy) = place_node(380.0, 340.0, &existing_nodes, Some(caller_node_id), "right");
            let stack_id = format!("stack-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
            json!({
                "id": format!("node-stack-{}", short_id(&stack_id, 8)),
                "kind": "noteStack",
                "x": sx,
                "y": sy,
                "width": 380,
                "height": 340,
                "zIndex": 11,
                "content": {
                    "stackId": stack_id,
                    "title": stack_name,
                    "noteIds": [note_id],
                    "activePageIndex": 0,
                    "tabOrientation": "side",
                    "pages": [{
                        "id": note_id,
                        "title": title,
                        "body": body,
                        "color": color,
                    }]
                }
            })
        };

        self.persist_node_to_workspace(ws_id, &stack_node).await;
        self.emit_event(
            "mindagentics:canvas:nodePlaced",
            json!({ "workspaceId": ws_id, "node": stack_node }),
        );
    }

    pub(super) async fn resolve_endpoint(&self, ws_id: &str, name_or_id: &str, caller_tid: &str) -> (String, String, String) {
        let norm = name_or_id.trim().to_lowercase();
        let sessions = self.pty().list_sessions_info().await;
        let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;

        if !caller_tid.is_empty() && matches!(norm.as_str(), "me" | "self" | "myself" | "caller" | "eu" | "") {
            let nid = self.resolve_caller_node_id(ws_id, caller_tid).await;
            let title = sessions
                .iter()
                .find(|s| s.id == caller_tid)
                .map(|s| s.title.clone())
                .unwrap_or_else(|| "Me".to_string());
            return (nid, title, "agent".to_string());
        }

        if let Some(tid) = self.pty().find_session_id_by_name_or_id(name_or_id, Some(ws_id)).await {
            let nid = self.resolve_caller_node_id(ws_id, &tid).await;
            let title = sessions
                .iter()
                .find(|s| s.id == tid)
                .map(|s| s.title.clone())
                .unwrap_or_else(|| name_or_id.to_string());
            return (nid, title, "agent".to_string());
        }

        for n in &nodes {
            let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let kind = n.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown");
            let c = n.get("content").unwrap_or(&Value::Null);
            let title = c
                .get("title")
                .or_else(|| c.get("label"))
                .or_else(|| c.get("fileName"))
                .or_else(|| c.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or(kind);
            let sub_id = c
                .get("noteId")
                .or_else(|| c.get("stackId"))
                .or_else(|| c.get("portalId"))
                .or_else(|| c.get("bandId"))
                .or_else(|| c.get("terminalId"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            if nid.to_lowercase() == norm
                || title.to_lowercase() == norm
                || (!sub_id.is_empty() && sub_id.to_lowercase() == norm)
            {
                return (nid.to_string(), title.to_string(), kind.to_string());
            }
        }

        for n in &nodes {
            let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let kind = n.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown");
            let c = n.get("content").unwrap_or(&Value::Null);
            let title = c
                .get("title")
                .or_else(|| c.get("label"))
                .or_else(|| c.get("fileName"))
                .or_else(|| c.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let tl = title.to_lowercase();
            if !tl.is_empty() && (tl.contains(&norm) || norm.contains(&tl)) {
                return (nid.to_string(), title.to_string(), kind.to_string());
            }
        }

        (name_or_id.to_string(), name_or_id.to_string(), "unknown".to_string())
    }

    pub(super) async fn cmd_connect(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let mut is_disconnect = opt_bool(&req.options, "disconnect")
            || opt_bool(&req.options, "remove")
            || opt_bool(&req.options, "delete");
        let mut args = req.args.clone();
        if args.first().map(|s| s.as_str()) == Some("disconnect")
            || args.first().map(|s| s.as_str()) == Some("remove")
        {
            is_disconnect = true;
            args.remove(0);
        }

        if args.len() < 2 {
            return CliResponseEnvelope::err(
                &req.id,
                "mindagentics connect: both endpoints required. Usage: mindagentics connect \"From\" \"To\" [--label \"...\"] [--disconnect]",
            );
        }

        let (from_id, from_name, from_kind) =
            self.resolve_endpoint(ws_id, &args[0], &req.terminal_id).await;
        let (to_id, to_name, to_kind) =
            self.resolve_endpoint(ws_id, &args[1], &req.terminal_id).await;

        if is_disconnect {
            self.connections.write().await.retain(|c| {
                let f = c.get("fromNodeId").or_else(|| c.get("fromId")).and_then(|v| v.as_str()).unwrap_or_default();
                let t = c.get("toNodeId").or_else(|| c.get("toId")).and_then(|v| v.as_str()).unwrap_or_default();
                !((f == from_id && t == to_id) || (f == to_id && t == from_id))
            });
            self.emit_event(
                "mindagentics:canvas:cableTieDeleted",
                json!({
                    "workspaceId": ws_id,
                    "fromNodeId": from_id,
                    "toNodeId": to_id,
                }),
            );
            return CliResponseEnvelope::ok(
                &req.id,
                format!("Disconnected \"{from_name}\" ({from_kind}) </-> \"{to_name}\" ({to_kind})."),
            );
        }

        let label = opt_str(&req.options, "label").unwrap_or_else(|| {
            if (from_kind == "agent" && (to_kind == "portal" || to_kind == "fileRef"))
                || (to_kind == "agent" && (from_kind == "portal" || from_kind == "fileRef"))
            {
                "Reference".to_string()
            } else {
                "Cable Tie".to_string()
            }
        });

        let tie_id = format!("tie-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
        let tie = json!({
            "id": tie_id,
            "fromNodeId": from_id,
            "toNodeId": to_id,
            "label": label,
        });
        self.persist_tie_to_workspace(ws_id, &tie).await;
        self.emit_event("mindagentics:canvas:cableTieCreated", tie.clone());

        CliResponseEnvelope::ok_with_data(
            &req.id,
            format!("Connected \"{from_name}\" ({from_kind}) <-> \"{to_name}\" ({to_kind}) [label: {label}]. Placed on canvas."),
            tie,
        )
    }

    pub(super) async fn cmd_ref(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        if action.is_empty() || action == "help" || opt_bool(&req.options, "help") {
            return CliResponseEnvelope::ok(
                &req.id,
                "mindagentics ref <add|list|remove>\n  add <caminho> [--label \"<nome>\"] [--to \"<agente>\"] [--no-connect]\n  list [--all]\n  remove <caminho|nome>",
            );
        }

        match action.as_str() {
            "add" => {
                let target = match rest.first() {
                    Some(t) if !t.trim().is_empty() => t.trim(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics ref add: caminho obrigatório."),
                };

                let ws_root = self
                    .storage_engine()
                    .list_workspaces()
                    .await
                    .ok()
                    .and_then(|list| {
                        list.into_iter()
                            .find(|w| w.id == ws_id)
                            .and_then(|w| w.root_path.or(w.working_directory))
                            .map(PathBuf::from)
                    })
                    .or_else(|| req.cwd.as_ref().map(PathBuf::from))
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

                let confirm_outside = opt_bool(&req.options, "confirm-outside")
                    || opt_bool(&req.options, "confirmOutside")
                    || opt_bool(&req.options, "force")
                    || opt_bool(&req.options, "yes")
                    || opt_bool(&req.options, "y");

                let check = resolve_workspace_path(&ws_root, target, confirm_outside);
                if !check.ok {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("mindagentics ref add: {}", check.message.unwrap_or_default()),
                    );
                }
                let Some(abs_path) = check.path else {
                    return CliResponseEnvelope::err(&req.id, "mindagentics ref add: invalid path");
                };
                let meta = match std::fs::metadata(&abs_path) {
                    Ok(m) => m,
                    Err(_) => {
                        return CliResponseEnvelope::err(
                            &req.id,
                            format!("mindagentics ref add: caminho não encontrado: \"{}\"", abs_path.display()),
                        );
                    }
                };

                let is_dir = meta.is_dir();
                let abs_str = abs_path.to_string_lossy().to_string();
                let raw_label = opt_str(&req.options, "label").unwrap_or_else(|| {
                    abs_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| abs_str.clone())
                });
                let label = sanitize_label(&raw_label, 80);

                let (existing_nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let anchor = self.resolve_caller_node_id(ws_id, &req.terminal_id).await;
                let (x, y) = place_node(140.0, 128.0, &existing_nodes, Some(&anchor), "right");
                let node_id = format!("node-ref-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));

                let ref_node = json!({
                    "id": node_id,
                    "kind": "fileRef",
                    "x": x,
                    "y": y,
                    "width": 140,
                    "height": 128,
                    "zIndex": 10,
                    "content": {
                        "path": abs_str,
                        "isDirectory": is_dir,
                        "label": label,
                    }
                });

                self.persist_node_to_workspace(ws_id, &ref_node).await;
                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": ref_node }),
                );

                let no_connect = opt_bool(&req.options, "no-connect");
                let mut connected_to = String::new();
                if !no_connect {
                    let target_tid = if let Some(to_name) = opt_str(&req.options, "to") {
                        match self.pty().find_session_id_by_name_or_id(&to_name, Some(ws_id)).await {
                            Some(id) => id,
                            None => {
                                return CliResponseEnvelope::err(
                                    &req.id,
                                    format!("mindagentics ref add: agente \"{to_name}\" não encontrado."),
                                );
                            }
                        }
                    } else {
                        req.terminal_id.clone()
                    };

                    if !target_tid.is_empty() {
                        let term_node = self.resolve_caller_node_id(ws_id, &target_tid).await;
                        let tie_id = format!("tie-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
                        let tie = json!({
                            "id": tie_id,
                            "fromNodeId": node_id,
                            "toNodeId": term_node,
                            "label": "Reference",
                        });
                        self.persist_tie_to_workspace(ws_id, &tie).await;
                        self.emit_event("mindagentics:canvas:cableTieCreated", tie);
                        connected_to = self
                            .pty()
                            .get_session_info(&target_tid)
                            .await
                            .map(|i| i.title)
                            .unwrap_or(target_tid);
                    }
                }

                let kind_label = if is_dir { "pasta" } else { "arquivo" };
                let conn_suffix = if connected_to.is_empty() {
                    String::new()
                } else {
                    format!(" — ligada a \"{connected_to}\"")
                };

                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Referência criada: {kind_label} \"{label}\" ({abs_str}){conn_suffix}."),
                    json!({
                        "nodeId": node_id,
                        "path": abs_str,
                        "isDirectory": is_dir,
                        "created": true,
                    }),
                )
            }

            "list" => {
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let mut refs = Vec::new();
                for n in &nodes {
                    if n.get("kind").and_then(|v| v.as_str()) == Some("fileRef") {
                        let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                        let c = n.get("content").unwrap_or(&Value::Null);
                        let path = c.get("path").and_then(|v| v.as_str()).unwrap_or_default();
                        let label = c.get("label").and_then(|v| v.as_str()).unwrap_or(path);
                        let is_dir = c.get("isDirectory").and_then(|v| v.as_bool()).unwrap_or(false);
                        let kind = if is_dir { "pasta" } else { "arquivo" };
                        refs.push(format!("- [{kind}] \"{label}\" {path} (ID: {nid})"));
                    }
                }
                if refs.is_empty() {
                    CliResponseEnvelope::ok_with_data(
                        &req.id,
                        "Nenhuma referência de arquivo/pasta no canvas.",
                        json!({ "refs": [] }),
                    )
                } else {
                    let mut out = vec!["Referências:".to_string()];
                    out.extend(refs);
                    CliResponseEnvelope::ok(&req.id, out.join("\n"))
                }
            }

            "remove" | "rm" | "delete" => {
                let target = match rest.first() {
                    Some(t) if !t.trim().is_empty() => t.trim().to_lowercase(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics ref remove: informe o caminho ou nome."),
                };
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let mut removed = Vec::new();
                for n in &nodes {
                    if n.get("kind").and_then(|v| v.as_str()) == Some("fileRef") {
                        let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                        let c = n.get("content").unwrap_or(&Value::Null);
                        let label = c.get("label").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
                        let path = c.get("path").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
                        if nid.to_lowercase() == target || label == target || path == target || path.ends_with(&target) {
                            self.remove_node_from_workspace(ws_id, nid).await;
                            self.emit_event(
                                "mindagentics:canvas:nodeDeleted",
                                json!({ "workspaceId": ws_id, "nodeId": nid }),
                            );
                            removed.push(nid.to_string());
                        }
                    }
                }
                if removed.is_empty() {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("mindagentics ref remove: referência \"{target}\" não encontrada."),
                    );
                }
                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Referência removida do canvas ({}).", removed.join(", ")),
                    json!({ "removed": removed }),
                )
            }

            _ => CliResponseEnvelope::err(
                &req.id,
                format!("mindagentics ref: subcomando desconhecido \"{action}\"."),
            ),
        }
    }
}
