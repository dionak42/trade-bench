// Pure indicator math shared by the per-ticker scorecard (analysis.js) and
// the market-regime panel (regime.js). No I/O — just numbers in, numbers out.

// Simple moving average of the last `period` values.
export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// SMA ending at index `i` (for rolling series), rather than at the end.
export function smaAt(arr, i, p) {
  if (i + 1 < p) return null;
  let s = 0;
  for (let k = i - p + 1; k <= i; k++) s += arr[k];
  return s / p;
}

// Wilder's RSI over the most recent `period` changes.
export function rsi(closes, period = 14) {
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

// RSI ending at a given index, so momentum can be compared across time.
export function rsiEndingAt(closes, end, period = 14) {
  if (end < period) return null;
  let g = 0;
  let l = 0;
  for (let i = end - period + 1; i <= end; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) g += diff;
    else l -= diff;
  }
  const ag = g / period;
  const al = l / period;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

// Average True Range (volatility) over `period` bars.
export function atr(bars, period = 14) {
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

// Annualized realized volatility from the last `period` daily log returns.
export function realizedVol(closes, period = 20) {
  if (closes.length < period + 1) return null;
  const rets = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// Realized vol ending at index `i`, for building a history to rank against.
export function realizedVolAt(closes, i, period = 20) {
  if (i < period) return null;
  return realizedVol(closes.slice(0, i + 1), period);
}

// Where `value` sits within `history`, 0..1. Used to say "cheap" vs "rich"
// without a paid vol feed — it's a percentile against the name's own past.
export function percentileOf(value, history) {
  const vals = history.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length || value == null) return null;
  const below = vals.filter((v) => v <= value).length;
  return below / vals.length;
}

// Weekly closes derived from daily bars: the last close of each Mon–Sun week,
// oldest first. `partial` marks a final week that hasn't finished yet.
export function weeklyCloses(bars) {
  const weeks = new Map();
  for (const b of bars) {
    const d = new Date(b.t.slice(0, 10) + 'T00:00:00Z');
    // Monday-anchored week key.
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const monday = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
    weeks.set(monday, { week: monday, close: b.c, lastDate: b.t.slice(0, 10), dow });
  }
  const out = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  if (out.length) out[out.length - 1].partial = out[out.length - 1].dow < 4; // before Friday
  return out;
}

// How many consecutive weeks price has closed lower, counting back from the
// latest weekly close. This is what "XLY has fallen six weeks in a row" means.
export function consecutiveDownWeeks(bars) {
  const weeks = weeklyCloses(bars);
  if (weeks.length < 2) return { downWeeks: 0, partial: false, weekChange: null };
  let downWeeks = 0;
  for (let i = weeks.length - 1; i > 0; i--) {
    if (weeks[i].close < weeks[i - 1].close) downWeeks++;
    else break;
  }
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  return {
    downWeeks,
    partial: Boolean(last.partial),
    weekChange: prev.close > 0 ? (last.close - prev.close) / prev.close : null,
  };
}
