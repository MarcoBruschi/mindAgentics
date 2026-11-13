/**
 * @mindagentics/shared
 * Complete shared types, IPC channel constants, and frame protocols for mindAgentics.
 */

// IPC Channels & Protocols
export * from './ipc/channels.js';
export * from './ipc/frames.js';

// Domain Models
export * from './models/workspace.js';
export * from './models/nodes.js';
export * from './models/preferences.js';
export * from './models/appState.js';
export * from './models/manifest.js';
export * from './models/routines.js';
export * from './models/accounts.js';
export * from './models/profile.js';
export {
  createDefaultProfile,
  calculateLevelAndXp,
  getTitleForLevel,
  INITIAL_BADGES,
} from './models/profile.js';

// Security helpers (pure)
export * from './security/text.js';
import * as _textSecurity from './security/text.js';
export const hasControlChars = _textSecurity.hasControlChars;
export const stripAnsi = _textSecurity.stripAnsi;
export const sanitizeLabel = _textSecurity.sanitizeLabel;
export const quotePowerShell = _textSecurity.quotePowerShell;
export const quotePosix = _textSecurity.quotePosix;
export const quoteCmd = _textSecurity.quoteCmd;
export const sanitizeMarkdownInline = _textSecurity.sanitizeMarkdownInline;
export const sanitizeMarkdownBlock = _textSecurity.sanitizeMarkdownBlock;
export const sanitizeForPtyLine = _textSecurity.sanitizeForPtyLine;
export const REDACTED = _textSecurity.REDACTED;
export const redactSecrets = _textSecurity.redactSecrets;
export const MEMORY_MAX_ENTRY_CHARS = _textSecurity.MEMORY_MAX_ENTRY_CHARS;
export const MEMORY_MAX_SUMMARY_CHARS = _textSecurity.MEMORY_MAX_SUMMARY_CHARS;
export const MEMORY_MAX_ENTRIES = _textSecurity.MEMORY_MAX_ENTRIES;
export const MEMORY_RETENTION_DAYS = _textSecurity.MEMORY_RETENTION_DAYS;
export const MEMORY_DIR_NAME = _textSecurity.MEMORY_DIR_NAME;
export const sanitizeMemoryText = _textSecurity.sanitizeMemoryText;
export const wrapUntrustedMemory = _textSecurity.wrapUntrustedMemory;
export const estimatePayloadSize = _textSecurity.estimatePayloadSize;
export const assertPayloadWithinLimit = _textSecurity.assertPayloadWithinLimit;
export const IPC_MAX_PAYLOAD_BYTES = _textSecurity.IPC_MAX_PAYLOAD_BYTES;
export const CLI_MAX_REQUEST_BYTES = _textSecurity.CLI_MAX_REQUEST_BYTES;
export const CLI_MAX_ARGS = _textSecurity.CLI_MAX_ARGS;
export const CLI_MAX_ARG_CHARS = _textSecurity.CLI_MAX_ARG_CHARS;
export const PATH_MAX_CHARS = _textSecurity.PATH_MAX_CHARS;

// Utilities
export * from './utils/id.js';
