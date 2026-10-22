import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';

export const presetCommand: CommandHandler = async (req, state) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'list': {
      const lines: string[] = ['Configured Agent Presets:'];
      for (const p of state.presets.values()) {
        const accs = p.accounts && p.accounts.length > 0 ? ` (accounts: ${p.accounts.map((a: string) => `"${a}"`).join(', ')})` : '';
        const cmd = p.command ? ` [cmd: ${p.command}]` : ' [plain shell]';
        const maestro = p.maestroMode ? ' [maestro]' : '';
        lines.push(`  * "${p.name}" (${p.agentType})${cmd}${accs}${maestro}`);
      }
      return { output: lines.join('\n'), exitCode: 0 };
    }

    case 'show': {
      const name = restArgs[0];
      const p = state.presets.get(name);
      if (!p) return { error: `Preset "${name}" not found.`, exitCode: 1 };
      return {
        output: JSON.stringify(p, null, 2),
        exitCode: 0,
      };
    }

    case 'create': {
      const name = restArgs[0];
      if (!name) return { error: 'maestri preset create: name required.', exitCode: 1 };
      const command = (req.options.command as string) || '';
      const account = req.options.account as string | undefined;

      const newPreset = {
        id: randomUUID(),
        name,
        agentType: 'custom',
        command,
        icon: 'terminal',
        isActive: true,
        maestroMode: req.options.maestro === 'on',
        startInChatMode: req.options.chat === 'on',
        accounts: account ? [account] : ['Default'],
      };

      state.presets.set(name, newPreset);
      return {
        output: `Created preset "${name}" with command: "${command}"`,
        exitCode: 0,
        data: newPreset,
      };
    }

    case 'set': {
      const name = restArgs[0];
      const p = state.presets.get(name);
      if (!p) return { error: `Preset "${name}" not found.`, exitCode: 1 };

      if (req.options.name) {
        state.presets.delete(name);
        p.name = req.options.name;
        state.presets.set(p.name, p);
      }
      if (req.options.command !== undefined) p.command = req.options.command;
      if (req.options.maestro !== undefined) p.maestroMode = req.options.maestro === 'on';
      if (req.options.chat !== undefined) p.startInChatMode = req.options.chat === 'on';

      return {
        output: `Updated preset "${p.name}".`,
        exitCode: 0,
        data: p,
      };
    }

    case 'delete': {
      const name = restArgs[0];
      if (!state.presets.has(name)) return { error: `Preset "${name}" not found.`, exitCode: 1 };
      state.presets.delete(name);
      return { output: `Deleted preset "${name}".`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown preset subcommand: "${action}". Valid: list, show, create, set, delete.`,
        exitCode: 1,
      };
  }
};
