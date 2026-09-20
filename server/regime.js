// Market regime: what kind of tape you're trading into, before you look at
// any one ticker. Everything here is computed from daily bars we already
// fetch — no new data provider, no paid breadth feed.
//
// The app's per-ticker scorecard already answers "is THIS stock in an uptrend?"
// This answers "is the market underneath it healthy?", which is a different
// question and often the more important one. Context, never a trade signal.
import { getDailyBars } from './alpaca.js';
import {
  sma, rsi, rsiEndingAt, realizedVol, realizedVolAt, percentileOf, consecutiveDownWeeks,
} from './indicators.js';
import { listWatchlist, saveRegimeSnapshot, getRegimeHistory } from './db.js';

export const INDEXES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq 100' },
  { symbol: 'IWM', name: 'Russell 2000' },
  { symbol: 'DIA', name: 'Dow 30' },
];

export const SECTORS = [
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLY', name: 'Consumer Disc.' },
  { symbol: 'XLP', name: 'Consumer Staples' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLV', name: 'Health Care' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLU', name: 'Utilities' },
  { symbol: 'XLC', name: 'Communication' },
];

// One regime build hits ~20 bar endpoints, so cache it. The inputs are daily
// bars on a delayed feed — a few minutes of staleness costs nothing.
const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, data: null };

// Fetch bars for many symbols without opening 30 sockets at once.
async function fetchBars(symbols, days = 400, concurrency = 5) {
  const out = new Map();
  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const sym = queue.shift();
      try {
        const bars = await getDailyBars(sym, days);
        if (bars.length >= 30) out.set(sym, bars);
      } catch {
        /* a missing symbol just drops out of the universe */
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Trend read for one index, same rules the per-ticker scorecard uses so the
// two views never disagree.
function indexRow({ symbol, name }, bars) {
  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const rsiPrev = rsiEndingAt(closes, closes.length - 6);
  const rsiChange = rsi14 != null && rsiPrev != null ? rsi14 - rsiPrev : null;

  let direction = 'flat';
  if (rsiChange != null) {
    if (rsiChange > 2) direction = 'rising';
    else if (rsiChange < -2) direction = 'falling';
  }

  let trendLabel = 'Sideways';
  if (sma50 && sma200) {
    if (price > sma50 && sma50 > sma200) trendLabel = 'Uptrend';
    else if (price < sma50 && sma50 < sma200) trendLabel = 'Downtrend';
    else trendLabel = 'Mixed';
  }

  const { weekChange } = consecutiveDownWeeks(bars);
  return {
    symbol,
    name,
    price,
    trendLabel,
    rsi14: rsi14 != null ? Number(rsi14.toFixed(0)) : null,
    direction,
    vsSma50: sma50 ? (price - sma50) / sma50 : null,
    aboveSma200: sma200 != null ? price > sma200 : null,
    weekChange,
  };
}

// "XLY has now fallen six weeks in a row" — the streak the newsletters quote.
function sectorRow({ symbol, name }, bars) {
  const { downWeeks, partial, weekChange } = consecutiveDownWeeks(bars);
  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const sma200 = sma(closes, 200);
  return {
    symbol,
    name,
    price,
    downWeeks,
    partialWeek: partial,
    weekChange,
    aboveSma200: sma200 != null ? price > sma200 : null,
  };
}

// Breadth over whatever universe we can actually see for free: the sector
// ETFs plus your watchlist. It is NOT the S&P 500's internals — the UI says
// so and reports the universe size, because a breadth number without its
// universe is meaningless.
function computeBreadth(barsBySymbol, symbols) {
  let above = 0;
  let counted = 0;
  let newHighs = 0;
  let newLows = 0;
  for (const sym of symbols) {
    const bars = barsBySymbol.get(sym);
    if (!bars) continue;
    const closes = bars.map((b) => b.c);
    const sma200 = sma(closes, 200);
    if (sma200 == null) continue;
    counted++;
    const price = closes[closes.length - 1];
    if (price > sma200) above++;

    const window = bars.slice(-Math.min(bars.length, 252));
    const high52 = Math.max(...window.map((b) => b.h));
    const low52 = Math.min(...window.map((b) => b.l));
    const lastBar = bars[bars.length - 1];
    if (lastBar.h >= high52) newHighs++;
    if (lastBar.l <= low52) newLows++;
  }
  if (!counted) return null;
  return {
    abovePct: above / counted,
    above,
    universeSize: counted,
    newHighs,
    newLows,
  };
}

// Volatility without a VIX feed: SPY's own realized vol, ranked against its
// last year. Answers the same question ("is protection cheap right now?")
// with data we already have, and says plainly that it's realized, not implied.
function computeVolatility(bars) {
  const closes = bars.map((b) => b.c);
  const current = realizedVol(closes, 20);
  if (current == null) return null;
  const history = [];
  for (let i = Math.max(20, closes.length - 252); i < closes.length; i++) {
    const v = realizedVolAt(closes, i, 20);
    if (v != null) history.push(v);
  }
  const percentile = percentileOf(current, history);
  let label = 'Normal';
  if (percentile != null) {
    if (percentile <= 0.25) label = 'Calm';
    else if (percentile >= 0.75) label = 'Stressed';
  }
  return { realizedVol20d: current, percentile, label, basis: 'SPY 20-day realized' };
}

// A plain-language read of the tape, assembled from the parts above. It is
// deliberately blunt and deliberately not a recommendation — it tells you
// which way to lean when you read the per-ticker signals, nothing more.
function summarize({ indexes, sectors, breadth }) {
  const upIdx = indexes.filter((i) => i.trendLabel === 'Uptrend').length;
  const downIdx = indexes.filter((i) => i.trendLabel === 'Downtrend').length;
  const weakSectors = sectors.filter((s) => s.downWeeks >= 3).length;
  const broad = breadth?.abovePct ?? null;

  let tone = 'Mixed';
  if (upIdx >= 3 && (broad == null || broad >= 0.55) && weakSectors <= 3) tone = 'Risk-on';
  else if (downIdx >= 2 || (broad != null && broad < 0.45) || weakSectors >= 6) tone = 'Risk-off';

  const notes = [];
  notes.push(`${upIdx} of ${indexes.length} major indexes in an uptrend`);
  if (broad != null) notes.push(`${(broad * 100).toFixed(0)}% of the universe above its 200-day`);
  if (weakSectors) notes.push(`${weakSectors} sector${weakSectors === 1 ? '' : 's'} down 3+ weeks`);
  return { tone, notes };
}

export async function buildRegime({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true };
  }

  const watchSymbols = listWatchlist().map((w) => w.symbol);
  const sectorSymbols = SECTORS.map((s) => s.symbol);
  const indexSymbols = INDEXES.map((i) => i.symbol);
  // Watchlist names count toward breadth but are capped so a long list can't
  // turn one panel load into a hundred requests.
  const universe = [...new Set([...sectorSymbols, ...watchSymbols.slice(0, 30)])];
  const all = [...new Set([...indexSymbols, ...universe])];

  const barsBySymbol = await fetchBars(all);
  if (!barsBySymbol.size) throw new Error('No market data available — check your Alpaca keys.');

  const indexes = INDEXES
    .filter((i) => barsBySymbol.has(i.symbol))
    .map((i) => indexRow(i, barsBySymbol.get(i.symbol)));
  const sectors = SECTORS
    .filter((s) => barsBySymbol.has(s.symbol))
    .map((s) => sectorRow(s, barsBySymbol.get(s.symbol)))
    .sort((a, b) => b.downWeeks - a.downWeeks || (a.weekChange ?? 0) - (b.weekChange ?? 0));

  const breadth = computeBreadth(barsBySymbol, universe);
  const volatility = barsBySymbol.has('SPY') ? computeVolatility(barsBySymbol.get('SPY')) : null;

  // Record today's breadth so next week's panel can show the direction of
  // travel — the same accumulate-our-own-history trick as IV rank.
  let breadthChange = null;
  if (breadth) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      saveRegimeSnapshot({
        date: today,
        abovePct: breadth.abovePct,
        universeSize: breadth.universeSize,
        newHighs: breadth.newHighs,
        newLows: breadth.newLows,
      });
      const history = getRegimeHistory(30);
      // Compare against the most recent reading at least 5 days back, and only
      // when it measured the same universe — otherwise the delta is an
      // artifact of adding a ticker to the watchlist, not a market move.
      const prior = history.find(
        (h) => h.date < today
          && (new Date(today) - new Date(h.date)) / 86400000 >= 5
          && h.universe_size === breadth.universeSize
      );
      if (prior) {
        breadthChange = {
          from: prior.above_pct,
          since: prior.date,
          delta: breadth.abovePct - prior.above_pct,
        };
      }
    } catch {
      /* history is a nicety; never fail the panel over it */
    }
  }

  const data = {
    asOf: new Date().toISOString(),
    indexes,
    sectors,
    breadth: breadth ? { ...breadth, change: breadthChange } : null,
    volatility,
    summary: summarize({ indexes, sectors, breadth }),
    watchlistInUniverse: watchSymbols.slice(0, 30).length,
  };
  cache = { at: Date.now(), data };
  return { ...data, cached: false };
}

// Called by the daily job so breadth history accrues even on days nobody
// opens the app.
export async function snapshotRegime() {
  await buildRegime({ force: true });
}
