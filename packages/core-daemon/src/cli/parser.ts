/**
 * CLI Argument Parser
 */

export interface ParsedArgs {
  command: string;
  args: string[];
  options: Record<string, any>;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  const options: Record<string, any> = {};

  let i = 0;
  const command = argv[0] || 'help';
  i++;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [optKey, ...valParts] = key.split('=');
        options[optKey] = valParts.join('=');
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          options[key] = next;
          i++;
        } else {
          options[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      args.push(arg);
    }

    i++;
  }

  return {
    command,
    args,
    options,
  };
}
