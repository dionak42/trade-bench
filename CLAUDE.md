# Trade Bench — notes for Claude

A personal trade-planning and paper-practice tool. Single user (plus spouse),
runs on a Mac mini, reached over Tailscale.

## Deployment — read this before suggesting commands

| | |
|---|---|
| Host | a Mac mini, served tailnet-only over Tailscale (no auth, by design) |
| **Repo path on that machine** | **`~/code_projects/trade-bench`** |
| Process manager | pm2 |

Update and restart:

```
cd ~/code_projects/trade-bench && git checkout main && git pull origin main && pm2 restart all && pm2 list
```

`pm2 restart all` avoids a name mismatch — the process has been registered as
both `trade-bench` and `options-planner` in different docs.

## Stack and conventions

- Node 22+, ESM, **no build step and no framework**. Keep it that way.
- Only runtime dependencies are `express` and `dotenv`. Adding a third needs a
  real reason.
- SQLite through Node's built-in `node:sqlite` (`DatabaseSync`) — no native
  compile. It binds only `null`/number/string, so coerce at the boundary.
- Client is plain HTML/CSS/JS loaded as classic scripts (not modules), so
  top-level functions are shared across files via `window`.
- Charts are hand-rolled inline SVG in `client/charts.js` — no chart library.
  They use CSS variables (`stroke="var(--good)"`) so they follow the theme.
- Data: Alpaca (prices, options chain, paper trading) and Finnhub (news,
  earnings, economic calendar). Free tiers, roughly 15-minute delayed.

## The trading system itself

`SYSTEM.md` holds the user's written rules; `TRADE_IDEA_PRACTICE.md` covers how
to write a single trade idea. `SYSTEM.md` wins where they disagree.

**The rules exist in code in exactly one place:** `deriveLevels()` and
`sizePosition()` in `server/replay.js`. The plan builder, the single replay and
the backtest all read from them. Never reimplement the levels anywhere else — if
they drift, the backtest stops testing what the app actually places.

## Invariants worth protecting

- **No lookahead.** `deriveLevels(bars, idx)` reads only bars strictly before
  `idx`. The test that proves it: truncate future bars, re-run, and earlier
  trades must be byte-identical.
- When one daily bar spans both the stop and the target, the backtest books the
  **stop**. Assuming the good fill is how a backtest flatters itself.
- Journal P&L and R-multiple are **derived server-side** from the committed
  plan, never posted by the browser. Writes go through a column allowlist, so
  `id` and `planned_at` aren't client-settable.
- Out-of-sample results are computed but **deleted in the route** unless the
  caller explicitly asks to unseal them. Only the pending count goes out.
- **Every view-opener must hide every home-page panel.** That means
  `loadSymbol`, `openPaper`, `openJournal` and `openBacktest` each hiding
  `#empty-state`, `#scan-panel`, `#regime-panel` and `#macro-panel`. Adding a
  new panel means updating all of them — git merges this file cleanly and still
  leaves the bug.

## Testing

There is no test framework. Verify with throwaway scripts and a real browser,
then delete them.

- Chromium is preinstalled at `/opt/pw-browsers/chromium`. Never run
  `playwright install`.
- `runBacktest()` and `runReplay()` both take an injectable `fetchBars`, so the
  whole pipeline can run against deterministic synthetic history with no live
  feed. Use a seeded LCG, not `Math.random`, so failures reproduce.
- Drive the UI with Playwright and `page.route()` stubs for the `/api/*` calls
  that need market data.
- **Gotcha that has already caused one real bug:**
  `addEventListener('click', fn)` passes the click Event as `fn`'s first
  argument, and an Event is truthy. Always wrap a handler that takes parameters:
  `addEventListener('click', () => fn(false))`.

## Local development

```
npm start          # PORT env var to change the port
```

In a sandbox, `curl` needs `--noproxy '*'` to reach `localhost`.
