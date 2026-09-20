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

  -- One market-breadth reading per day. Like iv_snapshots, this only becomes
  -- useful once it has run for a while: the level matters less than whether
  -- it is rising or falling.
  CREATE TABLE IF NOT EXISTS regime_snapshots (
    date          TEXT PRIMARY KEY,   -- YYYY-MM-DD
    above_pct     REAL NOT NULL,      -- share of the universe above its 200-day
    universe_size INTEGER NOT NULL,
    new_highs     INTEGER NOT NULL DEFAULT 0,
    new_lows      INTEGER NOT NULL DEFAULT 0
  );

  -- Macro events entered by hand (FOMC, CPI, a Fed speaker worth watching).
  -- The free Finnhub tier often lacks the economic calendar, so this is both
  -- a fallback and a place to record the dates you actually care about.
  CREATE TABLE IF NOT EXISTS econ_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,          -- YYYY-MM-DD
    time       TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL,
    impact     TEXT NOT NULL DEFAULT 'high',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

// ---- Market-regime breadth history ----
export function saveRegimeSnapshot({ date, abovePct, universeSize, newHighs = 0, newLows = 0 }) {
  db.prepare(
    `INSERT INTO regime_snapshots (date, above_pct, universe_size, new_highs, new_lows)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       above_pct = excluded.above_pct,
       universe_size = excluded.universe_size,
       new_highs = excluded.new_highs,
       new_lows = excluded.new_lows`
  ).run(date, Number(abovePct), Number(universeSize), Number(newHighs), Number(newLows));
}

// Most recent first, so callers can look back for a comparable reading.
export function getRegimeHistory(limit = 30) {
  return db
    .prepare('SELECT * FROM regime_snapshots ORDER BY date DESC LIMIT ?')
    .all(Number(limit) || 30);
}

// ---- Hand-entered macro events ----
export function listEconEvents(fromDate, toDate) {
  if (fromDate && toDate) {
    return db
      .prepare('SELECT * FROM econ_events WHERE date >= ? AND date <= ? ORDER BY date ASC')
      .all(fromDate, toDate);
  }
  if (fromDate) {
    return db
      .prepare('SELECT * FROM econ_events WHERE date >= ? ORDER BY date ASC')
      .all(fromDate);
  }
  return db.prepare('SELECT * FROM econ_events ORDER BY date ASC').all();
}

export function addEconEvent({ date, title, time = '', impact = 'high', notes = '' }) {
  const info = db
    .prepare('INSERT INTO econ_events (date, time, title, impact, notes) VALUES (?, ?, ?, ?, ?)')
    .run(
      String(date).slice(0, 10),
      String(time).slice(0, 5),
      String(title).trim(),
      ['high', 'medium', 'low'].includes(impact) ? impact : 'high',
      String(notes)
    );
  return db.prepare('SELECT * FROM econ_events WHERE id = ?').get(info.lastInsertRowid);
}

export function removeEconEvent(id) {
  return db.prepare('DELETE FROM econ_events WHERE id = ?').run(Number(id));
}
