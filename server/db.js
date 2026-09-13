// SQLite setup using Node's built-in node:sqlite (no native build step).
// Stores the shared watchlist — both users see the same rows.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'planner.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT NOT NULL,
    shares     INTEGER NOT NULL DEFAULT 0,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One at-the-money IV reading per symbol per day. Over time this becomes
  -- our home-grown IV-rank history (nobody gives that away free).
  CREATE TABLE IF NOT EXISTS iv_snapshots (
    symbol TEXT NOT NULL,
    date   TEXT NOT NULL,          -- YYYY-MM-DD
    iv     REAL NOT NULL,
    PRIMARY KEY (symbol, date)
  );

  -- User settings (API keys, display name). Overrides .env when present.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

export function listWatchlist() {
  return db.prepare('SELECT * FROM watchlist ORDER BY created_at DESC').all();
}

export function addWatchlist({ symbol, shares = 0, notes = '' }) {
  const stmt = db.prepare(
    'INSERT INTO watchlist (symbol, shares, notes) VALUES (?, ?, ?)'
  );
  const info = stmt.run(symbol.toUpperCase().trim(), Number(shares) || 0, String(notes));
  return db.prepare('SELECT * FROM watchlist WHERE id = ?').get(info.lastInsertRowid);
}

export function removeWatchlist(id) {
  return db.prepare('DELETE FROM watchlist WHERE id = ?').run(Number(id));
}

// Record today's ATM IV (idempotent — one row per symbol per day).
export function saveIvSnapshot(symbol, date, iv) {
  db.prepare(
    `INSERT INTO iv_snapshots (symbol, date, iv) VALUES (?, ?, ?)
     ON CONFLICT(symbol, date) DO UPDATE SET iv = excluded.iv`
  ).run(symbol.toUpperCase(), date, iv);
}

export function getIvHistory(symbol) {
  return db
    .prepare('SELECT date, iv FROM iv_snapshots WHERE symbol = ? ORDER BY date ASC')
    .all(symbol.toUpperCase());
}

export default db;
