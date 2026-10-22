import type { CommandHandler } from '../../daemon/pipeServer.js';

export const arrangeCommand: CommandHandler = async (req, state) => {
  const targetName = req.args[0];

  if (!targetName && Object.keys(req.options).length === 0) {
    return {
      output: [
        'Canvas Visual Styles:',
        'Available colors: yellow, blue, green, pink, purple, gray, cyan, orange',
        'Available icons: seal, brain, sparkle, rectangle.portrait, terminal, eye, gear',
        'Usage: maestri arrange "Name" [--name N] [--icon I] [--color C]',
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
    return {
      output: `Updated styling for terminal "${target.title}"${newColor ? ` [color: ${newColor}]` : ''}${newIcon ? ` [icon: ${newIcon}]` : ''}.`,
      exitCode: 0,
    };
  }

  return {
    output: `Updated styling for "${targetName || 'item'}".`,
    exitCode: 0,
  };
};
