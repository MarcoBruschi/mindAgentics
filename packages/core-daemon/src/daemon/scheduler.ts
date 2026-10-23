/**
 * Routine Chrono Engine
 * Section 3.2 & 5.3 of CLONE_SPEC.md
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { DaemonState } from './state.js';
import type { Routine, RoutineSchedule } from '@mindagentics/shared';

const execAsync = promisify(exec);

export class RoutineScheduler {
  private timer: NodeJS.Timeout | null = null;
  public routines: Map<string, Routine> = new Map();

  constructor(
    private state: DaemonState,
    private sendToMain: (frame: { type: string; id?: string; payload: any }) => void,
  ) {}

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick();
    }, 10000); // Check every 10 seconds
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public addRoutine(routine: Routine) {
    this.calculateNextFire(routine);
    this.routines.set(routine.id, routine);
  }

  public removeRoutine(routineId: string) {
    this.routines.delete(routineId);
  }

  public async runRoutineNow(routineId: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const routine = this.routines.get(routineId);
    if (!routine) throw new Error(`Routine with id ${routineId} not found.`);
    return this.executeRoutine(routine);
  }

  private async tick() {
    const now = new Date();
    for (const routine of this.routines.values()) {
      if (routine.disabled) continue;
      if (routine.until && new Date(routine.until) <= now) {
        routine.disabled = true;
        continue;
      }
      if (routine.count && routine.fireCount >= routine.count) {
        routine.disabled = true;
        continue;
      }

      if (routine.nextFireAt && new Date(routine.nextFireAt) <= now) {
        await this.executeRoutine(routine);
        routine.fireCount++;
        routine.lastFiredAt = now.toISOString();
        this.calculateNextFire(routine);
      }
    }
  }

  private calculateNextFire(routine: Routine) {
    const now = new Date();
    const sched = routine.schedule;

    if (sched.kind === 'every') {
      routine.nextFireAt = new Date(now.getTime() + sched.intervalMs).toISOString();
    } else if (sched.kind === 'daily') {
      const [hours, minutes] = sched.time.split(':').map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      routine.nextFireAt = next.toISOString();
    } else if (sched.kind === 'weekly') {
      const dayMap: Record<string, number> = {
        sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      };
      const [hours, minutes] = sched.time.split(':').map(Number);
      let closest: Date | null = null;
      for (const day of sched.days) {
        const targetDay = dayMap[day.toLowerCase()];
        const cand = new Date(now);
        cand.setHours(hours, minutes, 0, 0);
        const diff = (targetDay - now.getDay() + 7) % 7;
        cand.setDate(now.getDate() + diff);
        if (cand <= now) {
          cand.setDate(cand.getDate() + 7);
        }
        if (!closest || cand < closest) {
          closest = cand;
        }
      }
      routine.nextFireAt = (closest ?? now).toISOString();
    } else if (sched.kind === 'once') {
      routine.nextFireAt = new Date(sched.datetime).toISOString();
    }
  }

  public async executeRoutine(routine: Routine): Promise<{ success: boolean; output?: string; error?: string }> {
    let scriptOutput = '';

    // 1. Pre-run script pipeline
    if (routine.preRunScript) {
      try {
        const ws = this.state.workspaces.get(routine.workspaceId);
        const cwd = ws ? ws.workingDirectory : process.cwd();
        const { stdout } = await execAsync(routine.preRunScript, {
          cwd,
          env: {
            ...process.env,
            MINDAGENTICS_ROUTINE_NAME: routine.name,
            MINDAGENTICS_WORKSPACE_DIR: cwd,
          },
        });
        scriptOutput = stdout.trim();
      } catch (err: any) {
        return {
          success: false,
          error: `Pre-run script failed: ${err.message}`,
        };
      }
    }

    // 2. Command template replacement
    let finalCommand = routine.action.command;
    if (finalCommand.includes('{{output}}')) {
      finalCommand = finalCommand.replace(/\{\{output\}\}/g, scriptOutput);
    }

    // 3. Dispatch
    if (routine.isReminder) {
      this.sendToMain({
        type: 'maestroAttention',
        payload: {
          terminalId: routine.targetTerminalId || 'global',
          title: `Routine Reminder: ${routine.name}`,
          message: finalCommand,
          level: 'info',
        },
      });
      return { success: true, output: `Reminder posted: ${finalCommand}` };
    }

    if (routine.targetTerminalId) {
      const targetTerm = this.state.terminals.get(routine.targetTerminalId);
      if (routine.skipIfBusy && targetTerm?.status === 'working') {
        return { success: false, error: 'Target terminal is busy, skipped.' };
      }

      this.sendToMain({
        type: 'deliverPrompt',
        payload: {
          terminalId: routine.targetTerminalId,
          prompt: finalCommand,
        },
      });
    }

    return { success: true, output: finalCommand };
  }
}
