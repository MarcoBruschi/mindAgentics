/**
 * Automation Chrono Routines Models
 * Section 3.2 & 5.3 of CLONE_SPEC.md
 */

export type RoutineScheduleKind = 'every' | 'daily' | 'weekly' | 'once';

export interface RoutineScheduleInterval {
  kind: 'every';
  intervalMs: number;
  intervalExpression: string; // e.g. "30m", "2h", "45s"
}

export interface RoutineScheduleDaily {
  kind: 'daily';
  time: string; // "HH:MM" 24h format
}

export interface RoutineScheduleWeekly {
  kind: 'weekly';
  days: Array<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'>;
  time: string; // "HH:MM" 24h format
}

export interface RoutineScheduleOnce {
  kind: 'once';
  datetime: string; // "YYYY-MM-DD HH:MM"
}

export type RoutineSchedule =
  | RoutineScheduleInterval
  | RoutineScheduleDaily
  | RoutineScheduleWeekly
  | RoutineScheduleOnce;

export interface RoutineAction {
  command: string; // Shell command or prompt with optional {{output}} placeholder
}

export interface Routine {
  id: string;
  name: string;
  workspaceId: string;
  schedule: RoutineSchedule;
  action: RoutineAction;
  targetTerminalId?: string;
  targetTerminalName?: string;
  isReminder?: boolean;
  preRunScript?: string;
  disabled?: boolean;
  skipIfBusy?: boolean;
  notify?: boolean;
  count?: number;
  until?: string;
  fireCount: number;
  createdAt: string;
  lastFiredAt?: string;
  nextFireAt?: string;
}

export type RoutineExecutionStatus =
  | 'success'
  | 'skippedByBusy'
  | 'skippedByScript'
  | 'failed';

export interface RoutineHistoryRecord {
  id: string;
  routineId: string;
  firedAt: string;
  status: RoutineExecutionStatus;
  preRunOutput?: string;
  terminalOutput?: string;
  error?: string;
}

export interface RoutinesDocument {
  schemaVersion: 1;
  routines: Routine[];
}

export interface RoutineHistoryDocument {
  schemaVersion: 1;
  records: RoutineHistoryRecord[];
}
