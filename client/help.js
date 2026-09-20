'use strict';

// ============ Help modal content ============
const HELP = {
  start: `
    <h3>What Trade Bench is for</h3>
    <p>Research a stock, plan a trade, practice it, and handle the options side — all in one
    place. Everything is organized into <strong>three views</strong> for whatever ticker you load.</p>

    <h3>Your home dashboard</h3>
    <p>The home screen (click the 🛠️ logo anytime) runs a <strong>momentum scan</strong> across your
    whole watchlist at once — each ticker's trend, momentum direction, golden/death-cross signal, and
    covered-call yield — so you see which names are worth opening without checking every chart. Click
    any row to dive in.</p>

    <h3>Load any ticker</h3>
    <p>Type a symbol <em>or a company name</em> (even <code>Bitcoin</code>) in the search box and
    pick from the suggestions.</p>

    <h3>The three views</h3>
    <ul>
      <li><strong>🔍 Research</strong> — a scorecard (trend, momentum, volatility, support/
      resistance, news), a price chart, a trade-plan builder, and historical replay. Your home
      base for stock decisions.</li>
      <li><strong>📊 Options</strong> — covered calls and cash-secured puts off a live options
      chain, with a payoff diagram.</li>
      <li><strong>📈 Paper</strong> — place any plan as a simulated Alpaca paper order (no real
      money) and track positions and P&L.</li>
    </ul>

    <div class="tip">💡 The big green numbers — <strong>reward-to-risk</strong> on a stock plan
    and <strong>annualized return</strong> on an option — are what let you compare choices fairly.</div>

    <h3>Your keys</h3>
    <p>Add your own Alpaca and Finnhub API keys anytime under <strong>⚙ Settings</strong>. They
    stay on your machine.</p>`,

  research: `
    <h3>Before the ticker: the home screen</h3>
    <p><strong>Market Regime</strong> reads the tape your stock trades inside — the four major
    indexes, which sectors are on losing streaks, how many names are above their 200-day
    (breadth), and whether volatility is calm or stressed. It's context, not a signal: it
    doesn't size a position or tell you to trade, it tells you which way to lean when you read
    everything below. A breakout with breadth falling underneath it is a different trade from
    the same breakout in a healthy market.</p>
    <p><strong>Macro Calendar</strong> lists scheduled market-wide events. Anything high-impact
    that falls before your option's expiration gets flagged in the calculator, exactly like an
    earnings date. Read a date in a market newsletter? Type it in once and the app will keep
    flagging it for you.</p>

    <h3>The Research view</h3>
    <p>Everything you need to size up a stock and plan a buy.</p>

    <h3>Scorecard</h3>
    <dl>
      <dt>Trend</dt><dd>Price vs the 50- and 200-day moving averages — up, down, or sideways.</dd>
      <dt>Momentum (RSI)</dt><dd>The current RSI <em>plus a sparkline and a rising/falling
      arrow</em>, so you can see whether momentum is growing or fading — not just where it sits.</dd>
      <dt>Volatility</dt><dd>Average daily move (ATR) as a %. Bigger = wider swings.</dd>
      <dt>Support / Resistance</dt><dd>Recent 20-day floor and ceiling, plus the 52-week range.</dd>
      <dt>News sentiment</dt><dd>A quick positive/negative lean from recent headlines.</dd>
    </dl>

    <h3>Price &amp; Plan chart</h3>
    <p>The price line with moving averages and your entry / target / stop drawn as levels — so you
    can see whether your entry sits near support and your target is realistic.</p>

    <h3>Trade Plan Builder</h3>
    <p>Enter a buy limit, a profit target, and a trailing-stop %. It computes shares, risk, reward,
    and the reward-to-risk ratio, and a finished plan can be placed as a paper bracket order.</p>
    <div class="tip">💡 Aim for a reward-to-risk around <strong>2:1 or better</strong> — you stand
    to make at least twice what you're risking.</div>

    <h3>Historical Replay</h3>
    <p>Pick a past start date and replay your plan against real historical prices — did it hit the
    target, get stopped out, and in how many days? A backtest for <em>learning</em>, not a prediction.</p>`,

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
      <dt>Market regime</dt><dd>The condition of the overall market your stock trades inside —
      index trends, sector streaks, breadth, and volatility taken together. The same breakout
      means something different in a healthy tape than in a weakening one.</dd>
      <dt>Breadth</dt><dd>How many stocks are participating, measured here as the share of a
      universe trading above its own 200-day average. An index can grind higher on a handful of
      big names while breadth falls underneath it — that's a market getting narrower.</dd>
      <dt>Realized vs implied volatility</dt><dd>Realized is how much a stock <em>actually</em>
      moved; implied (IV) is how much the options market expects it to move. The regime panel
      shows SPY's realized vol, ranked against its own last year.</dd>
      <dt>Down-week streak</dt><dd>Consecutive weeks a sector has closed lower. A long streak
      says the weakness is persistent rather than a single bad session.</dd>
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
  {
    nav: 'Reading the scorecard',
    html: `
      <h3>Lesson 9 — Reading the Research scorecard</h3>
      <p>The <strong>🔍 Research</strong> view sizes up a stock at a glance with five cards:</p>
      <dl>
        <dt>Trend</dt><dd>Is price above or below its 50- and 200-day averages? Above both = uptrend.</dd>
        <dt>Momentum (RSI)</dt><dd>The number tells you <em>where</em> momentum is (over 70 hot,
        under 30 cold). The <strong>sparkline and arrow</strong> tell you which way it's
        <em>heading</em> — rising or falling. Both matter: RSI 50 rising is very different from RSI 50 falling.</dd>
        <dt>Volatility</dt><dd>The typical daily move. Higher = bigger swings, so size positions smaller.</dd>
        <dt>Support / Resistance</dt><dd>The recent floor and ceiling — natural spots to buy near
        (support) or take profit near (resistance).</dd>
        <dt>News sentiment</dt><dd>A quick read of the headline mood.</dd>
      </dl>
      <div class="do">✍️ <strong>Try it:</strong> Load a stock, open Research, and read the five
      cards top to bottom. In one sentence: is this trending up with rising momentum, or fading?</div>`,
  },
  {
    nav: 'Plan & replay a trade',
    html: `
      <h3>Lesson 10 — Planning and replaying a stock trade</h3>
      <p>The <strong>Trade Plan Builder</strong> models a disciplined swing trade: buy on a dip,
      take profit at a target, protect the rest with a trailing stop.</p>
      <ul>
        <li><strong>Entry</strong> — a buy limit, usually near support. A dip fills you.</li>
        <li><strong>Target</strong> — where you take profit, often near resistance.</li>
        <li><strong>Trailing stop</strong> — how far the runner can fall before it sells.</li>
      </ul>
      <p>Watch the <strong>reward-to-risk</strong>: 2:1 means the target is twice as far as the
      stop. The price chart draws all three levels so you can eyeball whether the plan makes sense.</p>
      <h3 style="font-size:14px">Then replay it</h3>
      <p>Historical Replay runs that exact plan against past prices from a date you choose, and
      tells you what would have happened. Try a few start dates to build intuition — fast, no waiting weeks.</p>
      <div class="do">✍️ <strong>Try it:</strong> Build a plan, then replay it from a few months
      back. Did it fill? Hit target or stop? How many days did it take?</div>`,
  },
  {
    nav: 'Practice with paper',
    html: `
      <h3>Lesson 11 — Practice with paper trading</h3>
      <p>The <strong>📈 Paper</strong> view is a simulated $100k brokerage account (Alpaca) — real
      order mechanics, fake money. Nothing here risks a cent.</p>
      <ul>
        <li>From a stock plan, hit <strong>Place as paper bracket order</strong> — entry, target,
        and stop go in as one linked order.</li>
        <li>From the Options calculator, hit <strong>Paper trade this</strong> to sell a covered
        call or cash-secured put.</li>
        <li>The Paper view tracks your positions, open orders, and profit/loss.</li>
      </ul>
      <p>Because fills use delayed data, treat it as practice for <em>designing and managing</em>
      trades, not split-second timing.</p>
      <div class="tip">🎓 That's the full loop: research a stock, plan a trade, replay it on
      history, practice it in paper — and run covered calls / puts the same way. Revisit any lesson
      from the 📚 Course tab.</div>`,
  },
  {
    nav: 'Build your system',
    html: `
      <h3>Lesson 12 — Building your trading system</h3>
      <p>A <strong>trading system</strong> is a written set of rules you follow every time, so
      you're never making emotional decisions with real money. It answers five questions:</p>
      <dl>
        <dt>1. What do I trade?</dt><dd>Your watchlist of stocks you'd genuinely want to own.</dd>
        <dt>2. Should I buy this now?</dt><dd>A filter. Example: only take longs in a
        <strong>golden-cross regime</strong> (50-day above 200-day) — skip downtrends. The Trend card shows it.</dd>
        <dt>3. When exactly do I enter?</dt><dd>A rule, e.g. "set a buy limit on a pullback to
        support and wait to get filled." No chasing.</dd>
        <dt>4. How many shares?</dt><dd><strong>Size by risk.</strong> In the plan builder,
        "Risk-based sizing" turns "risk 1% of my account" into a share count from your stop distance.
        This is the most important rule.</dd>
        <dt>5. When do I exit?</dt><dd>Decided up front — a profit target and a stop, placed as a
        bracket. Then leave it alone.</dd>
      </dl>
      <div class="tip">💡 <strong>The rule that keeps you in the game:</strong> never risk more than
      1–2% of the account on a single trade. If it's money you can't easily replace, this isn't
      optional — it's what stops one bad trade from doing real damage.</div>
      <h3 style="font-size:14px">A simple starter system</h3>
      <ul>
        <li>Trade only stocks in an uptrend (above the 200-day).</li>
        <li>Buy on a pullback toward support with a buy limit.</li>
        <li>Risk 1% of the account per trade — let the stop distance set the share count.</li>
        <li>Target near resistance; trail a stop on the rest.</li>
        <li>Review holdings weekly; a trend or momentum turn is a cue to re-check, not to panic.</li>
      </ul>
      <div class="do">✍️ <strong>Try it:</strong> Save your account size in ⚙ Settings, pick a stock
      in an uptrend, build a 1%-risk plan, replay it on history, then place it in Paper. That's your
      system, running.</div>`,
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
  { sel: '#search-form', text: '<strong>Start here.</strong> Type a ticker <em>or a company name</em> (even "Bitcoin") and pick from the suggestions. The home screen (🛠️ logo) also scans your whole watchlist for signals.' },
  { sel: '#view-toggle', text: 'Three modes per ticker: <strong>🔍 Research</strong> (analyze the stock + plan a trade), <strong>📊 Options</strong> (covered calls / cash-secured puts), and <strong>📈 Paper</strong> (practice trades with fake money). You start on Research.' },
  { sel: '#ticker-header', text: 'Price and key context — IV, upcoming earnings and dividends. Data is delayed ~15 min and auto-refreshes.' },
  { sel: '#scorecard', text: 'The <strong>scorecard</strong>: trend, momentum (with an <strong>RSI sparkline</strong> so you can see whether it’s rising or falling), volatility, support/resistance, and news sentiment.' },
  { sel: '#price-chart', text: 'Your <strong>price chart</strong> with the 50/200-day moving averages and your entry/target/stop levels drawn on it — the plan made visual.' },
  { sel: '#plan-builder', text: 'Build a <strong>trade plan</strong>: entry, profit target, trailing stop. It computes shares, risk, reward, and reward-to-risk — and can place it as a paper order.' },
  { sel: '#replay-body', text: '<strong>Historical replay</strong>: run the plan against past prices to see how it would have played out — learn without waiting weeks.' },
  { sel: '.watchlist-card', text: '<strong>Shared watchlist</strong> — saved tickers you both see. Click one to load it.' },
  { sel: '#settings-btn', text: '<strong>Settings</strong> — add your own Alpaca & Finnhub API keys here. Press <strong>? Help</strong> anytime for the full guide and the 📚 Course.' },
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
  // Wait for the Research view (scorecard + charts) to render.
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('#scorecard .score-card')) break;
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
