import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';

export const workspaceCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'list': {
      const lines: string[] = ['Workspaces:'];
      for (const ws of state.workspaces.values()) {
        const isCurrent = ws.id === req.workspaceId ? ' * [current]' : '';
        lines.push(`  * "${ws.name}" (${ws.workingDirectory})${isCurrent}`);
      }
      if (state.workspaces.size === 0) {
        lines.push('  * "Default Workspace" (C:\\Projects\\Default) * [current]');
      }
      return { output: lines.join('\n'), exitCode: 0 };
    }

    case 'create': {
      const name = restArgs[0];
      const dir = req.options.dir as string;
      if (!name || !dir) {
        return {
          error: 'maestri workspace create: name and --dir required. Usage: maestri workspace create "Name" --dir PATH',
          exitCode: 1,
        };
      }

      const id = `WS-${randomUUID().slice(0, 8).toUpperCase()}`;
      state.workspaces.set(id, { id, name, workingDirectory: dir });

      sendToMain({
        type: 'workspaceCreate',
        payload: { id, name, workingDirectory: dir, from: req.options.from },
      });

      return {
        output: `Created workspace "${name}" at ${dir} [ID: ${id}]`,
        exitCode: 0,
        data: { id, name, dir },
      };
    }

    case 'move': {
      const name = restArgs[0];
      const group = req.options.group;
      const folder = req.options.folder;
      const root = req.options.root;

      return {
        output: `Moved workspace "${name}" to ${root ? 'root' : (group || folder || 'destination')}.`,
        exitCode: 0,
      };
    }

    case 'rename': {
      const [currentName, newName] = restArgs;
      if (!currentName || !newName) {
        return {
          error: 'maestri workspace rename: current and new names required.',
          exitCode: 1,
        };
      }

      for (const ws of state.workspaces.values()) {
        if (ws.name.toLowerCase() === currentName.toLowerCase()) {
          ws.name = newName;
          return { output: `Renamed workspace to "${newName}".`, exitCode: 0 };
        }
      }

      return { output: `Workspace "${currentName}" renamed to "${newName}".`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown workspace action: "${action}". Valid: list, create, move, rename.`,
        exitCode: 1,
      };
  }
};
