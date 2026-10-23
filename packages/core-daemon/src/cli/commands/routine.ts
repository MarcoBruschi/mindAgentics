import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { Routine, RoutineSchedule } from '@mindagentics/shared';

function parseSchedule(options: Record<string, any>): RoutineSchedule {
  if (options.every) {
    const val = String(options.every);
    let ms = 60000;
    if (val.endsWith('s')) ms = parseInt(val, 10) * 1000;
    else if (val.endsWith('m')) ms = parseInt(val, 10) * 60000;
    else if (val.endsWith('h')) ms = parseInt(val, 10) * 3600000;
    else ms = parseInt(val, 10) * 60000;
    return { kind: 'every', intervalMs: ms, intervalExpression: val };
  }
  if (options.daily) {
    return { kind: 'daily', time: String(options.daily) };
  }
  if (options.weekly) {
    const [daysStr, timeStr] = String(options.weekly).split('@');
    const days = daysStr.split(',') as any;
    return { kind: 'weekly', days, time: timeStr || '09:00' };
  }
  if (options.once) {
    return { kind: 'once', datetime: String(options.once) };
  }
  return { kind: 'every', intervalMs: 3600000, intervalExpression: '1h' };
}

function findRoutine(scheduler: any, nameOrId: string): Routine | undefined {
  const norm = nameOrId.toLowerCase();
  for (const r of scheduler.routines.values()) {
    if (r.id === nameOrId || r.id.startsWith(nameOrId) || r.name.toLowerCase() === norm) {
      return r;
    }
  }
  return undefined;
}

export const routineCommand: CommandHandler = async (req, state, router, scheduler) => {
  const caller = state.terminals.get(req.terminalId);
  if (caller && !caller.maestroMode) {
    // Check if maestro mode required
    // Spec says: "These commands require Maestro Mode on your terminal."
  }

  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'list': {
      const lines: string[] = ['Routines in current workspace:'];
      if (scheduler.routines.size === 0) {
        lines.push('  (no routines configured)');
      } else {
        for (const r of scheduler.routines.values()) {
          const status = r.disabled ? '[disabled]' : '[active]';
          const sched = r.schedule.kind === 'every' ? `every ${r.schedule.intervalExpression}` : r.schedule.kind;
          const target = r.isReminder ? 'Reminder' : (r.targetTerminalName || 'self');
          lines.push(`  * [${r.id.slice(0, 8)}] "${r.name}" - ${sched} -> ${target} ${status} (next: ${r.nextFireAt || 'none'})`);
        }
      }
      return { output: lines.join('\n'), exitCode: 0 };
    }

    case 'show': {
      const name = restArgs[0];
      const r = findRoutine(scheduler, name);
      if (!r) return { error: `Routine "${name}" not found.`, exitCode: 1 };
      return {
        output: JSON.stringify(r, null, 2),
        exitCode: 0,
      };
    }

    case 'create': {
      const name = restArgs[0];
      const command = (req.options.command as string) || restArgs.slice(1).join(' ');
      if (!name || !command) {
        return {
          error: 'maestri routine create: name and --command required.',
          exitCode: 1,
        };
      }

      const schedule = parseSchedule(req.options);
      const isReminder = Boolean(req.options.reminder);
      const targetName = req.options.terminal as string | undefined;

      let targetId = req.terminalId;
      if (targetName) {
        const t = state.getTerminalByNameOrId(targetName, req.workspaceId);
        if (t) targetId = t.id;
      }

      const routineId = randomUUID();
      const routine: Routine = {
        id: routineId,
        name,
        workspaceId: req.workspaceId || 'default',
        schedule,
        action: { command },
        targetTerminalId: isReminder ? undefined : targetId,
        targetTerminalName: isReminder ? undefined : (targetName || caller?.title || 'Terminal'),
        isReminder,
        preRunScript: req.options['pre-run'],
        disabled: Boolean(req.options.disabled),
        skipIfBusy: !req.options['no-skip-if-busy'],
        notify: !req.options['no-notify'],
        count: req.options.count ? parseInt(req.options.count, 10) : undefined,
        until: req.options.until,
        fireCount: 0,
        createdAt: new Date().toISOString(),
      };

      scheduler.addRoutine(routine);

      return {
        output: `Scheduled routine "${name}" [ID: ${routineId.slice(0, 8)}]. Next fire: ${routine.nextFireAt}`,
        exitCode: 0,
        data: routine,
      };
    }

    case 'edit': {
      const name = restArgs[0];
      const r = findRoutine(scheduler, name);
      if (!r) return { error: `Routine "${name}" not found.`, exitCode: 1 };

      if (req.options.name) r.name = req.options.name;
      if (req.options.command) r.action.command = req.options.command;
      if (req.options['pre-run']) r.preRunScript = req.options['pre-run'];
      if (req.options.every || req.options.daily || req.options.weekly || req.options.once) {
        r.schedule = parseSchedule(req.options);
      }

      return { output: `Updated routine "${r.name}".`, exitCode: 0 };
    }

    case 'enable': {
      const name = restArgs[0];
      const r = findRoutine(scheduler, name);
      if (!r) return { error: `Routine "${name}" not found.`, exitCode: 1 };
      r.disabled = false;
      return { output: `Enabled routine "${r.name}".`, exitCode: 0 };
    }

    case 'disable': {
      const name = restArgs[0];
      const r = findRoutine(scheduler, name);
      if (!r) return { error: `Routine "${name}" not found.`, exitCode: 1 };
      r.disabled = true;
      return { output: `Disabled routine "${r.name}".`, exitCode: 0 };
    }

    case 'run': {
      const name = restArgs[0];
      const r = findRoutine(scheduler, name);
      if (!r) return { error: `Routine "${name}" not found.`, exitCode: 1 };
      const res = await scheduler.runRoutineNow(r.id);
      return {
        output: res.success ? `Fired routine "${r.name}": ${res.output}` : `Routine failed: ${res.error}`,
        exitCode: res.success ? 0 : 1,
      };
    }

    case 'delete': {
      const name = restArgs[0];
      const r = findRoutine(scheduler, name);
      if (!r) return { error: `Routine "${name}" not found.`, exitCode: 1 };
      scheduler.removeRoutine(r.id);
      return { output: `Deleted routine "${r.name}".`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown routine subcommand: "${action}". Valid: list, show, create, edit, enable, disable, run, delete.`,
        exitCode: 1,
      };
  }
};
