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
    assert.strictEqual(pkg.main, 'packages/main/dist/index.js');

    // Required scripts
    const expectedScripts = [
      'test:authorship',
      'test:security',
      'test:functional',
      'test',
      'pack',
      'dist',
      'dist:win'
    ];

    for (const script of expectedScripts) {
      assert.ok(pkg.scripts[script], `Script "${script}" must be defined in package.json`);
    }
  });

  it('should validate electron-builder packaging metadata and Windows release targets', () => {
    const builderPath = path.join(rootDir, 'electron-builder.json');
    assert.ok(fs.existsSync(builderPath), 'electron-builder.json must exist');

    const config = JSON.parse(fs.readFileSync(builderPath, 'utf8'));
    assert.strictEqual(config.appId, 'com.mindagentics.app');
    assert.strictEqual(config.productName, 'mindAgentics');
    assert.strictEqual(config.copyright, 'Copyright © 2026 mindAgentics Team');

    // Windows targets: nsis and portable x64
    assert.ok(config.win, 'Windows configuration must be specified');
    const targets = config.win.target;
    assert.ok(Array.isArray(targets), 'win.target must be an array');

    const hasNsis = targets.some((t) => t.target === 'nsis' && t.arch.includes('x64'));
    const hasPortable = targets.some((t) => t.target === 'portable' && t.arch.includes('x64'));
    assert.ok(hasNsis, 'Windows target must include nsis (x64)');
    assert.ok(hasPortable, 'Windows target must include portable (x64)');

    // Check files array
    const requiredPatterns = [
      'packages/main/dist/**/*',
      'packages/preload/dist/**/*',
      'packages/renderer/dist/**/*',
      'packages/core-daemon/dist/**/*',
      'packages/core-daemon/bin/**/*',
      'packages/shared/dist/**/*'
    ];

    for (const pattern of requiredPatterns) {
      assert.ok(config.files.includes(pattern), `files list must include ${pattern}`);
    }
  });

  it('should verify all required build artifacts exist before packaging', () => {
    const requiredArtifacts = [
      'packages/main/dist/index.js',
      'packages/preload/dist/index.js',
      'packages/renderer/dist/index.html',
      'packages/core-daemon/bin/mindagentics.js'
    ];

    for (const relPath of requiredArtifacts) {
      const fullPath = path.join(rootDir, relPath);
      assert.ok(fs.existsSync(fullPath), `Artifact must exist: ${relPath}`);
    }
  });
});
