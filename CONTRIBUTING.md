# Contributing to mindAgentics

Thank you for your interest in contributing to **mindAgentics**! We welcome contributions from developers, researchers, and open source enthusiasts worldwide.

This guide outlines our development workflow, architectural conventions, coding standards, and testing procedures to ensure smooth collaboration.

---

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior privately via [GitHub Security Advisories](https://github.com/MarcoBruschi/mindAgentics/security/advisories/new).

---

## Architectural Overview

mindAgentics is built as a high-performance spatial development workspace integrating autonomous AI agents and human engineers on an infinite 2D canvas. The project is organized as a monorepo:

### 1. Tauri v2 Desktop Engine
- **Platform Layer (`src-tauri/`)**: High-performance Rust application providing system webview integration, window management, system tray, native menus, and low-latency OS capabilities.

### 2. Spatial Renderer & UI
- **Frontend Canvas (`packages/renderer/`)**: Powered by **React 19**, **Tailwind CSS**, and **Jotai**. Implements an infinite pan/zoom canvas (10% to 300%), smooth marquee multi-selection, 21-point catenary physical cable simulation between nodes, and native-feeling interactive agent terminals.

### 3. Core Daemon & IPC
- **Daemon (`packages/core-daemon/`)**: Autonomous process orchestrator managing multi-agent lifecycles, execution sandboxes, floor worktrees, and IPC communication over high-speed Named Pipes (`\\.\pipe\mindagentics-<token>`, configured via `MINDAGENTICS_PIPE`).

### 4. Shared Libraries & Public API
- **Shared (`packages/shared/`)**: Domain models, geometry algorithms, catenary physics math, and protocol schemas.
- **Public API (`packages/public-api/`)**: Typed contracts, client SDKs, and CLI bindings.

### 5. Knowledge Graph (Graphify)
- Deterministic AST analysis and knowledge graph querying for codebase navigation and context minimization.

---

## Prerequisites & Setup

Ensure the following tools are installed on your workstation:

- **Node.js**: `v20.x` or later (LTS recommended)
- **npm**: `v10.x` or later
- **Rust & Cargo**: `v1.85+` with platform-specific Tauri dependencies (see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/))
- **Python**: `3.10+` (optional, required for Graphify AST indexing)
- **C/C++ Build Tools**: Required for native addons (`node-pty`) on Windows / Linux / macOS

### Repository Installation

1. Fork the repository on GitHub and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/mindAgentics.git
   cd mindAgentics
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build all workspace packages:
   ```bash
   npm run build
   ```

4. Start the application in development mode:
   ```bash
   npm run tauri:dev
   ```

---

## Development Workflow & Branching Strategy

We follow a structured branch workflow:

- `main`: Production-ready branch. All releases are tagged from `main`.
- `feature/<name>`: New capabilities or functional enhancements.
- `fix/<name>`: Bug fixes and patches.
- `docs/<name>`: Documentation improvements and guides.
- `refactor/<name>`: Code restructuring without functional changes.

Always create your branch from the latest `main`:
```bash
git checkout main
git pull origin main
git checkout -b feature/dynamic-cable-routing
```

---

## Commit Message Guidelines

We enforce the **Conventional Commits** specification:

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: A new feature or capability
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (formatting, linting)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Maintenance tasks, dependency updates, build tooling

### Scopes
Common scopes include: `canvas`, `daemon`, `ipc`, `renderer`, `terminal`, `graphify`, `shared`, `cli`.

### Examples
- `feat(canvas): add bezier smoothing option to catenary cables`
- `fix(daemon): resolve named pipe reconnection timeout on windows`
- `docs(readme): update quickstart instructions for tauri v2`

---

## Testing & Verification

Before submitting any changes, verify that all test suites pass locally:

### 1. Authorship & Governance Audit
Ensures identity compliance, absence of deprecated legacy terminology, and repository standards:
```bash
npm run test:authorship
```

### 2. Security Test Suite
Verifies IPC boundary enforcement, input sanitization, and command injection protections:
```bash
npm run test:security
```

### 3. Functional Test Suite
Verifies daemon operations, IPC protocols, and agent orchestration:
```bash
npm run test:functional
```

### 4. Complete Test Suite
Run all tests at once:
```bash
npm test
```

---

## Pull Request Checklist

When submitting a Pull Request, please ensure:

- [ ] Branch is rebased against the latest `main`.
- [ ] Code builds without errors or warnings (`npm run build`).
- [ ] All tests pass (`npm test`).
- [ ] New functionality includes corresponding unit/integration tests.
- [ ] Commit messages follow the Conventional Commits specification.
- [ ] Documentation is updated if public APIs or user configurations changed.
- [ ] No extraneous files, credentials, or build artifacts are committed.

---

## Community & Support

Have questions, ideas, or feedback?
- Open an issue or discussion on GitHub: [mindAgentics Issues](https://github.com/MarcoBruschi/mindAgentics/issues)
- Reach out to our maintainers: [GitHub Issues](https://github.com/MarcoBruschi/mindAgentics/issues) or [GitHub Discussions](https://github.com/MarcoBruschi/mindAgentics/discussions)

Thank you for helping make mindAgentics an exceptional tool for developers and autonomous agents!
