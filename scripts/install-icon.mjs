#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
export const MAX_ICON_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Validates a PNG icon file against path traversal, existence, size limits (<10MB)
 * and correct PNG Magic Bytes (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A).
 */
export function validatePngIcon(filePath, baseDir = null) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return { ok: false, reason: 'Caminho do ícone inválido ou vazio' };
  }

  // Prevent null bytes or control characters in path
  if (filePath.includes('\0') || /[\x00-\x1F\x7F]/.test(filePath)) {
    return { ok: false, reason: 'Caminho contém caracteres de controle ou null bytes' };
  }

  // Canonical path resolution preventing path traversal
  const canonicalPath = path.resolve(filePath);

  if (baseDir) {
    const canonicalBase = path.resolve(baseDir);
    const rel = path.relative(canonicalBase, canonicalPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: 'Path traversal detectado: caminho fora da base permitida', canonicalPath };
    }
  }

  if (!fs.existsSync(canonicalPath)) {
    return { ok: false, reason: `Arquivo não encontrado: "${canonicalPath}"`, canonicalPath };
  }

  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) {
    return { ok: false, reason: 'Caminho não aponta para um arquivo comum', canonicalPath };
  }

  if (stat.size > MAX_ICON_SIZE_BYTES) {
    return {
      ok: false,
      reason: `Tamanho do arquivo (${stat.size} bytes) excede o limite seguro de 10 MB`,
      canonicalPath,
      size: stat.size,
    };
  }

  if (stat.size < 8) {
    return {
      ok: false,
      reason: 'Arquivo menor que o cabeçalho de 8 bytes de PNG',
      canonicalPath,
      size: stat.size,
    };
  }

  const fd = fs.openSync(canonicalPath, 'r');
  const headerBuf = Buffer.alloc(8);
  try {
    fs.readSync(fd, headerBuf, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
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
 * Safely copies a validated icon to target destinations.
 */
export function installIcon(sourcePath, destinations = []) {
  const validation = validatePngIcon(sourcePath);
  if (!validation.ok) {
    throw new Error(`Validação do ícone falhou: ${validation.reason}`);
  }

  const results = [];
  for (const dest of destinations) {
    const destCanonical = path.resolve(dest);
    const destDir = path.dirname(destCanonical);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(validation.canonicalPath, destCanonical);
    results.push(destCanonical);
  }

  return { ok: true, source: validation.canonicalPath, installedTo: results };
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || 'scripts/install-icon.mjs')) {
  const defaultSource = 'C:\\Users\\mabru\\Downloads\\mindAgentics_icon_1024.png';
  const targetSource = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;

  console.log(`[install-icon] Validando arquivo: "${targetSource}"...`);
  const check = validatePngIcon(targetSource);
  if (!check.ok) {
    console.error(`[install-icon] ERRO: ${check.reason}`);
    process.exit(1);
  }

  console.log(`[install-icon] Ícone PNG válido! Magic Bytes confirmados. Tamanho: ${check.size} bytes.`);

  const targets = [
    'packages/renderer/public/icon.png',
    'packages/renderer/public/favicon.png',
    'src-tauri/icons/icon.png',
    'src-tauri/icons/app-icon.png',
    'build/icon.png',
  ];

  try {
    const res = installIcon(targetSource, targets);
    console.log(`[install-icon] Ícone instalado com sucesso em ${res.installedTo.length} destinos:`);
    for (const d of res.installedTo) {
      console.log(`  -> ${d}`);
    }
  } catch (err) {
    console.error('[install-icon] Erro na instalação:', err.message);
    process.exit(1);
  }
}
