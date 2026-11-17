"""
mindAgentics - Automated Visual Documentation Screenshot Generator
Uses Python + Selenium + Edge headless + http.server serving packages/renderer/dist
Captures live updated UI screenshots for docs/assets/
"""

import os
import sys
import time
import json
import http.server
import socketserver
import threading
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST_DIR = os.path.join(ROOT_DIR, 'packages', 'renderer', 'dist')
OUT_DIR = os.path.join(ROOT_DIR, 'docs', 'assets')
PORT = 8792

os.makedirs(OUT_DIR, exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)
    def log_message(self, format, *args):
        pass

def start_server():
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), QuietHandler)
    srv_thread = threading.Thread(target=httpd.serve_forever)
    srv_thread.daemon = True
    srv_thread.start()
    return httpd

# Rich sample workspace representing real mindAgentics canvas orchestration
sample_workspace = {
    "id": "ws-mindagentics",
    "name": "mindAgentics Core",
    "workingDirectory": "C:\\prog\\mindAgentics",
    "floors": [
      {
        "id": "floor-ground",
        "name": "Ground Floor",
        "isGround": True,
        "workingDirectory": "C:\\prog\\mindAgentics",
        "gitBranch": "main",
        "status": {"text": "Running Agents", "state": "working", "progress": "85%"},
        "nodes": [
          {
            "id": "node-term-1",
            "kind": "terminal",
            "x": 280,
            "y": 110,
            "width": 480,
            "height": 380,
            "zIndex": 10,
            "content": {
              "terminalId": "term-orchestrator-1",
              "title": "Central Orchestrator",
              "command": "antigravity",
              "workingDirectory": "C:\\prog\\mindAgentics",
              "isAutonomous": True,
              "agentRole": "Central Orchestrator",
              "orchestratorMode": True,
              "maestroMode": True,
              "status": "idle",
              "color": "#3B82F6",
            }
          },
          {
            "id": "node-note-1",
            "kind": "note",
            "x": 820,
            "y": 110,
            "width": 380,
            "height": 340,
            "zIndex": 11,
            "content": {
              "noteId": "note-1",
              "title": "Arquitetura mindAgentics",
              "color": "yellow",
              "body": "## 🪄 mindAgentics Workspace\\n- Orquestração de Agentes Autônomos\\n- Named Pipe: `\\\\.\\pipe\\mindagentics_ipc`\\n- Comunicação: `mindagentics ask / list / recruit`\\n- AST Engine: Graphify Integration\\n\\n### Status Atual:\\n- [x] Tauri v2 Nativo + React 19\\n- [x] Toolbar flutuante moderna (Hitbox Isolated)\\n- [x] Telemetria de Cotas & Modelos\\n- [x] Named Pipe IPC Bounded Buffer",
            }
          },
          {
            "id": "node-term-2",
            "kind": "terminal",
            "x": 280,
            "y": 520,
            "width": 480,
            "height": 320,
            "zIndex": 12,
            "content": {
              "terminalId": "term-agent-2",
              "title": "Codex Backend Dev",
              "command": "codex",
              "workingDirectory": "C:\\prog\\mindAgentics",
              "isAutonomous": True,
              "agentRole": "API Specialist",
              "maestroMode": False,
              "status": "idle",
              "color": "#10B981",
            }
          },
          {
            "id": "node-portal-1",
            "kind": "portal",
            "x": 820,
            "y": 480,
            "width": 460,
            "height": 360,
            "zIndex": 13,
            "content": {
              "portalKind": "browser",
              "title": "Portal Web: Documentação & AST",
              "url": "https://github.com/MarcoBruschi/mindAgentics",
              "viewport": {"width": 1280, "height": 800},
              "actionTags": ["docs", "reference", "ast"],
            }
          }
        ],
        "cableTies": [
          {"id": "tie-1", "fromNodeId": "node-term-1", "toNodeId": "node-note-1", "label": "context-notes"},
          {"id": "tie-2", "fromNodeId": "node-term-1", "toNodeId": "node-term-2", "label": "subtask-delegation"},
          {"id": "tie-3", "fromNodeId": "node-term-2", "toNodeId": "node-portal-1", "label": "web-reference"},
        ],
        "bands": [],
        "drawings": [],
      }
    ]
}

mock_api_script = """
window.__TAURI_INTERNALS__ = {};
const sampleWs = """ + json.dumps(sample_workspace) + """;

const mockApi = {
  workspace: {
    list: () => Promise.resolve([sampleWs]),
    getActiveId: () => Promise.resolve('ws-mindagentics'),
    patch: () => Promise.resolve(),
    switch: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  },
  app: {
    info: () => Promise.resolve({ windowMaterial: false, windowSeeThrough: false }),
    getAppVersion: () => Promise.resolve('0.1.0'),
  },
  windowControls: {
    onChanged: () => (() => {}),
    isMaximized: () => Promise.resolve(false),
  },
  terminal: {
    getAgentLimits: () => Promise.resolve([
      {
        id: 'antigravity',
        name: 'Antigravity',
        subtitle: 'Google Gemini 2.5 Pro & Flash',
        command: 'antigravity',
        installed: true,
        primaryUsedFraction: 0.18,
        quotaPercent: 18,
        label: 'Diário',
        primaryResetText: '23h restantes',
        secondaryFraction: 0.28,
        secondaryPercent: 28,
        secondaryLabel: 'Semanal',
        secondaryResetText: '5d restantes',
        colorHex: '#8B93FF',
        windows: [
          { id: 'daily', title: 'Limite Diário (Gemini 2.5 Pro)', usedFraction: 0.18, formattedReset: '23h' },
          { id: 'weekly', title: 'Limite Semanal', usedFraction: 0.28, formattedReset: '5d' }
        ]
      },
      {
        id: 'codex',
        name: 'Codex',
        subtitle: 'OpenAI GPT-4.5 & o3',
        command: 'codex',
        installed: true,
        primaryUsedFraction: 0.35,
        quotaPercent: 35,
        label: 'Diário',
        primaryResetText: '18h restantes',
        colorHex: '#10B981',
        windows: [
          { id: 'daily', title: 'Quota Diária', usedFraction: 0.35, formattedReset: '18h' }
        ]
      },
      {
        id: 'claude',
        name: 'Claude Code',
        subtitle: 'Anthropic Claude 3.7 Sonnet',
        command: 'claude',
        installed: true,
        primaryUsedFraction: 0.42,
        quotaPercent: 42,
        label: 'Diário',
        primaryResetText: '12h restantes',
        colorHex: '#F59E0B',
        windows: [
          { id: 'daily', title: 'Token Bucket', usedFraction: 0.42, formattedReset: '12h' }
        ]
      }
    ]),
    getPresets: () => Promise.resolve([
      { id: 'antigravity', name: 'Antigravity', command: 'antigravity' },
      { id: 'codex', name: 'Codex', command: 'codex' },
      { id: 'claude', name: 'Claude Code', command: 'claude' },
      { id: 'opencode', name: 'OpenCode', command: 'opencode' },
      { id: 'shell', name: 'Shell', command: 'powershell' }
    ]),
    detectAgents: () => Promise.resolve([
      { id: 'antigravity', name: 'Antigravity', command: 'antigravity', installed: true, colorHex: '#8B93FF' },
      { id: 'codex', name: 'Codex', command: 'codex', installed: true, colorHex: '#10B981' },
      { id: 'claude', name: 'Claude Code', command: 'claude', installed: true, colorHex: '#F59E0B' }
    ]),
    onData: () => (() => {}),
    onStatus: () => (() => {}),
    write: () => Promise.resolve(),
    spawn: () => Promise.resolve({ pid: 1000 }),
    kill: () => Promise.resolve(),
    resize: () => Promise.resolve(),
    getScrollback: (id) => {
      if (id === 'term-orchestrator-1') {
        return Promise.resolve(
          '\\x1b[38;2;139;147;255m[Central Orchestrator]\\x1b[0m Canvas Engine initialized.\\r\\n' +
          '\\x1b[32m●\\x1b[0m Connected to IPC: \\\\\\\\.\\\\pipe\\\\mindagentics_ipc\\r\\n' +
          '\\x1b[38;2;160;160;160mmindagentics ask \"Codex Backend Dev\" \"Implement Named Pipe IPC\"\\x1b[0m\\r\\n' +
          '\\x1b[36mℹ AST Knowledge Graph synchronized (1950 nodes)\\x1b[0m\\r\\n' +
          '\\x1b[32m✔ Autonomous multi-agent coordination active\\x1b[0m\\r\\n'
        );
      }
      if (id === 'term-agent-2') {
        return Promise.resolve(
          '\\x1b[38;2;16;185;129m[Codex Backend Dev]\\x1b[0m Named Pipe server running.\\r\\n' +
          '\\x1b[32m●\\x1b[0m Handshake OK: Central Orchestrator connected\\r\\n' +
          '\\x1b[38;2;160;160;160mRunning test suite...\\x1b[0m\\r\\n' +
          '\\x1b[32m✔ 42 tests passing\\x1b[0m (zero memory leaks, bounded buffer)\\r\\n'
        );
      }
      return Promise.resolve('');
    }
  },
  profile: {
    get: () => Promise.resolve({
      username: 'Tech Lead Operator',
      xp: 2850,
      level: 4,
      streakDays: 7,
      unlockedBadges: ['pioneer', 'orchestrator'],
      avatarId: 'bot'
    }),
    update: () => Promise.resolve(),
    awardXp: () => Promise.resolve({
      profile: { username: 'Tech Lead Operator', xp: 2850, level: 4, streakDays: 7, unlockedBadges: [], avatarId: 'bot' },
      leveledUp: false,
      unlockedBadges: []
    })
  },
  onNodePlace: () => (() => {}),
  onCableTie: () => (() => {}),
  onOrchestratorLock: () => (() => {}),
};

window.api = mockApi;
window.mindAgentics = mockApi;
localStorage.setItem('mindagentics_active_ws', 'ws-mindagentics');
"""

def capture_all():
    print("=" * 60)
    print("mindAgentics - Capturing Live UI Screenshots via Selenium Edge")
    print("=" * 60)

    httpd = start_server()
    print(f"Local static server running at http://127.0.0.1:{PORT}")

    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=1440,900')
    options.add_argument('--disable-gpu')
    options.add_argument('--force-device-scale-factor=1')
    options.add_argument('--disable-extensions')
    options.add_argument('--no-sandbox')

    driver = webdriver.Edge(options=options)
    driver.set_window_size(1440, 900)

    results = []

    try:
        driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source': mock_api_script})
        driver.get(f'http://127.0.0.1:{PORT}/index.html')
        time.sleep(3)

        def save_and_log(filename, desc):
            path = os.path.join(OUT_DIR, filename)
            driver.save_screenshot(path)
            size = os.path.getsize(path)
            mtime = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(os.path.getmtime(path)))
            results.append((filename, size, mtime))
            print(f" [✔] Saved {filename} ({size:,} bytes, {mtime}) - {desc}")

        # -------------------------------------------------------------
        # 1. Canvas Agents Overview
        # -------------------------------------------------------------
        print("\n[1/6] Capturing canvas-agents-overview.png...")
        driver.execute_script("""
          const trigger = document.querySelector('[data-toolbar-trigger="true"]');
          if (trigger) trigger.click();
          const toolbarParent = document.querySelector('.canvas-toolbar')?.parentElement;
          if (toolbarParent) {
            toolbarParent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          }
        """)
        time.sleep(1)
        save_and_log('canvas-agents-overview.png', 'Canvas principal com agentes, notas, portal e cabos')

        # -------------------------------------------------------------
        # 2. Agent Creation Modal
        # -------------------------------------------------------------
        print("\n[2/6] Opening and capturing agent-creation-modal.png...")
        driver.execute_script("""
          const btn = document.querySelector('button[title*="Terminal"], button[title*="Agente"]');
          if (btn) btn.click();
        """)
        time.sleep(1.2)
        save_and_log('agent-creation-modal.png', 'Modal de criação e configuração de agentes de IA')

        # Close modal
        driver.execute_script("""
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancelar'));
          if (cancelBtn) cancelBtn.click();
        """)
        time.sleep(0.8)

        # -------------------------------------------------------------
        # 3. Agent Limits & Telemetry
        # -------------------------------------------------------------
        print("\n[3/6] Opening and capturing agent-limits-telemetry.png...")
        driver.execute_script("""
          const limitsBtn = document.querySelector('button[data-agent-limits-trigger="true"]');
          if (limitsBtn) limitsBtn.click();
        """)
        time.sleep(1.2)
        save_and_log('agent-limits-telemetry.png', 'Painel flutuante de telemetria e cotas de agentes')

        # Close limits popover
        driver.execute_script("""
          const limitsBtn = document.querySelector('button[data-agent-limits-trigger="true"]');
          if (limitsBtn) limitsBtn.click();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        """)
        time.sleep(0.8)

        # -------------------------------------------------------------
        # 4. Workspace Switcher / Creation Modal
        # -------------------------------------------------------------
        print("\n[4/6] Opening and capturing workspace-switcher.png...")
        driver.execute_script("""
          const addWsBtn = document.querySelector('button[title*="Novo Workspace"], button[aria-label*="Novo Workspace"], aside button[title*="Adicionar"]');
          if (addWsBtn) addWsBtn.click();
        """)
        time.sleep(1.2)
        save_and_log('workspace-switcher.png', 'Switcher de workspaces e modal de novo workspace')

        # Close workspace modal
        driver.execute_script("""
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancelar'));
          if (cancelBtn) cancelBtn.click();
        """)
        time.sleep(0.8)

        # -------------------------------------------------------------
        # 5. Notes and Binders view
        # -------------------------------------------------------------
        print("\n[5/6] Creating sticky note and capturing notes-and-binders.png...")
        driver.execute_script("""
          const noteBtn = document.querySelector('button[title*="Nota"]');
          if (noteBtn) noteBtn.click();
        """)
        time.sleep(1.2)
        save_and_log('notes-and-binders.png', 'Bloco de notas adesivas e documentação no canvas')

        # -------------------------------------------------------------
        # 6. Browser Portal view
        # -------------------------------------------------------------
        print("\n[6/6] Creating browser portal and capturing browser-portal.png...")
        driver.execute_script("""
          const portalBtn = document.querySelector('button[title*="Portal"]');
          if (portalBtn) portalBtn.click();
        """)
        time.sleep(1.2)
        save_and_log('browser-portal.png', 'Portal web interativo integrado ao canvas espacial')

    finally:
        driver.quit()
        httpd.shutdown()

    print("\n" + "=" * 60)
    print("Screenshot Capture Summary:")
    print("=" * 60)
    all_valid = True
    for fname, size, mtime in results:
        status = "OK" if size > 0 else "FAIL"
        if size == 0:
            all_valid = False
        print(f" • {fname:<28} | {size:>8} bytes | {mtime} | [{status}]")
    print("=" * 60)
    if all_valid and len(results) == 6:
        print("All 6 screenshots successfully captured and verified!")
    else:
        print("Warning: some captures might be missing or failed.")

if __name__ == '__main__':
    capture_all()
