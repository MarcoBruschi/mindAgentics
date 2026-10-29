import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { BandNode } from '@mindagentics/shared';

function findBand(state: any, nameOrId: string): BandNode | undefined {
  const norm = (nameOrId || '').toLowerCase().trim();
  if (!norm) return undefined;

  for (const node of state.nodes.values()) {
    if (node.kind === 'band') {
      const b = (node as BandNode).content;
      if (
        b.bandId?.toLowerCase() === norm ||
        b.title?.toLowerCase() === norm ||
        node.id?.toLowerCase() === norm ||
        b.title?.toLowerCase().includes(norm)
      ) {
        return node as BandNode;
      }
    }
  }
  return undefined;
}

export const bandCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'create': {
      const name = restArgs[0];
      if (!name) return { error: 'mindagentics band create: name required.', exitCode: 1 };
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

      sendToMain({
        type: 'placeNode',
        id: `place-${nodeId}`,
        payload: {
          node: bandNode,
          width: 1100,
          height: 550,
          existingNodes: Array.from(state.nodes.values()),
        },
      });

      sendToMain({
        type: 'bandCreated',
        payload: { bandId, nodeId, name, memberIds, bandNode },
      });

      return {
        output: `Created band "${name}" with ${memberIds.length} member(s).`,
        exitCode: 0,
        data: { bandId, nodeId, name, memberIds },
      };
    }

    case 'add': {
      const [bandName, agentName] = restArgs;
      if (!bandName || !agentName) {
        return { error: 'mindagentics band add: band name and agent name required.', exitCode: 1 };
      }
      const bandNode = findBand(state, bandName);
      if (!bandNode) return { error: `Band "${bandName}" not found.`, exitCode: 1 };

      const term = state.getTerminalByNameOrId(agentName, req.workspaceId);
      const targetId = term ? term.id : agentName;

      const members = bandNode.content.memberNodeIds || [];
      if (!members.includes(targetId)) {
        members.push(targetId);
        bandNode.content.memberNodeIds = members;
      }

      sendToMain({
        type: 'placeNode',
        id: `place-${bandNode.id}`,
        payload: {
          node: bandNode,
          width: bandNode.width,
          height: bandNode.height,
        },
      });

      return { output: `Added "${agentName}" to band "${bandNode.content.title}".`, exitCode: 0 };
    }

    case 'remove': {
      const [bandName, agentName] = restArgs;
      if (!bandName || !agentName) {
        return { error: 'mindagentics band remove: band name and agent name required.', exitCode: 1 };
      }
      const bandNode = findBand(state, bandName);
      if (!bandNode) return { error: `Band "${bandName}" not found.`, exitCode: 1 };

      const term = state.getTerminalByNameOrId(agentName, req.workspaceId);
      const targetId = term ? term.id : agentName;

      bandNode.content.memberNodeIds = (bandNode.content.memberNodeIds || []).filter(
        (id: string) => id !== targetId && id !== agentName
      );

      sendToMain({
        type: 'placeNode',
        id: `place-${bandNode.id}`,
        payload: {
          node: bandNode,
          width: bandNode.width,
          height: bandNode.height,
        },
      });

      return { output: `Removed "${agentName}" from band "${bandNode.content.title}".`, exitCode: 0 };
    }

    case 'dissolve': {
      const bandName = restArgs[0];
      if (!bandName) return { error: 'mindagentics band dissolve: band name required.', exitCode: 1 };
      const bandNode = findBand(state, bandName);
      if (!bandNode) return { error: `Band "${bandName}" not found.`, exitCode: 1 };

      state.nodes.delete(bandNode.id);
      state.connections = state.connections.filter(
        (c: any) => c.fromId !== bandNode.id && c.toId !== bandNode.id
      );

      sendToMain({
        type: 'deleteNode',
        id: `del-${bandNode.id}`,
        payload: {
          nodeId: bandNode.id,
        },
      });

      sendToMain({
        type: 'bandDissolved',
        payload: { bandId: bandNode.content.bandId, nodeId: bandNode.id },
      });

      return { output: `Dissolved band "${bandNode.content.title}". Members returned to free canvas.`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown band action: "${action}". Valid: create, add, remove, dissolve.`,
        exitCode: 1,
      };
  }
};
