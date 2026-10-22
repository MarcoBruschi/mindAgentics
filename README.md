# mindAgentics 🪄

**mindAgentics** is a spatial development workspace that connects AI agents, terminals, notes, and browser portals on an interactive infinite canvas.

---

## ✨ Features

- **Spatial Infinite Canvas**: Smooth pan, zoom, marquee selection, drag & drop, and node snapping.
- **Inter-Agent Communication**: Connect agents with cable ties and route instructions with `maestri ask`.
- **Integrated Agent CLI Detection**: Built-in detection for GitHub Copilot, Antigravity (`agy`), Codex, OpenCode, and local shells.
- **Agent Terminal Modals**: Quick-start templates, appearance customization, and autonomous execution modes.
- **Browser Portals**: Embedded interactive web browsers with accessibility tree DOM inspection (`@e1`, `@e2`), text extraction, and automated browsing.
- **Freehand Canvas Painting**: Draw, annotate, and brainstorm directly on top of the canvas with real-time vector strokes.
- **Undo / Redo (`Ctrl+Z` / `Ctrl+Y`)**: Complete state history management for all canvas actions.
- **Continuous Workspace Auto-Save**: Persistent multi-workspace management with safe folder targeting and deletion safeguards.

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.x
- npm >= 10.x

### Installation

```bash
git clone https://github.com/MarcoBruschi/mindAgentics.git
cd mindAgentics
npm install
```

### Build

```bash
npm run build
```

### Run in Development

```bash
npm start
```

---

## 🛠️ Monorepo Architecture

- `packages/shared`: Shared TypeScript types, IPC channel contracts, and node schemas.
- `packages/core-daemon`: Inter-agent message router, named pipe server, and CLI tool handlers.
- `packages/main`: Electron main supervisor, PTY terminal lifecycle manager, and atomic storage service.
- `packages/preload`: Context-isolated secure bridge APIs.
- `packages/renderer`: React + Vite + Tailwind CSS spatial infinite canvas interface.
- `skills/`: Maestri and agent CLI skills.
