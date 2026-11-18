use regex::Regex;
use std::sync::LazyLock;

static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)?|\x1B\[[0-?]*[ -/]*[@-~]|\x1B[@-Z\\\-_])").unwrap()
});

static CONTROL_CHARS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[\x00-\x1F\x7F-\x9F]").unwrap()
});

static MULTI_SPACE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\s{2,}").unwrap()
});

static SECRET_PATTERNS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:key|token|secret|password|bearer|auth|api[-_]?key)\s*[:=]\s*['\x22]?([a-zA-Z0-9_\-\.]{8,})['\x22]?").unwrap()
});

pub fn strip_ansi(input: &str) -> String {
    ANSI_RE.replace_all(input, "").to_string()
}

pub fn sanitize_label(input: &str, max_len: usize) -> String {
    let clean = strip_ansi(input);
    let no_nl = clean.replace(['\r', '\n'], " ");
    let no_ctrl = CONTROL_CHARS_RE.replace_all(&no_nl, "");
    let collapsed = MULTI_SPACE_RE.replace_all(&no_ctrl, " ");
    let trimmed = collapsed.trim();
    trimmed.chars().take(max_len).collect()
}

pub fn sanitize_markdown_inline(input: &str, max_len: usize) -> String {
    let base = sanitize_label(input, max_len);
    let no_ticks = base.replace('`', "'");
    let safe_tags = no_ticks.replace('<', "‹").replace('>', "›");
    
    // Defuse leading markdown markers (#, >, *, -, +, |)
    static LEADING_MARKDOWN_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^([#>*\-+|]|\d+[.)])+\s*").unwrap()
    });
    let defused = LEADING_MARKDOWN_RE.replace(&safe_tags, "").to_string();

    // Defuse markdown links [text](url) -> text
    static LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\[([^\]]*)\]\(([^)]*)\)").unwrap()
    });
    LINK_RE.replace_all(&defused, "$1").to_string()
}

pub fn sanitize_markdown_block(input: &str, max_len: usize) -> String {
    let clean = strip_ansi(input);
    let normalized = clean.replace("\r\n", "\n").replace('\r', "\n");
    let no_ctrl = CONTROL_CHARS_RE.replace_all(&normalized, "");
    
    // Defuse fences ``` or ~~~
    static FENCE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^(\s*)(`{3,}|~{3,})").unwrap()
    });
    let defused_fences = FENCE_RE.replace_all(&no_ctrl, "$1\u{200B}$2");

    // Defuse leading headings
    static HEADING_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^(\s*)#").unwrap()
    });
    let defused_headings = HEADING_RE.replace_all(&defused_fences, "$1\\#");

    let safe_tags = defused_headings.replace('<', "‹");

    safe_tags.chars().take(max_len).collect()
}

pub fn sanitize_for_pty_line(input: &str, max_len: usize) -> String {
    let clean = strip_ansi(input);
    let no_nl = clean.replace(['\r', '\n'], " ");
    let no_ctrl = CONTROL_CHARS_RE.replace_all(&no_nl, "");
    let collapsed = MULTI_SPACE_RE.replace_all(&no_ctrl, " ");
    let trimmed = collapsed.trim();
    trimmed.chars().take(max_len).collect()
}

pub fn redact_secrets(input: &str) -> String {
    SECRET_PATTERNS.replace_all(input, "[REDACTED]").to_string()
}

pub const IPC_MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024; // 2 MB

pub fn estimate_payload_size(value: &serde_json::Value, limit: usize) -> usize {
    let mut size = 0usize;
    let mut stack: Vec<(&serde_json::Value, usize)> = vec![(value, 0)];
    while let Some((v, depth)) = stack.pop() {
        if size > limit {
            break;
        }
        match v {
            serde_json::Value::Null => {}
            serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
                size += 8;
            }
            serde_json::Value::String(s) => {
                size += s.len();
            }
            serde_json::Value::Array(arr) => {
                if depth > 32 {
                    return limit.saturating_add(1);
                }
                size += 2;
                for item in arr {
                    stack.push((item, depth + 1));
                }
            }
            serde_json::Value::Object(map) => {
                if depth > 32 {
                    return limit.saturating_add(1);
                }
                for (k, val) in map {
                    size += k.len();
                    stack.push((val, depth + 1));
                }
            }
        }
    }
    size
}

pub fn assert_payload_within_limit(
    channel: &str,
    payload: &serde_json::Value,
    limit: usize,
) -> Result<(), String> {
    if estimate_payload_size(payload, limit) > limit {
        Err(format!(
            "IPC payload too large for {channel} (limit {limit} bytes)"
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitize_for_pty_line_strips_control_chars_ansi_and_newlines() {
        let dirty = "\x1b[31mhello\x1b[0m\r\nworld\x00\x07\x1b]0;evil\x07  !";
        let clean = sanitize_for_pty_line(dirty, 100);
        assert_eq!(clean, "hello world !");
        assert!(!clean.chars().any(|c| c.is_control()));
    }

    #[test]
    fn sanitize_for_pty_line_respects_max_len() {
        let input = "abcdefghij";
        assert_eq!(sanitize_for_pty_line(input, 5), "abcde");
    }

    #[test]
    fn assert_payload_within_limit_validates_bounds() {
        let small = json!({ "terminalId": "t1", "data": "hello" });
        assert!(assert_payload_within_limit("terminal:write", &small, 128).is_ok());

        let large = json!({ "data": "x".repeat(256) });
        let err = assert_payload_within_limit("terminal:write", &large, 128).unwrap_err();
        assert!(err.contains("IPC payload too large"));
        assert!(err.contains("terminal:write"));

        // Deeply nested object exceeds depth cap
        let mut nested = json!("leaf");
        for _ in 0..40 {
            nested = json!({ "k": nested });
        }
        assert!(assert_payload_within_limit("canvas:sync", &nested, 10_000).is_err());
    }
}
