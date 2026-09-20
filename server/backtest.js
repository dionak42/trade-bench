// Run the system over a whole price history, one trade after another, and
// report where it works and where it breaks down.
//
// The single-trade replay answers "what would this one setup have done?". That
// is one sample, and one sample tells you almost nothing — a system's character
// only shows up across a sequence. This walks the entire history the way you
// would actually have traded it: one position at a time per symbol, each trade
// starting only after the previous one closed, levels re-derived from scratch
// every time using nothing but the bars available on that day.
//
// It is a backtest, so the usual warnings apply: it assumes your orders fill at
// your price, it ignores commissions and slippage, and a strategy fitted to the
// past has no obligation to repeat. Treat the shape of the results — the spread
// of outcomes, the length of the bad patches — as the lesson, not the total.
import { getDailyBars } from './alpaca.js';
import { deriveLevels, sizePosition, daysBetween, MIN_HISTORY } from './replay.js';

// Walk one symbol's history end to end, collecting a sequence of trades.
//
// `maxWaitBars` is a rule the plan builder never made you state: how long you
// leave a resting limit order out before the level it was based on is stale.
// A backtest forces the question, because without an answer the sim would sit
// on a three-year-old support level waiting for a fill that means nothing.
export function runSequence(symbol, bars, opts = {}) {
  const {
    mode = 'risk', accountSize = 0, riskPct = 1, capital = 0,
    stopAtrMult = 2, entryStyle = 'pullback', maxWaitBars = 20,
    // Don't start trading until enough history exists for every input the
    // system uses — including the 200-day average behind the regime filter.
    // Trading before then would quietly test a different, filterless system.
    warmupBars = MIN_HISTORY,
  } = opts;

  const trades = [];
  let i = Math.max(MIN_HISTORY, warmupBars);
  let noFills = 0;

  while (i < bars.length - 1) {
    const lv = deriveLevels(bars, i, { stopAtrMult, entryStyle });
    if (!lv) break;

    // 1) Wait (up to maxWaitBars) for the entry to trigger.
    let entryIdx = -1;
    let entryPrice = null;
    const deadline = Math.min(i + maxWaitBars, bars.length - 1);
    for (let j = i; j <= deadline; j++) {
      const b = bars[j];
      const triggered = lv.breakout ? b.h >= lv.entry : b.l <= lv.entry;
      if (triggered) {
        // A gap through the level fills at the open, not at your price:
        // worse on a breakout, better on a pullback.
        entryPrice = lv.breakout
          ? (b.o >= lv.entry ? b.o : lv.entry)
          : (b.o <= lv.entry ? b.o : lv.entry);
        entryIdx = j;
        break;
      }
    }
    if (entryIdx < 0) {
      noFills++;
      i = deadline + 1; // level went stale — re-derive and look again
      continue;
    }

    const shares = sizePosition({
      entry: lv.entry, riskPerShare: lv.riskPerShare, mode, accountSize, riskPct, capital,
    });

    // 2) Walk forward to the target or the stop. The stop is checked first:
    //    when a single daily bar spans both, assuming the good one is the
    //    classic way a backtest flatters itself.
    let exitIdx = -1, exitPrice = null, outcome = null;
    for (let j = entryIdx + 1; j < bars.length; j++) {
      const b = bars[j];
      if (b.l <= lv.stop) {
        exitPrice = b.o < lv.stop ? b.o : lv.stop; // gap down fills worse
        exitIdx = j; outcome = 'stopped'; break;
      }
      if (b.h >= lv.target) {
        exitPrice = b.o > lv.target ? b.o : lv.target; // gap up fills better
        exitIdx = j; outcome = 'target'; break;
      }
    }
    if (exitIdx < 0) { // still open at the end of the data — mark to last close
      exitIdx = bars.length - 1;
      exitPrice = bars[exitIdx].c;
      outcome = 'open';
    }

    const entryDate = bars[entryIdx].t.slice(0, 10);
    const exitDate = bars[exitIdx].t.slice(0, 10);
    const pnlPerShare = exitPrice - entryPrice;
    trades.push({
      symbol,
      style: entryStyle,
      regime: lv.regime,              // regime at the moment of the decision
      asOf: lv.asOf,
      entry: lv.entry, target: lv.target, stop: lv.stop,
      shares,
      entryDate, entryPrice: Number(entryPrice.toFixed(2)),
      exitDate, exitPrice: Number(exitPrice.toFixed(2)),
      daysHeld: daysBetween(entryDate, exitDate),
      outcome,
      pnl: Number((pnlPerShare * shares).toFixed(2)),
      pnlPct: entryPrice ? pnlPerShare / entryPrice : null,
      rMultiple: lv.riskPerShare > 0 ? Number((pnlPerShare / lv.riskPerShare).toFixed(3)) : null,
      year: entryDate.slice(0, 4),
    });

    if (outcome === 'open') break;
    i = exitIdx + 1; // next trade starts only after this one closed
  }

  return { trades, noFills };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round = (n, dp = 2) => (n == null ? null : Number(n.toFixed(dp)));

// Summarise any set of trades. Used for the headline and for every segment,
// so the numbers mean the same thing wherever they appear.
export function summarise(trades) {
  const scored = trades.filter((t) => t.rMultiple != null);
  if (!scored.length) {
    return { trades: trades.length, scored: 0, winRate: null, avgR: null, totalR: null,
             avgWinR: null, avgLossR: null, profitFactor: null, wins: 0, losses: 0,
             avgDaysHeld: null, maxDrawdownR: null, worstLossStreak: 0 };
  }
  const rs = scored.map((t) => t.rMultiple);
  const wins = scored.filter((t) => t.rMultiple > 0);
  const losses = scored.filter((t) => t.rMultiple <= 0);
  const grossWin = sum(wins.map((t) => t.rMultiple));
  const grossLoss = Math.abs(sum(losses.map((t) => t.rMultiple)));

  // Equity curve in R, oldest first, and the deepest peak-to-trough fall on it.
  // This is the number that decides whether a system is survivable: expectancy
  // says whether it pays, drawdown says whether you'd still be running it when
  // it did.
  const chron = [...scored].sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1));
  let equity = 0, peak = 0, maxDd = 0, run = 0, worstStreak = 0;
  const curve = [];
  for (const t of chron) {
    equity += t.rMultiple;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (t.rMultiple <= 0) { run++; worstStreak = Math.max(worstStreak, run); } else run = 0;
    curve.push({ d: t.entryDate, r: round(equity), symbol: t.symbol });
  }

  return {
    trades: trades.length,
    scored: scored.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / scored.length,
    avgR: round(sum(rs) / rs.length),
    totalR: round(sum(rs)),
    avgWinR: wins.length ? round(grossWin / wins.length) : null,
    avgLossR: losses.length ? round(-grossLoss / losses.length) : null,
    // Gross win over gross loss. Above 1 means the wins carried the losses.
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    avgDaysHeld: Math.round(sum(scored.map((t) => t.daysHeld)) / scored.length),
    maxDrawdownR: round(maxDd),
    worstLossStreak: worstStreak,
    curve,
  };
}

// Split the trades by some key and summarise each bucket. This is the
// "where does it break down" machinery: the headline number hides the
// segments, and the segments are where the decisions are.
function segment(trades, keyFn, { minTrades = 1 } = {}) {
  const buckets = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (k == null) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  return [...buckets.entries()]
    .filter(([, ts]) => ts.length >= minTrades)
    .map(([key, ts]) => ({ key, ...summarise(ts), curve: undefined }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

// 200 trading bars ≈ 290 calendar days; fetch that much extra so the tested
// window is the full period the caller asked for, with the filter live throughout.
const WARMUP_BARS = 200;
const WARMUP_DAYS = 300;

// `fetchBars` is injectable so the whole pipeline can be exercised against
// deterministic synthetic history in tests, without a live data feed.
export async function runBacktest(symbols, opts = {}, fetchBars = getDailyBars) {
  const { years = 3 } = opts;
  const days = Math.round(years * 365) + WARMUP_DAYS;
  const all = [];
  const perSymbol = [];
  const errors = [];

  const results = await Promise.all(symbols.map(async (symbol) => {
    try {
      const bars = await fetchBars(symbol, days);
      if (bars.length < WARMUP_BARS + 30) {
        throw new Error(`only ${bars.length} bars of history — need ${WARMUP_BARS + 30}`);
      }
      return { symbol, ...runSequence(symbol, bars, { ...opts, warmupBars: WARMUP_BARS }) };
    } catch (err) {
      return { symbol, error: err.message };
    }
  }));

  for (const r of results) {
    if (r.error) { errors.push({ symbol: r.symbol, error: r.error }); continue; }
    all.push(...r.trades);
    perSymbol.push({ key: r.symbol, ...summarise(r.trades), curve: undefined, noFills: r.noFills });
  }

  const overall = summarise(all);

  // The regime split directly tests SYSTEM.md rule 2 — "only buy in a
  // golden-cross regime". If the death-cross bucket is no worse, the filter is
  // costing trades without buying safety, and the rule should change.
  const byRegime = segment(all, (t) => t.regime);
  const golden = byRegime.find((b) => b.key === 'golden');
  const death = byRegime.find((b) => b.key === 'death');
  const filterVerdict = golden && death && golden.scored >= 5 && death.scored >= 5
    ? { goldenAvgR: golden.avgR, deathAvgR: death.avgR, edge: round(golden.avgR - death.avgR),
        helps: golden.avgR > death.avgR }
    : null;

  return {
    params: { symbols, years, ...opts },
    overall,
    bySymbol: perSymbol.sort((a, b) => (b.totalR ?? -999) - (a.totalR ?? -999)),
    byRegime,
    byYear: segment(all, (t) => t.year),
    byOutcome: segment(all, (t) => t.outcome),
    filterVerdict,
    rDistribution: bucketR(all),
    trades: all.sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1)),
    errors,
  };
}

// Histogram of results in R. The shape is the point: most systems that work
// look like a wall of small losses with a thin tail of large wins, and seeing
// that before you trade is what stops you abandoning the system during the wall.
function bucketR(trades) {
  const edges = [-3, -2, -1, 0, 1, 2, 3];
  const labels = ['< -3R', '-3 to -2R', '-2 to -1R', '-1 to 0R', '0 to 1R', '1 to 2R', '2 to 3R', '> 3R'];
  const counts = new Array(labels.length).fill(0);
  for (const t of trades) {
    if (t.rMultiple == null) continue;
    let idx = edges.findIndex((e) => t.rMultiple < e);
    if (idx === -1) idx = labels.length - 1;
    counts[idx]++;
  }
  return labels.map((label, i) => ({ label, count: counts[i] }));
}
