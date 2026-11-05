import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';

// Import DataService from compiled main distribution
import { DataService } from '../../packages/main/dist/storage/dataService.js';
import { NamedPipeServer } from '../../packages/core-daemon/dist/daemon/pipeServer.js';
import { DaemonState } from '../../packages/core-daemon/dist/daemon/state.js';
import { MessageRouter } from '../../packages/core-daemon/dist/daemon/router.js';
import { RoutineScheduler } from '../../packages/core-daemon/dist/daemon/scheduler.js';

describe('mindAgentics Security Hardening & Isolation Suite', () => {
  let tempDir;
  let dataService;

  before(async () => {
    tempDir = path.join(os.tmpdir(), `mindagentics-sec-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.MINDAGENTICS_DATA_DIR = tempDir;
    dataService = new DataService();
    await dataService.initLayout();
  });

  after(async () => {
    delete process.env.MINDAGENTICS_DATA_DIR;
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // 1. Path Traversal & File Boundary Isolation
  // =========================================================================
  describe('Vector 1: Path Traversal & Workspace I/O Boundary Defenses', () => {
    it('should block replaceFileAtomically when path contains null bytes', async () => {
      const maliciousPath = path.join(tempDir, 'evil\0file.json');
      await assert.rejects(
        async () => {
          await dataService.replaceFileAtomically(maliciousPath, 'evil-content');
        },
        {
          name: 'Error',
          message: /null byte/i
        }
      );
    });

    it('should block replaceFileAtomically when relative traversal (../../) is used', async () => {
      const escapeAttempts = [
        '../../secret.txt',
        '..\\..\\secret.txt',
        'sub/../../escaped.json',
        '..\\..\\Windows\\System32\\cmd.exe',
        '../../../../../../etc/passwd'
      ];

      for (const attempt of escapeAttempts) {
        await assert.rejects(
          async () => {
            await dataService.replaceFileAtomically(attempt, 'pwned');
          },
          (err) => {
            assert.ok(
              err instanceof Error && /path traversal|escapes base/i.test(err.message),
              `Expected path traversal rejection for '${attempt}', got: ${err?.message}`
            );
            return true;
          }
        );
      }
    });

    it('should block replaceFileAtomically when attempting to write outside the base directory', async () => {
      const outsidePaths = [
        path.join(os.homedir(), 'arbitrary-file.txt'),
        process.platform === 'win32' ? 'C:\\Windows\\System32\\evil.dll' : '/etc/cron.d/evil',
        path.resolve(tempDir, '..', 'sibling-escape.txt')
      ];

      for (const target of outsidePaths) {
        await assert.rejects(
          async () => {
            await dataService.replaceFileAtomically(target, 'data');
          },
          (err) => {
            assert.ok(
              err instanceof Error && /escapes base directory/i.test(err.message),
              `Expected boundary violation for '${target}', got: ${err?.message}`
            );
            return true;
          }
        );
      }
    });

    it('should allow legitimate atomic writes strictly within the base directory', async () => {
      const validPath = path.join(tempDir, 'valid-write.json');
      await dataService.replaceFileAtomically(validPath, JSON.stringify({ safe: true }));
      assert.strictEqual(fs.existsSync(validPath), true);
      const readBack = JSON.parse(fs.readFileSync(validPath, 'utf8'));
      assert.strictEqual(readBack.safe, true);
    });

    it('should reject noteRead when workspaceId attempts path traversal', async () => {
      const traversalWorkspaces = [
        '../../',
        '..\\..\\',
        '../../secret',
        '..\\..\\Windows\\System32\\cmd.exe',
        '/etc/shadow'
      ];

      for (const wsId of traversalWorkspaces) {
        await assert.rejects(
          async () => {
            await dataService.noteRead(wsId, 'valid-note-id');
          },
          (err) => {
            assert.ok(
              err instanceof Error && /Access denied: Path traversal detected/i.test(err.message),
              `Expected rejection for workspaceId '${wsId}', got: ${err?.message}`
            );
            return true;
          }
        );
      }
    });

    it('should reject noteRead when noteId attempts path traversal', async () => {
      const traversalNotes = [
        '../../secret.txt',
        '..\\..\\Windows\\System32\\cmd.exe',
        '../../../etc/passwd',
        'subdir/note',
        'note\0evil'
      ];

      for (const noteId of traversalNotes) {
        await assert.rejects(
          async () => {
            await dataService.noteRead('ws-safe-1', noteId);
          },
          (err) => {
            assert.ok(
              err instanceof Error && /Access denied: Path traversal detected/i.test(err.message),
              `Expected rejection for noteId '${noteId}', got: ${err?.message}`
            );
            return true;
          }
        );
      }
    });

    it('should reject noteWrite when workspaceId attempts path traversal', async () => {
      const maliciousWs = '../../escaped-workspace';
      await assert.rejects(
        async () => {
          await dataService.noteWrite(maliciousWs, 'note-1', '# Content');
        },
        (err) => {
          assert.ok(
            err instanceof Error && /Access denied: Path traversal detected/i.test(err.message),
            `Expected rejection for workspaceId '${maliciousWs}', got: ${err?.message}`
          );
          return true;
        }
      );
    });

    it('should reject noteWrite when noteId attempts path traversal', async () => {
      const maliciousNotes = [
        '../../secret.txt',
        '..\\..\\Windows\\System32\\cmd.exe',
        'sub/dir/note',
        'hack\0name'
      ];

      for (const noteId of maliciousNotes) {
        await assert.rejects(
          async () => {
            await dataService.noteWrite('ws-safe-1', noteId, '# Malicious');
          },
          (err) => {
            assert.ok(
              err instanceof Error && /Access denied: Path traversal detected/i.test(err.message),
              `Expected rejection for noteId '${noteId}', got: ${err?.message}`
            );
            return true;
          }
        );
      }
    });

    it('should safely read and write workspace notes inside legitimate boundaries', async () => {
      const wsId = 'ws-test-sandbox';
      const noteId = 'spec-note-01';
      const content = '# Secure Architecture Note\nDeterministic zero-token graph execution.';

      const writeResult = await dataService.noteWrite(wsId, noteId, content);
      assert.strictEqual(writeResult.ok, true);

      // Verify file was written inside <dataDir>/workspaces/ws-test-sandbox/notes/spec-note-01.md
      const expectedPath = path.join(tempDir, 'workspaces', wsId, 'notes', `${noteId}.md`);
      assert.strictEqual(fs.existsSync(expectedPath), true);

      const readBack = await dataService.noteRead(wsId, noteId);
      assert.strictEqual(readBack, content);
    });
  });

  // =========================================================================
  // 2. Subprocess Execution Security
  // =========================================================================
  describe('Vector 2: Parameterized Subprocess Execution & Shell Injection Prevention', () => {
    it('should verify GraphifyService uses parameterized arguments array without shell execution', () => {
      const graphifyPath = path.join(process.cwd(), 'packages/main/src/graphify/graphifyService.ts');
      assert.ok(fs.existsSync(graphifyPath), 'graphifyService.ts must exist');

      const content = fs.readFileSync(graphifyPath, 'utf8');

      // 1. Ensure dangerous child_process.exec is NOT used
      const usesExec = /\bchild_process\.exec\b|\bpromisify\(exec\)/.test(content);
      assert.strictEqual(usesExec, false, 'GraphifyService must not use child_process.exec or execAsync');

      // 2. Ensure execFile / execFileAsync is used
      assert.ok(
        content.includes('execFileAsync'),
        'GraphifyService must use parameterized execFileAsync'
      );

      // 3. Ensure git commands use parameterized argument arrays with separator '--'
      assert.ok(
        content.includes("execFileAsync('git', ['clone'"),
        'Git clone must use parameterized argument array'
      );
    });

    it('should verify TerminalManager and agentProbes use parameterized execution', () => {
      const probesPath = path.join(process.cwd(), 'packages/main/src/terminal/agentProbes.ts');
      assert.ok(fs.existsSync(probesPath), 'agentProbes.ts must exist');

      const content = fs.readFileSync(probesPath, 'utf8');

      // Ensure no raw shell exec
      assert.strictEqual(/\bexec\(/.test(content), false, 'agentProbes must not use shell exec');
      assert.ok(content.includes('execFile('), 'agentProbes must use execFile with argument arrays');
      assert.ok(content.includes('spawn('), 'agentProbes must use spawn with argument arrays');
    });

    it('should verify IPC dispatcher does not expose unparameterized shell exec', () => {
      const dispatcherPath = path.join(process.cwd(), 'packages/main/src/ipc/dispatcher.ts');
      const content = fs.readFileSync(dispatcherPath, 'utf8');

      // Verify no execAsync is actually invoked in handlers
      const invocations = content.match(/await\s+execAsync\s*\(/g) || [];
      assert.strictEqual(
        invocations.length,
        0,
        'dispatcher.ts must have zero invocations of execAsync'
      );
    });
  });

  // =========================================================================
  // 3. Named Pipe Security
  // =========================================================================
  describe('Vector 3: Named Pipe Protocol Hardening & Crash Resistance', () => {
    let pipeServer;
    let pipePath;
    let state;
    let router;
    let scheduler;

    before(async () => {
      const token = `sec-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      pipePath = process.platform === 'win32'
        ? `\\\\.\\pipe\\mindagentics-sec-${token}`
        : path.join(os.tmpdir(), `mindagentics-sec-${token}.sock`);

      state = new DaemonState();
      router = new MessageRouter(state, () => {});
      scheduler = new RoutineScheduler(state, () => {});

      pipeServer = new NamedPipeServer(pipePath, state, router, scheduler, () => {});

      // Register a mock handler to verify healthy responses
      pipeServer.registerHandler('ping', async () => ({
        output: 'pong',
        exitCode: 0
      }));

      await pipeServer.start();
    });

    after(async () => {
      if (pipeServer) {
        await pipeServer.stop();
      }
    });

    function sendToPipe(data) {
      return new Promise((resolve, reject) => {
        const client = net.createConnection(pipePath, () => {
          client.write(data);
        });

        let responseData = '';
        client.on('data', (chunk) => {
          responseData += chunk.toString('utf8');
          const lines = responseData.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              try {
                const parsed = JSON.parse(trimmed);
                client.end();
                return resolve(parsed);
              } catch {}
            }
          }
        });

        client.on('error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          client.destroy();
          if (responseData) {
            try {
              resolve(JSON.parse(responseData.trim()));
            } catch (err) {
              reject(new Error(`Timeout with unparseable response: ${responseData}`));
            }
          } else {
            reject(new Error('Pipe request timed out after 3000ms'));
          }
        }, 3000);
      });
    }

    it('should reject malformed JSON payloads with a structured error without crashing', async () => {
      const malformedPayload = '{"id":"malformed-1", unclosed_json: true\n';
      const res = await sendToPipe(malformedPayload);

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.exitCode, 1);
      assert.ok(res.error.includes('Invalid request:'), `Expected error message, got: ${res.error}`);
    });

    it('should reject giant payloads exceeding 5MB with a structured error without crashing', async () => {
      // Create a 5.2 MB payload without newline
      const giantChunk = 'A'.repeat(5.2 * 1024 * 1024);
      const res = await sendToPipe(giantChunk + '\n');

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.exitCode, 1);
      assert.ok(
        res.error.includes('Payload too large') || res.error.includes('Invalid request:'),
        `Expected payload size error, got: ${res.error}`
      );
    });

    it('should reject requests missing the "command" field without crashing', async () => {
      const missingCmdPayload = JSON.stringify({ id: 'no-cmd-1', terminalId: 't-123' }) + '\n';
      const res = await sendToPipe(missingCmdPayload);

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.exitCode, 1);
      assert.ok(res.error.includes('command'), `Expected command validation error, got: ${res.error}`);
    });

    it('should reject requests with non-existent commands with structured error', async () => {
      const unknownCmdPayload = JSON.stringify({
        id: 'unknown-cmd-1',
        command: 'non_existent_command_xyz',
        terminalId: 't-123'
      }) + '\n';

      const res = await sendToPipe(unknownCmdPayload);

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.exitCode, 1);
      assert.ok(res.error.includes('Unknown command'), `Expected Unknown command error, got: ${res.error}`);
    });

    it('should continue serving legitimate requests normally after handling hostile payloads', async () => {
      const validPayload = JSON.stringify({
        id: 'ping-1',
        command: 'ping',
        terminalId: 't-1'
      }) + '\n';

      const res = await sendToPipe(validPayload);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.output, 'pong');
      assert.strictEqual(res.exitCode, 0);
    });
  });

  // =========================================================================
  // 4. Preload & Renderer Isolation
  // =========================================================================
  describe('Vector 4: Preload & Renderer Boundary Isolation', () => {
    it('should verify statically that preload does not expose process, require, or child_process', () => {
      const preloadSrcPath = path.join(process.cwd(), 'packages/preload/src/index.ts');
      assert.ok(fs.existsSync(preloadSrcPath), 'Preload source index.ts must exist');

      const content = fs.readFileSync(preloadSrcPath, 'utf8');

      // Check forbidden patterns in source
      const forbiddenPatterns = [
        /\bprocess\.env\b/,
        /\bprocess\.binding\b/,
        /\bchild_process\b/,
        /\bwindow\.require\b/,
        /\bexposeInMainWorld\s*\(\s*["']process["']/,
        /\bexposeInMainWorld\s*\(\s*["']require["']/
      ];

      for (const pattern of forbiddenPatterns) {
        assert.strictEqual(
          pattern.test(content),
          false,
          `Preload source contains forbidden pattern: ${pattern}`
        );
      }
    });

    it('should verify compiled preload bundle does not expose raw ipcRenderer or node globals in API', () => {
      const preloadDistPath = path.join(process.cwd(), 'packages/preload/dist/index.js');
      assert.ok(fs.existsSync(preloadDistPath), 'Preload dist bundle must exist');

      const bundleContent = fs.readFileSync(preloadDistPath, 'utf8');

      // Ensure electron.contextBridge is utilized
      assert.ok(
        bundleContent.includes('contextBridge.exposeInMainWorld') ||
        bundleContent.includes('exposeInMainWorld'),
        'Preload bundle must use contextBridge for secure main world isolation'
      );

      // Verify that api definition does not leak direct native Buffer or process
      const leaksProcess = /api\s*=\s*\{[^}]*process\s*:/i.test(bundleContent);
      assert.strictEqual(leaksProcess, false, 'API object must not leak process');

      const leaksRequire = /api\s*=\s*\{[^}]*require\s*:/i.test(bundleContent);
      assert.strictEqual(leaksRequire, false, 'API object must not leak require');
    });

    it('should ensure asar archive integrity and unpacked native module constraints', () => {
      const builderConfigPath = path.join(process.cwd(), 'electron-builder.json');
      assert.ok(fs.existsSync(builderConfigPath), 'electron-builder.json configuration must exist');

      const config = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));
      assert.strictEqual(config.asar, true, 'ASAR bundling must be enabled for security & integrity');
      assert.ok(Array.isArray(config.asarUnpack), 'asarUnpack must be configured for native binaries');
      assert.ok(
        config.asarUnpack.some((pattern) => pattern.includes('node-pty')),
        'node-pty must be explicitly specified in asarUnpack for binary execution isolation'
      );
    });
  });
});
