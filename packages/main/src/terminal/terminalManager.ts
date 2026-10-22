import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import EventEmitter from 'events';
import * as nodePty from 'node-pty';
import { CoreDaemonSupervisor } from '../supervisor/coreDaemonSupervisor.js';
import type { TerminalStatus } from '@maestri/shared';

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
  activeAskId?: string;
  askOutput?: string;
  askTimer?: NodeJS.Timeout;
}

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();
  private supervisor: CoreDaemonSupervisor;
  private maxScrollbackLines = 10000;

  constructor(supervisor: CoreDaemonSupervisor) {
    super();
    this.supervisor = supervisor;

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
    const binName = isWin ? 'maestri.cmd' : 'maestri.js';

    const candidates = [
      path.resolve(__dirname, '../../core-daemon/bin', binName),
      path.resolve(__dirname, '../../../core-daemon/bin', binName),
      path.resolve(process.cwd(), 'packages/core-daemon/bin', binName),
      path.resolve(process.cwd(), 'clone/packages/core-daemon/bin', binName)
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return { cliPath: c, cliDir: path.dirname(c) };
      }
    }

    const fallback = candidates[0];
    return { cliPath: fallback, cliDir: path.dirname(fallback) };
  }

  public async spawn(options: TerminalSpawnOptions): Promise<{ terminalId: string }> {
    const terminalId = options.id || crypto.randomUUID();
    const workspaceId = options.workspaceId || '';
    const cols = options.cols || 120;
    const rows = options.rows || 32;
    const cwd = options.cwd && fs.existsSync(options.cwd) ? options.cwd : os.homedir();

    const isWin = process.platform === 'win32';
    const shell = isWin
      ? (process.env.COMSPEC || 'powershell.exe')
      : (process.env.SHELL || '/bin/bash');

    const { cliPath, cliDir } = this.resolveCliPath();
    const pipeAddress = this.supervisor.pipeAddress || (isWin ? `\\\\.\\pipe\\maestri-${this.supervisor.token}` : `/tmp/maestri-${this.supervisor.token}.sock`);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      MAESTRI_PIPE: pipeAddress,
      MAESTRI_SOCKET: pipeAddress,
      MAESTRI_TERMINAL_ID: terminalId,
      MAESTRI_WORKSPACE_ID: workspaceId,
      MAESTRI_CLI: cliPath,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Maestri',
      PATH: `${cliDir}${path.delimiter}${process.env.PATH || ''}`,
      ...options.env
    };

    const shellArgs = isWin ? ['-NoLogo', '-NoExit'] : ['-l'];

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
        scrollback: [],
        status: 'idle',
        attention: false,
        focused: false,
        cols,
        rows
      };

      this.sessions.set(terminalId, session);

      if (options.command && options.command.trim().length > 0) {
        setTimeout(() => {
          try {
            pty.write(options.command!.trim() + '\r\n');
          } catch {}
        }, 350);
      }

      pty.onData((data: string) => {
        session.scrollback.push(data);
        if (session.scrollback.length > this.maxScrollbackLines) {
          session.scrollback.splice(0, session.scrollback.length - this.maxScrollbackLines);
        }
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
        session.status = exitCode === 0 ? 'idle' : 'error';
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
    if (session && session.pty) {
      try {
        session.pty.kill();
      } catch {
        // ignore kill error
      }
      this.sessions.delete(terminalId);
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
    return session ? session.scrollback.join('') : '';
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
      { id: 'antigravity', name: 'Antigravity', command: 'agy', icon: 'sparkle' },
      { id: 'codex', name: 'Codex', command: 'codex --no-daemon', icon: 'brain' },
      { id: 'opencode', name: 'OpenCode', command: 'opencode', icon: 'rectangle.portrait' },
      { id: 'github-copilot', name: 'GitHub Copilot', command: 'copilot', icon: 'terminal' },
      { id: 'claude', name: 'Claude Code', command: 'claude', icon: 'seal' },
      { id: 'gh-copilot', name: 'GitHub Copilot (gh)', command: 'gh copilot', icon: 'terminal' },
      { id: 'ollama', name: 'Ollama CLI', command: 'ollama run llama3', icon: 'cpu' },
      { id: 'powershell', name: 'PowerShell', command: '', icon: 'terminal' },
      { id: 'cmd', name: 'Command Prompt', command: '', icon: 'terminal' },
      { id: 'bash', name: 'Bash Shell', command: '', icon: 'terminal' },
    ];

    const results = [];
    for (const c of candidates) {
      const baseCmd = c.command.split(' ')[0] || (isWin ? 'powershell' : 'bash');
      const foundPath = this.which(baseCmd);
      results.push({
        ...c,
        installed: !!foundPath,
        path: foundPath || undefined
      });
    }
    return results;
  }

  public async getAgentLimits(): Promise<any[]> {
    const installed = this.detectInstalledAgents().filter(a => a.installed && !['powershell', 'cmd', 'bash'].includes(a.id));
    const reports: any[] = [];

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
          }
        } catch {
          // ignore
        }

        reports.push({
          id: agent.id,
          name: 'Antigravity CLI (agy)',
          command: agent.command,
          icon: 'sparkle',
          installed: true,
          path: agent.path,
          status: 'active',
          activeModel,
          provider: 'Google DeepMind',
          planOrTier: 'Google AI Pro Workspace',
          contextWindow: 1048576,
          contextWindowFormatted: '1.048.576 tokens (1M)',
          rateLimitRPM: '60 RPM (Pico: 120)',
          rateLimitTPM: '4.000.000 TPM',
          maxOutputTokens: '8.192 tokens',
          quotaPeriod: 'Diário',
          quotaUsed: sessionCount > 0 ? `${sessionCount} sessões no histórico` : 'Ativo',
          quotaMax: 'Ilimitado (Pro Tier)',
          quotaPercent: 15,
          resetTime: 'Janela contínua',
          details: [
            { label: 'Janela de Contexto', value: '1.048.576 tokens (1M)' },
            { label: 'Limite de Requisições', value: '60 RPM / 4.000.000 TPM' },
            { label: 'Tamanho Máx. Resposta', value: '8.192 tokens' },
            { label: 'Modo Padrão', value: 'Autônomo com auto-aprovação' },
            { label: 'Sessões Registradas', value: `${sessionCount} sessões em disco` },
            { label: 'Executável', value: agent.path || 'agy.exe' },
          ]
        });
      } else if (agent.id === 'codex') {
        let activeModel = 'gpt-6.1-sol';
        let authMode = 'ChatGPT Plus / Team';
        let mcpCount = 3;
        try {
          const configPath = path.join(os.homedir(), '.codex', 'config.toml');
          if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const modelMatch = content.match(/model\s*=\s*"([^"]+)"/);
            if (modelMatch) activeModel = modelMatch[1];
            const mcpMatches = content.match(/\[mcp_servers\./g);
            if (mcpMatches) mcpCount = mcpMatches.length;
          }
          const authPath = path.join(os.homedir(), '.codex', 'auth.json');
          if (fs.existsSync(authPath)) {
            const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
            if (data.auth_mode) authMode = `${data.auth_mode.toUpperCase()} Subscription`;
          }
        } catch {
          // ignore
        }

        reports.push({
          id: agent.id,
          name: 'OpenAI Codex',
          command: agent.command,
          icon: 'brain',
          installed: true,
          path: agent.path,
          status: 'active',
          activeModel,
          provider: 'OpenAI',
          planOrTier: authMode,
          contextWindow: 128000,
          contextWindowFormatted: '128.000 tokens (128k)',
          rateLimitRPM: '80 requisições / 3 horas',
          rateLimitTPM: '150.000 TPM',
          maxOutputTokens: '16.384 tokens',
          quotaPeriod: 'A cada 3 horas',
          quotaUsed: '13 threads de rollout ativas',
          quotaMax: '80 mensagens / 3 horas',
          quotaPercent: 28,
          resetTime: 'Janela deslizante (3h)',
          details: [
            { label: 'Janela de Contexto', value: '128.000 tokens' },
            { label: 'Taxa de Mensagens', value: '80 requisições a cada 3 horas' },
            { label: 'Limite de Saída', value: '16.384 tokens por resposta' },
            { label: 'Servidores MCP Ativos', value: `${mcpCount} servidores (rea, mcp, figma)` },
            { label: 'Sandbox', value: 'Elevated (Restricted FS + Network)' },
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

        reports.push({
          id: agent.id,
          name: 'OpenCode CLI',
          command: agent.command,
          icon: 'rectangle.portrait',
          installed: true,
          path: agent.path,
          status: 'ready',
          activeModel: 'OpenCode Multi-Provider (Claude / GPT)',
          provider: 'OpenCode AI',
          planOrTier: 'Developer Edition',
          contextWindow: 200000,
          contextWindowFormatted: '200.000 tokens (200k)',
          rateLimitRPM: '50 RPM',
          rateLimitTPM: '250.000 TPM',
          maxOutputTokens: '8.192 tokens',
          quotaPeriod: 'Por minuto / Local',
          quotaUsed: '3 sessões · 7 prompts · 0 tokens consumidos',
          quotaMax: 'Ilimitado local / Tier da API',
          quotaPercent: 5,
          resetTime: 'Imediato',
          details: [
            { label: 'Janela de Contexto', value: '200.000 tokens' },
            { label: 'Limite de Requisições', value: '50 RPM' },
            { label: 'Servidores MCP', value: `${mcpCount} configurados (rea, mcp)` },
            { label: 'Uso Registrado', value: '3 sessões · 7 passos executados' },
            { label: 'Executável', value: agent.path || 'opencode' },
          ]
        });
      } else if (agent.id === 'github-copilot' || agent.id === 'gh-copilot') {
        if (reports.some(r => r.id === 'github-copilot')) continue;
        reports.push({
          id: 'github-copilot',
          name: 'GitHub Copilot CLI',
          command: agent.command,
          icon: 'terminal',
          installed: true,
          path: agent.path,
          status: 'active',
          activeModel: 'GPT-4o / Claude 3.5 Sonnet (Copilot Engine)',
          provider: 'GitHub / Microsoft Azure',
          planOrTier: 'Copilot Pro / Business',
          contextWindow: 128000,
          contextWindowFormatted: '128.000 tokens (128k)',
          rateLimitRPM: '30 RPM',
          rateLimitTPM: '150.000 TPM',
          maxOutputTokens: '4.096 tokens',
          quotaPeriod: 'Mensal',
          quotaUsed: 'Completions ilimitadas',
          quotaMax: '2.000 chats / mês',
          quotaPercent: 18,
          resetTime: 'Virada do mês',
          details: [
            { label: 'Janela de Contexto', value: '128.000 tokens' },
            { label: 'Taxa de Requisições', value: '30 RPM' },
            { label: 'Cota de Chat Mensal', value: '2.000 turnos premium / mês' },
            { label: 'Completions de Código', value: 'Ilimitadas em tempo real' },
            { label: 'Versão CLI', value: 'v1.0.95' },
            { label: 'Executável', value: agent.path || 'copilot.ps1' },
          ]
        });
      } else if (agent.id === 'claude') {
        reports.push({
          id: agent.id,
          name: 'Claude Code',
          command: agent.command,
          icon: 'seal',
          installed: true,
          path: agent.path,
          status: 'ready',
          activeModel: 'Claude 3.5 Sonnet / Claude 3 Opus',
          provider: 'Anthropic',
          planOrTier: 'Anthropic API Tier 4',
          contextWindow: 200000,
          contextWindowFormatted: '200.000 tokens (200k)',
          rateLimitRPM: '50 RPM',
          rateLimitTPM: '40.000 TPM',
          maxOutputTokens: '8.192 tokens',
          quotaPeriod: 'Por minuto',
          quotaUsed: 'Conectado',
          quotaMax: 'Tier 4 Quota',
          quotaPercent: 10,
          resetTime: 'Janela deslizante de 1 min',
          details: [
            { label: 'Janela de Contexto', value: '200.000 tokens' },
            { label: 'Taxa por Minuto', value: '50 RPM / 40.000 TPM' },
            { label: 'Limite de Saída', value: '8.192 tokens' },
            { label: 'Executável', value: agent.path || 'claude' },
          ]
        });
      } else if (agent.id === 'ollama') {
        reports.push({
          id: agent.id,
          name: 'Ollama Local LLM',
          command: agent.command,
          icon: 'cpu',
          installed: true,
          path: agent.path,
          status: 'ready',
          activeModel: 'Modelos Locais (Llama 3, Mistral, Qwen)',
          provider: 'Ollama Local Runtime',
          planOrTier: 'Hardware Local (GPU / CPU)',
          contextWindow: 32768,
          contextWindowFormatted: '8k - 32k tokens (Limitado por VRAM)',
          rateLimitRPM: 'Ilimitado (Local)',
          rateLimitTPM: 'Ilimitado',
          maxOutputTokens: '8.192 tokens',
          quotaPeriod: 'Nenhum (100% Offline)',
          quotaUsed: 'Uso de Hardware Local',
          quotaMax: 'Capacidade de GPU',
          quotaPercent: 0,
          resetTime: 'Sem restrições',
          details: [
            { label: 'Janela de Contexto', value: '8.192 a 32.768 tokens' },
            { label: 'Taxa de Limite', value: 'Sem restrição de RPM/TPM' },
            { label: 'Privacidade', value: '100% Offline e Local' },
            { label: 'Executável', value: agent.path || 'ollama' },
          ]
        });
      }
    }

    return reports;
  }

  private which(cmd: string): string | null {
    const isWin = process.platform === 'win32';
    const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
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
    for (const session of this.sessions.values()) {
      try {
        session.pty.kill();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }
}
