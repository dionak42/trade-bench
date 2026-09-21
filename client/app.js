'use strict';

// ---------- State ----------
const state = {
  symbol: null,
  quote: null,       // { symbol, price, asOf, chain: [...] }
  events: null,      // { earnings, dividend }
  ivrank: null,      // { currentIv, rank, percentile, days }
  calcType: 'cc',    // 'cc' | 'csp'
  chainType: 'call', // 'call' | 'put'
  expiration: null,
  selected: null,    // occSymbol
  lastUpdated: null,
  showTargetZone: true,
  view: 'analysis',  // 'analysis' (Research) | 'planner' (Options) | 'paper'
  analysis: null,    // cached scorecard for the loaded symbol
  sizingMode: 'risk', // 'risk' | 'capital'
  journalStatus: '',  // journal filters
  journalSymbol: '',
  journalTrades: [],
  journalOpen: new Set(), // ids of expanded review forms
  planThesis: '',    // survives plan-builder re-renders
  backtestSymbols: '', backtestYears: 5, backtestWait: 20,
  backtestValidation: 12, backtestHoldout: 12, backtestAbove200: false,
  backtestMaxHold: 0,
  backtestStyle: 'pullback', backtestResult: null,
  entryStyle: 'pullback', // 'pullback' | 'breakout'
  settings: {},      // { accountSize, riskPct } cached from /settings
  regime: null,      // market-wide context (indexes, sectors, breadth, vol)
  econ: null,        // { events, feed } macro calendar
};

const REFRESH_MS = 60 * 1000;
let refreshTimer = null;
let tickTimer = null;

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const api = async (path, opts) => {
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
};
const money = (n) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const pct = (n, dp = 1) => (n == null || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(dp)}%`);
const num = (n, dp = 2) => (n == null || Number.isNaN(n) ? '—' : n.toFixed(dp));
// Escape untrusted strings (news, notes) before they touch innerHTML.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Only allow http(s) links; anything else (javascript:, data:) becomes inert.
const safeUrl = (u) => {
  try {
    const parsed = new URL(u, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch {
    return '#';
  }
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const dteOf = (expiration) => {
  const ms = new Date(expiration + 'T00:00:00Z') - new Date(todayStr() + 'T00:00:00Z');
  return Math.max(1, Math.round(ms / 86400000));
};
const daysUntil = (dateStr) => Math.round((new Date(dateStr + 'T00:00:00Z') - new Date(todayStr() + 'T00:00:00Z')) / 86400000);

// High-impact macro events between now and an expiration. A CPI print or an
// FOMC decision inside your option's life is the same kind of risk as an
// earnings report — it just isn't attached to the ticker.
function macroInWindow(expiration) {
  return (state.econ?.events || []).filter(
    (e) => e.date >= todayStr() && e.date <= expiration
      && (e.impact === 'high' || e.source === 'manual')
  );
}

// Does an event fall inside [today, expiration]?
// `includeMacro` is off for the chain's per-row ⚠️: a macro date lands inside
// every contract at a given expiration, so flagging each row would drown out
// the marker's real job — telling you THIS ticker has an event coming. The
// calculator still warns about macro, where there's room to name it.
function eventInWindow(expiration, { includeMacro = true } = {}) {
  const flags = [];
  const e = state.events?.earnings;
  if (e?.date && e.date >= todayStr() && e.date <= expiration) flags.push('earnings');
  const d = state.events?.dividend;
  if (d?.upcoming && d.exDate >= todayStr() && d.exDate <= expiration) flags.push('dividend');
  if (includeMacro && macroInWindow(expiration).length) flags.push('macro');
  return flags;
}

// ---------- Data loading ----------
async function loadSymbol(sym) {
  sym = String(sym || '').trim().toUpperCase();
  if (!sym) return;
  state.symbol = sym;
  state.selected = null;
  $('#empty-state').classList.add('hidden');
  $('#scan-panel').classList.add('hidden');
  $('#regime-panel').classList.add('hidden');
  $('#macro-panel').classList.add('hidden');
  $('#content').classList.remove('hidden');
  $('#ticker-header').classList.remove('hidden');
  $('#view-toggle').classList.remove('hidden');
  setRefreshStatus('Loading…');

  try {
    const [quote, events, news, ivrank] = await Promise.all([
      api(`/quote/${sym}`),
      api(`/events/${sym}`).catch(() => ({ earnings: null, dividend: null })),
      api(`/news/${sym}`).catch(() => ({ news: [] })),
      api(`/ivrank/${sym}`).catch(() => null),
    ]);
    state.quote = quote;
    state.events = events;
    state.ivrank = ivrank;
    state.lastUpdated = Date.now();
    state.analysis = null; // recomputed lazily when the Analysis view opens

    // Default expiration ≈ 30 days out — the natural horizon for covered
    // calls / CSPs. (Nearest weekly annualizes to misleadingly huge numbers.)
    const exps = expirations();
    state.expiration = exps.length
      ? exps.reduce((best, e) =>
          Math.abs(dteOf(e) - 30) < Math.abs(dteOf(best) - 30) ? e : best)
      : null;

    renderAll();
    renderNews(news.news);
    // WSJ deep link for the loaded ticker (opens in the user's logged-in browser).
    document.querySelectorAll('.wsj-link').forEach((w) => {
      w.href = `https://www.wsj.com/market-data/quotes/${encodeURIComponent(sym)}`;
      w.classList.remove('hidden');
    });
    selectDefaultContract();
    startAutoRefresh();
    switchView(state.view); // sync visible view (defaults to Research) + load its data
  } catch (err) {
    showError(err.message);
  }
}

// Background refresh: re-pull price + chain + IV only, keep selection.
async function refreshQuote() {
  if (!state.symbol || document.hidden) return;
  try {
    const [quote, ivrank] = await Promise.all([
      api(`/quote/${state.symbol}`),
      api(`/ivrank/${state.symbol}`).catch(() => state.ivrank),
    ]);
    state.quote = quote;
    state.ivrank = ivrank;
    state.lastUpdated = Date.now();
    renderHeader();
    renderChain();
    compute(); // recompute with fresh live values for non-edited fields
  } catch (err) {
    setRefreshStatus('Refresh failed');
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshQuote, REFRESH_MS);
  clearInterval(tickTimer);
  tickTimer = setInterval(updateRefreshTick, 1000);
  updateRefreshTick();
}

function updateRefreshTick() {
  if (!state.lastUpdated) return;
  const secs = Math.round((Date.now() - state.lastUpdated) / 1000);
  setRefreshStatus(document.hidden ? 'Paused' : `updated ${secs}s ago`, !document.hidden);
}

function setRefreshStatus(text, live = false) {
  const el = $('#refresh-status');
  el.textContent = text;
  el.classList.toggle('live', live);
}

// ---------- Chain helpers ----------
function expirations() {
  if (!state.quote) return [];
  return [...new Set(state.quote.chain.map((c) => c.expiration))].sort();
}
function chainRows() {
  if (!state.quote) return [];
  return state.quote.chain
    .filter((c) => c.type === state.chainType && c.expiration === state.expiration)
    .sort((a, b) => a.strike - b.strike);
}
function contractBy(occ) {
  return state.quote?.chain.find((c) => c.occSymbol === occ) || null;
}
function spreadPct(c) {
  if (!c.bid || !c.ask) return null;
  const mid = (c.bid + c.ask) / 2;
  return mid ? (c.ask - c.bid) / mid : null;
}

// ---------- Rendering ----------
function renderAll() {
  renderHeader();
  renderExpSelect();
  renderChain();
  renderEvents();
  renderCalc();
}

function renderHeader() {
  const q = state.quote;
  const iv = state.ivrank;
  const badges = [];

  if (iv?.currentIv != null) {
    const rankTxt = iv.rank != null
      ? `Rank ${iv.rank.toFixed(0)}`
      : `${iv.days} day${iv.days === 1 ? '' : 's'} history`;
    badges.push(`<span class="badge accent">IV ${pct(iv.currentIv, 0)} <span class="sub">${rankTxt}</span></span>`);
  }
  const e = state.events?.earnings;
  if (e?.date) {
    const d = daysUntil(e.date);
    const hour = e.hour === 'amc' ? 'after close' : e.hour === 'bmo' ? 'before open' : '';
    badges.push(`<span class="badge warn">📅 Earnings ${e.date} <span class="sub">${d}d${hour ? ' · ' + hour : ''}</span></span>`);
  }
  const dv = state.events?.dividend;
  if (dv?.upcoming) {
    badges.push(`<span class="badge good">💰 Ex-div ${dv.exDate} <span class="sub">$${num(dv.rate)} · ${daysUntil(dv.exDate)}d</span></span>`);
  }

  const asOf = q.asOf ? new Date(q.asOf).toLocaleString() : '';
  $('#ticker-header').innerHTML = `
    <div class="th-price">
      <span class="th-symbol">${q.symbol}</span>
      <span class="th-value">${money(q.price)}</span>
    </div>
    <div class="badges">${badges.join('')}</div>
    <div class="th-asof">as of ${asOf} · delayed feed</div>
  `;
}

function renderExpSelect() {
  const sel = $('#exp-select');
  sel.innerHTML = expirations()
    .map((e) => `<option value="${e}" ${e === state.expiration ? 'selected' : ''}>${e} · ${dteOf(e)}d</option>`)
    .join('');
}

function renderChain() {
  const price = state.quote.price;
  const rows = chainRows();
  // Find ATM strike (closest to price).
  let atm = null, best = Infinity;
  for (const c of rows) {
    const d = Math.abs(c.strike - price);
    if (d < best) { best = d; atm = c.strike; }
  }

  // Sweet-spot target: among strikes in the ~0.20–0.35 delta band, the one
  // whose |delta| is closest to 0.30 gets the ★. A common income-selling heuristic.
  let bestZoneOcc = null;
  if (state.showTargetZone) {
    let bestDist = Infinity;
    for (const c of rows) {
      if (c.delta == null) continue;
      const ad = Math.abs(c.delta);
      if (ad >= 0.20 && ad <= 0.35 && Math.abs(ad - 0.30) < bestDist) {
        bestDist = Math.abs(ad - 0.30);
        bestZoneOcc = c.occSymbol;
      }
    }
  }

  $('#chain-body').innerHTML = rows.map((c) => {
    const sp = spreadPct(c);
    const spCls = sp == null || sp > 0.15 ? 'spread-wide' : 'spread-ok';
    const spTxt = sp == null ? 'wide' : pct(sp, 0);
    const prob = c.delta != null ? `${Math.abs(c.delta * 100).toFixed(0)}%` : '—';
    const deltaTxt = c.delta != null ? num(c.delta) : '—';
    const flags = eventInWindow(c.expiration, { includeMacro: false });
    const ad = c.delta != null ? Math.abs(c.delta) : null;
    const inZone = state.showTargetZone && ad != null && ad >= 0.20 && ad <= 0.35;
    const isBest = c.occSymbol === bestZoneOcc;
    const cls = [
      c.strike === atm ? 'atm' : '',
      c.occSymbol === state.selected ? 'selected' : '',
      flags.length ? 'event-flag' : '',
      inZone ? 'target-zone' : '',
      isBest ? 'target-best' : '',
    ].filter(Boolean).join(' ');
    const atmTip = c.strike === atm ? ' data-tip="At-the-money: the strike closest to the current price"' : '';
    const rowTip = flags.length ? ` data-tip="Event before expiration: ${flags.join(', ')} — extra risk to weigh"` : '';
    const star = isBest
      ? ' <span class="star" data-tip="Target zone: ~0.30 delta — a common income-selling strike (≈30% chance of assignment, ≈70% you keep the premium). A rule of thumb, not advice.">★</span>'
      : '';
    return `
      <tr class="${cls}" data-occ="${c.occSymbol}"${rowTip}>
        <td${atmTip}>${money(c.strike)}${star}</td>
        <td>${c.bid != null ? c.bid.toFixed(2) : '—'}</td>
        <td>${deltaTxt} <span class="prob">${prob}</span></td>
        <td>${c.iv != null ? pct(c.iv, 0) : '—'}</td>
        <td class="${spCls}">${spTxt}</td>
        <td>${dteOf(c.expiration)}</td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" class="loading">No ${state.chainType}s for this expiration.</td></tr>`;

  $('#chain-body').querySelectorAll('tr[data-occ]').forEach((tr) => {
    tr.addEventListener('click', () => selectContract(tr.dataset.occ));
  });
}

function selectDefaultContract() {
  // Default to the ATM contract of the current chain type.
  const rows = chainRows();
  if (!rows.length) return renderCalc();
  const price = state.quote.price;
  let pick = rows[0], best = Infinity;
  for (const c of rows) {
    const d = Math.abs(c.strike - price);
    if (d < best) { best = d; pick = c; }
  }
  selectContract(pick.occSymbol);
}

function selectContract(occ) {
  const c = contractBy(occ);
  if (!c) return;
  state.selected = occ;
  // Switch calculator to match the contract type.
  state.calcType = c.type === 'put' ? 'csp' : 'cc';
  syncCalcToggle();
  renderChain();
  renderCalc(c);
}

// ---------- Calculator ----------
function watchlistShares(symbol) {
  const item = (state._watchlist || []).find((w) => w.symbol === symbol);
  return item ? item.shares : 0;
}

function renderCalc(contract) {
  const c = contract || contractBy(state.selected);
  const body = $('#calc-body');
  if (!c) {
    body.innerHTML = `<div class="calc-empty">Click a strike in the chain to load it here.</div>`;
    return;
  }
  const price = state.quote.price;
  const dte = dteOf(c.expiration);
  const premium = c.bid != null ? c.bid : 0;

  if (state.calcType === 'cc') {
    const shares = watchlistShares(state.symbol) || 100;
    body.innerHTML = `
      <div class="calc-inputs">
        ${field('cc-shares', 'Shares owned', shares, 'How many shares you hold. Contracts = shares ÷ 100.')}
        ${field('cc-price', 'Current price', price.toFixed(2), 'Live underlying price (auto-updates).')}
        ${field('cc-strike', 'Strike', c.strike, 'The price your shares get called away at.')}
        ${field('cc-premium', 'Premium (bid)', premium.toFixed(2), 'Per-share credit you collect selling the call.')}
        ${field('cc-dte', 'Days to expiration', dte, 'Calendar days until the option expires.')}
        ${field('cc-delta', 'Delta', c.delta != null ? num(c.delta) : '', '≈ probability the shares get called away.')}
      </div>
      <div id="calc-out"></div>`;
  } else {
    body.innerHTML = `
      <div class="calc-inputs">
        ${field('csp-price', 'Current price', price.toFixed(2), 'Live underlying price (auto-updates).')}
        ${field('csp-strike', 'Strike', c.strike, 'The price you agree to buy at if assigned.')}
        ${field('csp-premium', 'Premium (bid)', premium.toFixed(2), 'Per-share credit you collect selling the put.')}
        ${field('csp-dte', 'Days to expiration', dte, 'Calendar days until the option expires.')}
        ${field('csp-contracts', 'Contracts', 1, 'Each contract secures 100 shares of cash.')}
        ${field('csp-delta', 'Delta', c.delta != null ? num(c.delta) : '', '≈ probability you get assigned the shares.')}
      </div>
      <div id="calc-out"></div>`;
  }

  body.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', () => { inp.dataset.edited = '1'; compute(); });
  });
  compute();
}

function field(id, label, value, help) {
  return `
    <div class="field">
      <label for="${id}"><span class="q" data-tip="${help}">${label}</span></label>
      <input id="${id}" type="number" step="any" value="${value}" />
    </div>`;
}

const val = (id) => parseFloat($(`#${id}`)?.value);

function compute() {
  const out = $('#calc-out');
  if (!out) return;
  const c = contractBy(state.selected);
  const expiration = c?.expiration;
  const flags = expiration ? eventInWindow(expiration) : [];

  if (state.calcType === 'cc') {
    const shares = val('cc-shares'), price = val('cc-price'), strike = val('cc-strike');
    const premium = val('cc-premium'), dte = val('cc-dte'), delta = val('cc-delta');
    const contracts = Math.floor(shares / 100);
    if (!contracts) {
      out.innerHTML = `<div class="calc-warning">You need at least 100 shares to sell one covered call.</div>`;
      return;
    }
    const premCollected = premium * 100 * contracts;
    const capital = price * 100 * contracts;
    const staticRet = premCollected / capital;
    const capGain = (strike - price) * 100 * contracts;
    const ifCalledRet = (premCollected + capGain) / capital;
    const factor = 365 / dte;
    const breakeven = price - premium;
    const downside = premium / price;
    const uncovered = Math.round(shares % 100);
    const probAssigned = delta;

    out.innerHTML = `
      ${warningHtml(flags)}
      <div class="headline-return">
        <div class="big">${pct(ifCalledRet * factor)}</div>
        <div class="lbl">Annualized return if called away</div>
      </div>
      <div class="outputs">
        ${outCell('Contracts sellable', contracts)}
        ${outCell('Premium collected', money(premCollected), 'good')}
        ${outCell('Static return (ann.)', pct(staticRet * factor), 'good', 'If the stock stays flat and you just keep the premium.')}
        ${outCell('If-called return (ann.)', pct(ifCalledRet * factor), ifCalledRet >= 0 ? 'good' : 'bad', 'Premium plus gain/loss to the strike, if assigned.')}
        ${outCell('Breakeven', money(breakeven), '', 'Stock can fall to here before you lose money.')}
        ${outCell('Downside protection', pct(downside), '', 'How far the stock can drop, cushioned by premium.')}
        ${outCell('Prob. called away', delta != null && !Number.isNaN(delta) ? pct(probAssigned, 0) : '—', '', '≈ delta of the call.')}
        ${outCell('Uncovered shares', uncovered)}
      </div>
      <div class="scenario">
        <strong>If assigned:</strong> sell ${contracts * 100} shares at ${money(strike)}
        (${money(strike * 100 * contracts)}) and keep ${money(premCollected)} premium
        → total ${money(strike * 100 * contracts + premCollected)}.
        ${uncovered ? `${uncovered} share${uncovered === 1 ? '' : 's'} remain uncovered.` : ''}
      </div>
      <button class="primary-btn place-btn" id="opt-place">📈 Paper trade this covered call</button>
      <div class="place-note">Sells ${contracts} contract${contracts === 1 ? '' : 's'} at ${money(premium)}/share. Simulated — needs 100+ shares per contract in the paper account.</div>`;
  } else {
    const price = val('csp-price'), strike = val('csp-strike'), premium = val('csp-premium');
    const dte = val('csp-dte'), contracts = val('csp-contracts'), delta = val('csp-delta');
    const cashRequired = strike * 100 * contracts;
    const premCollected = premium * 100 * contracts;
    const retOnCash = premCollected / cashRequired;
    const factor = 365 / dte;
    const breakeven = strike - premium;
    const discount = (price - breakeven) / price;
    const probAssigned = delta != null ? Math.abs(delta) : null;

    out.innerHTML = `
      ${warningHtml(flags)}
      <div class="headline-return">
        <div class="big">${pct(retOnCash * factor)}</div>
        <div class="lbl">Annualized return on cash</div>
      </div>
      <div class="outputs">
        ${outCell('Cash required', money(cashRequired))}
        ${outCell('Premium collected', money(premCollected), 'good')}
        ${outCell('Return on cash', pct(retOnCash), 'good', 'The raw premium yield over the holding period.')}
        ${outCell('Return (ann.)', pct(retOnCash * factor), 'good', 'Annualized so you can compare across expirations.')}
        ${outCell('Cost basis if assigned', money(breakeven), '', 'What each share effectively costs you: strike minus premium.')}
        ${outCell('Discount to current', pct(discount), discount >= 0 ? 'good' : 'bad', 'Your cost basis vs. today’s price.')}
        ${outCell('Prob. assigned', probAssigned != null && !Number.isNaN(probAssigned) ? pct(probAssigned, 0) : '—', '', '≈ delta of the put.')}
      </div>
      <div class="scenario">
        <strong>If assigned:</strong> buy ${contracts * 100} shares at ${money(strike)}
        (${money(cashRequired)}), for an effective cost of ${money(breakeven)}/share after premium —
        a ${pct(discount)} ${discount >= 0 ? 'discount to' : 'premium over'} today’s ${money(price)}.
      </div>
      ${contracts >= 1 && premium > 0 ? `
      <button class="primary-btn place-btn" id="opt-place">📈 Paper trade this cash-secured put</button>
      <div class="place-note">Sells ${contracts} put${contracts === 1 ? '' : 's'} at ${money(premium)}/share. Simulated.</div>` : ''}`;
  }
  const optBtn = document.getElementById('opt-place');
  if (optBtn) optBtn.addEventListener('click', placeOptionPaper);
  drawPayoff();
}

function drawPayoff() {
  const el = document.getElementById('payoff-chart');
  if (!el || !window.charts) return;
  if (state.calcType === 'cc') {
    window.charts.payoffChart(el, {
      kind: 'cc', strike: val('cc-strike'), premium: val('cc-premium'),
      current: val('cc-price'), contracts: Math.floor(val('cc-shares') / 100),
    });
  } else {
    window.charts.payoffChart(el, {
      kind: 'csp', strike: val('csp-strike'), premium: val('csp-premium'),
      current: val('csp-price'), contracts: Math.floor(val('csp-contracts')),
    });
  }
}

function placeOptionPaper() {
  const c = contractBy(state.selected);
  if (!c) return;
  let contracts, premium, kind;
  if (state.calcType === 'cc') {
    contracts = Math.floor(val('cc-shares') / 100);
    premium = val('cc-premium');
    kind = 'covered call';
  } else {
    contracts = Math.floor(val('csp-contracts'));
    premium = val('csp-premium');
    kind = 'cash-secured put';
  }
  if (!contracts || contracts < 1) { window.alert('Need at least 1 contract.'); return; }
  placePaperOrder({
    symbol: c.occSymbol, qty: contracts, side: 'sell', type: 'limit',
    limit_price: round2(premium), time_in_force: 'day',
  }, `Sell ${contracts} ${state.symbol} ${kind}${contracts === 1 ? '' : 's'} (${c.type} $${c.strike}, exp ${c.expiration}) at ${money(premium)}/share?\n\nPaper order — simulated, no real money.`);
}

function warningHtml(flags) {
  if (!flags.length) return '';
  const parts = [];
  if (flags.includes('earnings')) parts.push('⚠️ Earnings report before expiration — expect a volatility spike.');
  if (flags.includes('dividend')) parts.push('💰 Ex-dividend before expiration — raises early-assignment risk.');
  if (flags.includes('macro') && state.expiration) {
    const names = macroInWindow(state.expiration).slice(0, 3).map((e) => `${esc(e.title)} (${e.date})`);
    parts.push(`🏛️ Macro event before expiration — ${names.join(', ')}.`);
  }
  return `<div class="calc-warning">${parts.join('<br>')}</div>`;
}

function outCell(label, value, cls = '', help = '') {
  return `
    <div class="out">
      <div class="lbl">${help ? `<span class="q" data-tip="${help}" style="cursor:help;border-bottom:1px dotted var(--muted)">${label}</span>` : label}</div>
      <div class="val ${cls}">${value}</div>
    </div>`;
}

// ---------- Events panel ----------
function renderEvents() {
  const body = $('#events-body');
  const rows = [];
  const e = state.events?.earnings;
  if (e?.date) {
    const d = daysUntil(e.date);
    const hour = e.hour === 'amc' ? 'After close' : e.hour === 'bmo' ? 'Before open' : 'Time TBD';
    rows.push(`
      <div class="event-row">
        <span class="icon">📅</span>
        <div class="main">
          <div class="title">Earnings — ${e.date}</div>
          <div class="meta">${hour}${e.epsEstimate != null ? ` · EPS est. $${num(e.epsEstimate)}` : ''}</div>
        </div>
        <div class="countdown">${d}d</div>
      </div>`);
  }
  const dv = state.events?.dividend;
  if (dv) {
    const d = daysUntil(dv.exDate);
    rows.push(`
      <div class="event-row">
        <span class="icon">💰</span>
        <div class="main">
          <div class="title">${dv.upcoming ? 'Ex-dividend' : 'Last ex-dividend'} — ${dv.exDate}</div>
          <div class="meta">$${num(dv.rate)}/share${dv.payableDate ? ` · pays ${dv.payableDate}` : ''}</div>
        </div>
        <div class="countdown">${dv.upcoming ? d + 'd' : ''}</div>
      </div>`);
  }

  // Macro events sit in the same list: they hit this position just as hard as
  // an earnings date, they just aren't attached to the ticker.
  for (const m of (state.econ?.events || []).filter((e) => e.impact === 'high' || e.source === 'manual').slice(0, 5)) {
    const d = daysUntil(m.date);
    const inWindow = state.expiration && m.date <= state.expiration;
    rows.push(`
      <div class="event-row${inWindow ? ' event-row-flag' : ''}">
        <span class="icon">🏛️</span>
        <div class="main">
          <div class="title">${esc(m.title)} — ${m.date}</div>
          <div class="meta">Market-wide${m.time ? ` · ${esc(m.time)} ET` : ''}${m.source === 'manual' ? ' · added by you' : ''}${inWindow ? ' · inside your expiration' : ''}</div>
        </div>
        <div class="countdown">${d}d</div>
      </div>`);
  }

  body.innerHTML = rows.join('') || `<div class="event-none">No scheduled earnings, dividends, or macro events found ahead.</div>`;
}

// ---------- News ----------
function renderNews(items) {
  $('#research-news').innerHTML = (items || []).map((n) => `
    <li>
      <a href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.headline)}</a>
      <div class="news-meta">${esc(n.source || '')}${n.datetime ? ' · ' + new Date(n.datetime).toLocaleDateString() : ''}</div>
    </li>`).join('') || `<li class="event-none">No recent news.</li>`;
}

// ---------- Watchlist ----------
async function loadWatchlist() {
  const { watchlist } = await api('/watchlist');
  state._watchlist = watchlist;
  renderWatchlist(watchlist);
  renderScan();
}
function renderWatchlist(items) {
  $('#watchlist-body').innerHTML = items.map((w) => `
    <li class="wl-item" data-symbol="${esc(w.symbol)}">
      <span class="wl-sym">${esc(w.symbol)}</span>
      <span class="wl-shares">${w.shares ? w.shares + ' sh' : ''}</span>
      <span class="wl-notes">${esc(w.notes || '')}</span>
      <button class="wl-remove" data-id="${w.id}" title="Remove">✕</button>
    </li>`).join('') || `<li class="event-none">No saved tickers yet.</li>`;

  $('#watchlist-body').querySelectorAll('.wl-item').forEach((li) => {
    li.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('wl-remove')) return;
      $('#search-input').value = li.dataset.symbol;
      loadSymbol(li.dataset.symbol);
    });
  });
  $('#watchlist-body').querySelectorAll('.wl-remove').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await api(`/watchlist/${btn.dataset.id}`, { method: 'DELETE' });
      loadWatchlist();
    });
  });

  // Quick chips on the empty state.
  $('#watchlist-empty').innerHTML = items.slice(0, 8)
    .map((w) => `<button class="chip" data-symbol="${w.symbol}">${w.symbol}</button>`).join('');
  $('#watchlist-empty').querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => { $('#search-input').value = chip.dataset.symbol; loadSymbol(chip.dataset.symbol); });
  });
}

// ---------- UI wiring ----------
function syncCalcToggle() {
  $('#calc-toggle').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.calc === state.calcType));
}
function showError(msg) {
  const header = $('#ticker-header');
  header.innerHTML = `<div class="error-banner">Couldn’t load ${state.symbol}: ${msg}</div>`;
}

// ---------- Symbol search (type a name, pick a ticker) ----------
let searchTimer = null;
let lastResults = [];
const searchInput = $('#search-input');
const searchResults = $('#search-results');

function hideSearch() { searchResults.classList.add('hidden'); searchResults.innerHTML = ''; lastResults = []; }

function renderSearchResults(results) {
  lastResults = results;
  if (!results.length) { hideSearch(); return; }
  searchResults.innerHTML = results.map((r) => `
    <button type="button" class="search-item" data-symbol="${esc(r.symbol)}">
      <span class="si-sym">${esc(r.symbol)}</span>
      <span class="si-desc">${esc(r.description || '')}</span>
    </button>`).join('');
  searchResults.classList.remove('hidden');
  searchResults.querySelectorAll('.search-item').forEach((b) =>
    b.addEventListener('mousedown', (e) => {
      e.preventDefault(); // fire before the input blur
      searchInput.value = b.dataset.symbol;
      hideSearch();
      loadSymbol(b.dataset.symbol);
    }));
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) { hideSearch(); return; }
  searchTimer = setTimeout(async () => {
    try {
      const { results } = await api(`/search?q=${encodeURIComponent(q)}`);
      if (searchInput.value.trim() === q) renderSearchResults(results);
    } catch { hideSearch(); }
  }, 300);
});
searchInput.addEventListener('blur', () => setTimeout(hideSearch, 150));

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const typed = searchInput.value.trim();
  // If it's a plain ticker, load it; otherwise take the first search match.
  if (/^[A-Za-z]{1,6}$/.test(typed)) {
    hideSearch();
    loadSymbol(typed);
  } else if (lastResults.length) {
    searchInput.value = lastResults[0].symbol;
    hideSearch();
    loadSymbol(lastResults[0].symbol);
  } else {
    loadSymbol(typed);
  }
});

$('#type-toggle').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    state.chainType = b.dataset.type;
    $('#type-toggle').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderChain();
    selectDefaultContract();
  });
});

$('#calc-toggle').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    state.calcType = b.dataset.calc;
    syncCalcToggle();
    // Switch chain to the matching option type too.
    state.chainType = state.calcType === 'csp' ? 'put' : 'call';
    $('#type-toggle').querySelectorAll('button').forEach((x) =>
      x.classList.toggle('active', x.dataset.type === state.chainType));
    renderChain();
    selectDefaultContract();
  });
});

$('#exp-select').addEventListener('change', (e) => {
  state.expiration = e.target.value;
  renderChain();
  selectDefaultContract();
});

$('#zone-toggle').addEventListener('click', () => {
  state.showTargetZone = !state.showTargetZone;
  $('#zone-toggle').classList.toggle('active', state.showTargetZone);
  renderChain();
});

$('#watchlist-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const symbol = $('#wl-symbol').value.trim().toUpperCase();
  if (!symbol) return;
  await api('/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      shares: parseInt($('#wl-shares').value, 10) || 0,
      notes: $('#wl-notes').value.trim(),
    }),
  });
  $('#wl-symbol').value = ''; $('#wl-shares').value = ''; $('#wl-notes').value = '';
  loadWatchlist();
});

document.addEventListener('visibilitychange', () => {
  updateRefreshTick();
  if (!document.hidden) refreshQuote(); // catch up immediately on return
});

// ---------- Analysis view ----------
async function loadAnalysis() {
  const sc = $('#scorecard');
  if (state.analysis) {
    renderScorecard(state.analysis);
    renderPlanBuilder(state.analysis);
    renderReplay();
    return;
  }
  sc.innerHTML = '<div class="loading">Analyzing price history…</div>';
  $('#plan-builder').innerHTML = '';
  try {
    const a = await api(`/analysis/${state.symbol}`);
    state.analysis = a;
    renderScorecard(a);
    renderPlanBuilder(a);
    renderReplay();
  } catch (err) {
    sc.innerHTML = `<div class="error-banner">Couldn’t analyze ${state.symbol}: ${err.message}</div>`;
  }
}

function scoreCard(title, value, sub, cls = '') {
  return `
    <div class="score-card">
      <div class="sc-title">${title}</div>
      <div class="sc-value ${cls}">${value}</div>
      <div class="sc-sub">${sub}</div>
    </div>`;
}

function renderScorecard(a) {
  const t = a.trend, m = a.momentum, v = a.volatility, l = a.levels, s = a.sentiment;
  const trendCls = t.label === 'Uptrend' ? 'good' : t.label === 'Downtrend' ? 'bad' : '';
  const rsiCls = m.label === 'Oversold' ? 'good' : m.label === 'Overbought' ? 'warn' : '';
  const sentCls = s.label === 'Positive' ? 'good' : s.label === 'Negative' ? 'bad' : '';
  const dir = m.direction || 'flat';
  const dirTxt = dir === 'rising' ? '▲ rising' : dir === 'falling' ? '▼ falling' : '▬ flat';
  const dirCls = dir === 'rising' ? 'good' : dir === 'falling' ? 'bad' : 'muted';
  const spark = window.charts ? window.charts.rsiSparkline(m.rsiSeries, dir) : '';
  const momentumCard = `
    <div class="score-card">
      <div class="sc-title">Momentum (RSI)</div>
      <div class="sc-value ${rsiCls}">${m.rsi14 != null ? m.rsi14.toFixed(0) : '—'} <span class="sc-dir ${dirCls}">${dirTxt}</span></div>
      <div class="sc-sub">${m.label}${m.rsiChange != null ? ` · ${m.rsiChange >= 0 ? '+' : ''}${m.rsiChange.toFixed(0)} over ~1 wk` : ''}</div>
      ${spark}
    </div>`;
  let crossNote = '';
  if (t.cross) {
    const g = t.cross.type === 'golden';
    crossNote = `<br><span class="${g ? 'good' : 'bad'}" style="font-weight:700">${g ? '⚡ Golden' : '🔻 Death'} cross · ${t.cross.daysAgo}d ago</span>`;
  } else if (t.regime) {
    crossNote = `<br><span class="${t.regime === 'golden' ? 'good' : 'bad'}" style="font-weight:600">${t.regime === 'golden' ? '⚡ Golden-cross regime' : '🔻 Death-cross regime'}</span>`;
  }
  $('#scorecard').innerHTML = `
    ${scoreCard('Trend', t.label,
      `${t.priceVsSma50 >= 0 ? 'Above' : 'Below'} 50-day (${money(t.sma50)}), ${t.priceVsSma200 >= 0 ? 'above' : 'below'} 200-day (${money(t.sma200)})${crossNote}`,
      trendCls)}
    ${momentumCard}
    ${scoreCard('Volatility', v.atrPct != null ? '±' + pct(v.atrPct, 1) : '—',
      v.atr14 != null ? `~${money(v.atr14)} average daily move` : '', '')}
    ${scoreCard('Support / Resistance', `${money(l.support20)} / ${money(l.resistance20)}`,
      `52-week range ${money(l.low52)} – ${money(l.high52)}`, '')}
    ${scoreCard('News sentiment', s.label,
      `${s.positiveHits}▲ / ${s.negativeHits}▼ across ${s.headlineCount} headlines`, sentCls)}`;
}

function renderPlanBuilder(a) {
  const l = a.levels, v = a.volatility;
  const cur = (id, dflt) => { const el = document.getElementById(id); return el && el.value !== '' ? el.value : dflt; };
  const style = state.entryStyle;
  const range = l.resistance20 - l.support20;
  // Style sets the default entry/target: pullback buys support, breakout buys
  // above resistance with a measured-move target.
  const def = style === 'breakout'
    ? { entry: l.resistance20, target: l.resistance20 + range }
    : { entry: l.support20, target: l.resistance20 };
  // On a style switch, reset entry/target to the new defaults; else preserve edits.
  const entry = state._resetLevels ? def.entry.toFixed(2) : cur('plan-entry', def.entry.toFixed(2));
  const target = state._resetLevels ? def.target.toFixed(2) : cur('plan-target', def.target.toFixed(2));
  state._resetLevels = false;
  const stopPct = cur('plan-stop', Math.max(2, Math.round((v.atrPct || 0.03) * 2 * 100)));
  const acct = cur('plan-account', state.settings.accountSize || 10000);
  const risk = cur('plan-risk', state.settings.riskPct || 1);
  const cap = cur('plan-capital', state.settings.accountSize || 5000);
  const mode = state.sizingMode;

  const sizingInputs = mode === 'risk'
    ? `${field('plan-account', 'Account size ($)', acct, 'The balance of the account you are trading. Save it in Settings so it pre-fills.')}
       ${field('plan-risk', 'Risk per trade (%)', risk, 'How much of the account you are willing to lose if the stop is hit. 1% is a common, conservative rule — it decides your share count.')}`
    : `${field('plan-capital', 'Capital ($)', cap, 'Dollars to deploy into this trade.')}`;

  const entryLabel = style === 'breakout' ? 'Entry (buy stop)' : 'Entry (buy limit)';
  const entryTip = style === 'breakout'
    ? 'A buy-stop above resistance — fills when the stock breaks out to a new high (buying strength). Defaults to 20-day resistance.'
    : 'A buy-limit at support — fills on a dip (buying weakness). Defaults to 20-day support.';
  const targetTip = style === 'breakout'
    ? 'Measured-move target: the prior 20-day range projected up from the breakout.'
    : 'Where you sell all or part of the position. Defaults to 20-day resistance.';

  $('#plan-builder').innerHTML = `
    <div class="toggle plan-mode" id="entry-style-toggle" role="tablist">
      <button class="${style === 'pullback' ? 'active' : ''}" data-style="pullback" type="button">Pullback · buy support</button>
      <button class="${style === 'breakout' ? 'active' : ''}" data-style="breakout" type="button">Breakout · buy resistance</button>
    </div>
    <div class="toggle plan-mode" id="sizing-toggle" role="tablist">
      <button class="${mode === 'risk' ? 'active' : ''}" data-mode="risk" type="button">Risk-based sizing</button>
      <button class="${mode === 'capital' ? 'active' : ''}" data-mode="capital" type="button">Fixed capital</button>
    </div>
    <div class="calc-inputs">
      ${field('plan-entry', entryLabel, entry, entryTip)}
      ${field('plan-target', 'Profit target', target, targetTip)}
      ${field('plan-stop', 'Trailing stop %', stopPct, 'How far below the peak the runner can fall before it sells. Defaults to ~2× the average daily move.')}
      ${sizingInputs}
    </div>
    <div class="field plan-thesis-field">
      <label><span class="q" data-tip="Why this trade, in your own words — the setup you think you're taking. Writing it before the outcome is known is what makes the later review honest: you can't quietly rewrite the reason once you know how it ended.">Why this trade? (goes in the journal)</span></label>
      <textarea id="plan-thesis" rows="2" placeholder="e.g. pullback to 20-day support, still in a golden-cross regime, RSI turning up"></textarea>
    </div>
    <div id="plan-out"></div>`;

  $('#entry-style-toggle').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { state.entryStyle = b.dataset.style; state._resetLevels = true; renderPlanBuilder(a); }));
  $('#sizing-toggle').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { state.sizingMode = b.dataset.mode; renderPlanBuilder(a); }));
  $('#plan-builder').querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', computePlan));
  const thesisEl = $('#plan-thesis');
  thesisEl.value = state.planThesis || '';
  thesisEl.addEventListener('input', () => { state.planThesis = thesisEl.value; });
  computePlan();
  drawPriceChart();
}

function drawPriceChart() {
  if (!state.analysis || !window.charts) return;
  const el = document.getElementById('price-chart');
  if (!el) return;
  const entry = val('plan-entry');
  const stopPct = val('plan-stop');
  window.charts.priceChart(el, {
    series: state.analysis.series,
    entry,
    target: val('plan-target'),
    stop: Number.isFinite(entry) && Number.isFinite(stopPct) ? entry * (1 - stopPct / 100) : null,
    current: state.analysis.price,
  });
}

function computePlan() {
  const out = $('#plan-out');
  if (!out) return;
  const entry = val('plan-entry'), target = val('plan-target'), stopPct = val('plan-stop');
  const stopPrice = entry * (1 - stopPct / 100);
  const breakout = state.entryStyle === 'breakout';
  const riskPS = entry - stopPrice;
  const rewardPS = target - entry;
  const rr = riskPS > 0 ? rewardPS / riskPS : null;
  const toTarget = (target - entry) / entry;
  const good = rr != null && rr >= 2;

  // Size the position — either by risk budget, or by a fixed dollar amount.
  const mode = state.sizingMode;
  let shares = 0, capital = 0, accountSize = null, cappedByCash = false;
  if (mode === 'risk') {
    accountSize = val('plan-account');
    const riskPct = val('plan-risk');
    const riskBudget = accountSize * riskPct / 100;
    shares = riskPS > 0 ? Math.floor(riskBudget / riskPS) : 0;
    const maxByCash = entry > 0 ? Math.floor(accountSize / entry) : 0;
    if (shares > maxByCash) { shares = maxByCash; cappedByCash = true; }
  } else {
    capital = val('plan-capital');
    shares = entry > 0 ? Math.floor(capital / entry) || 0 : 0;
  }
  capital = shares * entry;
  const dollarRisk = riskPS * shares;
  const pctOfAcct = accountSize ? dollarRisk / accountSize : null;

  out.innerHTML = `
    ${cappedByCash ? '<div class="calc-warning">⚠️ Sized down to fit your cash — at that risk %, the full size would cost more than the account holds.</div>' : ''}
    <div class="headline-return" style="background:${good ? 'var(--good-soft)' : 'var(--surface-alt)'}">
      <div class="big" style="color:${good ? 'var(--good)' : 'var(--text)'}">${rr != null ? rr.toFixed(2) + ' : 1' : '—'}</div>
      <div class="lbl">Reward-to-risk ratio</div>
    </div>
    <div class="outputs">
      ${outCell('Shares', shares)}
      ${outCell('Capital deployed', money(capital))}
      ${outCell('Stop price', money(stopPrice), '', 'Entry minus the trailing-stop %.')}
      ${outCell('$ at risk', money(dollarRisk), 'bad', 'The most you lose if the stop is hit.')}
      ${mode === 'risk'
        ? outCell('% of account at risk', pctOfAcct != null ? pct(pctOfAcct) : '—', pctOfAcct != null && pctOfAcct > 0.02 ? 'bad' : 'good', 'Keep this small — 1–2% per trade is the discipline that protects capital you can’t replace.')
        : outCell('Reward / share', money(rewardPS), rewardPS >= 0 ? 'good' : 'bad')}
      ${outCell('$ at target', money(rewardPS * shares), 'good', 'Gain if the target is hit on the full position.')}
      ${outCell('% to target', pct(toTarget))}
      ${outCell('% to stop', pct(-stopPct / 100))}
    </div>
    <div class="scenario">
      <strong>Plan:</strong> ${breakout
        ? `set a buy-stop at ${money(entry)} — fills on a breakout above resistance`
        : `set a buy-limit at ${money(entry)} — fills on a dip to support`} (${shares} share${shares === 1 ? '' : 's'}, ${money(capital)}). Sell part at
      ${money(target)} (+${pct(toTarget)}), then trail the rest with a ${stopPct}% stop. Max loss ${money(dollarRisk)}${pctOfAcct != null ? ` — ${pct(pctOfAcct)} of the account` : ''}.
      ${breakout ? '' : `<br><span style="color:var(--muted)">Prefer to get <em>paid</em> to buy near ${money(entry)}? Switch to the Options tab and sell a cash-secured put around that strike.</span>`}
    </div>
    ${shares >= 1 && rr != null && state.symbol ? `
      <div class="plan-buttons">
        <button class="primary-btn place-btn" id="plan-place">📈 Place as paper bracket order</button>
        <button class="ghost-btn" id="plan-log" type="button" data-tip="Records the plan without placing anything — for a setup you've decided to pass on, or one you want to watch. Logging the trades you skip is half the lesson.">📓 Log to journal only</button>
      </div>
      <div class="place-note">${breakout ? 'Buy-stop' : 'Buy-limit'} ${shares} ${state.symbol}, take-profit ${money(target)}, stop ${money(stopPrice)}. Simulated — no real money. Placing it also writes the plan to your journal.</div>` : ''}`;
  const plan = { entry: round2(entry), target: round2(target), stopPrice: round2(stopPrice),
                 shares, riskPS: round2(riskPS), dollarRisk: round2(dollarRisk),
                 rr: rr != null ? round2(rr) : null };
  const btn = document.getElementById('plan-place');
  if (btn) {
    const entryOrder = breakout
      ? { type: 'stop', stop_price: round2(entry) }
      : { type: 'limit', limit_price: round2(entry) };
    btn.addEventListener('click', () => placePaperOrder({
      symbol: state.symbol, qty: shares, side: 'buy', ...entryOrder,
      time_in_force: 'gtc', order_class: 'bracket',
      take_profit: { limit_price: round2(target) },
      stop_loss: { stop_price: round2(stopPrice) },
    }, `Place a paper BRACKET order (${breakout ? 'buy-stop breakout' : 'buy-limit pullback'}):\n\nBuy ${shares} ${state.symbol} at ${money(entry)}\nTake-profit: ${money(target)}\nStop: ${money(stopPrice)}\nMax loss: ${money(dollarRisk)}\n\nProceed? (simulated, no real money)`,
      planPayload(plan)));
  }
  const logBtn = document.getElementById('plan-log');
  if (logBtn) logBtn.addEventListener('click', () => logTrade(planPayload(plan)));
  drawPriceChart();
}

const round2 = (n) => Number(Number(n).toFixed(2));

function renderReplay() {
  const start = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  $('#replay-body').innerHTML = `
    <div class="replay-controls">
      <div class="field" style="max-width:190px">
        <label><span class="q" data-tip="The date you would have set the plan up. The replay walks daily bars forward from here.">Start date</span></label>
        <input id="replay-date" type="date" value="${start}" />
      </div>
      <button class="primary-btn" id="replay-run" type="button">▶ Run replay</button>
    </div>
    <p class="hint" style="margin:0 0 8px">Sets entry/target/stop from your system's rules (20-day support/resistance, ATR stop) as of the start date — a true, lookahead-free backtest. Uses your current sizing mode.</p>
    <div id="replay-result"></div>`;
  $('#replay-run').addEventListener('click', runReplayUI);
}

async function runReplayUI() {
  const startDate = $('#replay-date').value;
  const out = $('#replay-result');
  out.innerHTML = '<div class="loading">Replaying with system levels as of that date…</div>';
  const body = { startDate, mode: state.sizingMode, entryStyle: state.entryStyle };
  if (state.sizingMode === 'risk') {
    body.accountSize = val('plan-account');
    body.riskPct = val('plan-risk');
  } else {
    body.capital = val('plan-capital');
  }
  try {
    const r = await api(`/replay/${state.symbol}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    renderReplayResult(r);
  } catch (err) {
    out.innerHTML = `<div class="error-banner">${esc(err.message)}</div>`;
  }
}

function renderReplayResult(r) {
  const out = $('#replay-result');
  const levelsLine = `<div class="replay-levels">${r.style === 'breakout' ? 'Breakout' : 'Pullback'} plan <strong>as of ${r.asOf}</strong>: buy <strong>${money(r.entry)}</strong> · target <strong>${money(r.target)}</strong> · stop <strong>${money(r.stop)}</strong> · ${r.shares} shares</div>`;
  const logBtn = `<button class="ghost-btn" id="replay-log" type="button" data-tip="Files this replay in your journal as one rep. Thirty of these gives you your system's real win rate, average R, and worst losing streak — the numbers that tell you whether to trust it when money is on the line.">📓 Log this rep to the journal</button>`;
  if (r.outcome === 'no_fill') {
    out.innerHTML = `${levelsLine}<div class="replay-outcome">⚪ No fill</div><p class="hint">${esc(r.message)}</p>
      <div class="plan-buttons">${logBtn}</div>
      <p class="hint">Worth logging: a setup that never triggered is a real outcome, and a system that rarely fills is telling you something.</p>`;
    wireReplayLog(r);
    return;
  }
  const map = {
    target: { cls: 'good', icon: '🎯', label: 'Target hit' },
    stopped: { cls: 'bad', icon: '🛑', label: 'Stopped out' },
    open: { cls: '', icon: '⏳', label: 'Still open (marked to last close)' },
  };
  const m = map[r.outcome] || {};
  const pnlCls = r.pnl >= 0 ? 'good' : 'bad';
  out.innerHTML = `
    ${levelsLine}
    <div class="replay-outcome ${m.cls}">${m.icon} ${m.label}</div>
    <div class="outputs">
      ${outCell('Filled at', `${money(r.entryPrice)} · ${r.entryDate}`)}
      ${outCell('Exit', `${money(r.exitPrice)} · ${r.exitDate}`)}
      ${outCell('Days held', r.daysHeld)}
      ${outCell('Shares', r.shares)}
      ${outCell('P&L', `${r.pnl >= 0 ? '+' : ''}${money(r.pnl)}`, pnlCls)}
      ${outCell('Return', pct(r.pnlPct), pnlCls)}
      ${outCell('R multiple', r.rMultiple != null ? r.rMultiple.toFixed(2) + 'R' : '—', r.rMultiple >= 0 ? 'good' : 'bad', 'Multiples of your planned risk. +2R means you made twice what you risked.')}
      ${outCell('', '')}
    </div>
    <div id="replay-chart" class="chart-box"></div>
    <div class="plan-buttons">${logBtn}</div>
    <p class="hint">Entry, target, and stop are set from the 20-day support/resistance and ATR stop <strong>as of ${r.asOf}</strong> — using only data up to that day, so there's no lookahead.</p>`;
  if (window.charts) window.charts.replayChart(document.getElementById('replay-chart'), r);
  wireReplayLog(r);
}

// A replay is the system run mechanically, so it's logged as having followed
// the rules by definition. That makes the replay set your baseline: what the
// system does when nobody second-guesses it. Every live trade you grade later
// gets measured against it.
function wireReplayLog(r) {
  const btn = document.getElementById('replay-log');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const riskPS = r.entry != null && r.stop != null ? round2(r.entry - r.stop) : null;
    const status = r.outcome === 'open' ? 'open' : 'closed';
    const saved = await logTrade({
      symbol: r.symbol,
      kind: 'stock',
      source: 'replay',
      status,
      entry_style: r.style || state.entryStyle,
      entry: r.entry, target: r.target, stop: r.stop, shares: r.shares,
      risk_per_share: riskPS,
      planned_risk: riskPS != null && r.shares ? round2(riskPS * r.shares) : null,
      reward_risk: riskPS ? round2((r.target - r.entry) / riskPS) : null,
      thesis: `Replay of the ${r.style === 'breakout' ? 'breakout' : 'pullback'} rule with levels as of ${r.asOf}.`,
      entry_price: r.entryPrice ?? null,
      exit_price: r.outcome === 'open' ? null : (r.exitPrice ?? null),
      entry_date: r.entryDate ?? null,
      exit_date: r.outcome === 'open' ? null : (r.exitDate ?? null),
      outcome: r.outcome === 'open' ? null : r.outcome,
      followed_rules: true, // mechanical by construction
    }, { announce: false });
    if (saved) {
      btn.textContent = '✓ Logged';
      btn.disabled = true;
    }
  });
}

function switchView(v) {
  state.view = v;
  $('#view-toggle').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === v));
  $('#planner-view').classList.toggle('hidden', v !== 'planner');
  $('#analysis-view').classList.toggle('hidden', v !== 'analysis');
  $('#paper-view').classList.toggle('hidden', v !== 'paper');
  $('#journal-view').classList.toggle('hidden', v !== 'journal');
  $('#backtest-view').classList.toggle('hidden', v !== 'backtest');
  if (v === 'analysis' && state.symbol) loadAnalysis();
  if (v === 'paper') loadPaper();
  if (v === 'journal') loadJournal();
  if (v === 'backtest') renderBacktestControls();
}

$('#view-toggle').querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view)));

// Open the Paper account directly — works from the home page too, since it's
// portfolio-level (not tied to a loaded ticker).
function openPaper() {
  const hasSymbol = Boolean(state.symbol);
  $('#empty-state').classList.add('hidden');
  $('#scan-panel').classList.add('hidden');
  $('#regime-panel').classList.add('hidden');
  $('#macro-panel').classList.add('hidden');
  $('#content').classList.remove('hidden');
  $('#ticker-header').classList.toggle('hidden', !hasSymbol);
  $('#view-toggle').classList.toggle('hidden', !hasSymbol);
  $('#planner-view').classList.add('hidden');
  $('#analysis-view').classList.add('hidden');
  $('#journal-view').classList.add('hidden');
  $('#backtest-view').classList.add('hidden');
  $('#paper-view').classList.remove('hidden');
  state.view = 'paper';
  if (hasSymbol) {
    $('#view-toggle').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === 'paper'));
  }
  loadPaper();
}
$('#paper-btn').addEventListener('click', openPaper);

// ---------- Paper trading ----------
async function loadPaper() {
  $('#paper-account').innerHTML = '<div class="loading">Loading paper account…</div>';
  $('#paper-positions').innerHTML = '';
  $('#paper-orders').innerHTML = '';
  try {
    const [account, pos, ord] = await Promise.all([
      api('/paper/account'),
      api('/paper/positions'),
      api('/paper/orders?status=open'),
    ]);
    renderPaperAccount(account);
    renderPaperPositions(pos.positions);
    renderPaperOrders(ord.orders);
  } catch (err) {
    $('#paper-account').innerHTML = `<div class="error-banner">Paper account error: ${esc(err.message)}</div>`;
  }
}

function renderPaperAccount(a) {
  const pl = Number(a.portfolio_value) - Number(a.last_equity);
  const plCls = pl >= 0 ? 'good' : 'bad';
  $('#paper-account').innerHTML = `
    ${scoreCard('Portfolio value', money(Number(a.portfolio_value)), 'Cash + positions')}
    ${scoreCard('Cash', money(Number(a.cash)), 'Available to trade')}
    ${scoreCard('Buying power', money(Number(a.buying_power)), 'Incl. margin')}
    ${scoreCard('Day P&L', (pl >= 0 ? '+' : '') + money(pl), 'Since prior close', plCls)}`;
}

function renderPaperPositions(positions) {
  if (!positions.length) {
    $('#paper-positions').innerHTML = '<div class="event-none">No open positions. Place a trade from the Research or Options tab.</div>';
    return;
  }
  const rows = positions.map((p) => {
    const pl = Number(p.unrealized_pl);
    const plp = Number(p.unrealized_plpc) * 100;
    const cls = pl >= 0 ? 'good' : 'bad';
    return `
      <tr>
        <td>${esc(p.symbol)}</td>
        <td>${p.qty}</td>
        <td>${money(Number(p.avg_entry_price))}</td>
        <td>${money(Number(p.current_price))}</td>
        <td class="${cls}">${pl >= 0 ? '+' : ''}${money(pl)} (${plp.toFixed(1)}%)</td>
        <td><button class="ghost-btn sm" data-close="${esc(p.symbol)}">Close</button></td>
      </tr>`;
  }).join('');
  $('#paper-positions').innerHTML = `
    <div class="chain-scroll"><table class="chain-table paper-table">
      <thead><tr><th>Symbol</th><th>Qty</th><th>Avg entry</th><th>Current</th><th>Unrealized P&L</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  $('#paper-positions').querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => closePaperPosition(btn.dataset.close)));
}

function renderPaperOrders(orders) {
  if (!orders.length) {
    $('#paper-orders').innerHTML = '<div class="event-none">No open orders.</div>';
    return;
  }
  const rows = orders.map((o) => `
    <tr>
      <td>${esc(o.symbol)}</td>
      <td>${o.side}</td>
      <td>${o.type}${o.order_class && o.order_class !== 'simple' ? ' · ' + o.order_class : ''}</td>
      <td>${o.qty}</td>
      <td>${o.limit_price ? money(Number(o.limit_price)) : (o.stop_price ? 'stop ' + money(Number(o.stop_price)) : o.type)}</td>
      <td>${esc(o.status)}</td>
      <td><button class="ghost-btn sm" data-cancel="${esc(o.id)}">Cancel</button></td>
    </tr>`).join('');
  $('#paper-orders').innerHTML = `
    <div class="chain-scroll"><table class="chain-table paper-table">
      <thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  $('#paper-orders').querySelectorAll('[data-cancel]').forEach((btn) =>
    btn.addEventListener('click', () => cancelPaperOrder(btn.dataset.cancel)));
}

async function placePaperOrder(order, confirmMsg, journalPayload) {
  if (!window.confirm(confirmMsg)) return;
  try {
    const { order: placed } = await api('/paper/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
    // Every order you place gets journaled — no opt-out. The trades that
    // never make it into the record are exactly the ones worth reviewing.
    if (journalPayload) {
      await logTrade({ ...journalPayload, order_id: placed?.id || '' }, { announce: false });
    }
    switchView('paper'); // jump to the paper view and refresh
    window.alert(journalPayload
      ? 'Paper order placed — and logged to your journal.'
      : 'Paper order placed.');
  } catch (err) {
    window.alert('Order rejected: ' + err.message);
  }
}

async function cancelPaperOrder(id) {
  try { await api(`/paper/order/${id}`, { method: 'DELETE' }); loadPaper(); }
  catch (err) { window.alert('Cancel failed: ' + err.message); }
}

async function closePaperPosition(symbol) {
  if (!window.confirm(`Close your entire ${symbol} paper position at market?`)) return;
  try { await api(`/paper/close/${encodeURIComponent(symbol)}`, { method: 'POST' }); loadPaper(); }
  catch (err) { window.alert('Close failed: ' + err.message); }
}

$('#paper-refresh').addEventListener('click', loadPaper);

// ---------- Trade journal ----------
// The feedback loop. A plan you don't write down can't teach you anything:
// you remember the winners, forget the rule-breaks, and after a year you have
// a hundred trades and no lesson. One row per decision fixes that.

function openJournal() {
  const hasSymbol = Boolean(state.symbol);
  $('#empty-state').classList.add('hidden');
  $('#scan-panel').classList.add('hidden');
  $('#regime-panel').classList.add('hidden');
  $('#macro-panel').classList.add('hidden');
  $('#content').classList.remove('hidden');
  $('#ticker-header').classList.toggle('hidden', !hasSymbol);
  $('#view-toggle').classList.toggle('hidden', !hasSymbol);
  $('#planner-view').classList.add('hidden');
  $('#analysis-view').classList.add('hidden');
  $('#paper-view').classList.add('hidden');
  $('#backtest-view').classList.add('hidden');
  $('#journal-view').classList.remove('hidden');
  state.view = 'journal';
  if (hasSymbol) {
    $('#view-toggle').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === 'journal'));
  }
  loadJournal();
}

async function loadJournal() {
  const list = $('#journal-list');
  list.innerHTML = '<div class="loading">Loading your journal…</div>';
  const qs = new URLSearchParams();
  if (state.journalStatus) qs.set('status', state.journalStatus);
  if (state.journalSymbol) qs.set('symbol', state.journalSymbol);
  try {
    const [{ trades }, stats] = await Promise.all([
      api(`/journal${qs.toString() ? '?' + qs : ''}`),
      api('/journal/stats'),
    ]);
    state.journalTrades = trades;
    renderJournalStats(stats);
    renderJournalInsight(stats);
    renderJournalSymbols(trades);
    renderJournalList(trades);
  } catch (err) {
    list.innerHTML = `<div class="error-banner">Couldn’t load the journal: ${esc(err.message)}</div>`;
  }
}

function renderJournalStats(s) {
  const r = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R');
  const expectancyCls = s.avgR == null ? '' : s.avgR > 0 ? 'good' : 'bad';
  const discCls = s.disciplineRate == null ? '' : s.disciplineRate >= 0.8 ? 'good' : 'warn';
  $('#journal-stats').innerHTML = `
    ${scoreCard('Trades logged', s.total,
      `${s.planned} planned · ${s.open} open · ${s.closed} closed`)}
    ${scoreCard('Win rate', s.winRate != null ? pct(s.winRate, 0) : '—',
      s.scored ? `${s.wins}W / ${s.losses}L across ${s.scored} scored` : 'No closed trades yet')}
    ${scoreCard('Expectancy', r(s.avgR),
      s.scored ? `Average result per trade · ${r(s.totalR)} total` : 'The number that decides if the system pays', expectancyCls)}
    ${scoreCard('Discipline', s.disciplineRate != null ? pct(s.disciplineRate, 0) : '—',
      s.reviewed ? `Followed your rules on ${s.followedCount} of ${s.reviewed} reviewed` : 'Grade a closed trade to start', discCls)}
    ${scoreCard('Avg win / loss', `${r(s.avgWinR)} / ${r(s.avgLossR)}`,
      'A system can win 40% of the time and still pay, if the wins are bigger')}
    ${scoreCard('Worst losing streak', s.worstLossStreak || '—',
      'What a normal bad patch looks like — before you live through one')}`;
}

// The comparison the journal exists to produce: your results when you ran the
// system versus when you overrode it. Most people never measure this, which is
// exactly why they keep overriding it.
function renderJournalInsight(s) {
  const el = $('#journal-insight');
  if (!el) return;
  if (s.followedCount < 3 || s.brokeCount < 3 || s.avgRFollowed == null || s.avgRBroke == null) {
    el.innerHTML = '';
    return;
  }
  const diff = s.avgRFollowed - s.avgRBroke;
  const better = diff > 0;
  el.innerHTML = `
    <div class="journal-insight ${better ? 'good-box' : 'warn-box'}">
      <strong>${better ? '📐 Your rules are beating your instincts.' : '🤔 Your overrides are outperforming your rules.'}</strong>
      Trades where you followed the system averaged
      <strong>${s.avgRFollowed >= 0 ? '+' : ''}${s.avgRFollowed.toFixed(2)}R</strong> (${s.followedCount} trades);
      trades where you broke it averaged
      <strong>${s.avgRBroke >= 0 ? '+' : ''}${s.avgRBroke.toFixed(2)}R</strong> (${s.brokeCount}).
      ${better
        ? 'The discipline is worth real money — protect it.'
        : 'Worth a look: either the overrides are a skill worth writing into the rules, or the sample is still too small to trust. Keep logging before you change anything.'}
    </div>`;
}

function renderJournalSymbols(trades) {
  const sel = $('#journal-symbol-filter');
  const symbols = [...new Set((state.journalAllSymbols || []).concat(trades.map((t) => t.symbol)))].sort();
  state.journalAllSymbols = symbols;
  sel.innerHTML = '<option value="">All symbols</option>' +
    symbols.map((s) => `<option value="${esc(s)}" ${s === state.journalSymbol ? 'selected' : ''}>${esc(s)}</option>`).join('');
}

const OUTCOME_META = {
  target: { icon: '🎯', label: 'Target hit', cls: 'good' },
  stopped: { icon: '🛑', label: 'Stopped out', cls: 'bad' },
  manual: { icon: '✋', label: 'Closed by hand', cls: '' },
  time: { icon: '⏱', label: 'Time stop', cls: '' },
  no_fill: { icon: '⚪', label: 'Never filled', cls: 'muted' },
};

function renderJournalList(trades) {
  const list = $('#journal-list');
  if (!trades.length) {
    list.innerHTML = `<div class="event-none">Nothing logged yet. Build a plan in
      <strong>🔍 Research</strong> and hit <strong>📓 Log to journal</strong>, or run a
      <strong>Historical Replay</strong> and log the result — replays are the fastest way to
      put thirty reps on the board.</div>`;
    return;
  }
  list.innerHTML = trades.map(journalCard).join('');
  list.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = Number(b.dataset.toggle);
      if (state.journalOpen.has(id)) state.journalOpen.delete(id);
      else state.journalOpen.add(id);
      renderJournalList(state.journalTrades);
    }));
  list.querySelectorAll('[data-save]').forEach((b) =>
    b.addEventListener('click', () => saveJournalReview(Number(b.dataset.save))));
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteJournalTrade(Number(b.dataset.del))));
  list.querySelectorAll('[data-rules]').forEach((b) =>
    b.addEventListener('click', () => {
      const wrap = b.closest('.rules-toggle');
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      wrap.dataset.value = b.dataset.rules;
    }));
}

function journalCard(t) {
  const open = state.journalOpen.has(t.id);
  const om = OUTCOME_META[t.outcome] || {};
  const rCls = t.r_multiple == null ? '' : t.r_multiple > 0 ? 'good' : 'bad';
  const statusCls = t.status === 'closed' ? 'muted' : t.status === 'open' ? 'good' : '';

  const planLine = t.entry != null
    ? `buy <strong>${money(t.entry)}</strong>${t.target != null ? ` → target <strong>${money(t.target)}</strong>` : ''}${t.stop != null ? ` · stop <strong>${money(t.stop)}</strong>` : ''}${t.shares ? ` · ${t.shares} sh` : ''}${t.reward_risk != null ? ` · ${t.reward_risk.toFixed(1)}:1` : ''}`
    : '<span class="muted">No levels recorded</span>';

  const outcomeLine = t.status === 'closed'
    ? `<div class="journal-outcome">
         <span class="${om.cls || ''}">${om.icon || ''} ${om.label || t.outcome || 'Closed'}</span>
         ${t.pnl != null ? `<span class="${t.pnl >= 0 ? 'good' : 'bad'}">${t.pnl >= 0 ? '+' : ''}${money(t.pnl)}</span>` : ''}
         ${t.r_multiple != null ? `<span class="${rCls}"><strong>${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(2)}R</strong></span>` : ''}
         ${t.followed_rules === 1 ? '<span class="badge good-box">✅ followed the rules</span>'
           : t.followed_rules === 0 ? '<span class="badge warn-box">⚠️ broke the rules</span>'
           : '<span class="badge">not graded yet</span>'}
       </div>`
    : '';

  return `
    <div class="journal-card${t.followed_rules === 0 ? ' broke' : ''}">
      <div class="journal-head">
        <div>
          <strong class="journal-sym">${esc(t.symbol)}</strong>
          <span class="badge">${esc(t.status)}</span>
          ${t.entry_style ? `<span class="badge">${esc(t.entry_style)}</span>` : ''}
          ${t.source !== 'paper' ? `<span class="badge">${esc(t.source)}</span>` : ''}
        </div>
        <span class="journal-date ${statusCls}" data-tip="${t.entry_date ? 'Date the trade was entered' : 'Date the plan was logged'}">${esc((t.entry_date || t.planned_at || '').slice(0, 10))}</span>
      </div>
      <div class="journal-plan">${planLine}</div>
      ${t.thesis ? `<div class="journal-thesis">“${esc(t.thesis)}”</div>` : ''}
      ${outcomeLine}
      ${t.lesson ? `<div class="journal-lesson">📝 ${esc(t.lesson)}</div>` : ''}
      <div class="journal-actions">
        <button class="ghost-btn sm" data-toggle="${t.id}">${open ? 'Close' : t.status === 'closed' ? 'Edit review' : 'Review / record outcome'}</button>
        <button class="ghost-btn sm" data-del="${t.id}">Delete</button>
      </div>
      ${open ? journalReviewForm(t) : ''}
    </div>`;
}

function journalReviewForm(t) {
  const v = (x) => (x == null ? '' : x);
  const opt = (val, label, cur) => `<option value="${val}" ${cur === val ? 'selected' : ''}>${label}</option>`;
  return `
    <div class="journal-review" data-form="${t.id}">
      <div class="calc-inputs">
        <div class="field"><label>Status</label>
          <select id="jr-status-${t.id}">
            ${opt('planned', 'Planned — not filled yet', t.status)}
            ${opt('open', 'Open — filled, still running', t.status)}
            ${opt('closed', 'Closed — done', t.status)}
          </select></div>
        <div class="field"><label>Outcome</label>
          <select id="jr-outcome-${t.id}">
            ${opt('', '—', t.outcome || '')}
            ${opt('target', '🎯 Target hit', t.outcome)}
            ${opt('stopped', '🛑 Stopped out', t.outcome)}
            ${opt('manual', '✋ Closed by hand', t.outcome)}
            ${opt('time', '⏱ Time stop — held too long', t.outcome)}
            ${opt('no_fill', '⚪ Never filled', t.outcome)}
          </select></div>
        <div class="field"><label>Fill price</label>
          <input id="jr-entry-${t.id}" type="number" step="0.01" value="${v(t.entry_price)}" /></div>
        <div class="field"><label>Exit price</label>
          <input id="jr-exit-${t.id}" type="number" step="0.01" value="${v(t.exit_price)}" /></div>
        <div class="field"><label>Fill date</label>
          <input id="jr-edate-${t.id}" type="date" value="${v(t.entry_date)}" /></div>
        <div class="field"><label>Exit date</label>
          <input id="jr-xdate-${t.id}" type="date" value="${v(t.exit_date)}" /></div>
      </div>
      <div class="field">
        <label><span class="q" data-tip="The only grade that matters while you're learning. Did you take the entry you planned, at the size you planned, and let the exits do their job? A loss that followed the plan is a PASS. A win you chased is a FAIL.">Did you follow your rules?</span></label>
        <div class="toggle rules-toggle" data-value="${t.followed_rules == null ? '' : t.followed_rules}">
          <button type="button" class="${t.followed_rules === 1 ? 'active' : ''}" data-rules="1">✅ Yes</button>
          <button type="button" class="${t.followed_rules === 0 ? 'active' : ''}" data-rules="0">⚠️ No</button>
        </div>
      </div>
      <div class="field">
        <label><span class="q" data-tip="One sentence. What would you tell yourself before the next trade like this one?">Lesson</span></label>
        <textarea id="jr-lesson-${t.id}" rows="2" placeholder="One sentence — what would you tell yourself before the next one?">${esc(v(t.lesson))}</textarea>
      </div>
      <button class="primary-btn" data-save="${t.id}">Save review</button>
      <p class="hint">P&amp;L and R are worked out from the plan you committed to — fill price, exit price, and the stop you set.</p>
    </div>`;
}

async function saveJournalReview(id) {
  const g = (p) => document.getElementById(`jr-${p}-${id}`);
  const rules = document.querySelector(`[data-form="${id}"] .rules-toggle`)?.dataset.value;
  const body = {
    status: g('status').value,
    outcome: g('outcome').value,
    entry_price: g('entry').value,
    exit_price: g('exit').value,
    entry_date: g('edate').value,
    exit_date: g('xdate').value,
    lesson: g('lesson').value,
  };
  if (rules === '0' || rules === '1') body.followed_rules = rules === '1';
  try {
    await api(`/journal/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    state.journalOpen.delete(id);
    loadJournal();
  } catch (err) {
    window.alert('Couldn’t save the review: ' + err.message);
  }
}

async function deleteJournalTrade(id) {
  if (!window.confirm('Delete this journal entry? The record is the whole point — only delete mistakes.')) return;
  try { await api(`/journal/${id}`, { method: 'DELETE' }); state.journalOpen.delete(id); loadJournal(); }
  catch (err) { window.alert('Delete failed: ' + err.message); }
}

// Write a plan into the journal. Called both when a plan is placed as a paper
// order and when it's logged on its own.
async function logTrade(payload, { announce = true } = {}) {
  try {
    const { trade } = await api('/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (announce) window.alert(`Logged ${trade.symbol} to your journal. Record the outcome there when it's done.`);
    return trade;
  } catch (err) {
    window.alert('Couldn’t log to the journal: ' + err.message);
    return null;
  }
}

// The plan currently in the builder, shaped for the journal.
function planPayload({ entry, target, stopPrice, shares, riskPS, dollarRisk, rr }) {
  const a = state.analysis;
  return {
    symbol: state.symbol,
    kind: 'stock',
    source: 'paper',
    status: 'planned',
    entry_style: state.entryStyle,
    entry, target, stop: stopPrice, shares,
    risk_per_share: riskPS,
    planned_risk: dollarRisk,
    reward_risk: rr,
    thesis: (document.getElementById('plan-thesis')?.value || '').trim(),
    ctx_price: a?.price ?? null,
    ctx_trend: a?.trend?.label ?? '',
    ctx_regime: a?.trend?.regime ?? '',
    ctx_rsi: a?.momentum?.rsi14 ?? null,
  };
}

$('#journal-btn').addEventListener('click', openJournal);
$('#journal-refresh').addEventListener('click', loadJournal);
$('#journal-status-filter').addEventListener('change', (e) => {
  state.journalStatus = e.target.value;
  loadJournal();
});
$('#journal-symbol-filter').addEventListener('change', (e) => {
  state.journalSymbol = e.target.value;
  loadJournal();
});

// ---------- System backtest ----------
// One replay is an anecdote. This runs the system across every symbol you pick,
// one trade after another, over years — and then splits the results up, because
// the headline number hides the places where a system actually breaks down.

function openBacktest() {
  const hasSymbol = Boolean(state.symbol);
  $('#empty-state').classList.add('hidden');
  $('#scan-panel').classList.add('hidden');
  $('#regime-panel').classList.add('hidden');
  $('#macro-panel').classList.add('hidden');
  $('#content').classList.remove('hidden');
  $('#ticker-header').classList.toggle('hidden', !hasSymbol);
  $('#view-toggle').classList.toggle('hidden', !hasSymbol);
  $('#planner-view').classList.add('hidden');
  $('#analysis-view').classList.add('hidden');
  $('#paper-view').classList.add('hidden');
  $('#journal-view').classList.add('hidden');
  $('#backtest-view').classList.remove('hidden');
  state.view = 'backtest';
  if (hasSymbol) {
    $('#view-toggle').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === 'backtest'));
  }
  renderBacktestControls();
}

function renderBacktestControls() {
  const el = $('#backtest-controls');
  if (el.dataset.ready) return; // keep whatever the user typed
  const watch = (state._watchlist || []).map((w) => w.symbol);
  const symbols = state.backtestSymbols
    || (watch.length ? watch.join(', ') : (state.symbol || ''));
  el.dataset.ready = '1';
  el.innerHTML = `
    <div class="toggle plan-mode" id="bt-style-toggle" role="tablist">
      <button class="active" data-style="pullback" type="button">Pullback · buy support</button>
      <button data-style="breakout" type="button">Breakout · buy resistance</button>
    </div>
    <div class="toggle plan-mode" id="bt-filter-toggle" role="tablist">
      <button class="${state.backtestAbove200 ? '' : 'active'}" data-above="0" type="button"
        data-tip="Rule 2 as written: the 50-day above the 200-day is enough. This lets a name through even when price has already dropped below both averages.">Regime only</button>
      <button class="${state.backtestAbove200 ? 'active' : ''}" data-above="1" type="button"
        data-tip="The stricter reading: the regime filter AND price above the 200-day at the moment of the decision. Fewer trades, and it never buys a name that has already broken down.">Regime + above 200-day</button>
    </div>
    <div class="field">
      <label><span class="q" data-tip="Comma-separated tickers. Defaults to your watchlist — the universe your system actually trades. Up to 25.">Symbols</span></label>
      <textarea id="bt-symbols" rows="2" placeholder="AAPL, MSFT, COST">${esc(symbols)}</textarea>
    </div>
    <div class="calc-inputs">
      ${field('bt-years', 'Years of history', state.backtestYears || 5, 'How far back to run. More years means more trades and more market conditions — including ones you would rather not have traded through.')}
      ${field('bt-account', 'Account size ($)', state.settings.accountSize || 60000, 'Only affects share counts and dollar P&L. Results in R are unaffected by it.')}
      ${field('bt-risk', 'Risk per trade (%)', state.settings.riskPct || 0.5, "Your system's sizing rule.")}
      ${field('bt-wait', 'Days to leave an order resting', state.backtestWait || 20, 'How long a buy order waits before the level it was based on is stale and gets re-derived. A rule the plan builder never made you state — the backtest forces the question.')}
      ${field('bt-maxhold', 'Time stop — days to hold (0 = none)', state.backtestMaxHold ?? 0, 'An optional clock on an open position. 0 is the system as written: you exit only at the target or the stop, however long that takes. A clock frees up cash from dead trades, but it can also cut short the few long winners that pay for all the losers — run it both ways and let the numbers decide.')}
      ${field('bt-validation', 'Validation window (months)', state.backtestValidation ?? 12, 'A middle slice you can check changes against as often as you like. Set to 0 if you would rather keep all the older data for development.')}
      ${field('bt-holdout', 'Months held back (out-of-sample)', state.backtestHoldout ?? 12, 'The most recent N months are locked away and excluded from everything shown. You develop on the older data; the held-back slice is the only honest test of whether the rules work on prices you never studied. Set to 0 to disable — but then nothing here can tell you the system works.')}
    </div>
    <button class="primary-btn" id="bt-run" type="button">🧪 Run the system over history</button>
    <p class="hint">Fetches price history for each symbol, so a long list takes a few seconds.
    Levels are re-derived on every trade from that day's bars only — no lookahead.</p>`;
  $('#bt-style-toggle').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      $('#bt-style-toggle').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.backtestStyle = b.dataset.style;
    }));
  $('#bt-filter-toggle').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      $('#bt-filter-toggle').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.backtestAbove200 = b.dataset.above === '1';
    }));
  // Wrapped, not passed directly: a bare listener would hand the click Event
  // in as `reveal`, which is truthy — silently unsealing the held-out period
  // on every ordinary run.
  $('#bt-run').addEventListener('click', () => runBacktestUI(false));
}

async function runBacktestUI(reveal = false) {
  const out = $('#backtest-result');
  const symbols = $('#bt-symbols').value.trim();
  if (!symbols) { window.alert('Add at least one symbol.'); return; }
  state.backtestSymbols = symbols;
  state.backtestYears = val('bt-years');
  state.backtestWait = val('bt-wait');
  state.backtestHoldout = val('bt-holdout');
  state.backtestValidation = val('bt-validation');
  state.backtestMaxHold = val('bt-maxhold');
  const btn = $('#bt-run');
  btn.disabled = true;
  btn.textContent = 'Running…';
  out.innerHTML = '<div class="loading">Walking the history, one trade at a time…</div>';
  try {
    const r = await api('/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols,
        years: val('bt-years'),
        mode: 'risk',
        accountSize: val('bt-account'),
        riskPct: val('bt-risk'),
        maxWaitBars: val('bt-wait'),
        holdoutMonths: val('bt-holdout'),
        validationMonths: val('bt-validation'),
        entryStyle: state.backtestStyle || 'pullback',
        requireAbove200: state.backtestAbove200 === true,
        maxHoldBars: val('bt-maxhold'),
        reveal,
      }),
    });
    state.backtestResult = r;
    renderBacktestResult(r);
  } catch (err) {
    out.innerHTML = `<div class="error-banner">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🧪 Run the system over history';
  }
}

const rTxt = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`);

function renderBacktestResult(r) {
  const o = r.overall;
  if (!o.scored) {
    $('#backtest-result').innerHTML = `
      <section class="card"><div class="event-none">
        No trades fired over that window. With a pullback entry that usually means the
        stocks never dipped to support within the waiting period — try a longer window,
        more days to leave an order resting, or the breakout style.
      </div></section>
      ${r.errors.length ? errorsCard(r.errors) : ''}`;
    return;
  }
  const expCls = o.avgR > 0 ? 'good' : 'bad';
  $('#backtest-result').innerHTML = `
    <div class="scorecard">
      ${scoreCard('Trades', o.scored,
        `${o.wins}W / ${o.losses}L · ${r.params.symbols.length} symbols` +
        (r.splitDate ? ` · development data only, to ${r.splitDate}` : ` · ${r.params.years}y`))}
      ${scoreCard('Win rate', pct(o.winRate, 0), 'How often it was right')}
      ${scoreCard('Expectancy', rTxt(o.avgR), `Per trade · ${rTxt(o.totalR)} total`, expCls)}
      ${scoreCard('Profit factor', o.profitFactor != null ? o.profitFactor.toFixed(2) : '—',
        'Gross wins ÷ gross losses. Above 1 means the wins carried the losses',
        o.profitFactor != null && o.profitFactor > 1 ? 'good' : 'bad')}
      ${scoreCard('Worst drawdown', `−${o.maxDrawdownR}R`,
        'Deepest peak-to-trough fall — the stretch you would have had to sit through', 'warn')}
      ${scoreCard('Worst losing streak', o.worstLossStreak,
        `${o.losses} losses total · ${o.avgDaysHeld}d average hold`)}
    </div>
    ${verdictBox(r)}
    ${validationPanel(r)}
    ${holdoutPanel(r)}
    ${variantWarning(r)}
    ${r.rolling && r.rolling.length > 1 ? `
      <section class="card">
        <div class="card-head"><h2>Was the edge steady?</h2>
          <span class="not-advice" data-tip="Each bar is a 12-month window of the development period, stepped 3 months. Similar heights mean a consistent edge; one tall bar means one good year.">Stability</span>
        </div>
        <div id="bt-stability" class="chart-box"></div>
      </section>` : ''}
    <section class="card">
      <div class="card-head"><h2>Equity curve (in R)</h2>
        <span class="not-advice" data-tip="Cumulative R across the sequence, oldest trade first. Shaded band marks the deepest drawdown.">Shape &gt; total</span>
      </div>
      <div id="bt-equity" class="chart-box"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Distribution of results</h2></div>
      <div id="bt-hist" class="chart-box"></div>
      <p class="hint">Average win ${rTxt(o.avgWinR)} against average loss ${rTxt(o.avgLossR)}.
      A wall of small losses with a thin tail of big wins is what a working trend system
      normally looks like — the tail is where the money is, and it is also why the middle
      of the wall feels so much like being broken.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Where it breaks down</h2>
        <span class="not-advice" data-tip="The headline hides the segments. A system with decent overall numbers can be carried entirely by one symbol or one good year.">Segments, not averages</span>
      </div>
      ${segmentTable('By symbol', r.bySymbol, 'Symbol')}
      ${segmentTable('By year', r.byYear, 'Year')}
      ${segmentTable('By regime at entry', r.byRegime, 'Regime')}
      ${segmentTable('By price vs the 200-day at entry', r.byAbove200, 'Price')}
      ${concentrationNote(r)}
    </section>
    <section class="card">
      <div class="card-head"><h2>Every trade</h2>
        <button class="ghost-btn sm" id="bt-log-all" data-tip="Files all of these in the journal as replay reps. They log as rules-followed by definition, so they become the baseline your live trades get graded against.">📓 Log all to journal</button>
      </div>
      <div class="chain-scroll" style="max-height:420px">${tradesTable(r.trades)}</div>
    </section>
    ${r.errors.length ? errorsCard(r.errors) : ''}`;

  if (window.charts) {
    window.charts.equityCurve($('#bt-equity'), o.curve);
    window.charts.rHistogram($('#bt-hist'), r.rDistribution);
    const stab = $('#bt-stability');
    if (stab) window.charts.stabilityChart(stab, r.rolling);
    const oosHist = $('#bt-oos-hist');
    if (oosHist && r.oos) window.charts.rHistogram(oosHist, r.oos.rDistribution);
  }
  const revealBtn = $('#bt-reveal');
  if (revealBtn) revealBtn.addEventListener('click', confirmReveal);
  const logAll = $('#bt-log-all');
  if (logAll) logAll.addEventListener('click', () => logAllBacktestTrades(r));
}

// The middle tier. Development data is where you iterate; this is where you
// check whether an idea survives contact with data you didn't tune it on.
// Unlike the sealed window it comes back every run — it wears out gradually
// with reuse instead of being spent in a single look, which is exactly what
// makes it the right place to try things.
function validationPanel(r) {
  if (!r.validation) {
    if (!r.splitDate) return '';
    return `
      <div class="journal-insight" style="background:var(--surface-alt)">
        <strong>Want somewhere to test changes?</strong> Set <em>Validation window</em> to 12
        months. It carves a middle slice out of the development data that you can check ideas
        against as often as you like — so the sealed window stays untouched until you are
        actually finished.
      </div>`;
  }
  const dev = r.overall, v = r.validation.summary;
  if (!v.scored) {
    return `<div class="journal-insight warn-box">
      <strong>No trades in the validation window.</strong> ${esc(r.validation.from)} to
      ${esc(r.validation.to)} produced nothing to measure — widen the window, add symbols, or
      lengthen the history.</div>`;
  }
  const held = v.avgR > 0.05 && dev.avgR > 0 && v.avgR >= dev.avgR * 0.5;
  const thin = v.scored < 20;
  const gap = dev.avgR != null && v.avgR != null ? v.avgR - dev.avgR : null;

  return `
    <section class="card validation-card">
      <div class="card-head"><h2>Validation window · ${esc(r.validation.from)} → ${esc(r.validation.to)}</h2>
        <span class="not-advice" data-tip="Not sealed. These results come back on every run, so this is the tier to iterate against while you are still deciding.">Check ideas here</span>
      </div>
      <div class="window-strip">
        <div class="window-seg dev"><span>Development</span><strong>${dev.scored}</strong>
          <em>${rTxt(dev.avgR)}</em><small>iterate freely</small></div>
        <div class="window-seg val"><span>Validation</span><strong>${v.scored}</strong>
          <em>${rTxt(v.avgR)}</em><small>check changes here</small></div>
        <div class="window-seg oos"><span>Held out</span><strong>${r.oosPending ?? 0}</strong>
          <em>${r.revealed && r.oos ? rTxt(r.oos.summary.avgR) : '🔒'}</em><small>open once, at the end</small></div>
      </div>
      <div class="journal-insight ${held ? 'good-box' : 'warn-box'}" style="margin-bottom:0">
        ${held
          ? `<strong>✅ Carries over.</strong> ${rTxt(dev.avgR)} in development,
             <strong>${rTxt(v.avgR)}</strong> here — the edge isn't confined to the data you
             tuned on. Worth keeping.`
          : v.avgR > 0.05
            ? `<strong>🤔 Weaker here.</strong> ${rTxt(dev.avgR)} in development became
               <strong>${rTxt(v.avgR)}</strong> — still positive, but ${gap != null
                 ? `${Math.abs(gap).toFixed(2)}R of that development result` : 'some of it'}
               didn't travel. Prefer the smaller number when you plan.`
            : `<strong>❌ Doesn't carry.</strong> ${rTxt(dev.avgR)} in development became
               <strong>${rTxt(v.avgR)}</strong> here. Whatever produced the development number
               was specific to that stretch. Change something and run again — that's what this
               window is for, and it costs you nothing.`}
        ${thin ? `<br><br><strong>Caveat:</strong> only ${v.scored} trades in this window, so it
          moves around a lot. Treat differences under about 0.3R as noise.` : ''}
      </div>
      <p class="hint">Iterating against this window is normal and expected — it's why it exists.
      Just know it wears out slowly: the more variants you check here, the more the best of them
      owes to luck, which is what the configuration count is tracking.</p>
    </section>`;
}

// The held-out period, locked. Everything above this panel was computed from
// development data only; this is the part that hasn't been looked at.
function holdoutPanel(r) {
  if (!r.splitDate) {
    return `
      <div class="journal-insight warn-box">
        <strong>⚠️ No data held back.</strong> Every trade above was used to produce the number
        above it, so adjusting the rules and re-running will keep improving that number whether
        or not the system is any good. Set <em>Months held back</em> to 12 and run again if you
        want an answer you can trust.
      </div>`;
  }
  const reveals = r.reveals?.count ?? 0;
  const pending = r.oosPending ?? 0;

  if (!r.revealed || !r.oos) {
    const thin = pending < 20;
    return `
      <section class="card holdout-card">
        <div class="card-head"><h2>🔒 Held-out period</h2>
          <span class="not-advice" data-tip="These trades exist and have been simulated. Their results are on the server and have deliberately not been sent to your browser.">Sealed</span>
        </div>
        <p><strong>${pending} trades</strong> from <strong>${esc(r.splitDate)}</strong> to today
        are waiting, and none of them contributed to anything above.</p>
        <p class="hint">Finish your thinking first — decide the rules, and write down what you
        expect this period to do. Then look, once. The moment you see it, it stops being
        evidence and becomes more development data, because you can't un-know it.</p>
        <p class="hint">${r.validation
          ? 'Still deciding? Iterate against the <strong>validation window</strong> above as much as you like — that is what it is there for, and nothing you do there touches this.'
          : 'Still deciding? Turn on a <strong>validation window</strong> in the setup above to get a slice you can test changes against without spending this one.'}
        And this window refills: it is the last ${state.backtestHoldout ?? 12} months counted from
        today, so a month from now it holds a month of data that does not exist yet.</p>
        ${thin ? `<div class="calc-warning">⚠️ Only ${pending} trades in the held-out window —
          a thin test. More symbols or a longer holdout would make the answer firmer.</div>` : ''}
        ${reveals > 0 ? `<div class="calc-warning">You have already unsealed a held-out period
          ${reveals} time${reveals === 1 ? '' : 's'}. Each look spends some of the evidence.</div>` : ''}
        <button class="primary-btn" id="bt-reveal" type="button">🔓 Unseal the held-out period</button>
      </section>`;
  }

  // Revealed.
  const is = r.overall, oos = r.oos.summary;
  if (!oos.scored) {
    return `<section class="card holdout-card">
      <div class="card-head"><h2>🔓 Held-out period</h2></div>
      <div class="event-none">No trades fired in the held-out window, so it can't test anything.
      Try a longer holdout or more symbols.</div></section>`;
  }

  // Did it survive? Compare like with like, and be strict: an edge that halves
  // out of sample was probably half luck to begin with.
  const held = oos.avgR > 0.05 && is.avgR > 0 && oos.avgR >= is.avgR * 0.5;
  const partial = !held && oos.avgR > 0.05;
  const verdictCls = held ? 'good-box' : 'warn-box';
  const verdict = held
    ? `✅ <strong>It held up.</strong> The rules made ${rTxt(oos.avgR)} per trade on prices you
       never studied, against ${rTxt(is.avgR)} in development. That is the closest thing to real
       evidence this tool can give you.`
    : partial
      ? `🤔 <strong>It faded.</strong> ${rTxt(is.avgR)} in development became ${rTxt(oos.avgR)}
         out of sample — still positive, but a good part of the development edge was specific to
         that stretch of history. Size accordingly, and don't trust the bigger number.`
      : `❌ <strong>It did not survive.</strong> ${rTxt(is.avgR)} in development became
         ${rTxt(oos.avgR)} on data you hadn't seen. The development result was a description of
         the past, not a system. That is a genuinely useful thing to find out for free.`;

  const cmp = (label, a, b, fmt) => `
    <tr><td>${label}</td><td>${fmt(a)}</td><td>${fmt(b)}</td></tr>`;
  const rf = (v) => (v == null ? '—' : rTxt(v));
  const pf = (v) => (v == null ? '—' : pct(v, 0));

  return `
    <section class="card holdout-card">
      <div class="card-head"><h2>🔓 Held-out period · ${esc(r.oos.from)} to today</h2>
        <span class="not-advice" data-tip="These trades were simulated on data excluded from everything you used to develop the rules.">Out of sample</span>
      </div>
      <div class="journal-insight ${verdictCls}" style="margin-top:0">${verdict}
        ${oos.scored < 20 ? `<br><br><strong>Caveat:</strong> only ${oos.scored} trades out of
          sample. Treat this as a smell test, not a verdict — one more symbol either way could
          flip it.` : ''}
        ${reveals > 1 ? `<br><br><strong>⚠️ Look #${reveals}.</strong> This window has been
          unsealed before. If you changed the rules in between, it is no longer an out-of-sample
          test — it has quietly become part of your development data.` : ''}
      </div>
      <div class="chain-scroll"><table class="chain-table paper-table">
        <thead><tr><th></th><th>Development</th><th>Held out</th></tr></thead>
        <tbody>
          ${cmp('Trades', is.scored, oos.scored, (v) => v)}
          ${cmp('Win rate', is.winRate, oos.winRate, pf)}
          ${cmp('Expectancy', is.avgR, oos.avgR, rf)}
          ${cmp('Average win', is.avgWinR, oos.avgWinR, rf)}
          ${cmp('Average loss', is.avgLossR, oos.avgLossR, rf)}
          ${cmp('Profit factor', is.profitFactor, oos.profitFactor, (v) => (v == null ? '—' : v.toFixed(2)))}
          ${cmp('Worst drawdown', is.maxDrawdownR, oos.maxDrawdownR, (v) => (v == null ? '—' : '−' + v + 'R'))}
          ${cmp('Worst losing streak', is.worstLossStreak, oos.worstLossStreak, (v) => v)}
        </tbody>
      </table></div>
      <div id="bt-oos-hist" class="chart-box"></div>
      <p class="hint">From here on, this window is spent. If you change the rules and want another
      honest test, you need data that neither you nor the rules have seen — which in practice
      means waiting for more of it to happen.</p>
    </section>`;
}

// How many different rule configurations have been tried. Try enough of them
// and one will look good by chance alone; the count is the context that makes
// a flattering in-sample number readable.
function variantWarning(r) {
  const n = r.variants?.variants ?? 0;
  if (n < 4) return '';
  const severe = n >= 8;
  return `
    <div class="journal-insight ${severe ? 'warn-box' : ''}" ${severe ? '' : 'style="background:var(--surface-alt)"'}>
      <strong>${severe ? '⚠️ ' : ''}${n} rule configurations tried so far${severe ? '.' : '.'}</strong>
      ${severe
        ? `At that many attempts you should <em>expect</em> one of them to look good on the
           development data by luck alone, even if none of them has an edge. Picking the
           best-scoring variant is how a backtest gets turned into a story. Whatever you settle
           on, the held-out period below is the only thing that can tell you which it was.`
        : `Worth tracking: the more variants you try, the more the best-scoring one owes to
           luck rather than skill. Settle on rules for a reason, not because they topped a
           leaderboard.`}
    </div>`;
}

async function confirmReveal() {
  const ok = window.confirm(
    'Unseal the held-out period?\n\n' +
    'This is meant to happen once, after you have settled the rules. Looking at it now ' +
    'means you cannot use it as an unbiased test of anything you change afterwards.\n\n' +
    'Have you finished deciding, and written down what you expect?'
  );
  if (!ok) return;
  await runBacktestUI(true);
}

// The headline verdict: does the system pay, and does the regime filter earn its keep?
function verdictBox(r) {
  const o = r.overall;
  // A hair above break-even is not an edge. Calling +0.01R "positive
  // expectancy" would be technically true and practically a lie: after
  // commissions and slippage — neither of which this sim charges you — a
  // result this thin is indistinguishable from flipping coins.
  const marginal = Math.abs(o.avgR) < 0.06 ||
    (o.profitFactor != null && o.profitFactor > 0.95 && o.profitFactor < 1.05);
  const works = !marginal && o.avgR > 0 && o.profitFactor > 1;
  const thin = o.scored < 30;
  const fv = r.filterVerdict;

  let filterLine = '';
  if (fv) {
    filterLine = fv.helps
      ? `<li><strong>The regime filter earns its keep.</strong> Trades taken in a golden-cross
         regime averaged <strong>${rTxt(fv.goldenAvgR)}</strong> against
         <strong>${rTxt(fv.deathAvgR)}</strong> in a death-cross regime — an edge of
         ${rTxt(fv.edge)} per trade. Rule 2 is doing real work.</li>`
      : `<li><strong>The regime filter is not paying for itself here.</strong> Golden-cross
         trades averaged <strong>${rTxt(fv.goldenAvgR)}</strong> against
         <strong>${rTxt(fv.deathAvgR)}</strong> in a death-cross regime. On this sample the
         filter is costing you trades without buying safety — worth a longer window before
         changing rule 2, but note it.</li>`;
  } else {
    filterLine = `<li>Not enough trades in both regimes to judge the golden-cross filter yet.
      Add symbols or years if you want to test rule 2.</li>`;
  }

  const dev = r.splitDate ? ' on the development data' : ' over this sample';
  const headline = marginal ? `➖ Too close to call${dev} — this is break-even.`
    : works ? `📈 Positive expectancy${dev}.`
    : `📉 This did not pay${dev}.`;
  let body;
  if (marginal) {
    body = `That is a rounding error, not an edge. This backtest charges no commission and
      assumes every order fills at your price, so a real account running this would have come
      out behind. Treat it as "no evidence the system works" rather than a near miss.`;
  } else if (works) {
    body = `Being right ${pct(o.winRate, 0)} of the time was enough because the average win
      (${rTxt(o.avgWinR)}) was bigger than the average loss (${rTxt(o.avgLossR)}).`;
  } else {
    body = `The wins were not big enough to cover the losses. Before changing anything, check the
      segments below — it may be one symbol or one year doing the damage.`;
  }
  // The stricter reading of rule 2, answered from one run rather than two.
  const av = r.above200Verdict;
  let above200Line = '';
  if (r.params?.requireAbove200) {
    above200Line = `<li><strong>Running with the stricter rule 2</strong> — regime filter plus
      price above the 200-day. Compare this expectancy against a "Regime only" run to see what
      the extra condition bought you.</li>`;
  } else if (av) {
    above200Line = av.helps
      ? `<li><strong>Price above the 200-day was worth having.</strong> Trades taken with price
         above it averaged <strong>${rTxt(av.aboveAvgR)}</strong> (${av.aboveTrades}) against
         <strong>${rTxt(av.belowAvgR)}</strong> below it (${av.belowTrades}) — ${rTxt(av.edge)}
         per trade. Worth tightening rule 2 and re-running with the filter on.</li>`
      : `<li><strong>Price above the 200-day did not help here.</strong> Above it averaged
         <strong>${rTxt(av.aboveAvgR)}</strong> (${av.aboveTrades}), below it
         <strong>${rTxt(av.belowAvgR)}</strong> (${av.belowTrades}). On this sample the stricter
         rule 2 would have cost you setups without buying safety — buying the dip below the
         200-day was where the money was.</li>`;
  }

  return `
    <div class="journal-insight ${works ? 'good-box' : 'warn-box'}">
      <strong>${headline}</strong>
      ${o.scored} trades, ${pct(o.winRate, 0)} win rate, ${rTxt(o.avgR)} per trade.
      ${body}
      <ul style="margin:8px 0 0 18px;padding:0">
        ${filterLine}
        ${above200Line}
        ${thin ? `<li><strong>${o.scored} trades is a thin sample.</strong> Anything under about
          30 is closer to a rumour than a result — widen the symbol list or the years before
          you trust it.</li>` : ''}
        <li>You would have had to sit through a <strong>−${o.maxDrawdownR}R</strong> drawdown and
        <strong>${o.worstLossStreak} losses in a row</strong>. That is the number that decides
        whether you would still be running this system when it started working again.</li>
        ${r.splitDate ? `<li><strong>None of this is evidence yet.</strong> These are the trades
          you developed the rules against, so a good number here is partly a description of how
          well you fitted them. The held-out period below is the only part that can test it.</li>` : ''}
      </ul>
    </div>`;
}

// Is the whole result resting on one symbol? Averages hide that; this doesn't.
function concentrationNote(r) {
  const scored = r.bySymbol.filter((s) => s.scored > 0);
  if (scored.length < 3 || r.overall.totalR == null) return '';
  const best = scored.reduce((a, b) => ((b.totalR ?? 0) > (a.totalR ?? 0) ? b : a));
  const bestR = best.totalR ?? 0;
  if (bestR <= 0) return '';
  const rest = r.overall.totalR - bestR;
  const share = r.overall.totalR > 0 ? bestR / r.overall.totalR : null;
  // Only worth saying when one name is actually carrying the result: either it
  // beats everything else combined, or the rest of the book lost money.
  if (rest > 0 && (share == null || share < 0.5)) return '';
  const headline = rest <= 0
    ? `${esc(best.key)} made ${rTxt(bestR)} while every other symbol combined
       ${rest < 0 ? `lost ${rTxt(rest)}` : 'made nothing'}.`
    : `${esc(best.key)} contributed ${rTxt(bestR)} of the ${rTxt(r.overall.totalR)} total
       — ${pct(share, 0)} of the result — leaving ${rTxt(rest)} from everything else.`;
  return `
    <div class="journal-insight warn-box" style="margin:12px 0 0">
      <strong>⚠️ One symbol is carrying this.</strong> ${headline}
      A system carried by a single name hasn't been shown to work; it's shown that one stock
      moved. Re-run without it and see what's left.
    </div>`;
}

function segmentTable(title, rows, keyLabel) {
  const live = rows.filter((x) => x.scored > 0);
  if (!live.length) return '';
  const body = live.map((x) => {
    const cls = x.avgR > 0 ? 'good' : 'bad';
    return `<tr>
      <td><strong>${esc(String(x.key))}</strong></td>
      <td>${x.scored}</td>
      <td>${pct(x.winRate, 0)}</td>
      <td class="${cls}">${rTxt(x.avgR)}</td>
      <td class="${cls}">${rTxt(x.totalR)}</td>
      <td>${x.maxDrawdownR != null ? '−' + x.maxDrawdownR + 'R' : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <h3 class="segment-title">${title}</h3>
    <div class="chain-scroll"><table class="chain-table paper-table">
      <thead><tr>
        <th>${keyLabel}</th><th>Trades</th><th>Win rate</th>
        <th data-tip="Average result per trade in this bucket. This is the number to compare across rows.">Expectancy</th>
        <th>Total R</th><th>Max DD</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

function tradesTable(trades) {
  const rows = trades.map((t) => {
    const cls = t.rMultiple == null ? '' : t.rMultiple > 0 ? 'good' : 'bad';
    const icon = t.outcome === 'target' ? '🎯'
      : t.outcome === 'stopped' ? '🛑'
      : t.outcome === 'time' ? '⏱'
      : '⏳';
    return `<tr>
      <td>${esc(t.symbol)}</td>
      <td>${esc(t.entryDate)}</td>
      <td>${money(t.entry)}</td>
      <td>${money(t.exitPrice)}</td>
      <td>${t.daysHeld}d</td>
      <td>${esc(t.regime || '—')}</td>
      <td>${icon}</td>
      <td class="${cls}">${t.rMultiple != null ? rTxt(t.rMultiple) : '—'}</td>
    </tr>`;
  }).join('');
  return `<table class="chain-table paper-table">
    <thead><tr><th>Symbol</th><th>Entered</th><th>Entry</th><th>Exit</th><th>Held</th>
      <th>Regime</th><th></th><th>R</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function errorsCard(errors) {
  return `<section class="card"><div class="card-head"><h2>Skipped</h2></div>
    <ul class="news-list">${errors.map((e) =>
      `<li>${esc(e.symbol)} — ${esc(e.error)}</li>`).join('')}</ul></section>`;
}

async function logAllBacktestTrades(r) {
  const closed = r.trades.filter((t) => t.outcome !== 'open');
  if (!closed.length) return;
  if (!window.confirm(
    `Log ${closed.length} backtest trades to the journal?\n\n` +
    `They file as replay reps that followed the rules, which is what makes them a baseline ` +
    `for grading your live trades. Note this will dominate your journal's statistics.`)) return;
  const btn = $('#bt-log-all');
  btn.disabled = true;
  let ok = 0;
  for (const t of closed) {
    const riskPS = round2(t.entry - t.stop);
    const saved = await logTrade({
      symbol: t.symbol, kind: 'stock', source: 'replay', status: 'closed',
      entry_style: t.style, entry: t.entry, target: t.target, stop: t.stop, shares: t.shares,
      risk_per_share: riskPS,
      planned_risk: riskPS && t.shares ? round2(riskPS * t.shares) : null,
      reward_risk: riskPS ? round2((t.target - t.entry) / riskPS) : null,
      thesis: `Backtest: ${t.style} rule, levels as of ${t.asOf}, ${t.regime || 'unknown'} regime.`,
      entry_price: t.entryPrice, exit_price: t.exitPrice,
      entry_date: t.entryDate, exit_date: t.exitDate,
      outcome: t.outcome, followed_rules: true,
    }, { announce: false });
    if (saved) ok++;
    btn.textContent = `Logging ${ok}/${closed.length}…`;
  }
  btn.textContent = `✓ Logged ${ok}`;
}

$('#backtest-btn').addEventListener('click', openBacktest);

// ---------- Settings ----------
function setKeyPlaceholder(sel, st) {
  const el = $(sel);
  el.value = '';
  el.placeholder = st && st.set
    ? `${st.source === 'env' ? 'from .env' : 'saved'} ····${st.last4}`
    : 'not set';
}

async function loadSettingsStatus() {
  const s = await api('/settings');
  $('#set-name').value = s.displayName || '';
  $('#set-account').value = s.accountSize || '';
  $('#set-risk').value = s.riskPct || '';
  setKeyPlaceholder('#set-alpaca-id', s.ALPACA_API_KEY_ID);
  setKeyPlaceholder('#set-alpaca-secret', s.ALPACA_API_SECRET_KEY);
  setKeyPlaceholder('#set-finnhub', s.FINNHUB_API_KEY);
}

async function openSettings() {
  $('#settings-status').innerHTML = '';
  try { await loadSettingsStatus(); } catch (e) { /* still show the form */ }
  $('#settings-overlay').classList.remove('hidden');
}
function closeSettings() { $('#settings-overlay').classList.add('hidden'); }

$('#settings-btn').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'settings-overlay') closeSettings();
});

$('#settings-save').addEventListener('click', async () => {
  const body = {
    displayName: $('#set-name').value.trim(),
    accountSize: $('#set-account').value.trim(),
    riskPct: $('#set-risk').value.trim(),
  };
  const map = {
    ALPACA_API_KEY_ID: '#set-alpaca-id',
    ALPACA_API_SECRET_KEY: '#set-alpaca-secret',
    FINNHUB_API_KEY: '#set-finnhub',
  };
  for (const [k, sel] of Object.entries(map)) {
    if ($(sel).value.trim()) body[k] = $(sel).value.trim();
  }
  try {
    await api('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadSettingsStatus();
    await refreshSettingsCache();
    $('#settings-status').innerHTML = '<div class="settings-ok">✅ Saved. Takes effect immediately.</div>';
    // Push the new account size / risk into the plan builder if it's open.
    const acctEl = document.getElementById('plan-account');
    if (acctEl && body.accountSize) acctEl.value = body.accountSize;
    const riskEl = document.getElementById('plan-risk');
    if (riskEl && body.riskPct) riskEl.value = body.riskPct;
    if (document.getElementById('plan-out')) computePlan();
  } catch (err) {
    $('#settings-status').innerHTML = `<div class="settings-bad">Save failed: ${esc(err.message)}</div>`;
  }
});

$('#settings-test').addEventListener('click', async () => {
  $('#settings-status').innerHTML = '<div class="loading">Testing connections…</div>';
  try {
    const r = await api('/settings/test');
    $('#settings-status').innerHTML =
      `<div class="settings-test">Alpaca: ${r.alpaca ? '✅ connected' : '❌ failed'} &nbsp;·&nbsp; Finnhub: ${r.finnhub ? '✅ connected' : '❌ failed'}</div>`;
  } catch (err) {
    $('#settings-status').innerHTML = `<div class="settings-bad">Test failed: ${esc(err.message)}</div>`;
  }
});

// ---------- Watchlist momentum scan (home dashboard) ----------
function dirBadge(d) {
  if (d === 'rising') return '<span class="good">▲ rising</span>';
  if (d === 'falling') return '<span class="bad">▼ falling</span>';
  return '<span class="muted">▬ flat</span>';
}

function scanSignal(r) {
  if (r.cross && r.cross.daysAgo <= 25) {
    const g = r.cross.type === 'golden';
    return `<span class="${g ? 'good' : 'bad'}" style="font-weight:700">${g ? '⚡ Golden cross' : '🔻 Death cross'} · ${r.cross.daysAgo}d</span>`;
  }
  if (r.approaching === 'golden') return '<span class="warn" style="font-weight:700">🔜 Nearing golden cross</span>';
  if (r.approaching === 'death') return '<span class="warn" style="font-weight:700">🔜 Nearing death cross</span>';
  if (r.regime == null) return '<span class="muted">—</span>';
  if (r.regime === 'golden') return '<span class="good">⚡ Golden regime</span>';
  return '<span class="bad">🔻 Death regime</span>';
}

async function renderScan() {
  const panel = document.getElementById('scan-panel');
  if (!panel) return;
  if (state.symbol) { panel.classList.add('hidden'); return; }
  const syms = (state._watchlist || []).map((w) => w.symbol);
  if (!syms.length) { panel.innerHTML = ''; panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  if (!panel.innerHTML) panel.innerHTML = '<section class="card"><div class="loading">Scanning your watchlist…</div></section>';
  try {
    const { results } = await api(`/scan?symbols=${encodeURIComponent(syms.join(','))}`);
    const rows = results.map((r) => r.error
      ? `<tr><td class="scan-sym">${esc(r.symbol)}</td><td colspan="5" class="muted">no data</td></tr>`
      : `<tr class="scan-row" data-symbol="${esc(r.symbol)}">
          <td class="scan-sym">${esc(r.symbol)}</td>
          <td>${money(r.price)}</td>
          <td class="${r.trendLabel === 'Uptrend' ? 'good' : r.trendLabel === 'Downtrend' ? 'bad' : ''}">${r.trendLabel}</td>
          <td>${r.rsi14 ?? '—'} ${dirBadge(r.direction)}</td>
          <td>${scanSignal(r)}</td>
          <td class="cc-cell" data-cc="${esc(r.symbol)}"><span class="muted">…</span></td>
        </tr>`).join('');
    panel.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Watchlist Momentum Scan</h2>
          <button id="scan-refresh" class="ghost-btn" type="button">↻ Refresh</button></div>
        <div class="chain-scroll"><table class="chain-table scan-table">
          <thead><tr><th>Symbol</th><th>Price</th><th>Trend</th><th>Momentum (RSI)</th><th>Signal</th>
            <th data-tip="Annualized yield from selling a ~0.30-delta call about a month out, if you owned 100 shares. Higher = richer premium.">CC yield (ann.)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="hint">A signal is a cue to open that stock and decide — not an auto-trade. Click a row to research it.</p>
      </section>`;
    panel.querySelectorAll('.scan-row').forEach((tr) =>
      tr.addEventListener('click', () => { $('#search-input').value = tr.dataset.symbol; loadSymbol(tr.dataset.symbol); }));
    const rb = document.getElementById('scan-refresh');
    if (rb) rb.addEventListener('click', renderScan);

    // Fill the covered-call yield column async (one options lookup per name).
    results.filter((r) => !r.error).forEach(async (r) => {
      const cell = panel.querySelector(`[data-cc="${r.symbol}"]`);
      if (!cell) return;
      try {
        const cc = await api(`/cc/${encodeURIComponent(r.symbol)}`);
        if (cc && cc.annualized != null) {
          cell.innerHTML = `<span class="${cc.annualized >= 0.15 ? 'good' : ''}" data-tip="~0.30-delta call · $${cc.strike} strike · ${cc.dte}d out · $${cc.premium.toFixed(2)} premium">${pct(cc.annualized, 0)}</span>`;
        } else {
          cell.innerHTML = '<span class="muted">—</span>';
        }
      } catch {
        cell.innerHTML = '<span class="muted">—</span>';
      }
    });
  } catch { /* keep prior content on error */ }
}

// ---------- Market regime (home dashboard) ----------
// Every other signal in this app is about one ticker. This is the tape those
// tickers trade inside — a breakout with breadth rolling over underneath it
// is a different trade from the same breakout in a healthy market.
const TONE_CLASS = { 'Risk-on': 'good', 'Risk-off': 'bad', Mixed: 'warn' };

function regimeIndexTile(i) {
  const cls = i.trendLabel === 'Uptrend' ? 'good' : i.trendLabel === 'Downtrend' ? 'bad' : 'warn';
  const vs = i.vsSma50 == null ? '—'
    : `${i.vsSma50 >= 0 ? '+' : ''}${(i.vsSma50 * 100).toFixed(1)}% vs 50-day`;
  return `
    <div class="rg-tile">
      <div class="rg-tile-head"><span class="rg-sym">${esc(i.symbol)}</span><span class="rg-name">${esc(i.name)}</span></div>
      <div class="rg-tile-value ${cls}">${esc(i.trendLabel)}</div>
      <div class="rg-tile-sub">RSI ${i.rsi14 ?? '—'} ${dirBadge(i.direction)}<br>${vs}</div>
    </div>`;
}

function regimeStatTiles(r) {
  const tiles = [];
  const b = r.breadth;
  if (b) {
    const cls = b.abovePct >= 0.55 ? 'good' : b.abovePct < 0.45 ? 'bad' : 'warn';
    let sub = `${b.above} of ${b.universeSize} names above their 200-day`;
    if (b.change) {
      const arrow = b.change.delta >= 0 ? '▲' : '▼';
      sub += `<br><span class="${b.change.delta >= 0 ? 'good' : 'bad'}">${arrow} from ${(b.change.from * 100).toFixed(0)}% on ${b.change.since}</span>`;
    } else {
      sub += '<br><span class="muted">direction shows once a week of history builds</span>';
    }
    tiles.push(`
      <div class="rg-tile">
        <div class="rg-tile-head"><span class="rg-sym">Breadth</span>
          <span class="rg-name" data-tip="The share of a universe trading above its own 200-day average. Falling breadth means fewer names are carrying the market — an index can hold up while most stocks underneath it weaken. This universe is the 11 sector ETFs plus your watchlist, NOT the S&P 500's members.">what&rsquo;s participating</span></div>
        <div class="rg-tile-value ${cls}">${pct(b.abovePct, 0)}</div>
        <div class="rg-tile-sub">${sub}</div>
      </div>`);
    tiles.push(`
      <div class="rg-tile">
        <div class="rg-tile-head"><span class="rg-sym">Highs / Lows</span>
          <span class="rg-name" data-tip="Names in the universe printing a new 52-week high versus a new 52-week low today. Lows outnumbering highs while the index holds up is classic late-stage weakness.">52-week</span></div>
        <div class="rg-tile-value ${b.newHighs >= b.newLows ? 'good' : 'bad'}">${b.newHighs} / ${b.newLows}</div>
        <div class="rg-tile-sub">new highs vs new lows<br>across ${b.universeSize} names</div>
      </div>`);
  }
  const v = r.volatility;
  if (v) {
    const cls = v.label === 'Calm' ? 'good' : v.label === 'Stressed' ? 'bad' : 'warn';
    tiles.push(`
      <div class="rg-tile">
        <div class="rg-tile-head"><span class="rg-sym">Volatility</span>
          <span class="rg-name" data-tip="SPY's own realized (actual) volatility over the last 20 sessions, ranked against the past year. This is realized vol, not the VIX — the VIX is implied, meaning what options price in. Low realized vol while breadth falls is the setup where protection is cheap and few people want it.">${esc(v.basis)}</span></div>
        <div class="rg-tile-value ${cls}">${esc(v.label)}</div>
        <div class="rg-tile-sub">${pct(v.realizedVol20d, 1)} annualized${v.percentile != null ? `<br>${pct(v.percentile, 0)} of the last year was lower` : ''}</div>
      </div>`);
  }
  return tiles.join('');
}

function regimeSectorChip(s) {
  const cls = s.downWeeks >= 4 ? 'bad' : s.downWeeks >= 2 ? 'warn' : 'good';
  const streak = s.downWeeks > 0
    ? `${s.downWeeks}w down${s.partialWeek ? '*' : ''}`
    : s.weekChange != null && s.weekChange >= 0 ? 'holding' : 'flat';
  const wk = s.weekChange == null ? '' : ` · ${s.weekChange >= 0 ? '+' : ''}${(s.weekChange * 100).toFixed(1)}%`;
  return `
    <button type="button" class="rg-sector ${cls}" data-symbol="${esc(s.symbol)}"
      data-tip="${esc(s.name)} (${esc(s.symbol)}) — ${s.downWeeks} consecutive down week(s)${s.aboveSma200 === false ? ', below its 200-day' : ''}. Click to research the ETF.">
      <span class="rg-sector-name">${esc(s.name)}</span>
      <span class="rg-sector-streak"><span class="rg-sector-sym">${esc(s.symbol)}</span> · ${streak}${wk}</span>
    </button>`;
}

function renderRegime(r) {
  const panel = $('#regime-panel');
  const tone = TONE_CLASS[r.summary.tone] || 'warn';
  const partial = r.sectors.some((s) => s.partialWeek);
  panel.innerHTML = `
    <section class="card">
      <div class="card-head">
        <h2>Market Regime</h2>
        <span class="rg-badges">
          <span class="rg-tone ${tone}">${esc(r.summary.tone)}</span>
          <span class="not-advice" data-tip="A read of the overall tape assembled from index trends, sector streaks, breadth, and volatility. It is context for the signals below — it does not size a position or tell you to trade.">Context, not a signal</span>
        </span>
        <button id="regime-refresh" class="ghost-btn" type="button" title="Recompute now">↻ Refresh</button>
      </div>
      <p class="rg-summary">${r.summary.notes.map(esc).join(' · ')}</p>
      <div class="rg-tiles">${r.indexes.map(regimeIndexTile).join('')}</div>
      <div class="rg-tiles">${regimeStatTiles(r)}</div>
      <div class="rg-sectors-head">Sector streaks — weakest first</div>
      <div class="rg-sectors">${r.sectors.map(regimeSectorChip).join('')}</div>
      <p class="hint">
        ${partial ? 'An asterisk marks a week still in progress. ' : ''}Breadth covers the 11 sector
        ETFs plus your watchlist (${r.breadth ? r.breadth.universeSize : 0} names) — it is not the
        S&amp;P 500&rsquo;s internals. Click a sector to research it.
      </p>
    </section>`;

  panel.querySelectorAll('.rg-sector').forEach((b) =>
    b.addEventListener('click', () => { $('#search-input').value = b.dataset.symbol; loadSymbol(b.dataset.symbol); }));
  const rb = $('#regime-refresh');
  if (rb) rb.addEventListener('click', () => loadRegime({ force: true }));
}

async function loadRegime({ force = false } = {}) {
  const panel = $('#regime-panel');
  if (!panel) return;
  if (state.symbol) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  if (!panel.innerHTML || force) {
    panel.innerHTML = '<section class="card"><div class="loading">Reading the tape — indexes, sectors, breadth…</div></section>';
  }
  try {
    const r = await api(`/regime${force ? '?force=1' : ''}`);
    state.regime = r;
    renderRegime(r);
  } catch (err) {
    panel.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Market Regime</h2></div>
        <p class="hint">Couldn&rsquo;t read the tape: ${esc(err.message)}</p>
      </section>`;
  }
}

// ---------- Macro calendar ----------
const IMPACT_CLASS = { high: 'bad', medium: 'warn', low: 'muted' };

function renderMacro(cal) {
  const panel = $('#macro-panel');
  if (!panel) return;
  const rows = cal.events.slice(0, 12).map((e) => {
    const d = daysUntil(e.date);
    return `
      <div class="mc-row">
        <div class="mc-date">${e.date}<span class="mc-when">${d === 0 ? 'today' : `${d}d`}</span></div>
        <div class="mc-main">
          <div class="mc-title">${esc(e.title)}</div>
          <div class="mc-meta">
            <span class="${IMPACT_CLASS[e.impact] || 'muted'}">${esc(e.impact)} impact</span>
            ${e.time ? ` · ${esc(e.time)} ET` : ''}
            ${e.estimate != null ? ` · est. ${esc(String(e.estimate))}` : ''}
            ${e.prev != null ? ` · prev ${esc(String(e.prev))}` : ''}
            ${e.source === 'manual' ? ' · <span class="muted">added by you</span>' : ''}
            ${e.source === 'rule' ? ' · <span class="muted">recurring weekly release</span>' : ''}
            ${e.notes ? ` · ${esc(e.notes)}` : ''}
          </div>
        </div>
        ${e.source === 'manual' ? `<button class="mc-remove" data-id="${e.id}" title="Remove">✕</button>` : '<span></span>'}
      </div>`;
  }).join('');

  panel.innerHTML = `
    <section class="card">
      <div class="card-head">
        <h2>Macro Calendar</h2>
        <span class="not-advice" data-tip="Scheduled market-wide events. Anything marked high impact that falls before your option&rsquo;s expiration gets flagged in the calculator, exactly like an earnings date. Scheduled releases are listed ${cal.horizonDays} days out; events you add yourself are always shown, however far ahead they are.">Upcoming</span>
      </div>
      ${cal.feed.note ? `<p class="mc-note">${esc(cal.feed.note)}</p>` : ''}
      <div class="mc-list">${rows || '<div class="event-none">Nothing scheduled in this window.</div>'}</div>
      <form id="macro-form" class="mc-form">
        <input id="mc-date" type="date" aria-label="Event date" required />
        <input id="mc-title" placeholder="Event (e.g. FOMC decision)" aria-label="Event title" required />
        <select id="mc-impact" aria-label="Impact">
          <option value="high">High impact</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button type="submit">Add</button>
      </form>
      <p class="hint">Read a date in a market newsletter? Add it once here and the option
        calculators will flag it whenever it lands inside an expiration you&rsquo;re planning.</p>
    </section>`;

  panel.querySelectorAll('.mc-remove').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/econ/${btn.dataset.id}`, { method: 'DELETE' });
      loadMacro();
    }));

  const form = $('#macro-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = $('#mc-date').value;
      const title = $('#mc-title').value.trim();
      if (!date || !title) return;
      try {
        await api('/econ', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, title, impact: $('#mc-impact').value }),
        });
        loadMacro();
      } catch (err) {
        alert(`Couldn’t add that event: ${err.message}`);
      }
    });
  }
}

// Loaded on the home screen AND behind a loaded ticker, since the option
// calculators need it to flag macro events inside an expiration.
async function loadMacro() {
  try {
    const cal = await api('/econ');
    state.econ = cal;
    if (!state.symbol) {
      $('#macro-panel').classList.remove('hidden');
      renderMacro(cal);
    } else if (state.view === 'planner') {
      renderEvents();
    }
  } catch {
    $('#macro-panel').classList.add('hidden');
  }
}

function goHome() {
  state.symbol = null;
  clearInterval(refreshTimer);
  clearInterval(tickTimer);
  $('#content').classList.add('hidden');
  $('#empty-state').classList.remove('hidden');
  setRefreshStatus('—');
  loadWatchlist().catch(() => {});
  loadRegime().catch(() => {});
  loadMacro().catch(() => {});
}
$('#brand-home').addEventListener('click', goHome);

// ---------- Public hooks (used by help.js / tour) ----------
window.planner = {
  loadSymbol,
  isLoaded: () => Boolean(state.symbol),
};

// ---------- Init ----------
async function refreshSettingsCache() {
  try {
    const s = await api('/settings');
    state.settings = {
      accountSize: Number(s.accountSize) || null,
      riskPct: Number(s.riskPct) || null,
    };
  } catch { /* leave defaults */ }
}

loadWatchlist().catch(() => {});
loadRegime().catch(() => {});
loadMacro().catch(() => {});
refreshSettingsCache();
