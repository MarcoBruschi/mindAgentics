import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function findLlvmMingwBin(localAppData) {
  if (!localAppData) return null;
  const pkgsDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgsDir)) return null;

  for (const entry of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('MartinStorsjo.LLVM-MinGW.UCRT')) {
      continue;
    }
    const pkgPath = path.join(pkgsDir, entry.name);
    for (const sub of fs.readdirSync(pkgPath, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const candidate = path.join(pkgPath, sub.name, 'bin');
      if (fs.existsSync(path.join(candidate, 'clang.exe'))) {
        return candidate;
      }
    }
  }
  return null;
}

function buildEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const currentEntries = (env[pathKey] ?? '').split(path.delimiter).filter(Boolean);
  const extraDirs = [];

  if (process.platform === 'win32') {
    const userProfile = env.USERPROFILE || os.homedir();
    const cargoBin = path.join(userProfile, '.cargo', 'bin');
    if (fs.existsSync(cargoBin)) {
      extraDirs.push(cargoBin);
    }
    const mingwBin = findLlvmMingwBin(env.LOCALAPPDATA);
    if (mingwBin) {
      extraDirs.push(mingwBin);
    }
  } else {
    const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
    if (fs.existsSync(cargoBin)) {
      extraDirs.push(cargoBin);
    }
  }

  const normalized = new Set(extraDirs.map((d) => d.toLowerCase()));
  const merged = [
    ...extraDirs,
    ...currentEntries.filter((d) => !normalized.has(d.toLowerCase())),
  ];
  env[pathKey] = merged.join(path.delimiter);
  return env;
}

const tauriCliEntry = path.resolve(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
if (!fs.existsSync(tauriCliEntry)) {
  console.error('Could not find @tauri-apps/cli at:', tauriCliEntry);
  process.exit(1);
}

const child = spawn(process.execPath, [tauriCliEntry, ...process.argv.slice(2)], {
  cwd: rootDir,
  stdio: 'inherit',
  env: buildEnv(),
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
