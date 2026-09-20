// Technical analysis + lightweight news sentiment. Pure computation over
// daily bars and headlines — objective signals only, never a recommendation.
import { getDailyBars, getUnderlyingPrice, getOptionsChain } from './alpaca.js';
import { getNews } from './finnhub.js';
import { sma, smaAt, rsi, rsiEndingAt, atr } from './indicators.js';

// ---- News sentiment (lexicon-based, no LLM) ----
const POS = ['beat', 'beats', 'surge', 'surges', 'soar', 'soars', 'rally', 'rallies',
  'gain', 'gains', 'jump', 'jumps', 'upgrade', 'upgrades', 'record', 'growth', 'profit',
  'strong', 'outperform', 'bullish', 'raise', 'raises', 'raised', 'top', 'tops', 'win',
  'wins', 'boost', 'boosts', 'buy', 'expand', 'expands', 'momentum', 'high'];
const NEG = ['miss', 'misses', 'plunge', 'plunges', 'fall', 'falls', 'drop', 'drops',
  'slump', 'slumps', 'downgrade', 'downgrades', 'cut', 'cuts', 'loss', 'losses', 'weak',
  'underperform', 'bearish', 'lawsuit', 'probe', 'warning', 'warns', 'sink', 'sinks',
  'decline', 'declines', 'fear', 'fears', 'risk', 'risks', 'sell', 'slash', 'slashes',
  'concern', 'concerns', 'tumble', 'tumbles', 'low', 'crash'];

function scoreSentiment(headlines) {
  let pos = 0;
  let neg = 0;
  for (const h of headlines) {
    const words = h.toLowerCase().split(/[^a-z]+/);
    for (const w of words) {
      if (POS.includes(w)) pos++;
      if (NEG.includes(w)) neg++;
    }
  }
  const total = pos + neg;
  const net = total ? (pos - neg) / total : 0; // -1..1
  let label = 'Neutral';
  if (net > 0.2) label = 'Positive';
  else if (net < -0.2) label = 'Negative';
  return { label, net, positiveHits: pos, negativeHits: neg, headlineCount: headlines.length };
}

// Lightweight scan for the watchlist dashboard: trend, momentum direction,
// and golden/death-cross status — no news call, so it's fast across a list.
export async function scanSymbol(symbol) {
  const bars = await getDailyBars(symbol, 600);
  if (bars.length < 30) throw new Error(`Not enough history for ${symbol}`);
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

  const N = Math.min(bars.length, 130);
  let cross = null, prevDiff = null;
  for (let i = bars.length - N; i < bars.length; i++) {
    const a = smaAt(closes, i, 50), b = smaAt(closes, i, 200);
    if (a == null || b == null) { prevDiff = null; continue; }
    const diff = a - b;
    if (prevDiff != null) {
      if (prevDiff <= 0 && diff > 0) cross = { type: 'golden', date: bars[i].t.slice(0, 10) };
      else if (prevDiff >= 0 && diff < 0) cross = { type: 'death', date: bars[i].t.slice(0, 10) };
    }
    prevDiff = diff;
  }
  if (cross) cross.daysAgo = Math.round((Date.now() - new Date(cross.date + 'T00:00:00Z')) / 86400000);

  const regime = sma50 != null && sma200 != null ? (sma50 >= sma200 ? 'golden' : 'death') : null;
  const gap = sma50 != null && sma200 != null ? (sma50 - sma200) / sma200 : null;

  // Approaching cross: the 50/200 gap narrowing toward zero (direction-aware),
  // so you catch a regime change forming before it flips.
  const j = closes.length - 11; // ~2 weeks ago
  const sma50p = smaAt(closes, j, 50), sma200p = smaAt(closes, j, 200);
  const gapPrev = sma50p != null && sma200p != null ? (sma50p - sma200p) / sma200p : null;
  let approaching = null;
  if (regime && gap != null && gapPrev != null) {
    if (regime === 'death' && gap > gapPrev && gap > -0.06) approaching = 'golden';
    else if (regime === 'golden' && gap < gapPrev && gap < 0.06) approaching = 'death';
  }

  let trendLabel = 'Sideways';
  if (sma50 && sma200) {
    if (price > sma50 && sma50 > sma200) trendLabel = 'Uptrend';
    else if (price < sma50 && sma50 < sma200) trendLabel = 'Downtrend';
    else trendLabel = 'Mixed';
  }
  return {
    symbol, price, trendLabel, regime, gap, cross, approaching,
    rsi14: rsi14 != null ? Number(rsi14.toFixed(0)) : null, direction,
  };
}

// Covered-call income idea: the annualized yield from selling a ~0.30-delta
// call ~30 days out. Answers "which holdings have juicy premium right now?"
export async function getCoveredCallIdea(symbol) {
  const { price } = await getUnderlyingPrice(symbol);
  const chain = await getOptionsChain(symbol, { strikeGte: price, strikeLte: price * 1.35 });
  const today = new Date().toISOString().slice(0, 10);
  const minExp = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const calls = chain.filter(
    (c) => c.type === 'call' && c.delta != null && c.bid > 0 && c.expiration >= minExp
  );
  if (!calls.length) return null;
  const targetExp = calls.map((c) => c.expiration).sort()[0];
  const atExp = calls.filter((c) => c.expiration === targetExp);
  let best = null, bestDist = Infinity;
  for (const c of atExp) {
    const d = Math.abs(Math.abs(c.delta) - 0.30);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  if (!best) return null;
  const dte = Math.max(1, Math.round(
    (new Date(targetExp + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000
  ));
  return {
    strike: best.strike, dte, premium: best.bid, delta: best.delta,
    annualized: (best.bid / price) * (365 / dte),
  };
}

// ---- Assemble the scorecard ----
export async function buildAnalysis(symbol) {
  // ~600 calendar days (~410 trading) so the 200-day MA has enough history to
  // span the whole 130-session chart window, not just its right-hand end.
  const bars = await getDailyBars(symbol, 600);
  if (bars.length < 30) {
    throw new Error(`Not enough price history for ${symbol}`);
  }
  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);

  const window = (n) => bars.slice(-n);
  const highN = (n) => Math.max(...window(n).map((b) => b.h));
  const lowN = (n) => Math.min(...window(n).map((b) => b.l));

  const high20 = highN(20);
  const low20 = lowN(20);
  const high52 = highN(Math.min(bars.length, 252));
  const low52 = lowN(Math.min(bars.length, 252));

  // Trend read from moving-average relationships.
  let trend = 'Sideways';
  if (sma50 && sma200) {
    if (price > sma50 && sma50 > sma200) trend = 'Uptrend';
    else if (price < sma50 && sma50 < sma200) trend = 'Downtrend';
    else trend = 'Mixed';
  }

  let momentum = 'Neutral';
  if (rsi14 != null) {
    if (rsi14 >= 70) momentum = 'Overbought';
    else if (rsi14 <= 30) momentum = 'Oversold';
  }

  // RSI over time, so you can see whether momentum is rising or falling.
  const rsiAt = (end) => rsiEndingAt(closes, end);
  const rsiSeries = [];
  for (let i = Math.max(14, closes.length - 30); i < closes.length; i++) {
    const v = rsiAt(i);
    if (v != null) rsiSeries.push(Number(v.toFixed(1)));
  }
  const rsiPrev = rsiAt(closes.length - 6); // ~1 week ago
  const rsiChange = rsi14 != null && rsiPrev != null ? rsi14 - rsiPrev : null;
  let rsiDirection = 'flat';
  if (rsiChange != null) {
    if (rsiChange > 2) rsiDirection = 'rising';
    else if (rsiChange < -2) rsiDirection = 'falling';
  }

  const news = await getNews(symbol, 15).catch(() => []);
  const sentiment = scoreSentiment(news.map((n) => n.headline || ''));

  // Price series for the chart: last ~130 sessions with rolling MAs.
  const N = Math.min(bars.length, 130);
  const series = [];
  for (let i = bars.length - N; i < bars.length; i++) {
    series.push({
      d: bars[i].t.slice(0, 10),
      c: bars[i].c,
      sma50: smaAt(closes, i, 50),
      sma200: smaAt(closes, i, 200),
    });
  }

  // Golden / death cross: the most recent 50-day vs 200-day crossover in view.
  let cross = null;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (a.sma50 == null || a.sma200 == null || b.sma50 == null || b.sma200 == null) continue;
    const prev = a.sma50 - a.sma200;
    const cur = b.sma50 - b.sma200;
    if (prev <= 0 && cur > 0) cross = { type: 'golden', date: b.d, index: i };
    else if (prev >= 0 && cur < 0) cross = { type: 'death', date: b.d, index: i };
  }
  if (cross) {
    cross.daysAgo = Math.round(
      (Date.now() - new Date(cross.date + 'T00:00:00Z')) / 86400000
    );
  }
  const regime = sma50 != null && sma200 != null
    ? (sma50 >= sma200 ? 'golden' : 'death')
    : null;

  return {
    symbol,
    price,
    asOf: bars[bars.length - 1].t,
    trend: {
      label: trend,
      sma50,
      sma200,
      priceVsSma50: sma50 ? (price - sma50) / sma50 : null,
      priceVsSma200: sma200 ? (price - sma200) / sma200 : null,
      regime, // 'golden' = 50 above 200 (uptrend regime), 'death' = below
      cross,  // most recent crossover in the chart window, or null
    },
    momentum: {
      label: momentum, rsi14,
      direction: rsiDirection, rsiChange, rsiSeries,
    },
    volatility: {
      atr14,
      atrPct: atr14 ? atr14 / price : null, // ~expected daily move
    },
    levels: {
      support20: low20,
      resistance20: high20,
      low52: low52,
      high52: high52,
      pctFromLow52: (price - low52) / low52,
      pctFromHigh52: (price - high52) / high52,
    },
    sentiment,
    series,
  };
}
