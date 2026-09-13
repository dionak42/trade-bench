# Trade Bench

A personal trade-planning and paper-practice tool. Three views per ticker:

- **🔍 Research** — technical scorecard (trend, RSI, volatility, support/resistance),
  a bracket **trade-plan builder** (entry / target / trailing stop with risk-reward math),
  and **historical replay** to backtest a stock plan against past prices.
- **📊 Options** — covered-call and cash-secured-put planning off a live options chain
  with greeks, upcoming events (earnings + ex-dividends), IV rank, and news.
- **📈 Paper** — place plans as real orders in an Alpaca **paper account** (stocks via
  bracket orders, plus covered calls / CSPs) and track positions, orders, and P&L.

Plus a shared watchlist, an interactive course, and a guided tour. Runs on a Mac mini and is
reachable by two people over Tailscale — no login, no public internet exposure.

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
- **Shared watchlist** → both users see the same saved tickers
- **Learn as you go** → instant hover tooltips on every column and field, a `? Help`
  reference (Quick Start, Covered Calls, Cash-Secured Puts, Reading the Chain, Glossary),
  and a guided `Tour` that auto-runs on first visit
- **Target-zone highlight** → optionally shades the ~0.20–0.35 delta band and stars the
  strike near 0.30 delta (a common income-selling heuristic — orientation, not advice)

## Setup

1. **Install dependencies**
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
- **This machine's Tailscale IP:** `100.108.93.36` → open **http://100.108.93.36:3000**
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

## Project structure

```
call-put-calc/
├── .env                 # API keys (gitignored)
├── package.json
├── data/planner.db      # SQLite (auto-created, gitignored)
├── server/
│   ├── index.js         # Express entrypoint, binds 0.0.0.0, IV-snapshot job
│   ├── routes.js        # /api/quote, /news, /events, /ivrank, /watchlist
│   ├── alpaca.js        # price + options chain + dividends
│   ├── finnhub.js       # news + earnings calendar
│   ├── ivrank.js        # daily ATM-IV snapshot + rank
│   └── db.js            # SQLite (watchlist + iv_snapshots)
└── client/
    ├── index.html
    ├── styles.css
    ├── app.js           # search, chain, calculators, auto-refresh, target zone
    ├── help.js          # help modal content + guided tour
    └── tooltip.js       # instant hover tooltips
```
