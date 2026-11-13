/**
 * Windows Named Pipe Server
 * Listens on `\\.\pipe\mindagentics-<id>` (or socket on POSIX)
 * Handles incoming CLI requests from agent terminals.
 */

import * as net from 'node:net';
import type { DaemonState } from './state.js';
import type { MessageRouter } from './router.js';
import type { RoutineScheduler } from './scheduler.js';
import type { CliRequestEnvelope, CliResponseEnvelope } from '@mindagentics/shared';
import { CLI_MAX_ARGS, CLI_MAX_ARG_CHARS, PATH_MAX_CHARS, hasControlChars, estimatePayloadSize } from '@mindagentics/shared';

export type CommandHandler = (
  req: CliRequestEnvelope,
  state: DaemonState,
  router: MessageRouter,
  scheduler: RoutineScheduler,
  sendToMain: (frame: any) => void,
) => Promise<{ output?: string; error?: string; exitCode?: number; data?: any }>;

const MAX_PIPE_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB max request buffer
const MAX_ID_CHARS = 128;

/**
 * S6: strict schema validation of a CLI request envelope. Returns an error string or null when valid.
 * Unknown/oversized/ill-typed fields are rejected before any handler runs.
 */
export function validateCliRequest(req: any): string | null {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return 'request body must be a JSON object';
  if (typeof req.id !== 'string' || req.id.length === 0 || req.id.length > MAX_ID_CHARS) return '"id" must be a string (1-128 chars)';
  if (typeof req.command !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(req.command)) return '"command" field is required and must be a string';
  for (const k of ['terminalId', 'workspaceId', 'floorId'] as const) {
    const v = req[k];
    if (v !== undefined && (typeof v !== 'string' || v.length > MAX_ID_CHARS || hasControlChars(v))) return `"${k}" must be a short string without control characters`;
  }
  if (req.cwd !== undefined && (typeof req.cwd !== 'string' || req.cwd.length > PATH_MAX_CHARS || hasControlChars(req.cwd))) {
    return '"cwd" must be a string without control characters';
  }
  if (req.stdin !== undefined && (typeof req.stdin !== 'string' || req.stdin.length > MAX_PIPE_BUFFER_BYTES)) return '"stdin" must be a string within the size limit';
  if (req.args !== undefined) {
    if (!Array.isArray(req.args) || req.args.length > CLI_MAX_ARGS) return `"args" must be an array of at most ${CLI_MAX_ARGS} strings`;
    for (const a of req.args) {
      if (typeof a !== 'string' || a.length > CLI_MAX_ARG_CHARS) return '"args" entries must be strings within the size limit';
    }
  }
  if (req.options !== undefined && (typeof req.options !== 'object' || req.options === null || Array.isArray(req.options))) return '"options" must be an object';
  if (estimatePayloadSize(req, MAX_PIPE_BUFFER_BYTES) > MAX_PIPE_BUFFER_BYTES) return 'request exceeds size limit';
  return null;
}

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

          if (Buffer.byteLength(buffer, 'utf8') > MAX_PIPE_BUFFER_BYTES) {
            const errResp: CliResponseEnvelope = {
              id: 'err',
              ok: false,
              error: 'Payload too large: request buffer exceeds maximum allowed limit of 5MB',
              exitCode: 1,
            };
            socket.end(JSON.stringify(errResp) + '\n'); // drop the connection: never keep parsing the tail of an oversized line
            buffer = '';
            return;
          }

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

        socket.on('error', (_err) => {
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
    if (!req || typeof req !== 'object') {
      return {
        id: 'err',
        ok: false,
        error: 'Invalid request: request body must be a valid JSON object',
        exitCode: 1,
      };
    }

    const schemaError = validateCliRequest(req);
    if (schemaError) {
      return {
        id: typeof req.id === 'string' ? req.id.slice(0, MAX_ID_CHARS) : 'err',
        ok: false,
        error: `Invalid request: ${schemaError}`,
        exitCode: 1,
      };
    }

    if (!req.command || typeof req.command !== 'string') {
      return {
        id: req?.id || 'err',
        ok: false,
        error: 'Invalid request: "command" field is required and must be a string',
        exitCode: 1,
      };
    }

    const cmd = req.command.toLowerCase();
    const handler = this.handlers.get(cmd);

    if (!handler) {
      return {
        id: req.id,
        ok: false,
        error: `Unknown command: "${req.command}". Run "mindagentics --help" for available commands.`,
        exitCode: 1,
      };
    }

    if (!req.args) req.args = [];
    if (!req.options) req.options = {};

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
        error: `mindagentics: error: ${err.message || String(err)}`,
        exitCode: 1,
      };
    }
  }
}
