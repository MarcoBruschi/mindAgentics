import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import EventEmitter from 'node:events';

import { TerminalManager } from '../../packages/core-daemon/dist/terminal/terminalManager.js';
import { dismissCommand } from '../../packages/core-daemon/dist/cli/commands/dismiss.js';
import { DaemonState } from '../../packages/core-daemon/dist/daemon/state.js';

describe('S1: Imutabilidade Pós-Criação do Orquestrador & Proteção do Dismiss', () => {
  let tempDir;
  let fakeSupervisor;
  let manager;

  before(() => {
    tempDir = path.join(os.tmpdir(), `mindagentics-latch-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });

    fakeSupervisor = new EventEmitter();
    fakeSupervisor.token = 'test-latch-token';
    fakeSupervisor.pipeAddress = process.platform === 'win32'
      ? '\\\\.\\pipe\\mindagentics-latch-test'
      : '/tmp/mindagentics-latch-test.sock';
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
  // Caso 1: Terminal criado com orchestratorMode: false nasce como agente comum
  // =========================================================================
  it('Caso 1: Terminal criado com orchestratorMode: false deve nascer como agente comum (session.orchestratorMode === false)', async () => {
    const termId = 'term-latch-case-1';
    const spawnRes = await manager.spawn({
      id: termId,
      cwd: tempDir,
      orchestratorMode: false,
      maestroMode: false,
    });

    assert.strictEqual(spawnRes.terminalId, termId);
    const session = manager.sessions.get(termId);
    assert.ok(session, 'Sessão deve existir no TerminalManager');
    assert.strictEqual(session.orchestratorMode, false, 'session.orchestratorMode deve ser false para agente comum');
    assert.strictEqual(session.maestroMode, false, 'session.maestroMode deve ser false');

    manager.kill(termId);
  });

  // =========================================================================
  // Caso 2: Terminal criado com orchestratorMode: true nasce como orquestrador
  // =========================================================================
  it('Caso 2: Terminal criado com orchestratorMode: true deve nascer como orquestrador (session.orchestratorMode === true)', async () => {
    const termId = 'term-latch-case-2';
    const spawnRes = await manager.spawn({
      id: termId,
      cwd: tempDir,
      orchestratorMode: true,
    });

    assert.strictEqual(spawnRes.terminalId, termId);
    const session = manager.sessions.get(termId);
    assert.ok(session, 'Sessão de orquestrador deve existir no TerminalManager');
    assert.strictEqual(session.orchestratorMode, true, 'session.orchestratorMode deve ser true para orquestrador');
    assert.strictEqual(session.maestroMode, true, 'session.maestroMode deve ser true');

    manager.kill(termId);
  });

  // =========================================================================
  // Caso 3 (Proibição de Promoção Pós-Criação): setOrchestratorMode e reconfigure NÃO podem promover
  // =========================================================================
  describe('Caso 3 (Proibição de Promoção Pós-Criação): Imutabilidade para Agentes Comuns', () => {
    it('Terminal criado com orchestratorMode: false NÃO pode ser promovido para true via setOrchestratorMode(id, true)', async () => {
      const termId = 'term-latch-case-3a';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: false,
        maestroMode: false,
      });

      let session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Estado inicial deve ser false');

      // Tentativa de promoção pós-criação via setOrchestratorMode
      manager.setOrchestratorMode(termId, true);

      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Promoção pós-criação deve ser recusada: session.orchestratorMode permanece false');
      assert.strictEqual(session.maestroMode, false);

      // Tentativa via setMaestroMode
      manager.setMaestroMode(termId, true);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Tentativa via setMaestroMode deve ser recusada: permanece false');
      assert.strictEqual(session.maestroMode, false);

      manager.kill(termId);
    });

    it('Terminal criado com orchestratorMode: false NÃO pode ser promovido para true via reconfigure(id, { orchestratorMode: true })', async () => {
      const termId = 'term-latch-case-3b';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: false,
        maestroMode: false,
      });

      let session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false);

      // Tentativa de promoção pós-criação via reconfigure
      const res = await manager.reconfigure({
        terminalId: termId,
        orchestratorMode: true,
      });

      assert.strictEqual(res.ok, true);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, false, 'Promoção pós-criação via reconfigure deve ser recusada: permanece false');
      assert.strictEqual(session.maestroMode, false);

      manager.kill(termId);
    });
  });

  // =========================================================================
  // Caso 4 (Proibição de Downgrade Pós-Criação): setOrchestratorMode e reconfigure NÃO podem rebaixar
  // =========================================================================
  describe('Caso 4 (Proibição de Downgrade Pós-Criação): Imutabilidade para Orquestradores', () => {
    it('Terminal criado com orchestratorMode: true NÃO pode ser rebaixado para false via setOrchestratorMode(id, false)', async () => {
      const termId = 'term-latch-case-4a';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: true,
      });

      let session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'Terminal deve iniciar como orquestrador');

      // Tentativa de rebaixamento via setOrchestratorMode(id, false)
      manager.setOrchestratorMode(termId, false);

      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'Tentativa de downgrade via setOrchestratorMode deve ser ignorada: permanece true');
      assert.strictEqual(session.maestroMode, true, 'maestroMode permanece true');

      // Tentativa de rebaixamento via setMaestroMode(id, false)
      manager.setMaestroMode(termId, false);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'Tentativa de downgrade via setMaestroMode deve ser ignorada: permanece true');
      assert.strictEqual(session.maestroMode, true, 'maestroMode permanece true');

      manager.kill(termId);
    });

    it('Terminal criado com orchestratorMode: true NÃO pode ser rebaixado para false via reconfigure(id, { orchestratorMode: false })', async () => {
      const termId = 'term-latch-case-4b';
      await manager.spawn({
        id: termId,
        cwd: tempDir,
        orchestratorMode: true,
      });

      let session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true);

      // Tentativa de downgrade via reconfigure { orchestratorMode: false }
      const res = await manager.reconfigure({
        terminalId: termId,
        orchestratorMode: false,
      });

      assert.strictEqual(res.ok, true);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'Downgrade via reconfigure DEVE ser recusado: mantém session.orchestratorMode === true');
      assert.strictEqual(session.maestroMode, true, 'maestroMode permanece true');

      // Tentativa com maestroMode: false
      const resMaestro = await manager.reconfigure({
        terminalId: termId,
        maestroMode: false,
      });

      assert.strictEqual(resMaestro.ok, true);
      session = manager.sessions.get(termId);
      assert.strictEqual(session.orchestratorMode, true, 'Downgrade via maestroMode: false DEVE ser recusado');
      assert.strictEqual(session.maestroMode, true);

      manager.kill(termId);
    });
  });

  // =========================================================================
  // Caso 5 (Prevenção de Injeção de Env): MINDAGENTICS_ORCHESTRATOR_MODE imune a reset para 0
  // =========================================================================
  it('Caso 5 (Prevenção de Injeção de Env): Validar que a variável MINDAGENTICS_ORCHESTRATOR_MODE não possa ser resetada para 0 via argumentos do spawn', async () => {
    const termId = 'term-latch-case-5';
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

    // Validação estática no arquivo-alvo terminalManager.ts
    const tmSource = fs.readFileSync(path.resolve('packages/core-daemon/src/terminal/terminalManager.ts'), 'utf8');
    const envBlockMatch = tmSource.match(/const env: Record<string, string> = \{([\s\S]*?)\};/);
    assert.ok(envBlockMatch, 'Bloco de variáveis de ambiente deve existir no terminalManager.ts');

    const envBlock = envBlockMatch[1];
    const optionsEnvIdx = envBlock.indexOf('...options.env');
    const orchModeIdx = envBlock.indexOf("MINDAGENTICS_ORCHESTRATOR_MODE: '1'");
    const maestroModeIdx = envBlock.indexOf("MINDAGENTICS_MAESTRO_MODE: '1'");

    assert.ok(optionsEnvIdx !== -1, 'options.env deve estar presente no dicionário');
    assert.ok(orchModeIdx !== -1, 'MINDAGENTICS_ORCHESTRATOR_MODE deve estar definido como 1');
    assert.ok(maestroModeIdx !== -1, 'MINDAGENTICS_MAESTRO_MODE deve estar definido como 1');
    assert.ok(
      orchModeIdx > optionsEnvIdx,
      'A atribuição MINDAGENTICS_ORCHESTRATOR_MODE: 1 deve vir OBRIGATORIAMENTE DEPOIS de ...options.env para neutralizar ataques de sobrescrita'
    );
    assert.ok(
      maestroModeIdx > optionsEnvIdx,
      'A atribuição MINDAGENTICS_MAESTRO_MODE: 1 deve vir OBRIGATORIAMENTE DEPOIS de ...options.env para neutralizar ataques de sobrescrita'
    );

    manager.kill(termId);
  });

  // =========================================================================
  // Caso 6: mindagentics dismiss - Proteção contra Exclusão e Permissões
  // =========================================================================
  describe('Caso 6: mindagentics dismiss - Proteção contra Exclusão e Permissões', () => {
    it('deve recusar a execução de dismiss quando chamado por um agente não-orquestrador', async () => {
      const state = new DaemonState();
      const workerCaller = {
        id: 'term-worker-caller',
        title: 'Worker Dev',
        workspaceId: 'ws-test',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(workerCaller);

      const targetAgent = {
        id: 'term-target-agent',
        title: 'Target Agent',
        workspaceId: 'ws-test',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(targetAgent);

      const res = await dismissCommand({
        command: 'dismiss',
        args: ['Target Agent'],
        terminalId: workerCaller.id,
        workspaceId: 'ws-test',
      }, state, {}, {}, () => {});

      assert.strictEqual(res.exitCode, 1);
      assert.match(res.error, /permissão negada.*requer modo orquestrador/i);
      assert.ok(state.terminals.has(targetAgent.id), 'Alvo não deve ser removido');
    });

    it('deve recusar a exclusão de um terminal Orquestrador mesmo quando solicitado por outro terminal', async () => {
      const state = new DaemonState();
      const orchCaller = {
        id: 'term-orch-caller',
        title: 'Orchestrator Lead',
        workspaceId: 'ws-test',
        orchestratorMode: true,
        maestroMode: true,
      };
      state.registerTerminal(orchCaller);

      const targetOrch = {
        id: 'term-target-orch',
        title: 'Target Orchestrator',
        workspaceId: 'ws-test',
        orchestratorMode: true,
        maestroMode: true,
      };
      state.registerTerminal(targetOrch);

      const res = await dismissCommand({
        command: 'dismiss',
        args: ['Target Orchestrator'],
        terminalId: orchCaller.id,
        workspaceId: 'ws-test',
      }, state, {}, {}, () => {});

      assert.strictEqual(res.exitCode, 1);
      assert.match(res.error, /não é permitido dispensar um terminal orquestrador/i);
      assert.ok(state.terminals.has(targetOrch.id), 'Terminal orquestrador não pode ser excluído');
    });

    it('deve permitir a exclusão de um agente comum quando executado por um Orquestrador', async () => {
      const state = new DaemonState();
      const orchCaller = {
        id: 'term-orch-valid',
        title: 'Valid Orchestrator',
        workspaceId: 'ws-test',
        orchestratorMode: true,
        maestroMode: true,
      };
      state.registerTerminal(orchCaller);

      const regularWorker = {
        id: 'term-regular-worker',
        title: 'Regular Worker',
        workspaceId: 'ws-test',
        orchestratorMode: false,
        maestroMode: false,
      };
      state.registerTerminal(regularWorker);

      const res = await dismissCommand({
        command: 'dismiss',
        args: ['Regular Worker'],
        terminalId: orchCaller.id,
        workspaceId: 'ws-test',
      }, state, {}, {}, () => {});

      assert.strictEqual(res.exitCode, 0);
      assert.match(res.output, /dismissed teammate "Regular Worker"/i);
      assert.strictEqual(state.terminals.has(regularWorker.id), false, 'Agente comum deve ser removido');
    });
  });
});
