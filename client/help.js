'use strict';

// ============ Help modal content ============
const HELP = {
  start: `
    <h3>What this app is for</h3>
    <p>Two decisions: selling <span class="term">covered calls</span> (income on shares you
    already own) and selling <span class="term">cash-secured puts</span> (getting paid to
    maybe buy a stock at a lower price). It pulls a live options chain, does the return math,
    and flags the risks so you can compare choices fast.</p>

    <h3>Three steps to your first plan</h3>
    <ul>
      <li><strong>1. Load a ticker.</strong> Type a symbol (e.g. <code>NVDA</code>) up top and press Load.</li>
      <li><strong>2. Pick the calculator.</strong> <em>Covered Call</em> if you own the shares;
      <em>Cash-Secured Put</em> if you'd like to buy the stock cheaper.</li>
      <li><strong>3. Click a strike</strong> in the chain. Everything auto-fills and the
      annualized return appears instantly.</li>
    </ul>

    <div class="tip">💡 The big green number is <strong>annualized return</strong>. That's the
    one figure that lets you compare a 30-day trade against a 45-day one, or one ticker against
    another, on equal footing.</div>

    <h3>Your main risk gauge: the "Δ / Prob" column</h3>
    <p>Delta doubles as the rough <strong>probability the option finishes in-the-money</strong> —
    i.e. the chance your shares get called away (calls) or you get assigned the stock (puts).
    A strike showing <code>30%</code> ≈ 30% odds of that happening. Lower = safer but less
    premium; higher = more premium but more likely to trigger.</p>`,

  cc: `
    <h3>Covered Calls — income on shares you own</h3>
    <p>You own at least 100 shares and sell someone the right to buy them from you at a set
    <span class="term">strike</span> price. You keep the premium no matter what. If the stock
    rises past the strike, your shares get "called away" (sold) at that price.</p>

    <h3>What to enter</h3>
    <ul>
      <li><strong>Shares owned</strong> — how many you hold. Contracts = shares ÷ 100.</li>
      <li>Strike, premium, days, delta all auto-fill when you click a chain row — but every
      field is editable.</li>
    </ul>

    <h3>What the outputs mean</h3>
    <dl>
      <dt>Static return (ann.)</dt><dd>What you make if the stock stays flat and you just keep the premium.</dd>
      <dt>If-called return (ann.)</dt><dd>Premium plus the gain up to the strike, if your shares get sold.</dd>
      <dt>Breakeven</dt><dd>How far the stock can fall before you're losing money.</dd>
      <dt>Downside protection</dt><dd>The cushion the premium gives you, as a %.</dd>
      <dt>Prob. called away</dt><dd>≈ the call's delta — odds you lose the shares.</dd>
    </dl>

    <div class="tip">💡 A common approach: pick a strike <strong>above</strong> today's price
    with a delta around <code>0.30</code> — you collect income and keep your shares most of the
    time. Want more premium? Move the strike closer. Want to keep more upside? Move it further out.</div>`,

  csp: `
    <h3>Cash-Secured Puts — get paid to maybe buy</h3>
    <p>You set aside cash and sell someone the right to sell you the stock at a
    <span class="term">strike</span> below today's price. You keep the premium. If the stock
    drops to the strike, you buy it — at an effective discount, because the premium lowers
    your cost.</p>

    <h3>What to enter</h3>
    <ul>
      <li><strong>Contracts</strong> — each one secures 100 shares' worth of cash.</li>
      <li>Strike, premium, days, delta auto-fill from the chain; all editable.</li>
    </ul>

    <h3>What the outputs mean</h3>
    <dl>
      <dt>Cash required</dt><dd>Strike × 100 × contracts — the cash you must hold in reserve.</dd>
      <dt>Return on cash (ann.)</dt><dd>Your annualized yield on that parked cash.</dd>
      <dt>Cost basis if assigned</dt><dd>What each share effectively costs you: strike minus premium.</dd>
      <dt>Discount to current</dt><dd>How far below today's price your cost basis sits.</dd>
      <dt>Prob. assigned</dt><dd>≈ the put's delta — odds you end up buying.</dd>
    </dl>

    <div class="tip">💡 The appeal: you win either way. Either the put expires and you keep the
    premium, or you buy a stock you wanted anyway — at a discount.</div>`,

  chain: `
    <h3>Reading the options chain</h3>
    <dl>
      <dt>● Blue dot</dt><dd>Marks the <strong>at-the-money</strong> strike — the one closest to
      the current stock price. Your anchor for "where the stock is now."</dd>
      <dt>★ Green star &amp; shaded rows</dt><dd>The <strong>target zone</strong>. Rows shaded green
      are the ~0.20–0.35 delta band; the <strong>★</strong> marks the strike nearest
      <strong>0.30 delta</strong> — a common income-selling target (≈30% chance of assignment,
      ≈70% chance you keep the premium and nothing else happens). It's <em>orientation, not
      advice</em> — a starting point for the eye, not a "buy this." Toggle it on/off with the
      <strong>★ Target zone</strong> button above the chain.</dd>
      <dt>Strike</dt><dd>The price the option is built around. Click any row to load it into the calculator.</dd>
      <dt>Bid</dt><dd>The premium per share you'd collect selling that option.</dd>
      <dt>Δ / Prob</dt><dd>Delta, and its read as a probability of finishing in-the-money.</dd>
      <dt>IV</dt><dd>Implied volatility — how much movement the market is pricing in. Higher IV = fatter premiums.</dd>
      <dt>Spread</dt><dd>Bid-ask gap. <span style="color:var(--bad);font-weight:600">Red = wide/illiquid</span> —
      you'll get a worse fill. Prefer tight spreads.</dd>
      <dt>DTE</dt><dd>Days to expiration.</dd>
      <dt>⚠️ on a row</dt><dd>An earnings report or ex-dividend falls before that option expires —
      extra risk to weigh.</dd>
    </dl>

    <h3>Events &amp; IV Rank</h3>
    <p>The <strong>Upcoming Events</strong> panel shows the next earnings date and ex-dividend.
    The <strong>IV</strong> badge up top shows the current implied-volatility level; its
    <em>rank</em> becomes meaningful after the app has run a couple of weeks and built its own
    history — it tells you whether today's premium is rich or cheap versus normal for this stock.</p>`,

  glossary: `
    <h3>Glossary</h3>
    <dl>
      <dt>Covered call</dt><dd>Selling a call on shares you own, to collect premium.</dd>
      <dt>Cash-secured put</dt><dd>Selling a put while holding the cash to buy the shares if assigned.</dd>
      <dt>Strike</dt><dd>The agreed price to buy/sell the stock at.</dd>
      <dt>Premium</dt><dd>The cash you collect for selling the option (shown per share; ×100 per contract).</dd>
      <dt>Delta</dt><dd>Sensitivity to price; doubles as ≈ probability of finishing in-the-money.</dd>
      <dt>Implied volatility (IV)</dt><dd>The market's expected movement, baked into the price. Drives premium size.</dd>
      <dt>Assignment</dt><dd>When the option is exercised against you — your shares get sold (call) or you buy (put).</dd>
      <dt>In-the-money (ITM)</dt><dd>An option with real value now: a call with strike below the
      price, or a put with strike above the price. If it's still ITM at expiration, it gets assigned.</dd>
      <dt>Out-of-the-money (OTM)</dt><dd>The opposite — no value yet: a call with strike above the
      price, or a put with strike below it. An OTM option that stays OTM expires worthless, and as
      the seller you simply keep the premium. That's usually the outcome you're hoping for.</dd>
      <dt>Annualized return</dt><dd>The period return scaled to a full year, so trades of different lengths compare fairly.</dd>
      <dt>Ex-dividend date</dt><dd>Own the stock before this date to get the dividend. Raises early-assignment risk on calls.</dd>
    </dl>`,
};

// ============ Course: Income with Covered Calls & Cash-Secured Puts ============
// A short, hands-on course taught through the app. Education, not financial advice.
const COURSE = [
  {
    nav: 'Why sell options?',
    html: `
      <h3>Lesson 1 — Why sell options?</h3>
      <p>Most people <em>buy</em> options hoping for a big win, and most of the time those options
      expire worthless. This course is about the other side of that trade: <strong>selling</strong>
      options to collect income. When you sell, you're the "house" — you take in cash up front, and
      time is on your side.</p>
      <p>You'll learn the two safest, most popular income strategies:</p>
      <ul>
        <li><strong>Covered calls</strong> — earn income on shares you already own.</li>
        <li><strong>Cash-secured puts</strong> — get paid to (maybe) buy a stock you want at a lower price.</li>
      </ul>
      <p>Both are "conservative" as options go: no unlimited-loss risk, and every outcome is one you
      agreed to in advance. The trade-off is that you cap some upside (calls) or take on an obligation
      to buy (puts) in exchange for cash today.</p>
      <div class="tip">🎯 <strong>Goal of this course:</strong> by the end, you'll be able to load a
      ticker in this app, pick a sensible strike, read the return, weigh the risks, and know exactly
      what happens either way. Take it one lesson at a time.</div>
      <p style="font-size:12.5px;color:var(--muted)">This is educational material, not personalized
      financial advice. Consider paper-trading first, and never risk money you can't afford to lose.</p>`,
  },
  {
    nav: 'The words you need',
    html: `
      <h3>Lesson 2 — The handful of words you actually need</h3>
      <p>Options have a lot of jargon, but you only need a few terms to start. Here they are, mapped
      to where they show up in the app:</p>
      <dl>
        <dt>Call / Put</dt><dd>A <strong>call</strong> is the right to <em>buy</em> a stock at a set
        price; a <strong>put</strong> is the right to <em>sell</em> it. You'll be <em>selling</em> both.</dd>
        <dt>Strike</dt><dd>The agreed price. It's the first column in the chain.</dd>
        <dt>Premium</dt><dd>The cash you collect for selling — the <strong>Bid</strong> column
        (per share; ×100 per contract).</dd>
        <dt>Contract</dt><dd>One option = <strong>100 shares</strong>. Always.</dd>
        <dt>Expiration / DTE</dt><dd>When it ends. <strong>DTE</strong> = days to expiration.</dd>
        <dt>In / Out of the money</dt><dd>Whether the option has value now. (See the Glossary tab.)</dd>
        <dt>Assignment</dt><dd>When the option is exercised against you — your shares get sold (call)
        or you buy shares (put).</dd>
        <dt>Delta ≈ Probability</dt><dd>The <strong>Δ / Prob</strong> column. Roughly the chance of
        assignment. This is your main dial — you'll use it constantly.</dd>
      </dl>
      <div class="tip">💡 Don't memorize these. They'll stick naturally as you use the app. Every
      column and field also has a hover explanation.</div>`,
  },
  {
    nav: 'Reading the chain',
    html: `
      <h3>Lesson 3 — Reading the options chain</h3>
      <p>The chain is the menu of options you can sell. Each row is one contract. Here's how to read
      it left to right: <strong>Strike</strong> (the price), <strong>Bid</strong> (your premium),
      <strong>Δ / Prob</strong> (odds of assignment), <strong>IV</strong> (expected movement),
      <strong>Spread</strong> (how easy it is to trade), <strong>DTE</strong> (days left).</p>
      <p>Two visual guides do a lot of work for you:</p>
      <ul>
        <li>The <strong>● blue dot</strong> marks the strike closest to today's price — your anchor.</li>
        <li>The <strong>★ green target zone</strong> shades the ~0.20–0.35 delta band and stars the
        strike near 0.30 — a common income sweet spot (more on that in Lesson 6).</li>
        <li>A <strong style="color:var(--bad)">red spread</strong> means the option is illiquid — skip it.</li>
        <li>A <strong>⚠️</strong> means an earnings or dividend event lands before expiration.</li>
      </ul>
      <div class="do">✍️ <strong>Try it now:</strong> Close this window, type a ticker you know (like
      <code>AAPL</code>), and just look at the chain. Find the blue dot. Notice how delta shrinks as
      strikes move away from the price. Then come back — that intuition is most of the battle.</div>`,
  },
  {
    nav: 'Covered calls',
    html: `
      <h3>Lesson 4 — Covered calls, step by step</h3>
      <p><strong>What it is:</strong> you own at least 100 shares and sell a call against them. You
      collect premium now. If the stock rises above your strike by expiration, your shares get sold
      ("called away") at that strike — and you keep the premium either way.</p>
      <p><strong>When to use it:</strong> you own a stock, feel neutral-to-slightly-bullish, and want
      to squeeze income out of it. You should be genuinely okay selling at the strike.</p>
      <p><strong>The app, step by step:</strong></p>
      <ul>
        <li>Pick the <strong>Covered Call</strong> tab and enter your real <strong>share count</strong>.</li>
        <li>Click a call strike <em>above</em> today's price — try one in the green target zone.</li>
        <li>Read the two returns: <strong>Static</strong> (if the stock stays flat, you keep premium)
        and <strong>If-called</strong> (premium + gain up to the strike, if assigned).</li>
        <li>Check <strong>Breakeven</strong> and <strong>Downside protection</strong> — your cushion
        if the stock dips.</li>
      </ul>
      <div class="do">✍️ <strong>Worked example:</strong> You own 100 shares at $50. You sell a
      $55 call, 30 days out, for $1.00. You collect <strong>$100</strong> now. If the stock stays
      under $55, you keep it and can sell another next month. If it jumps to $60, your shares sell at
      $55 (a $500 gain) and you still keep the $100 — you just miss the extra move above $55. Either
      outcome pays you.</div>`,
  },
  {
    nav: 'Cash-secured puts',
    html: `
      <h3>Lesson 5 — Cash-secured puts, step by step</h3>
      <p><strong>What it is:</strong> you set aside cash and sell a put below today's price. You
      collect premium now. If the stock falls to your strike, you buy the shares — at an effective
      discount, because the premium lowers your cost.</p>
      <p><strong>When to use it:</strong> there's a stock you'd happily own, but only cheaper. Instead
      of waiting and hoping, you get <em>paid</em> to wait.</p>
      <p><strong>The app, step by step:</strong></p>
      <ul>
        <li>Pick the <strong>Cash-Secured Put</strong> tab. The chain flips to puts.</li>
        <li>Decide the price you'd be glad to buy at, and click that strike (below today's price).</li>
        <li>Read <strong>Cash required</strong> (what you hold in reserve), <strong>Return on cash</strong>
        (annualized), and <strong>Cost basis if assigned</strong> — your true price after premium.</li>
        <li>Check <strong>Discount to current</strong> — how far below today's price you'd effectively buy.</li>
      </ul>
      <div class="do">✍️ <strong>Worked example:</strong> A stock trades at $52 and you'd love it at
      $48. You sell a $48 put, 30 days out, for $0.80, and hold $4,800 in cash. You collect
      <strong>$80</strong>. If it stays above $48, you keep the $80 and repeat. If it drops, you buy
      at $48 — but your real cost is <strong>$47.20</strong> after premium. You wanted it at $48; you
      got it for less.</div>`,
  },
  {
    nav: 'Strike & expiration',
    html: `
      <h3>Lesson 6 — Choosing the strike and expiration</h3>
      <p>This is where the sweet spot lives. Two dials:</p>
      <h3 style="font-size:14px">Delta — your risk dial</h3>
      <p>Delta ≈ the probability of assignment. A common target is around <strong>0.30 delta</strong>
      — roughly a 30% chance of being assigned, so ~70% of the time the option expires worthless and
      you simply keep the premium. Lower delta = safer but less income; higher = more income but you
      get assigned more often. The app's <strong>★ target zone</strong> highlights this band for you.</p>
      <h3 style="font-size:14px">Time — the expiration dial</h3>
      <p>Options lose value as they age (that decay works <em>for</em> you as a seller, and it speeds
      up near expiration). Many sellers favor <strong>30–45 days</strong> out — a good balance of
      premium and decay. The app defaults to ~30 days for this reason.</p>
      <div class="do">✍️ <strong>Try it:</strong> With a ticker loaded, click three different strikes
      in a row and watch the <strong>annualized return</strong> change. That number lets you compare a
      30-day trade against a 45-day one fairly. Hunt for the best annualized return at a risk level
      you're comfortable with — that's the whole decision.</div>`,
  },
  {
    nav: 'Managing risk',
    html: `
      <h3>Lesson 7 — Managing the risks</h3>
      <p>Selling options is conservative, not risk-free. Four things to watch — the app surfaces all
      of them:</p>
      <dl>
        <dt>📅 Events (earnings & dividends)</dt><dd>Earnings can cause big surprise moves. If a
        strike's row shows <strong>⚠️</strong>, an event lands before it expires. Many beginners avoid
        selling across earnings until they're comfortable.</dd>
        <dt>📈 IV (implied volatility)</dt><dd>Higher IV = fatter premiums, because the market expects
        bigger moves. Selling when IV is elevated pays you more for the same risk. The <strong>IV</strong>
        badge shows the current level.</dd>
        <dt>💧 Liquidity (the spread)</dt><dd>A wide/red <strong>spread</strong> means you'll get a bad
        fill. Stick to tight spreads on well-known names.</dd>
        <dt>🛡️ Downside</dt><dd>A covered call's premium cushions small dips but won't save you in a
        crash — you still own the stock. Only sell calls on shares you're comfortable holding.</dd>
      </dl>
      <div class="tip">💡 Golden rule: only sell covered calls on shares you'd be happy to sell, and
      cash-secured puts on stocks you'd be happy to own. Then every outcome is a good one.</div>`,
  },
  {
    nav: 'Your routine + the Wheel',
    html: `
      <h3>Lesson 8 — A repeatable routine (and "the Wheel")</h3>
      <p>Put it all together into a simple weekly habit:</p>
      <ul>
        <li><strong>1.</strong> Load your ticker. Check the price and the events badges.</li>
        <li><strong>2.</strong> Pick the strategy: own the shares → covered call; want to buy → put.</li>
        <li><strong>3.</strong> Choose ~30 days out, click a strike in the target zone.</li>
        <li><strong>4.</strong> Read the annualized return; compare a couple of strikes.</li>
        <li><strong>5.</strong> Glance at news and the ⚠️ flags. No surprises? Place the trade with your broker.</li>
      </ul>
      <h3 style="font-size:14px">The Wheel — how the two strategies connect</h3>
      <p>Many income traders run a loop called <strong>the Wheel</strong>:</p>
      <ul>
        <li>Sell a <strong>cash-secured put</strong> on a stock you want. Collect premium.</li>
        <li>If assigned, you now <strong>own the shares</strong> (at a discount).</li>
        <li>Sell <strong>covered calls</strong> on those shares. Collect more premium.</li>
        <li>If called away, you're back to cash — start over.</li>
      </ul>
      <p>At every step you're collecting premium, and this app plans every step. That's the whole game.</p>
      <div class="tip">🎓 <strong>You've finished the course.</strong> Revisit any lesson anytime from
      the <strong>📚 Course</strong> tab, and lean on the hovers and Glossary while you practice. Go
      load a ticker and try a plan — nothing beats hands-on.</div>`,
  },
];

// ============ Modal wiring ============
const helpOverlay = document.getElementById('help-overlay');
const helpBody = document.getElementById('help-body');
let courseIdx = 0;

function renderCourse(idx) {
  courseIdx = Math.max(0, Math.min(idx, COURSE.length - 1));
  const lesson = COURSE[courseIdx];
  const nav = COURSE.map((l, i) =>
    `<button class="course-navitem ${i === courseIdx ? 'active' : ''}" data-lesson="${i}">${i + 1}. ${l.nav}</button>`
  ).join('');
  helpBody.innerHTML = `
    <div class="course">
      <aside class="course-nav">${nav}</aside>
      <div class="course-content">
        <div class="course-lesson">${lesson.html}</div>
        <div class="course-foot">
          <button class="ghost-btn" id="course-prev" ${courseIdx === 0 ? 'disabled' : ''}>← Previous</button>
          <span class="course-progress">Lesson ${courseIdx + 1} of ${COURSE.length}</span>
          <button class="primary-btn" id="course-next" ${courseIdx === COURSE.length - 1 ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
    </div>`;
  helpBody.scrollTop = 0;
  helpBody.querySelectorAll('.course-navitem').forEach((b) =>
    b.addEventListener('click', () => renderCourse(Number(b.dataset.lesson))));
  const prev = helpBody.querySelector('#course-prev');
  const next = helpBody.querySelector('#course-next');
  if (prev) prev.addEventListener('click', () => renderCourse(courseIdx - 1));
  if (next) next.addEventListener('click', () => renderCourse(courseIdx + 1));
}

function renderHelpTab(tab) {
  document.querySelectorAll('#help-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'course') { renderCourse(courseIdx); return; }
  helpBody.innerHTML = HELP[tab] || HELP.start;
  helpBody.scrollTop = 0;
}
function openHelp() { renderHelpTab('start'); helpOverlay.classList.remove('hidden'); }
function closeHelp() { helpOverlay.classList.add('hidden'); }

document.getElementById('help-btn').addEventListener('click', openHelp);
document.getElementById('help-close').addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', (e) => { if (e.target === helpOverlay) closeHelp(); });
document.querySelectorAll('#help-tabs button').forEach((b) =>
  b.addEventListener('click', () => renderHelpTab(b.dataset.tab)));
document.getElementById('help-tour').addEventListener('click', () => { closeHelp(); startTour(); });
document.getElementById('tour-btn').addEventListener('click', () => startTour());

// ============ Guided tour ============
const TOUR = [
  { sel: '#search-form', text: '<strong>Start here.</strong> Type a ticker symbol and press Load to pull its price, options chain, events, and news.' },
  { sel: '#ticker-header', text: 'The <strong>current price</strong> and key context sit here. Data is delayed ~15 minutes on the free tier and auto-refreshes every 60s.' },
  { sel: '#ticker-header .badges', text: 'Quick-glance badges: the <strong>IV level</strong>, and any <strong>earnings or ex-dividend</strong> coming up — your scheduled-risk radar.' },
  { sel: '#type-toggle', text: 'Switch the chain between <strong>call</strong> strikes and <strong>put</strong> strikes.' },
  { sel: '#chain-body tr.atm', text: 'The <strong>● blue dot</strong> marks the <strong>at-the-money</strong> strike — closest to today’s price. Click <em>any</em> row to load it into the calculator.' },
  { sel: '.chain-table thead th:nth-child(3)', text: 'Your main risk gauge: <strong>delta ≈ the probability</strong> the option finishes in-the-money. Lower is safer, higher pays more.' },
  { sel: '.chain-table thead th:nth-child(5)', text: 'The <strong>spread</strong>. Red means wide/illiquid — you’ll get a worse fill, so prefer tight spreads.' },
  { sel: '#calc-toggle', text: '<strong>Covered Call</strong> for income on shares you own; <strong>Cash-Secured Put</strong> to get paid to maybe buy the stock cheaper.' },
  { sel: '.headline-return', text: 'The headline: <strong>annualized return</strong>. This is what lets you compare strikes and expirations fairly.' },
  { sel: '.outputs', text: 'The full breakdown — breakeven, downside protection, assignment probability, and the exact if-assigned scenario below.' },
  { sel: '#events-body', text: '<strong>Upcoming events.</strong> A chain row lights up ⚠️ when one of these falls before that option expires.' },
  { sel: '#news-body', text: 'Recent <strong>headlines</strong> — a quick sanity check before you commit to a trade.' },
  { sel: '.watchlist-card', text: '<strong>Shared watchlist.</strong> Save tickers here and you both see the same list. That’s the tour — press ? Help anytime.' },
];

let tourIdx = 0;
const tourOverlay = document.getElementById('tour-overlay');
const spotlight = document.getElementById('tour-spotlight');
const tip = document.getElementById('tour-tip');
const tipText = document.getElementById('tour-tip-text');
const tourProgress = document.getElementById('tour-progress');

async function ensureLoadedForTour() {
  // The tour needs a populated UI. If nothing is loaded, load a demo ticker.
  if (window.planner && window.planner.isLoaded()) return;
  const input = document.getElementById('search-input');
  input.value = 'AAPL';
  await window.planner.loadSymbol('AAPL');
  // Wait for the chain to render.
  for (let i = 0; i < 30; i++) {
    if (document.querySelector('#chain-body tr.atm')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function startTour() {
  await ensureLoadedForTour();
  tourIdx = 0;
  tourOverlay.classList.remove('hidden');
  showTourStep();
}

function endTour() {
  tourOverlay.classList.add('hidden');
  localStorage.setItem('tourSeen', '1');
}

function showTourStep() {
  // Skip steps whose target isn't present.
  let step = TOUR[tourIdx];
  let el = step && document.querySelector(step.sel);
  let guard = 0;
  while (!el && tourIdx < TOUR.length - 1 && guard++ < TOUR.length) {
    tourIdx++;
    step = TOUR[tourIdx];
    el = document.querySelector(step.sel);
  }
  if (!el) { endTour(); return; }

  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => positionTour(el), 320);

  tipText.innerHTML = step.text;
  tourProgress.textContent = `${tourIdx + 1} / ${TOUR.length}`;
  document.getElementById('tour-back').style.visibility = tourIdx === 0 ? 'hidden' : 'visible';
  document.getElementById('tour-next').textContent = tourIdx === TOUR.length - 1 ? 'Done' : 'Next';
}

function positionTour(el) {
  const r = el.getBoundingClientRect();
  const pad = 6;
  spotlight.style.top = `${r.top - pad}px`;
  spotlight.style.left = `${r.left - pad}px`;
  spotlight.style.width = `${r.width + pad * 2}px`;
  spotlight.style.height = `${r.height + pad * 2}px`;

  const tipW = tip.offsetWidth || 320;
  const tipH = tip.offsetHeight || 160;
  const gap = 14;
  // Prefer below; flip above if not enough room.
  let top = r.bottom + gap;
  if (top + tipH > window.innerHeight - 10) top = Math.max(10, r.top - tipH - gap);
  let left = r.left;
  if (left + tipW > window.innerWidth - 10) left = window.innerWidth - tipW - 10;
  left = Math.max(10, left);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

document.getElementById('tour-next').addEventListener('click', () => {
  if (tourIdx >= TOUR.length - 1) { endTour(); return; }
  tourIdx++; showTourStep();
});
document.getElementById('tour-back').addEventListener('click', () => {
  if (tourIdx > 0) { tourIdx--; showTourStep(); }
});
document.getElementById('tour-skip').addEventListener('click', endTour);
window.addEventListener('resize', () => {
  if (!tourOverlay.classList.contains('hidden')) {
    const el = document.querySelector(TOUR[tourIdx].sel);
    if (el) positionTour(el);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeHelp(); if (!tourOverlay.classList.contains('hidden')) endTour(); }
});

// First-visit: auto-offer the tour once.
if (!localStorage.getItem('tourSeen')) {
  setTimeout(() => { if (!localStorage.getItem('tourSeen')) startTour(); }, 800);
}
