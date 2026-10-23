import { spawn } from 'node:child_process';
import * as net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const daemonScript = path.resolve(__dirname, '../bin/maestri.js');

const token = `testportal${Math.floor(Math.random() * 100000)}`;

console.log(`Starting daemon for portal visualization test with token: ${token}...`);

const daemon = spawn(process.execPath, [daemonScript, '--serve', token], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let pipeAddress = '';
const frames = [];

daemon.stdout.on('data', (chunk) => {
  const lines = chunk.toString('utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const frame = JSON.parse(trimmed);
      frames.push(frame);
      if (frame.type === 'ready') {
        pipeAddress = frame.payload.address;
      }
    } catch (e) {
      // non json
    }
  }
});

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendCommand(argv, terminalId = 'test-term') {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(pipeAddress, () => {
      const req = {
        id: `req-${Date.now()}`,
        command: argv[0],
        args: argv.slice(1),
        options: {},
        terminalId,
        workspaceId: 'ws-main',
        floorId: 'floor-main',
      };
      client.write(JSON.stringify(req) + '\n');
    });

    let buffer = '';
    client.on('data', (d) => {
      buffer += d.toString('utf8');
      if (buffer.includes('\n')) {
        const line = buffer.split('\n')[0].trim();
        const res = JSON.parse(line);
        client.end();
        resolve(res);
      }
    });

    client.on('error', reject);
  });
}

async function run() {
  while (!pipeAddress) {
    await sleep(50);
  }

  console.log('Daemon pipe connected:', pipeAddress);

  // 1. First sync canvas with a terminal node (e.g. Maestro)
  const syncFrame = {
    type: 'syncCanvas',
    payload: {
      workspaceId: 'ws-main',
      floorId: 'floor-main',
      nodes: [
        {
          id: 'node-term-maestro',
          kind: 'terminal',
          x: 200,
          y: 200,
          width: 600,
          height: 400,
          content: {
            terminalId: 'term-maestro',
            title: 'Maestro',
            maestroMode: true,
          },
        },
      ],
      cableTies: [],
    },
  };
  daemon.stdin.write(JSON.stringify(syncFrame) + '\n');
  await sleep(100);

  // 2. Open portal with YouTube
  console.log('Running: maestri portal open "https://youtube.com" --name "YouTube"');
  const res = await sendCommand(['portal', 'open', 'https://youtube.com', 'YouTube'], 'term-maestro');
  console.log('Portal response:', res.output);

  await sleep(150);

  // Check frames emitted by daemon
  const placeFrames = frames.filter((f) => f.type === 'placeNode');
  const tieFrames = frames.filter((f) => f.type === 'cableTieCreated');

  console.log('Total placeNode frames received:', placeFrames.length);
  console.log('Total cableTieCreated frames received:', tieFrames.length);

  if (placeFrames.length === 0) {
    throw new Error('Expected at least one placeNode frame!');
  }
  const portalNode = placeFrames[0].payload.node;
  console.log('Placed Node:', {
    id: portalNode.id,
    kind: portalNode.kind,
    url: portalNode.content.url,
    title: portalNode.content.title,
    x: portalNode.x,
    y: portalNode.y,
  });

  if (portalNode.content.url !== 'https://youtube.com' || portalNode.content.title !== 'YouTube') {
    throw new Error('Portal node payload mismatch!');
  }
  if (typeof portalNode.x !== 'number' || typeof portalNode.y !== 'number' || isNaN(portalNode.x) || isNaN(portalNode.y)) {
    throw new Error('Portal node coordinates are invalid numbers!');
  }

  // 3. Connect Maestro to YouTube
  console.log('Running: maestri connect "Maestro" "YouTube"');
  const connectRes = await sendCommand(['connect', 'Maestro', 'YouTube'], 'term-maestro');
  console.log('Connect response:', connectRes.output);

  await sleep(150);

  const updatedTieFrames = frames.filter((f) => f.type === 'cableTieCreated');
  console.log('Updated cableTieCreated frames:', updatedTieFrames.length);

  const lastTie = updatedTieFrames[updatedTieFrames.length - 1];
  console.log('Last cable tie payload:', lastTie.payload);

  if (lastTie.payload.fromNodeId !== 'node-term-maestro' || lastTie.payload.toNodeId !== portalNode.id) {
    throw new Error(`Cable tie endpoints mismatch! Got from=${lastTie.payload.fromNodeId}, to=${lastTie.payload.toNodeId}`);
  }

  console.log('>>> PORTAL VISUALIZATION VERIFICATION PASSED SUCCESSFULLY! <<<');
  daemon.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error('Test failed:', err);
  daemon.kill();
  process.exit(1);
});
