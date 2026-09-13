// All HTTP routes for the planner. Kept in one small router since the
// surface is tiny; each handler delegates to a data module.
import { Router } from 'express';
import { getUnderlyingPrice, getOptionsChain, getUpcomingDividend } from './alpaca.js';
import { getNews, getNextEarnings } from './finnhub.js';
import { ivRankFor } from './ivrank.js';
import { buildAnalysis } from './analysis.js';
import { runReplay } from './replay.js';
import {
  getAccount, getPositions, getOrders, placeOrder, cancelOrder, closePosition,
} from './paper.js';
import { listWatchlist, addWatchlist, removeWatchlist } from './db.js';

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
