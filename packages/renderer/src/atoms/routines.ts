import { atom } from 'jotai';
import { Routine } from '@mindagentics/shared';

export const routinesAtom = atom<Routine[]>([
  {
    id: 'routine-1',
    name: 'Git Status Heartbeat',
    workspaceId: 'WS-1234-ABCD',
    schedule: {
      kind: 'every',
      intervalMs: 1800000,
      intervalExpression: '30m',
    },
    action: {
      command: 'git status -s\necho "Routine check complete. {{output}}"',
    },
    targetTerminalId: 'term-uuid-1',
    preRunScript: 'git diff --stat',
    disabled: false,
    fireCount: 42,
    createdAt: '2026-10-21T21:00:00Z',
    lastFiredAt: '2026-10-21T21:30:00Z',
  },
  {
    id: 'routine-2',
    name: 'Morning Health Check',
    workspaceId: 'WS-1234-ABCD',
    schedule: {
      kind: 'daily',
      time: '09:00',
    },
    action: {
      command: 'npm run test:ci',
    },
    targetTerminalId: 'term-uuid-1',
    disabled: true,
    fireCount: 10,
    createdAt: '2026-10-20T09:00:00Z',
  },
]);

export const isRoutinesModalOpenAtom = atom<boolean>(false);
