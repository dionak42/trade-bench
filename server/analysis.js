// Technical analysis + lightweight news sentiment. Pure computation over
// daily bars and headlines — objective signals only, never a recommendation.
import { getDailyBars } from './alpaca.js';
import { getNews } from './finnhub.js';

// ---- Indicator helpers ----
function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Wilder's RSI.
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Average True Range (volatility).
function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h;
    const l = bars[i].l;
    const prevC = bars[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  return sma(trs, period);
}

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
  const rsiAt = (end, period = 14) => {
    if (end < period) return null;
    let g = 0, l = 0;
    for (let i = end - period + 1; i <= end; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) g += diff; else l -= diff;
    }
    const ag = g / period, al = l / period;
    if (al === 0) return 100;
    return 100 - 100 / (1 + ag / al);
  };
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
  const smaAt = (arr, i, p) => {
    if (i + 1 < p) return null;
    let s = 0;
    for (let k = i - p + 1; k <= i; k++) s += arr[k];
    return s / p;
  };
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
