import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import EventEmitter from 'node:events';

import { TerminalManager } from '../../packages/core-daemon/dist/terminal/terminalManager.js';
import { presetCommand } from '../../packages/core-daemon/dist/cli/commands/preset.js';
import { dismissCommand } from '../../packages/core-daemon/dist/cli/commands/dismiss.js';
import { routineCommand } from '../../packages/core-daemon/dist/cli/commands/routine.js';
import { recruitCommand } from '../../packages/core-daemon/dist/cli/commands/recruit.js';
import { DaemonState } from '../../packages/core-daemon/dist/daemon/state.js';

describe('S1: Orchestrator Mode Immutability & Downgrade Protection Suite', () => {
  let tempDir;
  let fakeSupervisor;
  let manager;

  before(() => {
    tempDir = path.join(os.tmpdir(), `mindagentics-orch-lock-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });

    fakeSupervisor = new EventEmitter();
    fakeSupervisor.token = 'test-token-lock';
    fakeSupervisor.pipeAddress = process.platform === 'win32' ? '\\\\.\\pipe\\mindagentics-lock-test' : '/tmp/mindagentics-lock-test.sock';
    fakeSupervisor.daemonReady = true;
    fakeSupervisor.syncCanvas = () => {};
    fakeSupervisor.unregisterTerminal = () => {};

    manager = new TerminalManager(fakeSupervisor);
  });

  after(() => {
    try {
      manager.killAll();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // 1. Reconfigure Downgrade Prevention
  // =========================================================================
  describe('1. Reconfigure Downgrade Prevention', () => {
    it('should refuse downgrade when reconfigure is called with { orchestratorMode: false }', async () => {
      const termId = 'term-lock-reconfig-1';
      const mockPty = {
        kill: () => {},
        write: () => {},
        resize: () => {},
      };

      manager.sessions.set(termId, {
        id: termId,
        workspaceId: 'ws-lock',
        pty: mockPty,
        cwd: tempDir,
        scrollback: [],
        status: 'idle',
        attention: false,
        focused: false,
        cols: 80,
        rows: 24,
        title: 'Lead Agent',
        agentRole: 'Architect',
        instructions: 'Test instructions',
        command: 'powershell',
        orchestratorMode: true,
        maestroMode: true,
        isAlive: true,
      });

      const res = await manager.reconfigure({
        terminalId: termId,
        orchestratorMode: false,
      });

      assert.strictEqual(res.ok, true);
      const session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'orchestratorMode must remain true (downgrade refused)');
      assert.strictEqual(session.maestroMode, true, 'maestroMode must remain true');
    });

    it('should refuse downgrade when reconfigure is called with { maestroMode: false }', async () => {
      const termId = 'term-lock-reconfig-2';
      const mockPty = {
        kill: () => {},
        write: () => {},
        resize: () => {},
      };

      manager.sessions.set(termId, {
        id: termId,
        workspaceId: 'ws-lock',
        pty: mockPty,
        cwd: tempDir,
        scrollback: [],
        status: 'idle',
        attention: false,
        focused: false,
        cols: 80,
        rows: 24,
        title: 'Lead Agent 2',
        orchestratorMode: true,
        maestroMode: true,
        isAlive: true,
      });

      const res = await manager.reconfigure({
        terminalId: termId,
        maestroMode: false,
      });

      assert.strictEqual(res.ok, true);
      const session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'orchestratorMode must remain true when maestroMode: false passed');
      assert.strictEqual(session.maestroMode, true, 'maestroMode must remain true');
    });

    it('should refuse downgrade when setOrchestratorMode(id, false) or setMaestroMode(id, false) is called', () => {
      const termId = 'term-lock-direct-1';
      manager.sessions.set(termId, {
        id: termId,
        workspaceId: 'ws-lock',
        pty: { kill: () => {}, write: () => {}, resize: () => {} },
        cwd: tempDir,
        scrollback: [],
        status: 'idle',
        attention: false,
        focused: false,
        cols: 80,
        rows: 24,
        title: 'Lead Agent Direct',
        orchestratorMode: true,
        maestroMode: true,
        isAlive: true,
      });

      manager.setOrchestratorMode(termId, false);
      let session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'setOrchestratorMode(false) must not disable orchestratorMode');

      manager.setMaestroMode(termId, false);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.maestroMode, true, 'setMaestroMode(false) must not disable maestroMode');
      assert.strictEqual(session.orchestratorMode, true, 'orchestratorMode must remain true');
    });
  });

  // =========================================================================
  // 2. Initialization & Unidirectional Latch State Cycle
  // =========================================================================
  describe('2. Initialization & Unidirectional Latch State Cycle', () => {
    it('should create session as common agent when orchestratorMode: false is passed', async () => {
      const termId = 'term-lock-spawn-false';
      const spawnResult = await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: false,
        maestroMode: false,
      });

      assert.strictEqual(spawnResult.terminalId, termId);
      const session = manager.sessions.get(termId);
      assert.ok(session, 'Session must exist');
      assert.strictEqual(session.orchestratorMode, false, 'Terminal created with orchestratorMode: false must be a common agent');
      assert.strictEqual(session.maestroMode, false);

      manager.kill(termId);
    });

    it('should create session as orchestrator when orchestratorMode: true is passed', async () => {
      const termId = 'term-lock-spawn-true';
      const spawnResult = await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: true,
      });

      assert.strictEqual(spawnResult.terminalId, termId);
      const session = manager.sessions.get(termId);
      assert.ok(session, 'Session must exist');
      assert.strictEqual(session.orchestratorMode, true, 'Terminal created with orchestratorMode: true must be an orchestrator');
      assert.strictEqual(session.maestroMode, true);

      manager.kill(termId);
    });

    it('should prohibit promotion from false to true and prohibit downgrade from true to false (strict post-creation immutability)', async () => {
      const termId = 'term-lock-immutable-post-creation';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: false,
      });

      let session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Must start as false');

      // Tentativa de promoção pós-criação deve ser rejeitada
      manager.setOrchestratorMode(termId, true);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Promotion after creation must be rejected (strict immutability)');
      assert.strictEqual(session.maestroMode, false);

      // Tentativa de promoção via reconfigure deve ser rejeitada
      await manager.reconfigure({ terminalId: termId, orchestratorMode: true });
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Promotion via reconfigure after creation must be rejected');

      manager.kill(termId);
    });
  });

  // =========================================================================
  // 3. Environment Variable Tampering Defense
  // =========================================================================
  describe('3. Environment Variable Tampering Defense', () => {
    it('should prevent MINDAGENTICS_ORCHESTRATOR_MODE from being overridden to 0 via options.env', async () => {
      const termId = 'term-lock-env-tamper';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: true,
        env: {
          MINDAGENTICS_ORCHESTRATOR_MODE: '0',
          MINDAGENTICS_MAESTRO_MODE: '0',
        },
      });

      const session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true);
      assert.strictEqual(session.maestroMode, true);

      // Verify statically that terminalManager.ts sets MINDAGENTICS_ORCHESTRATOR_MODE: '1' AFTER ...options.env
      const tmSource = fs.readFileSync(path.resolve('packages/core-daemon/src/terminal/terminalManager.ts'), 'utf8');
      const envBlockMatch = tmSource.match(/const env: Record<string, string> = \{([\s\S]*?)\};/);
      assert.ok(envBlockMatch, 'Must find env construction block');
      const envBlock = envBlockMatch[1];
      const optionsEnvIdx = envBlock.indexOf('...options.env');
      const orchModeIdx = envBlock.indexOf("MINDAGENTICS_ORCHESTRATOR_MODE: '1'");
      const maestroModeIdx = envBlock.indexOf("MINDAGENTICS_MAESTRO_MODE: '1'");

      assert.ok(optionsEnvIdx !== -1, 'Must contain ...options.env');
      assert.ok(orchModeIdx !== -1, "Must contain MINDAGENTICS_ORCHESTRATOR_MODE: '1'");
      assert.ok(maestroModeIdx !== -1, "Must contain MINDAGENTICS_MAESTRO_MODE: '1'");
      assert.ok(orchModeIdx > optionsEnvIdx, 'MINDAGENTICS_ORCHESTRATOR_MODE must be declared AFTER ...options.env to prevent override');
      assert.ok(maestroModeIdx > optionsEnvIdx, 'MINDAGENTICS_MAESTRO_MODE must be declared AFTER ...options.env to prevent override');

      manager.kill(termId);
    });
  });

  // =========================================================================
  // 4. CLI Preset Command Downgrade Protection
  // =========================================================================
  describe('4. CLI Preset Downgrade Protection', () => {
    it('should refuse downgrade when mindagentics preset set tries to disable orchestrator mode', async () => {
      const state = new DaemonState();

      // Create preset with orchestrator mode active
      const createRes = await presetCommand({
        command: 'preset',
        args: ['create', 'OrchPreset'],
        options: {
          command: 'codex',
          orquestrador: 'on',
        },
      }, state);

      assert.strictEqual(createRes.exitCode, 0);
      const preset = state.presets.get('OrchPreset');
      assert.ok(preset);
      assert.strictEqual(preset.orchestratorMode, true);

      // Attempt downgrade via preset set --orquestrador off
      const setRes = await presetCommand({
        command: 'preset',
        args: ['set', 'OrchPreset'],
        options: {
          orquestrador: 'off',
        },
      }, state);

      assert.strictEqual(setRes.exitCode, 1, 'Attempting downgrade must return exitCode 1');
      assert.match(setRes.error, /downgrade do modo orquestrador não permitido/i);

      // Verify preset was not modified
      const presetAfter = state.presets.get('OrchPreset');
      assert.strictEqual(presetAfter.orchestratorMode, true, 'orchestratorMode must still be true');
      assert.strictEqual(presetAfter.maestroMode, true, 'maestroMode must still be true');
    });

    it('should refuse downgrade via orchestrator or maestro flags', async () => {
      const state = new DaemonState();

      await presetCommand({
        command: 'preset',
        args: ['create', 'MaestroPreset'],
        options: {
          command: 'claude',
          orchestrator: 'on',
        },
      }, state);

      const setRes1 = await presetCommand({
        command: 'preset',
        args: ['set', 'MaestroPreset'],
        options: {
          orchestrator: 'off',
        },
      }, state);
      assert.strictEqual(setRes1.exitCode, 1);

      const setRes2 = await presetCommand({
        command: 'preset',
        args: ['set', 'MaestroPreset'],
        options: {
          maestro: 'off',
        },
      }, state);
      assert.strictEqual(setRes2.exitCode, 1);
    });
  });

  // =========================================================================
  // 5. Dismiss Command Protection & Permission Enforcement
  // =========================================================================
  describe('5. Dismiss Command Protection', () => {
    it('should refuse dismiss execution when invoked by non-orchestrator agent', async () => {
      const state = new DaemonState();
      const workerCaller = {
        id: 'term-worker-caller-lock',
        title: 'Worker Dev',
        workspaceId: 'ws-lock',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(workerCaller);

      const targetAgent = {
        id: 'term-target-agent-lock',
        title: 'Target Agent',
        workspaceId: 'ws-lock',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(targetAgent);

      const res = await dismissCommand({
        command: 'dismiss',
        args: ['Target Agent'],
        terminalId: workerCaller.id,
        workspaceId: 'ws-lock',
      }, state, {}, {}, () => {});

      assert.strictEqual(res.exitCode, 1);
      assert.match(res.error, /permissão negada.*requer modo orquestrador/i);
      assert.ok(state.terminals.has(targetAgent.id), 'Target agent must not be removed');
    });

    it('should refuse deletion of an orchestrator terminal by any agent', async () => {
      const state = new DaemonState();
      const orchCaller = {
        id: 'term-orch-caller-lock',
        title: 'Lead Orch',
        workspaceId: 'ws-lock',
        orchestratorMode: true,
        maestroMode: true,
      };
      state.registerTerminal(orchCaller);

      const targetOrch = {
        id: 'term-target-orch-lock',
        title: 'Target Orchestrator',
        workspaceId: 'ws-lock',
        orchestratorMode: true,
        maestroMode: true,
      };
      state.registerTerminal(targetOrch);

      const res = await dismissCommand({
        command: 'dismiss',
        args: ['Target Orchestrator'],
        terminalId: orchCaller.id,
        workspaceId: 'ws-lock',
      }, state, {}, {}, () => {});

      assert.strictEqual(res.exitCode, 1);
      assert.match(res.error, /não é permitido (remover|dispensar) um terminal orquestrador/i);
      assert.ok(state.terminals.has(targetOrch.id), 'Orchestrator target must not be dismissed');
    });

    it('should emit deleteNode with terminalId for Main process to kill PTY when removing common agent', async () => {
      const state = new DaemonState();
      const orchCaller = {
        id: 'term-orch-caller-2',
        title: 'Lead Orch 2',
        workspaceId: 'ws-lock',
        orchestratorMode: true,
        maestroMode: true,
      };
      state.registerTerminal(orchCaller);

      const targetAgent = {
        id: 'term-target-agent-2',
        title: 'Target Worker',
        workspaceId: 'ws-lock',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(targetAgent);

      let sentFrame = null;
      const res = await dismissCommand({
        command: 'dismiss',
        args: ['Target Worker'],
        terminalId: orchCaller.id,
        workspaceId: 'ws-lock',
      }, state, {}, {}, (frame) => {
        sentFrame = frame;
      });

      assert.strictEqual(res.exitCode, 0);
      assert.ok(sentFrame, 'Frame must be sent to Main');
      assert.strictEqual(sentFrame.type, 'deleteNode');
      assert.strictEqual(sentFrame.payload.terminalId, targetAgent.id);
    });
  });

  // =========================================================================
  // 6. Routine Command Orchestrator Enforcement
  // =========================================================================
  describe('6. Routine Command Orchestrator Enforcement', () => {
    it('should block mutable routine actions when caller is not an orchestrator', async () => {
      const state = new DaemonState();
      const workerCaller = {
        id: 'term-worker-routine',
        title: 'Worker Dev',
        workspaceId: 'ws-lock',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(workerCaller);

      const res = await routineCommand({
        command: 'routine',
        args: ['create', 'MyRoutine'],
        options: { every: '1h' },
        terminalId: workerCaller.id,
      }, state, {}, { routines: new Map() }, () => {});

      assert.strictEqual(res.exitCode, 1);
      assert.match(res.error, /mindagentics routine requer Modo Orquestrador ativo/i);
    });

    it('should allow list routine action even when caller is not an orchestrator', async () => {
      const state = new DaemonState();
      const workerCaller = {
        id: 'term-worker-routine-list',
        title: 'Worker Dev',
        workspaceId: 'ws-lock',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(workerCaller);

      const res = await routineCommand({
        command: 'routine',
        args: ['list'],
        terminalId: workerCaller.id,
      }, state, {}, { routines: new Map() }, () => {});

      assert.strictEqual(res.exitCode, 0);
      assert.match(res.output, /Routines in current workspace/i);
    });
  });

  // =========================================================================
  // 7. Recruit Canonical PresetId & Replace Flow
  // =========================================================================
  describe('7. Recruit Canonical PresetId & Replace Flow', () => {
    it('should normalize presetId to canonical form when recruiting', async () => {
      const state = new DaemonState();
      let placedNode = null;

      const res = await recruitCommand({
        command: 'recruit',
        args: ['Assistant'],
        options: { preset: 'Antigravity' },
      }, state, {}, {}, (frame) => {
        if (frame.type === 'placeNode') placedNode = frame.payload.node;
      });

      assert.strictEqual(res.exitCode, 0);
      assert.ok(placedNode);
      assert.strictEqual(placedNode.content.presetId, 'antigravity');
    });

    it('should emit reconfigureTerminal with restart: true on --replace', async () => {
      const state = new DaemonState();
      const existing = {
        id: 'term-existing-replace',
        title: 'Old Agent',
        workspaceId: 'default',
        floorId: 'ground',
        presetId: 'shell',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(existing);

      let reconfigFrame = null;
      const res = await recruitCommand({
        command: 'recruit',
        args: ['New Agent'],
        options: {
          replace: 'Old Agent',
          preset: 'Claude Code',
          role: 'Fullstack Dev',
        },
      }, state, {}, {}, (frame) => {
        if (frame.type === 'reconfigureTerminal') reconfigFrame = frame;
      });

      assert.strictEqual(res.exitCode, 0);
      assert.ok(reconfigFrame);
      assert.strictEqual(reconfigFrame.payload.terminalId, existing.id);
      assert.strictEqual(reconfigFrame.payload.presetId, 'claude');
      assert.strictEqual(reconfigFrame.payload.restart, true);
    });
  });

  // =========================================================================
  // 8. Refs Preservation on Restart & Reconfigure
  // =========================================================================
  describe('8. Refs Preservation on Restart & Reconfigure', () => {
    it('should preserve refs when session is restarted', async () => {
      const termId = 'term-refs-restart';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
      });

      const session = manager.sessions.get(termId);
      assert.ok(session);
      session.refs = [
        { id: 'ref-1', path: path.join(tempDir, 'file.txt'), name: 'file.txt', type: 'file' },
      ];

      await manager.restart(termId);

      const restartedSession = manager.sessions.get(termId);
      assert.ok(restartedSession);
      assert.strictEqual(restartedSession.refs.length, 1);
      assert.strictEqual(restartedSession.refs[0].id, 'ref-1');

      manager.kill(termId);
    });

    it('should preserve refs when session is reconfigured with restart: true', async () => {
      const termId = 'term-refs-reconfigure';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
      });

      const session = manager.sessions.get(termId);
      assert.ok(session);
      session.refs = [
        { id: 'ref-2', path: path.join(tempDir, 'src'), name: 'src', type: 'dir' },
      ];

      await manager.reconfigure({
        terminalId: termId,
        title: 'Updated With Refs',
        restart: true,
      });

      const reconfiguredSession = manager.sessions.get(termId);
      assert.ok(reconfiguredSession);
      assert.strictEqual(reconfiguredSession.refs.length, 1);
      assert.strictEqual(reconfiguredSession.refs[0].id, 'ref-2');

      manager.kill(termId);
    });
  });
});
