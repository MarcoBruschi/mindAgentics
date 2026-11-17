import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

describe('Release Packaging & Build Verification Suite', () => {
  const rootDir = process.cwd();

  it('should validate root package.json configuration and release scripts', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json must exist');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.strictEqual(pkg.name, 'mind-agentics');
    assert.strictEqual(pkg.main, undefined, 'package.json should not have legacy main field');

    // Required scripts
    const expectedScripts = [
      'test:authorship',
      'test:security',
      'test:functional',
      'test',
      'tauri',
      'tauri:dev',
      'tauri:build',
      'start',
      'pack',
      'dist',
      'dist:win'
    ];

    for (const script of expectedScripts) {
      assert.ok(pkg.scripts[script], `Script "${script}" must be defined in package.json`);
    }
  });

  it('should validate Tauri v2 packaging metadata and Windows release targets', () => {
    const tauriConfPath = path.join(rootDir, 'src-tauri/tauri.conf.json');
    assert.ok(fs.existsSync(tauriConfPath), 'src-tauri/tauri.conf.json must exist');

    const config = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    assert.strictEqual(config.identifier, 'com.mindagentics.app');
    assert.strictEqual(config.productName, 'mindAgentics');
    assert.strictEqual(config.bundle?.active, true, 'Tauri bundle must be active');
    assert.ok(Array.isArray(config.bundle?.icon), 'bundle.icon must be an array');
    assert.ok(config.bundle.icon.includes('icons/icon.ico'), 'bundle.icon must include icons/icon.ico');
  });

  it('should verify all required build artifacts exist before packaging', () => {
    const requiredArtifacts = [
      'packages/renderer/dist/index.html',
      'packages/core-daemon/dist/index.js',
      'packages/core-daemon/bin/mindagentics.js',
      'packages/shared/dist/index.js'
    ];

    for (const relPath of requiredArtifacts) {
      const fullPath = path.join(rootDir, relPath);
      assert.ok(fs.existsSync(fullPath), `Artifact must exist: ${relPath}`);
    }
  });
});
