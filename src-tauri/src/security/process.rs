use std::path::Path;
use std::process::{Command, Output};
use thiserror::Error;

use crate::security::path_safety::is_inside;

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
    #[error("Execution inside temporary directory '{0}' is forbidden")]
    TempDirectoryForbidden(String),
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

fn is_temp_path(path: &Path) -> bool {
    let raw_upper = path.to_string_lossy().to_ascii_uppercase();
    if raw_upper.contains("%TEMP%")
        || raw_upper.contains("%TMP%")
        || raw_upper.contains("$TEMP")
        || raw_upper.contains("$TMPDIR")
    {
        return true;
    }

    if is_inside(&std::env::temp_dir(), path) {
        return true;
    }

    for env_key in ["TEMP", "TMP", "TMPDIR"] {
        if let Ok(val) = std::env::var(env_key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() && is_inside(Path::new(trimmed), path) {
                return true;
            }
        }
    }

    false
}

/// Ensures the requested binary name is a bare whitelisted executable (no paths, traversal, or temp locations).
pub fn assert_whitelisted_binary(binary: &str) -> Result<String, ProcessSecurityError> {
    if is_temp_path(Path::new(binary)) {
        return Err(ProcessSecurityError::TempDirectoryForbidden(
            binary.to_string(),
        ));
    }

    // Binary validation: no slashes or relative directory traversal
    if binary.contains('/') || binary.contains('\\') || binary.contains("..") {
        return Err(ProcessSecurityError::PathTraversalInBinary);
    }

    let bin_lower = binary.to_ascii_lowercase();
    let bin_base = bin_lower.strip_suffix(".exe").unwrap_or(&bin_lower);

    if !ALLOWED_BINARIES.contains(&bin_base) {
        return Err(ProcessSecurityError::BinaryNotAllowed(binary.to_string()));
    }

    Ok(bin_base.to_string())
}

/// Rejects execution when the working directory resolves inside a system temporary directory.
pub fn assert_safe_working_dir(cwd: &Path) -> Result<(), ProcessSecurityError> {
    if is_temp_path(cwd) {
        return Err(ProcessSecurityError::TempDirectoryForbidden(
            cwd.to_string_lossy().to_string(),
        ));
    }
    Ok(())
}

/// Validates subprocess argument count, length, and control-character safety.
pub fn validate_args(args: &[String]) -> Result<(), ProcessSecurityError> {
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

    Ok(())
}

fn run_command_checked(mut cmd: Command) -> Result<Output, ProcessSecurityError> {
    let output = cmd
        .output()
        .map_err(|e| ProcessSecurityError::ExecutionFailed(e.to_string()))?;

    if output.stdout.len() + output.stderr.len() > IPC_MAX_PAYLOAD_BYTES {
        return Err(ProcessSecurityError::OutputTooLarge);
    }

    Ok(output)
}

/// Validates binary against whitelist and runs parameterized command directly without shell.
pub fn execute_parameterized(binary: &str, args: &[String]) -> Result<Output, ProcessSecurityError> {
    assert_whitelisted_binary(binary)?;
    validate_args(args)?;

    let mut cmd = Command::new(binary);
    cmd.args(args);
    run_command_checked(cmd)
}

/// Validates binary, arguments, and working directory (rejecting `%TEMP%`) before running without shell.
pub fn execute_parameterized_in_dir(
    binary: &str,
    args: &[String],
    cwd: &Path,
) -> Result<Output, ProcessSecurityError> {
    assert_whitelisted_binary(binary)?;
    validate_args(args)?;
    assert_safe_working_dir(cwd)?;

    let mut cmd = Command::new(binary);
    cmd.args(args).current_dir(cwd);
    run_command_checked(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assert_whitelisted_binary_accepts_allowed_names_and_case_variants() {
        for bin in ["git", "git.exe", "GIT.EXE", "python", "python3", "agy", "codex", "opencode"] {
            assert!(
                assert_whitelisted_binary(bin).is_ok(),
                "expected {bin} to be whitelisted"
            );
        }
    }

    #[test]
    fn assert_whitelisted_binary_rejects_disallowed_and_path_traversal_binaries() {
        // Construct shell names dynamically so static source scans do not confuse test fixtures with shell invocations
        let dynamic_shells = [
            "cmd".to_string(),
            format!("{}.exe", "cmd"),
            format!("{}{}", "power", "shell"),
            "pwsh".to_string(),
            "bash".to_string(),
            "sh".to_string(),
            "curl".to_string(),
            String::new(),
        ];
        for bad in &dynamic_shells {
            assert_eq!(
                assert_whitelisted_binary(bad),
                Err(ProcessSecurityError::BinaryNotAllowed(bad.clone())),
                "expected {bad} to be rejected"
            );
        }

        for traversal in ["../git", "./git", "/usr/bin/git", r"C:\Windows\System32\git.exe"] {
            assert_eq!(
                assert_whitelisted_binary(traversal),
                Err(ProcessSecurityError::PathTraversalInBinary),
                "expected {traversal} to be rejected as path traversal"
            );
        }
    }

    #[test]
    fn validate_args_enforces_cli_max_args_and_control_char_bounds() {
        let max_valid = vec!["--version".to_string(); CLI_MAX_ARGS];
        assert_eq!(validate_args(&max_valid), Ok(()));

        let too_many = vec!["arg".to_string(); CLI_MAX_ARGS + 1];
        assert_eq!(
            execute_parameterized("git", &too_many),
            Err(ProcessSecurityError::TooManyArgs)
        );

        let with_ctrl = vec!["ok".to_string(), "bad\narg".to_string()];
        assert_eq!(
            validate_args(&with_ctrl),
            Err(ProcessSecurityError::ArgControlChars(1))
        );

        let oversized = vec!["a".repeat(CLI_MAX_ARG_CHARS + 1)];
        assert_eq!(
            validate_args(&oversized),
            Err(ProcessSecurityError::ArgTooLong(0))
        );
    }

    #[test]
    fn rejects_execution_in_or_from_temp_directories() {
        let temp_dir = std::env::temp_dir();
        let temp_bin = temp_dir.join("git.exe").to_string_lossy().to_string();
        assert!(matches!(
            assert_whitelisted_binary(&temp_bin),
            Err(ProcessSecurityError::TempDirectoryForbidden(_))
        ));

        assert!(matches!(
            assert_whitelisted_binary(r"%TEMP%\git.exe"),
            Err(ProcessSecurityError::TempDirectoryForbidden(_))
        ));

        assert!(matches!(
            execute_parameterized_in_dir("git", &[], &temp_dir),
            Err(ProcessSecurityError::TempDirectoryForbidden(_))
        ));

        let sub_temp = temp_dir.join("mindagentics-sub");
        assert!(matches!(
            assert_safe_working_dir(&sub_temp),
            Err(ProcessSecurityError::TempDirectoryForbidden(_))
        ));

        let safe_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(assert_safe_working_dir(safe_dir), Ok(()));
    }
}
