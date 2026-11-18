import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import EventEmitter from 'events';
import { fileURLToPath } from 'url';
import * as nodePty from 'node-pty';
import type { DataService } from '../storage/dataService.js';
import type { TerminalStatus } from '@mindagentics/shared';
import {
  MAX_TERMINAL_OUTPUT_LINES,
  sanitizeLabel,
  sanitizeMarkdownInline,
  sanitizeMarkdownBlock,
  sanitizeForPtyLine,
  quotePowerShell,
  quotePosix,
  redactSecrets,
  hasControlChars,
} from '@mindagentics/shared';
import {
  probeAntigravity,
  probeCodex,
  probeOpenCode,
  probeClaude,
  probeCopilot,
  formatResetCountdown,
  buildUsageWindows,
  type AgentUsageReport,
  type AgentModelOption,
  FALLBACK_AGENT_MODELS,
  queryAntigravityModels,
  queryOllamaModels,
} from './agentProbes.js';
import { MemoryService, memorySummaryRelPath } from '../memory/memoryService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CoreDaemonSupervisor {
  token?: string;
  daemonReady?: boolean;
  pipeAddress?: string;
  on(event: string, listener: (...args: any[]) => void): any;
  syncCanvas?(payload: any): void;
  unregisterTerminal?(terminalId: string): void;
  chatTurnSettled?(terminalId: string, output: string, askId?: string): void;
}

export interface AgentRefInfo {
  path: string;
  isDirectory: boolean;
  label?: string;
}

/** Hard budget for the initial prompt injected on spawn (~chars/4 tokens). */
const MAX_BRIEFING_TOKENS = 580;
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const ALLOWED_COMMAND_BINARIES = new Set([
  'agy',
  'claude',
  'codex',
  'opencode',
  'copilot',
  'ollama',
  'node',
  'powershell',
  'powershell.exe',
  'cmd',
  'cmd.exe',
  'bash',
  'bash.exe',
]);

const DANGEROUS_SHELL_CHARS_RE = /[;&|`]|(?:\$\()|(?:\$\{)|[\x00\r\n]/;
const TEMP_PATH_RE = /(?:[\\/]tmp(?:[\\/]|$))|(?:[\\/]temp(?:[\\/]|$))|(?:appdata[\\/]local[\\/]temp)|(?:%temp%)|(?:%tmp%)|(?:\$tmp)|(?:\$temp)/i;

export const VALID_MODEL_ID_REGEX = /^[A-Za-z0-9._:/-]{1,80}$/;

export function validateModelIdentifier(modelId: unknown): void {
  if (typeof modelId !== 'string') {
    throw new Error('Comando inválido: identificador de modelo deve ser uma string');
  }
  const trimmed = modelId.trim();
  if (!trimmed || !VALID_MODEL_ID_REGEX.test(trimmed)) {
    throw new Error(`Comando inválido: identificador de modelo "${modelId}" inválido`);
  }
}

export function validateReconfigureCommand(command: unknown): void {
  if (typeof command !== 'string') {
    throw new Error('Comando inválido: o comando deve ser uma string');
  }

  // Check for control characters (NUL, ESC, CR, LF, etc.)
  if (hasControlChars(command) || command.includes('\0') || command.includes('\r') || command.includes('\n')) {
    throw new Error('Comando inválido: contém caracteres de controle proibidos');
  }

  // Validate model flag arguments if present in command: --model <modelId>, -m <modelId>, --model=<modelId>, -m=<modelId>
  const modelFlagRegex = /(?:^|\s)(?:--model|-m)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let modelMatch: RegExpExecArray | null;
  while ((modelMatch = modelFlagRegex.exec(command)) !== null) {
    const rawModel = modelMatch[1] ?? modelMatch[2] ?? modelMatch[3] ?? '';
    validateModelIdentifier(rawModel);
  }

  // Ensure trailing model flags without argument are rejected
  if (/(?:^|\s)(?:--model|-m)\s*$/.test(command)) {
    throw new Error('Comando inválido: identificador de modelo ausente');
  }

  // Check for dangerous shell chaining or substitution: ;, &&, |, `, $(), ${}
  if (DANGEROUS_SHELL_CHARS_RE.test(command)) {
    throw new Error('Comando inválido: encadeamento de shell ou substituição proibida');
  }

  // Check for temp folders (%TEMP%, AppData/Local/Temp, /tmp, etc.)
  if (TEMP_PATH_RE.test(command)) {
    throw new Error('Comando inválido: caminhos apontando para diretórios temporários são proibidos');
  }

  const osTemp = os.tmpdir();
  if (osTemp && command.toLowerCase().includes(osTemp.toLowerCase())) {
    throw new Error('Comando inválido: caminhos apontando para diretórios temporários são proibidos');
  }

  const trimmed = command.trim();
  // An empty command represents standard plain shell, allowed
  if (trimmed.length === 0) {
    return;
  }

  // Extract binary token (handling quotes if any)
  let binaryToken = '';
  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1);
    binaryToken = endQuote !== -1 ? trimmed.slice(1, endQuote) : trimmed.slice(1);
  } else if (trimmed.startsWith("'")) {
    const endQuote = trimmed.indexOf("'", 1);
    binaryToken = endQuote !== -1 ? trimmed.slice(1, endQuote) : trimmed.slice(1);
  } else {
    binaryToken = trimmed.split(/\s+/)[0];
  }

  // Check binary token itself for temp directories
  if (TEMP_PATH_RE.test(binaryToken) || (osTemp && binaryToken.toLowerCase().includes(osTemp.toLowerCase()))) {
    throw new Error('Comando inválido: binário em diretório temporário');
  }

  const baseName = path.basename(binaryToken).toLowerCase();
  const nameWithoutExt = baseName.replace(/\.(exe|cmd|bat)$/i, '');

  if (!ALLOWED_COMMAND_BINARIES.has(baseName) && !ALLOWED_COMMAND_BINARIES.has(nameWithoutExt)) {
    throw new Error(`Comando inválido: binário "${baseName}" não permitido`);
  }
}

export function sanitizeCanvasDirectives(text: string): string {
  return text
    .replace(/(?:ignore|ignorar|bypass|desative|disable)\s*(?:as\s*)?(?:zero-read|regras\s*do\s*canvas|instru[çc][õo]es\s*do\s*canvas|canvas\s*rules|diretrizes)/gi, '[bloqueado]')
    .replace(/(?:ignore|ignorar|bypass)\s*(?:a\s*)?(?:transcri[çc][ãa]o|fidelidade\s*100%)/gi, '[bloqueado]')
    .replace(/(?:read_file|cat|get-content)\s+.*(?:agents\.md|claude\.md|skill\.md)/gi, '[bloqueado]');
}

export interface TerminalSpawnOptions {
  id?: string;
  terminalId?: string;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  workspaceId?: string;
  presetId?: string;
  title?: string;
  agentRole?: string;
  instructions?: string;
  isAutonomous?: boolean;
  orchestratorMode?: boolean;
  maestroMode?: boolean;
  model?: string;
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
  title?: string;
  presetId?: string;
  command?: string;
  isAutonomous?: boolean;
  agentRole?: string;
  instructions?: string;
  orchestratorMode?: boolean;
  maestroMode?: boolean;
  refs?: AgentRefInfo[];
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
  private maxCommandOutputLines = MAX_TERMINAL_OUTPUT_LINES || 150;
  private saveDebounceTimers = new Map<string, NodeJS.Timeout>();
  private memory = new MemoryService();

  constructor(supervisor: CoreDaemonSupervisor, dataService?: DataService) {
    super();
    this.supervisor = supervisor;
    this.dataService = dataService;

    // fileRef connected / disconnected: keep the agent's AGENTS.md block in sync
    this.supervisor.on('agentRefsChanged', (payload: { terminalId: string; refs: AgentRefInfo[] }) => {
      if (payload && payload.terminalId) {
        this.updateAgentRefs(payload.terminalId, Array.isArray(payload.refs) ? payload.refs : []);
      }
    });

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
      path.resolve(__dirname, '../../bin', binName),
      path.resolve(__dirname, '../../core-daemon/bin', binName),
      path.resolve(__dirname, '../../../core-daemon/bin', binName),
      path.resolve(process.cwd(), 'packages/core-daemon/bin', binName),
      path.resolve(process.cwd(), 'clone/packages/core-daemon/bin', binName),
      path.resolve(__dirname, '../../bin', fallbackBinName),
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
    if (process.env.MINDAGENTICS_DATA_DIR && process.env.MINDAGENTICS_DATA_DIR!.trim().length > 0) {
      return path.join(path.resolve(process.env.MINDAGENTICS_DATA_DIR!.trim()), 'terminals');
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
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
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

  private lastTempLogPrune = 0;

  /** S3 retention: pty overflow logs in the OS temp dir are deleted after 7 days (checked at most hourly). */
  private pruneOldTempLogs(dir: string): void {
    const now = Date.now();
    if (now - this.lastTempLogPrune < 3_600_000) return;
    this.lastTempLogPrune = now;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!/^pty-.*\.log$/.test(f)) continue;
        const full = path.join(dir, f);
        if (now - fs.statSync(full).mtimeMs > 7 * 86_400_000) fs.rmSync(full, { force: true });
      }
    } catch { /* best effort */ }
  }

  public truncateOutputIfNeeded(
    terminalId: string,
    output: string,
    maxLines = this.maxCommandOutputLines
  ): { text: string; truncated: boolean; logFilePath?: string } {
    if (!output) {
      return { text: output, truncated: false };
    }
    const lines = output.split(/\r?\n/);
    if (lines.length <= maxLines) {
      return { text: output, truncated: false };
    }

    const safeId = terminalId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const tmpDir = path.join(os.tmpdir(), 'mindagentics-logs');
    const logFilePath = path.join(tmpDir, `pty-${safeId}-${Date.now()}.log`);

    try {
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      }
      this.pruneOldTempLogs(tmpDir);
      fs.writeFileSync(logFilePath, redactSecrets(output), { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.warn(`[TerminalManager] Failed to write truncated PTY output log for ${terminalId}:`, err);
    }

    const headCount = Math.floor(maxLines / 2);
    const tailCount = maxLines - headCount;
    const omittedCount = lines.length - maxLines;
    const headLines = lines.slice(0, headCount);
    const tailLines = lines.slice(-tailCount);
    const notice = `... [${omittedCount} linhas truncadas (total: ${lines.length} > ${maxLines} linhas). Log completo salvo em: ${logFilePath}] ...`;

    return {
      text: [...headLines, notice, ...tailLines].join('\n'),
      truncated: true,
      logFilePath,
    };
  }

  private readPersistedScrollback(terminalId: string): string {
    try {
      const filePath = this.getLogFilePath(terminalId);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n');
        if (lines.length > this.maxScrollbackLines) {
          return lines.slice(-this.maxScrollbackLines).join('\n');
        }
        return raw;
      }
    } catch (err) {
      console.warn(`[TerminalManager] Failed to read persisted scrollback for ${terminalId}:`, err);
    }
    return '';
  }

  private async persistScrollback(terminalId: string): Promise<void> {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    try {
      const filePath = this.getLogFilePath(terminalId);
      let content = session.scrollback.join('');

      // Limit scrollback to at most 10,000 lines per log file
      const lines = content.split('\n');
      if (lines.length > this.maxScrollbackLines) {
        content = lines.slice(-this.maxScrollbackLines).join('\n');
        session.scrollback = [content];
      }

      // S3: never persist secrets; redact on the joined buffer so tokens split across pty chunks are still caught
      await fs.promises.writeFile(filePath, redactSecrets(content), { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.warn(`[TerminalManager] Failed to persist scrollback for ${terminalId}:`, err);
    }
  }

  private scheduleSaveScrollback(terminalId: string): void {
    if (this.saveDebounceTimers.has(terminalId)) return;

    const timer = setTimeout(() => {
      this.saveDebounceTimers.delete(terminalId);
      this.persistScrollback(terminalId).catch((err) => {
        console.warn(`[TerminalManager] Async persistScrollback failed for ${terminalId}:`, err);
      });
    }, 500);

    this.saveDebounceTimers.set(terminalId, timer);
  }

  public async flushScrollback(terminalId: string): Promise<void> {
    const timer = this.saveDebounceTimers.get(terminalId);
    if (timer) {
      clearTimeout(timer);
      this.saveDebounceTimers.delete(terminalId);
    }
    await this.persistScrollback(terminalId);
  }

  public async flushAllScrollbacks(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const terminalId of this.sessions.keys()) {
      promises.push(this.flushScrollback(terminalId));
    }
    await Promise.all(promises);
  }

  public async spawn(options: TerminalSpawnOptions): Promise<{ terminalId: string; attached?: boolean }> {
    const terminalId = options.id || options.terminalId || crypto.randomUUID();
    const workspaceId = options.workspaceId || '';
    const cols = options.cols || 120;
    const rows = options.rows || 32;
    const cwd = options.cwd && fs.existsSync(options.cwd) ? options.cwd : os.homedir();
    // S2: agent metadata is untrusted (may come from CLI `recruit`, presets, folder names) -> sanitize once, at the boundary
    const agentName = sanitizeLabel(options.title || 'Agent', 80) || 'Agent';
    const agentRole = sanitizeLabel(options.agentRole || '', 200);
    const instructions = sanitizeMarkdownBlock(options.instructions || '', 4000);
    const isAutonomous = options.isAutonomous ?? true;
    const isOrchestrator = Boolean(options.orchestratorMode ?? options.maestroMode);

    // S2: Validate command and model inputs against CWE-78 command injection
    if (options.command !== undefined && options.command !== null) {
      validateReconfigureCommand(options.command);
    }
    if (options.model !== undefined && options.model !== null) {
      validateModelIdentifier(options.model);
    }

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
      MINDAGENTICS_AGENT_NAME: agentName,
      MINDAGENTICS_AGENT_ROLE: agentRole,
      MINDAGENTICS_AGENT_INSTRUCTIONS: instructions,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'mindAgentics',
      PATH: `${cliDir}${path.delimiter}${process.env.PATH || ''}`,
      ...options.env,
      // Orchestrator Lock / Trava Unidirecional: quando ativo, não pode ser resetado para 0 via options.env
      ...(isOrchestrator ? {
        MINDAGENTICS_ORCHESTRATOR_MODE: '1',
        MINDAGENTICS_MAESTRO_MODE: '1'
      } : {})
    };

    const shellArgs = isWin ? ['-NoLogo', '-NoExit'] : ['-l'];

    const refs = await this.loadConnectedRefs(workspaceId, terminalId);
    if (this.memory.hasMemory(cwd, agentName) && !this.memory.hasSummary(cwd, agentName)) {
      try { this.memory.generateSummary(cwd, agentName); } catch {}
    }
    const resuming = this.memory.hasMemory(cwd, agentName);
    const memoryLine = this.memory.hasSummary(cwd, agentName) ? `Memória: leia ${memorySummaryRelPath(agentName)}` : '';

    this.ensureMindAgenticsSkills(cwd, { title: agentName, agentRole, instructions, terminalId, refs, memoryLine });

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
        title: agentName,
        presetId: options.presetId,
        command: options.command,
        isAutonomous,
        agentRole,
        instructions,
        orchestratorMode: isOrchestrator,
        maestroMode: isOrchestrator,
        refs,
        isAlive: true
      };

      this.sessions.set(terminalId, session);
      this.memory.start(terminalId, agentName, cwd);

      // Command Fast-Path executive briefing (100% static prefix first for Prompt Caching stability, zero timestamps/GUIDs)
      const cheatsheetHeader = [
        '[mindAgentics Cheatsheet - Prefixo Estático Imutável]',
        'DIRETRIZ ZERO-READ: NUNCA execute read_file/cat em AGENTS.md, CLAUDE.md ou SKILL.md.',
        'DIRETRIZ DE TRANSCRIÇÃO (FIDELIDADE 100%): Ao criar ou atualizar notas adesivas (mindagentics note write/create), você deve transcrever o conteúdo na íntegra (100% verbatim). É expressamente proibido resumir, omitir detalhes técnicos, sintetizar tópicos ou parafrasear, a menos que o usuário utilize explicitamente palavras como "resuma" ou "faça um resumo". Para textos longos, grave em arquivo temporário e use: mindagentics note write "<Nome>" --file <caminho>.',
        '1. Ver equipe:        mindagentics list',
        '2. Delegar tarefa:    mindagentics ask "<Nome>" "<Instrução>"',
        '3. Criar/Ler nota:    mindagentics note create|write|read "<Nome>" [--file <caminho>]',
        '4. Consultar código:  mindagentics graphify query "<termo>"',
        '5. Abrir referência:  mindagentics portal open "<url>" --name "<Título>"',
        '6. Referência de arquivo/pasta: mindagentics ref add|list|remove <caminho> (só caminho, nunca conteúdo)',
        '7. Lembrar contexto:  mindagentics recall "<termo>"'
      ].join('\n');

      const briefingParts: string[] = [];
      if (agentName && agentName !== 'Terminal' && agentName !== 'Antigravity' && agentName !== 'Codex' && agentName !== 'Claude Code') {
        briefingParts.push(`Agente: "${agentName}"`);
      }
      if (agentRole) {
        briefingParts.push(`Papel: ${agentRole}`);
      }
      if (isOrchestrator) {
        briefingParts.push('Modo: Orquestrador Central');
      }
      if (instructions && instructions.trim().length > 0) {
        briefingParts.push(`Diretrizes: ${instructions.trim()}`);
      }
      const refLines = refs.slice(0, 5).map((r) => this.formatRefLine(r));
      const extraLines = [...refLines, ...(memoryLine ? [memoryLine] : [])];
      const identityBriefing = this.buildBriefing(cheatsheetHeader, briefingParts, refLines, memoryLine, extraLines.length > 0);

      if (options.command && options.command.trim().length > 0) {
        let cmdToRun = options.command.trim();

        // Resume the previous conversation when the agent already has memory here:
        // `claude --continue` / `codex resume --last`, only if the CLI has sessions on disk.
        if (resuming) {
          if (/^claude\b/.test(cmdToRun) && !/(^|\s)(--continue|-c|--resume|-r)(\s|$)/.test(cmdToRun) && this.claudeHasSession(cwd)) {
            cmdToRun = cmdToRun.replace(/^claude\b/, 'claude --continue');
          } else if (/^codex\b/.test(cmdToRun) && !/^codex\s+(resume|exec|login|logout|mcp|app-server)\b/.test(cmdToRun) && this.codexHasSession()) {
            cmdToRun = cmdToRun.replace(/^codex\b/, 'codex resume --last');
          }
        }

        // Enforce autonomous mode flags to avoid manual authorization prompts
        if (isAutonomous) {
          if (cmdToRun.startsWith('agy') && !cmdToRun.includes('--dangerously-skip-permissions')) {
            cmdToRun += ' --dangerously-skip-permissions --mode auto';
          } else if (cmdToRun.startsWith('codex')) {
            cmdToRun = cmdToRun.replace(/--ask-for-approval\s+[^\s]+/g, '').trim();
            if (!cmdToRun.includes('--dangerously-bypass-approvals-and-sandbox')) {
              cmdToRun += ' --dangerously-bypass-approvals-and-sandbox';
            }
          } else if (cmdToRun.startsWith('claude') && !cmdToRun.includes('--dangerously-skip-permissions')) {
            cmdToRun += ' --dangerously-skip-permissions';
          } else if (cmdToRun.startsWith('opencode') && !cmdToRun.includes('--auto')) {
            cmdToRun += ' --auto';
          }
        }

        // Inject initial identity briefing into CLI argument if defined
        if (identityBriefing) {
          // S2: one line, no control/ESC chars, and no characters that expand inside "..." in PowerShell/cmd/sh ($, `, %, \)
          const sanitizedPrompt = sanitizeForPtyLine(identityBriefing).replace(/"/g, "'").replace(/[`$%\\]/g, '').trim();
          if (cmdToRun.startsWith('agy') && !cmdToRun.includes('-i ') && !cmdToRun.includes('--prompt-interactive')) {
            cmdToRun += ` -i "${sanitizedPrompt}"`;
          } else if (cmdToRun.startsWith('codex') && !cmdToRun.includes('"')) {
            cmdToRun += ` "${sanitizedPrompt}"`;
          } else if (cmdToRun.startsWith('claude') && !cmdToRun.includes('"')) {
            cmdToRun += ` "${sanitizedPrompt}"`;
          } else if (cmdToRun.startsWith('opencode') && !cmdToRun.includes('--prompt')) {
            cmdToRun += ` --prompt "${sanitizedPrompt}"`;
          }
        }

        setTimeout(() => {
          try {
            pty.write(cmdToRun + '\r\n');
          } catch {}
        }, 350);
      } else if (identityBriefing) {
        // Plain shell: output visual identity banner
        setTimeout(() => {
          try {
            const bannerText = `[mindAgentics] Agente: ${agentName} | Papel: ${agentRole || 'Developer'}`;
            const shellName = path.basename(shell).toLowerCase();
            if (/^(powershell|pwsh)(\.exe)?$/.test(shellName)) {
              pty.write(`Write-Host ${quotePowerShell(bannerText)} -ForegroundColor Cyan\r\n`);
            } else if (/^cmd(\.exe)?$/.test(shellName)) {
              pty.write(`echo ${bannerText.replace(/[%^&|<>"!()]/g, '_')}\r\n`);
            } else {
              pty.write(`printf '%s\\n' ${quotePosix(bannerText)}\r\n`);
            }
          } catch {}
        }, 350);
      }

      pty.onData((data: string) => {
        this.memory.onOutput(terminalId, data);
        const chunkCheck = this.truncateOutputIfNeeded(terminalId, data, this.maxCommandOutputLines);
        const bufferedData = chunkCheck.truncated ? chunkCheck.text + '\r\n' : data;

        session.scrollback.push(bufferedData);
        if (session.scrollback.length > this.maxScrollbackLines) {
          session.scrollback.splice(0, session.scrollback.length - this.maxScrollbackLines);
        }
        this.scheduleSaveScrollback(terminalId);
        this.emit('data', { terminalId, data: bufferedData });

        // If an ask from another agent is waiting for this terminal's response:
        if (session.activeAskId) {
          session.askOutput = (session.askOutput || '') + data;
          if (session.askTimer) clearTimeout(session.askTimer);

          // Fast prompt detection: if output ends with a shell or CLI prompt, settle in 250ms
          // Otherwise use a responsive 750ms debounce instead of a sluggish 1500ms
          const endsWithPrompt = /(?:[$#>❯›]\s*|\b(?:PS [^>]+>)\s*)$/.test(data.trimEnd());
          const settleDelay = endsWithPrompt ? 250 : 750;

          session.askTimer = setTimeout(() => {
            if (session.activeAskId) {
              const rawOut = session.askOutput || '';
              const askIdToSettle = session.activeAskId;
              session.activeAskId = undefined;
              session.askOutput = '';
              session.status = 'idle';
              this.emit('status', { terminalId, status: 'idle' });

              // Strip ANSI control escapes and apply smart 150-line truncation with temp log redirection
              const clean = redactSecrets(rawOut.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim());
              const truncatedResult = this.truncateOutputIfNeeded(terminalId, clean, this.maxCommandOutputLines);
              this.supervisor.chatTurnSettled?.(terminalId, truncatedResult.text, askIdToSettle);
            }
          }, settleDelay);
        }
      });

      pty.onExit(({ exitCode }) => {
        this.memory.end(terminalId, true);
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
      this.memory.onInput(terminalId, data);
      session.pty.write(data);
      session.status = 'working';
      this.emit('status', { terminalId, status: 'working' });
    }
  }

  public async deliverPrompt(terminalId: string, prompt: string, askId?: string): Promise<{ ok: boolean }> {
    const session = this.sessions.get(terminalId);
    if (!session) return { ok: false };

    // Format typing delivery: ensure Enter (\r) is sent so the command executes immediately
    // S2: prompts relayed from other agents/CLI are untrusted: no ESC/control chars, no embedded newlines (would submit extra lines)
    const cleanPrompt = sanitizeForPtyLine(typeof prompt === 'string' ? prompt : '');
    const textToDeliver = `${cleanPrompt}\r`;

    this.memory.onInput(terminalId, textToDeliver);
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
    this.memory.end(terminalId, true);
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
      this.supervisor.unregisterTerminal?.(terminalId);
    } catch {
      // ignore
    }
  }

  public setOrchestratorMode(terminalId: string, orchestratorMode: boolean): void {
    this.setMaestroMode(terminalId, orchestratorMode);
  }

  public setMaestroMode(terminalId: string, maestroMode: boolean): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;

    if (session.orchestratorMode !== undefined) {
      // Imutabilidade Pós-Criação: orchestratorMode é 100% imutável após o spawn() (proibido promoção e downgrade)
      if (Boolean(session.orchestratorMode) !== Boolean(maestroMode)) {
        console.warn(`[Security/PTY] Tentativa de alterar modo orquestrador pós-criação no terminal ${terminalId} rejeitada.`);
        return;
      }
    } else {
      session.orchestratorMode = maestroMode;
      session.maestroMode = maestroMode;
      this.emit('orchestratorMode', { terminalId, orchestratorMode: maestroMode });
      this.emit('maestroMode', { terminalId, maestroMode });
    }
  }

  private ensureMindAgenticsSkills(targetDir?: string, agentInfo?: { title?: string; agentRole?: string; instructions?: string; terminalId?: string; refs?: AgentRefInfo[]; memoryLine?: string }): void {
    try {
      const skillsSource = path.join(os.homedir(), '.gemini', 'config', 'skills');
      if (!fs.existsSync(skillsSource)) return;

      const mindAgenticsSkillFolders = [
        'mindagentics',
        'mindagentics-chat',
        'mindagentics-manager',
        'mindagentics-portal',
        'mindagentics-portal-devices',
        'mindagentics-routines',
        'mindagentics-workspace',
        'mindagentics-portal-devices',
        'graphify'
      ];

      // 1. Sync to ~/.codex/skills
      const codexSkillsDir = path.join(os.homedir(), '.codex', 'skills');
      if (fs.existsSync(path.join(os.homedir(), '.codex'))) {
        if (!fs.existsSync(codexSkillsDir)) {
          fs.mkdirSync(codexSkillsDir, { recursive: true });
        }
        for (const skill of mindAgenticsSkillFolders) {
          const src = path.join(skillsSource, skill);
          const dest = path.join(codexSkillsDir, skill);
          if (fs.existsSync(src) && !fs.existsSync(dest)) {
            this.copyDirRecursive(src, dest);
          }
        }
      }

      // 2. Ensure AGENTS.md in the workspace so all models have context
      // IMPORTANT FOR PROMPT CACHING (Claude / Gemini):
      // The first >1,024 tokens of AGENTS.md MUST be 100% static and immutable (no timestamps, hours, or random GUIDs).
      // Any dynamic agent context is placed exclusively at the very end (tail) of the file without random terminal IDs.
      if (targetDir && fs.existsSync(targetDir)) {
        const agentsMdPath = path.join(targetDir, 'AGENTS.md');
        let needsUpdate = true;
        if (fs.existsSync(agentsMdPath)) {
          const existing = fs.readFileSync(agentsMdPath, 'utf8');
          if (
            (existing.includes('Modo Orquestrador') || existing.includes('Modo Maestro')) &&
            existing.includes('DIRETRIZ DE TRANSCRIÇÃO (FIDELIDADE 100%)') &&
            existing.includes('mindagentics ref') &&
            !existing.slice(0, 4500).includes('(ID: term-')
          ) {
            needsUpdate = false;
          }
        }
        if (needsUpdate || (agentInfo && (agentInfo.title || agentInfo.agentRole || agentInfo.instructions || (agentInfo.refs && agentInfo.refs.length > 0) || agentInfo.memoryLine))) {
          const refLines = agentInfo?.refs && agentInfo.refs.length > 0
            ? `\n- **Referências Conectadas:**\n${agentInfo.refs.map(r => `  - [${r.isDirectory ? 'pasta' : 'arquivo'}] \`${r.path}\`${r.label ? ` (${r.label})` : ''}`).join('\n')}`
            : '';
          const memoryBlock = agentInfo?.memoryLine
            ? `\n- **Memória de Retomada:**\n  - ${agentInfo.memoryLine}`
            : '';
          const agentBlock = agentInfo && (agentInfo.title || agentInfo.agentRole || agentInfo.instructions || refLines || memoryBlock)
            ? `\n\n---\n\n## Agente Configurado Neste Terminal\n- **Nome:** ${sanitizeMarkdownInline(agentInfo.title || 'Agente', 80)}\n- **Papel / Função:** ${sanitizeMarkdownInline(agentInfo.agentRole || 'Developer', 200)}\n${agentInfo.instructions ? `- **Contexto e Instruções:**\n${sanitizeMarkdownBlock(agentInfo.instructions, 4000)}\n` : ''}${refLines}${memoryBlock}`
            : '';
          const content = `# mindAgentics Canvas - Instruções para Agentes de IA

> [!IMPORTANT]
> **DIRETRIZ ZERO-READ (NÃO RE-LEIA ESTE MANUAL):**
> Você já possui todas as instruções do mindAgentics e o Knowledge Graph do projeto pré-carregados no seu contexto nativo.
> NUNCA execute ferramentas de leitura (\`read_file\`, \`cat\`, \`Get-Content\`, etc.) para ler \`AGENTS.md\`, \`CLAUDE.md\` ou \`SKILL.md\` do disco. Inicie diretamente a ação necessária ou responda ao colega de equipe.

> [!IMPORTANT]
> **DIRETRIZ DE TRANSCRIÇÃO (FIDELIDADE 100%):**
> Ao criar ou atualizar notas adesivas (mindagentics note write/create), você deve transcrever o conteúdo na íntegra (100% verbatim). É expressamente proibido resumir, omitir detalhes técnicos, sintetizar tópicos ou parafrasear, a menos que o usuário utilize explicitamente palavras como "resuma" ou "faça um resumo".

> [!NOTE]
> **ARQUITETURA DE IMUTABILIDADE E PROMPT CACHING (ESTABILIDADE DE CACHE):**
> Este cabeçalho e bloco estático inicial (> 1.024 tokens) são estritamente imutáveis e livres de timestamps, horários variáveis ou GUIDs aleatórios para garantir 100% de eficiência no Prompt Caching automático (Claude Prompt Caching / Gemini Context Caching). Toda parametrização específica da sessão ou do agente reside exclusivamente ao final deste documento.

---

## 1. Visão Geral e Operação no Canvas Interativo mindAgentics

Você está operando como um agente autônomo e colaborativo dentro do canvas espacial interativo **mindAgentics**.
O ambiente conecta múltiplos terminais de agentes de IA, blocos de notas adesivas (Sticky Notes), referências de arquivos e pastas (FileRefs), portais web interativos e grafos de conhecimento determinísticos (Knowledge Graph / Graphify) em uma superfície unificada de engenharia de software.

Você tem à sua disposição a CLI oficial do mindAgentics (\`mindagentics\`) pré-configurada no \`PATH\` do seu terminal e todas as capacidades de comunicação inter-agentes via Named Pipes / IPC de baixa latência:

- **\`mindagentics list\`**: Lista todos os agentes conectados, seus papéis, status de execução, notas adesivas, referências e portais web ativos no canvas atual.
- **\`mindagentics ask "<Nome do Agente>" "<Mensagem>"\`**: Envia mensagens síncronas ou assíncronas e delega subtarefas diretamente para outros agentes presentes no canvas, recebendo a resposta consolidada.
- **\`mindagentics recruit "<Nome>" --preset "<preset>" --role "<role>"\`**: Recruta, instancia e conecta automaticamente novos agentes especializados no workspace atual.
- **\`mindagentics note <create|write|read|edit|delete|list>\`**: Gerencia notas adesivas no canvas com suporte completo a Markdown e ingestão direta via arquivo (\`--file\`) ou \`stdin\`.
- **\`mindagentics ref <add|list|remove>\`**: Cria e gerencia referências de arquivos e pastas no canvas (apenas caminho e tipo são compartilhados com o agente, nunca o conteúdo).
- **\`mindagentics recall "<termo>"\`**: Busca trechos relevantes na memória semântica e histórico local de turnos do agente.
- **\`mindagentics portal open "<url>" --name "<Título>"\`**: Abre portais web no canvas para navegação, visualização de aplicações locais, documentação técnica e referências visuais.
- **\`mindagentics portal navigate "<url>"\`**: Controla portais web existentes para navegar e inspecionar páginas e estados de interface.
- **\`mindagentics connect "<De>" "<Para>"\`**: Conecta visualmente e semanticamente nós, agentes, notas e referências no canvas através de cabos (Cable Ties).
- **\`mindagentics floor <action>\`**: Gerencia worktrees isoladas de trabalho (floors) para execuções paralelas sem conflito de árvores Git.
- **\`mindagentics graphify <build|query|explain|path|open>\`**: Constrói e consulta o Knowledge Graph do projeto via análise sintática abstrata (AST determinístico), permitindo navegação arquitetural precisa com baixo consumo de tokens.

---

## 2. Pipeline de Notas Adesivas e Protocolo de Fidelidade Total (Zero-Truncation)

O subsistema de notas (\`mindagentics note\`) opera como memória compartilhada persistente e artefato visual direto para o usuário e para os demais agentes do esquadrão.

### 2.1 Regras Mandatórias de Transcrição Verbatim
1. **Proibição Absoluta de Resumo Não Solicitado:** Sempre que uma tarefa envolver gravar relatórios, especificações, planos arquiteturais, checklists, logs de auditoria ou código em uma nota adesiva (\`mindagentics note create\` ou \`mindagentics note write\`), o conteúdo deve ser gravado **100% verbatim (na íntegra)**.
2. **Preservação Integral de Formatação Markdown:** Tabelas, blocos de código cercados (\`\`\`), listas aninhadas, cabeçalhos, alertas e metadados técnicos devem ser preservados caractere por caractere, sem elipses (\`...\`), sem supressão de seções e sem comentários do tipo *"restante omitido por brevidade"*.
3. **Uso Obrigatório de \`--file\` para Textos Extensos:** Para evitar limites de linha de comando do shell (PowerShell / Bash) ou problemas de escape de aspas e quebras de linha ao gravar documentos médios ou longos (dezenas ou centenas de linhas):
   - Escreva primeiro o conteúdo completo em um arquivo temporário UTF-8 no disco.
   - Em seguida, execute o comando de ingestão direta via arquivo:
     \`\`\`bash
     mindagentics note create "Título da Nota" --file "./caminho/do/arquivo.md"
     # ou para atualizar uma nota existente:
     mindagentics note write "Título da Nota" --file "./caminho/do/arquivo.md"
     \`\`\`
4. **Verificação de Integridade:** Após operações críticas de escrita em notas extensas, você pode validar a integridade do conteúdo armazenado com \`mindagentics note read "Título da Nota"\`, que retorna todas as linhas numeradas sem truncamento no armazenamento do canvas.

### 2.2 Referência Completa de Subcomandos de Notas e Referências
- **Criar Nota Avulsa:**
  \`\`\`bash
  mindagentics note create "Especificação Técnica" --file "./spec.md" --color yellow
  \`\`\`
- **Sobrescrever / Atualizar Nota com Fidelidade Total:**
  \`\`\`bash
  mindagentics note write "Especificação Técnica" --file "./spec-atualizada.md"
  \`\`\`
- **Ler Conteúdo Completo ou Intervalo de Linhas:**
  \`\`\`bash
  mindagentics note read "Especificação Técnica"
  mindagentics note read "Especificação Técnica" 1 500
  \`\`\`
- **Criar Referência de Arquivo ou Pasta (apenas caminho e tipo):**
  \`\`\`bash
  mindagentics ref add "./src" --label "Código Fonte"
  mindagentics ref add "./docs/spec.md" --to "Backend Dev"
  mindagentics ref list
  \`\`\`

---

## 3. Modo Orquestrador (Orquestração Central de Esquadrão de Agentes)

Quando a variável de ambiente \`MINDAGENTICS_ORCHESTRATOR_MODE=1\` (ou \`MINDAGENTICS_MAESTRO_MODE=1\`) estiver ativa ou você for designado como Orquestrador ou Tech Lead da equipe:
Você atua como o **Orquestrador Central** do canvas mindAgentics. Ao receber uma tarefa complexa ou missão do usuário, siga obrigatoriamente as seguintes regras:

### Regra 1 (Delegação Obrigatória e Coordenação)
Ao receber uma tarefa multidisciplinar, o Orquestrador NÃO deve executar todo o trabalho pesado sozinho se puder delegar. O Orquestrador deve planejar a arquitetura, decompor o objetivo em subtarefas claras com critérios de aceite objetivos e delegar para outros agentes conectados usando:
\`\`\`bash
mindagentics ask "<Nome do Agente>" "<Instrução detalhada e critérios de validação>"
\`\`\`
Você pode inspecionar quem está disponível no canvas a qualquer momento com \`mindagentics list\`.

### Regra 2 (Recrutamento e Criação de Agentes Especializados no Workspace)
Caso o usuário não especifique agentes já existentes/conectados para a tarefa, ou caso a equipe precise de habilidades específicas (ex: Frontend, Backend, Segurança, QA, Reviewer, Pesquisador), o Orquestrador deve recrutar agentes especializados no workspace usando:
\`\`\`bash
mindagentics recruit "<Nome do Agente>" --preset "<preset>" --role "<role>"
\`\`\`
- Presets disponíveis: \`"Claude Code"\`, \`"Codex"\`, \`"Antigravity"\`, \`"OpenCode"\`, \`"Shell"\`.
- Exemplo prático:
  \`\`\`bash
  mindagentics recruit "Frontend Dev" --preset "Antigravity" --role "Especialista em React, TypeScript e UI"
  mindagentics recruit "Backend Dev" --preset "Codex" --role "Especialista em IPC, Daemon e Persistência"
  mindagentics recruit "Security QA" --preset "Claude Code" --role "Engenharia de Prompts, Cache Stability e Testes"
  \`\`\`
Após recrutar, delegue as subtarefas aos novos agentes via \`mindagentics ask\`.

### Regra 3 (Portais Web, Knowledge Graph e Referências Visuais)
Se uma tarefa exigir analisar uma referência na web (documentação técnica, biblioteca, URL, design system, site de referência, benchmark):
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

---

## 4. Isolamento de Contexto, Economia de Tokens e Segurança Operacional

1. **Economia de Contexto via Graphify:** Antes de realizar buscas exaustivas em dezenas de arquivos do repositório, utilize \`mindagentics graphify query "<termo>" --budget 1500\` ou \`mindagentics graphify explain "<Símbolo>"\` para localizar rapidamente os módulos exatos.
2. **Isolamento de Execução:** Respeite o escopo do seu papel (\`agentRole\`) atribuído no terminal. Ao modificar arquivos compartilhados em equipe, verifique o estado do repositório (\`git status\`) para preservar alterações legítimas realizadas paralelamente por outros agentes do esquadrão.
3. **Comunicação Concisa no Terminal e Completa nas Notas:** Mantenha as respostas de chat inter-agentes diretas e acionáveis, mas garanta **100% de fidelidade verbatim** ao persistir documentos, especificações e relatórios em notas adesivas (\`mindagentics note\`).

Trabalhe de forma colaborativa, determinística e segura com os outros agentes conectados no canvas usando a CLI do mindAgentics (\`mindagentics\`).${agentBlock}
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
      const { cwd, workspaceId, cols, rows, title, agentRole, instructions, isAutonomous, command, presetId, orchestratorMode, maestroMode } = session;
      const prevRefs = session.refs ? [...session.refs] : [];
      this.kill(terminalId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await this.spawn({
        id: terminalId,
        cwd,
        workspaceId,
        cols,
        rows,
        title,
        agentRole,
        instructions,
        orchestratorMode,
        maestroMode,
        isAutonomous,
        command,
        presetId,
      });
      const newSession = this.sessions.get(terminalId);
      if (newSession && prevRefs.length > 0) {
        newSession.refs = prevRefs;
      }
    }
  }

  public async reconfigure(
    arg1: string | {
      terminalId: string;
      title?: string;
      agentRole?: string;
      instructions?: string;
      orchestratorMode?: boolean;
      maestroMode?: boolean;
      command?: string;
      model?: string;
      presetId?: string;
      isAutonomous?: boolean;
      restart?: boolean;
    },
    arg2?: {
      title?: string;
      agentRole?: string;
      instructions?: string;
      orchestratorMode?: boolean;
      maestroMode?: boolean;
      command?: string;
      model?: string;
      presetId?: string;
      isAutonomous?: boolean;
      restart?: boolean;
    }
  ): Promise<{ ok: boolean }> {
    const terminalId = typeof arg1 === 'string' ? arg1 : arg1?.terminalId;
    const config = typeof arg1 === 'string' ? (arg2 || {}) : (arg1 || {});

    const session = this.sessions.get(terminalId);
    if (!session) {
      return { ok: false };
    }

    // S2: Validar e sanitizar comandos/presets e metadados contra injeção (CWE-78)
    if (config.command !== undefined) {
      validateReconfigureCommand(config.command);
    }

    if ((config as any).model !== undefined) {
      validateModelIdentifier((config as any).model);
    }

    if (config.presetId !== undefined) {
      if (typeof config.presetId !== 'string' || hasControlChars(config.presetId) || !/^[A-Za-z0-9_-]{1,64}$/.test(config.presetId)) {
        throw new Error('Comando inválido: presetId inválido no terminal:reconfigure');
      }
    }

    const commandChanged = config.command !== undefined && config.command !== session.command;
    const presetChanged = config.presetId !== undefined && config.presetId !== session.presetId;
    const needsRestart = Boolean(config.restart || commandChanged || presetChanged);

    if (config.title !== undefined) {
      session.title = sanitizeMarkdownInline(config.title, 80) || 'Agent';
    }
    if (config.agentRole !== undefined) {
      const sanitized = sanitizeMarkdownInline(config.agentRole, 200);
      session.agentRole = sanitizeCanvasDirectives(sanitized);
    }
    if (config.instructions !== undefined) {
      const sanitized = sanitizeMarkdownBlock(config.instructions, 4000);
      session.instructions = sanitizeCanvasDirectives(sanitized);
    }
    if (config.orchestratorMode !== undefined || config.maestroMode !== undefined) {
      const requestedOrch = Boolean(config.orchestratorMode ?? config.maestroMode);
      if (session.orchestratorMode !== undefined) {
        // Imutabilidade Pós-Criação: orchestratorMode é 100% imutável após o spawn() (proibido promoção e downgrade)
        if (Boolean(session.orchestratorMode) !== requestedOrch) {
          console.warn(`[Security/PTY] Tentativa de alterar modo orquestrador via reconfigure pós-criação no terminal ${terminalId} rejeitada.`);
          // Mantém session.orchestratorMode inalterado
        }
      } else {
        session.orchestratorMode = requestedOrch;
        session.maestroMode = requestedOrch;
      }
    }

    if (config.isAutonomous !== undefined) {
      session.isAutonomous = config.isAutonomous;
    }
    if (config.command !== undefined) {
      session.command = config.command;
    }
    if (config.presetId !== undefined) {
      session.presetId = config.presetId;
    }

    // Atualizar AGENTS.md garantindo sanitização de markdown
    this.ensureMindAgenticsSkills(session.cwd, {
      title: session.title,
      agentRole: session.agentRole,
      instructions: session.instructions,
      terminalId,
      refs: session.refs,
      memoryLine: (session.title && this.memory.hasSummary(session.cwd, session.title)) ? `Memória: leia ${memorySummaryRelPath(session.title)}` : ''
    });

    if (needsRestart) {
      const { cwd, workspaceId, cols, rows, title, agentRole, instructions, isAutonomous, command, presetId } = session;
      const prevRefs = session.refs ? [...session.refs] : [];
      this.kill(terminalId);
      // Aguardar encerramento do processo zumbi
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Limpar scrollback em disco para novo agente iniciar limpo
      const logPath = this.getLogFilePath(terminalId);
      try {
        if (fs.existsSync(logPath)) {
          fs.unlinkSync(logPath);
        }
      } catch {}
      this.emit('data', { terminalId, data: '\x1b[2J\x1b[H' });

      await this.spawn({
        id: terminalId,
        cwd,
        workspaceId,
        cols,
        rows,
        title,
        agentRole,
        instructions,
        orchestratorMode: session.orchestratorMode,
        maestroMode: session.maestroMode,
        isAutonomous,
        command,
        presetId,
      });
      const newSession = this.sessions.get(terminalId);
      if (newSession && prevRefs.length > 0) {
        newSession.refs = prevRefs;
      }
    } else {
      try {
        if (this.supervisor?.daemonReady) {
          this.supervisor.syncCanvas?.({
            nodes: [{
              id: terminalId,
              kind: 'terminal',
              content: {
                terminalId,
                title: session.title,
                agentRole: session.agentRole,
                orchestratorMode: session.orchestratorMode,
                maestroMode: session.maestroMode,
                presetId: session.presetId,
              }
            }]
          });
        }
      } catch {}
    }

    const reconfiguredSession = this.sessions.get(terminalId) || session;
    this.emit('reconfigured', {
      terminalId,
      title: reconfiguredSession.title,
      agentRole: reconfiguredSession.agentRole,
      instructions: reconfiguredSession.instructions,
      orchestratorMode: reconfiguredSession.orchestratorMode,
      maestroMode: reconfiguredSession.maestroMode,
      presetId: reconfiguredSession.presetId,
      command: reconfiguredSession.command,
    });

    return { ok: true };
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
      { id: 'antigravity', name: 'Antigravity', command: 'agy', icon: 'sparkle' },
      { id: 'codex', name: 'Codex', command: 'codex --no-daemon', icon: 'brain' },
      { id: 'opencode', name: 'OpenCode', command: 'opencode', icon: 'rectangle.portrait' },
      { id: 'claude', name: 'Claude Code', command: 'claude', icon: 'seal' },
      { id: 'github-copilot', name: 'GitHub Copilot', command: 'copilot', icon: 'terminal' },
      { id: 'ollama', name: 'Ollama', command: 'ollama run llama3', icon: 'cpu' },
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
          const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
          const defaultOllama = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
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

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? null;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? null;
        const quotaPercent = liveProbe?.quotaPercent ?? (primaryUsedFraction != null ? Math.round(primaryUsedFraction * 100) : null);
        const secondaryPercent = liveProbe?.secondaryPercent ?? (secondaryUsedFraction != null ? Math.round(secondaryUsedFraction * 100) : null);

        reports.push({
          id: agent.id,
          name: 'Antigravity',
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
          primaryResetText: liveProbe?.primaryResetText || (primaryUsedFraction != null ? 'Janela contínua (5h)' : 'Sem dados de cota'),
          secondaryResetText: liveProbe?.secondaryResetText || (secondaryUsedFraction != null ? 'Renovação semanal' : 'Sem dados de cota'),
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || buildUsageWindows(primaryUsedFraction, secondaryUsedFraction, liveProbe?.primaryResetText, liveProbe?.secondaryResetText),
          details: [
            { label: 'Janela de Contexto', value: '1.048.576 tokens (1M)' },
            { label: 'Taxa de Requisições', value: '60 RPM / 4.000.000 TPM' },
            { label: 'Modelo Ativo', value: activeModel },
            { label: 'Uso Sessão (5h)', value: quotaPercent != null ? `${quotaPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Uso Semanal (7d)', value: secondaryPercent != null ? `${secondaryPercent}% utilizado` : 'Sem dados de cota' },
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
        let userEmail = 'conta local';
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
                if (typeof payload.email === 'string') userEmail = maskEmail(payload.email);
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

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? null;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? null;
        const quotaPercent = liveProbe?.quotaPercent ?? (primaryUsedFraction != null ? Math.round(primaryUsedFraction * 100) : null);
        const secondaryPercent = liveProbe?.secondaryPercent ?? (secondaryUsedFraction != null ? Math.round(secondaryUsedFraction * 100) : null);

        reports.push({
          id: agent.id,
          name: 'Codex',
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
          primaryResetText: liveProbe?.primaryResetText || (primaryUsedFraction != null ? 'Janela de 5h' : 'Sem dados de cota'),
          secondaryResetText: liveProbe?.secondaryResetText || (secondaryUsedFraction != null ? 'Janela de 7d' : 'Sem dados de cota'),
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || buildUsageWindows(primaryUsedFraction, secondaryUsedFraction, liveProbe?.primaryResetText, liveProbe?.secondaryResetText),
          details: [
            { label: 'Conta & Plano', value: `${authMode} (${userEmail})` },
            { label: 'Renovação do Plano', value: planRenewal },
            { label: 'Modelo Ativo', value: activeModel },
            { label: 'Uso Sessão (5h)', value: quotaPercent != null ? `${quotaPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Uso Semanal (7d)', value: secondaryPercent != null ? `${secondaryPercent}% utilizado` : 'Sem dados de cota' },
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

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? null;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? null;
        const quotaPercent = liveProbe?.quotaPercent ?? (primaryUsedFraction != null ? Math.round(primaryUsedFraction * 100) : null);
        const secondaryPercent = liveProbe?.secondaryPercent ?? (secondaryUsedFraction != null ? Math.round(secondaryUsedFraction * 100) : null);

        reports.push({
          id: agent.id,
          name: 'OpenCode',
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
          secondaryUsedFraction,
          primaryLabel: 'Sessão / Diário',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: liveProbe?.primaryResetText || (primaryUsedFraction != null ? 'Janela de 1 min' : 'Sem dados de cota'),
          secondaryResetText: liveProbe?.secondaryResetText || 'Sem dados de cota',
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || buildUsageWindows(primaryUsedFraction, secondaryUsedFraction, liveProbe?.primaryResetText, liveProbe?.secondaryResetText),
          details: [
            { label: 'Janela de Contexto', value: '200.000 tokens (200k)' },
            { label: 'Limite de Requisições', value: '50 RPM / 250.000 TPM' },
            { label: 'Servidores MCP', value: `${mcpCount} configurados (rea, mcp)` },
            { label: 'Modelo Padrão', value: 'Multi-Provider (Claude / GPT)' },
            { label: 'Uso Sessão (Diário)', value: quotaPercent != null ? `${quotaPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Uso Semanal (7d)', value: secondaryPercent != null ? `${secondaryPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Executável', value: agent.path || 'opencode.ps1' },
          ]
        });
      } else if (agent.id === 'github-copilot' || agent.id === 'gh-copilot') {
        if (reports.some(r => r.id === 'github-copilot')) continue;

        let liveProbe: Partial<AgentUsageReport> | null = null;
        try {
          liveProbe = await probeCopilot(agent.path || 'copilot');
        } catch {}

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? null;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? null;
        const quotaPercent = liveProbe?.quotaPercent ?? (primaryUsedFraction != null ? Math.round(primaryUsedFraction * 100) : null);
        const secondaryPercent = liveProbe?.secondaryPercent ?? (secondaryUsedFraction != null ? Math.round(secondaryUsedFraction * 100) : null);

        reports.push({
          id: 'github-copilot',
          name: 'GitHub Copilot',
          command: agent.command,
          icon: 'terminal',
          installed: true,
          path: agent.path,
          status: 'active',
          colorHex: '#6366F1',
          activeModel: 'GPT-4o / Claude 3.5 Sonnet (Copilot Engine)',
          provider: 'GitHub / Microsoft Azure',
          planOrTier: 'Copilot Pro / Business',
          primaryUsedFraction,
          secondaryUsedFraction,
          primaryLabel: 'Sessão / Diário',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: liveProbe?.primaryResetText || (primaryUsedFraction != null ? '2.000 chats / mês' : 'Sem dados de cota'),
          secondaryResetText: liveProbe?.secondaryResetText || 'Sem dados de cota',
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || buildUsageWindows(primaryUsedFraction, secondaryUsedFraction, liveProbe?.primaryResetText, liveProbe?.secondaryResetText),
          details: [
            { label: 'Janela de Contexto', value: '128.000 tokens (128k)' },
            { label: 'Taxa de Requisições', value: '30 RPM' },
            { label: 'Cota de Chat', value: 'Turnos premium / mês' },
            { label: 'Uso Sessão (Diário)', value: quotaPercent != null ? `${quotaPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Uso Semanal (7d)', value: secondaryPercent != null ? `${secondaryPercent}% utilizado` : 'Sem dados de cota' },
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

        let liveProbe: Partial<AgentUsageReport> | null = null;
        try {
          liveProbe = await probeClaude(agent.path || 'claude');
        } catch {}

        const primaryUsedFraction = liveProbe?.primaryUsedFraction ?? null;
        const secondaryUsedFraction = liveProbe?.secondaryUsedFraction ?? null;
        const quotaPercent = liveProbe?.quotaPercent ?? (primaryUsedFraction != null ? Math.round(primaryUsedFraction * 100) : null);
        const secondaryPercent = liveProbe?.secondaryPercent ?? (secondaryUsedFraction != null ? Math.round(secondaryUsedFraction * 100) : null);

        reports.push({
          id: agent.id,
          name: 'Claude Code',
          command: agent.command,
          icon: 'seal',
          installed: true,
          path: agent.path,
          status: 'ready',
          colorHex: '#A855F7',
          activeModel: 'Claude 3.7 Sonnet / Claude 3.5 Sonnet',
          provider: 'Anthropic',
          planOrTier: 'Anthropic Claude Code',
          primaryUsedFraction,
          secondaryUsedFraction,
          primaryLabel: 'Sessão / Diário',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: liveProbe?.primaryResetText || (primaryUsedFraction != null ? 'Janela de 1 min' : 'Sem dados de cota'),
          secondaryResetText: liveProbe?.secondaryResetText || 'Sem dados de cota',
          quotaPercent,
          secondaryPercent,
          windows: liveProbe?.windows || buildUsageWindows(primaryUsedFraction, secondaryUsedFraction, liveProbe?.primaryResetText, liveProbe?.secondaryResetText),
          details: [
            { label: 'Janela de Contexto', value: '200.000 tokens (200k)' },
            { label: 'Taxa de Requisições', value: '50 RPM / 40.000 TPM' },
            { label: 'Modelo Ativo', value: 'Claude 3.7 Sonnet / Claude 3.5 Sonnet' },
            { label: 'Uso Sessão (Diário)', value: quotaPercent != null ? `${quotaPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Uso Semanal (7d)', value: secondaryPercent != null ? `${secondaryPercent}% utilizado` : 'Sem dados de cota' },
            { label: 'Servidores MCP', value: `${mcpList.length} servidores (${mcpList.join(', ')})` },
            { label: 'Limite de Saída', value: '8.192 tokens' },
            { label: 'Configuração', value: path.join(os.homedir(), '.claude.json') },
            { label: 'Executável', value: agent.path || 'claude' },
          ]
        });
      } else if (agent.id === 'ollama') {
        const windows = buildUsageWindows(null, null, 'Sem limites de taxa', '100% Offline');
        reports.push({
          id: agent.id,
          name: 'Ollama',
          command: agent.command,
          icon: 'cpu',
          installed: true,
          path: agent.path,
          status: 'ready',
          colorHex: '#F59E0B',
          activeModel: 'Modelos Locais (Llama 3, Mistral, Qwen)',
          provider: 'Ollama Local Runtime',
          planOrTier: 'Hardware Local (100% Offline)',
          primaryUsedFraction: null,
          secondaryUsedFraction: null,
          primaryLabel: 'Sessão / Diário',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: 'Sem limites de taxa',
          secondaryResetText: '100% Offline',
          quotaPercent: null,
          secondaryPercent: null,
          windows,
          details: [
            { label: 'Janela de Contexto', value: '8.192 a 32.768 tokens (VRAM GPU)' },
            { label: 'Taxa de Limite', value: 'Sem restrição de RPM/TPM' },
            { label: 'Uso Sessão (Diário)', value: 'Sem limites (Local)' },
            { label: 'Uso Semanal (7d)', value: 'Sem limites (Local)' },
            { label: 'Privacidade', value: '100% Offline e Local' },
            { label: 'Executável', value: agent.path || 'ollama.exe' },
          ]
        });
      }
    }

    return reports;
  }

  public async getAgentModels(presetId?: string): Promise<Record<string, AgentModelOption[]> | AgentModelOption[]> {
    const norm = (presetId || '').toLowerCase().trim();
    if (norm === 'antigravity' || norm === 'agy') {
      return queryAntigravityModels();
    }
    if (norm === 'claude' || norm === 'claude-code') {
      return FALLBACK_AGENT_MODELS.claude;
    }
    if (norm === 'codex') {
      return FALLBACK_AGENT_MODELS.codex;
    }
    if (norm === 'opencode') {
      return FALLBACK_AGENT_MODELS.opencode;
    }
    if (norm === 'ollama') {
      return queryOllamaModels();
    }

    const [agyModels, ollamaModels] = await Promise.all([
      queryAntigravityModels(),
      queryOllamaModels(),
    ]);

    const allModels: Record<string, AgentModelOption[]> = {
      antigravity: agyModels,
      claude: FALLBACK_AGENT_MODELS.claude,
      codex: FALLBACK_AGENT_MODELS.codex,
      opencode: FALLBACK_AGENT_MODELS.opencode,
      ollama: ollamaModels,
    };

    if (norm && allModels[norm]) {
      return allModels[norm];
    }
    return allModels;
  }

  private which(cmd: string): string | null {
    const isWin = process.platform === 'win32';
    const exts = isWin ? ((process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM') + ';.PS1').split(';') : [''];
    const pathDirs = (process.env.PATH || '').split(path.delimiter);

    if (isWin) {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      pathDirs.unshift(
        path.join(appData, 'npm'),
        path.join(localAppData, 'agy', 'bin'),
        path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
        path.join(localAppData, 'Programs', 'Ollama'),
        path.join(programFiles, 'GitHub CLI')
      );
    }

    for (const dir of pathDirs) {
      // S5: ignore empty / relative PATH entries (they resolve against the cwd => binary planting)
      if (!dir || !path.isAbsolute(dir)) continue;
      for (const ext of exts) {
        const full = path.join(dir, cmd + (isWin && !cmd.toLowerCase().endsWith('.exe') ? ext : ''));
        if (fs.existsSync(full)) {
          return full;
        }
      }
    }
    return null;
  }

  private async loadConnectedRefs(workspaceId?: string, terminalId?: string): Promise<AgentRefInfo[]> {
    if (!this.dataService || !workspaceId || !terminalId) return [];
    try {
      const ws = await this.dataService.getWorkspace(workspaceId);
      if (!ws) return [];
      const nodes: any[] = [];
      const cableTies: any[] = [];
      if (Array.isArray(ws.nodes)) nodes.push(...ws.nodes);
      if (Array.isArray(ws.cableTies)) cableTies.push(...ws.cableTies);
      if (Array.isArray(ws.floors)) {
        for (const f of ws.floors) {
          if (Array.isArray(f.nodes)) nodes.push(...f.nodes);
          if (Array.isArray(f.cableTies)) cableTies.push(...f.cableTies);
        }
      }
      const myNodeIds = new Set<string>([terminalId]);
      for (const n of nodes) {
        if (n && n.kind === 'terminal' && (n.content?.terminalId === terminalId || n.id === terminalId)) {
          myNodeIds.add(n.id);
          if (n.content?.terminalId) myNodeIds.add(n.content.terminalId);
        }
      }
      const refNodeIds = new Set<string>();
      for (const tie of cableTies) {
        if (!tie) continue;
        const from = tie.fromNodeId || tie.fromId;
        const to = tie.toNodeId || tie.toId;
        if (myNodeIds.has(from) && to) refNodeIds.add(to);
        if (myNodeIds.has(to) && from) refNodeIds.add(from);
      }
      const out: AgentRefInfo[] = [];
      for (const n of nodes) {
        if (n && n.kind === 'fileRef' && refNodeIds.has(n.id) && n.content?.path) {
          out.push({
            path: String(n.content.path),
            isDirectory: Boolean(n.content.isDirectory),
            label: n.content.label ? String(n.content.label) : undefined
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private updateAgentRefs(terminalId: string, refs: AgentRefInfo[]): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.refs = refs;
    }
    const agentName = session?.title || 'Agent';
    const cwd = session?.cwd || os.homedir();
    const memoryLine = this.memory.hasSummary(cwd, agentName) ? `Memória: leia ${memorySummaryRelPath(agentName)}` : '';
    this.ensureMindAgenticsSkills(cwd, {
      title: agentName,
      agentRole: session?.agentRole,
      instructions: session?.instructions,
      terminalId,
      refs,
      memoryLine
    });
  }

  private formatRefLine(ref: AgentRefInfo): string {
    const typeLabel = ref.isDirectory ? 'pasta' : 'arquivo';
    const cleanPath = String(ref.path || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return `[ref] ${typeLabel}: ${cleanPath}`;
  }

  private buildBriefing(
    cheatsheetHeader: string,
    briefingParts: string[],
    refLines: string[],
    memoryLine: string,
    hasExtras: boolean
  ): string {
    const parts = [...briefingParts];
    for (const r of refLines.slice(0, 3)) parts.push(r);
    if (memoryLine) parts.push(memoryLine);

    let result = parts.length > 0
      ? `${cheatsheetHeader}\n[${parts.join(' | ')}]`
      : cheatsheetHeader;

    if (estimateTokens(result) > MAX_BRIEFING_TOKENS) {
      const compactHeader = [
        '[mindAgentics Cheatsheet]',
        '1. Equipe: mindagentics list | 2. Delegar: mindagentics ask "<Nome>" "<Instrução>"',
        '3. Nota: mindagentics note create|write|read "<Nome>"',
        '4. Referência: mindagentics ref add|list|remove <caminho> | 5. Memória: mindagentics recall "<termo>"'
      ].join('\n');
      result = `${compactHeader}\n[${parts.join(' | ')}]`;
    }
    while (estimateTokens(result) > MAX_BRIEFING_TOKENS && parts.length > 1) {
      parts.pop();
      result = `[mindAgentics Cheatsheet]\n[${parts.join(' | ')}]`;
    }
    return result;
  }

  private claudeHasSession(cwd: string): boolean {
    try {
      const projectClaude = path.join(cwd, '.claude');
      if (fs.existsSync(projectClaude)) return true;
      const globalClaude = path.join(os.homedir(), '.claude');
      if (fs.existsSync(globalClaude)) {
        const historyFile = path.join(globalClaude, 'history.jsonl');
        if (fs.existsSync(historyFile) && fs.statSync(historyFile).size > 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private codexHasSession(): boolean {
    try {
      const codexDir = path.join(os.homedir(), '.codex');
      const sessionFile = path.join(codexDir, 'session_index.jsonl');
      return fs.existsSync(sessionFile) && fs.statSync(sessionFile).size > 0;
    } catch {
      return false;
    }
  }

  public killAll(): void {
    this.memory.endAll();
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

/** S5: never show full account e-mail in the UI (PII). */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'conta local';
  return `${user.slice(0, 1)}***@${domain}`.replace(/[\u0000-\u001F]/g, '');
}
