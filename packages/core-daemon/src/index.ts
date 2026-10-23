/**
 * mindAgentics Core Daemon & CLI Entry Point
 * Dispatches between Daemon mode (--serve <token>) and Terminal CLI mode.
 */

import { runDaemonServer } from './daemon/server.js';
import { runCliClient } from './cli/client.js';

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

main().catch((err) => {
  console.error(`mindagentics: fatal error: ${err.message || String(err)}`);
  process.exit(1);
});
