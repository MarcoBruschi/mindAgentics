/**
 * Local agent memory: capture, rotation and heuristic summary.
 *
 * Layout (inside the agent's working directory):
 *   .mindagentics/memory/<agente>/log.jsonl      one JSON line per turn (ANSI-free)
 *   .mindagentics/memory/<agente>/log.<n>.jsonl  rotated logs (max MAX_ROTATED kept)
 *   .mindagentics/memory/<agente>/summary.md     ~500 tokens, local heuristics only
 *   .mindagentics/memory/<agente>/index.db       SQLite FTS5 index (built by the daemon's recall)
 *
 * No network / API call is ever made here.
 */

import fs from 'fs';
import path from 'path';
import { redactSecrets, wrapUntrustedMemory, MEMORY_RETENTION_DAYS } from '@mindagentics/shared';

function ensureGitignoreEntry(cwd: string): void {
  try {
    const gitignorePath = path.join(cwd, '.gitignore');
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }
    const hasEntry = content.split(/\r?\n/).some((line) => {
      const trimmed = line.trim().replace(/^\//, '');
      return trimmed === '.mindagentics/memory' || trimmed === '.mindagentics/memory/' || trimmed === '.mindagentics' || trimmed === '.mindagentics/';
    });
    if (!hasEntry) {
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      const prefix = content.length > 0 && !content.endsWith('\n') ? eol : '';
      fs.appendFileSync(gitignorePath, `${prefix}${eol}# mindAgentics memory${eol}.mindagentics/memory/${eol}`, 'utf8');
    }
  } catch {
    // ignore
  }
}

export const MEMORY_DIR_NAME = path.join('.mindagentics', 'memory');
export const LOG_FILE = 'log.jsonl';
export const SUMMARY_FILE = 'summary.md';

export interface MemoryTurn {
  ts: string;
  agent: string;
  terminalId: string;
  turn: number;
  input: string;
  output: string;
}

export interface MemoryServiceOptions {
  /** Rotate log.jsonl once it grows past this many bytes (default 1 MiB). */
  maxLogBytes?: number;
  /** Rotated files to keep (default 3). */
  maxRotated?: number;
  /** Regenerate summary.md every N turns (default 10). */
  summaryEveryTurns?: number;
  /** Silence (ms) after the last output chunk that closes a turn (default 2500). */
  idleMs?: number;
  /** Hard cap of characters kept per turn output (default 3000). */
  maxOutputChars?: number;
}

interface SessionMemory {
  terminalId: string;
  agent: string;
  slug: string;
  cwd: string;
  lineBuf: string;
  currentInput: string;
  outBuf: string;
  turnCount: number;
  timer: NodeJS.Timeout | null;
}

/** Hard budget for summary.md: ~500 tokens at ~4 chars/token. */
export const SUMMARY_MAX_CHARS = 2000;

/** Filesystem-safe, stable folder name for an agent. */
export function agentSlug(name: string, fallback = 'agent'): string {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || fallback;
}

export function memoryDirFor(cwd: string, agent: string): string {
  return path.join(cwd, MEMORY_DIR_NAME, agentSlug(agent));
}

/** Relative path (forward slashes) used in the one-line resume prompt. */
export function memorySummaryRelPath(agent: string): string {
  return `.mindagentics/memory/${agentSlug(agent)}/${SUMMARY_FILE}`;
}

/** Strip ANSI/OSC/control sequences and collapse terminal redraw noise. */
export function cleanTerminalText(raw: string): string {
  if (!raw) return '';
  let text = raw
    // OSC ... BEL | ST
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    // CSI
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    // DCS/SOS/PM/APC ... ST
    .replace(/\x1B[PX^_][^\x1B]*\x1B\\/g, '')
    // other 2-char escapes
    .replace(/\x1B[@-Z\\-_]/g, '')
    .replace(/\x1B[()][A-Za-z0-9]/g, '');

  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    // carriage return = overwrite: keep what was written last
    const segs = rawLine.split('\r').filter((s) => s.length > 0);
    let line = (segs.length ? segs[segs.length - 1] : '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .replace(/\s+$/g, '');
    if (!line.trim()) continue;
    // spinner / box-drawing only lines carry no information
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    if (out.length && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join('\n');
}

export class MemoryService {
  private sessions = new Map<string, SessionMemory>();
  private readonly maxLogBytes: number;
  private readonly maxRotated: number;
  private readonly summaryEvery: number;
  private readonly idleMs: number;
  private readonly maxOutputChars: number;

  constructor(options: MemoryServiceOptions = {}) {
    this.maxLogBytes = options.maxLogBytes ?? 1024 * 1024;
    this.maxRotated = options.maxRotated ?? 3;
    this.summaryEvery = options.summaryEveryTurns ?? 10;
    this.idleMs = options.idleMs ?? 2500;
    this.maxOutputChars = options.maxOutputChars ?? 3000;
  }

  public start(terminalId: string, agent: string, cwd: string): void {
    this.end(terminalId, false);
    const slug = agentSlug(agent, terminalId.slice(0, 8));
    this.sessions.set(terminalId, {
      terminalId,
      agent: agent || slug,
      slug,
      cwd,
      lineBuf: '',
      currentInput: '',
      outBuf: '',
      turnCount: this.countExistingTurns(cwd, slug),
      timer: null,
    });
  }

  /** Keystrokes / prompts written to the pty. A CR/LF commits the user's input line. */
  public onInput(terminalId: string, data: string): void {
    const s = this.sessions.get(terminalId);
    if (!s || !data) return;
    const stripped = data
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B[@-Z\\-_]/g, '');
    for (const ch of stripped) {
      if (ch === '\r' || ch === '\n') {
        const line = s.lineBuf.trim();
        s.lineBuf = '';
        if (!line) continue;
        // a new prompt closes whatever turn was still being collected
        this.flushTurn(s);
        s.currentInput = line;
      } else if (ch === '\x7f' || ch === '\b') {
        s.lineBuf = s.lineBuf.slice(0, -1);
      } else if (ch >= ' ') {
        s.lineBuf += ch;
      }
    }
  }

  /** Raw pty output; the turn closes after `idleMs` of silence. */
  public onOutput(terminalId: string, data: string): void {
    const s = this.sessions.get(terminalId);
    if (!s || !data) return;
    s.outBuf += data;
    if (s.outBuf.length > 256 * 1024) s.outBuf = s.outBuf.slice(-128 * 1024);
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => this.flushTurn(s), this.idleMs);
    s.timer.unref?.();
  }

  /** Close the session: flush the pending turn and refresh summary.md. */
  public end(terminalId: string, summarize = true): void {
    const s = this.sessions.get(terminalId);
    if (!s) return;
    this.flushTurn(s);
    if (summarize) {
      try {
        this.generateSummary(s.cwd, s.agent);
      } catch (err) {
        console.warn('[MemoryService] summary failed:', err);
      }
    }
    this.sessions.delete(terminalId);
  }

  public endAll(): void {
    for (const id of Array.from(this.sessions.keys())) this.end(id, true);
  }

  public hasMemory(cwd: string, agent: string): boolean {
    try {
      const dir = memoryDirFor(cwd, agent);
      return fs.existsSync(path.join(dir, LOG_FILE)) || fs.existsSync(path.join(dir, SUMMARY_FILE));
    } catch {
      return false;
    }
  }

  public hasSummary(cwd: string, agent: string): boolean {
    try {
      return fs.existsSync(path.join(memoryDirFor(cwd, agent), SUMMARY_FILE));
    } catch {
      return false;
    }
  }

  /**
   * Safely removes only the memory directory for a specific agent:
   * `.mindagentics/memory/<agentSlug>`
   * Enforces strict canonical boundaries so it can never delete `.mindagentics/memory` root,
   * the workspace directory, or escape via path traversal.
   */
  public clearMemory(cwd: string, agent: string): { ok: boolean; path?: string; reason?: string } {
    if (!cwd || !agent) {
      return { ok: false, reason: 'cwd e agent são obrigatórios' };
    }
    // S6 / Path Safety: reject directory traversal patterns in agent name
    if (typeof agent !== 'string' || agent.includes('/') || agent.includes('\\') || agent.includes('..') || agent.trim() === '.' || agent.trim() === '..') {
      return { ok: false, reason: 'Path traversal detectado: nome do agente contém caracteres inválidos' };
    }
    const slug = agentSlug(agent);
    if (!slug || slug === '.' || slug === '..') {
      return { ok: false, reason: 'agentSlug inválido' };
    }

    const canonicalCwd = path.resolve(cwd);
    const canonicalMemoryRoot = path.resolve(canonicalCwd, MEMORY_DIR_NAME);
    const targetDir = path.resolve(canonicalMemoryRoot, slug);

    // Enforce that targetDir is strictly a child directory of canonicalMemoryRoot
    const rel = path.relative(canonicalMemoryRoot, targetDir);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '' || rel === '.') {
      return { ok: false, reason: 'Path traversal detectado: tentativa de apagar fora ou na raiz da memória' };
    }

    // Safety check: targetDir must not be the memory root or cwd
    if (targetDir === canonicalMemoryRoot || targetDir === canonicalCwd) {
      return { ok: false, reason: 'Operação proibida: não é permitido apagar a raiz da memória ou do workspace' };
    }

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      return { ok: true, path: targetDir };
    } catch (err: any) {
      return { ok: false, reason: `Erro ao limpar memória do agente: ${err?.message || err}` };
    }
  }

  public clear(terminalId: string): { ok: boolean; path?: string; reason?: string } {
    const s = this.sessions.get(terminalId);
    if (!s) return { ok: false, reason: 'Sessão não encontrada' };
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    s.outBuf = '';
    s.lineBuf = '';
    s.currentInput = '';
    s.turnCount = 0;
    return this.clearMemory(s.cwd, s.agent);
  }

  // ---------------------------------------------------------------- internals

  private flushTurn(s: SessionMemory): void {
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    const raw = s.outBuf;
    s.outBuf = '';
    const input = s.currentInput;
    s.currentInput = '';

    let output = cleanTerminalText(raw);
    if (input && output.startsWith(input)) output = output.slice(input.length).replace(/^\n/, '');
    if (output.length > this.maxOutputChars) {
      output = output.slice(0, Math.floor(this.maxOutputChars * 0.4)) + '\n…\n' + output.slice(-Math.floor(this.maxOutputChars * 0.6));
    }
    // idle prompt redraws / empty turns are not worth a log line
    if (!input && output.length < 8) return;
    if (!output && !input) return;

    s.turnCount += 1;
    const entry: MemoryTurn = {
      ts: new Date().toISOString(),
      agent: s.agent,
      terminalId: s.terminalId,
      turn: s.turnCount,
      input,
      output,
    };
    try {
      this.appendTurn(s.cwd, s.slug, entry);
      if (s.turnCount % this.summaryEvery === 0) this.generateSummary(s.cwd, s.agent);
    } catch (err) {
      console.warn('[MemoryService] failed to persist turn:', err);
    }
  }

  private appendTurn(cwd: string, slug: string, entry: MemoryTurn): void {
    const dir = path.join(cwd, MEMORY_DIR_NAME, slug);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    ensureGitignoreEntry(cwd);

    // keep logs out of version control
    const ignore = path.join(cwd, MEMORY_DIR_NAME, '.gitignore');
    if (!fs.existsSync(ignore)) {
      fs.writeFileSync(ignore, '*\n', { encoding: 'utf8', mode: 0o600 });
    }

    const logPath = path.join(dir, LOG_FILE);
    this.rotateIfNeeded(dir, logPath);
    this.pruneRetention(dir);

    // S3: Redact secrets on entry before saving to disk
    const safeEntry: MemoryTurn = {
      ...entry,
      input: redactSecrets(entry.input),
      output: redactSecrets(entry.output),
    };
    fs.appendFileSync(logPath, JSON.stringify(safeEntry) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(logPath, 0o600); } catch {}
  }

  private pruneRetention(dir: string, maxAgeDays = MEMORY_RETENTION_DAYS): void {
    try {
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 86_400_000;
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (/^log(\.\d+)?\.jsonl$/.test(f)) {
          const full = path.join(dir, f);
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.rmSync(full, { force: true });
          }
        }
      }
    } catch {}
  }

  private rotateIfNeeded(dir: string, logPath: string): void {
    let size = 0;
    try {
      size = fs.statSync(logPath).size;
    } catch {
      return;
    }
    if (size < this.maxLogBytes) return;
    // log.(n-1) -> log.n, oldest dropped, log.jsonl -> log.1.jsonl
    const rotated = (n: number) => path.join(dir, `log.${n}.jsonl`);
    try {
      fs.rmSync(rotated(this.maxRotated), { force: true });
    } catch {}
    for (let n = this.maxRotated - 1; n >= 1; n--) {
      if (fs.existsSync(rotated(n))) fs.renameSync(rotated(n), rotated(n + 1));
    }
    fs.renameSync(logPath, rotated(1));
  }

  private readLog(dir: string, maxEntries = 300): MemoryTurn[] {
    const files = [LOG_FILE];
    for (let n = 1; n <= this.maxRotated; n++) files.push(`log.${n}.jsonl`);
    const turns: MemoryTurn[] = [];
    // newest first: current log, then rotated 1,2,3
    for (const f of files) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0 && turns.length < maxEntries; i--) {
        try {
          turns.push(JSON.parse(lines[i]));
        } catch {}
      }
      if (turns.length >= maxEntries) break;
    }
    return turns.reverse();
  }

  private countExistingTurns(cwd: string, slug: string): number {
    try {
      const last = this.readLog(path.join(cwd, MEMORY_DIR_NAME, slug), 1)[0];
      return last?.turn ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * summary.md from local heuristics only (≤ SUMMARY_MAX_CHARS ≈ 500 tokens):
   * recent requests, most cited files and the tail of the last answer.
   */
  public generateSummary(cwd: string, agent: string): string | null {
    const dir = memoryDirFor(cwd, agent);
    const turns = this.readLog(dir, 300);
    if (turns.length === 0) return null;

    const clip = (t: string, n: number) => {
      const one = t.replace(/\s+/g, ' ').trim();
      return one.length > n ? one.slice(0, n - 1) + '…' : one;
    };

    // 1) recent distinct requests
    const requests: string[] = [];
    for (let i = turns.length - 1; i >= 0 && requests.length < 8; i--) {
      const q = clip(turns[i].input || '', 140);
      if (q && !requests.includes(q)) requests.push(q);
    }
    requests.reverse();

    // 2) most cited files
    const freq = new Map<string, number>();
    const pathRe = /(?:[A-Za-z]:)?[\w.\-@/\\]+\.(?:tsx?|jsx?|mjs|cjs|json|md|css|html|py|rs|go|java|cs|yml|yaml|toml|sql|sh|ps1)\b/g;
    for (const t of turns) {
      for (const m of `${t.input}\n${t.output}`.match(pathRe) || []) {
        const key = m.replace(/\\/g, '/');
        if (key.length > 90) continue;
        freq.set(key, (freq.get(key) || 0) + 1);
      }
    }
    const files = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f]) => f);

    // 3) tail of the last answer
    const last = turns[turns.length - 1];
    const tail = (last.output || '')
      .split('\n')
      .filter((l) => l.trim())
      .slice(-5)
      .map((l) => clip(l, 120));

    const build = (nReq: number, nFiles: number, nTail: number): string => {
      const lines: string[] = [
        `# Memória de ${agent}`,
        `${turns.length} turnos recentes (último: ${last.ts.slice(0, 16).replace('T', ' ')}).`,
        '',
        '## Pedidos recentes',
        ...requests.slice(-nReq).map((r) => `- ${r}`),
      ];
      if (nFiles > 0 && files.length) lines.push('', '## Arquivos citados', ...files.slice(0, nFiles).map((f) => `- ${f}`));
      if (nTail > 0 && tail.length) lines.push('', '## Último estado', ...tail.slice(-nTail).map((l) => `> ${l}`));
      lines.push('', 'Detalhes: `mindagentics recall "<termo>"`.');
      return lines.join('\n') + '\n';
    };

    let md = build(8, 8, 5);
    for (const [r, f, t] of [[6, 6, 4], [5, 5, 3], [4, 3, 2], [3, 2, 1], [2, 0, 1], [1, 0, 0]]) {
      if (md.length <= SUMMARY_MAX_CHARS) break;
      md = build(r, f, t);
    }
    if (md.length > SUMMARY_MAX_CHARS) md = md.slice(0, SUMMARY_MAX_CHARS - 2) + '…\n';

    // S4: Format summary as untrusted data so models treat it as data, not instructions
    const untrustedSummary = wrapUntrustedMemory(md, SUMMARY_MAX_CHARS);

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    const tmp = path.join(dir, `${SUMMARY_FILE}.tmp`);
    fs.writeFileSync(tmp, untrustedSummary, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch {}
    fs.renameSync(tmp, path.join(dir, SUMMARY_FILE));
    return untrustedSummary;
  }
}
