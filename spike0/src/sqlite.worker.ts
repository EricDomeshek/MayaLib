/// <reference lib="webworker" />
// SQLite (official WASM build) with FTS5, stored in OPFS through the opfs-sahpool VFS (design D17).
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Req =
  | { id: number; cmd: 'init' }
  | { id: number; cmd: 'populate'; n: number; words: number }
  | { id: number; cmd: 'query'; q: string }
  | { id: number; cmd: 'stats' }
  | { id: number; cmd: 'reset' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

const VOCAB = ('minimum wage employment elasticity labor market search matching monopsony ' +
  'difference differences identification instrument regression discontinuity panel cohort ' +
  'household consumption savings credit constraint inflation expectation monetary policy fiscal ' +
  'multiplier tariff trade gravity productivity firm entry exit innovation patent growth capital ' +
  'education return schooling health insurance mortality migration remittance housing rent ' +
  'auction mechanism contract incentive information asymmetry bargaining network peer effect').split(' ');

function words(n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(VOCAB[(Math.random() * VOCAB.length) | 0]);
  return out.join(' ');
}

function openDb() {
  db = new pool.OpfsSAHPoolDb('/spike0.sqlite3');
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(title, body)');
}

function count(): number {
  return db.selectValue('SELECT count(*) FROM docs') as number;
}

function sizeBytes(): number {
  const pages = db.selectValue('PRAGMA page_count') as number;
  const size = db.selectValue('PRAGMA page_size') as number;
  return pages * size;
}

async function handle(m: Req): Promise<unknown> {
  switch (m.cmd) {
    case 'init': {
      const t0 = performance.now();
      sqlite3 = await sqlite3InitModule();
      const t1 = performance.now();
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'mayalib-spike0', initialCapacity: 6 });
      openDb();
      return {
        sqliteVersion: sqlite3.version.libVersion,
        initMs: Math.round(t1 - t0),
        vfsMs: Math.round(performance.now() - t1),
        existingRows: count(),
        dbBytes: sizeBytes(),
      };
    }
    case 'populate': {
      const t0 = performance.now();
      const stmt = db.prepare('INSERT INTO docs(title, body) VALUES (?, ?)');
      db.exec('BEGIN');
      try {
        for (let i = 0; i < m.n; i++) {
          stmt.bind([words(8), words(m.words)]).stepReset();
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        stmt.finalize();
      }
      return { inserted: m.n, wordsEach: m.words, ms: Math.round(performance.now() - t0), totalRows: count(), dbBytes: sizeBytes() };
    }
    case 'query': {
      const t0 = performance.now();
      const rows = db.selectObjects(
        "SELECT rowid, snippet(docs, 1, '[', ']', '…', 8) AS snip FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT 20",
        [m.q],
      );
      const t1 = performance.now();
      const total = db.selectValue('SELECT count(*) FROM docs WHERE docs MATCH ?', [m.q]);
      return { q: m.q, topMs: Math.round(t1 - t0), countMs: Math.round(performance.now() - t1), total, sample: rows.slice(0, 3) };
    }
    case 'stats':
      return { rows: count(), dbBytes: sizeBytes(), poolFiles: pool.getFileCount(), poolCapacity: pool.getCapacity() };
    case 'reset': {
      db.close();
      await pool.wipeFiles();
      openDb();
      return { rows: count() };
    }
  }
}

self.onmessage = async (e: MessageEvent<Req>) => {
  try {
    const result = await handle(e.data);
    self.postMessage({ id: e.data.id, ok: true, result });
  } catch (err) {
    self.postMessage({ id: e.data.id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
