/**
 * mindAgentics Core Daemon & CLI Entry Point
 * Dispatches between Daemon mode (--serve <token>) and Terminal CLI mode,
 * and exports pure Node backend services for the runtime and test suites.
 */

import { runDaemonServer } from './daemon/server.js';
import { runCliClient } from './cli/client.js';

export * from './memory/memoryService.js';
export {
  type MemoryHit,
  type MemoryEngine,
  type MemorySearchResult,
  findMemoryRoot,
  listAgentMemoryDirs,
  syncIndex,
  searchMemory,
} from './memory/memorySearch.js';
export * from './icon/iconValidator.js';
export * from './storage/dataService.js';
export * from './terminal/agentProbes.js';
export * from './terminal/terminalManager.js';
export * from './graphify/graphifyService.js';
export * from './security/pathSafety.js';
export * from './daemon/state.js';
export * from './daemon/router.js';
export * from './daemon/rpcHandler.js';
export * from './daemon/scheduler.js';
export * from './daemon/pipeServer.js';
export * from './daemon/spatial.js';
export * from './daemon/refs.js';

export async function main() {
  const args = process.argv.slice(2);

  const serveIndex = args.indexOf('--serve');
  if (serveIndex !== -1) {
    const token = args[serveIndex + 1];
    await runDaemonServer(token);
  } else {
    await runCliClient(args);
  }
}

const isCliOrDaemonEntry = Boolean(
  process.argv[1] &&
  (/(?:^|[\\/])(?:index|mindagentics)(?:\.[cm]?js)?$/i.test(process.argv[1]))
);

if (isCliOrDaemonEntry) {
  main().catch((err) => {
    console.error(`mindagentics: fatal error: ${err.message || String(err)}`);
    process.exit(1);
  });
}
