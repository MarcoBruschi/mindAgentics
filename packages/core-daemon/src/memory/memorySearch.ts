/**
 * Local memory search over `.mindagentics/memory/<agente>/log*.jsonl`.
 *
 * Engines (all offline, zero API calls):
 *  1. SQLite FTS5 (`index.db`, bm25 ranking) via `node:sqlite` (Node >= 22.5) or
 *     `better-sqlite3` when installed. The index is created and kept in sync
 *     incrementally from the JSONL logs (rows newer than the last indexed ts).
 *  2. In-process BM25 over the same logs when no SQLite binding exists in the
 *     runtime (e.g. Node 20).
 *
 * NOTE: the folder naming (`agentSlug`) must stay identical to
 * packages/core-daemon/src/memory/memoryService.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export const MEMORY_DIR_NAME = path.join('.mindagentics', 'memory');

export interface MemoryHit {
  agent: string;
  ts: string;
  turn: number;
  score: number;
  excerpt: string;
}

export type MemoryEngine = 'sqlite-fts5' | 'bm25-js';

export interface MemorySearchResult {
  engine: MemoryEngine;
  hits: MemoryHit[];
}

interface LogTurn {
  ts: string;
  agent: string;
  turn: number;
  input: string;
  output: string;
}

export function agentSlug(name: string, fallback = 'agent'): string {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || fallback;
}

/** Nearest `.mindagentics/memory` folder walking up from `start`. */
export function findMemoryRoot(start: string | undefined): string | null {
  if (!start) return null;
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, MEMORY_DIR_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function listAgentMemoryDirs(memoryRoot: string): string[] {
  try {
    return fs
      .readdirSync(memoryRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(memoryRoot, d.name));
  } catch {
    return [];
  }
}

function readLogs(dir: string): LogTurn[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^log(\.\d+)?\.jsonl$/.test(f))
    // oldest first: log.3 -> log.2 -> log.1 -> log
    .sort((a, b) => {
      const n = (f: string) => (f === 'log.jsonl' ? 0 : Number(f.match(/\.(\d+)\./)?.[1] ?? 0));
      return n(b) - n(a);
    });
  const out: LogTurn[] = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const t = JSON.parse(line);
        if (t && typeof t.ts === 'string') {
          out.push({
            ts: t.ts,
            agent: String(t.agent || ''),
            turn: Number(t.turn) || 0,
            input: String(t.input || ''),
            output: String(t.output || ''),
          });
        }
      } catch {
        /* skip corrupted line */
      }
    }
  }
  return out;
}

function tokenize(text: string): string[] {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}_]{2,}/gu) || []
  );
}

function makeExcerpt(t: LogTurn, queryTokens: string[], size = 380): string {
  const q = t.input ? `Pedido: ${t.input.replace(/\s+/g, ' ').slice(0, 120)}\n` : '';
  const body = t.output.replace(/[ \t]+/g, ' ');
  const folded = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let idx = -1;
  for (const tok of queryTokens) {
    const i = folded.indexOf(tok);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  const start = Math.max(0, (idx < 0 ? 0 : idx) - 80);
  const slice = body.slice(start, start + size).trim();
  return `${q}${start > 0 ? '…' : ''}${slice}${start + size < body.length ? '…' : ''}`;
}

// ------------------------------------------------------------------ SQLite

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: any[]): any; all(...a: any[]): any[]; get(...a: any[]): any };
  close(): void;
};

function openSqlite(file: string): SqliteDb | null {
  const req = createRequire(import.meta.url);
  try {
    const { DatabaseSync } = req('node:sqlite');
    return new DatabaseSync(file) as SqliteDb;
  } catch {
    /* fall through */
  }
  try {
    const Better = req('better-sqlite3');
    return new Better(file) as SqliteDb;
  } catch {
    return null;
  }
}

/** Create / incrementally refresh `index.db` from the JSONL logs. */
export function syncIndex(dir: string): SqliteDb | null {
  const db = openSqlite(path.join(dir, 'index.db'));
  if (!db) return null;
  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS turns USING fts5(
         input, output, ts UNINDEXED, agent UNINDEXED, turn UNINDEXED,
         tokenize = 'unicode61 remove_diacritics 2'
       )`,
    );
    const last = (db.prepare('SELECT max(ts) AS ts FROM turns').get() as any)?.ts as string | null;
    const fresh = readLogs(dir).filter((t) => !last || t.ts > last);
    if (fresh.length) {
      const ins = db.prepare('INSERT INTO turns (input, output, ts, agent, turn) VALUES (?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      for (const t of fresh) ins.run(t.input, t.output, t.ts, t.agent, t.turn);
      db.exec('COMMIT');
    }
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {}
    return null;
  }
}

function searchSqlite(dir: string, tokens: string[], limit: number): MemoryHit[] | null {
  const db = syncIndex(dir);
  if (!db) return null;
  try {
    const match = tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    // bm25: lower is better; weight the user's request above the answer
    const rows = db
      .prepare(
        `SELECT ts, agent, turn, input, output, bm25(turns, 2.0, 1.0) AS score
           FROM turns WHERE turns MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(match, limit) as any[];
    return rows.map((r) => ({
      agent: String(r.agent),
      ts: String(r.ts),
      turn: Number(r.turn),
      score: -Number(r.score),
      excerpt: makeExcerpt(
        { ts: r.ts, agent: r.agent, turn: Number(r.turn), input: r.input, output: r.output },
        tokens,
      ),
    }));
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

// -------------------------------------------------------------- BM25 (JS)

function searchBm25(turns: LogTurn[], tokens: string[], limit: number): MemoryHit[] {
  const docs = turns.map((t) => {
    const terms = [...tokenize(t.input), ...tokenize(t.input), ...tokenize(t.output)];
    const tf = new Map<string, number>();
    for (const w of terms) tf.set(w, (tf.get(w) || 0) + 1);
    return { t, tf, len: terms.length };
  });
  const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  const k1 = 1.2;
  const b = 0.75;
  const df = new Map<string, number>();
  for (const tok of tokens) df.set(tok, docs.filter((d) => d.tf.has(tok)).length);

  return docs
    .map((d) => {
      let score = 0;
      for (const tok of tokens) {
        const f = d.tf.get(tok) || 0;
        if (!f) continue;
        const n = df.get(tok) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / avg));
      }
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score || (a.d.t.ts < b2.d.t.ts ? 1 : -1))
    .slice(0, limit)
    .map(({ d, score }) => ({
      agent: d.t.agent,
      ts: d.t.ts,
      turn: d.t.turn,
      score,
      excerpt: makeExcerpt(d.t, tokens),
    }));
}

/** Top `limit` snippets across the given agent memory folders. */
export function searchMemory(dirs: string[], query: string, limit = 3): MemorySearchResult {
  const tokens = Array.from(new Set(tokenize(query)));
  if (tokens.length === 0 || dirs.length === 0) return { engine: 'bm25-js', hits: [] };

  let engine: MemoryEngine = 'sqlite-fts5';
  const hits: MemoryHit[] = [];
  for (const dir of dirs) {
    const viaSql = searchSqlite(dir, tokens, limit);
    if (viaSql) {
      hits.push(...viaSql);
    } else {
      engine = 'bm25-js';
      try {
        hits.push(...searchBm25(readLogs(dir), tokens, limit));
      } catch {
        /* unreadable dir */
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return { engine, hits: hits.slice(0, limit) };
}
