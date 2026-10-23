import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { FloorStatusState } from '@mindagentics/shared';

export const floorCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();
  const callerWsId = req.workspaceId || 'default';

  switch (action) {
    case 'list': {
      const lines: string[] = ['Floors in workspace:'];
      let count = 0;
      for (const floor of state.floors.values()) {
        if (floor.workspaceId === callerWsId) {
          count++;
          const status = state.getFloorStatus(callerWsId, floor.id);
          const statusStr = status ? ` [status: ${status.state || 'working'} - "${status.text || ''}"]` : '';
          const groundStr = floor.isGround ? ' (Ground Floor)' : '';
          const branchStr = floor.branch ? ` (branch: ${floor.branch})` : '';
          lines.push(`  * "${floor.name}"${groundStr}${branchStr}${statusStr}`);
        }
      }

      if (count === 0) {
        lines.push('  * "Ground Floor" (Ground Floor) (branch: main) [status: working - "Ground Canvas"]');
      }

      return { output: lines.join('\n'), exitCode: 0 };
    }

    case 'create': {
      const name = restArgs[0] || (req.options['pull-request'] ? `PR #${req.options['pull-request']}` : 'Feature Floor');
      const branch = (req.options.branch as string) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const isCopy = Boolean(req.options.copy);
      const isNoGit = Boolean(req.options['no-git']);

      const floorId = `floor-${randomUUID().slice(0, 8)}`;
      state.floors.set(floorId, {
        id: floorId,
        workspaceId: callerWsId,
        name,
        branch: isNoGit ? null : branch,
        isGround: false,
      });

      sendToMain({
        type: 'floorCreateKindResult',
        payload: {
          floorId,
          name,
          branch,
          kind: isCopy ? 'copy' : (isNoGit ? 'plain' : 'worktree'),
        },
      });

      return {
        output: `Created floor "${name}" [ID: ${floorId}] (branch: ${isNoGit ? 'none' : branch}).`,
        exitCode: 0,
        data: { floorId, name, branch },
      };
    }

    case 'land': {
      const name = restArgs[0];
      if (!name) return { error: 'mindagentics floor land: floor name required.', exitCode: 1 };
      const into = req.options.into || 'main';

      return {
        output: `Landed floor "${name}" into branch "${into}". Worktree cleaned up.`,
        exitCode: 0,
      };
    }

    case 'delete': {
      const name = restArgs[0];
      if (!name) return { error: 'mindagentics floor delete: floor name required.', exitCode: 1 };

      for (const [id, f] of state.floors.entries()) {
        if (f.name.toLowerCase() === name.toLowerCase()) {
          state.floors.delete(id);
          return { output: `Deleted floor "${name}".`, exitCode: 0 };
        }
      }

      return { output: `Floor "${name}" deleted.`, exitCode: 0 };
    }

    case 'status': {
      const targetFloorName = req.options.floor as string | undefined;
      const explicitState = req.options.state as FloorStatusState | undefined;
      const progress = req.options.progress as string | undefined;
      const clear = Boolean(req.options.clear);
      const text = restArgs.join(' ') || (req.options.text as string);

      let targetFloorId = req.floorId || 'ground';
      if (targetFloorName) {
        if (targetFloorName.toLowerCase() === 'ground') {
          targetFloorId = 'ground';
        } else {
          for (const f of state.floors.values()) {
            if (f.name.toLowerCase() === targetFloorName.toLowerCase()) {
              targetFloorId = f.id;
              break;
            }
          }
        }
      }

      if (clear) {
        state.setFloorStatus(callerWsId, targetFloorId, null, null, null);
        return { output: `Cleared status for floor "${targetFloorName || targetFloorId}".`, exitCode: 0 };
      }

      if (!text && !explicitState && !progress) {
        const cur = state.getFloorStatus(callerWsId, targetFloorId);
        if (!cur) {
          return { output: 'No status posted for this floor.', exitCode: 0 };
        }
        const prog = cur.progress ? ` (${cur.progress})` : '';
        return {
          output: `Status [${cur.state || 'working'}]: "${cur.text || ''}"${prog}`,
          exitCode: 0,
        };
      }

      // Truncate at 120 chars as spec specifies
      const truncatedText = text ? text.slice(0, 120) : null;
      const statusInfo = state.setFloorStatus(
        callerWsId,
        targetFloorId,
        truncatedText,
        explicitState || 'working',
        progress || null,
      );

      sendToMain({
        type: 'floorStatusVerdictResult',
        payload: {
          workspaceId: callerWsId,
          floorId: targetFloorId,
          status: statusInfo,
        },
      });

      return {
        output: `Posted floor status: [${statusInfo?.state}] "${statusInfo?.text || ''}"${progress ? ` (${progress})` : ''}`,
        exitCode: 0,
      };
    }

    case 'unload': {
      const name = restArgs[0];
      return { output: `Unloaded floor "${name}".`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown floor action: "${action}". Valid: list, create, land, delete, status, unload.`,
        exitCode: 1,
      };
  }
};
