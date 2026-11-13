/**
 * Terminal CLI Client
 * Connects to Named Pipe at MINDAGENTICS_PIPE and dispatches commands.
 */

import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { CliRequestEnvelope, CliResponseEnvelope } from '@mindagentics/shared';
import { parseCliArgs } from './parser.js';

export function printHelpBanner() {
  console.log(`mindAgentics CLI v0.26.0

Usage: mindagentics <command> [options]

Commands:
  list                                          List connected agents, notes, portals, and bands
  notify <message>                              Send a desktop notification to the user
  ask <agent> <prompt>                          Send a prompt to a connected agent and get response
    --batch <json>                              Ask multiple connected agents in parallel
    --raw <string>                              Send raw input or escape sequences
  check <agent>                                 Read an agent's current terminal output
  say <message>                                 Broadcast a message to connected agents
  recall <query>                                Busca local (SQLite FTS5) na memória do agente: 3 melhores trechos
  ref <add|list|remove>                         Referências de arquivo/pasta no canvas (só caminho, nunca conteúdo)
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
    process.env.MINDAGENTICS_SOCKET;
  const terminalId =
    process.env.MINDAGENTICS_TERMINAL_ID;

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

  let stdinContent: string | undefined;
  const subcmd = (parsed.args[0] || '').toLowerCase();
  const wantsStdin =
    Boolean(parsed.options.stdin) ||
    parsed.args.includes('-') ||
    (parsed.command === 'note' &&
      (subcmd === 'write' || subcmd === 'create') &&
      !parsed.options.file &&
      !parsed.options.f &&
      !parsed.options.body &&
      !parsed.options.content &&
      parsed.args.length <= 2 &&
      !process.stdin.isTTY);

  if (wantsStdin) {
    stdinContent = await new Promise<string | undefined>((resolve) => {
      const chunks: Buffer[] = [];
      let receivedData = false;
      let settled = false;
      const done = (val?: string) => {
        if (settled) return;
        settled = true;
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
        try {
          process.stdin.pause();
        } catch {}
        resolve(val);
      };

      const firstChunkTimer = setTimeout(() => {
        if (!receivedData) {
          done(undefined);
        }
      }, 50);

      process.stdin.on('data', (chunk: Buffer | string) => {
        receivedData = true;
        clearTimeout(firstChunkTimer);
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      process.stdin.on('end', () => {
        clearTimeout(firstChunkTimer);
        done(receivedData ? Buffer.concat(chunks).toString('utf8') : undefined);
      });

      process.stdin.on('error', () => {
        clearTimeout(firstChunkTimer);
        done(undefined);
      });

      try {
        process.stdin.resume();
      } catch {
        clearTimeout(firstChunkTimer);
        done(undefined);
      }
    });
  }

  const req: CliRequestEnvelope = {
    id: `req-${randomUUID().slice(0, 8)}`,
    terminalId: terminalId!,
    workspaceId: process.env.MINDAGENTICS_WORKSPACE_ID,
    floorId: process.env.MINDAGENTICS_FLOOR_ID,
    cwd: process.cwd(),
    ...(stdinContent !== undefined ? { stdin: stdinContent } : {}),
    command: parsed.command,
    args: parsed.args.filter((a) => a !== '-'),
    options: {
      ...parsed.options,
      orchestratorMode:
        process.env.MINDAGENTICS_ORCHESTRATOR_MODE === '1' || process.env.MINDAGENTICS_MAESTRO_MODE === '1',
      maestroMode:
        process.env.MINDAGENTICS_ORCHESTRATOR_MODE === '1' || process.env.MINDAGENTICS_MAESTRO_MODE === '1',
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
