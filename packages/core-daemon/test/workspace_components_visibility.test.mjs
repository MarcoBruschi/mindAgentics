import { spawn } from 'node:child_process';
import * as net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const daemonScript = path.resolve(__dirname, '../bin/mindagentics.js');

const token = `testvis${Math.floor(Math.random() * 100000)}`;

console.log(`Starting daemon for component visibility test with token: ${token}...`);

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
      // non-json
    }
  }
});

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendCommand(argv, options = {}, terminalId = 'test-term-123') {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(pipeAddress, () => {
      const req = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        command: argv[0],
        args: argv.slice(1),
        options,
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
  console.log(`Daemon pipe ready at: ${pipeAddress}`);

  // Register terminal node for caller
  const callerTerminalId = 'test-term-123';
  await sendCommand(['arrange'], { name: 'Maestro Agent', color: 'blue' }, callerTerminalId);

  // 1. Create a Note
  console.log('\n--- 1. Testing Note Creation & Visual Sync ---');
  const noteRes = await sendCommand(['note', 'create', 'Frontend Architecture'], {
    body: 'Architecture details for UI components',
    color: 'yellow',
  }, callerTerminalId);
  console.log('Note create result:', noteRes.output);

  await sleep(100);
  const notePlaceFrames = frames.filter(f => f.type === 'placeNode' && f.payload?.node?.kind === 'note');
  if (notePlaceFrames.length === 0) {
    throw new Error('FAIL: No placeNode frame emitted for note creation!');
  }
  console.log('PASS: placeNode frame emitted for note creation.');

  const noteTieFrames = frames.filter(f => f.type === 'cableTieCreated' && f.payload?.label?.includes('Connected Note'));
  if (noteTieFrames.length === 0) {
    throw new Error('FAIL: No cableTieCreated frame emitted linking caller to note!');
  }
  console.log('PASS: cableTieCreated frame emitted linking caller to note.');

  // 2. Create a Portal
  console.log('\n--- 2. Testing Portal Creation & Visual Sync ---');
  const portalRes = await sendCommand(['portal', 'open', 'https://react.dev'], {
    name: 'React Docs',
  }, callerTerminalId);
  console.log('Portal open result:', portalRes.output);

  await sleep(100);
  const portalPlaceFrames = frames.filter(f => f.type === 'placeNode' && f.payload?.node?.kind === 'portal');
  if (portalPlaceFrames.length === 0) {
    throw new Error('FAIL: No placeNode frame emitted for portal creation!');
  }
  console.log('PASS: placeNode frame emitted for portal creation.');

  const portalTieFrames = frames.filter(f => f.type === 'cableTieCreated' && f.payload?.label === 'Reference');
  if (portalTieFrames.length === 0) {
    throw new Error('FAIL: No cableTieCreated frame emitted linking caller to portal!');
  }
  console.log('PASS: cableTieCreated frame emitted linking caller to portal.');

  // 3. Create a Band
  console.log('\n--- 3. Testing Band Creation & Visual Sync ---');
  const bandRes = await sendCommand(['band', 'create', 'Dev Core Team'], {}, callerTerminalId);
  console.log('Band create result:', bandRes.output);

  await sleep(100);
  const bandPlaceFrames = frames.filter(f => f.type === 'placeNode' && f.payload?.node?.kind === 'band');
  if (bandPlaceFrames.length === 0) {
    throw new Error('FAIL: No placeNode frame emitted for band creation!');
  }
  console.log('PASS: placeNode frame emitted for band creation.');

  // 4. Connect Note <-> Portal
  console.log('\n--- 4. Testing Connect Note <-> Portal ---');
  const connRes = await sendCommand(['connect', 'Frontend Architecture', 'React Docs'], {
    label: 'Doc Reference',
  }, callerTerminalId);
  console.log('Connect result:', connRes.output);

  await sleep(100);
  const customTieFrames = frames.filter(f => f.type === 'cableTieCreated' && f.payload?.label === 'Doc Reference');
  if (customTieFrames.length === 0) {
    throw new Error('FAIL: No cableTieCreated frame emitted for connecting Note <-> Portal!');
  }
  console.log('PASS: cableTieCreated frame emitted for Note <-> Portal.');

  // 5. Connect "me" <-> Band
  console.log('\n--- 5. Testing Connect "me" <-> Band ---');
  const connMeRes = await sendCommand(['connect', 'me', 'Dev Core Team'], {
    label: 'Lead',
  }, callerTerminalId);
  console.log('Connect "me" result:', connMeRes.output);

  await sleep(100);
  const meTieFrames = frames.filter(f => f.type === 'cableTieCreated' && f.payload?.label === 'Lead');
  if (meTieFrames.length === 0) {
    throw new Error('FAIL: No cableTieCreated frame emitted for connecting "me" <-> Band!');
  }
  console.log('PASS: cableTieCreated frame emitted for "me" <-> Band.');

  // 6. Disconnect Note <-> Portal
  console.log('\n--- 6. Testing Disconnect Note </-> Portal ---');
  const disconnRes = await sendCommand(['connect', 'Frontend Architecture', 'React Docs'], {
    disconnect: true,
  }, callerTerminalId);
  console.log('Disconnect result:', disconnRes.output);

  await sleep(100);
  const delTieFrames = frames.filter(f => f.type === 'cableTieDeleted');
  if (delTieFrames.length === 0) {
    throw new Error('FAIL: No cableTieDeleted frame emitted when disconnecting Note </-> Portal!');
  }
  console.log('PASS: cableTieDeleted frame emitted.');

  // 7. Update Note
  console.log('\n--- 7. Testing Note Update Sync ---');
  const updateRes = await sendCommand(['note', 'write', 'Frontend Architecture', 'Brand new updated architecture!'], {}, callerTerminalId);
  console.log('Note write result:', updateRes.output);

  await sleep(100);
  const noteUpdateFrames = frames.filter(f => f.type === 'placeNode' && f.payload?.node?.content?.body === 'Brand new updated architecture!');
  if (noteUpdateFrames.length === 0) {
    throw new Error('FAIL: No placeNode frame emitted with updated note content!');
  }
  console.log('PASS: placeNode frame emitted with updated note body.');

  // 8. Close Portal
  console.log('\n--- 8. Testing Portal Close Sync ---');
  const portalCloseRes = await sendCommand(['portal', 'close', 'React Docs'], {}, callerTerminalId);
  console.log('Portal close result:', portalCloseRes.output);

  await sleep(100);
  const delNodeFrames = frames.filter(f => f.type === 'deleteNode');
  if (delNodeFrames.length === 0) {
    throw new Error('FAIL: No deleteNode frame emitted when closing portal!');
  }
  console.log('PASS: deleteNode frame emitted when closing portal.');

  // 9. Delete Note
  console.log('\n--- 9. Testing Note Delete Sync ---');
  const deleteNoteRes = await sendCommand(['note', 'delete', 'Brand new updated architecture!'], {}, callerTerminalId);
  console.log('Note delete result:', deleteNoteRes.output);

  await sleep(100);
  const noteDelFrames = frames.filter(f => f.type === 'deleteNode');
  if (noteDelFrames.length < 2) {
    throw new Error('FAIL: No deleteNode frame emitted when deleting note!');
  }
  console.log('PASS: deleteNode frame emitted when deleting note.');

  // 10. Dissolve Band
  console.log('\n--- 10. Testing Band Dissolve Sync ---');
  const dissolveRes = await sendCommand(['band', 'dissolve', 'Dev Core Team'], {}, callerTerminalId);
  console.log('Band dissolve result:', dissolveRes.output);

  await sleep(100);
  if (frames.filter(f => f.type === 'deleteNode').length < 3) {
    throw new Error('FAIL: No deleteNode frame emitted when dissolving band!');
  }
  console.log('PASS: deleteNode frame emitted when dissolving band.');

  console.log('\n=============================================');
  console.log('ALL WORKSPACE VISIBILITY & SYNC TESTS PASSED!');
  console.log('=============================================\n');

  daemon.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error('Test FAILED:', err);
  daemon.kill();
  process.exit(1);
});
