use std::process::{Command, Output};
use thiserror::Error;

pub const CLI_MAX_ARGS: usize = 256;
pub const CLI_MAX_ARG_CHARS: usize = 1024 * 1024; // 1 MB
pub const IPC_MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024; // 2 MB

const ALLOWED_BINARIES: &[&str] = &[
    "git",
    "python",
    "python3",
    "agy",
    "codex",
    "opencode",
];

#[derive(Error, Debug, PartialEq, Eq)]
pub enum ProcessSecurityError {
    #[error("Binary '{0}' is not in the mindAgentics allowed execution whitelist")]
    BinaryNotAllowed(String),
    #[error("Binary path traversal or directory separators are forbidden in command name")]
    PathTraversalInBinary,
    #[error("Exceeded maximum argument count of {CLI_MAX_ARGS}")]
    TooManyArgs,
    #[error("Argument at index {0} exceeds maximum length of {CLI_MAX_ARG_CHARS} characters")]
    ArgTooLong(usize),
    #[error("Argument at index {0} contains forbidden control characters or null bytes")]
    ArgControlChars(usize),
    #[error("Subprocess execution failed: {0}")]
    ExecutionFailed(String),
    #[error("Subprocess output exceeds IPC maximum payload size of {IPC_MAX_PAYLOAD_BYTES} bytes")]
    OutputTooLarge,
}

/// Validates binary against whitelist and runs parameterized command directly without shell.
pub fn execute_parameterized(binary: &str, args: &[String]) -> Result<Output, ProcessSecurityError> {
    // Binary validation: no slashes or relative directory traversal
    if binary.contains('/') || binary.contains('\\') || binary.contains("..") {
        return Err(ProcessSecurityError::PathTraversalInBinary);
    }

    let bin_lower = binary.to_ascii_lowercase();
    let bin_base = bin_lower.strip_suffix(".exe").unwrap_or(&bin_lower);

    if !ALLOWED_BINARIES.contains(&bin_base) {
        return Err(ProcessSecurityError::BinaryNotAllowed(binary.to_string()));
    }

    // Arguments validation
    if args.len() > CLI_MAX_ARGS {
        return Err(ProcessSecurityError::TooManyArgs);
    }

    for (i, arg) in args.iter().enumerate() {
        if arg.len() > CLI_MAX_ARG_CHARS {
            return Err(ProcessSecurityError::ArgTooLong(i));
        }
        if arg.chars().any(|c| c.is_control() || c == '\0') {
            return Err(ProcessSecurityError::ArgControlChars(i));
        }
    }

    // Direct invocation without shell
    let output = Command::new(binary)
        .args(args)
        .output()
        .map_err(|e| ProcessSecurityError::ExecutionFailed(e.to_string()))?;

    if output.stdout.len() + output.stderr.len() > IPC_MAX_PAYLOAD_BYTES {
        return Err(ProcessSecurityError::OutputTooLarge);
    }

    Ok(output)
}
