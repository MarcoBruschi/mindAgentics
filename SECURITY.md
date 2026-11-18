# Security Policy - mindAgentics

mindAgentics takes the security, privacy, and integrity of autonomous multi-agent environments seriously.
This document outlines our security policies, supported versions, responsible vulnerability disclosure process, and operational security architecture across our Tauri v2 desktop runtime, core daemon, and inter-agent communication channels.

---

## 1. Supported Versions

Security updates and vulnerability patches are actively maintained for the following versions:

| Version   | Supported          | Notes                                                    |
| :-------- | :----------------- | :------------------------------------------------------- |
| `0.26.x`  | :white_check_mark: | Current active release branch with full security support |
| `0.25.x`  | :white_check_mark: | Critical security patches only                           |
| `< 0.25`  | :x:                | End of life (EOL); please upgrade to current version     |

---

## 2. Reporting a Vulnerability

If you discover a potential security vulnerability within mindAgentics, please report it privately and responsibly. **Do not create public GitHub issues or discussions for sensitive security findings.**

### Reporting Procedure
1. **Direct Communication**: Send your security report to our dedicated security contact or open a private advisory via GitHub Security Advisories at [https://github.com/MarcoBruschi/mindAgentics/security/advisories/new](https://github.com/MarcoBruschi/mindAgentics/security/advisories/new).
2. **Information to Include**:
   - Detailed description of the vulnerability and attack vector.
   - Exact steps or minimal Proof of Concept (PoC) to reproduce the issue safely.
   - Affected components (e.g., Tauri v2 backend, Core Daemon, Named Pipe IPC, PTY Terminal, or Webview).
   - Potential impact (e.g., privilege escalation, unauthorized IPC command execution, token leakage).
   - Any proposed mitigations or remediations.

### Response Timelines (SLA)
- **Initial Acknowledgment**: Within 24-48 business hours.
- **Triage & Assessment**: Within 5 business days.
- **Patch Development & Verification**: Target within 14 business days for high/critical severity.
- **Coordinated Disclosure**: We adhere to coordinated responsible disclosure, providing credit to researchers after a verified fix has been released.

---

## 3. Architecture & Operational Hardening

mindAgentics enforces defense-in-depth across the desktop application layer, local daemon process, and agent execution sandbox:

### 3.1 Tauri v2 Desktop Hardening
- **Strict Content Security Policy (CSP)**: `app.security.csp` in `tauri.conf.json` enforces strict script/style source restrictions, blocking inline eval (`unsafe-eval` disabled) and remote code injection.
- **Global Injection Disabled**: `withGlobalTauri` is explicitly set to `false`, preventing untrusted scripts or third-party web content from accessing native Tauri APIs.
- **Minimal Capability ACL**: Tauri v2 capability definitions (`capabilities/default.json`) grant the absolute minimum required surface area strictly mapped to the `"main"` window.
- **Webview & Portal Isolation**: Remote iframes and embedded browser portals (`PortalNode`) are completely quarantined from Tauri IPC and system capabilities.

### 3.2 Named Pipe & IPC Security
- **Bounded Buffers & Framing**: Local Named Pipe IPC (`\\.\pipe\mindagentics_*` on Windows and Unix Domain Sockets on POSIX) enforces strict payload size limits to prevent buffer overflow and memory exhaustion DoS.
- **Envelope Validation**: CLI request envelopes and IPC schemas are rigorously validated before execution. Malformed or tampered messages are immediately rejected with error logging.
- **Dynamic & Scoped Sockets**: Named Pipes utilize unique session tokens rather than static global names, preventing unauthorized local process hijacking.

### 3.3 Secrets & Privacy Protection
- **Automated Secrets Redaction**: Terminal outputs, IPC logs, and shared memories pass through a multi-pass regex redaction pipeline that scrubs:
  - Bearer tokens and JWTs
  - API keys (OpenAI `sk-*`, Anthropic, Google Cloud, AWS credentials, GitHub tokens)
  - Passwords and database connection strings
- **File System Permissions**: Local memory databases and SQLite indexes are created with restrictive file permissions (`0o700` for memory directories, `0o600` for credential and state files).
- **Git Tracking Exclusions**: `.gitignore` strictly ignores local configurations, secrets, keys, environment files (`.env*`, `*.pem`, `*.key`), and memory caches (`.mindagentics/memory/`).

### 3.4 PTY Terminal & Process Isolation
- **Path Traversal & Shell Injection Defense**: All file paths are canonicalized and validated using `dunce::canonicalize` / `path.resolve`. Null bytes, DOS reserved device names (`CON`, `PRN`, `AUX`), UNC paths, and directory traversal attempts (`../`) are strictly blocked.
- **Binary Planting Protection**: The process launcher ignores empty or relative entries in `PATH` and rejects binary execution attempts targeting temporary operating system directories (`%TEMP%`, `AppData/Local/Temp`, `/tmp`).
- **Orchestrator Privilege Latch**: Agent terminals maintain strict post-creation immutability. An autonomous agent or terminal session cannot escalate its privileges or change its orchestrator role post-spawn.
- **Untrusted Memory Sanitization**: Memory turn summaries injected into agent context are tagged as untrusted data with neutralized delimiter tags, preventing prompt injection and jailbreak payloads.
