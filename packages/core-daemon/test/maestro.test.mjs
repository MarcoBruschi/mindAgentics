import { spawn } from 'node:child_process';
import path from 'node:path';
import * as readline from 'node:readline';

const daemonScript = path.resolve('packages/core-daemon/dist/index.js');
const cliPath = path.resolve('packages/core-daemon/bin/maestri.js');
const serveToken = 'testmaestro' + Math.floor(Math.random() * 100000);

console.log(`Starting daemon with token: ${serveToken}...`);
const daemon = spawn(process.execPath, [daemonScript, '--serve', serveToken], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const rl = readline.createInterface({ input: daemon.stdout });
let pipeAddress = null;

function execCli(args) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        MAESTRI_PIPE: pipeAddress,
        MAESTRI_TERMINAL_ID: 'maestro-term-001',
        MAESTRI_WORKSPACE_ID: 'ws-maestro',
        MAESTRI_MAESTRO_MODE: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString()));
    cp.stderr.on('data', (d) => (stderr += d.toString()));
    cp.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const frame = JSON.parse(trimmed);
    if (frame.type === 'ready') {
      pipeAddress = frame.payload.address;
      console.log('Daemon emitted ready frame:', frame.payload);

      // 1. Status Check
      const stRes = await execCli(['status']);
      console.log('\n--- Test 1: Status Check ---');
      console.log(stRes.stdout);
      if (!stRes.stdout.includes('Maestro Mode:  Enabled')) {
        console.error('FAILED: Status does not report Maestro Mode Enabled');
        process.exit(1);
      }

      // 2. Open Reference Portal
      console.log('\n--- Test 2: maestri portal open ---');
      const openRes = await execCli(['portal', 'open', 'https://example.com', '--name', 'Doc Reference']);
      console.log(openRes.stdout);
      if (openRes.code !== 0 || !openRes.stdout.includes('Doc Reference')) {
        console.error('FAILED: portal open did not succeed');
        process.exit(1);
      }

      // 3. Recruit specialized agent
      console.log('\n--- Test 3: maestri recruit ---');
      const recruitRes = await execCli(['recruit', 'Researcher', '--preset', 'Antigravity', '--role', 'Web Analyst']);
      console.log(recruitRes.stdout);
      if (recruitRes.code !== 0 || !recruitRes.stdout.includes('Researcher')) {
        console.error('FAILED: recruit did not succeed');
        process.exit(1);
      }

      // 4. Connect Researcher to Doc Reference
      console.log('\n--- Test 4: maestri connect Agent to Portal ---');
      const connRes = await execCli(['connect', 'Researcher', 'Doc Reference']);
      console.log(connRes.stdout);
      if (connRes.code !== 0 || !connRes.stdout.includes('Connected')) {
        console.error('FAILED: connect did not succeed');
        process.exit(1);
      }

      // 5. Verify list output
      console.log('\n--- Test 5: maestri list ---');
      const listRes = await execCli(['list']);
      console.log(listRes.stdout);
      if (!listRes.stdout.includes('Doc Reference') || !listRes.stdout.includes('Researcher')) {
        console.error('FAILED: list does not show created nodes');
        process.exit(1);
      }

      console.log('\n>>> ALL MAESTRO TESTS PASSED! <<<');
      daemon.kill();
      process.exit(0);
    }
  } catch (err) {
    // ignore
  }
});
