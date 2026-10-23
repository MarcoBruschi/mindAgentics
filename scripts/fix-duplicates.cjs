const fs = require('fs');

// 1. coreDaemonSupervisor.ts
const p1 = 'C:/prog/mindAgentics/packages/main/src/supervisor/coreDaemonSupervisor.ts';
let c1 = fs.readFileSync(p1, 'utf8');
c1 = c1.replace(
  /MINDAGENTICS_SECRET_STORE:\s*'file',\s*MINDAGENTICS_SECRET_STORE:\s*'file'/m,
  "MINDAGENTICS_SECRET_STORE: 'file'"
);
fs.writeFileSync(p1, c1, 'utf8');

// 2. terminalManager.ts
const p2 = 'C:/prog/mindAgentics/packages/main/src/terminal/terminalManager.ts';
let c2 = fs.readFileSync(p2, 'utf8');
const targetEnv = `      MINDAGENTICS_PIPE: pipeAddress,
      MINDAGENTICS_SOCKET: pipeAddress,
      MINDAGENTICS_TERMINAL_ID: terminalId,
      MINDAGENTICS_WORKSPACE_ID: workspaceId,
      MINDAGENTICS_CLI: cliPath,
      MINDAGENTICS_PIPE: pipeAddress,
      MAESTRI_PIPE: pipeAddress,
      MINDAGENTICS_SOCKET: pipeAddress,
      MAESTRI_SOCKET: pipeAddress,
      MINDAGENTICS_TERMINAL_ID: terminalId,
      MAESTRI_TERMINAL_ID: terminalId,
      MINDAGENTICS_WORKSPACE_ID: workspaceId,
      MAESTRI_WORKSPACE_ID: workspaceId,
      MINDAGENTICS_CLI: cliPath,
      MAESTRI_CLI: cliPath,`;

const cleanEnv = `      MINDAGENTICS_PIPE: pipeAddress,
      MINDAGENTICS_SOCKET: pipeAddress,
      MINDAGENTICS_TERMINAL_ID: terminalId,
      MINDAGENTICS_WORKSPACE_ID: workspaceId,
      MINDAGENTICS_CLI: cliPath,
      MAESTRI_PIPE: pipeAddress,
      MAESTRI_SOCKET: pipeAddress,
      MAESTRI_TERMINAL_ID: terminalId,
      MAESTRI_WORKSPACE_ID: workspaceId,
      MAESTRI_CLI: cliPath,`;

c2 = c2.replace(/\r\n/g, '\n');
const targetNorm = targetEnv.replace(/\r\n/g, '\n');
const cleanNorm = cleanEnv.replace(/\r\n/g, '\n');

if (c2.includes(targetNorm)) {
  c2 = c2.replace(targetNorm, cleanNorm);
}
fs.writeFileSync(p2, c2, 'utf8');

console.log('Fixed duplicates successfully');
