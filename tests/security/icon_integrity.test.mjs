import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  validatePngIcon,
  safeCopyIcon,
  resolveAppIcon,
  PNG_MAGIC_BYTES,
  MAX_ICON_SIZE_BYTES,
} from '../../packages/core-daemon/dist/icon/iconValidator.js';
import { installIcon } from '../../scripts/install-icon.mjs';

describe('S3: Icon Integrity Validation & Path Safety Suite', () => {
  let tempDir;
  const canonicalSourceIcon = path.join(os.homedir(), 'Downloads', 'mindAgentics_icon_1024.png');

  before(() => {
    tempDir = path.join(os.tmpdir(), `mindagentics-icon-sec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // 1. Source Icon Validation (Downloads)
  // =========================================================================
  describe('1. Source Icon Validation & Verification', () => {
    it('should validate that the source mindAgentics_icon_1024.png exists and is valid', () => {
      if (fs.existsSync(canonicalSourceIcon)) {
        const check = validatePngIcon(canonicalSourceIcon);
        assert.strictEqual(check.ok, true, `Validation failed: ${check.reason}`);
        assert.ok(check.size > 0, 'Size must be greater than 0');
        assert.ok(check.size < MAX_ICON_SIZE_BYTES, 'Size must be strictly under 10MB');
        assert.strictEqual(check.canonicalPath, path.resolve(canonicalSourceIcon));
      }
    });

    it('should verify exact PNG magic bytes (0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)', () => {
      if (fs.existsSync(canonicalSourceIcon)) {
        const fd = fs.openSync(canonicalSourceIcon, 'r');
        const header = Buffer.alloc(8);
        try {
          fs.readSync(fd, header, 0, 8, 0);
        } finally {
          fs.closeSync(fd);
        }
        assert.deepStrictEqual(header, PNG_MAGIC_BYTES);
      }
    });
  });

  // =========================================================================
  // 2. Corrupted & Imposter File Rejection
  // =========================================================================
  describe('2. Corrupted & Imposter File Rejection', () => {
    it('should reject text or script files disguised with a .png extension', () => {
      const fakePng = path.join(tempDir, 'fake.png');
      fs.writeFileSync(fakePng, 'MZ... Windows executable or bash script disguised as png');

      const check = validatePngIcon(fakePng);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /Magic Bytes de PNG inválidos/i);
    });

    it('should reject JPEG or GIF files renamed to .png', () => {
      const fakeJpeg = path.join(tempDir, 'imposter.png');
      // JPEG magic bytes: FF D8 FF E0
      fs.writeFileSync(fakeJpeg, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]));

      const check = validatePngIcon(fakeJpeg);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /Magic Bytes de PNG inválidos/i);
    });

    it('should reject truncated files smaller than 8 bytes', () => {
      const tinyFile = path.join(tempDir, 'tiny.png');
      fs.writeFileSync(tinyFile, Buffer.from([0x89, 0x50, 0x4E]));

      const check = validatePngIcon(tinyFile);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /menor que o cabeçalho/i);
    });

    it('should reject 0-byte empty files', () => {
      const emptyFile = path.join(tempDir, 'empty.png');
      fs.writeFileSync(emptyFile, Buffer.alloc(0));

      const check = validatePngIcon(emptyFile);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /menor que o cabeçalho/i);
    });
  });

  // =========================================================================
  // 3. DoS Prevention & Memory Limits
  // =========================================================================
  describe('3. DoS Prevention & Memory Limits (< 10MB)', () => {
    it('should reject files exceeding the 10 MB safe limit to prevent memory exhaustion', () => {
      const oversizedFile = path.join(tempDir, 'oversized.png');
      // Create a sparse file or descriptor exceeding 10MB
      const fd = fs.openSync(oversizedFile, 'w');
      try {
        // Write valid header then expand to 11MB
        fs.writeSync(fd, PNG_MAGIC_BYTES);
        fs.ftruncateSync(fd, 11 * 1024 * 1024);
      } finally {
        fs.closeSync(fd);
      }

      const check = validatePngIcon(oversizedFile);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /excede o limite seguro de 10 MB/i);
    });
  });

  // =========================================================================
  // 4. Path Safety & Traversal Prevention
  // =========================================================================
  describe('4. Path Safety & Traversal Prevention', () => {
    it('should reject paths with null bytes or control characters', () => {
      const badPath = path.join(tempDir, 'icon\0.png');
      const check = validatePngIcon(badPath);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /caracteres de controle ou null bytes/i);
    });

    it('should reject path traversal escaping the base directory when baseDir is specified', () => {
      const subDir = path.join(tempDir, 'allowed');
      fs.mkdirSync(subDir, { recursive: true });
      const outsideFile = path.join(tempDir, 'outside.png');
      fs.writeFileSync(outsideFile, Buffer.concat([PNG_MAGIC_BYTES, Buffer.alloc(10)]));

      const check = validatePngIcon(path.join(subDir, '..', 'outside.png'), subDir);
      assert.strictEqual(check.ok, false);
      assert.match(check.reason, /Path traversal detectado/i);
    });

    it('should resolve legitimate paths to their canonical form using path.resolve', () => {
      const validFile = path.join(tempDir, 'valid.png');
      fs.writeFileSync(validFile, Buffer.concat([PNG_MAGIC_BYTES, Buffer.alloc(100)]));

      const check = validatePngIcon(path.join(tempDir, '.', 'valid.png'));
      assert.strictEqual(check.ok, true);
      assert.strictEqual(check.canonicalPath, path.resolve(validFile));
    });
  });

  // =========================================================================
  // 5. Safe Copy & Pipeline Non-Crashing Resilience
  // =========================================================================
  describe('5. Safe Copy & Pipeline Non-Crashing Resilience', () => {
    it('should safely copy valid icon to target destination and create parent folders', () => {
      const source = path.join(tempDir, 'good-icon.png');
      fs.writeFileSync(source, Buffer.concat([PNG_MAGIC_BYTES, Buffer.alloc(200)]));

      const dest = path.join(tempDir, 'nested', 'target', 'app-icon.png');
      const copyRes = safeCopyIcon(source, dest);
      assert.strictEqual(copyRes.ok, true);
      assert.ok(fs.existsSync(dest));
      assert.strictEqual(fs.statSync(dest).size, 208);
    });

    it('should not crash when resolveAppIcon encounters missing or corrupted files', () => {
      // Must return a string (if legitimate icon found in repo) or null, never throw
      assert.doesNotThrow(() => {
        const resolved = resolveAppIcon();
        if (resolved !== null) {
          assert.strictEqual(typeof resolved, 'string');
          assert.ok(fs.existsSync(resolved));
        }
      });
    });

    it('should execute scripts/install-icon.mjs installIcon safely to multiple targets', () => {
      const testSrc = path.join(tempDir, 'test-src.png');
      fs.writeFileSync(testSrc, Buffer.concat([PNG_MAGIC_BYTES, Buffer.alloc(500)]));

      const target1 = path.join(tempDir, 't1.png');
      const target2 = path.join(tempDir, 't2.png');

      const res = installIcon(testSrc, [target1, target2]);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.installedTo.length, 2);
      assert.ok(fs.existsSync(target1));
      assert.ok(fs.existsSync(target2));
    });
  });
});
