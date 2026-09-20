# Trade Bench

A personal trade-planning and paper-practice tool. The home screen reads the
**market regime** — the tape your tickers trade inside — plus a **macro calendar**
and a watchlist momentum scan. Then, three views per ticker:

- **🔍 Research** — technical scorecard (trend, RSI, volatility, support/resistance),
  a bracket **trade-plan builder** (entry / target / trailing stop with risk-reward math),
  and **historical replay** to backtest a stock plan against past prices.
- **📊 Options** — covered-call and cash-secured-put planning off a live options chain
  with greeks, upcoming events (earnings + ex-dividends), IV rank, and news.
- **📈 Paper** — place plans as real orders in an Alpaca **paper account** (stocks via
  bracket orders, plus covered calls / CSPs) and track positions, orders, and P&L.
- **🧪 Test system** — run your rules across many symbols and years as a *sequence*
  of trades, then see where they break down: equity curve in R, distribution of
  results, rolling-window stability, and splits by symbol, year, and market regime.
  History splits three ways: **development** to iterate on, a **validation** window to
  check changes against, and a **sealed** window you unseal once as a real
  out-of-sample test.
- **📓 Journal** — one row per *decision*: the plan you committed to, what actually happened,
  and whether you followed your own rules. Turns reps into a scoreboard (win rate, expectancy
  in R, discipline rate, worst losing streak).

Plus a shared watchlist, an interactive course, and a guided tour. Runs on a Mac mini and is
reachable by two people over Tailscale — no login, no public internet exposure.

See [`TRADE_IDEA_PRACTICE.md`](TRADE_IDEA_PRACTICE.md) for the working note on how to write a
trade idea so it can be judged later — the habits the app's planning tools are meant to support.

> Educational tool for planning and practice. Not financial advice.

## Stack

- **Backend:** Node.js + Express, binds `0.0.0.0` for Tailscale access
- **Frontend:** plain HTML/CSS/JS (no build step)
- **Database:** SQLite via Node's built-in `node:sqlite` (no native compile)
- **Process manager:** pm2 (survives reboots)
- **Data:** [Alpaca](https://alpaca.markets) (price + options chain + greeks + dividends),
  [Finnhub](https://finnhub.io) (news + earnings calendar) — both free tiers

## What it does

- **Ticker search** → live price, options chain (calls/puts) with delta, IV, and bid-ask spread flags
- **Covered-call calculator** → contracts, premium, static vs. if-called return (annualized),
  breakeven, downside protection, assignment scenario
- **Cash-secured-put calculator** → cash required, return on cash (annualized), cost basis if
  assigned, discount to current, assignment scenario
- **Upcoming Events** panel → next earnings date/time + ex-dividend, with an in-calculator
  ⚠️ flag when an event falls inside your option's expiration window
- **IV rank (home-grown)** → snapshots at-the-money IV daily into SQLite; rank becomes
  meaningful after the server has run for a couple of weeks
- **News panel** → recent headlines, newest first
- **System backtest** → one trade after another across your whole watchlist, levels
  re-derived on every trade from that day's bars only (no lookahead). Reports expectancy,
  profit factor, worst drawdown and worst losing streak, and flags the two things a headline
  number hides: whether the regime filter actually earns its keep, and whether one symbol is
  carrying the entire result
- **Out-of-sample discipline** → the sealed window's results are kept on the server and
  never sent to the browser until you explicitly unseal them. Every look is logged, and every
  distinct rule configuration you try is counted — because the more variants you test, the
  more the best-scoring one owes to luck. The validation window in between is the one you
  iterate against, so adjusting rules never has to spend the sealed one
- **Trade journal** → log a plan (or a replay) in one click, record the outcome later, and grade
  yourself on *process, not P&L*. P&L and R-multiple are derived from the plan you committed to,
  never typed in. The headline number is the split between trades where you followed your rules
  and trades where you didn't — the comparison that actually changes behaviour
- **Market regime panel** (home) → the four major indexes (SPY/QQQ/IWM/DIA) with trend and RSI
  direction, all 11 sector ETFs ranked by consecutive down weeks, breadth (share of the universe
  above its 200-day, with the week-over-week direction once history accrues), 52-week highs vs
  lows, and SPY realized volatility ranked against its own year. Every number is computed from
  daily bars the app already fetches — no new data provider and no paid breadth feed
- **Macro calendar** (home) → scheduled market-wide events. High-impact events landing inside an
  option's expiration get the same ⚠️ treatment as earnings. Pulls Finnhub's economic calendar
  where the plan includes it, and otherwise falls back to recurring releases plus events you type
  in yourself — so a date read in a market newsletter becomes a standing flag
- **Shared watchlist** → both users see the same saved tickers
- **Learn as you go** → instant hover tooltips on every column and field, a `? Help`
  reference (Quick Start, Covered Calls, Cash-Secured Puts, Reading the Chain, Glossary),
  and a guided `Tour` that auto-runs on first visit
- **Target-zone highlight** → optionally shades the ~0.20–0.35 delta band and stars the
  strike near 0.30 delta (a common income-selling heuristic — orientation, not advice)

## Setup

> **New here? The fastest path is [`SETUP.md`](SETUP.md)** — clone, run `npm run setup`, add your
> keys (in the app or `.env`), `npm start`. The steps below are the same thing in more detail.

1. **Install dependencies** (or just run `npm run setup`, which does this plus scaffolds `.env`)
   ```bash
   npm install
   ```

2. **Create `.env`** in the project root (never commit this — `.gitignore` protects it):
   ```
   ALPACA_API_KEY_ID=your_key_id
   ALPACA_API_SECRET_KEY=your_secret_key
   FINNHUB_API_KEY=your_finnhub_key
   PORT=3000
   ```
   - **Alpaca keys:** app.alpaca.markets → keep the Paper toggle on → API Keys panel →
     Generate. Paper keys work fine for market data. The free Basic plan uses the
     delayed `indicative` options feed.
   - **Finnhub key:** finnhub.io → free account → copy the API key.

3. **Run it**
   ```bash
   npm start          # foreground, for testing
   ```

## Running persistently with pm2

```bash
pm2 start server/index.js --name options-planner
pm2 save
```

To make it **restart automatically after a reboot**, run the startup command once
(it needs your Mac password):

```bash
sudo env PATH=$PATH:/opt/homebrew/Cellar/node/26.7.0/bin \
  /opt/homebrew/lib/node_modules/pm2/bin/pm2 startup launchd -u dionak --hp /Users/dionak
```

Useful pm2 commands:
```bash
pm2 logs options-planner     # tail logs
pm2 restart options-planner  # restart after code changes
pm2 stop options-planner     # stop
pm2 list                     # status
```

## Accessing over Tailscale

- The server binds `0.0.0.0`, so it's reachable at this Mac mini's Tailscale IP.
- **Find this machine's Tailscale IP** with `tailscale ip -4` (it looks like `100.x.x.x`), then
  open **http://100.x.x.x:3000** from any device on your tailnet.
- On your wife's device: install Tailscale, sign into the same tailnet, then open the
  same URL. (Her device must be connected to Tailscale.)
- If macOS pops up "allow incoming connections," click **Allow** so the port is reachable.

**Why Tailscale is the access approach (and *not* a public web app):** Tailscale is a private,
encrypted network only your devices can join, so it *is* the security boundary. The app has no
login and has endpoints that place (paper) trades, so exposing it to the public internet would mean
first building auth, HTTPS, and hardening — a lot of work to get back to the safety Tailscale gives
for free. Keep it tailnet-only. The raw IP works fine; the two items below are purely optional
niceties, not needed:

- **MagicDNS (optional):** turn it on in the Tailscale admin console to reach the app at a friendly
  hostname (e.g. `http://mac-mini.<your-tailnet>.ts.net:3000`) instead of the IP.
- **Tailscale Serve (optional):** puts HTTPS in front of the app at `https://…ts.net` (valid cert,
  no port number, still tailnet-only). Use `serve`, **not** `funnel` — `funnel` would expose it
  publicly, which you don't want.

## Use it like an app on your phone (Add to Home Screen)

You don't need the App Store or a native app — Trade Bench can live on your home screen as a
full-screen icon, over Tailscale. It's the same web app, just launched from an icon.

**Prerequisite:** Tailscale is installed and connected on the phone (same tailnet as the Mac mini),
so the app URL is reachable.

**iPhone / iPad (Safari):**
1. Open the app URL (the Tailscale IP or MagicDNS name) in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Tap the new icon — Trade Bench opens full-screen, like a native app.

**Android (Chrome) — an idea to try; not yet tested:**
1. Open the app URL in **Chrome**.
2. Tap the **⋮ menu** → **Add to Home screen** (or **Install app** if offered) → **Add**.
3. Tap the icon to launch it.

> ⚠️ The Android steps haven't been tested on a real device yet — they're the standard Chrome
> "Add to Home screen" flow and should work, but treat them as an experiment to try, not a
> guaranteed recipe.

**Desktop:** in Chrome, use the **Install** icon in the address bar (or ⋮ → **Install Trade Bench**)
for the same app-like, full-screen launch. Any browser can also just bookmark the URL.

_(A web app manifest + icon would make the home-screen icon and full-screen mode more polished — a
small future enhancement.)_

## Data notes

- The free data tier is **~15-minute delayed** — numbers track a delayed feed, not
  tick-by-tick. The app auto-refreshes every 60s in the background (and pauses when the
  browser tab is hidden). Upgrading Alpaca to real-time data needs no app changes.
- Earnings dates come from Finnhub's calendar; ex-dividends from Alpaca corporate actions.
  If a company's next dividend hasn't been announced yet, only the last one shows.
- **Breadth is over the universe the free tier can actually see** — the 11 sector ETFs plus your
  watchlist — not the S&P 500's members. The panel always states the universe size, because a
  breadth number without its universe doesn't mean anything. Like IV rank, the week-over-week
  direction only appears once the server has been running long enough to have history, and it is
  only shown when the universe hasn't changed size in between (otherwise the move would just be
  an artifact of adding a ticker).
- **Volatility is realized, not implied.** There's no free VIX feed here, and the leveraged VIX
  ETFs decay too much to stand in for the level, so the panel ranks SPY's own 20-day realized
  volatility against its past year instead. It answers the same question — is this a calm tape
  or a stressed one — with data that's actually available, and it's labelled as realized
  throughout so it's never confused with the VIX.
- **The economic calendar is premium on some Finnhub plans.** When the endpoint returns 403 the
  app says so plainly rather than showing an empty list, and falls back to the weekly release it
  can derive with confidence plus anything you've entered by hand. Nothing in the fallback
  guesses at a release date it can't justify.

## Project structure

```
trade-bench/
├── .env                 # API keys (gitignored)
├── package.json
├── SYSTEM.md            # the written trading rules the app is run against
├── data/planner.db      # SQLite (auto-created, gitignored)
├── server/
│   ├── index.js         # Express entrypoint, binds 0.0.0.0, daily snapshot jobs
│   ├── routes.js        # /api/quote, /news, /events, /ivrank, /regime, /econ,
│   │                    #   /watchlist, /journal, /backtest
│   ├── alpaca.js        # price + options chain + dividends
│   ├── finnhub.js       # news + earnings + economic calendar
│   ├── indicators.js    # shared indicator math (SMA, RSI, ATR, realized vol, weekly streaks)
│   ├── analysis.js      # per-ticker scorecard + watchlist scan
│   ├── regime.js        # market-wide regime: indexes, sectors, breadth, volatility
│   ├── econ.js          # macro calendar (feed + recurring rules + your own entries)
│   ├── replay.js        # the system's rules (deriveLevels/sizePosition) + single replay
│   ├── backtest.js      # the same rules as a sequence, across symbols and years
│   ├── paper.js         # Alpaca paper-trading client
│   ├── ivrank.js        # daily ATM-IV snapshot + rank
│   └── db.js            # SQLite (watchlist, iv_snapshots, settings, trades,
│                        #   tested_variants, oos_reveals, regime_snapshots, econ_events)
└── client/
    ├── index.html
    ├── styles.css
    ├── app.js           # search, chain, calculators, plan builder, journal, backtest
    ├── charts.js        # inline-SVG charts (price, payoff, equity curve, histogram)
    ├── help.js          # help modal content + guided tour
    └── tooltip.js       # instant hover tooltips
```
