/**
 * Windows Named Pipe Server
 * Listens on `\\.\pipe\maestri-<id>` (or socket on POSIX)
 * Handles incoming CLI requests from agent terminals.
 */

import * as net from 'node:net';
import type { DaemonState } from './state.js';
import type { MessageRouter } from './router.js';
import type { RoutineScheduler } from './scheduler.js';
import type { CliRequestEnvelope, CliResponseEnvelope } from '@mindagentics/shared';

export type CommandHandler = (
  req: CliRequestEnvelope,
  state: DaemonState,
  router: MessageRouter,
  scheduler: RoutineScheduler,
  sendToMain: (frame: any) => void,
) => Promise<{ output?: string; error?: string; exitCode?: number; data?: any }>;

export class NamedPipeServer {
  private server: net.Server | null = null;
  private handlers: Map<string, CommandHandler> = new Map();

  constructor(
    private pipePath: string,
    private state: DaemonState,
    private router: MessageRouter,
    private scheduler: RoutineScheduler,
    private sendToMain: (frame: any) => void,
  ) {}

  public registerHandler(command: string, handler: CommandHandler) {
    this.handlers.set(command.toLowerCase(), handler);
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', async (chunk) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const req: CliRequestEnvelope = JSON.parse(trimmed);
              const response = await this.handleRequest(req);
              socket.write(JSON.stringify(response) + '\n');
            } catch (err: any) {
              const errResp: CliResponseEnvelope = {
                id: 'err',
                ok: false,
                error: `Invalid request: ${err.message}`,
                exitCode: 1,
              };
              socket.write(JSON.stringify(errResp) + '\n');
            }
          }
        });

        socket.on('error', (err) => {
          // Socket error handling
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.pipePath, () => {
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: CliRequestEnvelope): Promise<CliResponseEnvelope> {
    const cmd = req.command.toLowerCase();
    const handler = this.handlers.get(cmd);

    if (!handler) {
      return {
        id: req.id,
        ok: false,
        error: `Unknown command: "${req.command}". Run "maestri --help" for available commands.`,
        exitCode: 1,
      };
    }

    try {
      const result = await handler(
        req,
        this.state,
        this.router,
        this.scheduler,
        this.sendToMain,
      );

      return {
        id: req.id,
        ok: result.exitCode === undefined || result.exitCode === 0,
        output: result.output,
        error: result.error,
        exitCode: result.exitCode ?? 0,
        data: result.data,
      };
    } catch (err: any) {
      return {
        id: req.id,
        ok: false,
        error: `maestri: error: ${err.message || String(err)}`,
        exitCode: 1,
      };
    }
  }
}
