import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

import { IPC_CHANNELS } from '../../packages/shared/dist/index.js';

describe('T-S1 to T-S3: Tauri v2 & Electron Shared Contract & Security Suite', () => {

  // =========================================================================
  // T-S1: Capabilities e CSP do Tauri v2
  // =========================================================================
  describe('T-S1: Capabilities e CSP do Tauri v2', () => {
    const tauriConfPath = path.resolve('src-tauri/tauri.conf.json');
    const capabilitiesPath = path.resolve('src-tauri/capabilities/default.json');

    it('should verify tauri.conf.json sets withGlobalTauri to false', () => {
      assert.ok(fs.existsSync(tauriConfPath), 'src-tauri/tauri.conf.json must exist');
      const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));

      assert.strictEqual(
        conf.app?.withGlobalTauri,
        false,
        'withGlobalTauri MUST be false to prevent global window.__TAURI__ exposure'
      );
    });

    it('should verify tauri.conf.json defines strict CSP in app.security.csp without unsafe-eval', () => {
      const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
      const csp = conf.app?.security?.csp;

      assert.ok(csp, 'app.security.csp must be defined');
      assert.ok(typeof csp === 'string' && csp.length > 0, 'CSP must be a non-empty string');
      assert.ok(csp.includes("default-src 'self'"), "CSP must enforce default-src 'self'");
      assert.ok(csp.includes("script-src 'self'"), "CSP must enforce script-src 'self'");
      assert.strictEqual(csp.includes("'unsafe-eval'"), false, "CSP must NEVER allow 'unsafe-eval'");
      assert.ok(csp.includes("object-src 'none'"), "CSP must block object-src");
      assert.ok(csp.includes("base-uri 'self'"), "CSP must restrict base-uri to 'self'");
    });

    it('should verify capabilities/default.json defines minimal ACL restricted strictly to window "main"', () => {
      assert.ok(fs.existsSync(capabilitiesPath), 'src-tauri/capabilities/default.json must exist');
      const cap = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));

      assert.ok(Array.isArray(cap.windows), 'capabilities.windows must be an array');
      assert.deepStrictEqual(cap.windows, ['main'], 'Capabilities must be strictly granted to window "main"');
      assert.strictEqual(cap.windows.includes('*'), false, 'Wildcard "*" window permissions are forbidden');
      assert.ok(Array.isArray(cap.permissions), 'capabilities.permissions must be an array');
      assert.ok(cap.permissions.includes('core:default'), 'Must include core:default');
    });

    it('should verify remote iframes (PortalNode) are blocked from Tauri IPC access', () => {
      const cap = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));

      // Capabilities must not grant access to external webview origins or remote iframes
      const hasRemoteOrigins = Boolean(cap.remote || cap.webviews?.some?.((w) => w.includes('*') || w.startsWith('http')));
      assert.strictEqual(hasRemoteOrigins, false, 'Remote iframes / origins must NOT have IPC capability');
    });
  });

  // =========================================================================
  // T-S2: Paridade das Regras S1–S6 no Backend Rust
  // =========================================================================
  describe('T-S2: Paridade das Regras S1–S6 no Backend Rust', () => {
    const pathSafetyRs = path.resolve('src-tauri/src/security/path_safety.rs');
    const redactionRs = path.resolve('src-tauri/src/security/redaction.rs');
    const processRs = path.resolve('src-tauri/src/security/process.rs');

    it('should verify Rust path_safety uses dunce::canonicalize and blocks UNC, namespaces, null bytes and reserved devices', () => {
      assert.ok(fs.existsSync(pathSafetyRs), 'path_safety.rs must exist');
      const content = fs.readFileSync(pathSafetyRs, 'utf8');

      // Canonicalization
      assert.ok(content.includes('dunce::canonicalize'), 'Must use dunce::canonicalize');

      // UNC paths & Device Namespaces
      assert.ok(content.includes('Unc'), 'Must have Unc deny reason');
      assert.ok(content.includes('DeviceNamespace') || content.includes('starts_with(r"\\\\?\\")'), 'Must block device namespaces');
      assert.ok(content.includes('starts_with(r"\\\\")'), 'Must block \\\\ UNC prefix');
      assert.ok(content.includes('starts_with("//")'), 'Must block // network prefix');

      // Control characters & null bytes
      assert.ok(
        content.includes('CONTROL_CHARS_RE') || content.includes('is_control()') || content.includes('\\x00'),
        'Must check for control characters and null bytes'
      );

      // Windows reserved DOS devices
      const lower = content.toLowerCase();
      assert.ok(
        lower.includes('con') && lower.includes('prn') && lower.includes('aux') && lower.includes('nul'),
        'Must check DOS reserved devices'
      );
      assert.ok(lower.includes('com') && lower.includes('lpt'), 'Must check COM and LPT devices');

      // Symlinks and workspace escape
      assert.ok(content.includes('OutsideWorkspace'), 'Must guard against outside workspace escape');
      assert.ok(content.includes('SymlinkEscape'), 'Must guard against symlink escape');
    });

    it('should verify Rust redaction implements redact_secrets and wrap_untrusted_memory', () => {
      assert.ok(fs.existsSync(redactionRs), 'redaction.rs must exist');
      const content = fs.readFileSync(redactionRs, 'utf8');

      // Redaction
      assert.ok(content.includes('pub fn redact_secrets'), 'Must export redact_secrets function');
      assert.ok(content.includes('[REDACTED]'), 'Must replace secrets with [REDACTED]');
      assert.ok(content.includes('sk-'), 'Must catch OpenAI API keys');
      assert.ok(content.includes('Bearer'), 'Must catch Bearer tokens');
      assert.ok(content.includes('PRIVATE KEY'), 'Must catch private keys');

      // Untrusted memory wrapper
      assert.ok(content.includes('pub fn wrap_untrusted_memory'), 'Must export wrap_untrusted_memory');
      assert.ok(content.includes('<untrusted_memory_data>'), 'Must enclose in <untrusted_memory_data>');
      assert.ok(content.includes('replace(\'<\', "‹")'), 'Must neutralize closing tags to prevent prompt injection');
    });

    it('should verify Rust process execution is parameterized, shell-free and restricted to whitelist', () => {
      assert.ok(fs.existsSync(processRs), 'process.rs must exist');
      const content = fs.readFileSync(processRs, 'utf8');

      // Binary whitelist
      assert.ok(content.includes('"git"'), 'Whitelist must include git');
      assert.ok(content.includes('"python"'), 'Whitelist must include python');
      assert.ok(content.includes('"agy"'), 'Whitelist must include agy');
      assert.ok(content.includes('"codex"'), 'Whitelist must include codex');
      assert.ok(content.includes('"opencode"'), 'Whitelist must include opencode');

      // Parameterized Command::new without shell
      assert.ok(content.includes('Command::new(binary)'), 'Must execute binary directly with Command::new');
      assert.ok(content.includes('.args(args)'), 'Must pass arguments parameterized');
      assert.strictEqual(content.includes('cmd.exe'), false, 'Must NOT invoke cmd.exe shell');
      assert.strictEqual(content.includes('powershell'), false, 'Must NOT invoke powershell shell');
      assert.strictEqual(content.includes('/bin/sh'), false, 'Must NOT invoke /bin/sh shell');

      // Bounds
      assert.ok(content.includes('CLI_MAX_ARGS'), 'Must enforce max argument count');
      assert.ok(content.includes('IPC_MAX_PAYLOAD_BYTES'), 'Must enforce max IPC payload size');
    });
  });

  // =========================================================================
  // T-S3: Paridade do tauriBackend.ts com preload/src/index.ts e Matriz IPC
  // =========================================================================
  describe('T-S3: Paridade do tauriBackend.ts com preload/src/index.ts e Matriz IPC', () => {
    const preloadPath = path.resolve('packages/preload/src/index.ts');
    const tauriBackendPath = path.resolve('packages/renderer/src/tauriBackend.ts');
    const tauriAdapterPath = path.resolve('packages/renderer/src/adapters/tauriBackend.ts');

    it('should verify tauriBackend.ts and adapters/tauriBackend.ts exist', () => {
      assert.ok(fs.existsSync(tauriBackendPath), 'tauriBackend.ts must exist');
      assert.ok(fs.existsSync(tauriAdapterPath), 'adapters/tauriBackend.ts must exist');
    });

    it('should verify 100% namespace parity between preload/src/index.ts and tauriBackend.ts', () => {
      const preloadContent = fs.readFileSync(preloadPath, 'utf8');
      const tauriContent = fs.readFileSync(tauriBackendPath, 'utf8');

      const extractNamespaces = (code) => {
        const matches = [...code.matchAll(/^\s{2}([a-zA-Z0-9]+):\s*\{/gm)];
        return matches.map((m) => m[1]);
      };

      const preloadNamespaces = extractNamespaces(preloadContent);
      const tauriNamespaces = extractNamespaces(tauriContent);

      assert.ok(preloadNamespaces.length >= 40, `Expected at least 40 namespaces, got ${preloadNamespaces.length}`);

      for (const ns of preloadNamespaces) {
        assert.ok(
          tauriNamespaces.includes(ns),
          `Namespace "${ns}" from preload/src/index.ts is missing in tauriBackend.ts`
        );
      }
    });

    it('should verify 100% method parity for all namespaces between preload and tauriBackend', () => {
      const preloadContent = fs.readFileSync(preloadPath, 'utf8');
      const tauriContent = fs.readFileSync(tauriBackendPath, 'utf8');

      const extractMethodsByNamespace = (code) => {
        const lines = code.split('\n');
        const map = {};
        let currentNs = null;
        let inApi = false;

        for (const line of lines) {
          if (line.includes('export const api = {') || line.includes('export const tauriBackend = {')) {
            inApi = true;
            continue;
          }
          if (!inApi) continue;

          const nsMatch = line.match(/^\s{2}([a-zA-Z0-9]+):\s*\{/);
          if (nsMatch) {
            currentNs = nsMatch[1];
            map[currentNs] = [];
            continue;
          }

          const methodMatch = line.match(/^\s{4}([a-zA-Z0-9]+)\s*\(/);
          if (methodMatch && currentNs) {
            map[currentNs].push(methodMatch[1]);
          }
        }
        return map;
      };

      const preloadMethods = extractMethodsByNamespace(preloadContent);
      const tauriMethods = extractMethodsByNamespace(tauriContent);

      let totalPreloadMethods = 0;
      let totalTauriMethods = 0;

      for (const [ns, methods] of Object.entries(preloadMethods)) {
        totalPreloadMethods += methods.length;
        const targetMethods = tauriMethods[ns] || [];
        totalTauriMethods += targetMethods.length;

        for (const method of methods) {
          assert.ok(
            targetMethods.includes(method),
            `Method "${ns}.${method}" present in preload is missing in tauriBackend`
          );
        }
      }

      assert.strictEqual(
        totalTauriMethods >= totalPreloadMethods,
        true,
        `Expected tauriBackend method count (${totalTauriMethods}) to match preload method count (${totalPreloadMethods})`
      );
    });

    it('should verify critical IPC channels matrix are defined and mapped', () => {
      const criticalChannels = [
        'appInfo',
        'appPickDirectory',
        'appPickReference',
        'terminalReconfigure',
        'terminalSpawn',
        'terminalWrite',
        'terminalGetAgentLimits',
        'noteRead',
        'noteWrite',
        'workspaceList',
        'workspaceCreate',
        'floorSwitch',
        'portalRegister',
        'routineList',
        'profileGet',
        'profileUpdate',
      ];

      for (const ch of criticalChannels) {
        assert.ok(
          IPC_CHANNELS[ch],
          `Critical IPC channel constant "${ch}" must be defined in IPC_CHANNELS`
        );
      }
    });
  });
});
