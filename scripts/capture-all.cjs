const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const outDir = path.resolve('docs/assets');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    frame: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    }
  });

  const indexPath = path.resolve('packages/renderer/dist/index.html');
  await win.loadFile(indexPath);

  // Seed sample workspace in localStorage
  const sampleWorkspace = {
    id: 'ws-mindagentics',
    name: 'mindAgentics Core',
    workingDirectory: 'C:\\prog\\mindAgentics',
    floors: [
      {
        id: 'floor-ground',
        name: 'Ground Floor',
        isGround: true,
        workingDirectory: 'C:\\prog\\mindAgentics',
        gitBranch: 'main',
        status: { text: 'Running Agents', state: 'working', progress: '85%' },
        nodes: [
          {
            id: 'node-term-1',
            kind: 'terminal',
            x: 280,
            y: 110,
            width: 480,
            height: 380,
            zIndex: 10,
            content: {
              terminalId: 'term-orchestrator-1',
              title: 'Central Orchestrator',
              command: 'antigravity',
              workingDirectory: 'C:\\prog\\mindAgentics',
              isAutonomous: true,
              agentRole: 'Central Orchestrator',
              orchestratorMode: true,
              maestroMode: true,
              status: 'idle',
              color: '#3B82F6',
            }
          },
          {
            id: 'node-note-1',
            kind: 'note',
            x: 820,
            y: 110,
            width: 380,
            height: 340,
            zIndex: 11,
            content: {
              noteId: 'note-1',
              title: 'Arquitetura mindAgentics',
              color: 'yellow',
              body: '## 🪄 mindAgentics Workspace\n- Orquestração de Agentes Autônomos\n- Named Pipe: `\\\\.\\pipe\\mindagentics_ipc`\n- Comunicação: `mindagentics ask / list / recruit`\n- AST Engine: Graphify Integration\n\n### Tarefas Ativas:\n- [x] Remoção da barra superior rígida\n- [x] Toolbar flutuante moderna\n- [x] Migração de identidade para mindAgentics\n- [x] Capturas de tela dinâmicas',
            }
          },
          {
            id: 'node-term-2',
            kind: 'terminal',
            x: 280,
            y: 520,
            width: 480,
            height: 320,
            zIndex: 12,
            content: {
              terminalId: 'term-agent-2',
              title: 'Codex Backend Dev',
              command: 'codex',
              workingDirectory: 'C:\\prog\\mindAgentics',
              isAutonomous: true,
              agentRole: 'API Specialist',
              maestroMode: false,
              status: 'idle',
              color: '#10B981',
            }
          },
          {
            id: 'node-portal-1',
            kind: 'portal',
            x: 820,
            y: 480,
            width: 460,
            height: 360,
            zIndex: 13,
            content: {
              portalKind: 'browser',
              title: 'Portal Web: Documentação',
              url: 'https://github.com/MarcoBruschi/mindAgentics',
              viewport: { width: 1280, height: 800 },
              actionTags: ['docs', 'reference'],
            }
          }
        ],
        cableTies: [
          { id: 'tie-1', fromNodeId: 'node-term-1', toNodeId: 'node-note-1', label: 'context-notes' },
          { id: 'tie-2', fromNodeId: 'node-term-1', toNodeId: 'node-term-2', label: 'subtask-delegation' },
          { id: 'tie-3', fromNodeId: 'node-term-2', toNodeId: 'node-portal-1', label: 'web-reference' },
        ],
        bands: [],
        drawings: [],
      }
    ]
  };

  await win.webContents.executeJavaScript(`
    localStorage.setItem('mindagentics_workspaces', JSON.stringify([${JSON.stringify(sampleWorkspace)}]));
    localStorage.setItem('mindagentics_active_ws', 'ws-mindagentics');
    location.reload();
  `);

  console.log('Reloading with seeded workspace...');
  await new Promise(r => setTimeout(r, 2500));

  // 1. Capture Main Canvas Overview
  console.log('Capturing canvas-agents-overview.png...');
  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'canvas-agents-overview.png'), img.toPNG());

  // 2. Open Agent Creation Modal
  console.log('Opening Agent Creation modal...');
  await win.webContents.executeJavaScript(`(() => {
    const terminalToolBtn = document.querySelector('button[title*="Terminal"], button[title*="Agente"]');
    if (terminalToolBtn) terminalToolBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'agent-creation-modal.png'), img.toPNG());

  // Close modal with ESC
  await win.webContents.executeJavaScript(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancelar'));
    if (cancelBtn) cancelBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));

  // 3. Open Agent Limits & Telemetry
  console.log('Opening Agent Limits & Telemetry...');
  await win.webContents.executeJavaScript(`(() => {
    const limitsBtn = document.querySelector('button[data-agent-limits-trigger="true"]');
    if (limitsBtn) limitsBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'agent-limits-telemetry.png'), img.toPNG());

  // Close limits modal
  await win.webContents.executeJavaScript(`(() => {
    const closeBtn = document.querySelector('button[data-agent-limits-trigger="true"]');
    if (closeBtn) closeBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));

  // 4. Open Workspace creation modal
  console.log('Opening Workspace modal...');
  await win.webContents.executeJavaScript(`(() => {
    const addWsBtn = document.querySelector('button[title*="workspace"], button[title*="Workspace"], aside button.w-full');
    const plusInSidebar = document.querySelector('aside .flex button[title*="Novo"]');
    if (plusInSidebar) plusInSidebar.click();
    else if (addWsBtn) addWsBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'workspace-switcher.png'), img.toPNG());

  // Close workspace modal
  await win.webContents.executeJavaScript(`(() => {
    const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancelar'));
    if (cancelBtn) cancelBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));

  // 5. Notes and Binders view
  console.log('Capturing notes and binders view...');
  await win.webContents.executeJavaScript(`(() => {
    const noteBtn = document.querySelector('button[title*="Nota"]');
    if (noteBtn) noteBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'notes-and-binders.png'), img.toPNG());

  // Close note creation / esc
  await win.webContents.executeJavaScript(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  })()`);
  await new Promise(r => setTimeout(r, 600));

  // 6. Browser Portal view
  console.log('Capturing browser portal view...');
  await win.webContents.executeJavaScript(`(() => {
    const portalBtn = document.querySelector('button[title*="Portal"]');
    if (portalBtn) portalBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'browser-portal.png'), img.toPNG());

  console.log('All live screenshots captured successfully!');
  app.quit();
});
