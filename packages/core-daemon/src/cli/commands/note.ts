import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { NoteNode, NoteContent, NoteColor, NoteStackNode } from '@mindagentics/shared';
import { placeNode } from '../../daemon/spatial.js';

function findNote(state: any, nameOrId: string): NoteNode | undefined {
  const norm = (nameOrId || '').toLowerCase().trim();
  if (!norm) return undefined;

  // 1. Exact match
  for (const node of state.nodes.values()) {
    if (node.kind === 'note') {
      const n = (node as NoteNode).content;
      if (
        n.noteId?.toLowerCase() === norm ||
        n.title?.toLowerCase() === norm ||
        node.id?.toLowerCase() === norm
      ) {
        return node as NoteNode;
      }
    }
  }

  // 2. Partial match
  for (const node of state.nodes.values()) {
    if (node.kind === 'note') {
      const n = (node as NoteNode).content;
      const t = (n.title || '').toLowerCase();
      if (t.includes(norm) || norm.includes(t)) {
        return node as NoteNode;
      }
    }
  }
  return undefined;
}

export const noteCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'create': {
      let content = req.options.content || '';
      if (!content && restArgs.length > 0 && !restArgs[0].startsWith('-')) {
        content = restArgs.join(' ');
      }

      const explicitName = req.options.name as string | undefined;
      const stack = req.options.stack as string | undefined;
      const color = (req.options.color as NoteColor) || 'yellow';

      let title: string = explicitName || '';
      if (!title) {
        const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
        title = firstLine || `Note-${randomUUID().slice(0, 6)}`;
      }

      const noteId = randomUUID();
      const nodeId = `node-note-${noteId.slice(0, 8)}`;

      // Find caller terminal canvas node ID
      let callerNodeId: string | undefined;
      for (const [nid, n] of state.nodes.entries()) {
        if (n.kind === 'terminal' && (n.content?.terminalId === req.terminalId || n.id === req.terminalId)) {
          callerNodeId = n.id;
          break;
        }
      }
      if (!callerNodeId) callerNodeId = req.terminalId;

      // Calculate spatial placement without overlapping existing nodes
      const coords = placeNode({
        width: 320,
        height: 280,
        existingNodes: Array.from(state.nodes.values()),
        anchorNodeId: callerNodeId,
        placementDirection: 'right',
      });

      const noteNode: NoteNode = {
        id: nodeId,
        kind: 'note',
        x: coords.x,
        y: coords.y,
        width: 320,
        height: 280,
        zIndex: 10,
        content: {
          noteId,
          title,
          isNamePinned: Boolean(explicitName),
          color,
          stackId: stack || null,
          text: content,
          body: content,
          locked: false,
        },
      };

      state.nodes.set(nodeId, noteNode);

      // Connect note to caller terminal with Cable Tie
      if (callerNodeId) {
        state.connections.push({
          fromId: callerNodeId,
          toId: nodeId,
          label: 'Connected Note',
        });

        sendToMain({
          type: 'cableTieCreated',
          id: `tie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          payload: {
            fromNodeId: callerNodeId,
            toNodeId: nodeId,
            label: 'Connected Note',
          },
        });
      }

      // Notify Main to place node on Canvas
      sendToMain({
        type: 'placeNode',
        id: `place-${nodeId}`,
        payload: {
          node: noteNode,
          width: 320,
          height: 280,
          existingNodes: Array.from(state.nodes.values()),
          anchorNodeId: callerNodeId,
          placementDirection: 'right',
        },
      });

      // If a stack/fichário name was requested, manage the NoteStackNode on canvas
      if (stack) {
        let stackNode = Array.from(state.nodes.values()).find(
          (n: any) =>
            n.kind === 'noteStack' &&
            (n.content?.title?.toLowerCase() === stack.toLowerCase() ||
              n.content?.stackId?.toLowerCase() === stack.toLowerCase())
        ) as NoteStackNode | undefined;

        if (!stackNode) {
          const stackCoords = placeNode({
            width: 380,
            height: 340,
            existingNodes: Array.from(state.nodes.values()),
            anchorNodeId: callerNodeId,
            placementDirection: 'right',
          });
          const stackId = `stack-${Date.now()}`;
          stackNode = {
            id: `node-stack-${stackId.slice(0, 8)}`,
            kind: 'noteStack',
            x: stackCoords.x,
            y: stackCoords.y,
            width: 380,
            height: 340,
            zIndex: 11,
            content: {
              stackId,
              title: stack,
              noteIds: [noteId],
              activePageIndex: 0,
              tabOrientation: 'side',
              pages: [
                {
                  id: noteId,
                  title,
                  body: content,
                  color,
                },
              ],
            },
          };
          state.nodes.set(stackNode.id, stackNode);
        } else {
          const pages = stackNode.content.pages || [];
          if (!pages.some((p: any) => p.id === noteId || p.title === title)) {
            pages.push({ id: noteId, title, body: content, color });
            stackNode.content.pages = pages;
            stackNode.content.noteIds = pages.map((p: any) => p.id);
          }
        }

        sendToMain({
          type: 'placeNode',
          id: `place-${stackNode.id}`,
          payload: {
            node: stackNode,
            width: 380,
            height: 340,
            existingNodes: Array.from(state.nodes.values()),
            anchorNodeId: callerNodeId,
            placementDirection: 'right',
          },
        });

        if (callerNodeId) {
          state.connections.push({
            fromId: callerNodeId,
            toId: stackNode.id,
            label: 'Connected Fichário',
          });
          sendToMain({
            type: 'cableTieCreated',
            id: `tie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            payload: {
              fromNodeId: callerNodeId,
              toNodeId: stackNode.id,
              label: 'Connected Fichário',
            },
          });
        }
      }

      return {
        output: `Created note "${title}" (ID: ${noteId.slice(0, 8)}) [color: ${color}]${stack ? ` in stack "${stack}"` : ''}. Placed and connected on canvas.`,
        exitCode: 0,
        data: { title, noteId, nodeId },
      };
    }

    case 'read': {
      const noteName = restArgs[0];
      if (!noteName) {
        return {
          error: 'mindagentics note read: note name required. Usage: mindagentics note read "Note Name" [startLine] [count]',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found. Run "mindagentics list" to see connected notes.`,
          exitCode: 1,
        };
      }

      const text = note.content.body !== undefined ? note.content.body : (note.content.text || '');
      const lines = text.split('\n');
      const startLine = restArgs[1] ? parseInt(restArgs[1], 10) : 1;
      const count = restArgs[2] ? parseInt(restArgs[2], 10) : lines.length;

      const sliceStart = Math.max(0, startLine - 1);
      const sliceEnd = sliceStart + count;
      const outputLines = lines.slice(sliceStart, sliceEnd).map((l, idx) => {
        const lineNum = sliceStart + idx + 1;
        return `${lineNum.toString().padStart(4, ' ')} | ${l}`;
      });

      return {
        output: outputLines.join('\n'),
        exitCode: 0,
      };
    }

    case 'write': {
      const noteName = restArgs[0];
      const newContent = restArgs.slice(1).join(' ') || (req.options.content as string) || '';

      if (!noteName) {
        return {
          error: 'mindagentics note write: note name required. Usage: mindagentics note write "Note Name" "content"',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found.`,
          exitCode: 1,
        };
      }

      if (note.content.locked) {
        return {
          error: `Cannot write to "${note.content.title}": note is locked (read-only).`,
          exitCode: 1,
        };
      }

      note.content.text = newContent;
      note.content.body = newContent;

      let msg = `Updated note "${note.content.title}".`;
      // Update derived title if not pinned
      if (!note.content.isNamePinned) {
        const firstLine = newContent.split('\n')[0].replace(/^#+\s*/, '').trim();
        if (firstLine && firstLine !== note.content.title) {
          const oldTitle = note.content.title;
          note.content.title = firstLine;
          msg += ` Note automatically renamed from "${oldTitle}" to "${firstLine}".`;
        }
      }

      sendToMain({
        type: 'placeNode',
        id: `place-${note.id}`,
        payload: {
          node: note,
          width: note.width,
          height: note.height,
        },
      });

      return {
        output: msg,
        exitCode: 0,
      };
    }

    case 'edit': {
      const noteName = restArgs[0];
      const oldText = restArgs[1];
      const newText = restArgs[2] ?? '';

      if (!noteName || oldText === undefined) {
        return {
          error: 'mindagentics note edit: required args missing. Usage: mindagentics note edit "Note Name" "old text" "new text"',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found.`,
          exitCode: 1,
        };
      }

      if (note.content.locked) {
        return {
          error: `Cannot edit "${note.content.title}": note is locked (read-only).`,
          exitCode: 1,
        };
      }

      const currentText = note.content.body !== undefined ? note.content.body : (note.content.text || '');
      if (!currentText.includes(oldText)) {
        return {
          error: `Target substring not found in note "${note.content.title}".`,
          exitCode: 1,
        };
      }

      const updatedText = currentText.replace(oldText, newText);
      note.content.text = updatedText;
      note.content.body = updatedText;

      sendToMain({
        type: 'placeNode',
        id: `place-${note.id}`,
        payload: {
          node: note,
          width: note.width,
          height: note.height,
        },
      });

      return {
        output: `Successfully updated note "${note.content.title}".`,
        exitCode: 0,
      };
    }

    case 'stack': {
      const noteName = restArgs[0];
      const stackName = restArgs[1] || req.options.stack || 'Fichário';

      if (!noteName) {
        return {
          error: 'mindagentics note stack: note name required. Usage: mindagentics note stack "Note Name" ["Fichário"]',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found.`,
          exitCode: 1,
        };
      }

      note.content.stackId = stackName;

      let callerNodeId: string | undefined;
      for (const [nid, n] of state.nodes.entries()) {
        if (n.kind === 'terminal' && (n.content?.terminalId === req.terminalId || n.id === req.terminalId)) {
          callerNodeId = n.id;
          break;
        }
      }
      if (!callerNodeId) callerNodeId = req.terminalId;

      let stackNode = Array.from(state.nodes.values()).find(
        (n: any) =>
          n.kind === 'noteStack' &&
          (n.content?.title?.toLowerCase() === stackName.toLowerCase() ||
            n.content?.stackId?.toLowerCase() === stackName.toLowerCase())
      ) as NoteStackNode | undefined;

      const pageContent = note.content.body || note.content.text || '';

      if (!stackNode) {
        const stackCoords = placeNode({
          width: 380,
          height: 340,
          existingNodes: Array.from(state.nodes.values()),
          anchorNodeId: callerNodeId,
          placementDirection: 'right',
        });
        const stackId = `stack-${Date.now()}`;
        stackNode = {
          id: `node-stack-${stackId.slice(0, 8)}`,
          kind: 'noteStack',
          x: stackCoords.x,
          y: stackCoords.y,
          width: 380,
          height: 340,
          zIndex: 11,
          content: {
            stackId,
            title: stackName,
            noteIds: [note.id],
            activePageIndex: 0,
            tabOrientation: 'side',
            pages: [
              {
                id: note.content.noteId || note.id,
                title: note.content.title,
                body: pageContent,
                color: note.content.color,
              },
            ],
          },
        };
        state.nodes.set(stackNode.id, stackNode);
      } else {
        const pages = stackNode.content.pages || [];
        if (!pages.some((p: any) => p.id === note.content.noteId || p.title === note.content.title)) {
          pages.push({
            id: note.content.noteId || note.id,
            title: note.content.title,
            body: pageContent,
            color: note.content.color,
          });
          stackNode.content.pages = pages;
          stackNode.content.noteIds = pages.map((p: any) => p.id);
        }
      }

      sendToMain({
        type: 'placeNode',
        id: `place-${stackNode.id}`,
        payload: {
          node: stackNode,
          width: 380,
          height: 340,
          existingNodes: Array.from(state.nodes.values()),
          anchorNodeId: callerNodeId,
          placementDirection: 'right',
        },
      });

      if (callerNodeId) {
        state.connections.push({
          fromId: callerNodeId,
          toId: stackNode.id,
          label: 'Connected Fichário',
        });
        sendToMain({
          type: 'cableTieCreated',
          id: `tie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          payload: {
            fromNodeId: callerNodeId,
            toNodeId: stackNode.id,
            label: 'Connected Fichário',
          },
        });
      }

      return {
        output: `Filed note "${note.content.title}" into stack "${stackName}". Placed on canvas.`,
        exitCode: 0,
      };
    }

    case 'unstack': {
      const noteName = restArgs[0];
      if (!noteName) {
        return {
          error: 'mindagentics note unstack: note name required. Usage: mindagentics note unstack "Note Name"',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found.`,
          exitCode: 1,
        };
      }

      const prevStack = note.content.stackId;
      note.content.stackId = null;

      sendToMain({
        type: 'placeNode',
        id: `place-${note.id}`,
        payload: {
          node: note,
          width: note.width,
          height: note.height,
        },
      });

      return {
        output: `Unstacked note "${note.content.title}" from "${prevStack || 'stack'}".`,
        exitCode: 0,
      };
    }

    case 'delete': {
      const noteName = restArgs[0];
      if (!noteName) {
        return {
          error: 'mindagentics note delete: note name required. Usage: mindagentics note delete "Note Name"',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found.`,
          exitCode: 1,
        };
      }

      state.nodes.delete(note.id);
      state.connections = state.connections.filter(
        (c: any) => c.fromId !== note.id && c.toId !== note.id,
      );

      sendToMain({
        type: 'deleteNode',
        id: `del-${note.id}`,
        payload: {
          nodeId: note.id,
        },
      });

      return {
        output: `Deleted note "${note.content.title}" from canvas.`,
        exitCode: 0,
      };
    }

    default:
      return {
        error: `Unknown note subcommand: "${action}". Valid: create, read, write, edit, stack, unstack, delete.`,
        exitCode: 1,
      };
  }
};
