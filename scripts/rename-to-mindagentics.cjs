const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${path.relative('C:/prog/mindAgentics', filePath)}`);
  }
}

// 1. Core Daemon Commands
const commandsDir = 'C:/prog/mindAgentics/packages/core-daemon/src/cli/commands';
const cmdFiles = fs.readdirSync(commandsDir);
for (const file of cmdFiles) {
  const fullPath = path.join(commandsDir, file);
  let text = fs.readFileSync(fullPath, 'utf8');
  let updated = text
    .replace(/maestri /g, 'mindagentics ')
    .replace(/`maestri /g, '`mindagentics ')
    .replace(/`maestri`/g, '`mindagentics`')
    .replace(/maestri\.js/g, 'mindagentics.js')
    .replace(/maestri\.cmd/g, 'mindagentics.cmd')
    .replace(/'maestri'/g, "'mindagentics'")
    .replace(/"maestri"/g, '"mindagentics"')
    .replace(/maestri-screenshot/g, 'mindagentics-screenshot')
    .replace(/Maestri/g, 'mindAgentics');
  if (updated !== text) {
    fs.writeFileSync(fullPath, updated, 'utf8');
    console.log(`Updated command: ${file}`);
  }
}

// 2. Core Daemon Daemon files
replaceInFile('C:/prog/mindAgentics/packages/core-daemon/src/daemon/pipeServer.ts', [
  [/\\\\\\.\\\\pipe\\\\maestri-/g, '\\\\.\\pipe\\mindagentics-'],
  [/Run "maestri --help"/g, 'Run "mindagentics --help"'],
  [/maestri: error:/g, 'mindagentics: error:']
]);

replaceInFile('C:/prog/mindAgentics/packages/core-daemon/src/daemon/router.ts', [
  [/`maestri ask`/g, '`mindagentics ask`'],
  [/maestri/g, 'mindagentics']
]);

replaceInFile('C:/prog/mindAgentics/packages/core-daemon/src/daemon/scheduler.ts', [
  [/MAESTRI_ROUTINE_NAME/g, 'MINDAGENTICS_ROUTINE_NAME'],
  [/MAESTRI_WORKSPACE_DIR/g, 'MINDAGENTICS_WORKSPACE_DIR']
]);

replaceInFile('C:/prog/mindAgentics/packages/core-daemon/src/daemon/server.ts', [
  [/\\\\\\.\\\\pipe\\\\maestri-\$\{token\}/g, '\\\\.\\pipe\\mindagentics-${token}'],
  [/\/tmp\/maestri-\$\{token\}\.sock/g, '/tmp/mindagentics-${token}.sock'],
  [/'MAESTRI_PIPE'/g, "'MINDAGENTICS_PIPE'"],
  [/'MAESTRI_SOCKET'/g, "'MINDAGENTICS_SOCKET'"]
]);

// 3. Renderer files
replaceInFile('C:/prog/mindAgentics/packages/renderer/src/App.tsx', [
  [/localStorage\.setItem\('maestri_workspaces'/g, "localStorage.setItem('mindagentics_workspaces'"],
  [/localStorage\.setItem\('maestri_active_ws'/g, "localStorage.setItem('mindagentics_active_ws'"],
  [/window\.maestri/g, '(window.mindAgentics || window.api || window.maestri)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/atoms/workspace.ts', [
  [/Section 4 of Maestri Interaction Model/g, 'Section 4 of mindAgentics Interaction Model'],
  [/original Maestri disk format/g, 'original mindAgentics disk format'],
  [/Convert raw Maestri disk workspace format/g, 'Convert raw mindAgentics disk workspace format']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/components/canvas/InfiniteCanvas.tsx', [
  [/window\.maestri\?\.terminal\?\.kill/g, '(window.mindAgentics?.terminal || window.api?.terminal || window.maestri?.terminal)?.kill'],
  [/window\.maestri\?\.canvas\?\.sync/g, '(window.mindAgentics?.canvas?.sync || window.api?.canvas?.sync || window.maestri?.canvas?.sync)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/components/modals/AgentLimitsModal.tsx', [
  [/window\.maestri\?\.terminal\?\.getAgentLimits/g, '(window.mindAgentics?.terminal?.getAgentLimits || window.api?.terminal?.getAgentLimits || window.maestri?.terminal?.getAgentLimits)'],
  [/window\.maestri\?\.terminal\?\.detectAgents/g, '(window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents || window.maestri?.terminal?.detectAgents)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/components/modals/CreateAgentModal.tsx', [
  [/window\.maestri\?\.terminal\?\.getAgentLimits/g, '(window.mindAgentics?.terminal?.getAgentLimits || window.api?.terminal?.getAgentLimits || window.maestri?.terminal?.getAgentLimits)'],
  [/window\.maestri\?\.terminal\?\.detectAgents/g, '(window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents || window.maestri?.terminal?.detectAgents)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/components/nodes/TerminalNode.tsx', [
  [/window\.maestri\?\.terminal\b/g, '(window.mindAgentics?.terminal || window.api?.terminal || window.maestri?.terminal)'],
  [/window\.maestri\?\.terminal\?\.resize/g, '(window.mindAgentics?.terminal?.resize || window.api?.terminal?.resize || window.maestri?.terminal?.resize)'],
  [/window\.maestri\?\.terminal\?\.setMaestroMode/g, '(window.mindAgentics?.terminal?.setMaestroMode || window.api?.terminal?.setMaestroMode || window.maestri?.terminal?.setMaestroMode)'],
  [/window\.maestri\?\.terminal\?\.write/g, '(window.mindAgentics?.terminal?.write || window.api?.terminal?.write || window.maestri?.terminal?.write)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/components/toolbar/CanvasToolbar.tsx', [
  [/window\.maestri\?\.terminal\?\.getAgentLimits/g, '(window.mindAgentics?.terminal?.getAgentLimits || window.api?.terminal?.getAgentLimits || window.maestri?.terminal?.getAgentLimits)'],
  [/window\.maestri\?\.terminal\?\.detectAgents/g, '(window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents || window.maestri?.terminal?.detectAgents)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/components/window/WindowControls.tsx', [
  [/window\.maestri\?\.windowControls/g, '(window.mindAgentics?.windowControls || window.api?.windowControls || window.maestri?.windowControls)']
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/src/utils/clipboard.ts', [
  [/'application\/x-maestri-partitura'/g, "'application/x-mindagentics-partitura'"]
]);

replaceInFile('C:/prog/mindAgentics/packages/renderer/tailwind.config.js', [
  [/maestri: \{/g, 'mindagentics: {']
]);

// 4. Main Process files
replaceInFile('C:/prog/mindAgentics/packages/main/src/git/gitWorktreeService.ts', [
  [/\.maestri/g, '.mindagentics'],
  [/branchCreatedByMaestri/g, 'branchCreatedByMindAgentics']
]);

replaceInFile('C:/prog/mindAgentics/packages/main/src/storage/dataService.ts', [
  [/path\.join\(os\.homedir\(\), '\.maestri'\)/g, "path.join(os.homedir(), '.mindagentics')"],
  [/pointerPath = path\.join\(appData, 'Maestri'/g, "pointerPath = path.join(appData, 'mindAgentics'"],
  [/`maestri-backup-/g, '`mindagentics-backup-']
]);

replaceInFile('C:/prog/mindAgentics/packages/main/src/supervisor/coreDaemonSupervisor.ts', [
  [/core-daemon\/bin\/maestri\.js/g, 'core-daemon/bin/mindagentics.js'],
  [/MAESTRI_SECRET_STORE/g, 'MINDAGENTICS_SECRET_STORE']
]);

replaceInFile('C:/prog/mindAgentics/packages/main/src/terminal/agentProbes.ts', [
  [/clientInfo: \{ name: 'maestri', title: 'Maestri'/g, "clientInfo: { name: 'mindagentics', title: 'mindAgentics'"]
]);

replaceInFile('C:/prog/mindAgentics/packages/main/src/terminal/terminalManager.ts', [
  [/const fallbackBinName = isWin \? 'maestri\.cmd' : 'maestri\.js';/g, "const fallbackBinName = isWin ? 'mindagentics.cmd' : 'mindagentics.js';"],
  [/path\.join\(appData, 'Maestri'/g, "path.join(appData, 'mindAgentics'"],
  [/path\.join\(os\.homedir\(\), '\.maestri'/g, "path.join(os.homedir(), '.mindagentics'"],
  [/MAESTRI_PIPE: pipeAddress,/g, "MINDAGENTICS_PIPE: pipeAddress,\n      MAESTRI_PIPE: pipeAddress,"],
  [/MAESTRI_SOCKET: pipeAddress,/g, "MINDAGENTICS_SOCKET: pipeAddress,\n      MAESTRI_SOCKET: pipeAddress,"],
  [/MAESTRI_TERMINAL_ID: terminalId,/g, "MINDAGENTICS_TERMINAL_ID: terminalId,\n      MAESTRI_TERMINAL_ID: terminalId,"],
  [/MAESTRI_WORKSPACE_ID: workspaceId,/g, "MINDAGENTICS_WORKSPACE_ID: workspaceId,\n      MAESTRI_WORKSPACE_ID: workspaceId,"],
  [/MAESTRI_CLI: cliPath,/g, "MINDAGENTICS_CLI: cliPath,\n      MAESTRI_CLI: cliPath,"]
]);

// 5. Skills files
replaceInFile('C:/prog/mindAgentics/skills/mindagentics/SKILL.md', [
  [/The `maestri` CLI/g, 'The `mindagentics` CLI'],
  [/through the `maestri` CLI/g, 'through the `mindagentics` CLI'],
  [/`maestri /g, '`mindagentics '],
  [/maestri /g, 'mindagentics '],
  [/maestri\.js/g, 'mindagentics.js'],
  [/\$MAESTRI_CLI/g, '$MINDAGENTICS_CLI']
]);

// 6. Root package.json
replaceInFile('C:/prog/mindAgentics/package.json', [
  [/packages\/core-daemon\/bin\/maestri\.js/g, 'packages/core-daemon/bin/mindagentics.js']
]);

console.log('All replacements completed successfully!');
