import { spawn, execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { sanitizeLabel, hasControlChars } from '@mindagentics/shared';

// ---------------------------------------------------------------------------
// S5 — safe execution of agent CLIs for usage probes
//  * binary is resolved to an ABSOLUTE path (no cwd / relative PATH entries => no binary planting)
//  * never through a shell (execFile/spawn without `shell`), args are fixed literals
//  * hard timeouts + bounded stdout (maxBuffer) so a hostile binary cannot hang or exhaust memory
//  * child env drops mindAgentics internals; probe output is allow-listed, sanitized and truncated,
//    errors/stdout/stderr are never logged or forwarded to the UI (they may contain credentials)
// ---------------------------------------------------------------------------
const PROBE_MAX_OUTPUT_BYTES = 256 * 1024;

export function resolveProbeBinary(agentPath: string | undefined, fallbackName: string): string | null {
  const isWin = process.platform === 'win32';
  const candidate = agentPath || fallbackName;
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 4096 || hasControlChars(candidate)) {
    return null;
  }
  const isRunnable = (p: string): boolean => {
    try {
      if (!fs.statSync(p).isFile()) return false;
      // .cmd/.bat/.ps1 would require a shell => refuse instead of enabling shell injection
      return !(isWin && /\.(cmd|bat|ps1|vbs|js)$/i.test(p));
    } catch { return false; }
  };
  if (path.isAbsolute(candidate)) return isRunnable(candidate) ? candidate : null;
  if (/[\\/]/.test(candidate)) return null; // relative paths are never executed
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.COM').split(';').filter((e) => /^\.(exe|com)$/i.test(e)) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const full = path.join(dir, candidate + (isWin && !/\.(exe|com)$/i.test(candidate) ? ext : ''));
      if (isRunnable(full)) return full;
    }
  }
  return null;
}

function probeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('MINDAGENTICS_')) delete env[k];
  }
  return env;
}

const probeLabel = (v: unknown, max = 60) => sanitizeLabel(v, max);

export interface AgentUsageWindow {
  id: string;
  title: string;
  usedFraction: number | null; // 0.0 to 1.0 or null when unavailable
  resetsAt: string | number | null;
  durationMinutes?: number;
  formattedReset?: string;
}

export interface AgentUsageReport {
  id: string;
  name: string;
  command: string;
  icon: string;
  installed: boolean;
  path?: string;
  status: 'active' | 'ready' | 'offline';
  colorHex: string;
  activeModel: string;
  provider: string;
  planOrTier: string;
  primaryUsedFraction: number | null; // 0.0 to 1.0 or null
  secondaryUsedFraction?: number | null; // 0.0 to 1.0 or null
  primaryLabel: string;
  secondaryLabel?: string;
  primaryResetText: string;
  secondaryResetText?: string;
  quotaPercent: number | null; // Integer 0 to 100 or null
  secondaryPercent?: number | null;
  windows: AgentUsageWindow[];
  details: Array<{ label: string; value: string }>;
}

export function buildUsageWindows(
  primaryFraction: number | null,
  secondaryFraction: number | null,
  primaryReset?: string,
  secondaryReset?: string
): AgentUsageWindow[] {
  return [
    {
      id: 'session',
      title: 'Sessão / Diário',
      usedFraction: primaryFraction,
      resetsAt: null,
      formattedReset: primaryReset || (primaryFraction != null ? 'Janela contínua' : 'Sem dados de cota')
    },
    {
      id: 'weekly',
      title: 'Semanal (7d)',
      usedFraction: secondaryFraction,
      resetsAt: null,
      formattedReset: secondaryReset || (secondaryFraction != null ? 'Renovação semanal' : 'Sem dados de cota')
    }
  ];
}

export function formatResetCountdown(resetsAt: string | number | null | undefined): string {
  if (!resetsAt) return 'Janela contínua';

  let targetMs: number;
  if (typeof resetsAt === 'number') {
    // If epoch seconds (< 10000000000), convert to ms
    targetMs = resetsAt < 10000000000 ? resetsAt * 1000 : resetsAt;
  } else {
    targetMs = new Date(resetsAt).getTime();
  }

  if (isNaN(targetMs)) return 'Janela contínua';

  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) return 'Redefinido recentemente';

  const totalMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const days = Math.floor(hours / 24);

  if (days > 1) {
    return `Renova em ${days} dias`;
  } else if (hours > 0) {
    return `Redefine em ${hours}h ${mins}m`;
  } else {
    return `Redefine em ${Math.max(1, mins)}m`;
  }
}

export async function probeAntigravity(agentPath: string): Promise<Partial<AgentUsageReport> | null> {
  return new Promise((resolve) => {
    const agyBin = resolveProbeBinary(agentPath, 'agy');
    if (!agyBin) return resolve(null);
    execFile(agyBin, ['-p', '/usage', '--output-format', 'json'], { timeout: 8000, windowsHide: true, maxBuffer: PROBE_MAX_OUTPUT_BYTES, killSignal: 'SIGKILL', env: probeEnv(), shell: false }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(null);
      }
      try {
        const json = JSON.parse(stdout);
        const groups = json?.command?.data?.groups || [];
        const geminiGroup = groups.find((g: any) => g.name?.includes('Gemini')) || groups[0];
        if (!geminiGroup || !geminiGroup.buckets) {
          return resolve(null);
        }

        const b5h = geminiGroup.buckets.find((b: any) => b.window === '5h' || b.id?.includes('5h'));
        const bWeekly = geminiGroup.buckets.find((b: any) => b.window === 'weekly' || b.id?.includes('weekly'));

        const primaryFraction = b5h && b5h.remaining_fraction !== undefined && b5h.remaining_fraction !== null
          ? Math.max(0, Math.min(1, 1 - b5h.remaining_fraction))
          : null;
        const secondaryFraction = bWeekly && bWeekly.remaining_fraction !== undefined && bWeekly.remaining_fraction !== null
          ? Math.max(0, Math.min(1, 1 - bWeekly.remaining_fraction))
          : null;

        const primaryReset = b5h ? formatResetCountdown(b5h.reset_time) : (primaryFraction != null ? 'Janela contínua' : 'Sem dados de cota');
        const secondaryReset = bWeekly ? formatResetCountdown(bWeekly.reset_time) : (secondaryFraction != null ? 'Renovação semanal' : 'Sem dados de cota');

        const windows = buildUsageWindows(primaryFraction, secondaryFraction, primaryReset, secondaryReset);
        if (b5h && windows[0]) {
          windows[0].resetsAt = b5h.reset_time;
          windows[0].durationMinutes = 300;
        }
        if (bWeekly && windows[1]) {
          windows[1].resetsAt = bWeekly.reset_time;
          windows[1].durationMinutes = 10080;
        }

        resolve({
          primaryUsedFraction: primaryFraction,
          secondaryUsedFraction: secondaryFraction,
          quotaPercent: primaryFraction != null ? Math.round(primaryFraction * 100) : null,
          secondaryPercent: secondaryFraction != null ? Math.round(secondaryFraction * 100) : null,
          primaryLabel: 'Sessão (5h)',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: primaryReset,
          secondaryResetText: secondaryReset,
          windows
        });
      } catch {
        resolve(null);
      }
    });
  });
}

export async function probeCodex(agentPath: string): Promise<Partial<AgentUsageReport> | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const codexBin = resolveProbeBinary(agentPath, 'codex');
    if (!codexBin) return resolve(null);
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(codexBin, ['app-server', '--stdio'], { windowsHide: true, shell: false, env: probeEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    const finish = (value: Partial<AgentUsageReport> | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill('SIGKILL'); } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), 4500);

    let buffer = '';
    proc.stdout!.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > PROBE_MAX_OUTPUT_BYTES) return finish(null);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            proc.stdin!.write(JSON.stringify({ method: 'initialized' }) + '\n');
            proc.stdin!.write(JSON.stringify({
              id: 2,
              method: 'account/rateLimits/read',
              params: { excludeResetCreditDetails: true }
            }) + '\n');
          } else if (msg.id === 2 && msg.result) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              try { proc.kill('SIGKILL'); } catch {}

              const res = msg.result;
              const rateLimits = res.rateLimits || {};
              const primary = rateLimits.primary;
              const secondary = rateLimits.secondary;
              const planType = probeLabel(rateLimits.planType || 'plus', 20);

              const primaryFrac = primary && primary.usedPercent !== undefined && primary.usedPercent !== null
                ? primary.usedPercent / 100
                : null;
              const secondaryFrac = secondary && secondary.usedPercent !== undefined && secondary.usedPercent !== null
                ? secondary.usedPercent / 100
                : null;

              const primaryReset = primary ? formatResetCountdown(primary.resetsAt) : (primaryFrac != null ? 'Janela de 5h' : 'Sem dados de cota');
              const secondaryReset = secondary ? formatResetCountdown(secondary.resetsAt) : (secondaryFrac != null ? 'Janela de 7d' : 'Sem dados de cota');

              const windows = buildUsageWindows(primaryFrac, secondaryFrac, primaryReset, secondaryReset);
              if (primary && windows[0]) {
                windows[0].resetsAt = primary.resetsAt;
                windows[0].durationMinutes = primary.windowDurationMins || 300;
              }
              if (secondary && windows[1]) {
                windows[1].resetsAt = secondary.resetsAt;
                windows[1].durationMinutes = secondary.windowDurationMins || 10080;
              }

              resolve({
                planOrTier: `ChatGPT ${planType.toUpperCase()}`,
                primaryUsedFraction: primaryFrac,
                secondaryUsedFraction: secondaryFrac,
                quotaPercent: primaryFrac != null ? Math.round(primaryFrac * 100) : null,
                secondaryPercent: secondaryFrac != null ? Math.round(secondaryFrac * 100) : null,
                primaryLabel: 'Sessão (5h)',
                secondaryLabel: 'Semanal (7d)',
                primaryResetText: primaryReset,
                secondaryResetText: secondaryReset,
                windows
              });
            }
          }
        } catch {}
      }
    });

    proc.on('error', () => finish(null));
    proc.on('close', () => finish(null));
    proc.stdin!.on('error', () => finish(null));

    proc.stdin!.write(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'mindagentics', title: 'mindAgentics', version: '1' } }
    }) + '\n');
  });
}

export async function probeOpenCode(agentPath: string): Promise<Partial<AgentUsageReport> | null> {
  return new Promise((resolve) => {
    const opencodeBin = resolveProbeBinary(agentPath, 'opencode');
    if (!opencodeBin) {
      return resolve({
        planOrTier: 'Developer Edition',
        primaryUsedFraction: null,
        secondaryUsedFraction: null,
        quotaPercent: null,
        secondaryPercent: null,
        primaryLabel: 'Sessão / Diário',
        secondaryLabel: 'Semanal (7d)',
        primaryResetText: 'Sem dados de cota',
        secondaryResetText: 'Sem dados de cota',
        windows: buildUsageWindows(null, null)
      });
    }
    execFile(opencodeBin, ['auth', 'list', '--format', 'json', '--standalone'], { timeout: 4000, windowsHide: true, maxBuffer: PROBE_MAX_OUTPUT_BYTES, killSignal: 'SIGKILL', env: probeEnv(), shell: false }, (err, stdout) => {
      let credNames = 'Conectado';
      if (!err && stdout) {
        try {
          const credentials = JSON.parse(stdout);
          // Only provider NAMES (allow-listed field, sanitized, max 5) ever reach the UI — never keys/tokens from the CLI output.
          credNames = Array.isArray(credentials)
            ? credentials.slice(0, 5).map((c: any) => probeLabel(c?.name ?? c?.id, 30)).filter(Boolean).join(', ') || 'Conectado'
            : 'Conectado';
        } catch {}
      }
      resolve({
        planOrTier: `Developer Edition (${credNames})`,
        primaryUsedFraction: null,
        secondaryUsedFraction: null,
        quotaPercent: null,
        secondaryPercent: null,
        primaryLabel: 'Sessão / Diário',
        secondaryLabel: 'Semanal (7d)',
        primaryResetText: 'Sem dados de cota',
        secondaryResetText: 'Sem dados de cota',
        windows: buildUsageWindows(null, null)
      });
    });
  });
}

export async function probeClaude(_agentPath?: string): Promise<Partial<AgentUsageReport> | null> {
  return Promise.resolve({
    planOrTier: 'Anthropic Claude Code',
    primaryUsedFraction: null,
    secondaryUsedFraction: null,
    quotaPercent: null,
    secondaryPercent: null,
    primaryLabel: 'Sessão / Diário',
    secondaryLabel: 'Semanal (7d)',
    primaryResetText: 'Sem dados de cota',
    secondaryResetText: 'Sem dados de cota',
    windows: buildUsageWindows(null, null)
  });
}

export async function probeCopilot(_agentPath?: string): Promise<Partial<AgentUsageReport> | null> {
  return Promise.resolve({
    planOrTier: 'Copilot Pro / Business',
    primaryUsedFraction: null,
    secondaryUsedFraction: null,
    quotaPercent: null,
    secondaryPercent: null,
    primaryLabel: 'Sessão / Diário',
    secondaryLabel: 'Semanal (7d)',
    primaryResetText: 'Sem dados de cota',
    secondaryResetText: 'Sem dados de cota',
    windows: buildUsageWindows(null, null)
  });
}

// ---------------------------------------------------------------------------
// Agent Models List & Queries
// ---------------------------------------------------------------------------

export interface AgentModelOption {
  id: string;
  label: string;
}

export const FALLBACK_AGENT_MODELS: Record<string, AgentModelOption[]> = {
  antigravity: [
    { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
    { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ],
  claude: [
    { id: 'sonnet', label: 'Claude Sonnet' },
    { id: 'opus', label: 'Claude Opus' },
    { id: 'haiku', label: 'Claude Haiku' },
  ],
  codex: [
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'o3', label: 'o3' },
    { id: 'o4-mini', label: 'o4-mini' },
  ],
  opencode: [
    { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
    { id: 'anthropic/claude-opus-4-5', label: 'anthropic/claude-opus-4-5' },
    { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
  ],
  ollama: [
    { id: 'llama3', label: 'Llama 3' },
    { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder' },
    { id: 'deepseek-r1', label: 'DeepSeek R1' },
  ],
};

export async function queryAntigravityModels(agentPath?: string): Promise<AgentModelOption[]> {
  const agyBin = resolveProbeBinary(agentPath, 'agy');
  if (!agyBin) {
    return FALLBACK_AGENT_MODELS.antigravity;
  }
  return new Promise((resolve) => {
    execFile(
      agyBin,
      ['models'],
      { timeout: 4000, windowsHide: true, maxBuffer: PROBE_MAX_OUTPUT_BYTES, killSignal: 'SIGKILL', env: probeEnv(), shell: false },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve(FALLBACK_AGENT_MODELS.antigravity);
        }
        try {
          const lines = stdout.split(/\r?\n/);
          const models: AgentModelOption[] = [];
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('Fetching')) continue;
            if (line.includes('\t')) {
              const parts = line.split('\t');
              const id = parts[0]?.trim();
              const label = parts[1]?.trim() || id;
              if (id) {
                models.push({ id, label });
              }
            }
          }
          if (models.length > 0) {
            return resolve(models);
          }
        } catch {}
        resolve(FALLBACK_AGENT_MODELS.antigravity);
      }
    );
  });
}

export async function queryOllamaModels(agentPath?: string): Promise<AgentModelOption[]> {
  const ollamaBin = resolveProbeBinary(agentPath, 'ollama');
  if (!ollamaBin) {
    return FALLBACK_AGENT_MODELS.ollama;
  }
  return new Promise((resolve) => {
    execFile(
      ollamaBin,
      ['list'],
      { timeout: 4000, windowsHide: true, maxBuffer: PROBE_MAX_OUTPUT_BYTES, killSignal: 'SIGKILL', env: probeEnv(), shell: false },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve(FALLBACK_AGENT_MODELS.ollama);
        }
        try {
          const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          const models: AgentModelOption[] = [];
          // Skip header line (NAME ID SIZE MODIFIED)
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(/\s+/);
            const name = parts[0];
            if (name) {
              models.push({ id: name, label: name });
            }
          }
          if (models.length > 0) {
            return resolve(models);
          }
        } catch {}
        resolve(FALLBACK_AGENT_MODELS.ollama);
      }
    );
  });
}
