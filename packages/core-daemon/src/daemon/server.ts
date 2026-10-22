/**
 * Daemon Mode Coordinator
 * `maestri --serve <token>`
 * Communicates with Electron Main via line-delimited JSON RPC on stdin/stdout.
 * Creates Named Pipe server for CLI connections.
 */

import * as readline from 'node:readline';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DaemonState } from './state.js';
import { MessageRouter } from './router.js';
import { RoutineScheduler } from './scheduler.js';
import { RpcHandler } from './rpcHandler.js';
import { NamedPipeServer } from './pipeServer.js';
import { registerAllCommands } from '../cli/commands/index.js';

export async function runDaemonServer(serveToken?: string): Promise<void> {
  const isWindows = os.platform() === 'win32';
  const token = serveToken || randomUUID().slice(0, 8);
  const pipePath = isWindows
    ? `\\\\.\\pipe\\maestri-${token}`
    : `/tmp/maestri-${token}.sock`;
  const envVarName = isWindows ? 'MAESTRI_PIPE' : 'MAESTRI_SOCKET';

  const sendToMain = (frame: any) => {
    try {
      process.stdout.write(JSON.stringify(frame) + '\n');
    } catch {
      // Stream error
    }
  };

  const state = new DaemonState();
  const router = new MessageRouter(state, sendToMain);
  const scheduler = new RoutineScheduler(state, sendToMain);
  const rpcHandler = new RpcHandler(state, router, scheduler, sendToMain);
  const pipeServer = new NamedPipeServer(pipePath, state, router, scheduler, sendToMain);

  registerAllCommands(pipeServer);

  // Start pipe server and scheduler
  await pipeServer.start();
  scheduler.start();

  // Emit ready notification frame to Main
  sendToMain({
    type: 'ready',
    payload: {
      envVarName,
      address: pipePath,
    },
  });

  // Listen on stdin for line-delimited JSON RPC from Main
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const frame = JSON.parse(trimmed);
      rpcHandler.handleFrame(frame);
    } catch (err: any) {
      // Invalid JSON from Main
    }
  });

  rl.on('close', async () => {
    scheduler.stop();
    await pipeServer.stop();
    process.exit(0);
  });
}
