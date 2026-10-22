import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { NoteNode, NoteContent, NoteColor } from '@maestri/shared';

function findNote(state: any, nameOrId: string): NoteNode | undefined {
  const norm = (nameOrId || '').toLowerCase().trim();
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

      const noteNode: NoteNode = {
        id: nodeId,
        kind: 'note',
        x: 800,
        y: 150,
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
          locked: false,
        },
      };

      state.nodes.set(nodeId, noteNode);

      // Connect note to caller terminal
      state.connections.push({
        fromId: req.terminalId,
        toId: nodeId,
        label: 'Connected Note',
      });

      sendToMain({
        type: 'placeNode',
        id: `place-${nodeId}`,
        payload: {
          width: 320,
          height: 280,
          existingNodes: Array.from(state.nodes.values()),
          anchorNodeId: req.terminalId,
          placementDirection: 'right',
        },
      });

      return {
        output: `Created note "${title}" (ID: ${noteId.slice(0, 8)}) [color: ${color}]${stack ? ` in stack "${stack}"` : ''}`,
        exitCode: 0,
        data: { title, noteId, nodeId },
      };
    }

    case 'read': {
      const noteName = restArgs[0];
      if (!noteName) {
        return {
          error: 'maestri note read: note name required. Usage: maestri note read "Note Name" [startLine] [count]',
          exitCode: 1,
        };
      }

      const note = findNote(state, noteName);
      if (!note) {
        return {
          error: `Note "${noteName}" not found. Run "maestri list" to see connected notes.`,
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
          error: 'maestri note write: note name required. Usage: maestri note write "Note Name" "content"',
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
          error: 'maestri note edit: required args missing. Usage: maestri note edit "Note Name" "old text" "new text"',
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
          error: 'maestri note stack: note name required. Usage: maestri note stack "Note Name" ["Fichário"]',
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
      return {
        output: `Filed note "${note.content.title}" into stack "${stackName}".`,
        exitCode: 0,
      };
    }

    case 'unstack': {
      const noteName = restArgs[0];
      if (!noteName) {
        return {
          error: 'maestri note unstack: note name required. Usage: maestri note unstack "Note Name"',
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

      return {
        output: `Unstacked note "${note.content.title}" from "${prevStack || 'stack'}".`,
        exitCode: 0,
      };
    }

    case 'delete': {
      const noteName = restArgs[0];
      if (!noteName) {
        return {
          error: 'maestri note delete: note name required. Usage: maestri note delete "Note Name"',
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
