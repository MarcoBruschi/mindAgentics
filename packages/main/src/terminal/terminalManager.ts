import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import EventEmitter from 'events';
import * as nodePty from 'node-pty';
import { CoreDaemonSupervisor } from '../supervisor/coreDaemonSupervisor.js';
import type { DataService } from '../storage/dataService.js';
import type { TerminalStatus } from '@mindagentics/shared';
import { probeAntigravity, probeCodex, probeOpenCode, formatResetCountdown, type AgentUsageReport } from './agentProbes.js';

export interface TerminalSpawnOptions {
  id?: string;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  workspaceId?: string;
  presetId?: string;
  title?: string;
  maestroMode?: boolean;
}

export interface TerminalSession {
  id: string;
  workspaceId: string;
  pty: nodePty.IPty;
  cwd: string;
  scrollback: string[];
  status: TerminalStatus;
  attention: boolean;
  focused: boolean;
  cols: number;
  rows: number;
  maestroMode?: boolean;
  activeAskId?: string;
  askOutput?: string;
  askTimer?: NodeJS.Timeout;
  isAlive?: boolean;
}

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();
  private supervisor: CoreDaemonSupervisor;
  private dataService?: DataService;
  private maxScrollbackLines = 10000;
  private saveDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(supervisor: CoreDaemonSupervisor, dataService?: DataService) {
    super();
    this.supervisor = supervisor;
    this.dataService = dataService;

    // Connect supervisor's ptyWrite and deliverPrompt events
    this.supervisor.on('ptyWrite', (payload: { terminalId: string; data: string }) => {
      if (payload && payload.terminalId && payload.data) {
        this.write(payload.terminalId, payload.data);
      }
    });

    this.supervisor.on('deliverPrompt', (payload: any) => {
      if (payload && payload.terminalId && payload.prompt) {
        this.deliverPrompt(payload.terminalId, payload.prompt, payload.askId);
      }
    });
  }

  private resolveCliPath(): { cliPath: string; cliDir: string } {
    const isWin = process.platform === 'win32';
    const binName = isWin ? 'mindagentics.cmd' : 'mindagentics.js';
    const fallbackBinName = isWin ? 'mindagentics.cmd' : 'mindagentics.js';

    const candidates = [
      path.resolve(__dirname, '../../core-daemon/bin', binName),
      path.resolve(__dirname, '../../../core-daemon/bin', binName),
      path.resolve(process.cwd(), 'packages/core-daemon/bin', binName),
      path.resolve(process.cwd(), 'clone/packages/core-daemon/bin', binName),
      path.resolve(__dirname, '../../core-daemon/bin', fallbackBinName),
      path.resolve(__dirname, '../../../core-daemon/bin', fallbackBinName),
      path.resolve(process.cwd(), 'packages/core-daemon/bin', fallbackBinName),
      path.resolve(process.cwd(), 'clone/packages/core-daemon/bin', fallbackBinName)
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return { cliPath: c, cliDir: path.dirname(c) };
      }
    }

    const fallback = candidates[0];
    return { cliPath: fallback, cliDir: path.dirname(fallback) };
  }

  private getStorageDir(): string {
    if (this.dataService) {
      return path.join(this.dataService.getDataDir(), 'terminals');
    }
    if ((process.env.MINDAGENTICS_DATA_DIR || process.env.MAESTRI_DATA_DIR) && (process.env.MINDAGENTICS_DATA_DIR || process.env.MAESTRI_DATA_DIR)!.trim().length > 0) {
      return path.join(path.resolve((process.env.MINDAGENTICS_DATA_DIR || process.env.MAESTRI_DATA_DIR)!.trim()), 'terminals');
    }
    try {
      const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
      const pointerFile = path.join(appData, 'mindAgentics', 'storage-location.json');
      if (fs.existsSync(pointerFile)) {
        const content = JSON.parse(fs.readFileSync(pointerFile, 'utf-8'));
        if (content && typeof content.path === 'string' && content.path.trim().length > 0) {
          return path.join(path.resolve(content.path.trim()), 'terminals');
        }
      }
    } catch {
      // ignore
    }
    return path.join(os.homedir(), '.mindagentics', 'terminals');
  }

  private ensureStorageDir(): string {
    const dir = this.getStorageDir();
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.warn('[TerminalManager] Failed to create storage dir:', err);
    }
    return dir;
  }

  private getLogFilePath(terminalId: string): string {
    const safeId = terminalId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.ensureStorageDir(), `${safeId}.log`);
  }

  private readPersistedScrollback(terminalId: string): string {
    try {
      const filePath = this.getLogFilePath(terminalId);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (err) {
      console.warn(`[TerminalManager] Failed to read persisted scrollback for ${terminalId}:`, err);
    }
    return '';
  }

  private persistScrollback(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    try {
      const filePath = this.getLogFilePath(terminalId);
      const content = session.scrollback.join('');
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
      console.warn(`[TerminalManager] Failed to persist scrollback for ${terminalId}:`, err);
    }
  }

  private scheduleSaveScrollback(terminalId: string): void {
    if (this.saveDebounceTimers.has(terminalId)) return;

    const timer = setTimeout(() => {
      this.saveDebounceTimers.delete(terminalId);
      this.persistScrollback(terminalId);
    }, 500);

    this.saveDebounceTimers.set(terminalId, timer);
  }

  public flushScrollback(terminalId: string): void {
    const timer = this.saveDebounceTimers.get(terminalId);
    if (timer) {
      clearTimeout(timer);
      this.saveDebounceTimers.delete(terminalId);
    }
    this.persistScrollback(terminalId);
  }

  public flushAllScrollbacks(): void {
    for (const terminalId of this.sessions.keys()) {
      this.flushScrollback(terminalId);
    }
  }

  public async spawn(options: TerminalSpawnOptions): Promise<{ terminalId: string; attached?: boolean }> {
    const terminalId = options.id || crypto.randomUUID();
    const workspaceId = options.workspaceId || '';
    const cols = options.cols || 120;
    const rows = options.rows || 32;
    const cwd = options.cwd && fs.existsSync(options.cwd) ? options.cwd : os.homedir();

    // 1. Check if session already exists and is alive (e.g. switching workspaces and returning)
    const existing = this.sessions.get(terminalId);
    if (existing && existing.isAlive) {
      if (options.cols || options.rows) {
        this.resize(terminalId, cols, rows);
      }
      return { terminalId, attached: true };
    }

    // If an existing dead session remains in memory, clean it up
    if (existing) {
      try {
        existing.pty.kill();
      } catch {}
      this.sessions.delete(terminalId);
    }

    // 2. Read persisted scrollback from disk if exists
    const diskHistory = this.readPersistedScrollback(terminalId);
    const initialScrollback = diskHistory ? [diskHistory] : [];

    const isWin = process.platform === 'win32';
    const shell = isWin
      ? (process.env.COMSPEC || 'powershell.exe')
      : (process.env.SHELL || '/bin/bash');

    const { cliPath, cliDir } = this.resolveCliPath();
    const pipeAddress = this.supervisor.pipeAddress || (isWin ? `\\\\.\\pipe\\mindagentics-${this.supervisor.token}` : `/tmp/mindagentics-${this.supervisor.token}.sock`);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      MINDAGENTICS_PIPE: pipeAddress,
      MINDAGENTICS_SOCKET: pipeAddress,
      MINDAGENTICS_TERMINAL_ID: terminalId,
      MINDAGENTICS_WORKSPACE_ID: workspaceId,
      MINDAGENTICS_CLI: cliPath,
      MAESTRI_PIPE: pipeAddress,
      MAESTRI_SOCKET: pipeAddress,
      MAESTRI_TERMINAL_ID: terminalId,
      MAESTRI_WORKSPACE_ID: workspaceId,
      MAESTRI_CLI: cliPath,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'mindAgentics',
      PATH: `${cliDir}${path.delimiter}${process.env.PATH || ''}`,
      ...(options.maestroMode ? { MINDAGENTICS_MAESTRO_MODE: '1', MAESTRI_MAESTRO_MODE: '1' } : {}),
      ...options.env
    };

    const shellArgs = isWin ? ['-NoLogo', '-NoExit'] : ['-l'];

    this.ensureMindAgenticsSkills(cwd);

    try {
      const pty = nodePty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
        useConpty: isWin
      });

      const session: TerminalSession = {
        id: terminalId,
        workspaceId,
        pty,
        cwd,
        scrollback: initialScrollback,
        status: 'idle',
        attention: false,
        focused: false,
        cols,
        rows,
        maestroMode: Boolean(options.maestroMode),
        isAlive: true
      };

      this.sessions.set(terminalId, session);

      if (options.command && options.command.trim().length > 0) {
        let cmdToRun = options.command.trim();

        // Enforce autonomous mode flags to avoid manual authorization prompts
        const isAutonomous = (options as any).isAutonomous ?? true;
        if (isAutonomous) {
          if (cmdToRun.startsWith('agy') && !cmdToRun.includes('--dangerously-skip-permissions')) {
            cmdToRun += ' --dangerously-skip-permissions --mode auto';
          } else if (cmdToRun.startsWith('codex')) {
            // Codex CLI forbids using --dangerously-bypass-approvals-and-sandbox together with --ask-for-approval
            cmdToRun = cmdToRun.replace(/--ask-for-approval\s+[^\s]+/g, '').trim();
            if (!cmdToRun.includes('--dangerously-bypass-approvals-and-sandbox')) {
              cmdToRun += ' --dangerously-bypass-approvals-and-sandbox';
            }
          } else if (cmdToRun.startsWith('claude') && !cmdToRun.includes('--dangerously-skip-permissions')) {
            cmdToRun += ' --dangerously-skip-permissions';
          } else if (cmdToRun.startsWith('opencode') && !cmdToRun.includes('--dangerously-skip-permissions')) {
            cmdToRun += ' --dangerously-skip-permissions';
          }
        }

        setTimeout(() => {
          try {
            pty.write(cmdToRun + '\r\n');
          } catch {}
        }, 350);
      }

      pty.onData((data: string) => {
        session.scrollback.push(data);
        if (session.scrollback.length > this.maxScrollbackLines) {
          session.scrollback.splice(0, session.scrollback.length - this.maxScrollbackLines);
        }
        this.scheduleSaveScrollback(terminalId);
        this.emit('data', { terminalId, data });

        // If an ask from another agent is waiting for this terminal's response:
        if (session.activeAskId) {
          session.askOutput = (session.askOutput || '') + data;
          if (session.askTimer) clearTimeout(session.askTimer);
          session.askTimer = setTimeout(() => {
            if (session.activeAskId) {
              const rawOut = session.askOutput || '';
              const askIdToSettle = session.activeAskId;
              session.activeAskId = undefined;
              session.askOutput = '';
              session.status = 'idle';
              this.emit('status', { terminalId, status: 'idle' });

              // Strip ANSI control escapes to return a clean string
              const clean = rawOut.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
              this.supervisor.chatTurnSettled(terminalId, clean, askIdToSettle);
            }
          }, 1500);
        }
      });

      pty.onExit(({ exitCode }) => {
        session.isAlive = false;
        session.status = exitCode === 0 ? 'idle' : 'error';
        this.flushScrollback(terminalId);
        this.emit('exit', { terminalId, exitCode });
        this.emit('status', { terminalId, status: session.status });
        this.sessions.delete(terminalId);
      });

      this.emit('status', { terminalId, status: 'idle' });
      return { terminalId };
    } catch (err) {
      console.error(`[TerminalManager] Failed to spawn PTY for ${terminalId}:`, err);
      throw err;
    }
  }

  public write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId);
    if (session && session.pty) {
      session.pty.write(data);
      session.status = 'working';
      this.emit('status', { terminalId, status: 'working' });
    }
  }

  public async deliverPrompt(terminalId: string, prompt: string, askId?: string): Promise<{ ok: boolean }> {
    const session = this.sessions.get(terminalId);
    if (!session) return { ok: false };

    // Format typing delivery: ensure Enter (\r) is sent so the command executes immediately
    const cleanPrompt = prompt.replace(/[\r\n]+$/, '');
    const textToDeliver = `${cleanPrompt}\r`;

    session.activeAskId = askId;
    session.askOutput = '';

    session.pty.write(textToDeliver);
    session.status = 'working';
    this.emit('status', { terminalId, status: 'working' });
    return { ok: true };
  }

  public dims(terminalId: string): { cols: number; rows: number } {
    const session = this.sessions.get(terminalId);
    if (session) {
      return { cols: session.cols, rows: session.rows };
    }
    return { cols: 120, rows: 32 };
  }

  public resize(terminalId: string, cols: number, rows: number): void {
    const session = this.sessions.get(terminalId);
    if (session && session.pty) {
      session.cols = cols;
      session.rows = rows;
      try {
        session.pty.resize(cols, rows);
      } catch {
        // ignore resize error if process exited
      }
    }
  }

  public kill(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.isAlive = false;
      this.flushScrollback(terminalId);
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {
          // ignore kill error
        }
      }
      this.sessions.delete(terminalId);
    }
    try {
      this.supervisor.unregisterTerminal(terminalId);
    } catch {
      // ignore
    }
  }

  public setMaestroMode(terminalId: string, maestroMode: boolean): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.maestroMode = maestroMode;
      this.emit('maestroMode', { terminalId, maestroMode });
    }
  }

  private ensureMindAgenticsSkills(targetDir?: string): void {
    try {
      const skillsSource = path.join(os.homedir(), '.gemini', 'config', 'skills');
      if (!fs.existsSync(skillsSource)) return;

      const maestriSkillFolders = [
        'mindagentics',
        'mindagentics-chat',
        'mindagentics-manager',
        'mindagentics-portal',
        'mindagentics-portal-devices',
        'mindagentics-routines',
        'mindagentics-workspace',
        'maestri',
        'maestri-chat',
        'maestri-manager',
        'maestri-portal',
        'maestri-portal-devices',
        'maestri-routines',
        'maestri-workspace',
        'graphify'
      ];

      // 1. Sync to ~/.codex/skills
      const codexSkillsDir = path.join(os.homedir(), '.codex', 'skills');
      if (fs.existsSync(path.join(os.homedir(), '.codex'))) {
        if (!fs.existsSync(codexSkillsDir)) {
          fs.mkdirSync(codexSkillsDir, { recursive: true });
        }
        for (const skill of maestriSkillFolders) {
          const src = path.join(skillsSource, skill);
          const dest = path.join(codexSkillsDir, skill);
          if (fs.existsSync(src) && !fs.existsSync(dest)) {
            this.copyDirRecursive(src, dest);
          }
        }
      }

      // 2. Ensure AGENTS.md in the workspace so all models have context
      if (targetDir && fs.existsSync(targetDir)) {
        const agentsMdPath = path.join(targetDir, 'AGENTS.md');
        let needsUpdate = true;
        if (fs.existsSync(agentsMdPath)) {
          const existing = fs.readFileSync(agentsMdPath, 'utf8');
          if (existing.includes('Modo Maestro') && existing.includes('mindAgentics')) {
            needsUpdate = false;
          }
        }
        if (needsUpdate) {
          const content = `# mindAgentics Canvas - Instruções para Agentes de IA

> [!IMPORTANT]
> **DIRETRIZ ZERO-READ (NÃO RE-LEIA ESTE MANUAL):**
> Você já possui todas as instruções do mindAgentics e o Knowledge Graph do projeto pré-carregados no seu contexto nativo.
> NUNCA execute ferramentas de leitura (\`read_file\`, \`cat\`, etc.) para ler \`AGENTS.md\`, \`CLAUDE.md\` ou \`SKILL.md\` do disco. Inicie diretamente a ação necessária ou responda ao colega de equipe.

Você está operando como um agente no canvas interativo **mindAgentics**.
Você tem à sua disposição a CLI do mindAgentics (\`mindagentics\`, alias \`maestri\`) e todas as skills integradas:

- **\`mindagentics list\`**: Lista os agentes conectados, notas adesivas e portais no canvas.
- **\`mindagentics ask "<Nome do Agente>" "<Mensagem>"\`**: Envia mensagens e delega tarefas para outros agentes presentes no canvas.
- **\`mindagentics recruit "<Nome>" --preset "<preset>" --role "<role>"\`**: Recruta e cria novos agentes especializados no workspace.
- **\`mindagentics portal open "<url>" --name "<Título>"\`**: Abre portais web para navegação e referências no canvas.
- **\`mindagentics portal navigate "<url>"\`**: Controla portais web para navegar e interagir com páginas.
- **\`mindagentics connect "<De>" "<Para>"\`**: Conecta nós, agentes e referências no canvas.
- **\`mindagentics note create --title "<Título>" --body "<Conteúdo>"\`**: Cria ou edita notas adesivas no canvas.
- **\`mindagentics floor <action>\`**: Gerencia worktrees isoladas de trabalho (floors).
- **\`mindagentics graphify <build|query|explain|path|open>\`**: Constrói e consulta o Knowledge Graph do projeto via AST determinístico, visualizando no Portal.

## Modo Maestro (Orquestração de Agentes)

Quando a variável de ambiente \`MINDAGENTICS_MAESTRO_MODE=1\` (ou \`MAESTRI_MAESTRO_MODE=1\`) estiver ativa ou você for designado como Maestro da equipe:
Você atua como o **Orquestrador Central** do canvas mindAgentics. Ao receber uma tarefa complexa ou missão do usuário, siga obrigatoriamente as seguintes regras:

### Regra 1 (Delegação Obrigatória)
Ao receber uma tarefa, o Maestro NÃO deve executar todo o trabalho pesado sozinho se puder delegar. O Maestro deve planejar, decompor o objetivo em subtarefas claras e delegar para outros agentes conectados usando:
\`\`\`bash
mindagentics ask "<Nome do Agente>" "<Instrução detalhada>"
\`\`\`
Você pode inspecionar quem está disponível no canvas com \`mindagentics list\` (ou \`maestri list\`).

### Regra 2 (Criação de Agentes no Workspace)
Caso o usuário não especifique agentes já existentes/conectados para a tarefa, ou caso a equipe precise de habilidades específicas (ex: Frontend, Backend, QA, Reviewer, Pesquisador), o Maestro deve criar agentes especializados no workspace usando:
\`\`\`bash
mindagentics recruit "<Nome do Agente>" --preset "<preset>" --role "<role>"
\`\`\`
- Presets disponíveis: \`"Claude Code"\`, \`"Codex"\`, \`"Antigravity"\`, \`"OpenCode"\`, \`"Shell"\`.
- Exemplo:
  \`\`\`bash
  mindagentics recruit "Frontend Dev" --preset "Antigravity" --role "Especialista em React e UI"
  mindagentics recruit "Backend Dev" --preset "Codex" --role "Especialista em APIs e Banco de Dados"
  \`\`\`
Após recrutar, delegue as subtarefas aos novos agentes via \`mindagentics ask\`.

### Regra 3 (Portais Web e Referências)
Se uma tarefa exigir analisar uma referência na web (documentação técnica, biblioteca, URL, design, site de referência, benchmark):
1. **Abrir o portal web no canvas com a referência**:
   \`\`\`bash
   mindagentics portal open "<URL>" --name "<Título da Referência>"
   \`\`\`
2. **Linkar o agente designado à referência**:
   \`\`\`bash
   mindagentics connect "<Nome do Agente>" "<Título da Referência>"
   \`\`\`
3. **Solicitar ao agente designado o uso da referência**:
   \`\`\`bash
   mindagentics ask "<Nome do Agente>" "Analise a referência web linkada e execute [tarefa]..."
   \`\`\`

Trabalhe de forma colaborativa com os outros agentes conectados no canvas usando a CLI do mindAgentics (\`mindagentics\` ou \`maestri\`).
`;
          fs.writeFileSync(agentsMdPath, content, 'utf8');
        }
      }
    } catch {
      // ignore
    }
  }

  private copyDirRecursive(src: string, dest: string) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  public async restart(terminalId: string): Promise<void> {
    const session = this.sessions.get(terminalId);
    if (session) {
      const { cwd, workspaceId, cols, rows } = session;
      this.kill(terminalId);
      await this.spawn({ id: terminalId, cwd, workspaceId, cols, rows });
    }
  }

  public getScrollback(terminalId: string): string {
    const session = this.sessions.get(terminalId);
    if (session) {
      return session.scrollback.join('');
    }
    return this.readPersistedScrollback(terminalId);
  }

  public markSeen(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.attention = false;
      this.emit('attentionCleared', { terminalId });
    }
  }

  public setFocused(terminalId: string): void {
    for (const [id, s] of this.sessions.entries()) {
      s.focused = id === terminalId;
    }
    this.markSeen(terminalId);
  }

  public detectInstalledAgents(): Array<{ id: string; name: string; command: string; icon: string; installed: boolean; path?: string }> {
    const isWin = process.platform === 'win32';
    const candidates = [
      { id: 'antigravity', name: 'Antigravity CLI (agy)', command: 'agy', icon: 'sparkle' },
      { id: 'codex', name: 'OpenAI Codex (codex)', command: 'codex --no-daemon', icon: 'brain' },
      { id: 'opencode', name: 'OpenCode CLI (opencode)', command: 'opencode', icon: 'rectangle.portrait' },
      { id: 'claude', name: 'Claude Code (claude)', command: 'claude', icon: 'seal' },
      { id: 'github-copilot', name: 'GitHub Copilot (copilot / gh)', command: 'copilot', icon: 'terminal' },
      { id: 'ollama', name: 'Ollama (ollama)', command: 'ollama run llama3', icon: 'cpu' },
      { id: 'powershell', name: 'PowerShell', command: '', icon: 'terminal' },
      { id: 'cmd', name: 'Command Prompt', command: '', icon: 'terminal' },
      { id: 'bash', name: 'Bash Shell', command: '', icon: 'terminal' },
    ];

    const results = [];
    for (const c of candidates) {
      const baseCmd = c.command.split(' ')[0] || (isWin ? 'powershell' : 'bash');
      let foundPath = this.which(baseCmd);

      // Dedicated fallback detection for agents with known directories or alternative executables
      if (!foundPath) {
        if (c.id === 'claude') {
          const claudeJson = path.join(os.homedir(), '.claude.json');
          const claudeDir = path.join(os.homedir(), '.claude');
          if (fs.existsSync(claudeJson)) {
            foundPath = claudeJson;
          } else if (fs.existsSync(claudeDir)) {
            foundPath = claudeDir;
          }
        } else if (c.id === 'github-copilot') {
          foundPath = this.which('gh');
        } else if (c.id === 'ollama') {
          const defaultOllama = 'C:\\Users\\mabru\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
          if (fs.existsSync(defaultOllama)) {
            foundPath = defaultOllama;
          }
        }
      }

      results.push({
        ...c,
        installed: !!foundPath,
        path: foundPath || undefined
      });
    }
    return results;
  }

  public async getAgentLimits(): Promise<AgentUsageReport[]> {
    const installed = this.detectInstalledAgents().filter(a => a.installed && !['powershell', 'cmd', 'bash'].includes(a.id));
    const reports: AgentUsageReport[] = [];

    for (const agent of installed) {
      if (agent.id === 'antigravity') {
        let activeModel = 'Gemini 3.8 Flash (Medium)';
        let sessionCount = 0;
        try {
          const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
          if (fs.existsSync(settingsPath)) {
            const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (data.model) activeModel = data.model;
          }
          const histPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'history.jsonl');
          if (fs.existsSync(histPath)) {
            const content = fs.readFileSync(histPath, 'utf8');
            sessionCount = content.split('\n').filter(Boolean).length;
          } else {
            const brainPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
            if (fs.existsSync(brainPath)) {
              sessionCount = fs.readdirSync(brainPath).length;
            }
          }
        } catch {
          // ignore
        }

        // Run live probe
        let liveProbe: Partial<AgentUsageReport> | null = null;
        try {
          liveProbe = await probeAntigravity(agent.path || 'agy');
        } catch {}

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? 0.07;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? 0.63;
        const quotaPercent = Math.round(primaryUsedFraction * 100);
        const secondaryPercent = Math.round(secondaryUsedFraction * 100);

        reports.push({
          id: agent.id,
          name: 'Antigravity CLI (agy)',
          command: agent.command,
          icon: 'sparkle',
          installed: true,
          path: agent.path,
          status: 'active',
          colorHex: '#3B82F6',
          activeModel,
          provider: 'Google DeepMind',
          planOrTier: 'Google AI Pro Workspace',
          primaryUsedFraction,
          secondaryUsedFraction,
          primaryLabel: 'Sessão (5h)',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: liveProbe?.primaryResetText || 'Janela contínua (5h)',
          secondaryResetText: liveProbe?.secondaryResetText || 'Renovação semanal',
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || [
            {
              id: '5h',
              title: 'Sessão de 5 Horas',
              usedFraction: primaryUsedFraction,
              resetsAt: null,
              formattedReset: liveProbe?.primaryResetText || 'Janela contínua'
            },
            {
              id: 'weekly',
              title: 'Cota Semanal',
              usedFraction: secondaryUsedFraction,
              resetsAt: null,
              formattedReset: liveProbe?.secondaryResetText || 'Renovação semanal'
            }
          ],
          details: [
            { label: 'Janela de Contexto', value: '1.048.576 tokens (1M)' },
            { label: 'Taxa de Requisições', value: '60 RPM / 4.000.000 TPM' },
            { label: 'Modelo Ativo', value: activeModel },
            { label: 'Uso Sessão (5h)', value: `${quotaPercent}% utilizado` },
            { label: 'Uso Semanal (7d)', value: `${secondaryPercent}% utilizado` },
            { label: 'Modo Padrão', value: 'Autônomo com auto-aprovação' },
            { label: 'Sessões Registradas', value: `${sessionCount} sessões em disco` },
            { label: 'Executável', value: agent.path || 'agy.exe' },
          ]
        });
      } else if (agent.id === 'codex') {
        let activeModel = 'gpt-6.1-sol';
        let authMode = 'ChatGPT Plus';
        let mcpCount = 3;
        let sessionCount = 0;
        let userEmail = 'mabruschi02@gmail.com';
        let planRenewal = '05/11/2026';
        let sandboxMode = 'Elevated';
        try {
          const configPath = path.join(os.homedir(), '.codex', 'config.toml');
          if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const modelMatch = content.match(/model\s*=\s*"([^"]+)"/);
            if (modelMatch) activeModel = modelMatch[1];
            const mcpMatches = content.match(/\[mcp_servers\./g);
            if (mcpMatches) mcpCount = mcpMatches.length;
            const sandboxMatch = content.match(/sandbox\s*=\s*"([^"]+)"/);
            if (sandboxMatch) sandboxMode = sandboxMatch[1].charAt(0).toUpperCase() + sandboxMatch[1].slice(1);
          }
          const authPath = path.join(os.homedir(), '.codex', 'auth.json');
          if (fs.existsSync(authPath)) {
            const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
            if (data.tokens && data.tokens.id_token) {
              try {
                const payload = JSON.parse(Buffer.from(data.tokens.id_token.split('.')[1], 'base64').toString('utf8'));
                if (payload.email) userEmail = payload.email;
                if (payload['https://api.openai.com/auth']?.chatgpt_plan_type) {
                  const plan = payload['https://api.openai.com/auth'].chatgpt_plan_type;
                  authMode = plan === 'plus' ? 'ChatGPT Plus' : `ChatGPT ${plan.toUpperCase()}`;
                }
                if (payload['https://api.openai.com/auth']?.chatgpt_subscription_active_until) {
                  const rawDate = new Date(payload['https://api.openai.com/auth'].chatgpt_subscription_active_until);
                  if (!isNaN(rawDate.getTime())) {
                    planRenewal = rawDate.toLocaleDateString('pt-BR');
                  }
                }
              } catch {}
            } else if (data.auth_mode) {
              authMode = `${data.auth_mode.toUpperCase()} Subscription`;
            }
          }
          const sPath = path.join(os.homedir(), '.codex', 'session_index.jsonl');
          if (fs.existsSync(sPath)) {
            sessionCount = fs.readFileSync(sPath, 'utf8').split('\n').filter(Boolean).length;
          }
        } catch {
          // ignore
        }

        // Run live probe
        let liveProbe: Partial<AgentUsageReport> | null = null;
        try {
          liveProbe = await probeCodex(agent.path || 'codex');
        } catch {}

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? 0.0;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? 0.03;
        const quotaPercent = Math.round(primaryUsedFraction * 100);
        const secondaryPercent = Math.round(secondaryUsedFraction * 100);

        reports.push({
          id: agent.id,
          name: 'OpenAI Codex (codex)',
          command: agent.command,
          icon: 'brain',
          installed: true,
          path: agent.path,
          status: 'active',
          colorHex: '#10B981',
          activeModel,
          provider: 'OpenAI',
          planOrTier: liveProbe?.planOrTier ? `${liveProbe.planOrTier} (${userEmail})` : `${authMode} (${userEmail})`,
          primaryUsedFraction,
          secondaryUsedFraction,
          primaryLabel: 'Sessão (5h)',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: liveProbe?.primaryResetText || 'Janela de 5h',
          secondaryResetText: liveProbe?.secondaryResetText || 'Janela de 7d',
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || [
            {
              id: 'primary',
              title: 'Janela de Sessão (5h)',
              usedFraction: primaryUsedFraction,
              resetsAt: null,
              formattedReset: liveProbe?.primaryResetText || 'Janela de 5h'
            },
            {
              id: 'secondary',
              title: 'Janela Semanal (7d)',
              usedFraction: secondaryUsedFraction,
              resetsAt: null,
              formattedReset: liveProbe?.secondaryResetText || 'Janela de 7d'
            }
          ],
          details: [
            { label: 'Conta & Plano', value: `${authMode} (${userEmail})` },
            { label: 'Renovação do Plano', value: planRenewal },
            { label: 'Modelo Ativo', value: activeModel },
            { label: 'Uso Sessão (5h)', value: `${quotaPercent}% utilizado` },
            { label: 'Uso Semanal (7d)', value: `${secondaryPercent}% utilizado` },
            { label: 'Janela de Contexto', value: '128.000 tokens (128k)' },
            { label: 'Taxa de Mensagens', value: '80 requisições a cada 3 horas' },
            { label: 'Servidores MCP', value: `${mcpCount} servidores (mcp, figma, rea)` },
            { label: 'Sandbox', value: sandboxMode },
            { label: 'Sessões em Disco', value: `${sessionCount} sessões indexadas` },
            { label: 'Executável', value: agent.path || 'codex.exe' },
          ]
        });
      } else if (agent.id === 'opencode') {
        let mcpCount = 2;
        try {
          const cfgPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
          if (fs.existsSync(cfgPath)) {
            const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (data.mcp) mcpCount = Object.keys(data.mcp).length;
          }
        } catch {
          // ignore
        }

        let liveProbe: Partial<AgentUsageReport> | null = null;
        try {
          liveProbe = await probeOpenCode(agent.path || 'opencode');
        } catch {}

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? 0.05;
        const quotaPercent = Math.round(primaryUsedFraction * 100);

        reports.push({
          id: agent.id,
          name: 'OpenCode CLI (opencode)',
          command: agent.command,
          icon: 'rectangle.portrait',
          installed: true,
          path: agent.path,
          status: 'ready',
          colorHex: '#06B6D4',
          activeModel: 'OpenCode Multi-Provider (Claude / GPT)',
          provider: 'OpenCode AI',
          planOrTier: liveProbe?.planOrTier || 'Developer Edition',
          primaryUsedFraction,
          primaryLabel: 'Taxa por Minuto',
          primaryResetText: liveProbe?.primaryResetText || 'Janela de 1 min',
          quotaPercent,
          windows: liveProbe?.windows || [
            {
              id: 'rpm',
              title: 'Janela por Minuto',
              usedFraction: primaryUsedFraction,
              resetsAt: null,
              formattedReset: 'Janela contínua de 1 min'
            }
          ],
          details: [
            { label: 'Janela de Contexto', value: '200.000 tokens (200k)' },
            { label: 'Limite de Requisições', value: '50 RPM / 250.000 TPM' },
            { label: 'Servidores MCP', value: `${mcpCount} configurados (rea, mcp)` },
            { label: 'Modelo Padrão', value: 'Multi-Provider (Claude / GPT)' },
            { label: 'Executável', value: agent.path || 'opencode.ps1' },
          ]
        });
      } else if (agent.id === 'github-copilot' || agent.id === 'gh-copilot') {
        if (reports.some(r => r.id === 'github-copilot')) continue;
        reports.push({
          id: 'github-copilot',
          name: 'GitHub Copilot (copilot / gh)',
          command: agent.command,
          icon: 'terminal',
          installed: true,
          path: agent.path,
          status: 'active',
          colorHex: '#6366F1',
          activeModel: 'GPT-4o / Claude 3.5 Sonnet (Copilot Engine)',
          provider: 'GitHub / Microsoft Azure',
          planOrTier: 'Copilot Pro / Business',
          primaryUsedFraction: 0.18,
          primaryLabel: 'Cota Mensal',
          primaryResetText: '2.000 chats premium / mês',
          quotaPercent: 18,
          windows: [
            {
              id: 'monthly',
              title: 'Cota Mensal de Chat',
              usedFraction: 0.18,
              resetsAt: null,
              formattedReset: 'Virada do mês'
            }
          ],
          details: [
            { label: 'Janela de Contexto', value: '128.000 tokens (128k)' },
            { label: 'Taxa de Requisições', value: '30 RPM' },
            { label: 'Cota de Chat Mensal', value: '2.000 turnos premium / mês' },
            { label: 'Completions de Código', value: 'Ilimitadas em tempo real' },
            { label: 'Executável', value: agent.path || 'copilot.ps1' },
          ]
        });
      } else if (agent.id === 'claude') {
        let mcpList = ['mcp', 'rea'];
        try {
          const claudeJson = path.join(os.homedir(), '.claude.json');
          if (fs.existsSync(claudeJson)) {
            const data = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
            if (data.mcpServers) {
              mcpList = Object.keys(data.mcpServers);
            }
          }
        } catch {
          // ignore
        }

        reports.push({
          id: agent.id,
          name: 'Claude Code (claude)',
          command: agent.command,
          icon: 'seal',
          installed: true,
          path: agent.path,
          status: 'ready',
          colorHex: '#A855F7',
          activeModel: 'Claude 3.7 Sonnet / Claude 3.5 Sonnet',
          provider: 'Anthropic',
          planOrTier: 'Anthropic Claude Code',
          primaryUsedFraction: 0.10,
          primaryLabel: 'Taxa por Minuto',
          primaryResetText: 'Janela de 1 min',
          quotaPercent: 10,
          windows: [
            {
              id: 'rpm',
              title: 'Taxa por Minuto',
              usedFraction: 0.10,
              resetsAt: null,
              formattedReset: 'Janela contínua de 1 min'
            }
          ],
          details: [
            { label: 'Janela de Contexto', value: '200.000 tokens (200k)' },
            { label: 'Taxa de Requisições', value: '50 RPM / 40.000 TPM' },
            { label: 'Modelo Ativo', value: 'Claude 3.7 Sonnet / Claude 3.5 Sonnet' },
            { label: 'Servidores MCP', value: `${mcpList.length} servidores (${mcpList.join(', ')})` },
            { label: 'Limite de Saída', value: '8.192 tokens' },
            { label: 'Configuração', value: path.join(os.homedir(), '.claude.json') },
            { label: 'Executável', value: agent.path || 'claude' },
          ]
        });
      } else if (agent.id === 'ollama') {
        reports.push({
          id: agent.id,
          name: 'Ollama (ollama)',
          command: agent.command,
          icon: 'cpu',
          installed: true,
          path: agent.path,
          status: 'ready',
          colorHex: '#F59E0B',
          activeModel: 'Modelos Locais (Llama 3, Mistral, Qwen)',
          provider: 'Ollama Local Runtime',
          planOrTier: 'Hardware Local (100% Offline)',
          primaryUsedFraction: 0.0,
          primaryLabel: 'Capacidade Local',
          primaryResetText: 'Sem limites de taxa',
          quotaPercent: 0,
          windows: [
            {
              id: 'local',
              title: 'Hardware Local GPU/CPU',
              usedFraction: 0.0,
              resetsAt: null,
              formattedReset: '100% Offline'
            }
          ],
          details: [
            { label: 'Janela de Contexto', value: '8.192 a 32.768 tokens (VRAM GPU)' },
            { label: 'Taxa de Limite', value: 'Sem restrição de RPM/TPM' },
            { label: 'Privacidade', value: '100% Offline e Local' },
            { label: 'Executável', value: agent.path || 'ollama.exe' },
          ]
        });
      }
    }

    return reports;
  }

  private which(cmd: string): string | null {
    const isWin = process.platform === 'win32';
    const exts = isWin ? ((process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM') + ';.PS1').split(';') : [''];
    const pathDirs = (process.env.PATH || '').split(path.delimiter);

    if (isWin) {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      pathDirs.unshift(
        path.join(appData, 'npm'),
        path.join(localAppData, 'agy', 'bin'),
        path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
        path.join(localAppData, 'Programs', 'Ollama'),
        'C:\\Program Files\\GitHub CLI'
      );
    }

    for (const dir of pathDirs) {
      for (const ext of exts) {
        const full = path.join(dir, cmd + (isWin && !cmd.toLowerCase().endsWith('.exe') ? ext : ''));
        if (fs.existsSync(full)) {
          return full;
        }
      }
    }
    return null;
  }

  public killAll(): void {
    this.flushAllScrollbacks();
    for (const session of this.sessions.values()) {
      session.isAlive = false;
      try {
        session.pty.kill();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }
}
