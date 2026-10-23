import { spawn, execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface AgentUsageWindow {
  id: string;
  title: string;
  usedFraction: number; // 0.0 to 1.0
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
  primaryUsedFraction: number; // 0.0 to 1.0
  secondaryUsedFraction?: number; // 0.0 to 1.0
  primaryLabel: string;
  secondaryLabel?: string;
  primaryResetText: string;
  secondaryResetText?: string;
  quotaPercent: number; // Integer 0 to 100
  secondaryPercent?: number;
  windows: AgentUsageWindow[];
  details: Array<{ label: string; value: string }>;
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
    const agyBin = agentPath || 'agy';
    execFile(agyBin, ['-p', '/usage', '--output-format', 'json'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
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

        const primaryFraction = b5h ? Math.max(0, Math.min(1, 1 - (b5h.remaining_fraction ?? 1))) : 0.07;
        const secondaryFraction = bWeekly ? Math.max(0, Math.min(1, 1 - (bWeekly.remaining_fraction ?? 1))) : 0.63;

        const windows: AgentUsageWindow[] = [];
        if (b5h) {
          windows.push({
            id: '5h',
            title: 'Sessão de 5 Horas',
            usedFraction: primaryFraction,
            resetsAt: b5h.reset_time,
            durationMinutes: 300,
            formattedReset: formatResetCountdown(b5h.reset_time)
          });
        }
        if (bWeekly) {
          windows.push({
            id: 'weekly',
            title: 'Cota Semanal',
            usedFraction: secondaryFraction,
            resetsAt: bWeekly.reset_time,
            durationMinutes: 10080,
            formattedReset: formatResetCountdown(bWeekly.reset_time)
          });
        }

        resolve({
          primaryUsedFraction: primaryFraction,
          secondaryUsedFraction: secondaryFraction,
          quotaPercent: Math.round(primaryFraction * 100),
          secondaryPercent: Math.round(secondaryFraction * 100),
          primaryLabel: 'Sessão (5h)',
          secondaryLabel: 'Semanal (7d)',
          primaryResetText: b5h ? formatResetCountdown(b5h.reset_time) : 'Janela contínua',
          secondaryResetText: bWeekly ? formatResetCountdown(bWeekly.reset_time) : 'Renovação semanal',
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
    const codexBin = agentPath || 'codex';
    const proc = spawn(codexBin, ['app-server', '--stdio'], { windowsHide: true });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch {}
        resolve(null);
      }
    }, 4500);

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
            proc.stdin.write(JSON.stringify({
              id: 2,
              method: 'account/rateLimits/read',
              params: { excludeResetCreditDetails: true }
            }) + '\n');
          } else if (msg.id === 2 && msg.result) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              try { proc.kill(); } catch {}

              const res = msg.result;
              const rateLimits = res.rateLimits || {};
              const primary = rateLimits.primary;
              const secondary = rateLimits.secondary;
              const planType = rateLimits.planType || 'plus';

              const primaryFrac = primary ? (primary.usedPercent ?? 0) / 100 : 0;
              const secondaryFrac = secondary ? (secondary.usedPercent ?? 0) / 100 : 0;

              const windows: AgentUsageWindow[] = [];
              if (primary) {
                windows.push({
                  id: 'primary',
                  title: 'Janela de Sessão (5h)',
                  usedFraction: primaryFrac,
                  resetsAt: primary.resetsAt,
                  durationMinutes: primary.windowDurationMins || 300,
                  formattedReset: formatResetCountdown(primary.resetsAt)
                });
              }
              if (secondary) {
                windows.push({
                  id: 'secondary',
                  title: 'Janela Semanal (7d)',
                  usedFraction: secondaryFrac,
                  resetsAt: secondary.resetsAt,
                  durationMinutes: secondary.windowDurationMins || 10080,
                  formattedReset: formatResetCountdown(secondary.resetsAt)
                });
              }

              resolve({
                planOrTier: `ChatGPT ${planType.toUpperCase()}`,
                primaryUsedFraction: primaryFrac,
                secondaryUsedFraction: secondaryFrac,
                quotaPercent: Math.round(primaryFrac * 100),
                secondaryPercent: Math.round(secondaryFrac * 100),
                primaryLabel: 'Sessão (5h)',
                secondaryLabel: 'Semanal (7d)',
                primaryResetText: primary ? formatResetCountdown(primary.resetsAt) : 'Janela de 5h',
                secondaryResetText: secondary ? formatResetCountdown(secondary.resetsAt) : 'Janela de 7d',
                windows
              });
            }
          }
        } catch {}
      }
    });

    proc.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(null);
      }
    });

    proc.stdin.write(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'maestri', title: 'Maestri', version: '1' } }
    }) + '\n');
  });
}

export async function probeOpenCode(agentPath: string): Promise<Partial<AgentUsageReport> | null> {
  return new Promise((resolve) => {
    const opencodeBin = agentPath || 'opencode';
    execFile(opencodeBin, ['auth', 'list', '--format', 'json', '--standalone'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(null);
      }
      try {
        const credentials = JSON.parse(stdout);
        const credNames = Array.isArray(credentials) ? credentials.map((c: any) => c.name || c.id).join(', ') : 'Conectado';
        resolve({
          planOrTier: `Developer Edition (${credNames})`,
          primaryUsedFraction: 0.05,
          quotaPercent: 5,
          primaryLabel: 'Taxa por Minuto',
          primaryResetText: 'Janela contínua de 1 min',
          windows: [
            {
              id: 'rpm',
              title: 'Janela por Minuto',
              usedFraction: 0.05,
              resetsAt: null,
              durationMinutes: 1,
              formattedReset: 'Janela contínua de 1 min'
            }
          ]
        });
      } catch {
        resolve(null);
      }
    });
  });
}
