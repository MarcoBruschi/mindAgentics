import type { CommandHandler } from '../../daemon/pipeServer.js';

export const roleCommand: CommandHandler = async (req, state) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'list': {
      const globalRoles: string[] = [];
      const wsRoles: string[] = [];

      for (const r of state.roles.values()) {
        const preview = r.prompt.slice(0, 70) + (r.prompt.length > 70 ? '...' : '');
        const entry = `  * "${r.name}": "${preview}"`;
        if (r.scope === 'global') {
          globalRoles.push(entry);
        } else {
          wsRoles.push(entry);
        }
      }

      const lines: string[] = [
        'Current Workspace Roles:',
        ...(wsRoles.length ? wsRoles : ['  (none)']),
        '',
        'Global Roles:',
        ...(globalRoles.length ? globalRoles : ['  (none)']),
      ];

      return { output: lines.join('\n'), exitCode: 0 };
    }

    case 'show': {
      const name = restArgs[0];
      const r = state.roles.get(name);
      if (!r) return { error: `Role "${name}" not found.`, exitCode: 1 };
      return {
        output: `Role: "${r.name}" [scope: ${r.scope}]\n\nPrompt:\n${r.prompt}`,
        exitCode: 0,
      };
    }

    case 'create': {
      const name = restArgs[0];
      const prompt = restArgs.slice(1).join(' ') || (req.options.prompt as string);
      const scope = (req.options.scope as 'current' | 'global') || 'current';

      if (!name || !prompt) {
        return {
          error: 'mindagentics role create: name and prompt required. Usage: mindagentics role create "Name" "Prompt" [--scope current|global]',
          exitCode: 1,
        };
      }

      state.roles.set(name, {
        name,
        prompt,
        scope,
        workspaceId: req.workspaceId,
      });

      return {
        output: `Created role "${name}" [scope: ${scope}].`,
        exitCode: 0,
      };
    }

    case 'edit': {
      const name = restArgs[0];
      const oldText = restArgs[1];
      const newText = restArgs[2] ?? '';

      const r = state.roles.get(name);
      if (!r) return { error: `Role "${name}" not found.`, exitCode: 1 };

      if (req.options.scope) {
        r.scope = req.options.scope as 'current' | 'global';
      }

      if (oldText !== undefined) {
        if (!r.prompt.includes(oldText)) {
          return { error: `Substring not found in prompt of role "${name}".`, exitCode: 1 };
        }
        r.prompt = r.prompt.replace(oldText, newText);
      }

      return {
        output: `Updated role "${name}".`,
        exitCode: 0,
      };
    }

    case 'write': {
      const name = restArgs[0];
      const newPrompt = restArgs.slice(1).join(' ');
      const r = state.roles.get(name);
      if (!r) return { error: `Role "${name}" not found.`, exitCode: 1 };
      r.prompt = newPrompt;
      return { output: `Updated prompt for role "${name}".`, exitCode: 0 };
    }

    case 'assign': {
      const recruitName = restArgs[0];
      const roleName = restArgs[1];
      const isNone = Boolean(req.options.none || roleName === '--none');

      const target = state.getTerminalByNameOrId(recruitName, req.workspaceId);
      if (!target) return { error: `Recruit "${recruitName}" not found.`, exitCode: 1 };

      if (isNone) {
        target.agentRole = undefined;
        return { output: `Cleared role on recruit "${target.title}".`, exitCode: 0 };
      }

      if (!roleName) return { error: 'mindagentics role assign: role name required.', exitCode: 1 };
      const r = state.roles.get(roleName);
      if (!r) return { error: `Role "${roleName}" not found.`, exitCode: 1 };

      target.agentRole = roleName;
      return { output: `Assigned role "${roleName}" to recruit "${target.title}". Process restarted.`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown role action: "${action}". Valid: list, show, create, edit, write, assign.`,
        exitCode: 1,
      };
  }
};
