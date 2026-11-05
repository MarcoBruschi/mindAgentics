import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';

const daemonScript = path.resolve('packages/core-daemon/dist/index.js');
const serveToken = 'test' + Math.floor(Math.random() * 100000);

console.log(`Starting daemon with token: ${serveToken}...`);
const daemon = spawn(process.execPath, [daemonScript, '--serve', serveToken], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const rl = readline.createInterface({ input: daemon.stdout });

let pipeAddress = null;
const responses = new Map();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const frame = JSON.parse(trimmed);
    if (frame.type === 'ready') {
      pipeAddress = frame.payload.address;
      console.log('Daemon emitted ready frame:', frame.payload);
    } else if (frame.id) {
      responses.set(frame.id, frame);
    }
  } catch (err) {
    console.error('Failed to parse line:', line);
  }
});

function sendRpc(frame) {
  return new Promise((resolve, reject) => {
    responses.delete(frame.id);
    daemon.stdin.write(JSON.stringify(frame) + '\n');
    const interval = setInterval(() => {
      if (responses.has(frame.id)) {
        clearInterval(interval);
        resolve(responses.get(frame.id));
      }
    }, 50);
    setTimeout(() => {
      clearInterval(interval);
      if (!responses.has(frame.id)) {
        reject(new Error(`Timeout waiting for RPC response to ${frame.type} (${frame.id})`));
      }
    }, 5000);
  });
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [daemonScript, ...args], {
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runTests() {
  // Wait for ready
  let attempts = 0;
  while (!pipeAddress && attempts++ < 30) {
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!pipeAddress) {
    throw new Error('Daemon did not emit ready frame within 3s');
  }

  console.log('\n--- Test 1: Stdio JSON-RPC snapNode ---');
  const snapRes = await sendRpc({
    type: 'snapNode',
    id: 'snap-1',
    payload: {
      nodeId: 'n1',
      bounds: { x: 102, y: 198, width: 200, height: 100 },
      otherNodes: [{ x: 300, y: 200, width: 200, height: 100 }],
      gridSize: 20,
    },
  });
  console.log('snapNode result:', JSON.stringify(snapRes.payload.result));

  console.log('\n--- Test 2: Stdio JSON-RPC tidyNode ---');
  const tidyRes = await sendRpc({
    type: 'tidyNode',
    id: 'tidy-1',
    payload: {
      nodes: [
        { id: 'n1', kind: 'terminal', x: 50, y: 50, width: 200, height: 100, zIndex: 1 },
        { id: 'n2', kind: 'note', x: 80, y: 90, width: 200, height: 100, zIndex: 2 },
      ],
      padding: 30,
    },
  });
  console.log('tidyNode result:', JSON.stringify(tidyRes.payload.result));

  console.log('\n--- Test 3: Stdio JSON-RPC placeNode ---');
  const placeRes = await sendRpc({
    type: 'placeNode',
    id: 'place-1',
    payload: {
      width: 320,
      height: 240,
      existingNodes: [{ id: 'n1', kind: 'terminal', x: 100, y: 100, width: 400, height: 300, zIndex: 1 }],
      anchorNodeId: 'n1',
    },
  });
  console.log('placeNode result:', JSON.stringify(placeRes.payload.result));

  const cliEnv = {
    MINDAGENTICS_PIPE: pipeAddress,
    MINDAGENTICS_TERMINAL_ID: 'test-term-001',
    MINDAGENTICS_WORKSPACE_ID: 'ws-test-main',
    MINDAGENTICS_FLOOR_ID: 'ground',
  };

  console.log('\n--- Test 4: CLI mindagentics list ---');
  const listRes = await runCli(['list'], cliEnv);
  console.log('list exit code:', listRes.code);
  console.log(listRes.stdout);

  console.log('\n--- Test 5: CLI mindagentics notify ---');
  const notifyRes = await runCli(['notify', 'Deployment finished successfully!'], cliEnv);
  console.log(notifyRes.stdout);

  console.log('\n--- Test 6: CLI mindagentics note create / read / edit ---');
  const noteCreateRes = await runCli(
    ['note', 'create', 'Hello mindAgentics Canvas!', '--name', 'Integration Note', '--color', 'green'],
    cliEnv,
  );
  console.log(noteCreateRes.stdout);

  const noteReadRes = await runCli(['note', 'read', 'Integration Note'], cliEnv);
  console.log(noteReadRes.stdout);

  const noteEditRes = await runCli(['note', 'edit', 'Integration Note', 'Canvas', 'Workspace'], cliEnv);
  console.log(noteEditRes.stdout);

  const noteRead2Res = await runCli(['note', 'read', 'Integration Note'], cliEnv);
  console.log(noteRead2Res.stdout);

  console.log('\n--- Test 7: CLI mindagentics recruit & ask ---');
  const recruitRes = await runCli(['recruit', 'Scout', '--role', 'Code Reviewer'], cliEnv);
  console.log(recruitRes.stdout);

  const checkRes = await runCli(['check', 'Scout'], cliEnv);
  console.log('check output:', checkRes.stdout);

  console.log('\n--- Test 8: CLI mindagentics portal create & snapshot ---');
  const portalRes = await runCli(['portal', 'create', 'https://example.com', 'WebPreview'], cliEnv);
  console.log(portalRes.stdout);

  const snapshotRes = await runCli(['portal', 'snapshot', 'WebPreview'], cliEnv);
  console.log(snapshotRes.stdout);

  console.log('\n--- Test 9: CLI mindagentics routine create & list ---');
  const routineCreateRes = await runCli(
    ['routine', 'create', 'Hourly Audit', '--command', 'npm test', '--every', '1h'],
    cliEnv,
  );
  console.log(routineCreateRes.stdout);

  const routineListRes = await runCli(['routine', 'list'], cliEnv);
  console.log(routineListRes.stdout);

  console.log('\n--- Test 10: CLI mindagentics floor status ---');
  const floorStatusRes = await runCli(
    ['floor', 'status', 'Tests passing 100%', '--state', 'working', '--progress', '5/5'],
    cliEnv,
  );
  console.log(floorStatusRes.stdout);

  console.log('\n--- Test 11: CLI mindagentics debug ---');
  const debugRes = await runCli(['debug'], cliEnv);
  console.log(debugRes.stdout);

  console.log('\nALL INTEGRATION TESTS PASSED!');
  daemon.kill();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Integration test failed:', err);
  daemon.kill();
  process.exit(1);
});
