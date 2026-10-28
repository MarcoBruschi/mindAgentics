import type { CommandHandler } from '../../daemon/pipeServer.js';

export const arrangeCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const targetName = req.args[0];

  if (!targetName && Object.keys(req.options).length === 0) {
    return {
      output: [
        'Canvas Visual Styles:',
        'Available colors: yellow, blue, green, pink, purple, gray, cyan, orange',
        'Available icons: seal, brain, sparkle, rectangle.portrait, terminal, eye, gear',
        'Usage: mindagentics arrange "Name" [--name N] [--icon I] [--color C]',
      ].join('\n'),
      exitCode: 0,
    };
  }

  const newName = req.options.name as string | undefined;
  const newColor = req.options.color as string | undefined;
  const newIcon = req.options.icon as string | undefined;

  const target = targetName ? state.getTerminalByNameOrId(targetName, req.workspaceId) : state.terminals.get(req.terminalId);
  if (target) {
    if (newName) target.title = newName;
    for (const [id, node] of state.nodes.entries()) {
      if (node.kind === 'terminal' && (node as any).content?.terminalId === target.id) {
        if (newName) (node as any).content.title = newName;
        if (newColor) (node as any).content.accentColor = newColor;
        if (newIcon) (node as any).content.icon = newIcon;
        sendToMain({
          type: 'placeNode',
          id: `place-${id}`,
          payload: {
            node,
            width: node.width,
            height: node.height,
          },
        });
        break;
      }
    }
    return {
      output: `Updated styling for terminal "${target.title}"${newColor ? ` [color: ${newColor}]` : ''}${newIcon ? ` [icon: ${newIcon}]` : ''}. Placed on canvas.`,
      exitCode: 0,
    };
  }

  // Check notes
  if (targetName) {
    const norm = targetName.toLowerCase();
    for (const [id, node] of state.nodes.entries()) {
      if (node.kind === 'note') {
        const n = (node as any).content;
        if (n.title?.toLowerCase() === norm || id === targetName) {
          if (newName) n.title = newName;
          if (newColor) n.color = newColor;
          sendToMain({
            type: 'placeNode',
            id: `place-${id}`,
            payload: {
              node,
              width: node.width,
              height: node.height,
            },
          });
          return { output: `Updated styling for note "${n.title}". Placed on canvas.`, exitCode: 0 };
        }
      }
    }
  }

  return {
    output: `Updated styling for "${targetName || 'item'}".`,
    exitCode: 0,
  };
};
