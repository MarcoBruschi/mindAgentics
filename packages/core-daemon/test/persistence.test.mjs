import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DaemonState } from '../dist/daemon/state.js';
import { RoutineScheduler } from '../dist/daemon/scheduler.js';
import { routineCommand } from '../dist/cli/commands/routine.js';
import { floorCommand } from '../dist/cli/commands/floor.js';

console.log('--- Testing Persistence & Unified Frames ---');

const baseDir = path.join(os.homedir(), '.mindagentics');
const memPath = path.join(baseDir, 'memory.jsonl');
const usagePath = path.join(baseDir, 'usage', 'usage.json');

// Test 1: DaemonState memory and usage hydration/persistence
const state = new DaemonState();

const initialCount = state.memoryEntries.length;
state.addMemoryEntry({
  terminalId: 'test-term-123',
  text: 'Semantic memory persistence verification entry',
  timestamp: new Date().toISOString(),
});

assert.strictEqual(state.memoryEntries.length, initialCount + 1, 'Memory entry should be added');
assert.ok(fs.existsSync(memPath), 'memory.jsonl must exist on disk');

const memContent = fs.readFileSync(memPath, 'utf8');
assert.ok(memContent.includes('Semantic memory persistence verification entry'), 'File should contain appended entry');

// Test usage recording and persistence
state.recordUsage('test-term-123', 100, 200, 0.05);
state.flush();

assert.ok(fs.existsSync(usagePath), 'usage.json must exist');
const usageDoc = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
assert.ok(usageDoc.totals.tokensIn >= 100, 'tokensIn recorded');
assert.ok(usageDoc.totals.tokensOut >= 200, 'tokensOut recorded');
assert.ok(usageDoc.totals.costEstimate >= 0.05, 'costEstimate recorded');
assert.ok(usageDoc.byTerminal['test-term-123'], 'byTerminal recorded');

// Test 2: RoutineScheduler loadRoutines
const sentFrames = [];
const mockSendToMain = (frame) => {
  sentFrames.push(frame);
};

const scheduler = new RoutineScheduler(state, mockSendToMain);
const dummyRoutines = [
  {
    id: 'routine-test-1',
    name: 'Test Routine 1',
    workspaceId: 'default',
    schedule: { kind: 'every', intervalMs: 60000, intervalExpression: '1m' },
    action: { command: 'echo 1' },
    disabled: false,
    fireCount: 0,
    createdAt: new Date().toISOString(),
  },
];

scheduler.loadRoutines(dummyRoutines);
assert.strictEqual(scheduler.routines.size, 1, 'Scheduler should have 1 loaded routine');
assert.ok(scheduler.routines.has('routine-test-1'), 'Scheduler should contain routine-test-1');

// Test 3: routineCommand create & delete frames
const reqCreate = {
  id: 'req-1',
  command: 'routine',
  args: ['create', 'Daily Sync', '--command', 'mindagentics ask Teammate "sync"'],
  options: { command: 'mindagentics ask Teammate "sync"', daily: '09:00' },
  terminalId: 'test-term-123',
  workspaceId: 'ws-123',
};

await routineCommand(reqCreate, state, null, scheduler, mockSendToMain);

const createFrame = sentFrames.find(f => f.type === 'routineCreate');
assert.ok(createFrame, 'sendToMain must receive routineCreate frame');
assert.strictEqual(createFrame.payload.name, 'Daily Sync');

// Delete routine
const reqDelete = {
  id: 'req-2',
  command: 'routine',
  args: ['delete', 'Daily Sync'],
  options: {},
  terminalId: 'test-term-123',
  workspaceId: 'ws-123',
};

await routineCommand(reqDelete, state, null, scheduler, mockSendToMain);
const deleteFrame = sentFrames.find(f => f.type === 'routineDelete');
assert.ok(deleteFrame, 'sendToMain must receive routineDelete frame');
assert.strictEqual(deleteFrame.payload.name, 'Daily Sync');

// Test 4: floorCommand unified floorCreate frame
sentFrames.length = 0;
const reqFloor = {
  id: 'req-3',
  command: 'floor',
  args: ['create', 'feature-auth'],
  options: { branch: 'feat/auth' },
  terminalId: 'test-term-123',
  workspaceId: 'ws-123',
};

await floorCommand(reqFloor, state, null, scheduler, mockSendToMain);
const floorFrame = sentFrames.find(f => f.type === 'floorCreate');
assert.ok(floorFrame, 'sendToMain must receive unified floorCreate frame');
assert.strictEqual(floorFrame.payload.name, 'feature-auth');
assert.strictEqual(floorFrame.payload.branch, 'feat/auth');
assert.strictEqual(floorFrame.payload.kind, 'worktree');
assert.strictEqual(floorFrame.payload.workspaceId, 'ws-123');

// Ensure no obsolete floorCreateKindResult frame was emitted
const obsoleteFrame = sentFrames.find(f => f.type === 'floorCreateKindResult');
assert.strictEqual(obsoleteFrame, undefined, 'floorCreateKindResult should not be emitted by floor create');

console.log('ALL PERSISTENCE AND FRAME TESTS PASSED SUCCESSFULLY!');
