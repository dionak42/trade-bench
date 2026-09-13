// Historical scenario replay for a stock bracket plan. Walks daily bars
// forward from a chosen start date to see how the plan would have played out.
// A backtest for learning — past results, not a prediction. Stocks only.
import { getDailyBars } from './alpaca.js';

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export async function runReplay(symbol, { startDate, entry, target, stop, shares }) {
  entry = Number(entry);
  target = Number(target);
  stop = Number(stop);
  shares = Number(shares) || 0;

  const bars = await getDailyBars(symbol, 900); // ~3+ years of daily bars
  const window = bars.filter((b) => b.t.slice(0, 10) >= startDate);
  if (window.length < 2) {
    throw new Error('Not enough price history on or after that start date.');
  }

  // 1) Wait for the entry limit to be touched (a dip fills the buy).
  let entryIdx = -1;
  let entryPrice = null;
  let entryDate = null;
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (b.l <= entry) {
      // Fill at the limit, or better if the bar gapped open below it.
      entryPrice = b.o <= entry ? b.o : entry;
      entryIdx = i;
      entryDate = b.t.slice(0, 10);
      break;
    }
  }
  if (entryIdx < 0) {
    return {
      symbol, outcome: 'no_fill',
      message: 'The entry limit was never reached in this window — the trade would not have triggered.',
    };
  }

  // 2) Walk forward until the target or the stop is hit.
  const finish = (outcome, exitPrice, exitIdx) => {
    const bar = window[exitIdx];
    const exitDate = bar.t.slice(0, 10);
    const pnlPerShare = exitPrice - entryPrice;
    const rMultiple = entry - stop !== 0 ? pnlPerShare / (entry - stop) : null;
    // Price path from entry to exit, for the replay chart.
    const path = window.slice(entryIdx, exitIdx + 1)
      .map((b) => ({ d: b.t.slice(0, 10), c: b.c }));
    return {
      symbol, outcome,
      entryDate, entryPrice: Number(entryPrice.toFixed(2)),
      exitDate, exitPrice: Number(exitPrice.toFixed(2)),
      daysHeld: daysBetween(entryDate, exitDate),
      shares,
      pnl: Number((pnlPerShare * shares).toFixed(2)),
      pnlPct: entryPrice ? pnlPerShare / entryPrice : null,
      rMultiple,
      entry, target, stop, // plan levels for the chart overlay
      path,
    };
  };

  for (let i = entryIdx + 1; i < window.length; i++) {
    const b = window[i];
    // If both happen in one bar, assume the stop hit first (conservative).
    if (b.l <= stop) {
      const px = b.o < stop ? b.o : stop; // gap-down fills worse
      return finish('stopped', px, i);
    }
    if (b.h >= target) {
      const px = b.o > target ? b.o : target; // gap-up fills better
      return finish('target', px, i);
    }
  }

  // 3) Never resolved — still open, marked to the last close.
  const res = finish('open', window[window.length - 1].c, window.length - 1);
  res.outcome = 'open';
  return res;
}
