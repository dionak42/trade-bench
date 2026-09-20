// SQLite setup using Node's built-in node:sqlite (no native build step).
// Stores the shared watchlist, the IV history, settings, and the trade
// journal — both users see the same rows.
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

  -- The trade journal: one row per DECISION, not per fill. A row is written
  -- the moment a plan is committed to (planned), updated when it fills (open),
  -- and reviewed once it's done (closed). The review columns are the point of
  -- the whole table — outcome tells you what happened, followed_rules tells
  -- you whether you actually ran your system, and only the two together turn
  -- reps into a lesson.
  CREATE TABLE IF NOT EXISTS trades (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol         TEXT NOT NULL,
    kind           TEXT DEFAULT 'stock',    -- stock | covered_call | csp
    source         TEXT DEFAULT 'paper',    -- paper | replay | live
    status         TEXT DEFAULT 'planned',  -- planned | open | closed
    entry_style    TEXT DEFAULT '',         -- pullback | breakout

    -- The plan, as committed to up front. Never edited after the fact —
    -- comparing it to what happened is the review.
    entry          REAL,
    target         REAL,
    stop           REAL,
    shares         INTEGER,
    risk_per_share REAL,
    planned_risk   REAL,                    -- dollars at risk if stopped (1R)
    reward_risk    REAL,                    -- planned reward-to-risk ratio
    thesis         TEXT DEFAULT '',         -- why you took it, in your words

    -- What the scorecard showed when you decided. Lets a later review ask
    -- "what was I looking at?" instead of guessing.
    ctx_price      REAL,
    ctx_trend      TEXT,
    ctx_regime     TEXT,
    ctx_rsi        REAL,

    order_id       TEXT DEFAULT '',         -- Alpaca order id, when placed

    -- What actually happened.
    entry_price    REAL,
    exit_price     REAL,
    entry_date     TEXT,
    exit_date      TEXT,
    outcome        TEXT,                    -- target | stopped | manual | no_fill
    pnl            REAL,
    r_multiple     REAL,                    -- P&L in multiples of planned risk

    -- The review.
    followed_rules INTEGER,                 -- 1 yes, 0 no, NULL not reviewed yet
    lesson         TEXT DEFAULT '',

    planned_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);
  CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol);

  -- Every distinct rule configuration ever tested in-sample.
  --
  -- This table exists to make a quiet form of self-deception visible. Try one
  -- set of rules and a good score is evidence. Try twenty and pick the best,
  -- and the winner is mostly luck — with twenty attempts you should EXPECT a
  -- flattering result even from rules with no edge at all. Nobody remembers
  -- how many variants they tried, so the count is kept for you.
  CREATE TABLE IF NOT EXISTS tested_variants (
    signature       TEXT PRIMARY KEY,   -- canonical JSON of the rule params
    first_tested    TEXT NOT NULL DEFAULT (datetime('now')),
    last_tested     TEXT NOT NULL DEFAULT (datetime('now')),
    times_run       INTEGER NOT NULL DEFAULT 1,
    in_sample_avg_r REAL
  );

  -- Each time the held-out period is looked at.
  --
  -- Out-of-sample data is only evidence while it is unseen. The first look is
  -- a test; every look after that is just more development data wearing a
  -- disguise, because you cannot un-know what you saw. The log is the honest
  -- record of how much of that evidence is left.
  CREATE TABLE IF NOT EXISTS oos_reveals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    revealed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    split_date   TEXT,
    signature    TEXT,
    oos_trades   INTEGER,
    oos_avg_r    REAL,
    in_sample_avg_r REAL
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

// ---------------------------------------------------------------------------
// Trade journal
// ---------------------------------------------------------------------------

// Column -> coercion. node:sqlite only binds null/number/string, so every
// value crossing the boundary goes through here; it also keeps the writable
// surface to an allowlist, so a client can't set `id` or `planned_at`.
const TRADE_FIELDS = {
  symbol: 'upper', kind: 'text', source: 'text', status: 'text', entry_style: 'text',
  entry: 'num', target: 'num', stop: 'num', shares: 'int',
  risk_per_share: 'num', planned_risk: 'num', reward_risk: 'num', thesis: 'text',
  ctx_price: 'num', ctx_trend: 'text', ctx_regime: 'text', ctx_rsi: 'num',
  order_id: 'text',
  entry_price: 'num', exit_price: 'num', entry_date: 'text', exit_date: 'text',
  outcome: 'text', pnl: 'num', r_multiple: 'num',
  followed_rules: 'bool', lesson: 'text',
};

function coerce(kind, v) {
  if (v === undefined || v === null || v === '') {
    return kind === 'text' || kind === 'upper' ? '' : null;
  }
  switch (kind) {
    case 'upper': return String(v).toUpperCase().trim();
    case 'text': return String(v);
    case 'int': { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
    case 'bool': return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    default: { const n = Number(v); return Number.isFinite(n) ? n : null; }
  }
}

// Pick out the writable fields a caller actually supplied.
function pickTradeFields(input) {
  const out = {};
  for (const [col, kind] of Object.entries(TRADE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(input, col)) out[col] = coerce(kind, input[col]);
  }
  return out;
}

// P&L and R are derived, never trusted from the client — a journal whose
// numbers drift from its own plan teaches the wrong lesson. R is the honest
// scorekeeper: it measures the result against the risk you *chose* to take,
// so a $200 win on a $100 risk and a $2,000 win on a $1,000 risk both read
// +2R, and position size stops flattering (or hiding) your judgment.
function deriveOutcome(row) {
  if (row.kind !== 'stock') return {};
  const { entry_price: e, exit_price: x, shares, risk_per_share: rps } = row;
  if (e == null || x == null) return {};
  const out = { pnl: Number(((x - e) * (shares || 0)).toFixed(2)) };
  if (rps != null && rps > 0) out.r_multiple = Number(((x - e) / rps).toFixed(3));
  return out;
}

function applyDerived(id) {
  const row = getTrade(id);
  if (!row) return null;
  const d = deriveOutcome(row);
  const cols = Object.keys(d);
  if (cols.length) {
    db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => d[c]), id);
    return getTrade(id);
  }
  return row;
}

export function getTrade(id) {
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(Number(id)) || null;
}

export function listTrades({ status, symbol, source, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(String(status)); }
  if (symbol) { where.push('symbol = ?'); args.push(String(symbol).toUpperCase()); }
  if (source) { where.push('source = ?'); args.push(String(source)); }
  const sql = `SELECT * FROM trades
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY planned_at DESC, id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(Number(limit) || 200, 1000));
}

export function createTrade(input = {}) {
  const fields = pickTradeFields(input);
  if (!fields.symbol) throw new Error('symbol is required');
  const cols = Object.keys(fields);
  const info = db
    .prepare(`INSERT INTO trades (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => fields[c]));
  return applyDerived(info.lastInsertRowid);
}

export function updateTrade(id, input = {}) {
  const fields = pickTradeFields(input);
  const cols = Object.keys(fields);
  if (!cols.length) return getTrade(id);
  db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = ?`).join(', ')},
              updated_at = datetime('now') WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), Number(id));
  // An explicit pnl/R in the patch wins (options trades, manual corrections);
  // otherwise the stock math is re-derived from the plan.
  if (fields.pnl != null || fields.r_multiple != null) return getTrade(id);
  return applyDerived(id);
}

export function deleteTrade(id) {
  return db.prepare('DELETE FROM trades WHERE id = ?').run(Number(id));
}

// The scoreboard. Win rate is the number people watch; expectancy (average R)
// is the one that decides whether the system makes money, and the
// followed/broke split is the one that changes behaviour.
export function tradeStats() {
  const all = db.prepare('SELECT * FROM trades').all();
  const closed = all.filter((t) => t.status === 'closed');
  const scored = closed.filter((t) => t.r_multiple != null); // no-fills don't count
  const wins = scored.filter((t) => t.r_multiple > 0);
  const losses = scored.filter((t) => t.r_multiple <= 0);
  const avg = (rows) =>
    rows.length ? Number((rows.reduce((a, t) => a + t.r_multiple, 0) / rows.length).toFixed(2)) : null;

  // Longest run of consecutive losses, oldest first — the number that tells
  // you what a normal bad patch looks like before you live through one.
  const chron = [...scored].sort((a, b) => (a.planned_at < b.planned_at ? -1 : 1));
  let worstStreak = 0;
  let run = 0;
  for (const t of chron) {
    if (t.r_multiple <= 0) { run++; worstStreak = Math.max(worstStreak, run); }
    else run = 0;
  }

  const reviewed = closed.filter((t) => t.followed_rules != null);
  const followed = reviewed.filter((t) => t.followed_rules === 1);
  const broke = reviewed.filter((t) => t.followed_rules === 0);

  return {
    total: all.length,
    planned: all.filter((t) => t.status === 'planned').length,
    open: all.filter((t) => t.status === 'open').length,
    closed: closed.length,
    scored: scored.length,
    wins: wins.length,
    losses: losses.length,
    winRate: scored.length ? wins.length / scored.length : null,
    avgR: avg(scored),
    avgWinR: avg(wins),
    avgLossR: avg(losses),
    totalR: scored.length ? Number(scored.reduce((a, t) => a + t.r_multiple, 0).toFixed(2)) : null,
    totalPnl: closed.length
      ? Number(closed.reduce((a, t) => a + (t.pnl || 0), 0).toFixed(2))
      : null,
    worstLossStreak: worstStreak,
    reviewed: reviewed.length,
    disciplineRate: reviewed.length ? followed.length / reviewed.length : null,
    // The comparison the whole journal exists to produce.
    avgRFollowed: avg(followed.filter((t) => t.r_multiple != null)),
    avgRBroke: avg(broke.filter((t) => t.r_multiple != null)),
    followedCount: followed.length,
    brokeCount: broke.length,
  };
}

// ---------------------------------------------------------------------------
// Backtest discipline: what has been tried, and what has been peeked at
// ---------------------------------------------------------------------------

// A stable identity for one rule configuration. Symbol choice is part of it:
// cherry-picking which names to include is as much a fitting decision as
// changing the stop.
export function variantSignature(params = {}) {
  return JSON.stringify({
    symbols: [...(params.symbols || [])].map((x) => String(x).toUpperCase()).sort(),
    entryStyle: params.entryStyle ?? 'pullback',
    stopAtrMult: Number(params.stopAtrMult ?? 2),
    maxWaitBars: Number(params.maxWaitBars ?? 20),
    years: Number(params.years ?? 3),
    splitDate: params.splitDate ?? null,
    validationDate: params.validationDate ?? null,
  });
}

export function recordVariant(signature, inSampleAvgR) {
  db.prepare(
    `INSERT INTO tested_variants (signature, in_sample_avg_r) VALUES (?, ?)
     ON CONFLICT(signature) DO UPDATE SET
       times_run = times_run + 1,
       last_tested = datetime('now'),
       in_sample_avg_r = excluded.in_sample_avg_r`
  ).run(signature, inSampleAvgR == null ? null : Number(inSampleAvgR));
  return variantStats();
}

export function variantStats() {
  const row = db.prepare(
    'SELECT COUNT(*) AS variants, COALESCE(SUM(times_run), 0) AS runs FROM tested_variants'
  ).get();
  const best = db.prepare(
    `SELECT signature, in_sample_avg_r FROM tested_variants
     WHERE in_sample_avg_r IS NOT NULL ORDER BY in_sample_avg_r DESC LIMIT 1`
  ).get();
  return { variants: row.variants, runs: row.runs, best: best || null };
}

export function recordOosReveal(entry) {
  db.prepare(
    `INSERT INTO oos_reveals (split_date, signature, oos_trades, oos_avg_r, in_sample_avg_r)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    entry.splitDate ?? null,
    entry.signature ?? null,
    entry.oosTrades == null ? null : Number(entry.oosTrades),
    entry.oosAvgR == null ? null : Number(entry.oosAvgR),
    entry.inSampleAvgR == null ? null : Number(entry.inSampleAvgR)
  );
  return oosRevealStats();
}

export function oosRevealStats() {
  const row = db.prepare('SELECT COUNT(*) AS count, MIN(revealed_at) AS first FROM oos_reveals').get();
  const recent = db.prepare(
    'SELECT revealed_at, split_date, oos_trades, oos_avg_r, in_sample_avg_r FROM oos_reveals ORDER BY id DESC LIMIT 10'
  ).all();
  return { count: row.count, first: row.first, recent };
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
