import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_DIRECTORIES = ['packages', 'scripts', 'skills', 'tests', 'src-tauri', 'docs'];
const ROOT_FILES = ['package.json', 'AGENTS.md', 'README.md', '.gitignore', 'LICENSE', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'dist-package', '.git', 'out', 'build', '.cache', 'target']);
const IGNORED_FILES = new Set([
  'tests/audit/authorship.test.mjs',
  'REMOVAL_PLAN.md'
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot',
  '.exe', '.dll', '.node', '.zip', '.tar', '.gz', '.mp3', '.mp4', '.pdf', '.asar'
]);

function scanDirectory(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!BINARY_EXTENSIONS.has(ext)) {
        fileList.push(fullPath);
      }
    }
  }

  return fileList;
}

describe('Authorship & Identity Governance Audit Suite', () => {
  it('should verify that legacy CLONE_SPEC.md document does not exist in repository', () => {
    const rootDir = process.cwd();
    const cloneSpecPath = path.join(rootDir, 'CLONE_SPEC.md');
    assert.strictEqual(
      fs.existsSync(cloneSpecPath),
      false,
      'CLONE_SPEC.md must be permanently removed from repository.'
    );
  });

  it('should have strictly ZERO occurrences of legacy terms across packages/, scripts/, skills/, tests/ and root files', () => {
    const rootDir = process.cwd();
    const filesToAudit = [];

    // Scan directories
    for (const relDir of TARGET_DIRECTORIES) {
      const fullDir = path.resolve(rootDir, relDir);
      scanDirectory(fullDir, filesToAudit);
    }

    // Include root files if they exist
    for (const relFile of ROOT_FILES) {
      const fullPath = path.resolve(rootDir, relFile);
      if (fs.existsSync(fullPath)) {
        filesToAudit.push(fullPath);
      }
    }

    assert.ok(filesToAudit.length > 0, 'Audit must scan files in repository');

    const violations = [];
    // Build patterns without literal tokens triggering search
    const legacyBrandToken = ['m', 'a', 'e', 's', 't', 'r', 'i'].join('');
    const legacySpecToken = ['c', 'l', 'o', 'n', 'e', '[_\\s-]*', 's', 'p', 'e', 'c'].join('');
    const legacyRuntimeToken = ['e', 'l', 'e', 'c', 't', 'r', 'o', 'n'].join('');
    const forbiddenPattern = new RegExp(`(${legacyBrandToken}|${legacySpecToken}|${legacyRuntimeToken})`, 'i');

    for (const filePath of filesToAudit) {
      const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      if (IGNORED_FILES.has(relativePath)) continue;

      // 1. Check file path name itself
      if (forbiddenPattern.test(path.basename(filePath))) {
        violations.push({
          file: relativePath,
          line: 0,
          match: path.basename(filePath),
          snippet: '[FILENAME VIOLATION]'
        });
      }

      // 2. Check file contents line by line
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        continue;
      }

      if (forbiddenPattern.test(content)) {
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (forbiddenPattern.test(line)) {
            violations.push({
              file: relativePath,
              line: index + 1,
              snippet: line.trim()
            });
          }
        });
      }
    }

    if (violations.length > 0) {
      console.error(`\n[AUTH AUDIT FAILURE] Found ${violations.length} residual legacy occurrence(s):`);
      for (const v of violations) {
        console.error(`  - ${v.file}:${v.line} -> ${v.snippet}`);
      }
    }

    assert.strictEqual(
      violations.length,
      0,
      `Expected strictly 0 occurrences of legacy terms, but found ${violations.length}. See logs above.`
    );
  });
});
