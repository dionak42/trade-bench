// Finnhub client: company news + forward-looking earnings calendar.
// Free tier covers both (confirmed against a live key).
import { cfg } from './config.js';

const BASE = 'https://finnhub.io/api/v1';

function token() {
  return cfg('FINNHUB_API_KEY');
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Recent company news, newest first, capped to a handful of items.
export async function getNews(symbol, limit = 10) {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000); // last 30 days
  const url = `${BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${ymd(from)}&to=${ymd(to)}&token=${token()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub news failed (${res.status}): ${await res.text()}`);
  const items = await res.json();
  return (Array.isArray(items) ? items : [])
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, limit)
    .map((n) => ({
      headline: n.headline,
      source: n.source,
      url: n.url,
      datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
    }));
}

// Symbol search by name or ticker. Prefers US symbols (no exchange suffix)
// so the results are tradeable through Alpaca.
export async function searchSymbols(query) {
  const url = `${BASE}/search?q=${encodeURIComponent(query)}&token=${token()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub search failed (${res.status})`);
  const json = await res.json();
  const seen = new Set();
  return (json?.result ?? [])
    .filter((r) => r.symbol && !r.symbol.includes('.') && /^[A-Z]{1,6}$/.test(r.symbol))
    .filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true))) // one row per ticker
    .slice(0, 8)
    .map((r) => ({ symbol: r.symbol, description: r.description, type: r.type }));
}

// Economic calendar (CPI, FOMC, payrolls, PMI...). This endpoint is NOT on
// every Finnhub plan — the free tier commonly returns 403. Rather than
// swallowing that, we report it so the UI can say why the list is empty and
// point at the manual fallback.
export async function getEconomicCalendar(fromDate, toDate) {
  const url = `${BASE}/calendar/economic?from=${fromDate}&to=${toDate}&token=${token()}`;
  const res = await fetch(url);
  if (res.status === 403 || res.status === 401) {
    return { available: false, reason: 'plan', events: [] };
  }
  if (!res.ok) {
    return { available: false, reason: `http_${res.status}`, events: [] };
  }
  const json = await res.json();
  const rows = json?.economicCalendar ?? json?.result ?? [];
  if (!Array.isArray(rows)) return { available: false, reason: 'shape', events: [] };
  const events = rows
    .filter((r) => !r.country || r.country === 'US')
    .map((r) => ({
      date: String(r.time || '').slice(0, 10),
      time: String(r.time || '').slice(11, 16) || null,
      title: r.event || 'Economic release',
      impact: String(r.impact || '').toLowerCase() || 'medium',
      estimate: r.estimate ?? null,
      prev: r.prev ?? null,
      unit: r.unit ?? null,
      source: 'finnhub',
    }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  return { available: true, reason: null, events };
}

// Next scheduled earnings date (within ~4 months), plus estimates.
// hour: "amc" = after close, "bmo" = before open, "dmh" = during hours.
export async function getNextEarnings(symbol) {
  const from = new Date();
  const to = new Date(from.getTime() + 120 * 24 * 60 * 60 * 1000);
  const url = `${BASE}/calendar/earnings?from=${ymd(from)}&to=${ymd(to)}&symbol=${encodeURIComponent(symbol)}&token=${token()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub earnings failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const rows = json?.earningsCalendar ?? [];
  if (rows.length === 0) return null;
  // Earliest upcoming date.
  const next = rows.sort((a, b) => a.date.localeCompare(b.date))[0];
  return {
    date: next.date,
    hour: next.hour || null,
    epsEstimate: next.epsEstimate ?? null,
    revenueEstimate: next.revenueEstimate ?? null,
  };
}
