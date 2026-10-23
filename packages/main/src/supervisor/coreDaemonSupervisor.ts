import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import EventEmitter from 'events';

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timer: NodeJS.Timeout;
}

export class CoreDaemonSupervisor extends EventEmitter {
  public token: string;
  public daemonReady = false;
  public pipeAddress = '';
  public pipeEnvVar = 'MINDAGENTICS_PIPE';

  private child: ChildProcess | null = null;
  private stdoutBuffer = '';
  private nextId = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private readyWaiters = new Set<() => void>();
  private respawnTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private respawnDelay = 1000;

  constructor() {
    super();
    this.token = crypto.randomBytes(4).toString('hex');
  }

  public async start(): Promise<void> {
    this.stopping = false;
    this.spawnChild();
  }

  public stop(): void {
    this.stopping = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.daemonReady = false;
  }

  private resolveDaemonScript(): string {
    const candidates = [
      path.resolve(__dirname, '../../core-daemon/bin/mindagentics.js'),
      path.resolve(__dirname, '../../../core-daemon/bin/mindagentics.js'),
      path.resolve(process.cwd(), 'packages/core-daemon/bin/mindagentics.js'),
      path.resolve(process.cwd(), 'clone/packages/core-daemon/bin/mindagentics.js'),
      path.resolve(__dirname, '../../core-daemon/bin/maestri.js'),
      path.resolve(__dirname, '../../../core-daemon/bin/maestri.js'),
      path.resolve(process.cwd(), 'packages/core-daemon/bin/maestri.js'),
      path.resolve(process.cwd(), 'clone/packages/core-daemon/bin/maestri.js')
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }

  private spawnChild(): void {
    if (this.stopping) return;
    const scriptPath = this.resolveDaemonScript();

    try {
      this.child = spawn(process.execPath || 'node', [scriptPath, '--serve', this.token], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          MINDAGENTICS_SECRET_STORE: 'file',
          MAESTRI_SECRET_STORE: 'file'
        }
      });

      this.child.stdout?.on('data', (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString('utf-8');
        const lines = this.stdoutBuffer.split('\n');
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            this.handleFrameLine(trimmed);
          }
        }
      });

      this.child.stderr?.on('data', (chunk: Buffer) => {
        console.error('[CoreDaemon stderr]', chunk.toString('utf-8'));
      });

      this.child.on('error', (err) => {
        console.error('[CoreDaemon process error]', err);
        this.handleExit();
      });

      this.child.on('exit', (code, signal) => {
        console.log(`[CoreDaemon exit] code=${code} signal=${signal}`);
        this.handleExit();
      });
    } catch (err) {
      console.error('[CoreDaemon failed to spawn]', err);
      this.handleExit();
    }
  }

  private handleExit(): void {
    this.daemonReady = false;
    this.child = null;

    // Reject pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject({ ok: false, refusal: { code: 'daemon_crashed', message: 'Core daemon terminated' } });
    }
    this.pendingRequests.clear();

    if (!this.stopping) {
      this.respawnTimer = setTimeout(() => {
        this.respawnDelay = Math.min(this.respawnDelay * 1.5, 10000);
        this.spawnChild();
      }, this.respawnDelay);
    }
  }

  private handleFrameLine(line: string): void {
    try {
      const frame = JSON.parse(line);
      this.handleFrame(frame);
    } catch (e) {
      console.warn('[CoreDaemon non-json frame]', line);
    }
  }

  private handleFrame(frame: any): void {
    if (!frame || typeof frame !== 'object') return;

    // 1. Ready frame
    if (frame.type === 'ready' && frame.payload) {
      this.pipeAddress = frame.payload.address || '';
      this.pipeEnvVar = frame.payload.envVarName || 'MINDAGENTICS_PIPE';
      this.daemonReady = true;
      this.respawnDelay = 1000;
      this.emit('ready', { address: this.pipeAddress, envVar: this.pipeEnvVar });

      for (const waiter of this.readyWaiters) {
        waiter();
      }
      this.readyWaiters.clear();
      return;
    }

    // 2. RPC response matching pending request
    if (frame.id && this.pendingRequests.has(frame.id)) {
      const pending = this.pendingRequests.get(frame.id)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(frame.id);

      if (frame.payload && frame.payload.ok === false) {
        pending.reject(frame.payload.refusal || frame.payload);
      } else {
        pending.resolve(frame.payload?.result !== undefined ? frame.payload.result : frame.payload);
      }
      return;
    }

    // 3. Notification events
    switch (frame.type) {
      case 'ptyWrite':
        this.emit('ptyWrite', frame.payload);
        break;
      case 'deliverPrompt':
        this.emit('deliverPrompt', frame.payload);
        break;
      case 'asksInFlight':
        this.emit('asksInFlight', frame.payload);
        break;
      case 'maestroAttention':
        this.emit('maestroAttention', frame.payload);
        break;
      case 'attentionCleared':
        this.emit('attentionCleared', frame.payload);
        break;
      case 'transferActive':
        this.emit('transferActive', frame.payload);
        break;
      case 'chatTurnSettled':
        this.emit('chatTurnSettled', frame.payload);
        break;
      case 'terminalMemory':
        this.emit('terminalMemory', frame.payload);
        break;
      case 'placeNode':
        this.emit('placeNode', frame.payload);
        break;
      case 'cableTieCreated':
        this.emit('cableTieCreated', frame.payload);
        break;
      default:
        this.emit(frame.type, frame.payload);
        this.emit('event', frame);
        break;
    }
  }

  public async waitUntilReady(timeoutMs = 10000): Promise<void> {
    if (this.daemonReady) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters.delete(onReady);
        reject(new Error('Timed out waiting for CoreDaemon readiness'));
      }, timeoutMs);

      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.readyWaiters.add(onReady);
    });
  }

  public sendRequest<T = any, R = any>(type: string, payload: T, timeoutMs = 15000): Promise<R> {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      return Promise.reject({ ok: false, refusal: { code: 'daemon_unavailable', message: 'Core daemon is not active' } });
    }

    const id = `pr${++this.nextId}`;
    const frame = { type, id, payload };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject({ ok: false, refusal: { code: 'request_timed_out', message: `Request ${type} timed out` } });
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.child!.stdin!.write(`${JSON.stringify(frame)}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  public sendNotification(type: string, payload: any): void {
    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      try {
        this.child.stdin.write(`${JSON.stringify({ type, payload })}\n`);
      } catch {
        // ignore write errors during tear-down
      }
    }
  }

  public syncCanvas(payload: any): void {
    this.sendNotification('syncCanvas', payload);
  }

  public unregisterTerminal(terminalId: string): void {
    this.sendNotification('unregisterTerminal', { terminalId });
  }

  public chatTurnSettled(terminalId: string, output: string, askId?: string): void {
    this.sendNotification('chatTurnSettled', { terminalId, output, askId });
  }

  // Common Daemon RPC proxies
  public async placeNode(context: any): Promise<any> {
    return this.sendRequest('placeNode', context);
  }

  public async snapNode(context: any): Promise<any> {
    return this.sendRequest('snapNode', context);
  }

  public async tidyNode(request: any): Promise<any> {
    return this.sendRequest('tidyNode', request);
  }

  public async portalDesignScript(request: any): Promise<any> {
    return this.sendRequest('portalDesignScript', request);
  }

  public async portalDesignRegion(request: any): Promise<any> {
    return this.sendRequest('portalDesignRegion', request);
  }

  public async rankPalette(request: any): Promise<any> {
    return this.sendRequest('rankPalette', request);
  }

  public async serializePrompt(request: any): Promise<any> {
    return this.sendRequest('serializePrompt', request);
  }

  public async terminalProcessList(terminalId: string): Promise<any> {
    return this.sendRequest('terminalProcessList', { terminalId });
  }

  public async terminalProcessStop(terminalId: string, pid: number): Promise<any> {
    return this.sendRequest('terminalProcessStop', { terminalId, pid });
  }

  public async accounts(): Promise<any> {
    return this.sendRequest('accounts', {});
  }
}
