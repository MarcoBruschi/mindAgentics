import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
export const MAX_ICON_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface IconValidationResult {
  ok: boolean;
  reason?: string;
  canonicalPath?: string;
  size?: number;
}

/**
 * Validates a PNG icon file against path traversal, file existence, size limits (<10MB)
 * and correct PNG Magic Bytes (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A).
 */
export function validatePngIcon(filePath: string, baseDir?: string): IconValidationResult {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return { ok: false, reason: 'Caminho do ícone inválido ou vazio' };
  }

  // Canonical path resolution to prevent path traversal
  const canonicalPath = path.resolve(filePath);

  // If a baseDir is specified, ensure the path does not escape the boundary
  if (baseDir) {
    const canonicalBase = path.resolve(baseDir);
    const rel = path.relative(canonicalBase, canonicalPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: 'Path traversal detectado: caminho fora do diretório permitido', canonicalPath };
    }
  }

  // Null byte or control character detection
  if (filePath.includes('\0') || /[\x00-\x1F\x7F]/.test(filePath)) {
    return { ok: false, reason: 'Caminho contém caracteres de controle ou null bytes', canonicalPath };
  }

  if (!fs.existsSync(canonicalPath)) {
    return { ok: false, reason: `Arquivo não encontrado: "${canonicalPath}"`, canonicalPath };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(canonicalPath);
  } catch (err: any) {
    return { ok: false, reason: `Erro ao obter metadados do arquivo: ${err?.message || err}`, canonicalPath };
  }

  if (!stat.isFile()) {
    return { ok: false, reason: 'Caminho não aponta para um arquivo comum', canonicalPath };
  }

  if (stat.size > MAX_ICON_SIZE_BYTES) {
    return {
      ok: false,
      reason: `Tamanho excede o limite seguro de 10 MB: ${stat.size} bytes`,
      canonicalPath,
      size: stat.size,
    };
  }

  if (stat.size < 8) {
    return {
      ok: false,
      reason: 'Arquivo truncado ou menor que o cabeçalho PNG (8 bytes)',
      canonicalPath,
      size: stat.size,
    };
  }

  let fd: number | null = null;
  const headerBuf = Buffer.alloc(8);
  try {
    fd = fs.openSync(canonicalPath, 'r');
    const bytesRead = fs.readSync(fd, headerBuf, 0, 8, 0);
    if (bytesRead < 8) {
      return { ok: false, reason: 'Falha ao ler cabeçalho de 8 bytes do arquivo', canonicalPath };
    }
  } catch (err: any) {
    return { ok: false, reason: `Falha de leitura do arquivo: ${err?.message || err}`, canonicalPath };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }

  if (!headerBuf.equals(PNG_MAGIC_BYTES)) {
    return {
      ok: false,
      reason: 'Magic Bytes de PNG inválidos (esperado 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)',
      canonicalPath,
    };
  }

  return { ok: true, canonicalPath, size: stat.size };
}

/**
 * Safely copies an icon from source to destination, validating the source and using canonical paths.
 */
export function safeCopyIcon(sourcePath: string, destinationPath: string): { ok: boolean; reason?: string; destinationPath?: string } {
  const validation = validatePngIcon(sourcePath);
  if (!validation.ok || !validation.canonicalPath) {
    return { ok: false, reason: validation.reason || 'Validação do ícone de origem falhou' };
  }

  const destCanonical = path.resolve(destinationPath);
  try {
    const destDir = path.dirname(destCanonical);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(validation.canonicalPath, destCanonical);
    return { ok: true, destinationPath: destCanonical };
  } catch (err: any) {
    return { ok: false, reason: `Erro ao copiar ícone: ${err?.message || err}` };
  }
}

/**
 * Resolves and validates the app icon from canonical candidate paths.
 * Returns the canonical path of a valid icon, or null if none found or corrupt.
 */
export function resolveAppIcon(): string | null {
  const isWin = process.platform === 'win32';

  let candidates: string[];

  if (isWin) {
    candidates = [
      path.resolve(process.cwd(), 'src-tauri/icons/icon.ico'),
      path.resolve(__dirname, '../../../../src-tauri/icons/icon.ico'),
      path.resolve(process.cwd(), 'build/icon.ico'),
      path.resolve(process.cwd(), 'src-tauri/icons/icon.png'),
      path.resolve(__dirname, '../../../../src-tauri/icons/icon.png'),
      path.resolve(__dirname, '../../../renderer/public/icon.png'),
      path.resolve(process.cwd(), 'packages/renderer/public/icon.png'),
      path.resolve(process.cwd(), 'build/icon.png'),
    ].filter(Boolean);
  } else {
    candidates = [
      path.resolve(process.cwd(), 'src-tauri/icons/icon.png'),
      path.resolve(__dirname, '../../../../src-tauri/icons/icon.png'),
      path.resolve(__dirname, '../../../renderer/public/icon.png'),
      path.resolve(process.cwd(), 'packages/renderer/public/icon.png'),
      path.resolve(process.cwd(), 'build/icon.png'),
      path.resolve(process.cwd(), 'src-tauri/icons/icon.ico'),
    ].filter(Boolean);
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (c.endsWith('.png')) {
        const check = validatePngIcon(c);
        if (check.ok && check.canonicalPath) {
          return check.canonicalPath;
        }
      } else if (c.endsWith('.ico')) {
        // ICO size check to prevent DoS
        try {
          const stat = fs.statSync(c);
          if (stat.isFile() && stat.size > 0 && stat.size <= MAX_ICON_SIZE_BYTES) {
            return path.resolve(c);
          }
        } catch {}
      }
    }
  }

  return null;
}
