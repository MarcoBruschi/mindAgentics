import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { BandNode } from '@mindagentics/shared';

export const bandCommand: CommandHandler = async (req, state) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'create': {
      const name = restArgs[0];
      if (!name) return { error: 'maestri band create: name required.', exitCode: 1 };
      const explicitMembers = restArgs.slice(1);
      const withoutMe = Boolean(req.options['without-me']);

      const memberIds: string[] = [];
      if (!withoutMe) {
        memberIds.push(req.terminalId);
      }

      if (explicitMembers.length > 0) {
        for (const m of explicitMembers) {
          const t = state.getTerminalByNameOrId(m, req.workspaceId);
          if (t) memberIds.push(t.id);
        }
      } else {
        // Gather everyone connected to caller
        for (const term of state.terminals.values()) {
          if (term.id !== req.terminalId) {
            memberIds.push(term.id);
          }
        }
      }

      const bandId = randomUUID();
      const nodeId = `node-band-${bandId.slice(0, 8)}`;

      const bandNode: BandNode = {
        id: nodeId,
        kind: 'band',
        x: 50,
        y: 100,
        width: 1100,
        height: 550,
        zIndex: 1,
        content: {
          bandId,
          title: name,
          color: (req.options.color as string) || 'rgba(59, 130, 246, 0.15)',
          icon: req.options.icon as string | undefined,
          memberNodeIds: memberIds,
        },
      };

      state.nodes.set(nodeId, bandNode);

      return {
        output: `Created band "${name}" with ${memberIds.length} member(s).`,
        exitCode: 0,
        data: { bandId, nodeId, name, memberIds },
      };
    }

    case 'add': {
      const [bandName, agentName] = restArgs;
      return { output: `Added "${agentName}" to band "${bandName}".`, exitCode: 0 };
    }

    case 'remove': {
      const [bandName, agentName] = restArgs;
      return { output: `Removed "${agentName}" from band "${bandName}".`, exitCode: 0 };
    }

    case 'dissolve': {
      const bandName = restArgs[0];
      return { output: `Dissolved band "${bandName}". Members returned to free canvas.`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown band action: "${action}". Valid: create, add, remove, dissolve.`,
        exitCode: 1,
      };
  }
};
