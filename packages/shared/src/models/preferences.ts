/**
 * Preferences & Agent Presets Models
 * User preferences and preset configuration models.
 */

import type { NoteColor } from './nodes.js';

export type AgentType =
  | 'claude_code'
  | 'codex'
  | 'antigravity_cli'
  | 'open_code'
  | 'generic_shell'
  | 'custom';

export interface AgentPreset {
  id: string;
  name: string;
  agentType: AgentType;
  command: string;
  icon: string;
  isActive: boolean;
  maestroMode: boolean;
  startInChatMode: boolean;
  codexDaemonMigration?: 'untouched' | 'added' | 'migrated';
  account?: string;
  quickStart?: boolean;
}

export interface PreferencesPayload {
  autosaveIntervalSeconds: number;
  defaultStickyNoteColor: NoteColor;
  defaultTerminalFontFamily: string;
  defaultTerminalFontSize: number;
  agentPresets: AgentPreset[];
  theme?: 'dark' | 'light' | 'system';
  telemetryEnabled?: boolean;
}

export interface PreferencesDocument {
  type: 'preferences';
  schemaVersion: 1;
  payload: PreferencesPayload;
}
