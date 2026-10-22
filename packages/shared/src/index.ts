/**
 * @maestri/shared
 * Complete shared types, IPC channel constants, and frame protocols for Maestri.
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

// Utilities
export * from './utils/id.js';
