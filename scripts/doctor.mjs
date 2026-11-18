#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const SYMBOLS = {
  ok: `${colors.green}✔${colors.reset}`,
  fail: `${colors.red}✖${colors.reset}`,
  warn: `${colors.yellow}⚠${colors.reset}`,
  info: `${colors.cyan}ℹ${colors.reset}`,
};

function findLlvmMingwBin(localAppData) {
  if (!localAppData) return null;
  const pkgsDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgsDir)) return null;

  try {
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
  } catch {
    return null;
  }
  return null;
}

function getAugmentedEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const currentEntries = (env[pathKey] ?? '').split(path.delimiter).filter(Boolean);
  const extraDirs = [];

  const home = os.homedir();
  const cargoBin = path.join(home, '.cargo', 'bin');
  if (fs.existsSync(cargoBin)) {
    extraDirs.push(cargoBin);
  }

  if (process.platform === 'win32') {
    const mingwBin = findLlvmMingwBin(env.LOCALAPPDATA);
    if (mingwBin) {
      extraDirs.push(mingwBin);
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

const executionEnv = getAugmentedEnv();

function runCommand(command, args = []) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: executionEnv,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    return {
      status: result.status,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      ok: result.status === 0,
    };
  } catch (err) {
    return {
      status: -1,
      stdout: '',
      stderr: err.message,
      ok: false,
    };
  }
}

function parseSemver(str) {
  const match = str.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: match[3] ? parseInt(match[3], 10) : 0,
    raw: match[0],
  };
}

function isVersionAtLeast(actual, min) {
  if (actual.major !== min.major) {
    return actual.major > min.major;
  }
  if (actual.minor !== min.minor) {
    return actual.minor > min.minor;
  }
  return actual.patch >= (min.patch ?? 0);
}

function checkNode() {
  const actual = parseSemver(process.version);
  const min = { major: 20, minor: 0, patch: 0 };
  const valid = actual && isVersionAtLeast(actual, min);

  return {
    name: 'Node.js',
    pass: !!valid,
    version: process.version,
    details: `Installed: ${process.version} (requires >= v20.0.0)`,
    recommendation: 'Install or update Node.js (>= 20.0.0) from https://nodejs.org or run: nvm install 22 / fnm install 22',
  };
}

function checkNpm() {
  const res = runCommand('npm', ['--version']);
  const version = res.stdout.split('\n')[0] || '';
  const actual = parseSemver(version);
  const pass = res.ok && actual !== null;

  return {
    name: 'npm',
    pass,
    version: version || 'Not detected',
    details: pass ? `npm v${version}` : 'npm command failed or not found',
    recommendation: 'Ensure npm is in PATH. Usually installed with Node.js. Run: npm install -g npm@latest',
  };
}

function checkRustc() {
  const res = runCommand('rustc', ['--version']);
  const firstLine = res.stdout.split('\n')[0] || '';
  const actual = parseSemver(firstLine);
  const min = { major: 1, minor: 85, patch: 0 };
  const pass = res.ok && actual && isVersionAtLeast(actual, min);

  return {
    name: 'Rust (rustc)',
    pass: !!pass,
    version: firstLine || 'Not detected',
    details: actual
      ? `rustc ${actual.raw} (requires >= 1.85.0)`
      : 'rustc compiler not found',
    recommendation:
      'Install or update Rust to >= 1.85:\n' +
      '  - Windows: winget install Rustlang.Rustup  (or run: rustup update stable)\n' +
      '  - Linux/macOS: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  };
}

function checkCargo() {
  const res = runCommand('cargo', ['--version']);
  const firstLine = res.stdout.split('\n')[0] || '';
  const actual = parseSemver(firstLine);
  const pass = res.ok && actual !== null;

  return {
    name: 'Cargo',
    pass,
    version: firstLine || 'Not detected',
    details: pass ? firstLine : 'Cargo package manager not found',
    recommendation: 'Cargo comes bundled with Rustup. Run: rustup default stable',
  };
}

function checkCppBuildTools() {
  const platform = process.platform;

  if (platform === 'win32') {
    // 1. Check MSVC cl.exe directly
    const clRes = runCommand('cl', []);
    if (clRes.status === 0 || (clRes.stderr && clRes.stderr.includes('Microsoft (R) C/C++'))) {
      const match = clRes.stderr.match(/Version\s+([\d.]+)/i) || clRes.stdout.match(/Version\s+([\d.]+)/i);
      const vStr = match ? match[1] : 'installed';
      return {
        name: 'C++ Build Tools',
        pass: true,
        version: `MSVC cl.exe (${vStr})`,
        details: 'Visual Studio MSVC C++ toolchain found',
        recommendation: '',
      };
    }

    // 2. Check vswhere for Visual Studio VC Tools
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswherePath = path.join(progFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswherePath)) {
      const vsRes = runCommand(vswherePath, [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ]);
      if (vsRes.ok && vsRes.stdout) {
        return {
          name: 'C++ Build Tools',
          pass: true,
          version: 'Visual Studio VC++ Tools',
          details: `Found Visual Studio at: ${vsRes.stdout}`,
          recommendation: '',
        };
      }
    }

    // 3. Check clang.exe (LLVM / MinGW)
    const clangRes = runCommand('clang', ['--version']);
    if (clangRes.ok) {
      const firstLine = clangRes.stdout.split('\n')[0];
      return {
        name: 'C++ Build Tools',
        pass: true,
        version: firstLine,
        details: 'Clang C++ compiler detected',
        recommendation: '',
      };
    }

    // 4. Check gcc.exe (MinGW)
    const gccRes = runCommand('gcc', ['--version']);
    if (gccRes.ok) {
      const firstLine = gccRes.stdout.split('\n')[0];
      return {
        name: 'C++ Build Tools',
        pass: true,
        version: firstLine,
        details: 'GCC C++ compiler detected',
        recommendation: '',
      };
    }

    return {
      name: 'C++ Build Tools',
      pass: false,
      version: 'Not detected',
      details: 'No C++ compiler found (MSVC cl.exe, clang, or gcc)',
      recommendation:
        'Install Visual Studio C++ Build Tools or LLVM-MinGW:\n' +
        '  - Option A (MSVC): winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"\n' +
        '  - Option B (LLVM-MinGW): winget install MartinStorsjo.LLVM-MinGW.UCRT',
    };
  }

  if (platform === 'darwin') {
    const xcodeRes = runCommand('xcode-select', ['-p']);
    const clangRes = runCommand('clang', ['--version']);
    const pass = xcodeRes.ok || clangRes.ok;
    return {
      name: 'C++ Build Tools',
      pass,
      version: pass ? 'Apple Clang / Xcode CLI Tools' : 'Not detected',
      details: pass ? 'Xcode Command Line Tools installed' : 'Xcode CLI tools missing',
      recommendation: 'Run: xcode-select --install',
    };
  }

  // Linux
  const gccRes = runCommand('gcc', ['--version']);
  const clangRes = runCommand('clang', ['--version']);
  const pass = gccRes.ok || clangRes.ok;
  const version = gccRes.ok ? gccRes.stdout.split('\n')[0] : (clangRes.ok ? clangRes.stdout.split('\n')[0] : 'Not detected');

  return {
    name: 'C++ Build Tools',
    pass,
    version,
    details: pass ? `C++ compiler: ${version}` : 'gcc or clang not found in PATH',
    recommendation: 'Run: sudo apt-get update && sudo apt-get install -y build-essential pkg-config libssl-dev',
  };
}

function checkPython() {
  // Check python then python3
  let pyCommand = 'python';
  let res = runCommand(pyCommand, ['--version']);
  if (!res.ok) {
    pyCommand = 'python3';
    res = runCommand(pyCommand, ['--version']);
  }

  const out = (res.stdout || res.stderr || '').trim();
  const actual = parseSemver(out);
  const min = { major: 3, minor: 10, patch: 0 };
  const pass = res.ok && actual && isVersionAtLeast(actual, min);

  return {
    name: 'Python',
    pass: !!pass,
    version: out || 'Not detected',
    details: actual
      ? `${out} (requires >= 3.10.0)`
      : 'Python 3.10+ not found in PATH',
    command: pyCommand,
    recommendation:
      'Install Python 3.10+:\n' +
      '  - Windows: winget install Python.Python.3.11  (or https://python.org)\n' +
      '  - Linux: sudo apt-get install -y python3 python3-pip\n' +
      '  - macOS: brew install python@3.11',
  };
}

function checkGraphifyy(pyCommand = 'python') {
  // Check pip show graphifyy or python import
  let res = runCommand(pyCommand, ['-m', 'pip', 'show', 'graphifyy']);
  let version = '';

  if (res.ok && res.stdout) {
    const vMatch = res.stdout.match(/^Version:\s*([^\r\n]+)/m);
    if (vMatch) {
      version = vMatch[1].trim();
    }
  }

  if (!version) {
    const importRes = runCommand(pyCommand, [
      '-c',
      "import graphifyy; print(getattr(graphifyy, '__version__', 'detected'))",
    ]);
    if (importRes.ok) {
      version = importRes.stdout || 'detected';
    }
  }

  const pass = Boolean(version);

  return {
    name: 'graphifyy (Python package)',
    pass,
    version: pass ? `v${version}` : 'Not installed',
    details: pass
      ? `graphifyy ${version} available in Python environment`
      : 'Package graphifyy is not installed in Python environment',
    recommendation: 'Run: npm run setup:graphify (or: python -m pip install graphifyy)',
  };
}

function runDoctor() {
  console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}             mindAgentics Environment Doctor                ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}`);
  console.log(`${colors.dim}Platform:${colors.reset} ${process.platform} (${os.arch()}) | ${os.release()}`);
  console.log('');

  const pyCheck = checkPython();
  const checks = [
    checkNode(),
    checkNpm(),
    checkRustc(),
    checkCargo(),
    checkCppBuildTools(),
    pyCheck,
    checkGraphifyy(pyCheck.command || 'python'),
  ];

  let allPassed = true;
  const issues = [];

  for (const check of checks) {
    const icon = check.pass ? SYMBOLS.ok : SYMBOLS.fail;
    const namePadded = check.name.padEnd(28, ' ');
    const statusText = check.pass
      ? `${colors.green}${check.version}${colors.reset}`
      : `${colors.red}${check.version}${colors.reset}`;

    console.log(` ${icon}  ${colors.bold}${namePadded}${colors.reset} ${statusText}`);

    if (!check.pass) {
      allPassed = false;
      issues.push(check);
    }
  }

  console.log('');
  console.log(`${colors.dim}------------------------------------------------------------${colors.reset}`);

  if (allPassed) {
    console.log(`${colors.bold}${colors.green}${SYMBOLS.ok} All required development dependencies are installed and ready!${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.bold}${colors.red}${SYMBOLS.fail} Missing or outdated dependencies detected (${issues.length}):${colors.reset}\n`);

    issues.forEach((issue, idx) => {
      console.log(`${colors.bold}${colors.yellow}[${idx + 1}] ${issue.name}${colors.reset}`);
      console.log(`    Status:  ${issue.details}`);
      console.log(`    Fix:     ${issue.recommendation.split('\n').join('\n             ')}\n`);
    });

    console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}`);
    process.exit(1);
  }
}

runDoctor();
