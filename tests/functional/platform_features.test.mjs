import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const daemonScript = path.resolve(__dirname, '../../packages/core-daemon/dist/index.js');
const cliPath = path.resolve(__dirname, '../../packages/core-daemon/bin/mindagentics.js');
const serveToken = `testfunc${Math.floor(Math.random() * 100000)}`;

let daemonProcess;
let pipeAddress = null;
const frames = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execCli(args, terminalId = 'maestro-term-001', maestro = true) {
  return new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        MINDAGENTICS_PIPE: pipeAddress,
        MINDAGENTICS_TERMINAL_ID: terminalId,
        MINDAGENTICS_WORKSPACE_ID: 'ws-functional-test',
        MINDAGENTICS_FLOOR_ID: 'ground',
        ...(maestro ? { MINDAGENTICS_MAESTRO_MODE: '1' } : {}),
      },
    });

    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString()));
    cp.stderr.on('data', (d) => (stderr += d.toString()));
    cp.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    cp.on('error', reject);
  });
}

describe('mindAgentics Comprehensive Functional & E2E Test Suite', () => {
  before(async () => {
    daemonProcess = spawn(process.execPath, [daemonScript, '--serve', serveToken], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const rl = readline.createInterface({ input: daemonProcess.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const frame = JSON.parse(trimmed);
        frames.push(frame);
        if (frame.type === 'ready') {
          pipeAddress = frame.payload.address;
        }
        if (frame.type === 'deliverPrompt') {
          // Destination agent PTY responds by settling the turn
          const settleFrame = {
            type: 'settleTurn',
            id: `settle-${Date.now()}`,
            payload: {
              terminalId: frame.payload.terminalId,
              output: 'Agent response: Task completed successfully with 100% test validation!',
              askId: frame.payload.askId,
            },
          };
          daemonProcess.stdin.write(JSON.stringify(settleFrame) + '\n');
        }
      } catch {}
    });

    const start = Date.now();
    while (!pipeAddress && Date.now() - start < 8000) {
      await sleep(50);
    }

    if (!pipeAddress) {
      throw new Error('Failed to start daemon and acquire pipe address within 8 seconds.');
    }
  });

  after(() => {
    if (daemonProcess && !daemonProcess.killed) {
      daemonProcess.kill();
    }
  });

  test('1. CLI Status and Diagnostic Debug commands', async () => {
    const statusRes = await execCli(['status']);
    assert.strictEqual(statusRes.code, 0, 'Status exit code must be 0');
    assert.ok(statusRes.stdout.includes('Maestro Mode:  Enabled'), 'Status must indicate Maestro Mode Enabled');
    assert.ok(statusRes.stdout.includes('maestro-term-001'), 'Status must include caller terminal ID');
    assert.ok(statusRes.stdout.includes('Daemon Health: OK'), 'Status must report Daemon Health: OK');

    const debugRes = await execCli(['debug']);
    assert.strictEqual(debugRes.code, 0, 'Debug exit code must be 0');
    assert.ok(debugRes.stdout.includes('=== mindAgentics Diagnostic Report ==='), 'Debug header must be present');
    assert.ok(debugRes.stdout.includes('Pipe Transport:  Active & Connected'), 'Pipe must be active');
    assert.ok(debugRes.stdout.includes('Healthy'), 'Diagnostic health check must pass');
  });

  test('2. CLI Recruit: Agent onboarding & visual node placement on canvas', async () => {
    const recAlpha = await execCli(['recruit', 'Worker Alpha', '--preset', 'Codex', '--role', 'Backend Specialist']);
    assert.strictEqual(recAlpha.code, 0, 'Recruit Worker Alpha exit code must be 0');
    assert.ok(recAlpha.stdout.includes('Recruited teammate "Worker Alpha"'), 'Worker Alpha recruited');
    assert.ok(recAlpha.stdout.includes('Backend Specialist'), 'Role preserved');

    const recBeta = await execCli(['recruit', 'Worker Beta', '--preset', 'OpenCode', '--role', 'Frontend Specialist']);
    assert.strictEqual(recBeta.code, 0, 'Recruit Worker Beta exit code must be 0');
    assert.ok(recBeta.stdout.includes('Recruited teammate "Worker Beta"'), 'Worker Beta recruited');

    await sleep(80);

    const placeFrames = frames.filter((f) => f.type === 'placeNode' && f.payload?.node?.kind === 'terminal');
    assert.ok(placeFrames.length >= 2, 'Should emit placeNode frames for both recruited agent terminals');

    const tieFrames = frames.filter((f) => f.type === 'cableTieCreated');
    assert.ok(tieFrames.length >= 2, 'Should emit cableTieCreated frames auto-connecting recruits to Maestro');
  });

  test('3. CLI Say: Workspace broadcast protocol', async () => {
    const sayRes = await execCli(['say', 'Iniciando sprint de testes integrados']);
    assert.strictEqual(sayRes.code, 0, 'Say exit code must be 0');
    assert.ok(sayRes.stdout.includes('Broadcast from'), 'Must confirm broadcast');
    assert.ok(sayRes.stdout.includes('Iniciando sprint de testes integrados'), 'Must preserve message content');

    const chatFrames = frames.filter((f) => f.type === 'chatProtocolResult' && f.payload?.type === 'say');
    assert.ok(chatFrames.length > 0, 'Must emit chatProtocolResult frame to Main');
    assert.strictEqual(chatFrames[chatFrames.length - 1].payload.message, 'Iniciando sprint de testes integrados');
  });

  test('4. CLI Note: Sticky Notes, NoteStacks (Fichários), Read, Write & Sync', async () => {
    // 4.1 Create standalone Note
    const noteCreate = await execCli([
      'note',
      'create',
      'Platform Architecture',
      '--body',
      'Microkernel core architecture and spatial agent state.',
      '--color',
      'yellow',
    ]);
    assert.strictEqual(noteCreate.code, 0, 'Note create exit code must be 0');
    assert.ok(noteCreate.stdout.includes('Created note "Platform Architecture"'), 'Created note confirmation');

    await sleep(60);
    const notePlaceFrames = frames.filter((f) => f.type === 'placeNode' && f.payload?.node?.kind === 'note');
    assert.ok(notePlaceFrames.length > 0, 'placeNode emitted for Note');

    // 4.2 Create Note inside a NoteStack (Fichário)
    const stackNoteCreate = await execCli([
      'note',
      'create',
      'API Spec',
      '--body',
      'REST and IPC specifications.',
      '--color',
      'blue',
      '--stack',
      'Sprint Documentation',
    ]);
    assert.strictEqual(stackNoteCreate.code, 0, 'Note create with stack exit code must be 0');

    await sleep(60);
    const stackPlaceFrames = frames.filter((f) => f.type === 'placeNode' && f.payload?.node?.kind === 'noteStack');
    assert.ok(stackPlaceFrames.length > 0, 'placeNode emitted for NoteStack (Fichário)');
    const lastStack = stackPlaceFrames[stackPlaceFrames.length - 1].payload.node;
    assert.strictEqual(lastStack.content.title, 'Sprint Documentation', 'Stack title match');
    assert.ok(lastStack.content.pages.some((p) => p.title === 'API Spec'), 'Page included in stack');

    // 4.3 Read Note
    const noteRead = await execCli(['note', 'read', 'Platform Architecture']);
    assert.strictEqual(noteRead.code, 0, 'Note read exit code must be 0');
    assert.ok(noteRead.stdout.includes('Microkernel core architecture'), 'Note body read successfully');

    // 4.4 Write / Edit Note
    const noteWrite = await execCli(['note', 'write', 'Platform Architecture', 'Updated Architecture v2.0 - Verified']);
    assert.strictEqual(noteWrite.code, 0, 'Note write exit code must be 0');

    // 4.5 List Notes
    const noteList = await execCli(['note', 'list']);
    assert.strictEqual(noteList.code, 0, 'Note list exit code must be 0');
    assert.ok(noteList.stdout.includes('Sprint Documentation'), 'NoteStack listed');
  });

  test('5. CLI Portal: Web Portals open, navigate, snapshot and visual sync', async () => {
    // 5.1 Open Portal
    const portalOpen = await execCli([
      'portal',
      'open',
      'https://example.com',
      '--name',
      'Documentation Portal',
    ]);
    assert.strictEqual(portalOpen.code, 0, 'Portal open exit code must be 0');
    assert.ok(portalOpen.stdout.includes('Opened reference portal "Documentation Portal"'), 'Portal opened confirmation');

    await sleep(60);
    const portalPlaceFrames = frames.filter((f) => f.type === 'placeNode' && f.payload?.node?.kind === 'portal');
    assert.ok(portalPlaceFrames.length > 0, 'placeNode emitted for Portal');
    const portalNode = portalPlaceFrames[portalPlaceFrames.length - 1].payload.node;
    assert.strictEqual(portalNode.content.url, 'https://example.com');

    // 5.2 Navigate Portal
    const portalNav = await execCli(['portal', 'navigate', 'Documentation Portal', 'https://example.com/api']);
    assert.strictEqual(portalNav.code, 0, 'Portal navigate exit code must be 0');
    assert.ok(portalNav.stdout.includes('Navigated "Documentation Portal" to https://example.com/api'), 'Navigation confirmed');

    // 5.3 Portal Snapshot / Read
    const portalSnap = await execCli(['portal', 'snapshot', 'Documentation Portal']);
    assert.strictEqual(portalSnap.code, 0, 'Portal snapshot exit code must be 0');
    assert.ok(portalSnap.stdout.includes('url: https://example.com/api'), 'Snapshot contains active URL');
  });

  test('6. CLI Band: Visual grouping bands lifecycle', async () => {
    const bandCreate = await execCli(['band', 'create', 'Engineering Squad', 'Worker Alpha', 'Worker Beta']);
    assert.strictEqual(bandCreate.code, 0, 'Band create exit code must be 0');
    assert.ok(bandCreate.stdout.includes('Created band "Engineering Squad"'), 'Band created confirmation');

    await sleep(60);
    const bandPlaceFrames = frames.filter((f) => f.type === 'placeNode' && f.payload?.node?.kind === 'band');
    assert.ok(bandPlaceFrames.length > 0, 'placeNode emitted for Band');
    const lastBand = bandPlaceFrames[bandPlaceFrames.length - 1].payload.node;
    assert.strictEqual(lastBand.content.title, 'Engineering Squad');
    assert.ok(lastBand.content.memberNodeIds.length >= 2, 'Members assigned to band');
  });

  test('7. Cable Ties: Cross-node visual links and topological integrity', async () => {
    // 7.1 Connect Agent <-> Portal
    const connAgentPortal = await execCli([
      'connect',
      'Worker Beta',
      'Documentation Portal',
      '--label',
      'UI Spec Ref',
    ]);
    assert.strictEqual(connAgentPortal.code, 0, 'Connect agent to portal must succeed');
    assert.ok(connAgentPortal.stdout.includes('Connected "Worker Beta" (agent) <-> "Documentation Portal" (portal)'), 'Endpoint resolution verified');

    // 7.2 Connect Note <-> Portal
    const connNotePortal = await execCli([
      'connect',
      'Platform Architecture',
      'Documentation Portal',
      '--label',
      'Doc Reference',
    ]);
    assert.strictEqual(connNotePortal.code, 0, 'Connect note to portal must succeed');
    assert.ok(connNotePortal.stdout.includes('Connected'), 'Note <-> Portal connected');

    // 7.3 Connect Caller (me) <-> Band
    const connMeBand = await execCli(['connect', 'me', 'Engineering Squad', '--label', 'Squad Lead']);
    assert.strictEqual(connMeBand.code, 0, 'Connect me to band must succeed');
    assert.ok(connMeBand.stdout.includes('Connected "Me" (agent) <-> "Engineering Squad" (band)'), 'Me <-> Band connected');

    await sleep(60);
    const cableFrames = frames.filter((f) => f.type === 'cableTieCreated');
    assert.ok(cableFrames.some((f) => f.payload?.label === 'UI Spec Ref'), 'UI Spec Ref tie frame emitted');
    assert.ok(cableFrames.some((f) => f.payload?.label === 'Doc Reference'), 'Doc Reference tie frame emitted');
    assert.ok(cableFrames.some((f) => f.payload?.label === 'Squad Lead'), 'Squad Lead tie frame emitted');

    // 7.4 Disconnect Cable Tie
    const disconnRes = await execCli([
      'connect',
      'Platform Architecture',
      'Documentation Portal',
      '--disconnect',
    ]);
    assert.strictEqual(disconnRes.code, 0, 'Disconnect must succeed');
    assert.ok(disconnRes.stdout.includes('Disconnected'), 'Disconnection confirmed');

    await sleep(60);
    const delTieFrames = frames.filter((f) => f.type === 'cableTieDeleted');
    assert.ok(delTieFrames.length > 0, 'cableTieDeleted frame emitted to Main');
  });

  test('8. CLI Routine: Scheduled jobs & reminders management', async () => {
    // 8.1 Create Routine
    const routineCreate = await execCli([
      'routine',
      'create',
      'Hourly QA Audit',
      '--command',
      'npm test',
      '--every',
      '1h',
    ]);
    assert.strictEqual(routineCreate.code, 0, 'Routine create exit code must be 0');
    assert.ok(routineCreate.stdout.includes('Scheduled routine "Hourly QA Audit"'), 'Routine scheduled confirmation');

    // 8.2 List Routines
    const routineList = await execCli(['routine', 'list']);
    assert.strictEqual(routineList.code, 0, 'Routine list exit code must be 0');
    assert.ok(routineList.stdout.includes('Hourly QA Audit'), 'Created routine listed');

    // 8.3 Delete Routine
    const routineDel = await execCli(['routine', 'delete', 'Hourly QA Audit']);
    assert.strictEqual(routineDel.code, 0, 'Routine delete exit code must be 0');
    assert.ok(routineDel.stdout.includes('Deleted routine "Hourly QA Audit"'), 'Routine deleted confirmation');
  });

  test('9. CLI Floor: Isolated worktrees and status reporting', async () => {
    // 9.1 Create Floor
    const floorCreate = await execCli([
      'floor',
      'create',
      'Canvas-Optimization',
      '--branch',
      'perf/canvas-spatial',
    ]);
    assert.strictEqual(floorCreate.code, 0, 'Floor create exit code must be 0');
    assert.ok(floorCreate.stdout.includes('Created floor "Canvas-Optimization"'), 'Floor created confirmation');

    await sleep(60);
    const floorFrames = frames.filter((f) => f.type === 'floorCreate');
    assert.ok(floorFrames.length > 0, 'floorCreate frame emitted to Main');

    // 9.2 Post Floor Status
    const floorStatus = await execCli(['floor', 'status', 'Tests passing 100%', '--state', 'working', '--progress', '5/5']);
    assert.strictEqual(floorStatus.code, 0, 'Floor status exit code must be 0');
    assert.ok(floorStatus.stdout.includes('Posted floor status: [working]'), 'Floor status confirmed');

    // 9.3 List Floors
    const floorList = await execCli(['floor', 'list']);
    assert.strictEqual(floorList.code, 0, 'Floor list exit code must be 0');
    assert.ok(floorList.stdout.includes('Canvas-Optimization'), 'Custom floor listed');
  });

  test('10. CLI List: Complete canvas inventory check', async () => {
    const listRes = await execCli(['list']);
    assert.strictEqual(listRes.code, 0, 'List exit code must be 0');

    // Verify all active components are listed
    assert.ok(listRes.stdout.includes('Worker Alpha'), 'Worker Alpha listed');
    assert.ok(listRes.stdout.includes('Worker Beta'), 'Worker Beta listed');
    assert.ok(listRes.stdout.includes('Documentation Portal'), 'Portal listed');
    assert.ok(listRes.stdout.includes('Engineering Squad'), 'Band listed');
  });

  test('11. Maestro Mode: Delegation (ask), PTY delivery & Turn Settlement', async () => {
    const askRes = await execCli([
      'ask',
      'Worker Alpha',
      'Execute QA security scan and report coverage status',
    ]);

    assert.strictEqual(askRes.code, 0, 'Ask exit code must be 0');
    assert.ok(
      askRes.stdout.includes('Agent response: Task completed successfully with 100% test validation!'),
      'Delivered response must match settled turn output from simulated agent PTY'
    );

    const deliverFrames = frames.filter((f) => f.type === 'deliverPrompt');
    assert.ok(deliverFrames.length > 0, 'deliverPrompt frame must be emitted to destination agent');
    const lastPrompt = deliverFrames[deliverFrames.length - 1];
    assert.ok(lastPrompt.payload.prompt.includes('Execute QA security scan'), 'Prompt text preserved in payload');
    assert.strictEqual(lastPrompt.payload.fromTerminalId, 'maestro-term-001', 'Caller terminal ID preserved');
  });

  test('12. Lifecycle Cleanup: Node removal, cable tie cascade & canvas state reconciliation', async () => {
    // 12.1 Close Portal
    const portalClose = await execCli(['portal', 'close', 'Documentation Portal']);
    assert.strictEqual(portalClose.code, 0, 'Portal close exit code must be 0');
    assert.ok(portalClose.stdout.includes('Closed portal "Documentation Portal"'), 'Portal closed confirmation');

    // 12.2 Delete Note
    const noteDel = await execCli(['note', 'delete', 'Updated Architecture v2.0 - Verified']);
    assert.strictEqual(noteDel.code, 0, 'Note delete exit code must be 0');
    assert.ok(noteDel.stdout.includes('Deleted note'), 'Note deleted confirmation');

    // 12.3 Dissolve Band
    const bandDissolve = await execCli(['band', 'dissolve', 'Engineering Squad']);
    assert.strictEqual(bandDissolve.code, 0, 'Band dissolve exit code must be 0');
    assert.ok(bandDissolve.stdout.includes('Dissolved band "Engineering Squad"'), 'Band dissolved confirmation');

    await sleep(60);
    const deleteFrames = frames.filter((f) => f.type === 'deleteNode');
    assert.ok(deleteFrames.length >= 3, 'deleteNode frames emitted for Portal, Note, and Band');
  });
});
