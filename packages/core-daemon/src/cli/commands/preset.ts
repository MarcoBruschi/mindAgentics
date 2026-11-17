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
        const orchestrator = (p.orchestratorMode || p.maestroMode) ? ' [orquestrador]' : '';
        lines.push(`  * "${p.name}" (${p.agentType})${cmd}${accs}${orchestrator}`);
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
      if (!name) return { error: 'mindagentics preset create: name required.', exitCode: 1 };
      const command = (req.options.command as string) || '';
      const account = req.options.account as string | undefined;

      const newPreset = {
        id: randomUUID(),
        name,
        agentType: 'custom',
        command,
        icon: 'terminal',
        isActive: true,
        orchestratorMode: req.options.orquestrador === 'on' || req.options.orchestrator === 'on' || req.options.maestro === 'on',
        maestroMode: req.options.orquestrador === 'on' || req.options.orchestrator === 'on' || req.options.maestro === 'on',
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
      if (req.options.orquestrador !== undefined || req.options.orchestrator !== undefined || req.options.maestro !== undefined) {
        const val = req.options.orquestrador === 'on' || req.options.orchestrator === 'on' || req.options.maestro === 'on';
        const current = Boolean(p.orchestratorMode || p.maestroMode);
        if (current && !val) {
          return { error: 'Downgrade do modo orquestrador não permitido.', exitCode: 1 };
        }
        if (!current && val) {
          return { error: 'Promoção do modo orquestrador não permitida: status é imutável pós-criação.', exitCode: 1 };
        }
      }
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
