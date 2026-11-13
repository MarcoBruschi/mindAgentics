import * as fs from 'node:fs';
import * as path from 'node:path';
import { PATH_MAX_CHARS, hasControlChars } from '@mindagentics/shared';

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
  path?: string;
  reason?: PathDenyReason;
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

export function checkPathString(input: unknown): PathCheckResult {
  if (typeof input !== 'string') return deny('invalid-type', 'caminho deve ser uma string');
  if (input.length === 0 || input.trim().length === 0) return deny('empty', 'caminho vazio');
  if (input.length > PATH_MAX_CHARS) return deny('too-long', 'caminho excede o limite de tamanho');
  if (hasControlChars(input)) return deny('control-chars', 'caminho contém caracteres de controle');
  if (/^[\\/]{2}/.test(input)) return deny('unc', 'caminhos UNC / namespace de dispositivo não são permitidos');
  if (isWin) {
    const rest = /^[a-zA-Z]:/.test(input) ? input.slice(2) : input;
    if (rest.includes(':')) return deny('stream', 'alternate data streams / ":" inválido no caminho');
    for (const seg of input.split(/[\\/]/)) {
      if (WIN_RESERVED.test(seg)) return deny('device', `nome de dispositivo reservado no Windows: ${seg}`);
    }
  }
  return { ok: true };
}

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
    return deny('invalid-root', 'workspace root deve ser um caminho absoluto válido');
  }
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    return deny('invalid-root', 'diretório do workspace não encontrado');
  }

  const lexical = path.resolve(realRoot, input as string);
  const lexicalOutside = !isInside(realRoot, lexical);
  if (lexicalOutside && !opts.confirmOutside) {
    return deny('outside-workspace', 'o caminho escapa do workspace sem confirmação (--confirm-outside)', true);
  }

  const real = realpathLoose(lexical);
  if (!isInside(realRoot, real) && !opts.confirmOutside) {
    return deny('symlink-escape', 'o caminho resolve via symlink para fora do workspace sem confirmação (--confirm-outside)', true);
  }
  return { ok: true, path: real };
}

/** Throwing helper for IPC/CLI handlers: returns the safe path string or throws. */
export function assertSafePathString(input: unknown): string {
  const r = checkPathString(input);
  if (!r.ok) throw new Error(`Invalid path: ${r.message}`);
  return path.normalize(input as string);
}
