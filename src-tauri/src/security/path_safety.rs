use std::path::{Path, PathBuf};
use regex::Regex;
use std::sync::LazyLock;
use thiserror::Error;

pub const PATH_MAX_CHARS: usize = 4096;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PathSafetyError {
    #[error("Path is empty")]
    Empty,
    #[error("Path is too long (exceeds {PATH_MAX_CHARS} characters)")]
    TooLong,
    #[error("Path contains control characters or null bytes")]
    ControlChars,
    #[error("UNC network paths are not allowed")]
    UncPath,
    #[error("Device namespace paths (e.g. \\\\.\\) are not allowed")]
    DeviceNamespace,
    #[error("Alternate data streams are not allowed")]
    AlternateDataStream,
    #[error("Reserved Windows device name: {0}")]
    ReservedDevice(String),
    #[error("Invalid workspace root")]
    InvalidRoot,
    #[error("Path escapes the workspace")]
    OutsideWorkspace,
    #[error("Symlink target escapes the workspace")]
    SymlinkEscape,
}

pub type PathDenyReason = PathSafetyError;

static WIN_RESERVED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$").unwrap()
});

#[derive(Debug)]
pub struct PathCheckResult {
    pub ok: bool,
    pub path: Option<PathBuf>,
    pub reason: Option<PathSafetyError>,
    pub message: Option<String>,
    pub requires_confirmation: bool,
}

impl PathCheckResult {
    pub fn success(p: PathBuf) -> Self {
        Self {
            ok: true,
            path: Some(p),
            reason: None,
            message: None,
            requires_confirmation: false,
        }
    }

    pub fn deny(reason: PathSafetyError, message: impl Into<String>, requires_confirmation: bool) -> Self {
        Self {
            ok: false,
            path: None,
            reason: Some(reason),
            message: Some(message.into()),
            requires_confirmation,
        }
    }
}

pub fn check_path_string(input: &str) -> PathCheckResult {
    if input.trim().is_empty() {
        return PathCheckResult::deny(PathSafetyError::Empty, "path is empty", false);
    }
    if input.len() > PATH_MAX_CHARS {
        return PathCheckResult::deny(PathSafetyError::TooLong, "path is too long", false);
    }

    // Check for control characters and null bytes
    if input.chars().any(|c| c.is_control() || c == '\0') {
        return PathCheckResult::deny(PathSafetyError::ControlChars, "path contains control characters", false);
    }

    // Block UNC and device namespace paths
    if input.starts_with(r"\\") {
        if input.starts_with(r"\\.\") || input.starts_with(r"\\?\") {
            return PathCheckResult::deny(PathSafetyError::DeviceNamespace, "device namespace paths are not allowed", false);
        }
        return PathCheckResult::deny(PathSafetyError::UncPath, "UNC network paths are not allowed", false);
    }
    if input.starts_with("//") {
        return PathCheckResult::deny(PathSafetyError::UncPath, "UNC network paths are not allowed", false);
    }

    #[cfg(windows)]
    {
        // Alternate Data Streams: anything with ':' other than drive letter
        let rest = if input.len() >= 2 && input.as_bytes()[1] == b':' {
            &input[2..]
        } else {
            input
        };
        if rest.contains(':') {
            return PathCheckResult::deny(PathSafetyError::AlternateDataStream, "alternate data streams / invalid ':' in path", false);
        }

        // Check Windows reserved DOS devices (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
        for seg in input.split(|c| c == '/' || c == '\\') {
            let upper = seg.to_uppercase();
            if upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL" 
                || upper.starts_with("COM1") || upper.starts_with("LPT1") || WIN_RESERVED.is_match(seg) {
                return PathCheckResult::deny(PathSafetyError::ReservedDevice(seg.to_string()), format!("reserved device name: {seg}"), false);
            }
        }
    }

    PathCheckResult::success(PathBuf::from(input))
}

pub fn assert_safe_path_string(input: &str) -> Result<PathBuf, String> {
    let check = check_path_string(input);
    if !check.ok {
        return Err(format!("Invalid path: {}", check.message.unwrap_or_default()));
    }
    Ok(PathBuf::from(input))
}

pub fn is_inside(parent: &Path, child: &Path) -> bool {
    let p = dunce::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    let c = dunce::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());

    #[cfg(windows)]
    let (p_str, c_str) = (
        p.to_string_lossy().to_lowercase(),
        c.to_string_lossy().to_lowercase(),
    );
    #[cfg(not(windows))]
    let (p_str, c_str) = (
        p.to_string_lossy().to_string(),
        c.to_string_lossy().to_string(),
    );

    if c_str == p_str {
        return true;
    }
    c.starts_with(&p)
}

pub fn resolve_workspace_path(
    workspace_root: &Path,
    input: &str,
    confirm_outside: bool,
) -> PathCheckResult {
    let syntax = check_path_string(input);
    if !syntax.ok {
        return syntax;
    }

    let real_root = match dunce::canonicalize(workspace_root) {
        Ok(r) => r,
        Err(_) => return PathCheckResult::deny(PathSafetyError::InvalidRoot, "workspace root does not exist", false),
    };

    let lexical = real_root.join(input);
    let is_inside_lexical = is_inside(&real_root, &lexical);

    if !is_inside_lexical && !confirm_outside {
        return PathCheckResult::deny(
            PathSafetyError::OutsideWorkspace,
            "path escapes the workspace (traversal or absolute path)",
            true,
        );
    }

    match dunce::canonicalize(&lexical) {
        Ok(real) => {
            if !is_inside(&real_root, &real) && !confirm_outside {
                PathCheckResult::deny(
                    PathSafetyError::SymlinkEscape,
                    "path resolves through a symlink/junction outside the workspace",
                    true,
                )
            } else {
                PathCheckResult::success(real)
            }
        }
        Err(_) => {
            if is_inside_lexical || confirm_outside {
                PathCheckResult::success(lexical)
            } else {
                PathCheckResult::deny(
                    PathSafetyError::OutsideWorkspace,
                    "path escapes the workspace",
                    true,
                )
            }
        }
    }
}
