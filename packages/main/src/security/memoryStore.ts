import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MEMORY_DIR_NAME,
  MEMORY_MAX_ENTRIES,
  MEMORY_RETENTION_DAYS,
  sanitizeMemoryText,
  wrapUntrustedMemory,
} from '@mindagentics/shared';

/**
 * S3 / S4 — Workspace-local terminal memory (`<workspace>/.mindagentics/memory`).
 *  - everything is redacted + capped BEFORE touching disk
 *  - directory 0700 / files 0600 (POSIX; on Windows the user-profile ACL applies and chmod is a no-op)
 *  - dir is git-ignored (root .gitignore entry + self-ignoring inner .gitignore)
 *  - retention: max age + max entries, pruned on every write
 *  - summaries are returned framed as untrusted data
 */

const GITIGNORE_ENTRY = `${MEMORY_DIR_NAME}/`;

export function ensureGitignoreEntry(workspaceRoot: string): void {
  const file = path.join(workspaceRoot, '.gitignore');
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  const has = current.split(/\r?\n/).some((l) => {
    const t = l.trim().replace(/^\//, '');
    return t === GITIGNORE_ENTRY || t === MEMORY_DIR_NAME || t === '.mindagentics/' || t === '.mindagentics';
  });
  if (has) return;
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const prefix = current.length && !current.endsWith('\n') ? eol : '';
  fs.appendFileSync(file, `${prefix}${eol}# mindAgentics terminal memory (may contain sensitive context)${eol}${GITIGNORE_ENTRY}${eol}`, 'utf8');
}

export function ensureMemoryDir(workspaceRoot: string): string {
  const dir = path.join(workspaceRoot, ...MEMORY_DIR_NAME.split('/'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* windows */ }
  const inner = path.join(dir, '.gitignore');
  if (!fs.existsSync(inner)) fs.writeFileSync(inner, '*\n', { encoding: 'utf8', mode: 0o600 });
  try { ensureGitignoreEntry(workspaceRoot); } catch { /* read-only workspace: inner .gitignore still protects */ }
  return dir;
}

function safeId(id: string): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'terminal';
}

export function pruneMemory(
  dir: string,
  opts: { maxAgeDays?: number; maxEntries?: number; now?: number } = {},
): number {
  const maxAge = (opts.maxAgeDays ?? MEMORY_RETENTION_DAYS) * 86_400_000;
  const maxEntries = opts.maxEntries ?? MEMORY_MAX_ENTRIES;
  const now = opts.now ?? Date.now();
  let removed = 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => {
    const full = path.join(dir, f);
    return { full, mtime: fs.statSync(full).mtimeMs };
  });
  for (const f of files) {
    if (now - f.mtime > maxAge) { fs.rmSync(f.full, { force: true }); removed++; continue; }
    const lines = fs.readFileSync(f.full, 'utf8').split('\n').filter(Boolean);
    const kept = lines.filter((l) => {
      try { return now - Date.parse(JSON.parse(l).timestamp) <= maxAge; } catch { return false; }
    }).slice(-maxEntries);
    if (kept.length !== lines.length) {
      removed += lines.length - kept.length;
      fs.writeFileSync(f.full, kept.length ? kept.join('\n') + '\n' : '', { encoding: 'utf8', mode: 0o600 });
    }
  }
  return removed;
}

export function appendMemory(workspaceRoot: string, terminalId: string, text: string, now = Date.now()): void {
  const dir = ensureMemoryDir(workspaceRoot);
  const clean = sanitizeMemoryText(text);
  if (!clean.trim()) return;
  const file = path.join(dir, `${safeId(terminalId)}.jsonl`);
  fs.appendFileSync(file, JSON.stringify({ terminalId: safeId(terminalId), timestamp: new Date(now).toISOString(), text: clean }) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
  pruneMemory(dir, { now });
}

/** Returns the stored memory of a terminal as an untrusted-data block, size-limited. */
export function readMemorySummary(workspaceRoot: string, terminalId: string, maxChars?: number): string {
  const file = path.join(workspaceRoot, ...MEMORY_DIR_NAME.split('/'), `${safeId(terminalId)}.jsonl`);
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return wrapUntrustedMemory('', maxChars); }
  const texts: string[] = [];
  for (const l of raw.split('\n').filter(Boolean).slice(-20)) {
    try { texts.push(String(JSON.parse(l).text ?? '')); } catch { /* skip */ }
  }
  return wrapUntrustedMemory(texts.join('\n---\n'), maxChars);
}
