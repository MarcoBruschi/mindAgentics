import * as fs from 'node:fs';
import * as path from 'node:path';
import { PATH_MAX_CHARS, hasControlChars } from '@mindagentics/shared';

/**
 * S1 — Workspace path confinement for `fileRef`, `ref add` and any renderer-supplied path.
 *
 * Rules:
 *  - normalize (resolve, strip trailing separators) relative to the workspace root
 *  - NEVER accept control chars (NUL/LF/ESC...), UNC / device namespaces, NTFS alternate data streams
 *    or reserved device names, even with confirmation
 *  - `..` traversal and symlinks/junctions that resolve outside of the workspace are denied
 *    unless the caller passes `confirmOutside: true` (i.e. the user explicitly confirmed in the UI)
 */

export type PathDenyReason =
  | 'invalid-type'
  | 'empty'
  | 'too-long'
  | 'control-chars'
  | 'unc'
  | 'stream'
  | 'device'
  | 'invalid-root'
  | 'outside-workspace'
  | 'symlink-escape';

export interface PathCheckResult {
  ok: boolean;
  /** Normalized absolute path (real path when the target or an ancestor exists). */
  path?: string;
  reason?: PathDenyReason;
  /** True when the only blocker can be lifted by an explicit user confirmation. */
  requiresConfirmation?: boolean;
  message?: string;
}

const isWin = process.platform === 'win32';
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function norm(p: string): string {
  const n = path.normalize(p).replace(/[\\/]+$/, '');
  return isWin ? n.toLowerCase() : n;
}

export function isInside(parent: string, child: string): boolean {
  const p = norm(parent);
  const c = norm(child);
  if (c === p) return true;
  const rel = path.relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function deny(reason: PathDenyReason, message: string, requiresConfirmation = false): PathCheckResult {
  return { ok: false, reason, message, requiresConfirmation };
}

/** Syntax-only validation of a path string (no workspace needed). */
export function checkPathString(input: unknown): PathCheckResult {
  if (typeof input !== 'string') return deny('invalid-type', 'path must be a string');
  if (input.length === 0 || input.trim().length === 0) return deny('empty', 'path is empty');
  if (input.length > PATH_MAX_CHARS) return deny('too-long', 'path is too long');
  if (hasControlChars(input)) return deny('control-chars', 'path contains control characters');
  if (/^[\\/]{2}/.test(input)) return deny('unc', 'UNC / device paths are not allowed');
  if (isWin) {
    // alternate data streams: anything with ':' other than the drive-letter colon
    const rest = /^[a-zA-Z]:/.test(input) ? input.slice(2) : input;
    if (rest.includes(':')) return deny('stream', 'alternate data streams / invalid ":" in path');
    for (const seg of input.split(/[\\/]/)) {
      if (WIN_RESERVED.test(seg)) return deny('device', `reserved device name: ${seg}`);
    }
  }
  return { ok: true };
}

/** Real path of the deepest existing ancestor + the not-yet-existing remainder. */
function realpathLoose(p: string): string {
  let current = p;
  const rest: string[] = [];
  for (let i = 0; i < 4096; i++) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      rest.push(path.basename(current));
      current = parent;
    }
  }
  return p;
}

export function resolveWorkspacePath(
  workspaceRoot: unknown,
  input: unknown,
  opts: { confirmOutside?: boolean } = {},
): PathCheckResult {
  const syntax = checkPathString(input);
  if (!syntax.ok) return syntax;
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || checkPathString(workspaceRoot).ok === false) {
    return deny('invalid-root', 'workspace root must be a valid absolute path');
  }
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    return deny('invalid-root', 'workspace root does not exist');
  }

  const lexical = path.resolve(realRoot, input as string);
  const lexicalOutside = !isInside(realRoot, lexical);
  if (lexicalOutside && !opts.confirmOutside) {
    return deny('outside-workspace', 'path escapes the workspace (traversal or absolute path)', true);
  }

  const real = realpathLoose(lexical);
  if (!isInside(realRoot, real) && !opts.confirmOutside) {
    return deny('symlink-escape', 'path resolves through a symlink/junction outside the workspace', true);
  }
  return { ok: true, path: real };
}

/** Throwing helper for IPC handlers: returns the safe path string or throws. */
export function assertSafePathString(input: unknown): string {
  const r = checkPathString(input);
  if (!r.ok) throw new Error(`Invalid path: ${r.message}`);
  return path.normalize(input as string);
}
