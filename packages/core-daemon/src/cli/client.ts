/**
 * Terminal CLI Client
 * Connects to Named Pipe at MINDAGENTICS_PIPE (or MAESTRI_PIPE fallback) and dispatches commands.
 */

import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { CliRequestEnvelope, CliResponseEnvelope } from '@mindagentics/shared';
import { parseCliArgs } from './parser.js';

export function printHelpBanner() {
  console.log(`mindAgentics CLI v0.26.0

Usage: mindagentics <command> [options] (alias: maestri)

Commands:
  list                                          List connected agents, notes, portals, and bands
  notify <message>                              Send a desktop notification to the user
  ask <agent> <prompt>                          Send a prompt to a connected agent and get response
    --batch <json>                              Ask multiple connected agents in parallel
    --raw <string>                              Send raw input or escape sequences
  check <agent>                                 Read an agent's current terminal output
  say <message>                                 Broadcast a message to connected agents
  recall <query>                                Semantic search of terminal memory
  note <create|read|write|edit|stack|delete>    Manage sticky notes and fichários on canvas
  portal <snapshot|click|fill|type|key|...>     Automate browser and device portals
  preset <list|show|create|set|delete>          Manage agent quick-start presets
  role <list|show|create|edit|write|assign>     Manage agent role definitions and prompts
  routine <list|show|create|edit|run|delete>    Manage scheduled chrono routines
  workspace <list|create|move|rename>           Manage workspaces in the sidebar
  floor <list|create|land|delete|status|unload> Manage isolated git worktree floors
  recruit <name> [options]                      Spawn and auto-connect a new teammate terminal
  dismiss <name>                                Stop an agent and remove its terminal
  connect <from> <to>                           Wire two nodes together on canvas
  band <create|add|remove|dissolve>             Gather agents into a synchronized canvas band
  arrange <name> [options]                      Style or restyle canvas nodes
  graphify <build|query|explain|path|open>      Knowledge graph AST extraction, queries & visualizer
  status                                        Display current terminal status and health
  debug                                         Run diagnostics on named pipe and environment

Run 'mindagentics <command> --help' for details on a specific command.`);
}

export async function runCliClient(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
    printHelpBanner();
    process.exit(0);
  }

  const pipePath =
    process.env.MINDAGENTICS_PIPE ||
    process.env.MAESTRI_PIPE ||
    process.env.MINDAGENTICS_SOCKET ||
    process.env.MAESTRI_SOCKET;
  const terminalId =
    process.env.MINDAGENTICS_TERMINAL_ID ||
    process.env.MAESTRI_TERMINAL_ID;

  let hasGuardErrors = false;
  if (!pipePath) {
    console.error('mindagentics: only available inside mindAgentics terminals (MINDAGENTICS_PIPE not set).');
    hasGuardErrors = true;
  }
  if (!terminalId) {
    console.error('mindagentics: only available inside mindAgentics terminals (MINDAGENTICS_TERMINAL_ID not set).');
    hasGuardErrors = true;
  }

  if (hasGuardErrors) {
    process.exit(1);
  }

  const req: CliRequestEnvelope = {
    id: `req-${randomUUID().slice(0, 8)}`,
    terminalId: terminalId!,
    workspaceId: process.env.MINDAGENTICS_WORKSPACE_ID || process.env.MAESTRI_WORKSPACE_ID,
    floorId: process.env.MINDAGENTICS_FLOOR_ID || process.env.MAESTRI_FLOOR_ID,
    command: parsed.command,
    args: parsed.args,
    options: {
      ...parsed.options,
      maestroMode:
        process.env.MINDAGENTICS_MAESTRO_MODE === '1' ||
        process.env.MAESTRI_MAESTRO_MODE === '1',
    },
  };

  const client = net.createConnection(pipePath!, () => {
    client.write(JSON.stringify(req) + '\n');
  });

  let responseData = '';

  client.on('data', (chunk) => {
    responseData += chunk.toString('utf8');
    if (responseData.includes('\n')) {
      const line = responseData.split('\n')[0].trim();
      try {
        const res: CliResponseEnvelope = JSON.parse(line);
        if (res.output) {
          process.stdout.write(res.output + '\n');
        }
        if (res.error) {
          process.stderr.write(res.error + '\n');
        }
        client.end();
        process.exit(res.exitCode ?? (res.ok ? 0 : 1));
      } catch (err: any) {
        console.error(`mindagentics: failed to parse response: ${err.message}`);
        client.end();
        process.exit(1);
      }
    }
  });

  client.on('error', (err) => {
    console.error(`mindagentics: pipe connection error (${pipePath}): ${err.message}`);
    process.exit(1);
  });
}
