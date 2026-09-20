// Macro calendar: the scheduled events that move the whole tape, alongside
// the per-ticker earnings and ex-dividends the app already tracks.
//
// Three sources, merged newest-first:
//   1. Finnhub's economic calendar, when the user's plan includes it.
//   2. A rules-derived release we can state with confidence on any plan.
//   3. Events you type in yourself — paste "FOMC, Oct 28" out of a newsletter
//      once and the app will flag it against your option expirations forever.
// Nothing here guesses at a release date it can't justify.
import { getEconomicCalendar } from './finnhub.js';
import { listEconEvents } from './db.js';

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);

// Weekly jobless claims: released every Thursday at 8:30 a.m. ET. This is a
// standing weekly schedule, not a forecast — the one macro event we can
// generate without a data feed. (It shifts when Thursday is a federal
// holiday, which is why it's labelled as a recurring rule in the UI.)
// Capped at the next few: it repeats every week by definition, so listing a
// whole quarter of them would bury the events you actually need to see.
const MAX_RECURRING = 3;

function joblessClaims(fromDate, toDate) {
  const out = [];
  const start = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T00:00:00Z');
  for (let t = start.getTime(); t <= end.getTime() && out.length < MAX_RECURRING; t += DAY) {
    const d = new Date(t);
    if (d.getUTCDay() !== 4) continue; // Thursday
    out.push({
      date: ymd(d),
      time: '08:30',
      title: 'Initial jobless claims',
      impact: 'medium',
      estimate: null,
      prev: null,
      source: 'rule',
    });
  }
  return out;
}

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Upcoming macro events between today and `days` out.
 * Always resolves — a missing or unentitled feed degrades to the rule-derived
 * and user-entered events rather than failing the panel.
 */
export async function getMacroCalendar({ days = 45 } = {}) {
  const from = ymd(new Date());
  const to = ymd(new Date(Date.now() + days * DAY));

  const feed = await getEconomicCalendar(from, to).catch(() => ({
    available: false, reason: 'error', events: [],
  }));

  // Deliberately NOT clipped to the feed window: if you typed a date in, you
  // want to see it, even when it's further out than the feed reaches.
  const manual = listEconEvents(from, null).map((e) => ({
    id: e.id,
    date: e.date,
    time: e.time || null,
    title: e.title,
    impact: e.impact || 'high',
    notes: e.notes || '',
    source: 'manual',
  }));

  // Only synthesize claims when the real feed isn't there to provide them.
  const derived = feed.available ? [] : joblessClaims(from, to);

  const events = [...feed.events, ...derived, ...manual]
    .filter((e) => e.date >= from && (e.source === 'manual' || e.date <= to))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) ||
      String(a.time || '').localeCompare(String(b.time || '')));

  return {
    from,
    to,
    // How far the scheduled feeds reach; manual events can sit beyond it.
    horizonDays: days,
    events,
    feed: {
      available: feed.available,
      reason: feed.reason,
      // Explains an empty or thin list instead of leaving the user guessing.
      note: feed.available
        ? null
        : feed.reason === 'plan'
          ? "Your Finnhub plan doesn't include the economic calendar. Showing recurring releases and any events you've added below."
          : 'The economic-calendar feed is unavailable right now. Showing recurring releases and any events you’ve added below.',
    },
  };
}

// Do any macro events fall inside [today, expiration]? Mirrors the earnings /
// ex-dividend check the option calculators already run.
export function macroEventsInWindow(events, expiration) {
  const today = ymd(new Date());
  return (events || []).filter(
    (e) => e.date >= today && e.date <= expiration && (e.impact === 'high' || e.source === 'manual')
  );
}
