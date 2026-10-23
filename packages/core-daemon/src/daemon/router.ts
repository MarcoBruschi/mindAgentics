/**
 * Inter-Agent Message Router
 * Routes `mindagentics ask` messages from source terminal to destination terminal,
 * tracks active asksInFlight, and settles turn outputs.
 */

import { randomUUID } from 'node:crypto';
import type { DaemonState, AskSession } from './state.js';
import type { DeliverPromptPayload } from '@mindagentics/shared';

export class MessageRouter {
  constructor(
    private state: DaemonState,
    private sendToMain: (frame: { type: string; id?: string; payload: any }) => void,
  ) {}

  public async askAgent(
    fromTerminalId: string,
    targetName: string,
    prompt: string,
    options: { raw?: boolean; timeoutMs?: number; callerWorkspaceId?: string } = {},
  ): Promise<string> {
    const target = this.state.getTerminalByNameOrId(targetName, options.callerWorkspaceId, fromTerminalId);
    if (!target) {
      throw new Error(`Target agent "${targetName}" not found or not connected.`);
    }

    const askId = randomUUID();
    const timeoutMs = options.timeoutMs ?? 600000; // default 10 minutes

    return new Promise<string>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        this.state.asksInFlight.delete(askId);
        this.broadcastAsksInFlight();
        reject(new Error(`Timeout waiting for response from "${target.title}" (${timeoutMs / 1000}s)`));
      }, timeoutMs);

      const session: AskSession = {
        id: askId,
        fromTerminalId,
        toTerminalId: target.id,
        prompt,
        raw: options.raw,
        startedAt: new Date().toISOString(),
        resolve: (output: string) => {
          clearTimeout(timeoutTimer);
          resolve(output);
        },
        reject: (err: any) => {
          clearTimeout(timeoutTimer);
          reject(err);
        },
        timeoutTimer,
      };

      this.state.asksInFlight.set(askId, session);
      this.broadcastAsksInFlight();

      // Send prompt delivery request to Electron Main
      const deliverPayload: DeliverPromptPayload = {
        terminalId: target.id,
        prompt: options.raw ? prompt : `${prompt}\r`,
        raw: options.raw,
        askId,
        fromTerminalId,
      };

      this.sendToMain({
        type: 'deliverPrompt',
        id: `ask-${askId}`,
        payload: deliverPayload,
      });

      // Update target status to working
      target.status = 'working';
      target.scrollback.push(`> [Incoming Ask from ${fromTerminalId}]: ${prompt}`);
    });
  }

  public async askBatch(
    fromTerminalId: string,
    batchMap: Record<string, string>,
    options: { timeoutMs?: number; callerWorkspaceId?: string } = {},
  ): Promise<Array<{ name: string; output?: string; error?: string }>> {
    const keys = Object.keys(batchMap);
    const promises = keys.map(async (name) => {
      const prompt = batchMap[name];
      try {
        const output = await this.askAgent(fromTerminalId, name, prompt, options);
        return { name, output };
      } catch (err: any) {
        return { name, error: err.message || String(err) };
      }
    });

    return Promise.all(promises);
  }

  public settleTurn(terminalId: string, output: string, askId?: string) {
    const term = this.state.terminals.get(terminalId);
    if (term) {
      term.status = 'idle';
      term.lastTurnOutput = output;
      term.scrollback.push(output);

      // Index in semantic memory
      this.state.memoryEntries.push({
        terminalId,
        text: output,
        timestamp: new Date().toISOString(),
      });
    }

    if (askId && this.state.asksInFlight.has(askId)) {
      const session = this.state.asksInFlight.get(askId)!;
      this.state.asksInFlight.delete(askId);
      this.broadcastAsksInFlight();
      if (session.resolve) {
        session.resolve(output);
      }
    } else {
      // Check if there is an in-flight ask targeting this terminal
      for (const [id, session] of this.state.asksInFlight.entries()) {
        if (session.toTerminalId === terminalId) {
          this.state.asksInFlight.delete(id);
          this.broadcastAsksInFlight();
          if (session.resolve) {
            session.resolve(output);
          }
          break;
        }
      }
    }

    // Notify Main that turn settled
    this.sendToMain({
      type: 'chatTurnSettled',
      payload: {
        terminalId,
        askId,
        output,
      },
    });
  }

  private broadcastAsksInFlight() {
    this.sendToMain({
      type: 'asksInFlight',
      payload: this.state.getAsksInFlightPayload(),
    });
  }
}
