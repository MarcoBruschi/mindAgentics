use std::path::{Path, PathBuf};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use crate::security::sanitizer::strip_ansi;

pub const DEFAULT_MAX_LOG_BYTES: u64 = 1024 * 1024 * 2; // 2MB
pub const SUMMARY_MAX_CHARS: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryLogEntry {
    pub timestamp: String,
    pub source: String,
    pub content: String,
}

#[derive(Clone)]
pub struct MemoryService {
    max_log_bytes: u64,
}

impl MemoryService {
    pub fn new() -> Self {
        Self {
            max_log_bytes: DEFAULT_MAX_LOG_BYTES,
        }
    }

    pub fn memory_dir(cwd: &Path, agent_name: &str) -> PathBuf {
        cwd.join(".mindagentics").join("memory").join(sanitize_agent_folder(agent_name))
    }

    pub fn summary_rel_path(agent_name: &str) -> String {
        format!(".mindagentics/memory/{}/summary.md", sanitize_agent_folder(agent_name))
    }

    pub fn has_memory(&self, cwd: &Path, agent_name: &str) -> bool {
        let dir = Self::memory_dir(cwd, agent_name);
        dir.join("log.jsonl").exists() || dir.join("summary.md").exists()
    }

    pub fn has_summary(&self, cwd: &Path, agent_name: &str) -> bool {
        Self::memory_dir(cwd, agent_name).join("summary.md").exists()
    }

    pub async fn append_turn(&self, cwd: &Path, agent_name: &str, source: &str, raw_output: &str) -> Result<()> {
        let dir = Self::memory_dir(cwd, agent_name);
        if !dir.exists() {
            tokio::fs::create_dir_all(&dir).await?;
        }

        let clean = strip_ansi(raw_output);
        let trimmed = clean.trim();
        if trimmed.is_empty() {
            return Ok(());
        }

        let entry = MemoryLogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: source.to_string(),
            content: trimmed.to_string(),
        };

        let log_path = dir.join("log.jsonl");

        // Rotate if exceeding max bytes
        if let Ok(metadata) = tokio::fs::metadata(&log_path).await {
            if metadata.len() > self.max_log_bytes {
                let rotated_path = dir.join("log.old.jsonl");
                let _ = tokio::fs::rename(&log_path, &rotated_path).await;
            }
        }

        use tokio::io::AsyncWriteExt;
        let line = format!("{}\n", serde_json::to_string(&entry)?);
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .await?;
        file.write_all(line.as_bytes()).await?;
        file.flush().await?;

        Ok(())
    }

    pub async fn generate_summary(&self, cwd: &Path, agent_name: &str) -> Result<String> {
        let dir = Self::memory_dir(cwd, agent_name);
        let log_path = dir.join("log.jsonl");
        if !log_path.exists() {
            return Ok(String::new());
        }

        let data = tokio::fs::read_to_string(&log_path).await?;
        let lines: Vec<&str> = data.lines().filter(|l| !l.trim().is_empty()).collect();

        // Local offline heuristic summary: gather most recent key decisions and actions
        let mut summary_lines = Vec::new();
        summary_lines.push(format!("# Memória Operacional — Agente `{agent_name}`"));
        summary_lines.push(format!("*Última atualização: {}*", chrono::Utc::now().format("%d/%m/%Y %H:%M")));
        summary_lines.push(String::new());
        summary_lines.push("### Últimas Ações e Contexto Consolidado:".to_string());

        let tail = if lines.len() > 15 {
            &lines[lines.len() - 15..]
        } else {
            &lines[..]
        };

        for l in tail {
            if let Ok(entry) = serde_json::from_str::<MemoryLogEntry>(l) {
                let snippet = if entry.content.len() > 160 {
                    format!("{}...", &entry.content[..157])
                } else {
                    entry.content
                };
                summary_lines.push(format!("- [{}] {}: {}", &entry.timestamp[11..16], entry.source, snippet));
            }
        }

        let full_text = summary_lines.join("\n");
        let bounded = if full_text.len() > SUMMARY_MAX_CHARS {
            format!("{}...\n\n[Resumo truncado localmente]", &full_text[..SUMMARY_MAX_CHARS - 40])
        } else {
            full_text
        };

        let summary_path = dir.join("summary.md");
        tokio::fs::write(&summary_path, &bounded).await?;

        Ok(bounded)
    }

    pub async fn search(&self, cwd: &Path, query: &str, limit: usize) -> Result<Vec<String>> {
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();
        let memory_root = cwd.join(".mindagentics").join("memory");

        if !memory_root.exists() {
            return Ok(results);
        }

        let mut read_dir = tokio::fs::read_dir(&memory_root).await?;
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let log_file = path.join("log.jsonl");
                if log_file.exists() {
                    if let Ok(content) = tokio::fs::read_to_string(&log_file).await {
                        for line in content.lines().rev() {
                            if line.to_lowercase().contains(&query_lower) {
                                if let Ok(parsed) = serde_json::from_str::<MemoryLogEntry>(line) {
                                    results.push(format!("[{}] {}: {}", parsed.timestamp, parsed.source, parsed.content));
                                    if results.len() >= limit {
                                        return Ok(results);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(results)
    }
}

fn sanitize_agent_folder(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
