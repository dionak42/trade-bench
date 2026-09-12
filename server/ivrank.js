// Home-grown IV rank: snapshot ATM implied vol daily, then rank today's
// reading against our own accumulated history. No paid data feed needed —
// it just gets more useful the longer the server runs.
import { getUnderlyingPrice, getOptionsChain } from './alpaca.js';
import { saveIvSnapshot, getIvHistory, listWatchlist } from './db.js';

// Pick the at-the-money IV: nearest expiration at least ~20 days out,
// then the strike closest to spot. Averages the call and put if both exist.
export async function getAtmIv(symbol, price) {
  const spot = price ?? (await getUnderlyingPrice(symbol)).price;
  const lo = spot * 0.8;
  const hi = spot * 1.2;
  const chain = await getOptionsChain(symbol, { strikeGte: lo, strikeLte: hi });
  const withIv = chain.filter((c) => typeof c.iv === 'number' && c.iv > 0);
  if (withIv.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const minDte = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const eligible = withIv.filter((c) => c.expiration >= minDte);
  const pool = eligible.length ? eligible : withIv;

  // Nearest expiration in the pool.
  const targetExp = pool
    .map((c) => c.expiration)
    .sort((a, b) => a.localeCompare(b))[0];
  const atExp = pool.filter((c) => c.expiration === targetExp);

  // Strike closest to spot.
  let best = null;
  let bestDist = Infinity;
  for (const c of atExp) {
    const d = Math.abs(c.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      best = c.strike;
    }
  }
  const atStrike = atExp.filter((c) => c.strike === best);
  const avgIv =
    atStrike.reduce((sum, c) => sum + c.iv, 0) / atStrike.length;
  return { iv: avgIv, date: today, expiration: targetExp, strike: best };
}

// Rank today's IV within stored history (needs a few days to be meaningful).
export function computeRank(history, currentIv) {
  if (!history.length) {
    return { rank: null, percentile: null, days: 0, min: null, max: null };
  }
  const ivs = history.map((h) => h.iv);
  const min = Math.min(...ivs);
  const max = Math.max(...ivs);
  const rank = max > min ? ((currentIv - min) / (max - min)) * 100 : null;
  const below = ivs.filter((v) => v <= currentIv).length;
  const percentile = (below / ivs.length) * 100;
  return { rank, percentile, days: history.length, min, max };
}

// Full IV-rank read for one symbol: snapshot today, then rank.
export async function ivRankFor(symbol, price) {
  const atm = await getAtmIv(symbol, price);
  if (!atm) return null;
  saveIvSnapshot(symbol, atm.date, atm.iv);
  const history = getIvHistory(symbol);
  const ranked = computeRank(history, atm.iv);
  return { currentIv: atm.iv, ...ranked };
}

// Daily background job: snapshot ATM IV for every watchlist symbol.
// Idempotent per day, so running it more than once is harmless.
export async function snapshotWatchlistIv() {
  const rows = listWatchlist();
  const results = [];
  for (const { symbol } of rows) {
    try {
      const atm = await getAtmIv(symbol);
      if (atm) {
        saveIvSnapshot(symbol, atm.date, atm.iv);
        results.push({ symbol, iv: atm.iv });
      }
    } catch (err) {
      console.error(`[iv-snapshot] ${symbol} failed:`, err.message);
    }
  }
  if (results.length) {
    console.log(`[iv-snapshot] recorded ${results.length} symbol(s)`);
  }
  return results;
}
