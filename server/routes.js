// All HTTP routes for the planner. Kept in one small router since the
// surface is tiny; each handler delegates to a data module.
import { Router } from 'express';
import { getUnderlyingPrice, getOptionsChain, getUpcomingDividend } from './alpaca.js';
import { getNews, getNextEarnings, searchSymbols } from './finnhub.js';
import { ivRankFor } from './ivrank.js';
import { buildAnalysis, scanSymbol, getCoveredCallIdea } from './analysis.js';
import { runReplay } from './replay.js';
import { runBacktest } from './backtest.js';
import {
  getAccount, getPositions, getOrders, placeOrder, cancelOrder, closePosition,
} from './paper.js';
import {
  listWatchlist, addWatchlist, removeWatchlist, getSetting, setSetting,
  listTrades, createTrade, updateTrade, deleteTrade, tradeStats,
} from './db.js';
import { cfg } from './config.js';

const KEY_FIELDS = ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY', 'FINNHUB_API_KEY'];

const router = Router();

// Wrap async handlers so thrown errors become clean 502/500 JSON.
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[route] ${req.method} ${req.path}:`, err.message);
    res.status(502).json({ error: err.message });
  });

// Price + normalized options chain. Strike window keeps payload near the money.
router.get('/quote/:symbol', wrap(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const { price, asOf } = await getUnderlyingPrice(symbol);
  const chain = await getOptionsChain(symbol, {
    strikeGte: price * 0.7,
    strikeLte: price * 1.3,
  });
  res.json({ symbol, price, asOf, chain });
}));

// Symbol search (type a company name, get tradeable tickers).
router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  res.json({ results: await searchSymbols(q) });
}));

// Recent news, newest first.
router.get('/news/:symbol', wrap(async (req, res) => {
  const news = await getNews(req.params.symbol.toUpperCase());
  res.json({ symbol: req.params.symbol.toUpperCase(), news });
}));

// Scheduled events: next earnings + next ex-dividend.
router.get('/events/:symbol', wrap(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const [earnings, dividend] = await Promise.all([
    getNextEarnings(symbol).catch(() => null),
    getUpcomingDividend(symbol).catch(() => null),
  ]);
  res.json({ symbol, earnings, dividend });
}));

// IV rank from our own accumulated history (also records today's reading).
router.get('/ivrank/:symbol', wrap(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const price = req.query.price ? Number(req.query.price) : undefined;
  const data = await ivRankFor(symbol, price);
  res.json({ symbol, ...(data ?? { currentIv: null, rank: null, percentile: null, days: 0 }) });
}));

// Watchlist momentum scan: trend + momentum + cross across a list of tickers.
router.get('/scan', wrap(async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  const results = await Promise.all(
    symbols.map((s) => scanSymbol(s).catch(() => ({ symbol: s, error: true })))
  );
  res.json({ results });
}));

// Covered-call income idea for one symbol (for the scan's CC-yield column).
router.get('/cc/:symbol', wrap(async (req, res) => {
  const idea = await getCoveredCallIdea(req.params.symbol.toUpperCase());
  res.json(idea || { annualized: null });
}));

// Technical scorecard + news sentiment (decision support, not advice).
router.get('/analysis/:symbol', wrap(async (req, res) => {
  const data = await buildAnalysis(req.params.symbol.toUpperCase());
  res.json(data);
}));

// Historical scenario replay of a stock bracket plan (backtest).
router.post('/replay/:symbol', wrap(async (req, res) => {
  const result = await runReplay(req.params.symbol.toUpperCase(), req.body ?? {});
  res.json(result);
}));

// Run the system across many symbols and years — a sequence of trades rather
// than one. Slow by nature (one bar fetch per symbol), so the symbol list is
// capped and every symbol is fetched in parallel.
router.post('/backtest', wrap(async (req, res) => {
  const body = req.body ?? {};
  const symbols = [...new Set(
    String(body.symbols || '')
      .split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
  )].slice(0, 25);
  if (!symbols.length) return res.status(400).json({ error: 'Pick at least one symbol.' });

  const years = Math.min(Math.max(Number(body.years) || 3, 1), 5);
  const result = await runBacktest(symbols, {
    years,
    mode: body.mode === 'capital' ? 'capital' : 'risk',
    accountSize: Number(body.accountSize) || 0,
    riskPct: Number(body.riskPct) || 1,
    capital: Number(body.capital) || 0,
    entryStyle: body.entryStyle === 'breakout' ? 'breakout' : 'pullback',
    stopAtrMult: Number(body.stopAtrMult) || 2,
    maxWaitBars: Math.min(Math.max(Number(body.maxWaitBars) || 20, 1), 120),
  });
  res.json(result);
}));

// ---- Paper trading (Alpaca paper account) ----
router.get('/paper/account', wrap(async (_req, res) => {
  res.json(await getAccount());
}));

router.get('/paper/positions', wrap(async (_req, res) => {
  res.json({ positions: await getPositions() });
}));

router.get('/paper/orders', wrap(async (req, res) => {
  res.json({ orders: await getOrders(req.query.status || 'open') });
}));

router.post('/paper/order', wrap(async (req, res) => {
  const order = await placeOrder(req.body ?? {});
  res.status(201).json({ order });
}));

router.delete('/paper/order/:id', wrap(async (req, res) => {
  await cancelOrder(req.params.id);
  res.status(204).end();
}));

router.post('/paper/close/:symbol', wrap(async (req, res) => {
  res.json({ order: await closePosition(req.params.symbol) });
}));

// ---- Trade journal ----
// One row per decision: written when you commit to a plan, updated when it
// fills, reviewed when it's done. Stats live in the DB layer so the numbers
// are derived from the plan, never posted by the browser.
router.get('/journal/stats', wrap(async (_req, res) => {
  res.json(tradeStats());
}));

router.get('/journal', wrap(async (req, res) => {
  const { status, symbol, source, limit } = req.query;
  res.json({ trades: listTrades({ status, symbol, source, limit }) });
}));

router.post('/journal', wrap(async (req, res) => {
  const body = req.body ?? {};
  if (!body.symbol || !String(body.symbol).trim()) {
    return res.status(400).json({ error: 'symbol is required' });
  }
  res.status(201).json({ trade: createTrade(body) });
}));

router.patch('/journal/:id', wrap(async (req, res) => {
  const trade = updateTrade(req.params.id, req.body ?? {});
  if (!trade) return res.status(404).json({ error: 'No such trade.' });
  res.json({ trade });
}));

router.delete('/journal/:id', wrap(async (req, res) => {
  deleteTrade(req.params.id);
  res.status(204).end();
}));

// ---- Settings (API keys, display name) ----
// GET returns only masked status — secrets are never sent back to the browser.
router.get('/settings', wrap(async (_req, res) => {
  const out = {};
  for (const k of KEY_FIELDS) {
    const saved = getSetting(k);
    const envv = process.env[k];
    const val = saved || envv || '';
    out[k] = {
      set: Boolean(val),
      source: saved ? 'saved' : envv ? 'env' : 'none',
      last4: val ? val.slice(-4) : '',
    };
  }
  out.displayName = getSetting('DISPLAY_NAME') || '';
  out.accountSize = getSetting('ACCOUNT_SIZE') || '';
  out.riskPct = getSetting('RISK_PCT') || '';
  res.json(out);
}));

router.post('/settings', wrap(async (req, res) => {
  const body = req.body ?? {};
  for (const k of KEY_FIELDS) {
    if (typeof body[k] === 'string' && body[k].trim()) setSetting(k, body[k].trim());
  }
  if (typeof body.displayName === 'string') setSetting('DISPLAY_NAME', body.displayName.trim());
  if (body.accountSize != null && String(body.accountSize).trim()) setSetting('ACCOUNT_SIZE', String(body.accountSize).trim());
  if (body.riskPct != null && String(body.riskPct).trim()) setSetting('RISK_PCT', String(body.riskPct).trim());
  res.json({ ok: true });
}));

// Live check that the currently-effective keys actually work.
router.get('/settings/test', wrap(async (_req, res) => {
  const out = {};
  try {
    const r = await fetch('https://paper-api.alpaca.markets/v2/account', {
      headers: {
        'APCA-API-KEY-ID': cfg('ALPACA_API_KEY_ID'),
        'APCA-API-SECRET-KEY': cfg('ALPACA_API_SECRET_KEY'),
      },
    });
    out.alpaca = r.ok;
  } catch { out.alpaca = false; }
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${cfg('FINNHUB_API_KEY')}`);
    const j = await r.json().catch(() => ({}));
    out.finnhub = r.ok && j && typeof j.c !== 'undefined';
  } catch { out.finnhub = false; }
  res.json(out);
}));

// Shared watchlist CRUD.
router.get('/watchlist', wrap(async (_req, res) => {
  res.json({ watchlist: listWatchlist() });
}));

router.post('/watchlist', wrap(async (req, res) => {
  const { symbol, shares, notes } = req.body ?? {};
  if (!symbol || !String(symbol).trim()) {
    return res.status(400).json({ error: 'symbol is required' });
  }
  res.status(201).json({ item: addWatchlist({ symbol, shares, notes }) });
}));

router.delete('/watchlist/:id', wrap(async (req, res) => {
  removeWatchlist(req.params.id);
  res.status(204).end();
}));

export default router;
