// Alpaca market-data client: underlying price + options chain with greeks.
// Free "Basic" plan → iex feed for stocks, indicative feed for options (delayed).
const DATA_BASE = 'https://data.alpaca.markets';

function authHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET_KEY,
  };
}

// Parse an OCC option symbol, e.g. "AAPL260914C00250000":
//   root=AAPL, expiration=2026-09-14, type=call, strike=250.00
export function parseOccSymbol(occ) {
  const m = occ.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, root, yy, mm, dd, cp, strikeRaw] = m;
  return {
    root,
    expiration: `20${yy}-${mm}-${dd}`,
    type: cp === 'C' ? 'call' : 'put',
    strike: Number(strikeRaw) / 1000,
  };
}

// Latest underlying price. Prefer last trade; fall back to quote midpoint.
export async function getUnderlyingPrice(symbol) {
  const res = await fetch(
    `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Alpaca price lookup failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  const price = json?.trade?.p;
  const asOf = json?.trade?.t ?? null;
  if (typeof price !== 'number') throw new Error(`No price returned for ${symbol}`);
  return { price, asOf };
}

// Daily price bars for technical analysis (free IEX feed). Returns oldest-first.
export async function getDailyBars(symbol, days = 400) {
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const bars = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      timeframe: '1Day',
      start,
      limit: '1000',
      feed: 'iex',
      adjustment: 'all',
    });
    if (pageToken) params.set('page_token', pageToken);
    const res = await fetch(
      `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Alpaca bars failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json();
    for (const b of json?.bars ?? []) {
      bars.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
    pageToken = json?.next_page_token ?? null;
  } while (pageToken);
  return bars;
}

// Upcoming (and recent) cash dividends. Ex-date is what matters for
// covered-call early-assignment risk. Returns the next future ex-date first.
export async function getUpcomingDividend(symbol) {
  const today = new Date();
  const start = new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000);
  const end = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    symbols: symbol.toUpperCase(),
    types: 'cash_dividend',
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    limit: '100',
  });
  const res = await fetch(
    `${DATA_BASE}/v1beta1/corporate-actions?${params}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Alpaca dividends failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  const divs = json?.corporate_actions?.cash_dividends ?? [];
  const todayStr = today.toISOString().slice(0, 10);
  // Prefer the next upcoming ex-date; fall back to the most recent past one.
  const upcoming = divs
    .filter((d) => d.ex_date >= todayStr)
    .sort((a, b) => a.ex_date.localeCompare(b.ex_date));
  const past = divs
    .filter((d) => d.ex_date < todayStr)
    .sort((a, b) => b.ex_date.localeCompare(a.ex_date));
  const pick = upcoming[0] ?? past[0];
  if (!pick) return null;
  return {
    exDate: pick.ex_date,
    rate: pick.rate,
    payableDate: pick.payable_date ?? null,
    upcoming: Boolean(upcoming[0]),
  };
}

// Full options chain snapshot, paginated, normalized to a flat array.
// Optional strike window keeps the payload sane around the money.
export async function getOptionsChain(symbol, { strikeGte, strikeLte } = {}) {
  const contracts = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({ feed: 'indicative', limit: '1000' });
    if (strikeGte != null) params.set('strike_price_gte', String(strikeGte));
    if (strikeLte != null) params.set('strike_price_lte', String(strikeLte));
    if (pageToken) params.set('page_token', pageToken);

    const res = await fetch(
      `${DATA_BASE}/v1beta1/options/snapshots/${encodeURIComponent(symbol)}?${params}`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Alpaca chain lookup failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json();
    const snapshots = json?.snapshots ?? {};

    for (const [occ, snap] of Object.entries(snapshots)) {
      const parsed = parseOccSymbol(occ);
      if (!parsed) continue;
      const q = snap.latestQuote ?? {};
      contracts.push({
        occSymbol: occ,
        expiration: parsed.expiration,
        type: parsed.type,
        strike: parsed.strike,
        bid: q.bp ?? null,
        ask: q.ap ?? null,
        delta: snap.greeks?.delta ?? null,
        iv: snap.impliedVolatility ?? null,
        lastPrice: snap.latestTrade?.p ?? null,
      });
    }
    pageToken = json?.next_page_token ?? null;
  } while (pageToken);

  return contracts;
}
