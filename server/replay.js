// Historical scenario replay for a stock bracket plan. The plan's entry,
// target, and stop are derived from the SYSTEM's rules (20-day support /
// resistance, ATR-based stop) *as of the chosen start date* — using only data
// available up to that day, so there's no lookahead. Then it walks forward.
// A backtest for learning — past results, not a prediction. Stocks only.
import { getDailyBars } from './alpaca.js';

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export async function runReplay(symbol, opts = {}) {
  const {
    startDate,
    mode = 'risk',
    accountSize = 0,
    riskPct = 1,
    capital = 0,
    stopAtrMult = 2,
  } = opts;
  if (!startDate) throw new Error('A start date is required.');

  const bars = await getDailyBars(symbol, 900); // ~3+ years of daily bars
  const startIdx = bars.findIndex((b) => b.t.slice(0, 10) >= startDate);
  if (startIdx < 0) throw new Error('Start date is after the available history.');
  if (startIdx < 25) throw new Error('Not enough history before that date to set the system levels.');

  // --- Levels from the system's rules, as of the start date (no lookahead) ---
  const lookback = bars.slice(startIdx - 20, startIdx);
  const entry = Math.min(...lookback.map((b) => b.l));       // 20-day support
  const target = Math.max(...lookback.map((b) => b.h));      // 20-day resistance
  const atrBars = bars.slice(startIdx - 15, startIdx);       // 14 true ranges
  let trSum = 0, trN = 0;
  for (let i = 1; i < atrBars.length; i++) {
    const h = atrBars[i].h, l = atrBars[i].l, pc = atrBars[i - 1].c;
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trN++;
  }
  const atr = trN ? trSum / trN : (target - entry) * 0.1;
  const stop = Number((entry - stopAtrMult * atr).toFixed(2));
  const riskPerShare = entry - stop;

  // --- Position size (same rules as the plan builder) ---
  let shares;
  if (mode === 'risk') {
    const riskBudget = accountSize * riskPct / 100;
    shares = riskPerShare > 0 ? Math.floor(riskBudget / riskPerShare) : 0;
    const maxByCash = entry > 0 ? Math.floor(accountSize / entry) : 0;
    if (shares > maxByCash) shares = maxByCash;
  } else {
    shares = entry > 0 ? Math.floor(capital / entry) || 0 : 0;
  }

  const levels = {
    entry: Number(entry.toFixed(2)),
    target: Number(target.toFixed(2)),
    stop,
    asOf: startDate,
    shares,
  };

  const window = bars.slice(startIdx);
  if (window.length < 2) throw new Error('Not enough price history after the start date.');

  // 1) Wait for the entry limit to be touched (a dip fills the buy).
  let entryIdx = -1, entryPrice = null, entryDate = null;
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (b.l <= entry) {
      entryPrice = b.o <= entry ? b.o : entry; // gap-down fills better
      entryIdx = i;
      entryDate = b.t.slice(0, 10);
      break;
    }
  }
  if (entryIdx < 0) {
    return {
      symbol, outcome: 'no_fill', ...levels,
      message: `The entry limit (${levels.entry}) was never reached after ${startDate} — the trade would not have triggered.`,
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
  }
  const res = finish('open', window[window.length - 1].c, window.length - 1);
  res.outcome = 'open';
  return res;
}
