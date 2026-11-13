use regex::Regex;
use std::sync::LazyLock;

static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)?)").unwrap()
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
    if trimmed.len() > max_len {
        trimmed[..max_len].to_string()
    } else {
        trimmed.to_string()
    }
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

    if safe_tags.len() > max_len {
        safe_tags[..max_len].to_string()
    } else {
        safe_tags
    }
}

pub fn sanitize_for_pty_line(input: &str, max_len: usize) -> String {
    let clean = strip_ansi(input);
    let no_nl = clean.replace(['\r', '\n'], " ");
    let no_ctrl = CONTROL_CHARS_RE.replace_all(&no_nl, "");
    let collapsed = MULTI_SPACE_RE.replace_all(&no_ctrl, " ");
    let trimmed = collapsed.trim();
    if trimmed.len() > max_len {
        trimmed[..max_len].to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn redact_secrets(input: &str) -> String {
    SECRET_PATTERNS.replace_all(input, "[REDACTED]").to_string()
}
