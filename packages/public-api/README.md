# mindAgentics Public Platform Interface & Capabilities

mindAgentics is an infinite spatial development canvas connecting AI agents, interactive browser portals, sticky notes, and git worktrees.

## Available Agent CLI Commands

The `mindagentics` CLI provides the following core commands:

### 1. Agent Delegation & Communication
- `mindagentics list` — Inspect all active agents, sticky notes, portals, and cable connections on the canvas.
- `mindagentics ask "<Agent Name>" "<Prompt>"` — Delegate a task to a connected agent terminal and receive the result.
- `mindagentics ask --batch '{"Agent A": "task", "Agent B": "task"}'` — Parallel delegation across multiple agents.
- `mindagentics say "<Message>"` — Broadcast an announcement across all terminals in the workspace.
- `mindagentics check "<Agent Name>"` — Read current terminal output of an agent without sending input.

### 2. Agent Recruitment & Lifecycle
- `mindagentics recruit "<Name>" --preset "<preset>" --role "<role>"` — Recruit a specialized agent to the workspace.
  - Presets: `Antigravity`, `Codex`, `OpenCode`, `Claude Code`, `Shell`.
- `mindagentics dismiss "<Name>"` — Terminate and remove an agent from the canvas.

### 3. Interactive Web & Doc Portals
- `mindagentics portal open "<URL>" --name "<Title>"` — Open a live browser portal on the canvas.
- `mindagentics portal navigate "<URL>"` — Navigate an existing portal.
- `mindagentics portal click "<Selector>"` — Click web elements inside the portal.
- `mindagentics portal fill "<Selector>" "<Value>"` — Fill form fields inside the portal.
- `mindagentics portal screenshot --out "<File>"` — Capture screenshots.

### 4. Canvas Wiring (CableTies)
- `mindagentics connect "<Source>" "<Target>"` — Wire nodes together on the canvas (e.g. Agent to Portal, Agent to Note).

### 5. Spatial Sticky Notes & Fichários
- `mindagentics note create --name "<Name>" --body "<Content>"` — Place a sticky note on the canvas.
- `mindagentics note read "<Name>"` — Read note contents with line numbers.
- `mindagentics note write "<Name>" "<Content>"` — Replace note contents.
- `mindagentics note edit "<Name>" "<Old>" "<New>"` — Replace substring within a note.
- `mindagentics note stack "<Name>" "<Fichario>"` — Group notes inside a fichário.

### 6. Knowledge Graph (Graphify)
- `mindagentics graphify build "<Path|GitURL>"` — Extract deterministic AST architecture graph.
- `mindagentics graphify query "<Question>"` — Semantic BFS traversal of the knowledge graph.
- `mindagentics graphify explain "<Symbol>"` — Plain-language node and neighbor explanation.
- `mindagentics graphify path "<From>" "<To>"` — Shortest relationship path between nodes.
- `mindagentics graphify open` — Open interactive graph visualizer inside a browser portal on canvas.

### 7. Worktree Floors & Isolation
- `mindagentics floor create "<Branch>"` — Create an isolated worktree for parallel work.
- `mindagentics floor switch "<Branch>"` — Switch active terminal to the worktree floor.
- `mindagentics floor land "<Branch>"` — Merge floor back into main and clean up worktree.
- `mindagentics floor status` — Report modified files on the current floor.

### 8. Orchestrator Mode (Modo Orquestrador)
When operating in Orchestrator Mode (`MINDAGENTICS_ORCHESTRATOR_MODE=1` or `MINDAGENTICS_MAESTRO_MODE=1`):
1. **Mandatory Delegation**: Do not execute everything alone. Decompose tasks and delegate via `mindagentics ask`.
2. **Agent Recruitment**: Recruit specialized teammates (Frontend, Backend, QA) via `mindagentics recruit`.
3. **Web References**: Open documentation portals via `mindagentics portal open`, connect them via `mindagentics connect`, and instruct agents to reference them.
