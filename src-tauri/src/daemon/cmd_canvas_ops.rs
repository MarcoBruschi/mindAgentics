use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::git::GitEngine;
use crate::graphify::{GraphifyBuildParams, GraphifyRunner};
use crate::pty::TerminalReconfigureOptions;
use crate::security::sanitizer::sanitize_label;

use super::named_pipe::*;

impl DaemonServer {
    pub(super) async fn cmd_recruit(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let name = req
            .args
            .first()
            .cloned()
            .or_else(|| opt_str(&req.options, "name"));

        if let Some(replace_target) = opt_str(&req.options, "replace") {
            let target_id = match self
                .pty()
                .find_session_id_by_name_or_id(&replace_target, Some(ws_id))
                .await
            {
                Some(id) => id,
                None => {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("Recruit \"{replace_target}\" to replace not found."),
                    );
                }
            };

            let mut opts = TerminalReconfigureOptions::default();
            opts.terminal_id = Some(target_id.clone());
            opts.title = name.clone();
            opts.preset_id = opt_str(&req.options, "preset");
            opts.agent_role = opt_str(&req.options, "role");
            opts.restart = Some(true);
            if let Some(ref p) = opts.preset_id {
                let (_, cmd) = self.resolve_preset_command(p).await;
                if !cmd.is_empty() {
                    opts.command = Some(cmd);
                }
            }

            let _ = self.pty().reconfigure(Some(&target_id), opts).await;
            return CliResponseEnvelope::ok_with_data(
                &req.id,
                format!("Replaced agent on terminal \"{replace_target}\" in place. Process restarted."),
                json!({ "terminalId": target_id, "title": name }),
            );
        }

        let name = match name {
            Some(n) if !n.trim().is_empty() => sanitize_label(&n, 80),
            _ => {
                return CliResponseEnvelope::err(
                    &req.id,
                    "mindagentics recruit: name required. Usage: mindagentics recruit \"Name\" [--preset \"...\"] [--role \"...\"]",
                );
            }
        };

        let raw_preset = opt_str(&req.options, "preset").unwrap_or_else(|| "Claude Code".to_string());
        let role = opt_str(&req.options, "role").map(|r| sanitize_label(&r, 200));
        let floor = opt_str(&req.options, "floor")
            .or_else(|| req.floor_id.clone())
            .unwrap_or_else(|| "ground".to_string());
        let target_ws = opt_str(&req.options, "workspace").unwrap_or_else(|| ws_id.to_string());
        let account = opt_str(&req.options, "account");

        let (preset_name, command) = self.resolve_preset_command(&raw_preset).await;

        let terminal_id = uuid::Uuid::new_v4().to_string();
        let node_id = format!("node-term-{}", short_id(&terminal_id, 8));
        let caller_node_id = self.resolve_caller_node_id(&target_ws, &req.terminal_id).await;
        let (existing_nodes, _) = self.get_workspace_nodes_and_ties(&target_ws).await;
        let (x, y) = place_node(640.0, 480.0, &existing_nodes, Some(&caller_node_id), "right");

        let term_node = json!({
            "id": node_id,
            "kind": "terminal",
            "x": x,
            "y": y,
            "width": 640,
            "height": 480,
            "zIndex": 10,
            "content": {
                "terminalId": terminal_id,
                "workspaceId": target_ws,
                "floorId": floor,
                "presetId": preset_name,
                "title": name,
                "agentRole": role,
                "account": account,
                "command": command,
                "orchestratorMode": false,
                "maestroMode": false,
                "status": "idle",
            }
        });

        self.persist_node_to_workspace(&target_ws, &term_node).await;

        if !caller_node_id.is_empty() {
            let tie_id = format!("tie-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
            let tie = json!({
                "id": tie_id,
                "fromNodeId": caller_node_id,
                "toNodeId": node_id,
                "label": "Teammate",
            });
            self.persist_tie_to_workspace(&target_ws, &tie).await;
            self.emit_event("mindagentics:canvas:cableTieCreated", tie);
        }

        self.emit_event(
            "mindagentics:canvas:nodePlaced",
            json!({
                "workspaceId": target_ws,
                "node": term_node,
                "terminalId": terminal_id,
                "presetId": preset_name,
                "title": name,
                "agentRole": role,
                "command": command,
            }),
        );

        let role_suffix = role
            .as_ref()
            .map(|r| format!(" [role: {r}]"))
            .unwrap_or_default();

        CliResponseEnvelope::ok_with_data(
            &req.id,
            format!(
                "Recruited teammate \"{name}\" [preset: {preset_name}]{role_suffix} (ID: {}). Auto-connected.",
                short_id(&terminal_id, 8)
            ),
            json!({
                "terminalId": terminal_id,
                "nodeId": node_id,
                "name": name,
                "presetId": preset_name,
                "command": command,
            }),
        )
    }

    pub(super) async fn resolve_preset_command(&self, raw_preset: &str) -> (String, String) {
        let raw_lower = raw_preset.to_lowercase();
        let presets = self.presets.read().await;
        for (p_name, p_obj) in presets.iter() {
            let p_lower = p_name.to_lowercase();
            let type_lower = p_obj
                .get("agentType")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_lowercase();
            if p_lower == raw_lower
                || type_lower == raw_lower
                || (raw_lower == "agy" && p_lower.contains("antigravity"))
                || (raw_lower == "claude" && p_lower.contains("claude"))
                || (raw_lower == "codex" && p_lower.contains("codex"))
                || (raw_lower == "opencode" && p_lower.contains("opencode"))
            {
                let cmd = p_obj
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                return (p_name.clone(), cmd);
            }
        }

        let fallback_cmd = if raw_lower.contains("antigravity") || raw_lower == "agy" {
            "agy".to_string()
        } else if raw_lower.contains("codex") {
            "codex --no-daemon".to_string()
        } else if raw_lower.contains("claude") {
            "claude".to_string()
        } else if raw_lower.contains("opencode") {
            "opencode".to_string()
        } else {
            String::new()
        };
        (raw_preset.to_string(), fallback_cmd)
    }

    pub(super) async fn is_caller_orchestrator(&self, req: &CliRequestEnvelope, ws_id: &str) -> bool {
        let sessions = self.pty().list_sessions_info().await;
        if let Some(caller) = sessions.iter().find(|s| s.id == req.terminal_id) {
            return caller.orchestrator_mode;
        }
        if !req.terminal_id.is_empty() {
            let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
            for n in &nodes {
                if n.get("kind").and_then(|v| v.as_str()) == Some("terminal") {
                    let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                    let tid = n
                        .get("content")
                        .and_then(|c| c.get("terminalId"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    if nid == req.terminal_id || tid == req.terminal_id {
                        if let Some(orch) = n
                            .get("content")
                            .and_then(|c| c.get("orchestratorMode").or_else(|| c.get("maestroMode")))
                            .and_then(|v| v.as_bool())
                        {
                            return orch;
                        }
                    }
                }
            }
        }
        opt_bool(&req.options, "orchestratorMode") || opt_bool(&req.options, "maestroMode")
    }

    pub(super) async fn cmd_dismiss(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        if !self.is_caller_orchestrator(req, ws_id).await {
            return CliResponseEnvelope::err(
                &req.id,
                "Permission denied: \"dismiss\" is an orchestrator-only command (orchestratorMode=false).",
            );
        }

        let name = match req.args.first() {
            Some(n) if !n.trim().is_empty() => n.trim(),
            _ => {
                return CliResponseEnvelope::err(
                    &req.id,
                    "mindagentics dismiss: agent name required. Usage: mindagentics dismiss \"Name\"",
                );
            }
        };

        let target_id = match self
            .pty()
            .find_session_id_by_name_or_id(name, Some(ws_id))
            .await
        {
            Some(id) => id,
            None => return CliResponseEnvelope::err(&req.id, format!("Agent \"{name}\" not found.")),
        };

        let title = self
            .pty()
            .get_session_info(&target_id)
            .await
            .map(|i| i.title)
            .unwrap_or_else(|| name.to_string());

        let _ = self.pty().kill(&target_id).await;

        let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
        let removed_node_id = nodes
            .iter()
            .find(|n| {
                n.get("kind").and_then(|v| v.as_str()) == Some("terminal")
                    && (n
                        .get("content")
                        .and_then(|c| c.get("terminalId"))
                        .and_then(|v| v.as_str())
                        == Some(target_id.as_str())
                        || n.get("id").and_then(|v| v.as_str()) == Some(target_id.as_str()))
            })
            .and_then(|n| n.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        if let Some(ref nid) = removed_node_id {
            self.remove_node_from_workspace(ws_id, nid).await;
            self.emit_event(
                "mindagentics:canvas:nodeDeleted",
                json!({
                    "workspaceId": ws_id,
                    "nodeId": nid,
                    "terminalId": target_id,
                }),
            );
        } else {
            self.emit_event(
                "mindagentics:canvas:nodeDeleted",
                json!({
                    "workspaceId": ws_id,
                    "nodeId": target_id,
                    "terminalId": target_id,
                }),
            );
        }

        CliResponseEnvelope::ok(
            &req.id,
            format!("Dismissed teammate \"{title}\". Terminal removed from canvas."),
        )
    }

    pub(super) async fn cmd_portal(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        match action.as_str() {
            "open" | "create" => {
                let mut url = rest
                    .first()
                    .cloned()
                    .or_else(|| opt_str(&req.options, "url"))
                    .unwrap_or_else(|| "about:blank".to_string());
                if url != "about:blank" && !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("file:///") && url.contains('.') {
                    url = format!("https://{url}");
                }
                let explicit_name = opt_str(&req.options, "name")
                    .or_else(|| opt_str(&req.options, "title"))
                    .or_else(|| rest.get(1).cloned());
                let title = explicit_name.unwrap_or_else(|| {
                    url.strip_prefix("https://")
                        .or_else(|| url.strip_prefix("http://"))
                        .and_then(|s| s.split('/').next())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("Web Portal")
                        .to_string()
                });

                let (width, height) = if let Some(size) = opt_str(&req.options, "size") {
                    let parts: Vec<f64> = size.split('x').filter_map(|p| p.parse().ok()).collect();
                    if parts.len() == 2 { (parts[0], parts[1]) } else { (1280.0, 800.0) }
                } else {
                    (1280.0, 800.0)
                };

                let portal_id = uuid::Uuid::new_v4().to_string();
                let node_id = format!("node-portal-{}", short_id(&portal_id, 8));
                let caller_node_id = self.resolve_caller_node_id(ws_id, &req.terminal_id).await;
                let (existing_nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let (x, y) = place_node(width, height, &existing_nodes, Some(&caller_node_id), "right");

                let portal_node = json!({
                    "id": node_id,
                    "kind": "portal",
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "zIndex": 12,
                    "content": {
                        "portalId": portal_id,
                        "portalKind": "browser",
                        "url": url,
                        "title": title,
                        "viewport": { "width": width, "height": height },
                    }
                });

                self.persist_node_to_workspace(ws_id, &portal_node).await;

                if !caller_node_id.is_empty() {
                    let tie_id = format!("tie-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
                    let label = if action == "open" { "Reference" } else { "Driver" };
                    let tie = json!({
                        "id": tie_id,
                        "fromNodeId": caller_node_id,
                        "toNodeId": node_id,
                        "label": label,
                    });
                    self.persist_tie_to_workspace(ws_id, &tie).await;
                    self.emit_event("mindagentics:canvas:cableTieCreated", tie);
                }

                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": portal_node }),
                );

                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Opened portal \"{title}\" [url: {url}] ({}x{}). Linked to canvas.", width as u32, height as u32),
                    json!({ "portalId": portal_id, "nodeId": node_id, "title": title, "url": url }),
                )
            }

            "navigate" => {
                let portal_name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                let url = rest.get(1).cloned().or_else(|| opt_str(&req.options, "url")).unwrap_or_default();
                if portal_name.is_empty() || url.is_empty() {
                    return CliResponseEnvelope::err(&req.id, "mindagentics portal navigate: portal name and url required.");
                }
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let norm = portal_name.to_lowercase();
                if let Some(mut node) = nodes.into_iter().find(|n| {
                    n.get("kind").and_then(|v| v.as_str()) == Some("portal")
                        && (n.get("id").and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case(&norm)).unwrap_or(false)
                            || n.get("content").and_then(|c| c.get("title")).and_then(|v| v.as_str()).map(|s| s.to_lowercase().contains(&norm)).unwrap_or(false))
                }) {
                    if let Some(c) = node.get_mut("content").and_then(|v| v.as_object_mut()) {
                        c.insert("url".to_string(), Value::String(url.clone()));
                    }
                    self.persist_node_to_workspace(ws_id, &node).await;
                    self.emit_event(
                        "mindagentics:canvas:nodePlaced",
                        json!({ "workspaceId": ws_id, "node": node }),
                    );
                }
                CliResponseEnvelope::ok(&req.id, format!("Navigated \"{portal_name}\" to {url}"))
            }

            "list" => {
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let portals: Vec<String> = nodes
                    .iter()
                    .filter(|n| n.get("kind").and_then(|v| v.as_str()) == Some("portal"))
                    .map(|n| {
                        let nid = n.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                        let c = n.get("content").unwrap_or(&Value::Null);
                        let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("Portal");
                        let url = c.get("url").and_then(|v| v.as_str()).unwrap_or("blank");
                        format!("  * \"{title}\" -> {url} (ID: {nid})")
                    })
                    .collect();
                if portals.is_empty() {
                    CliResponseEnvelope::ok(&req.id, "No portals active on canvas.")
                } else {
                    CliResponseEnvelope::ok(&req.id, format!("Portals:\n{}", portals.join("\n")))
                }
            }

            "close" => {
                let portal_name = rest.first().map(|s| s.to_lowercase()).unwrap_or_default();
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                if let Some(node) = nodes.into_iter().find(|n| {
                    n.get("kind").and_then(|v| v.as_str()) == Some("portal")
                        && (n.get("id").and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case(&portal_name)).unwrap_or(false)
                            || n.get("content").and_then(|c| c.get("title")).and_then(|v| v.as_str()).map(|s| s.to_lowercase().contains(&portal_name)).unwrap_or(false))
                }) {
                    let nid = node.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    self.remove_node_from_workspace(ws_id, &nid).await;
                    self.emit_event(
                        "mindagentics:canvas:nodeDeleted",
                        json!({ "workspaceId": ws_id, "nodeId": nid }),
                    );
                    CliResponseEnvelope::ok(&req.id, format!("Closed portal \"{portal_name}\"."))
                } else {
                    CliResponseEnvelope::err(&req.id, format!("Portal \"{portal_name}\" not found."))
                }
            }

            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown portal action: \"{action}\". Valid: open, navigate, list, close."),
            ),
        }
    }

    pub(super) async fn cmd_band(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        match action.as_str() {
            "create" => {
                let name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim().to_string(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics band create: name required."),
                };
                let without_me = opt_bool(&req.options, "without-me");
                let mut member_ids = Vec::new();
                if !without_me && !req.terminal_id.is_empty() {
                    member_ids.push(req.terminal_id.clone());
                }

                if rest.len() > 1 {
                    for m in &rest[1..] {
                        if let Some(tid) = self.pty().find_session_id_by_name_or_id(m, Some(ws_id)).await {
                            if !member_ids.contains(&tid) {
                                member_ids.push(tid);
                            }
                        }
                    }
                } else {
                    for s in self.pty().list_sessions_info().await {
                        if s.workspace_id == ws_id && !member_ids.contains(&s.id) {
                            member_ids.push(s.id);
                        }
                    }
                }

                let band_id = uuid::Uuid::new_v4().to_string();
                let node_id = format!("node-band-{}", short_id(&band_id, 8));
                let color = opt_str(&req.options, "color")
                    .unwrap_or_else(|| "rgba(59, 130, 246, 0.15)".to_string());
                let icon = opt_str(&req.options, "icon");

                let band_node = json!({
                    "id": node_id,
                    "kind": "band",
                    "x": 50,
                    "y": 100,
                    "width": 1100,
                    "height": 550,
                    "zIndex": 1,
                    "content": {
                        "bandId": band_id,
                        "title": name,
                        "color": color,
                        "icon": icon,
                        "memberNodeIds": member_ids,
                    }
                });

                self.persist_node_to_workspace(ws_id, &band_node).await;
                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": band_node }),
                );
                self.emit_event(
                    "mindagentics:canvas:bandCreated",
                    json!({
                        "workspaceId": ws_id,
                        "bandId": band_id,
                        "nodeId": node_id,
                        "name": name,
                        "memberIds": member_ids,
                        "bandNode": band_node,
                    }),
                );

                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Created band \"{name}\" with {} member(s).", member_ids.len()),
                    json!({ "bandId": band_id, "nodeId": node_id, "name": name, "memberIds": member_ids }),
                )
            }

            "add" | "remove" => {
                if rest.len() < 2 {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("mindagentics band {action}: band name and agent name required."),
                    );
                }
                let band_name = rest[0].to_lowercase();
                let agent_name = &rest[1];
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let mut band_node = match nodes.into_iter().find(|n| {
                    n.get("kind").and_then(|v| v.as_str()) == Some("band")
                        && (n.get("id").and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case(&band_name)).unwrap_or(false)
                            || n.get("content").and_then(|c| c.get("title")).and_then(|v| v.as_str()).map(|s| s.to_lowercase().contains(&band_name)).unwrap_or(false))
                }) {
                    Some(b) => b,
                    None => return CliResponseEnvelope::err(&req.id, format!("Band \"{}\" not found.", rest[0])),
                };

                let target_id = self
                    .pty()
                    .find_session_id_by_name_or_id(agent_name, Some(ws_id))
                    .await
                    .unwrap_or_else(|| agent_name.clone());

                let band_title = band_node
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&rest[0])
                    .to_string();

                if let Some(c) = band_node.get_mut("content").and_then(|v| v.as_object_mut()) {
                    let mut members: Vec<String> = c
                        .get("memberNodeIds")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default();
                    if action == "add" {
                        if !members.contains(&target_id) {
                            members.push(target_id.clone());
                        }
                    } else {
                        members.retain(|id| id != &target_id && id != agent_name);
                    }
                    c.insert(
                        "memberNodeIds".to_string(),
                        Value::Array(members.into_iter().map(Value::String).collect()),
                    );
                }

                self.persist_node_to_workspace(ws_id, &band_node).await;
                self.emit_event(
                    "mindagentics:canvas:nodePlaced",
                    json!({ "workspaceId": ws_id, "node": band_node }),
                );
                self.emit_event(
                    "mindagentics:canvas:bandUpdated",
                    json!({ "workspaceId": ws_id, "bandNode": band_node }),
                );

                let verb = if action == "add" { "Added" } else { "Removed" };
                let prep = if action == "add" { "to" } else { "from" };
                CliResponseEnvelope::ok(&req.id, format!("{verb} \"{agent_name}\" {prep} band \"{band_title}\"."))
            }

            "dissolve" => {
                let band_name = match rest.first() {
                    Some(n) if !n.trim().is_empty() => n.trim().to_lowercase(),
                    _ => return CliResponseEnvelope::err(&req.id, "mindagentics band dissolve: band name required."),
                };
                let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
                let band_node = match nodes.into_iter().find(|n| {
                    n.get("kind").and_then(|v| v.as_str()) == Some("band")
                        && (n.get("id").and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case(&band_name)).unwrap_or(false)
                            || n.get("content").and_then(|c| c.get("title")).and_then(|v| v.as_str()).map(|s| s.to_lowercase().contains(&band_name)).unwrap_or(false))
                }) {
                    Some(b) => b,
                    None => return CliResponseEnvelope::err(&req.id, format!("Band \"{}\" not found.", rest[0])),
                };

                let node_id = band_node.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let band_id = band_node
                    .get("content")
                    .and_then(|c| c.get("bandId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&node_id)
                    .to_string();
                let title = band_node
                    .get("content")
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&band_name)
                    .to_string();

                self.remove_node_from_workspace(ws_id, &node_id).await;
                self.emit_event(
                    "mindagentics:canvas:nodeDeleted",
                    json!({ "workspaceId": ws_id, "nodeId": node_id }),
                );
                self.emit_event(
                    "mindagentics:canvas:bandDissolved",
                    json!({ "workspaceId": ws_id, "bandId": band_id, "nodeId": node_id }),
                );

                CliResponseEnvelope::ok(
                    &req.id,
                    format!("Dissolved band \"{title}\". Members returned to free canvas."),
                )
            }

            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown band action: \"{action}\". Valid: create, add, remove, dissolve."),
            ),
        }
    }

    pub(super) async fn cmd_workspace(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        match action.as_str() {
            "list" => {
                let list = self.storage_engine().list_workspaces().await.unwrap_or_default();
                let mut lines = vec!["Workspaces:".to_string()];
                for ws in &list {
                    let cur = if ws.id == ws_id { " * [current]" } else { "" };
                    let root_display = ws
                        .root_path
                        .as_deref()
                        .or(ws.working_directory.as_deref())
                        .unwrap_or("");
                    lines.push(format!("  * \"{}\" ({}){cur}", ws.name, root_display));
                }
                CliResponseEnvelope::ok_with_data(&req.id, lines.join("\n"), json!({ "workspaces": list }))
            }
            "create" => {
                let name = rest.first().cloned().unwrap_or_default();
                let dir = opt_str(&req.options, "dir").unwrap_or_default();
                if name.is_empty() || dir.is_empty() {
                    return CliResponseEnvelope::err(
                        &req.id,
                        "mindagentics workspace create: name and --dir required.",
                    );
                }
                match self
                    .storage_engine()
                    .create_workspace(json!({
                        "name": name,
                        "workingDirectory": dir,
                        "rootPath": dir,
                    }))
                    .await
                {
                    Ok(ws) => {
                        let root_display = ws
                            .root_path
                            .as_deref()
                            .or(ws.working_directory.as_deref())
                            .unwrap_or("");
                        CliResponseEnvelope::ok_with_data(
                            &req.id,
                            format!(
                                "Created workspace \"{}\" at {} [ID: {}]",
                                ws.name, root_display, ws.id
                            ),
                            json!(ws),
                        )
                    }
                    Err(e) => CliResponseEnvelope::err(&req.id, format!("Failed creating workspace: {e}")),
                }
            }
            "rename" => {
                if rest.len() < 2 {
                    return CliResponseEnvelope::err(&req.id, "mindagentics workspace rename: current and new names required.");
                }
                let list = self.storage_engine().list_workspaces().await.unwrap_or_default();
                if let Some(ws) = list.into_iter().find(|w| w.name.eq_ignore_ascii_case(&rest[0]) || w.id == rest[0]) {
                    let _ = self
                        .storage_engine()
                        .patch_workspace(&ws.id, json!({ "name": rest[1] }))
                        .await;
                    CliResponseEnvelope::ok(&req.id, format!("Renamed workspace to \"{}\".", rest[1]))
                } else {
                    CliResponseEnvelope::err(&req.id, format!("Workspace \"{}\" not found.", rest[0]))
                }
            }
            "move" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                let dest = if opt_bool(&req.options, "root") {
                    "root".to_string()
                } else {
                    opt_str(&req.options, "group")
                        .or_else(|| opt_str(&req.options, "folder"))
                        .unwrap_or_else(|| "destination".to_string())
                };
                CliResponseEnvelope::ok(&req.id, format!("Moved workspace \"{name}\" to {dest}."))
            }
            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown workspace action: \"{action}\". Valid: list, create, move, rename."),
            ),
        }
    }

    pub(super) async fn cmd_floor(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };
        let git = GitEngine::new();
        let ws_root = self
            .storage_engine()
            .list_workspaces()
            .await
            .ok()
            .and_then(|l| {
                l.into_iter()
                    .find(|w| w.id == ws_id)
                    .and_then(|w| w.root_path.or(w.working_directory))
                    .map(PathBuf::from)
            })
            .or_else(|| req.cwd.as_ref().map(PathBuf::from))
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

        match action.as_str() {
            "list" => {
                let branches = git.list_branches(&ws_root).await.unwrap_or_default();
                let mut lines = vec!["Floors in workspace:".to_string()];
                lines.push("  * \"Ground Floor\" (Ground Floor) [status: working]".to_string());
                for b in branches {
                    lines.push(format!(
                        "  * branch \"{}\" {}",
                        b.name,
                        if b.is_current { "(current)" } else { "" }
                    ));
                }
                CliResponseEnvelope::ok(&req.id, lines.join("\n"))
            }
            "create" => {
                let name = rest
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "Feature Floor".to_string());
                let branch = opt_str(&req.options, "branch").unwrap_or_else(|| {
                    name.to_lowercase()
                        .chars()
                        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                        .collect()
                });
                let floor_id = format!("floor-{}", short_id(&uuid::Uuid::new_v4().to_string(), 8));
                let no_git = opt_bool(&req.options, "no-git");
                if !no_git && git.is_git_repo(&ws_root).await {
                    let wt_dir = self
                        .storage_engine()
                        .get_data_dir()
                        .join("floors")
                        .join(ws_id)
                        .join(&floor_id);
                    let _ = tokio::fs::create_dir_all(wt_dir.parent().unwrap_or(&ws_root)).await;
                    if let Err(e) = git.create_worktree(&ws_root, &branch, &wt_dir).await {
                        return CliResponseEnvelope::err(&req.id, format!("Failed creating floor worktree: {e}"));
                    }
                }
                self.emit_event(
                    "mindagentics:canvas:floorCreated",
                    json!({
                        "workspaceId": ws_id,
                        "floorId": floor_id,
                        "name": name,
                        "branch": branch,
                    }),
                );
                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Created floor \"{name}\" [ID: {floor_id}] (branch: {branch})."),
                    json!({ "floorId": floor_id, "name": name, "branch": branch }),
                )
            }
            "land" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                if name.is_empty() {
                    return CliResponseEnvelope::err(&req.id, "mindagentics floor land: floor name required.");
                }
                let into = opt_str(&req.options, "into").unwrap_or_else(|| "main".to_string());
                CliResponseEnvelope::ok(
                    &req.id,
                    format!("Landed floor \"{name}\" into branch \"{into}\"."),
                )
            }
            "delete" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                if name.is_empty() {
                    return CliResponseEnvelope::err(&req.id, "mindagentics floor delete: floor name required.");
                }
                CliResponseEnvelope::ok(&req.id, format!("Deleted floor \"{name}\"."))
            }
            "status" => {
                let floor_id = opt_str(&req.options, "floor")
                    .or_else(|| req.floor_id.clone())
                    .unwrap_or_else(|| "ground".to_string());
                let key = format!("{ws_id}:{floor_id}");
                if opt_bool(&req.options, "clear") {
                    self.floor_statuses.write().await.remove(&key);
                    return CliResponseEnvelope::ok(&req.id, format!("Cleared status for floor \"{floor_id}\"."));
                }
                let text = if !rest.is_empty() {
                    Some(rest.join(" ").chars().take(120).collect::<String>())
                } else {
                    opt_str(&req.options, "text").map(|s| s.chars().take(120).collect())
                };
                if text.is_none() && opt_str(&req.options, "state").is_none() {
                    let cur = self.floor_statuses.read().await.get(&key).cloned();
                    if let Some(st) = cur {
                        return CliResponseEnvelope::ok(
                            &req.id,
                            format!(
                                "Status [{}]: \"{}\"",
                                st.get("state").and_then(|v| v.as_str()).unwrap_or("working"),
                                st.get("text").and_then(|v| v.as_str()).unwrap_or("")
                            ),
                        );
                    }
                    return CliResponseEnvelope::ok(&req.id, "No status posted for this floor.");
                }
                let state = opt_str(&req.options, "state").unwrap_or_else(|| "working".to_string());
                let progress = opt_str(&req.options, "progress");
                let info = json!({
                    "text": text,
                    "state": state,
                    "progress": progress,
                });
                self.floor_statuses.write().await.insert(key, info.clone());
                CliResponseEnvelope::ok(&req.id, format!("Posted floor status: [{state}]"))
            }
            "unload" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                CliResponseEnvelope::ok(&req.id, format!("Unloaded floor \"{name}\"."))
            }
            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown floor action: \"{action}\". Valid: list, create, land, delete, status, unload."),
            ),
        }
    }

    pub(super) async fn cmd_routine(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        match action.as_str() {
            "list" => {
                let routines = self.routines.read().await;
                if routines.is_empty() {
                    return CliResponseEnvelope::ok(&req.id, "Routines in current workspace:\n  (no routines configured)");
                }
                let mut lines = vec!["Routines in current workspace:".to_string()];
                for r in routines.values() {
                    let id = r.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                    let name = r.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                    let disabled = r.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    let status = if disabled { "[disabled]" } else { "[active]" };
                    lines.push(format!("  * [{}] \"{name}\" {status}", short_id(id, 8)));
                }
                CliResponseEnvelope::ok(&req.id, lines.join("\n"))
            }
            "create" => {
                let name = rest.first().cloned().unwrap_or_default();
                let command = opt_str(&req.options, "command").unwrap_or_else(|| {
                    if rest.len() > 1 { rest[1..].join(" ") } else { String::new() }
                });
                if name.is_empty() || command.is_empty() {
                    return CliResponseEnvelope::err(&req.id, "mindagentics routine create: name and --command required.");
                }
                let rid = uuid::Uuid::new_v4().to_string();
                let routine = json!({
                    "id": rid,
                    "name": name,
                    "workspaceId": ws_id,
                    "command": command,
                    "every": opt_str(&req.options, "every"),
                    "daily": opt_str(&req.options, "daily"),
                    "disabled": opt_bool(&req.options, "disabled"),
                    "targetTerminalId": req.terminal_id,
                });
                self.routines.write().await.insert(rid.clone(), routine.clone());
                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Scheduled routine \"{name}\" [ID: {}].", short_id(&rid, 8)),
                    routine,
                )
            }
            "show" => {
                let target = rest.first().map(|s| s.to_lowercase()).unwrap_or_default();
                let routines = self.routines.read().await;
                if let Some(r) = routines.values().find(|r| {
                    r.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase().starts_with(&target)).unwrap_or(false)
                        || r.get("name").and_then(|v| v.as_str()).map(|s| s.to_lowercase() == target).unwrap_or(false)
                }) {
                    CliResponseEnvelope::ok(&req.id, serde_json::to_string_pretty(r).unwrap_or_default())
                } else {
                    CliResponseEnvelope::err(&req.id, format!("Routine \"{target}\" not found."))
                }
            }
            "enable" | "disable" | "delete" => {
                let target = rest.first().map(|s| s.to_lowercase()).unwrap_or_default();
                let mut routines = self.routines.write().await;
                let key = routines
                    .iter()
                    .find(|(_, r)| {
                        r.get("id").and_then(|v| v.as_str()).map(|s| s.to_lowercase().starts_with(&target)).unwrap_or(false)
                            || r.get("name").and_then(|v| v.as_str()).map(|s| s.to_lowercase() == target).unwrap_or(false)
                    })
                    .map(|(k, _)| k.clone());
                let key = match key {
                    Some(k) => k,
                    None => return CliResponseEnvelope::err(&req.id, format!("Routine \"{target}\" not found.")),
                };
                if action == "delete" {
                    routines.remove(&key);
                    CliResponseEnvelope::ok(&req.id, format!("Deleted routine \"{target}\"."))
                } else {
                    let dis = action == "disable";
                    if let Some(obj) = routines.get_mut(&key).and_then(|v| v.as_object_mut()) {
                        obj.insert("disabled".to_string(), Value::Bool(dis));
                    }
                    CliResponseEnvelope::ok(&req.id, format!("Updated routine \"{target}\" (disabled={dis})."))
                }
            }
            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown routine subcommand: \"{action}\"."),
            ),
        }
    }

    pub(super) async fn cmd_preset(&self, req: &CliRequestEnvelope) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        match action.as_str() {
            "list" => {
                let presets = self.presets.read().await;
                let mut lines = vec!["Configured Agent Presets:".to_string()];
                for p in presets.values() {
                    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                    let atype = p.get("agentType").and_then(|v| v.as_str()).unwrap_or("custom");
                    let cmd = p.get("command").and_then(|v| v.as_str()).unwrap_or_default();
                    let cmd_str = if cmd.is_empty() { "[plain shell]".to_string() } else { format!("[cmd: {cmd}]") };
                    lines.push(format!("  * \"{name}\" ({atype}) {cmd_str}"));
                }
                CliResponseEnvelope::ok(&req.id, lines.join("\n"))
            }
            "show" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                let presets = self.presets.read().await;
                if let Some(p) = presets.get(name) {
                    CliResponseEnvelope::ok(&req.id, serde_json::to_string_pretty(p).unwrap_or_default())
                } else {
                    CliResponseEnvelope::err(&req.id, format!("Preset \"{name}\" not found."))
                }
            }
            "create" => {
                let name = rest.first().cloned().unwrap_or_default();
                if name.is_empty() {
                    return CliResponseEnvelope::err(&req.id, "mindagentics preset create: name required.");
                }
                let command = opt_str(&req.options, "command").unwrap_or_default();
                let preset = json!({
                    "id": uuid::Uuid::new_v4().to_string(),
                    "name": name,
                    "agentType": "custom",
                    "command": command,
                    "isActive": true,
                });
                self.presets.write().await.insert(name.clone(), preset.clone());
                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!("Created preset \"{name}\" with command: \"{command}\""),
                    preset,
                )
            }
            "delete" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                if self.presets.write().await.remove(name).is_some() {
                    CliResponseEnvelope::ok(&req.id, format!("Deleted preset \"{name}\"."))
                } else {
                    CliResponseEnvelope::err(&req.id, format!("Preset \"{name}\" not found."))
                }
            }
            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown preset subcommand: \"{action}\". Valid: list, show, create, delete."),
            ),
        }
    }

    pub(super) async fn cmd_role(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        match action.as_str() {
            "list" => {
                let roles = self.roles.read().await;
                let mut lines = vec!["Configured Roles:".to_string()];
                if roles.is_empty() {
                    lines.push("  (none)".to_string());
                } else {
                    for r in roles.values() {
                        let name = r.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                        let prompt = r.get("prompt").and_then(|v| v.as_str()).unwrap_or_default();
                        let preview: String = prompt.chars().take(70).collect();
                        lines.push(format!("  * \"{name}\": \"{preview}\""));
                    }
                }
                CliResponseEnvelope::ok(&req.id, lines.join("\n"))
            }
            "show" => {
                let name = rest.first().map(|s| s.as_str()).unwrap_or_default();
                let roles = self.roles.read().await;
                if let Some(r) = roles.get(name) {
                    CliResponseEnvelope::ok(&req.id, serde_json::to_string_pretty(r).unwrap_or_default())
                } else {
                    CliResponseEnvelope::err(&req.id, format!("Role \"{name}\" not found."))
                }
            }
            "create" => {
                let name = rest.first().cloned().unwrap_or_default();
                let prompt = if rest.len() > 1 {
                    rest[1..].join(" ")
                } else {
                    opt_str(&req.options, "prompt").unwrap_or_default()
                };
                if name.is_empty() || prompt.is_empty() {
                    return CliResponseEnvelope::err(&req.id, "mindagentics role create: name and prompt required.");
                }
                let scope = opt_str(&req.options, "scope").unwrap_or_else(|| "current".to_string());
                self.roles.write().await.insert(
                    name.clone(),
                    json!({ "name": name, "prompt": prompt, "scope": scope, "workspaceId": ws_id }),
                );
                CliResponseEnvelope::ok(&req.id, format!("Created role \"{name}\" [scope: {scope}]."))
            }
            "assign" => {
                if rest.len() < 2 {
                    return CliResponseEnvelope::err(&req.id, "mindagentics role assign: recruit and role name required.");
                }
                let target_id = match self.pty().find_session_id_by_name_or_id(&rest[0], Some(ws_id)).await {
                    Some(id) => id,
                    None => return CliResponseEnvelope::err(&req.id, format!("Recruit \"{}\" not found.", rest[0])),
                };
                let role_name = rest[1].clone();
                let mut opts = TerminalReconfigureOptions::default();
                opts.terminal_id = Some(target_id.clone());
                opts.agent_role = Some(role_name.clone());
                let _ = self.pty().reconfigure(Some(&target_id), opts).await;
                CliResponseEnvelope::ok(
                    &req.id,
                    format!("Assigned role \"{role_name}\" to recruit \"{}\".", rest[0]),
                )
            }
            _ => CliResponseEnvelope::err(
                &req.id,
                format!("Unknown role action: \"{action}\". Valid: list, show, create, assign."),
            ),
        }
    }

    pub(super) async fn cmd_arrange(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let target_name = req.args.first().map(|s| s.as_str());
        let new_name = opt_str(&req.options, "name");
        let new_color = opt_str(&req.options, "color");
        let new_icon = opt_str(&req.options, "icon");

        if target_name.is_none() && new_name.is_none() && new_color.is_none() && new_icon.is_none() {
            return CliResponseEnvelope::ok(
                &req.id,
                "Canvas Visual Styles:\nAvailable colors: yellow, blue, green, pink, purple, gray, cyan, orange\nUsage: mindagentics arrange \"Name\" [--name N] [--icon I] [--color C]",
            );
        }

        let target_tid = if let Some(name) = target_name {
            self.pty().find_session_id_by_name_or_id(name, Some(ws_id)).await
        } else {
            Some(req.terminal_id.clone())
        };

        if let Some(tid) = target_tid {
            if let Some(ref title) = new_name {
                let mut opts = TerminalReconfigureOptions::default();
                opts.terminal_id = Some(tid.clone());
                opts.title = Some(title.clone());
                let _ = self.pty().reconfigure(Some(&tid), opts).await;
            }
            let (nodes, _) = self.get_workspace_nodes_and_ties(ws_id).await;
            if let Some(mut node) = nodes.into_iter().find(|n| {
                n.get("kind").and_then(|v| v.as_str()) == Some("terminal")
                    && (n.get("content").and_then(|c| c.get("terminalId")).and_then(|v| v.as_str()) == Some(tid.as_str())
                        || n.get("id").and_then(|v| v.as_str()) == Some(tid.as_str()))
            }) {
                if let Some(c) = node.get_mut("content").and_then(|v| v.as_object_mut()) {
                    if let Some(ref n) = new_name { c.insert("title".to_string(), Value::String(n.clone())); }
                    if let Some(ref col) = new_color { c.insert("accentColor".to_string(), Value::String(col.clone())); }
                    if let Some(ref ic) = new_icon { c.insert("icon".to_string(), Value::String(ic.clone())); }
                }
                self.persist_node_to_workspace(ws_id, &node).await;
                self.emit_event("mindagentics:canvas:nodePlaced", json!({ "workspaceId": ws_id, "node": node }));
            }
            return CliResponseEnvelope::ok(&req.id, "Updated styling for terminal. Placed on canvas.");
        }

        if let Some(name) = target_name {
            if let Some(mut note) = self.find_note_node(ws_id, name).await {
                if let Some(c) = note.get_mut("content").and_then(|v| v.as_object_mut()) {
                    if let Some(ref n) = new_name { c.insert("title".to_string(), Value::String(n.clone())); }
                    if let Some(ref col) = new_color { c.insert("color".to_string(), Value::String(col.clone())); }
                }
                self.persist_node_to_workspace(ws_id, &note).await;
                self.emit_event("mindagentics:canvas:nodePlaced", json!({ "workspaceId": ws_id, "node": note }));
                return CliResponseEnvelope::ok(&req.id, format!("Updated styling for note \"{name}\"."));
            }
        }

        CliResponseEnvelope::ok(&req.id, "Updated styling.")
    }

    pub(super) async fn cmd_graphify(&self, req: &CliRequestEnvelope, ws_id: &str) -> CliResponseEnvelope {
        let action = req.args.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let rest: &[String] = if req.args.len() > 1 { &req.args[1..] } else { &[] };

        let target_dir = opt_str(&req.options, "dir")
            .or_else(|| opt_str(&req.options, "cwd"))
            .or_else(|| req.cwd.clone())
            .or_else(|| {
                futures_ws_root_sync(&self.storage_engine(), ws_id)
            })
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| ".".to_string())
            });

        match action.as_str() {
            "build" | "create" => {
                let dir = rest.first().cloned().unwrap_or(target_dir);
                let runner = GraphifyRunner::new();
                match runner
                    .build_graph(GraphifyBuildParams {
                        target: dir,
                        is_git_url: None,
                        branch: opt_str(&req.options, "branch"),
                        directed: Some(true),
                    })
                    .await
                {
                    Ok(res) => {
                        let msg = res
                            .message
                            .clone()
                            .unwrap_or_else(|| "Knowledge Graph generated.".to_string());
                        CliResponseEnvelope::ok_with_data(&req.id, msg, json!(res))
                    }
                    Err(e) => CliResponseEnvelope::err(&req.id, format!("Graphify build failed: {e}")),
                }
            }
            "query" | "explain" | "path" => {
                let mut py_args = vec!["-m".to_string(), "graphify".to_string(), action.clone()];
                py_args.extend(rest.iter().cloned());
                if action == "query" {
                    if let Some(budget) = opt_str(&req.options, "budget") {
                        py_args.push("--budget".to_string());
                        py_args.push(budget);
                    }
                    if opt_bool(&req.options, "dfs") {
                        py_args.push("--dfs".to_string());
                    }
                }
                let mut cmd = tokio::process::Command::new("python");
                cmd.current_dir(&target_dir);
                cmd.args(&py_args);
                #[cfg(windows)]
                {
                    cmd.creation_flags(0x08000000);
                }
                match cmd.output().await {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                        let text = if !stdout.is_empty() { stdout } else { stderr };
                        if out.status.success() {
                            CliResponseEnvelope::ok(&req.id, text)
                        } else {
                            CliResponseEnvelope::err(&req.id, text)
                        }
                    }
                    Err(e) => CliResponseEnvelope::err(&req.id, format!("Graphify command failed: {e}")),
                }
            }
            "open" | "view" => {
                let dir = rest.first().cloned().unwrap_or(target_dir);
                let html_path = PathBuf::from(&dir).join("graphify-out").join("graph.html");
                if !html_path.exists() {
                    return CliResponseEnvelope::err(
                        &req.id,
                        format!("No graph.html found in {}. Run 'mindagentics graphify build' first.", html_path.parent().unwrap_or(Path::new(&dir)).display()),
                    );
                }
                let file_url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));
                let mut portal_req = req.clone();
                portal_req.args = vec!["open".to_string(), file_url];
                portal_req.options.insert("name".to_string(), Value::String("Knowledge Graph".to_string()));
                self.cmd_portal(&portal_req, ws_id).await
            }
            "status" => {
                let runner = GraphifyRunner::new();
                let check = runner.check_graph(Path::new(&target_dir)).await;
                CliResponseEnvelope::ok_with_data(
                    &req.id,
                    format!(
                        "Graphify Knowledge Graph Status:\n  Target Directory: {}\n  Graph Exists: {}\n  Nodes: {}",
                        target_dir,
                        if check.has_graph { "Yes" } else { "No" },
                        check.nodes_count
                    ),
                    json!(check),
                )
            }
            _ => CliResponseEnvelope::ok(
                &req.id,
                "Graphify Knowledge Graph CLI:\n  mindagentics graphify build [path]\n  mindagentics graphify query \"<pergunta>\"\n  mindagentics graphify explain \"<symbol>\"\n  mindagentics graphify path \"<nodeA>\" \"<nodeB>\"\n  mindagentics graphify open [path]\n  mindagentics graphify status",
            ),
        }
    }
}
