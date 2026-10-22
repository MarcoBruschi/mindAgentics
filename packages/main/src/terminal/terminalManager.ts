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
