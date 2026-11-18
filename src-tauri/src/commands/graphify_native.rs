use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use regex::Regex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::security::path_safety::assert_safe_path_string;
use crate::security::sanitizer::sanitize_label;

use super::run_git_args;
#[cfg(windows)]
use super::CREATE_NO_WINDOW;

pub(super) fn emit_graphify_progress(app: &AppHandle, message: &str) {
    let _ = app.emit("mindagentics:graphify:progress", json!({ "message": message }));
}

async fn clone_graphify_repo(
    app: &AppHandle,
    url: &str,
    branch: Option<&str>,
) -> Result<PathBuf, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("URL do repositório Git deve usar http:// ou https://".to_string());
    }
    if trimmed.chars().any(|c| c.is_control() || c == '\0') {
        return Err("URL do repositório contém caracteres inválidos".to_string());
    }

    emit_graphify_progress(app, &format!("Clonando repositório {trimmed}..."));

    let cleaned = trimmed.trim_end_matches('/');
    let parts: Vec<&str> = cleaned.split('/').collect();
    let repo_name = parts
        .last()
        .copied()
        .unwrap_or("repo")
        .trim_end_matches(".git");
    let owner_name = if parts.len() >= 2 {
        parts[parts.len() - 2]
    } else {
        "external"
    };

    let home = dirs::home_dir().ok_or_else(|| "Diretório home não encontrado".to_string())?;
    let dest_dir = home
        .join(".graphify")
        .join("repos")
        .join(sanitize_label(owner_name, 80))
        .join(sanitize_label(repo_name, 80));

    if dest_dir.exists() {
        emit_graphify_progress(
            app,
            &format!(
                "Repositório existente detectado em {}, atualizando...",
                dest_dir.display()
            ),
        );
        let _ = run_git_args(&["pull"], &dest_dir).await;
        if let Some(br) = branch.filter(|b| !b.trim().is_empty()) {
            let _ = run_git_args(&["checkout", br.trim()], &dest_dir).await;
        }
        return Ok(dest_dir);
    }

    if let Some(parent) = dest_dir.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let dest_str = dest_dir.to_string_lossy().to_string();
    let mut clone_args = vec!["clone", "--depth", "1"];
    if let Some(br) = branch.filter(|b| !b.trim().is_empty()) {
        clone_args.push("-b");
        clone_args.push(br.trim());
    }
    clone_args.push("--");
    clone_args.push(trimmed);
    clone_args.push(&dest_str);

    let mut cmd = tokio::process::Command::new("git");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(&clone_args);

    let out = cmd.output().await.map_err(|e| format!("git clone falhou: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Falha ao clonar repositório: {stderr}"));
    }

    Ok(dest_dir)
}

async fn try_python_graphify(project_dir: &Path, directed: bool) -> bool {
    let dir_str = project_dir.to_string_lossy().to_string();
    let candidates: &[(&str, &[&str])] = &[
        ("graphify", &[]),
        ("python", &["-m", "graphify"]),
        ("python3", &["-m", "graphify"]),
        ("py", &["-3", "-m", "graphify"]),
    ];

    for (bin, prefix) in candidates {
        let mut cmd = tokio::process::Command::new(bin);
        cmd.current_dir(project_dir);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        for p in *prefix {
            cmd.arg(p);
        }
        cmd.arg(&dir_str);
        if directed {
            cmd.arg("--directed");
        }
        cmd.arg("--code-only");

        if let Ok(out) = cmd.output().await {
            if out.status.success() {
                let html_path = project_dir.join("graphify-out").join("graph.html");
                let json_path = project_dir.join("graphify-out").join("graph.json");
                if json_path.exists() && html_path.exists() {
                    return true;
                }
            }
        }
    }
    false
}

pub(super) fn should_skip_graph_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".nuxt"
            | ".venv"
            | "venv"
            | "__pycache__"
            | "graphify-out"
            | ".graphify"
            | ".mindagentics"
            | ".turbo"
            | "coverage"
    )
}

pub(super) fn is_source_extension(ext: &str) -> bool {
    matches!(
        ext,
        "ts" | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "rs"
            | "py"
            | "go"
            | "java"
            | "kt"
            | "cs"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "vue"
            | "svelte"
            | "json"
            | "toml"
            | "md"
    )
}

pub(super) fn generate_native_graph_html(project_name: &str, graph_json_str: &str) -> String {
    let safe_title = project_name
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let escaped_json = graph_json_str.replace("</", "<\\/");

    format!(
        r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Knowledge Graph — {safe_title}</title>
<style>
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; background: #0B0D11; color: #E7E8EA; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }}
  .layout {{ display: flex; width: 100%; height: 100%; }}
  .canvas-wrap {{ position: relative; flex: 1; height: 100%; overflow: hidden; }}
  canvas {{ display: block; width: 100%; height: 100%; cursor: grab; }}
  canvas:active {{ cursor: grabbing; }}
  .hud {{ position: absolute; top: 14px; left: 14px; display: flex; gap: 8px; align-items: center; background: rgba(20,22,26,0.92); border: 1px solid #23262C; border-radius: 12px; padding: 8px 12px; backdrop-filter: blur(8px); }}
  .hud input {{ background: #0E1014; border: 1px solid #2A2E37; border-radius: 8px; padding: 6px 10px; color: #E7E8EA; font-size: 12px; width: 210px; outline: none; }}
  .hud input:focus {{ border-color: #6366F1; }}
  .pill {{ font-size: 11px; color: #A1A7B3; background: #181B20; border: 1px solid #23262C; border-radius: 8px; padding: 5px 9px; }}
  .sidebar {{ width: 300px; border-left: 1px solid #23262C; background: #111318; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }}
  h1 {{ font-size: 14px; margin: 0; color: #F4F5F7; }}
  h2 {{ font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8A8F98; margin: 0 0 6px 0; }}
  .item {{ font-size: 12px; padding: 6px 8px; border-radius: 8px; background: #171A21; border: 1px solid #23262C; margin-bottom: 6px; word-break: break-all; cursor: pointer; }}
  .item:hover {{ border-color: #6366F1; }}
  .muted {{ color: #8A8F98; font-size: 12px; line-height: 1.45; }}
  .tag {{ display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 999px; background: #1F2430; color: #A5B4FC; margin: 2px 4px 2px 0; }}
</style>
</head>
<body>
<div class="layout">
  <div class="canvas-wrap">
    <canvas id="graph"></canvas>
    <div class="hud">
      <strong style="font-size:12px;color:#A5B4FC;">{safe_title}</strong>
      <input id="search" type="text" placeholder="Filtrar arquivo ou símbolo..." />
      <span id="stats" class="pill"></span>
    </div>
  </div>
  <aside class="sidebar">
    <div>
      <h1>Inspetor Arquitetural</h1>
      <p class="muted" id="subtitle">Clique em um nó para inspecionar dependências, símbolos e comunidade.</p>
    </div>
    <div id="details"></div>
    <div>
      <h2>Principais Hubs</h2>
      <div id="hubs"></div>
    </div>
  </aside>
</div>
<script>
const GRAPH = {escaped_json};
const nodes = (GRAPH.nodes || []).map((n, i) => ({{
  ...n,
  x: (Math.cos(i * 2.39996) * 28 * Math.sqrt(i + 1)),
  y: (Math.sin(i * 2.39996) * 28 * Math.sqrt(i + 1)),
  vx: 0, vy: 0
}}));
const nodeById = new Map(nodes.map(n => [n.id, n]));
const links = (GRAPH.links || GRAPH.edges || []).map(e => ({{
  source: nodeById.get(e.source),
  target: nodeById.get(e.target),
  relation: e.relation || 'imports'
}})).filter(e => e.source && e.target);

const palette = ['#818CF8','#34D399','#F472B6','#FBBF24','#38BDF8','#A78BFA','#FB7185','#2DD4BF'];
const communities = [...new Set(nodes.map(n => n.community || 'root'))];
const commColor = c => palette[Math.max(0, communities.indexOf(c)) % palette.length];

document.getElementById('stats').textContent = `${{nodes.length}} nós · ${{links.length}} arestas`;

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
let width = 0, height = 0, dpr = window.devicePixelRatio || 1;
let cam = {{ x: 0, y: 0, zoom: 1 }};
let selected = null, filter = '', dragging = false, lastX = 0, lastY = 0;

function resize() {{
  const rect = canvas.parentElement.getBoundingClientRect();
  width = rect.width; height = rect.height;
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}}
window.addEventListener('resize', resize);
resize();

// Light deterministic layout relaxation
for (let step = 0; step < 90; step++) {{
  for (let i = 0; i < nodes.length; i++) {{
    const a = nodes[i];
    a.vx *= 0.85; a.vy *= 0.85;
    a.vx += -a.x * 0.004; a.vy += -a.y * 0.004;
    for (let j = i + 1; j < Math.min(nodes.length, i + 40); j++) {{
      const b = nodes[j];
      const dx = a.x - b.x || 0.1, dy = a.y - b.y || 0.1;
      const dist2 = dx*dx + dy*dy + 80;
      const f = 900 / dist2;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }}
  }}
  for (const e of links) {{
    const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
    e.source.vx += dx * 0.015; e.source.vy += dy * 0.015;
    e.target.vx -= dx * 0.015; e.target.vy -= dy * 0.015;
  }}
  for (const n of nodes) {{ n.x += n.vx; n.y += n.vy; }}
}}

function draw() {{
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2 + cam.x, height / 2 + cam.y);
  ctx.scale(cam.zoom, cam.zoom);

  const q = filter.trim().toLowerCase();
  const matches = n => !q || (n.label || '').toLowerCase().includes(q) || (n.path || '').toLowerCase().includes(q);

  ctx.lineWidth = 1 / cam.zoom;
  for (const e of links) {{
    const hi = selected && (e.source === selected || e.target === selected);
    ctx.strokeStyle = hi ? 'rgba(129,140,248,0.85)' : 'rgba(148,163,184,0.16)';
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();
  }}

  for (const n of nodes) {{
    const m = matches(n);
    const r = Math.min(16, 4 + Math.sqrt(n.degree || 1) * 1.8);
    ctx.globalAlpha = m ? 1 : 0.15;
    ctx.fillStyle = commColor(n.community || 'root');
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (n === selected) {{
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.stroke();
    }}
    if (cam.zoom > 0.7 || (n.degree || 0) >= 4 || n === selected || (q && m)) {{
      ctx.fillStyle = '#E7E8EA';
      ctx.font = `${{Math.max(9, 11 / Math.sqrt(cam.zoom))}}px sans-serif`;
      ctx.fillText(n.label, n.x + r + 4, n.y + 3);
    }}
  }}
  ctx.restore();
  requestAnimationFrame(draw);
}}
requestAnimationFrame(draw);

function screenToWorld(sx, sy) {{
  return {{ x: (sx - width / 2 - cam.x) / cam.zoom, y: (sy - height / 2 - cam.y) / cam.zoom }};
}}

function selectNode(n) {{
  selected = n;
  const det = document.getElementById('details');
  if (!n) {{ det.innerHTML = ''; return; }}
  const outgoing = links.filter(e => e.source === n).map(e => e.target.label);
  const incoming = links.filter(e => e.target === n).map(e => e.source.label);
  det.innerHTML = `
    <div class="item" style="border-color:#6366F1">
      <div><strong>${{n.label}}</strong></div>
      <div class="muted">${{n.path || n.id}}</div>
      <div style="margin-top:6px"><span class="tag">${{n.community || 'root'}}</span><span class="tag">grau ${{n.degree || 0}}</span></div>
    </div>
    ${{(n.symbols && n.symbols.length) ? `<div><h2>Símbolos</h2>${{n.symbols.slice(0, 12).map(s => `<span class="tag">${{s}}</span>`).join('')}}</div>` : ''}}
    ${{outgoing.length ? `<div><h2>Importa (${{outgoing.length}})</h2>${{outgoing.slice(0, 10).map(l => `<div class="item">${{l}}</div>`).join('')}}</div>` : ''}}
    ${{incoming.length ? `<div><h2>Referenciado por (${{incoming.length}})</h2>${{incoming.slice(0, 10).map(l => `<div class="item">${{l}}</div>`).join('')}}</div>` : ''}}
  `;
}}

const hubsEl = document.getElementById('hubs');
[...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 10).forEach(n => {{
  const el = document.createElement('div');
  el.className = 'item';
  el.textContent = `${{n.label}} (${{n.degree || 0}})`;
  el.onclick = () => {{ cam.x = -n.x * cam.zoom; cam.y = -n.y * cam.zoom; selectNode(n); }};
  hubsEl.appendChild(el);
}});

document.getElementById('search').addEventListener('input', e => {{ filter = e.target.value; }});
canvas.addEventListener('mousedown', e => {{ dragging = true; lastX = e.clientX; lastY = e.clientY; }});
window.addEventListener('mouseup', () => {{ dragging = false; }});
window.addEventListener('mousemove', e => {{
  if (!dragging) return;
  cam.x += e.clientX - lastX; cam.y += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
}});
canvas.addEventListener('click', e => {{
  const rect = canvas.getBoundingClientRect();
  const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  let hit = null, best = 20 / cam.zoom;
  for (const n of nodes) {{
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    if (d < best) {{ best = d; hit = n; }}
  }}
  selectNode(hit);
}});
canvas.addEventListener('wheel', e => {{
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  cam.zoom = Math.max(0.15, Math.min(4, cam.zoom * factor));
}}, {{ passive: false }});
</script>
</body>
</html>"#
    )
}

async fn build_native_rust_graph(
    app: &AppHandle,
    project_dir: &Path,
    directed: bool,
) -> Result<(usize, usize, String), String> {
    emit_graphify_progress(
        app,
        "Analisando AST/dependências determinísticas localmente via motor Rust...",
    );

    let dir_owned = project_dir.to_path_buf();
    let project_name = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();
    let project_name_for_task = project_name.clone();

    let (graph_json_val, report_md, nodes_count, edges_count) = tokio::task::spawn_blocking(
        move || -> Result<(Value, String, usize, usize), String> {
            let mut files: Vec<PathBuf> = Vec::new();
            let mut stack: Vec<PathBuf> = vec![dir_owned.clone()];

            while let Some(curr) = stack.pop() {
                if files.len() >= 1500 {
                    break;
                }
                let Ok(entries) = std::fs::read_dir(&curr) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if path.is_dir() {
                        if !should_skip_graph_dir(&name) {
                            stack.push(path);
                        }
                    } else if path.is_file() {
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_ascii_lowercase();
                        if is_source_extension(&ext) {
                            files.push(path);
                        }
                    }
                }
            }

            let import_re = Regex::new(
                r#"(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|from\s+([a-zA-Z0-9_\.]+)\s+import|use\s+(crate::[a-zA-Z0-9_:]+))"#,
            )
            .unwrap();
            let symbol_re = Regex::new(
                r"(?m)^(?:export\s+(?:async\s+)?(?:function|class|const|interface|type)|pub\s+(?:async\s+)?(?:fn|struct|enum|trait)|def|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)",
            )
            .unwrap();

            let mut rel_paths: Vec<String> = Vec::new();
            let mut path_lookup: HashMap<String, String> = HashMap::new();
            let mut stem_lookup: HashMap<String, String> = HashMap::new();

            for f in &files {
                let rel = f
                    .strip_prefix(&dir_owned)
                    .unwrap_or(f)
                    .to_string_lossy()
                    .replace('\\', "/");
                let no_ext = rel
                    .rsplit_once('.')
                    .map(|(a, _)| a.to_string())
                    .unwrap_or_else(|| rel.clone());
                path_lookup.insert(rel.clone(), rel.clone());
                path_lookup.insert(no_ext.clone(), rel.clone());
                if let Some(stem) = f.file_stem().and_then(|s| s.to_str()) {
                    stem_lookup.entry(stem.to_string()).or_insert_with(|| rel.clone());
                }
                rel_paths.push(rel);
            }

            let mut node_symbols: HashMap<String, Vec<String>> = HashMap::new();
            let mut edges_set: HashSet<(String, String, &'static str)> = HashSet::new();
            let mut degree: HashMap<String, usize> = HashMap::new();

            for (idx, f) in files.iter().enumerate() {
                let src_rel = &rel_paths[idx];
                let Ok(content) = std::fs::read_to_string(f) else {
                    continue;
                };
                let capped = if content.len() > 256 * 1024 {
                    &content[..256 * 1024]
                } else {
                    &content
                };

                let mut syms = Vec::new();
                for cap in symbol_re.captures_iter(capped) {
                    if let Some(m) = cap.get(1) {
                        let s = m.as_str().to_string();
                        if !syms.contains(&s) {
                            syms.push(s);
                        }
                        if syms.len() >= 25 {
                            break;
                        }
                    }
                }
                node_symbols.insert(src_rel.clone(), syms);

                let src_parent = Path::new(src_rel)
                    .parent()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();

                for cap in import_re.captures_iter(capped) {
                    let raw_target = cap
                        .get(1)
                        .or_else(|| cap.get(2))
                        .or_else(|| cap.get(3))
                        .or_else(|| cap.get(4))
                        .map(|m| m.as_str())
                        .unwrap_or("");
                    if raw_target.is_empty() {
                        continue;
                    }

                    let resolved = if raw_target.starts_with('.') {
                        let joined = if src_parent.is_empty() {
                            PathBuf::from(raw_target)
                        } else {
                            PathBuf::from(&src_parent).join(raw_target)
                        };
                        let mut norm_parts: Vec<String> = Vec::new();
                        for comp in joined.components() {
                            match comp {
                                std::path::Component::Normal(s) => {
                                    norm_parts.push(s.to_string_lossy().to_string())
                                }
                                std::path::Component::ParentDir => {
                                    norm_parts.pop();
                                }
                                _ => {}
                            }
                        }
                        let norm_str = norm_parts.join("/");
                        path_lookup
                            .get(&norm_str)
                            .or_else(|| path_lookup.get(&format!("{norm_str}/index")))
                            .cloned()
                    } else if let Some(rust_path) = raw_target.strip_prefix("crate::") {
                        let seg = rust_path.split("::").next().unwrap_or("");
                        stem_lookup.get(seg).cloned()
                    } else {
                        let last_seg = raw_target
                            .split(['/', '.'])
                            .last()
                            .unwrap_or(raw_target);
                        stem_lookup.get(last_seg).cloned()
                    };

                    if let Some(target_rel) = resolved {
                        if &target_rel != src_rel {
                            edges_set.insert((src_rel.clone(), target_rel, "imports"));
                        }
                    }
                }
            }

            for (src, dst, _) in &edges_set {
                *degree.entry(src.clone()).or_insert(0) += 1;
                *degree.entry(dst.clone()).or_insert(0) += 1;
            }

            let mut communities: HashMap<String, usize> = HashMap::new();
            let mut nodes = Vec::with_capacity(rel_paths.len());
            for rel in &rel_paths {
                let community = rel
                    .split('/')
                    .next()
                    .filter(|_| rel.contains('/'))
                    .unwrap_or("root")
                    .to_string();
                *communities.entry(community.clone()).or_insert(0) += 1;
                let label = Path::new(rel)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(rel)
                    .to_string();
                nodes.push(json!({
                    "id": rel,
                    "label": label,
                    "path": rel,
                    "type": "file",
                    "community": community,
                    "degree": degree.get(rel).copied().unwrap_or(0),
                    "symbols": node_symbols.get(rel).cloned().unwrap_or_default(),
                }));
            }

            let edges: Vec<Value> = edges_set
                .iter()
                .map(|(s, t, r)| {
                    json!({
                        "source": s,
                        "target": t,
                        "relation": r,
                    })
                })
                .collect();

            let nodes_count = nodes.len();
            let edges_count = edges.len();

            let mut top_hubs: Vec<(&String, usize)> =
                rel_paths.iter().map(|r| (r, degree.get(r).copied().unwrap_or(0))).collect();
            top_hubs.sort_by(|a, b| b.1.cmp(&a.1));

            let mut report = format!(
                "# Knowledge Graph Report — {project_name_for_task}\n\n- **Nós:** {nodes_count}\n- **Arestas:** {edges_count}\n- **Direcionado:** {directed}\n- **Comunidades:** {}\n\n## Principais Hubs Arquiteturais\n",
                communities.len()
            );
            for (path, deg) in top_hubs.iter().take(15) {
                report.push_str(&format!("- `{path}` (grau {deg})\n"));
            }
            report.push_str("\n## Comunidades\n");
            let mut comm_vec: Vec<(&String, &usize)> = communities.iter().collect();
            comm_vec.sort_by(|a, b| b.1.cmp(a.1));
            for (comm, count) in comm_vec.iter().take(20) {
                report.push_str(&format!("- **{comm}**: {count} arquivos\n"));
            }

            let graph_json = json!({
                "version": 1,
                "directed": directed,
                "projectName": project_name_for_task,
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "nodes": nodes,
                "links": edges,
            });

            Ok((graph_json, report, nodes_count, edges_count))
        },
    )
    .await
    .map_err(|e| format!("Graphify task panicked: {e}"))??;

    let out_dir = project_dir.join("graphify-out");
    tokio::fs::create_dir_all(&out_dir)
        .await
        .map_err(|e| e.to_string())?;

    let json_bytes = serde_json::to_vec_pretty(&graph_json_val).map_err(|e| e.to_string())?;
    let json_str = String::from_utf8_lossy(&json_bytes).to_string();
    let html_str = generate_native_graph_html(&project_name, &json_str);

    tokio::fs::write(out_dir.join("graph.json"), &json_bytes)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(out_dir.join("GRAPH_REPORT.md"), report_md.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(out_dir.join("graph.html"), html_str.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    Ok((nodes_count, edges_count, report_md))
}

pub(super) async fn execute_graphify_build(app: &AppHandle, params: Value) -> Result<Value, String> {
    let target = params
        .get("target")
        .or_else(|| params.get("path"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| ".".to_string());

    let is_git_url = params
        .get("isGitUrl")
        .or_else(|| params.get("is_git_url"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || target.starts_with("http://")
        || target.starts_with("https://");

    let branch = params
        .get("branch")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let directed = params
        .get("directed")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    emit_graphify_progress(app, "Verificando motor Graphify integrado...");

    let project_dir = if is_git_url {
        clone_graphify_repo(app, &target, branch.as_deref()).await?
    } else {
        let safe = assert_safe_path_string(&target)?;
        dunce::canonicalize(&safe).unwrap_or(safe)
    };

    if !project_dir.exists() {
        return Err(format!(
            "Diretório do projeto não encontrado: {}",
            project_dir.display()
        ));
    }

    emit_graphify_progress(app, "Extraindo AST e relações de dependências determinísticas...");

    let used_python = try_python_graphify(&project_dir, directed).await;
    let out_dir = project_dir.join("graphify-out");
    let graph_html = out_dir.join("graph.html");
    let graph_json = out_dir.join("graph.json");
    let graph_report = out_dir.join("GRAPH_REPORT.md");

    let (nodes_count, edges_count, report_content) = if used_python && graph_html.exists() {
        let rep = tokio::fs::read_to_string(&graph_report)
            .await
            .unwrap_or_default();
        let (nc, ec) = if let Ok(bytes) = tokio::fs::read(&graph_json).await {
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                let n = v.get("nodes").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
                let e = v
                    .get("links")
                    .or_else(|| v.get("edges"))
                    .and_then(|a| a.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                (n, e)
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };
        (nc, ec, rep)
    } else {
        build_native_rust_graph(app, &project_dir, directed).await?
    };

    let project_name = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();
    let html_url = format!(
        "file:///{}",
        graph_html
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
    );

    emit_graphify_progress(
        app,
        &format!("Grafo concluído com sucesso: {nodes_count} nós, {edges_count} arestas."),
    );

    Ok(json!({
        "ok": true,
        "projectName": project_name,
        "projectDir": project_dir.to_string_lossy().to_string(),
        "htmlUrl": html_url,
        "graphHtmlPath": graph_html.to_string_lossy().to_string(),
        "graphReportPath": graph_report.to_string_lossy().to_string(),
        "reportContent": report_content,
        "nodesCount": nodes_count,
        "edgesCount": edges_count,
    }))
}

pub(super) fn execute_graphify_check(dir: &str) -> Value {
    let base = if dir.trim().is_empty() {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        match assert_safe_path_string(dir.trim()) {
            Ok(p) => dunce::canonicalize(&p).unwrap_or(p),
            Err(_) => return json!({ "hasGraph": false, "exists": false }),
        }
    };

    let mut curr = base.as_path();
    for _ in 0..4 {
        let out_dir = curr.join("graphify-out");
        let rep = out_dir.join("GRAPH_REPORT.md");
        let html = out_dir.join("graph.html");
        let json_path = out_dir.join("graph.json");

        if json_path.exists() && (rep.exists() || html.exists()) {
            let report_content = std::fs::read_to_string(&rep).unwrap_or_default();
            let project_name = curr
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();
            let html_url = format!(
                "file:///{}",
                html.to_string_lossy()
                    .replace('\\', "/")
                    .trim_start_matches('/')
            );
            return json!({
                "hasGraph": true,
                "exists": true,
                "projectName": project_name,
                "projectDir": curr.to_string_lossy().to_string(),
                "reportContent": report_content,
                "htmlUrl": html_url,
                "graphHtmlPath": html.to_string_lossy().to_string(),
                "graphJsonPath": json_path.to_string_lossy().to_string(),
            });
        }

        match curr.parent() {
            Some(parent) if parent != curr => curr = parent,
            _ => break,
        }
    }

    json!({
        "hasGraph": false,
        "exists": false,
    })
}

pub(super) async fn execute_graphify_query(dir: &str, question: &str, dfs: bool) -> Result<String, String> {
    let check = execute_graphify_check(dir);
    let Some(json_path) = check.get("graphJsonPath").and_then(|v| v.as_str()) else {
        return Ok("Nenhum Knowledge Graph encontrado neste diretório.".to_string());
    };
    let project_dir = check
        .get("projectDir")
        .and_then(|v| v.as_str())
        .unwrap_or(dir);

    let mut args = vec!["-m", "graphify", "query", question];
    if dfs {
        args.push("--dfs");
    }
    let mut cmd = tokio::process::Command::new("python");
    cmd.current_dir(project_dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(&args);
    if let Ok(out) = cmd.output().await {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return Ok(text);
            }
        }
    }

    // Native JSON fallback query
    let bytes = tokio::fs::read(json_path).await.map_err(|e| e.to_string())?;
    let g: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let q_lower = question.to_lowercase();
    let terms: Vec<&str> = q_lower.split_whitespace().collect();
    let nodes = g.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut hits = Vec::new();
    for n in &nodes {
        let label = n.get("label").and_then(|v| v.as_str()).unwrap_or("");
        let path = n.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let hay = format!("{} {}", label.to_lowercase(), path.to_lowercase());
        if terms.iter().any(|t| hay.contains(t)) {
            hits.push(format!("- {} ({})", label, path));
        }
    }
    if hits.is_empty() {
        Ok(format!("Nenhum nó correspondente a '{question}'."))
    } else {
        hits.truncate(20);
        Ok(format!("Resultados para '{question}':\n{}", hits.join("\n")))
    }
}

pub(super) async fn execute_graphify_explain(dir: &str, symbol: &str) -> Result<String, String> {
    let check = execute_graphify_check(dir);
    let Some(json_path) = check.get("graphJsonPath").and_then(|v| v.as_str()) else {
        return Ok("Nenhum Knowledge Graph encontrado neste diretório.".to_string());
    };
    let bytes = tokio::fs::read(json_path).await.map_err(|e| e.to_string())?;
    let g: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let sym_lower = symbol.to_lowercase();
    let nodes = g.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let links = g
        .get("links")
        .or_else(|| g.get("edges"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let found = nodes.iter().find(|n| {
        n.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
            .contains(&sym_lower)
            || n.get("label")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase()
                .contains(&sym_lower)
    });

    let Some(node) = found else {
        return Ok(format!("Símbolo ou módulo '{symbol}' não encontrado no grafo."));
    };
    let id = node.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let neighbors: Vec<String> = links
        .iter()
        .filter_map(|e| {
            let s = e.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let t = e.get("target").and_then(|v| v.as_str()).unwrap_or("");
            if s == id {
                Some(format!("-> {t}"))
            } else if t == id {
                Some(format!("<- {s}"))
            } else {
                None
            }
        })
        .take(20)
        .collect();

    Ok(format!(
        "Nó: {id}\nConexões:\n{}",
        if neighbors.is_empty() {
            "  (nenhuma aresta)".to_string()
        } else {
            neighbors.join("\n")
        }
    ))
}

pub(super) async fn execute_graphify_path(dir: &str, from: &str, to: &str) -> Result<String, String> {
    let check = execute_graphify_check(dir);
    let Some(json_path) = check.get("graphJsonPath").and_then(|v| v.as_str()) else {
        return Ok("Nenhum Knowledge Graph encontrado neste diretório.".to_string());
    };
    let bytes = tokio::fs::read(json_path).await.map_err(|e| e.to_string())?;
    let g: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let links = g
        .get("links")
        .or_else(|| g.get("edges"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for e in &links {
        if let (Some(s), Some(t)) = (
            e.get("source").and_then(|v| v.as_str()),
            e.get("target").and_then(|v| v.as_str()),
        ) {
            adj.entry(s.to_string()).or_default().push(t.to_string());
            adj.entry(t.to_string()).or_default().push(s.to_string());
        }
    }

    let mut q = VecDeque::new();
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut visited = HashSet::new();
    q.push_back(from.to_string());
    visited.insert(from.to_string());

    while let Some(curr) = q.pop_front() {
        if curr == to {
            let mut path = vec![curr.clone()];
            let mut cur = curr;
            while let Some(p) = parent.get(&cur) {
                path.push(p.clone());
                cur = p.clone();
            }
            path.reverse();
            return Ok(path.join(" -> "));
        }
        if let Some(nexts) = adj.get(&curr) {
            for n in nexts {
                if visited.insert(n.clone()) {
                    parent.insert(n.clone(), curr.clone());
                    q.push_back(n.clone());
                }
            }
        }
    }

    Ok(format!("Nenhum caminho encontrado entre '{from}' e '{to}'."))
}
