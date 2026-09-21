// Historical scenario replay for a stock bracket plan. The plan's entry,
// target, and stop are derived from the SYSTEM's rules (20-day support /
// resistance, ATR-based stop) *as of the chosen start date* — using only data
// available up to that day, so there's no lookahead. Then it walks forward.
// A backtest for learning — past results, not a prediction. Stocks only.
import { getDailyBars } from './alpaca.js';

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// THE SYSTEM'S RULES, in one place. Both the single-trade replay and the
// multi-trade backtest call this, so a backtest can never quietly test
// different rules from the ones the plan builder places.
//
// Everything is computed from bars STRICTLY BEFORE `idx` — no lookahead. That
// constraint is the whole reason a backtest is worth anything: the moment a
// level is derived from a bar the trader couldn't have seen, the results stop
// describing a strategy and start describing hindsight.
export const MIN_HISTORY = 25; // bars needed before a level can be derived

export function deriveLevels(bars, idx, { stopAtrMult = 2, entryStyle = 'pullback' } = {}) {
  if (idx < MIN_HISTORY) return null;
  const lookback = bars.slice(idx - 20, idx);
  const support = Math.min(...lookback.map((b) => b.l));     // 20-day support
  const resistance = Math.max(...lookback.map((b) => b.h));  // 20-day resistance

  const atrBars = bars.slice(idx - 15, idx);                 // 14 true ranges
  let trSum = 0, trN = 0;
  for (let i = 1; i < atrBars.length; i++) {
    const h = atrBars[i].h, l = atrBars[i].l, pc = atrBars[i - 1].c;
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trN++;
  }
  const atr = trN ? trSum / trN : (resistance - support) * 0.1;

  // Pullback: buy the 20-day support. Breakout: buy above the 20-day
  // resistance, with a measured-move target (the prior range projected up).
  const breakout = entryStyle === 'breakout';
  const entry = breakout ? resistance : support;
  const target = breakout ? resistance + (resistance - support) : resistance;
  const stop = Number((entry - stopAtrMult * atr).toFixed(2));

  // The regime filter from SYSTEM.md rule 2, as of this bar. Recorded on every
  // trade so the backtest can answer whether the filter actually earns its keep.
  const closes = bars.slice(0, idx).map((b) => b.c);
  const smaAt = (p) => {
    if (closes.length < p) return null;
    const slice = closes.slice(-p);
    return slice.reduce((a, b) => a + b, 0) / p;
  };
  const sma50 = smaAt(50), sma200 = smaAt(200);
  const regime = sma50 != null && sma200 != null ? (sma50 >= sma200 ? 'golden' : 'death') : null;

  // Regime and price-vs-200-day are different questions, and a name can pass
  // one while failing the other: the 50 can still sit above the 200 while price
  // has already dropped below both. Recorded separately so the backtest can say
  // whether that distinction is worth money.
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const aboveSma200 = lastClose != null && sma200 != null ? lastClose > sma200 : null;

  return {
    entry: Number(entry.toFixed(2)),
    target: Number(target.toFixed(2)),
    stop,
    atr,
    support,
    resistance,
    regime,
    aboveSma200,
    sma200: sma200 != null ? Number(sma200.toFixed(2)) : null,
    lastClose,
    breakout,
    riskPerShare: entry - stop,
    asOf: bars[idx].t.slice(0, 10),
  };
}

// Position size — the same rules as the plan builder.
export function sizePosition({ entry, riskPerShare, mode, accountSize, riskPct, capital }) {
  if (mode === 'risk') {
    const riskBudget = accountSize * riskPct / 100;
    let shares = riskPerShare > 0 ? Math.floor(riskBudget / riskPerShare) : 0;
    const maxByCash = entry > 0 ? Math.floor(accountSize / entry) : 0;
    if (shares > maxByCash) shares = maxByCash;
    return shares;
  }
  return entry > 0 ? Math.floor(capital / entry) || 0 : 0;
}

// `fetchBars` is injectable for tests, as in backtest.js.
export async function runReplay(symbol, opts = {}, fetchBars = getDailyBars) {
  const {
    startDate,
    mode = 'risk',
    accountSize = 0,
    riskPct = 1,
    capital = 0,
    stopAtrMult = 2,
    entryStyle = 'pullback',
    maxHoldBars = 0, // optional clock on the position; 0 = none, as in the backtest
  } = opts;
  if (!startDate) throw new Error('A start date is required.');

  const bars = await fetchBars(symbol, 900); // ~3+ years of daily bars
  const startIdx = bars.findIndex((b) => b.t.slice(0, 10) >= startDate);
  if (startIdx < 0) throw new Error('Start date is after the available history.');
  if (startIdx < MIN_HISTORY) throw new Error('Not enough history before that date to set the system levels.');

  const lv = deriveLevels(bars, startIdx, { stopAtrMult, entryStyle });
  const { entry, target, stop, riskPerShare, breakout } = lv;
  const shares = sizePosition({ entry, riskPerShare, mode, accountSize, riskPct, capital });

  const levels = {
    entry, target, stop,
    asOf: startDate,
    shares,
    style: entryStyle,
  };

  const window = bars.slice(startIdx);
  if (window.length < 2) throw new Error('Not enough price history after the start date.');

  // 1) Wait for the entry to trigger. Pullback = a dip to the buy-limit;
  //    breakout = a break above the buy-stop.
  let entryIdx = -1, entryPrice = null, entryDate = null;
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    const triggered = breakout ? b.h >= entry : b.l <= entry;
    if (triggered) {
      entryPrice = breakout
        ? (b.o >= entry ? b.o : entry)  // gap-up fills worse
        : (b.o <= entry ? b.o : entry); // gap-down fills better
      entryIdx = i;
      entryDate = b.t.slice(0, 10);
      break;
    }
  }
  if (entryIdx < 0) {
    return {
      symbol, outcome: 'no_fill', ...levels,
      message: `The ${breakout ? 'breakout above' : 'pullback to'} ${levels.entry} never triggered after ${startDate} — the trade would not have fired.`,
    };
  }

  // 2) Walk forward until the target or the stop is hit.
  const finish = (outcome, exitPrice, exitIdx) => {
    const bar = window[exitIdx];
    const exitDate = bar.t.slice(0, 10);
    const pnlPerShare = exitPrice - entryPrice;
    const path = window.slice(entryIdx, exitIdx + 1).map((b) => ({ d: b.t.slice(0, 10), c: b.c }));
    return {
      symbol, outcome, ...levels,
      entryDate, entryPrice: Number(entryPrice.toFixed(2)),
      exitDate, exitPrice: Number(exitPrice.toFixed(2)),
      daysHeld: daysBetween(entryDate, exitDate),
      pnl: Number((pnlPerShare * shares).toFixed(2)),
      pnlPct: entryPrice ? pnlPerShare / entryPrice : null,
      rMultiple: riskPerShare !== 0 ? pnlPerShare / riskPerShare : null,
      path,
    };
  };

  for (let i = entryIdx + 1; i < window.length; i++) {
    const b = window[i];
    if (b.l <= stop) {
      const px = b.o < stop ? b.o : stop; // gap-down fills worse
      return finish('stopped', px, i);
    }
    if (b.h >= target) {
      const px = b.o > target ? b.o : target; // gap-up fills better
      return finish('target', px, i);
    }
    // Last, so stop and target still win on a bar where both could fire.
    if (maxHoldBars > 0 && i - entryIdx >= maxHoldBars) {
      return finish('time', b.c, i);
    }
  }
  const res = finish('open', window[window.length - 1].c, window.length - 1);
  res.outcome = 'open';
  return res;
}
