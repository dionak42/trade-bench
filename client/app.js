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
  settings: {},      // { accountSize, riskPct } cached from /settings
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

// Does an event fall inside [today, expiration]?
function eventInWindow(expiration) {
  const flags = [];
  const e = state.events?.earnings;
  if (e?.date && e.date >= todayStr() && e.date <= expiration) flags.push('earnings');
  const d = state.events?.dividend;
  if (d?.upcoming && d.exDate >= todayStr() && d.exDate <= expiration) flags.push('dividend');
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
  $('#content').classList.remove('hidden');
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
    const flags = eventInWindow(c.expiration);
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
  body.innerHTML = rows.join('') || `<div class="event-none">No scheduled earnings or dividends found in the next ~4 months.</div>`;
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
  // Preserve any edits across re-renders (e.g. when switching sizing mode).
  const cur = (id, dflt) => { const el = document.getElementById(id); return el && el.value !== '' ? el.value : dflt; };
  const entry = cur('plan-entry', l.support20.toFixed(2));
  const target = cur('plan-target', l.resistance20.toFixed(2));
  const stopPct = cur('plan-stop', Math.max(2, Math.round((v.atrPct || 0.03) * 2 * 100)));
  const acct = cur('plan-account', state.settings.accountSize || 10000);
  const risk = cur('plan-risk', state.settings.riskPct || 1);
  const cap = cur('plan-capital', state.settings.accountSize || 5000);
  const mode = state.sizingMode;

  const sizingInputs = mode === 'risk'
    ? `${field('plan-account', 'Account size ($)', acct, 'The balance of the account you are trading. Save it in Settings so it pre-fills.')}
       ${field('plan-risk', 'Risk per trade (%)', risk, 'How much of the account you are willing to lose if the stop is hit. 1% is a common, conservative rule — it decides your share count.')}`
    : `${field('plan-capital', 'Capital ($)', cap, 'Dollars to deploy into this trade.')}`;

  $('#plan-builder').innerHTML = `
    <div class="toggle plan-mode" id="sizing-toggle" role="tablist">
      <button class="${mode === 'risk' ? 'active' : ''}" data-mode="risk" type="button">Risk-based sizing</button>
      <button class="${mode === 'capital' ? 'active' : ''}" data-mode="capital" type="button">Fixed capital</button>
    </div>
    <div class="calc-inputs">
      ${field('plan-entry', 'Entry (buy limit)', entry, 'The price you set your buy order at. A dip to here fills you — buying weakness. Defaults to 20-day support.')}
      ${field('plan-target', 'Profit target', target, 'Where you sell all or part of the position. Defaults to 20-day resistance.')}
      ${field('plan-stop', 'Trailing stop %', stopPct, 'How far below the peak the runner can fall before it sells. Defaults to ~2× the average daily move.')}
      ${sizingInputs}
    </div>
    <div id="plan-out"></div>`;

  $('#sizing-toggle').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { state.sizingMode = b.dataset.mode; renderPlanBuilder(a); }));
  $('#plan-builder').querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', computePlan));
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
      <strong>Plan:</strong> buy ${shares} share${shares === 1 ? '' : 's'} at ${money(entry)} (${money(capital)}). Sell part at
      ${money(target)} (+${pct(toTarget)}), then trail the rest with a ${stopPct}% stop. Max loss ${money(dollarRisk)}${pctOfAcct != null ? ` — ${pct(pctOfAcct)} of the account` : ''}.
      <br><span style="color:var(--muted)">Prefer to get <em>paid</em> to buy near ${money(entry)}? Switch to the
      Options tab and sell a cash-secured put around that strike.</span>
    </div>
    ${shares >= 1 && rr != null && state.symbol ? `
      <button class="primary-btn place-btn" id="plan-place">📈 Place as paper bracket order</button>
      <div class="place-note">Buys ${shares} ${state.symbol} with a take-profit at ${money(target)} and a fixed stop at ${money(stopPrice)}. Simulated — no real money.</div>` : ''}`;
  const btn = document.getElementById('plan-place');
  if (btn) {
    btn.addEventListener('click', () => placePaperOrder({
      symbol: state.symbol, qty: shares, side: 'buy', type: 'limit',
      limit_price: round2(entry), time_in_force: 'gtc', order_class: 'bracket',
      take_profit: { limit_price: round2(target) },
      stop_loss: { stop_price: round2(stopPrice) },
    }, `Place a paper BRACKET order:\n\nBuy ${shares} ${state.symbol} at ${money(entry)}\nTake-profit: ${money(target)}\nStop: ${money(stopPrice)}\nMax loss: ${money(dollarRisk)}\n\nProceed? (simulated, no real money)`));
  }
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
  const body = { startDate, mode: state.sizingMode };
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
  const levelsLine = `<div class="replay-levels">System plan <strong>as of ${r.asOf}</strong>: buy <strong>${money(r.entry)}</strong> · target <strong>${money(r.target)}</strong> · stop <strong>${money(r.stop)}</strong> · ${r.shares} shares</div>`;
  if (r.outcome === 'no_fill') {
    out.innerHTML = `${levelsLine}<div class="replay-outcome">⚪ No fill</div><p class="hint">${esc(r.message)}</p>`;
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
    <p class="hint">Entry, target, and stop are set from the 20-day support/resistance and ATR stop <strong>as of ${r.asOf}</strong> — using only data up to that day, so there's no lookahead.</p>`;
  if (window.charts) window.charts.replayChart(document.getElementById('replay-chart'), r);
}

function switchView(v) {
  state.view = v;
  $('#view-toggle').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === v));
  $('#planner-view').classList.toggle('hidden', v !== 'planner');
  $('#analysis-view').classList.toggle('hidden', v !== 'analysis');
  $('#paper-view').classList.toggle('hidden', v !== 'paper');
  if (v === 'analysis' && state.symbol) loadAnalysis();
  if (v === 'paper') loadPaper();
}

$('#view-toggle').querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view)));

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

async function placePaperOrder(order, confirmMsg) {
  if (!window.confirm(confirmMsg)) return;
  try {
    await api('/paper/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
    switchView('paper'); // jump to the paper view and refresh
    window.alert('Paper order placed.');
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

function goHome() {
  state.symbol = null;
  clearInterval(refreshTimer);
  clearInterval(tickTimer);
  $('#content').classList.add('hidden');
  $('#empty-state').classList.remove('hidden');
  setRefreshStatus('—');
  loadWatchlist().catch(() => {});
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
refreshSettingsCache();
