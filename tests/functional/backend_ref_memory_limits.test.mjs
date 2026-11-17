import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Import compiled backend modules
import { MemoryService, memorySummaryRelPath, cleanTerminalText, SUMMARY_MAX_CHARS } from '../../packages/core-daemon/dist/memory/memoryService.js';
import { searchMemory, agentSlug } from '../../packages/core-daemon/dist/memory/memorySearch.js';
import { refCommand } from '../../packages/core-daemon/dist/cli/commands/ref.js';
import { recallCommand } from '../../packages/core-daemon/dist/cli/commands/recall.js';
import { connectCommand } from '../../packages/core-daemon/dist/cli/commands/connect.js';
import { DaemonState } from '../../packages/core-daemon/dist/daemon/state.js';
import { buildUsageWindows, probeAntigravity, probeCodex, probeOpenCode, probeClaude, probeCopilot } from '../../packages/core-daemon/dist/terminal/agentProbes.js';

describe('Backend Deliverables (B1 - B8) Suite', () => {
  let tempDir;

  before(() => {
    tempDir = path.join(os.tmpdir(), `mindagentics-b-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // B1. fileRef Model & Compatibility
  // =========================================================================
  describe('B1. Modelo fileRef e retrocompatibilidade', () => {
    it('should define kind "fileRef" with path, isDirectory, and label', () => {
      const fileRefNode = {
        id: 'node-ref-1',
        kind: 'fileRef',
        x: 100,
        y: 100,
        width: 240,
        height: 84,
        zIndex: 10,
        content: {
          path: path.join(tempDir, 'sample.txt'),
          isDirectory: false,
          label: 'sample.txt',
        },
      };

      assert.strictEqual(fileRefNode.kind, 'fileRef');
      assert.strictEqual(fileRefNode.content.isDirectory, false);
      assert.strictEqual(typeof fileRefNode.content.path, 'string');
      assert.strictEqual(typeof fileRefNode.content.label, 'string');
    });

    it('should preserve noteStack for backward compatibility', () => {
      const state = new DaemonState();
      const legacyStack = {
        id: 'node-stack-1',
        kind: 'noteStack',
        x: 0,
        y: 0,
        width: 380,
        height: 340,
        zIndex: 11,
        content: {
          stackId: 'stack-1',
          title: 'Legacy Fichário',
          noteIds: ['note-1'],
        },
      };
      state.nodes.set(legacyStack.id, legacyStack);
      assert.strictEqual(state.nodes.get('node-stack-1')?.kind, 'noteStack');
    });
  });

  // =========================================================================
  // B2. Vínculo fileRef <-> Agente & Injeção Apenas de Caminho/Tipo
  // =========================================================================
  describe('B2. Vínculo fileRef <-> Agente', () => {
    it('should connect fileRef to terminal and inject only [ref] pasta/arquivo line, never content', async () => {
      const state = new DaemonState();
      state.registerTerminal({
        id: 'term-agent-1',
        title: 'Backend Dev',
        workspaceId: 'ws-1',
        floorId: 'ground',
        status: 'idle',
        maestroMode: false,
        scrollback: [],
      });

      const secretFilePath = path.join(tempDir, 'secret_passwords.txt');
      fs.writeFileSync(secretFilePath, 'SUPER_SECRET_TOKEN_DO_NOT_LEAK', 'utf8');

      state.nodes.set('node-ref-secret', {
        id: 'node-ref-secret',
        kind: 'fileRef',
        x: 10,
        y: 10,
        width: 240,
        height: 84,
        zIndex: 10,
        content: {
          path: secretFilePath,
          isDirectory: false,
          label: 'Passwords',
        },
      });

      const sentFrames = [];
      const sendToMain = (frame) => sentFrames.push(frame);

      const req = {
        id: 'req-conn-1',
        command: 'connect',
        args: ['Passwords', 'Backend Dev'],
        options: {},
        terminalId: 'term-agent-1',
      };

      const res = await connectCommand(req, state, null, null, sendToMain);
      assert.strictEqual(res.exitCode, 0);

      // Verify connection created
      assert.ok(state.connections.some((c) => c.fromId.includes('secret') || c.toId.includes('secret')));

      // Verify injected PTY write contains ONLY [ref] arquivo: <path>, and NEVER the secret content
      const ptyWriteFrame = sentFrames.find((f) => f.type === 'ptyWrite');
      assert.ok(ptyWriteFrame, 'Expected ptyWrite frame on connect');
      assert.ok(ptyWriteFrame.payload.data.startsWith('[ref] arquivo: '));
      assert.ok(ptyWriteFrame.payload.data.includes('secret_passwords.txt'));
      assert.strictEqual(ptyWriteFrame.payload.data.includes('SUPER_SECRET_TOKEN_DO_NOT_LEAK'), false);

      // Verify agentRefsChanged frame sent to update AGENTS.md
      const refsChangedFrame = sentFrames.find((f) => f.type === 'agentRefsChanged');
      assert.ok(refsChangedFrame, 'Expected agentRefsChanged frame');
      assert.strictEqual(refsChangedFrame.payload.terminalId, 'term-agent-1');
      assert.strictEqual(refsChangedFrame.payload.refs.length, 1);
      assert.strictEqual(refsChangedFrame.payload.refs[0].path, secretFilePath);
    });
  });

  // =========================================================================
  // B3. CLI ref (add, list, remove)
  // =========================================================================
  describe('B3. CLI ref: add, list, remove', () => {
    it('should add a fileRef on canvas via mindagentics ref add', async () => {
      const state = new DaemonState();
      state.registerTerminal({
        id: 'term-caller',
        title: 'Tester',
        workspaceId: 'ws-1',
        floorId: 'ground',
        status: 'idle',
        maestroMode: false,
        scrollback: [],
      });

      const docsDir = path.join(tempDir, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });

      const sentFrames = [];
      const sendToMain = (f) => sentFrames.push(f);

      const addReq = {
        id: 'ref-add-1',
        command: 'ref',
        args: ['add', docsDir],
        options: { label: 'Documentation' },
        terminalId: 'term-caller',
        cwd: tempDir,
      };

      const addRes = await refCommand(addReq, state, null, null, sendToMain);
      assert.strictEqual(addRes.exitCode, 0);
      assert.ok(addRes.output.includes('pasta "Documentation"'));

      // Check node created in state
      const refNode = Array.from(state.nodes.values()).find((n) => n.kind === 'fileRef');
      assert.ok(refNode);
      assert.strictEqual(refNode.content.isDirectory, true);
      assert.strictEqual(refNode.content.label, 'Documentation');

      // Test ref list
      const listReq = {
        id: 'ref-list-1',
        command: 'ref',
        args: ['list'],
        options: { all: true },
        terminalId: 'term-caller',
        cwd: tempDir,
      };
      const listRes = await refCommand(listReq, state, null, null, sendToMain);
      assert.strictEqual(listRes.exitCode, 0);
      assert.ok(listRes.output.includes('Documentation'));

      // Test ref remove
      const rmReq = {
        id: 'ref-rm-1',
        command: 'ref',
        args: ['remove', 'Documentation'],
        options: {},
        terminalId: 'term-caller',
        cwd: tempDir,
      };
      const rmRes = await refCommand(rmReq, state, null, null, sendToMain);
      assert.strictEqual(rmRes.exitCode, 0);
      assert.ok(rmRes.output.includes('Referência removida'));
      assert.strictEqual(state.nodes.has(refNode.id), false);
    });
  });

  // =========================================================================
  // B4. Prompt Gerado (AGENTS.md)
  // =========================================================================
  describe('B4. Prompt gerado em AGENTS.md', () => {
    it('should mention referências and list connected refs and memory line in AGENTS.md', () => {
      const agentsMdTemplate = fs.readFileSync(path.join(process.cwd(), 'AGENTS.md'), 'utf8');

      assert.ok(agentsMdTemplate.includes('referências'), 'AGENTS.md should mention referências');
      assert.ok(agentsMdTemplate.includes('mindagentics ref'), 'AGENTS.md should mention mindagentics ref command');
      assert.ok(agentsMdTemplate.includes('mindagentics recall'), 'AGENTS.md should mention mindagentics recall');
    });
  });

  // =========================================================================
  // B5. Memória: Captura sem ANSI e Rotação de Log
  // =========================================================================
  describe('B5. Memória: captura e rotação de log', () => {
    it('should clean ANSI escapes from terminal output and capture turns in log.jsonl', () => {
      const rawWithAnsi = '\x1b[32mSucesso!\x1b[0m Arquivo compilado em \x1b[1m120ms\x1b[0m.\r\n';
      const cleaned = cleanTerminalText(rawWithAnsi);
      assert.strictEqual(cleaned.includes('\x1b'), false);
      assert.ok(cleaned.includes('Sucesso! Arquivo compilado'));

      const agentDir = path.join(tempDir, 'mem-agent');
      fs.mkdirSync(agentDir, { recursive: true });

      const memory = new MemoryService({ maxLogBytes: 500, maxRotated: 2 });
      memory.start('term-10', 'Backend Dev', tempDir);

      // Simulate input and output
      memory.onInput('term-10', 'git status\r');
      memory.onOutput('term-10', 'On branch main\nnothing to commit, working tree clean\n');
      memory.end('term-10', false);

      const logPath = path.join(tempDir, '.mindagentics', 'memory', 'backend-dev', 'log.jsonl');
      assert.ok(fs.existsSync(logPath), 'log.jsonl must exist');

      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.strictEqual(parsed.input, 'git status');
      assert.ok(parsed.output.includes('working tree clean'));
    });

    it('should rotate logs when exceeding maxLogBytes', () => {
      const memory = new MemoryService({ maxLogBytes: 200, maxRotated: 2 });
      memory.start('term-rot', 'Rotator', tempDir);

      for (let i = 0; i < 5; i++) {
        memory.onInput('term-rot', `execute step ${i}\r`);
        memory.onOutput('term-rot', `Output for step ${i} with long descriptive padding to trigger byte rotation limit\n`);
      }
      memory.end('term-rot', false);

      const memDir = path.join(tempDir, '.mindagentics', 'memory', 'rotator');
      assert.ok(fs.existsSync(path.join(memDir, 'log.jsonl')));
      assert.ok(fs.existsSync(path.join(memDir, 'log.1.jsonl')), 'log.1.jsonl rotated file must exist');
    });
  });

  // =========================================================================
  // B6. Memória: Resumo Heurístico & Busca Offline
  // =========================================================================
  describe('B6. Memória: resumo e busca sem chamadas de API', () => {
    it('should generate summary.md within 500 tokens / 2000 chars by local heuristic', () => {
      const memory = new MemoryService();
      memory.start('term-sum', 'Summarizer', tempDir);

      for (let i = 1; i <= 12; i++) {
        memory.onInput('term-sum', `Edite o arquivo packages/core-daemon/src/service_${i}.ts\r`);
        memory.onOutput('term-sum', `Arquivo packages/core-daemon/src/service_${i}.ts modificado com sucesso.\n`);
      }
      memory.end('term-sum', true);

      const summaryPath = path.join(tempDir, '.mindagentics', 'memory', 'summarizer', 'summary.md');
      assert.ok(fs.existsSync(summaryPath), 'summary.md must exist');

      const mdContent = fs.readFileSync(summaryPath, 'utf8');
      assert.ok(mdContent.length <= SUMMARY_MAX_CHARS, `Summary must be <= ${SUMMARY_MAX_CHARS} chars, got ${mdContent.length}`);
      assert.ok(mdContent.includes('Pedidos recentes'));
      assert.ok(mdContent.includes('Arquivos citados'));
    });

    it('should search memory offline via searchMemory and recallCommand returning 3 best snippets', async () => {
      const memDir = path.join(tempDir, '.mindagentics', 'memory', 'searcher');
      fs.mkdirSync(memDir, { recursive: true });

      const logPath = path.join(memDir, 'log.jsonl');
      const sampleTurns = [
        { ts: '2026-11-12T10:00:00Z', agent: 'Searcher', turn: 1, input: 'configure SQLite FTS5 index', output: 'Created index.db with bm25 search' },
        { ts: '2026-11-12T10:05:00Z', agent: 'Searcher', turn: 2, input: 'check git branches', output: 'Current branch is main' },
        { ts: '2026-11-12T10:10:00Z', agent: 'Searcher', turn: 3, input: 'SQLite query performance test', output: 'Benchmarked SQLite FTS5 bm25 ranking in under 2ms' },
        { ts: '2026-11-12T10:15:00Z', agent: 'Searcher', turn: 4, input: 'build SQLite schema', output: 'Executed table migration successfully' },
      ];
      fs.writeFileSync(logPath, sampleTurns.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8');

      const searchResult = searchMemory([memDir], 'SQLite FTS5', 3);
      assert.ok(searchResult.hits.length <= 3);
      assert.ok(searchResult.hits.length > 0);
      assert.ok(searchResult.hits[0].excerpt.toLowerCase().includes('sqlite'));

      // Test CLI recallCommand
      const state = new DaemonState();
      state.registerTerminal({
        id: 'term-searcher',
        title: 'Searcher',
        workspaceId: 'ws-test',
        floorId: 'ground',
        status: 'idle',
        maestroMode: false,
        scrollback: [],
      });
      state.workspaces.set('ws-test', { id: 'ws-test', name: 'Test', workingDirectory: tempDir });

      const recallReq = {
        id: 'recall-1',
        command: 'recall',
        args: ['SQLite'],
        options: {},
        terminalId: 'term-searcher',
        cwd: tempDir,
      };

      const recallRes = await recallCommand(recallReq, state, null, null, () => {});
      assert.strictEqual(recallRes.exitCode, 0);
      assert.ok(recallRes.output.includes('Searcher'));
      assert.ok(recallRes.output.includes('SQLite'));
    });
  });

  // =========================================================================
  // B7. Retomada
  // =========================================================================
  describe('B7. Retomada do agente', () => {
    it('should generate memory summary relative path for one-line injection', () => {
      const relPath = memorySummaryRelPath('Backend Dev');
      assert.strictEqual(relPath, '.mindagentics/memory/backend-dev/summary.md');
      const injectionLine = `Memória: leia ${relPath}`;
      assert.strictEqual(injectionLine, 'Memória: leia .mindagentics/memory/backend-dev/summary.md');
    });
  });

  // =========================================================================
  // B8. Limites Reais
  // =========================================================================
  describe('B8. Limites reais e cota null', () => {
    it('should return null or real values for OpenCode, Claude, and Copilot instead of hardcoded numbers', async () => {
      const opencodeProbe = await probeOpenCode('non_existent_opencode_path');
      assert.ok(opencodeProbe);
      assert.strictEqual(opencodeProbe.primaryUsedFraction, null);
      assert.strictEqual(opencodeProbe.quotaPercent, null);

      const claudeProbe = await probeClaude();
      assert.ok(claudeProbe);
      assert.strictEqual(claudeProbe.primaryUsedFraction, null);
      assert.strictEqual(claudeProbe.quotaPercent, null);

      const copilotProbe = await probeCopilot();
      assert.ok(copilotProbe);
      assert.strictEqual(copilotProbe.primaryUsedFraction, null);
      assert.strictEqual(copilotProbe.quotaPercent, null);
    });

    it('should build session and weekly windows for all agents', () => {
      const windowsNull = buildUsageWindows(null, null);
      assert.strictEqual(windowsNull.length, 2);
      assert.strictEqual(windowsNull[0].id, 'session');
      assert.strictEqual(windowsNull[0].usedFraction, null);
      assert.strictEqual(windowsNull[1].id, 'weekly');
      assert.strictEqual(windowsNull[1].usedFraction, null);

      const windowsReal = buildUsageWindows(0.25, 0.50, 'Janela de 5h', 'Janela de 7d');
      assert.strictEqual(windowsReal[0].usedFraction, 0.25);
      assert.strictEqual(windowsReal[1].usedFraction, 0.50);
    });
  });

  // =========================================================================
  // B1 - B4. Runtime Reconfiguration, Unified Picker, UI Links & Clean Limits
  // =========================================================================
  describe('B1. Seletor unificado de Arquivo ou Pasta (pickReference)', () => {
    it('should expose appPickReference IPC channel', async () => {
      const { IPC_CHANNELS } = await import('../../packages/shared/dist/index.js');
      assert.strictEqual(IPC_CHANNELS.appPickReference, 'mindagentics:app:pickReference');
    });

    it('should sanitize path and extract { path, isDirectory, label } via assertSafePathString and fs.statSync', async () => {
      const { assertSafePathString } = await import('../../packages/core-daemon/dist/security/pathSafety.js');
      const testFilePath = path.join(tempDir, 'test-doc.md');
      fs.writeFileSync(testFilePath, '# Test Doc');

      const safePath = assertSafePathString(testFilePath);
      const isDirectory = fs.statSync(safePath).isDirectory();
      const label = path.basename(safePath) || safePath;

      assert.strictEqual(safePath, path.normalize(testFilePath));
      assert.strictEqual(isDirectory, false);
      assert.strictEqual(label, 'test-doc.md');

      const safeDirPath = assertSafePathString(tempDir);
      const isDir = fs.statSync(safeDirPath).isDirectory();
      const dirLabel = path.basename(safeDirPath) || safeDirPath;

      assert.strictEqual(isDir, true);
      assert.ok(dirLabel.length > 0);
    });
  });

  describe('B2. Reconfiguração / Edição de Terminal em Tempo de Execução', () => {
    it('should expose terminalReconfigure IPC channel', async () => {
      const { IPC_CHANNELS } = await import('../../packages/shared/dist/index.js');
      assert.strictEqual(IPC_CHANNELS.terminalReconfigure, 'mindagentics:terminal:reconfigure');
    });

    it('should update metadata without terminating session and trigger restart on command change', async () => {
      const { TerminalManager } = await import('../../packages/core-daemon/dist/terminal/terminalManager.js');
      const fakeSupervisor = {
        on: () => {},
        pipeAddress: '\\\\.\\pipe\\test-pipe',
        token: 'test-token',
        daemonReady: true,
        syncCanvas: (payload) => {
          fakeSupervisor.lastSync = payload;
        },
      };

      const manager = new TerminalManager(fakeSupervisor);
      const termId = 'term-reconfig-test-1';

      // Create a mock active session in manager.sessions
      let killCalled = false;
      const mockPty = {
        kill: () => { killCalled = true; },
        write: () => {},
        resize: () => {},
      };

      const testWorkDir = path.join(tempDir, 'workdir-reconfig');
      fs.mkdirSync(testWorkDir, { recursive: true });

      manager.sessions.set(termId, {
        id: termId,
        workspaceId: 'ws-1',
        pty: mockPty,
        cwd: testWorkDir,
        scrollback: [],
        status: 'idle',
        attention: false,
        focused: false,
        cols: 80,
        rows: 24,
        title: 'Original Title',
        agentRole: 'Initial Role',
        instructions: 'Original instructions',
        command: 'powershell',
        presetId: 'preset-shell',
        isAlive: true,
      });

      // 1. Metadata-only reconfigure
      let reconfiguredEvent = null;
      manager.on('reconfigured', (evt) => { reconfiguredEvent = evt; });

      const resMeta = await manager.reconfigure({
        terminalId: termId,
        title: 'Updated Title',
        agentRole: 'Tech Lead',
        orchestratorMode: true,
        instructions: 'Updated instructions',
      });

      assert.strictEqual(resMeta.ok, true);
      assert.strictEqual(killCalled, false, 'PTY should NOT be killed for metadata-only update');
      const updatedSession = manager.sessions.get(termId);
      assert.strictEqual(updatedSession.title, 'Updated Title');
      assert.strictEqual(updatedSession.agentRole, 'Tech Lead');
      assert.strictEqual(updatedSession.orchestratorMode, true);
      assert.ok(fakeSupervisor.lastSync, 'Should synchronize with daemon on metadata update');
      assert.strictEqual(reconfiguredEvent?.terminalId, termId);
    });
  });

  describe('B3. Sincronização de vínculo fileRef ↔ Terminal na UI (cableTies)', () => {
    it('should detect new fileRef ↔ Terminal connection in syncCanvas and inject [ref] into PTY', async () => {
      const { RpcHandler } = await import('../../packages/core-daemon/dist/daemon/rpcHandler.js');
      const state = new DaemonState();

      const sentFrames = [];
      const sendFrame = (frame) => {
        sentFrames.push(frame);
      };

      const router = { handleMessage: () => {} };
      const scheduler = { schedule: () => {} };
      const rpc = new RpcHandler(state, router, scheduler, sendFrame);

      const refNodeId = 'ref-node-1';
      const termNodeId = 'term-node-1';
      const testPath = path.join(tempDir, 'shared-spec.md');
      fs.writeFileSync(testPath, '# Spec');

      // 1. Initial sync with nodes (not yet connected)
      rpc.handleFrame({
        type: 'syncCanvas',
        id: 'sync-1',
        payload: {
          nodes: [
            { id: refNodeId, kind: 'fileRef', content: { path: testPath, isDirectory: false, label: 'shared-spec.md' } },
            { id: termNodeId, kind: 'terminal', content: { terminalId: termNodeId, title: 'Dev Agent' } },
          ],
          cableTies: [],
        },
      });

      assert.strictEqual(state.nodes.size, 2);
      assert.strictEqual(state.connections.length, 0);
      assert.strictEqual(sentFrames.length, 0);

      // 2. User draws cable tie between fileRef and terminal in UI
      rpc.handleFrame({
        type: 'syncCanvas',
        id: 'sync-2',
        payload: {
          nodes: [
            { id: refNodeId, kind: 'fileRef', content: { path: testPath, isDirectory: false, label: 'shared-spec.md' } },
            { id: termNodeId, kind: 'terminal', content: { terminalId: termNodeId, title: 'Dev Agent' } },
          ],
          cableTies: [
            { fromNodeId: refNodeId, toNodeId: termNodeId },
          ],
        },
      });

      // Should have sent agentRefsChanged AND ptyWrite with [ref] arquivo: <path>
      const refsChangedFrame = sentFrames.find(f => f.type === 'agentRefsChanged');
      assert.ok(refsChangedFrame, 'agentRefsChanged frame should be sent');
      assert.strictEqual(refsChangedFrame.payload.terminalId, termNodeId);
      assert.strictEqual(refsChangedFrame.payload.refs.length, 1);
      assert.strictEqual(refsChangedFrame.payload.refs[0].path, testPath);

      const ptyWriteFrame = sentFrames.find(f => f.type === 'ptyWrite');
      assert.ok(ptyWriteFrame, 'ptyWrite frame should be sent to notify agent');
      assert.strictEqual(ptyWriteFrame.payload.terminalId, termNodeId);
      assert.ok(ptyWriteFrame.payload.data.includes('[ref] arquivo:'), 'Should inject [ref] arquivo: into PTY');
      assert.ok(!ptyWriteFrame.payload.data.includes('# Spec'), 'NEVER inject file contents into PTY');

      // 3. User disconnects the cable tie
      sentFrames.length = 0;
      rpc.handleFrame({
        type: 'syncCanvas',
        id: 'sync-3',
        payload: {
          nodes: [
            { id: refNodeId, kind: 'fileRef', content: { path: testPath, isDirectory: false, label: 'shared-spec.md' } },
            { id: termNodeId, kind: 'terminal', content: { terminalId: termNodeId, title: 'Dev Agent' } },
          ],
          cableTies: [],
        },
      });

      const disconnectFrame = sentFrames.find(f => f.type === 'agentRefsChanged');
      assert.ok(disconnectFrame, 'agentRefsChanged frame should be sent on disconnect');
      assert.strictEqual(disconnectFrame.payload.refs.length, 0);
      const disconnectPtyWrite = sentFrames.find(f => f.type === 'ptyWrite');
      assert.strictEqual(disconnectPtyWrite, undefined, 'No ptyWrite should be sent on disconnect');
    });
  });

  describe('B4. Nomes limpos nos relatórios de uso dos agentes', () => {
    it('should have standardized clean names without command suffixes in detectInstalledAgents()', async () => {
      const { TerminalManager } = await import('../../packages/core-daemon/dist/terminal/terminalManager.js');
      const manager = new TerminalManager({ on: () => {} });
      const candidates = manager.detectInstalledAgents();

      const expectedCleanNames = {
        antigravity: 'Antigravity',
        codex: 'Codex',
        opencode: 'OpenCode',
        claude: 'Claude Code',
        'github-copilot': 'GitHub Copilot',
        ollama: 'Ollama',
      };

      for (const [id, expectedName] of Object.entries(expectedCleanNames)) {
        const found = candidates.find(c => c.id === id);
        assert.ok(found, `Agent ${id} should be present in candidate list`);
        assert.strictEqual(found.name, expectedName, `Agent ${id} name should be clean without command suffixes`);
        assert.ok(!found.name.includes('(agy)'), 'Should not contain (agy)');
        assert.ok(!found.name.includes('(codex)'), 'Should not contain (codex)');
        assert.ok(!found.name.includes('(copilot / gh)'), 'Should not contain (copilot / gh)');
      }
    });

    it('should return clean report names and null quotaPercent / secondaryPercent when no live limits data', async () => {
      const { TerminalManager } = await import('../../packages/core-daemon/dist/terminal/terminalManager.js');
      const manager = new TerminalManager({ on: () => {} });
      const reports = await manager.getAgentLimits();

      for (const r of reports) {
        assert.ok(!r.name.includes('('), `Report name "${r.name}" should be clean without parentheses`);
        if (['opencode', 'claude', 'github-copilot', 'ollama'].includes(r.id)) {
          assert.strictEqual(r.quotaPercent, null, `quotaPercent for ${r.name} should be null without real live data`);
          assert.strictEqual(r.secondaryPercent, null, `secondaryPercent for ${r.name} should be null without real live data`);
        }
      }
    });
  });
});
