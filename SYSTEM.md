# My Trading System

**Version 1 — written 2026-09-20. Provisional by design.**

Every number below is a starting point, not a conviction. The whole point of the
journal is to replace these guesses with evidence. See *Changing these rules* at
the bottom — that section matters as much as the rules themselves.

> This is my own operating document for a personal account. Not advice to anyone else.

---

## The rules

**1. What I trade**
**Common stock only.** Long positions, no options, no shorting.
Only symbols in my Trade Bench watchlist — the holdings in my Roth. I do not
trade tickers I heard about somewhere. Adding a name to the watchlist is a
separate, deliberate decision made outside market hours, never in the moment.

**2. When I'm allowed to buy**
Only in a **golden-cross regime** — the 50-day above the 200-day, shown on the
Trend card. If the Research view says death-cross regime, I skip the name. No
exceptions, no "but this one looks different."

**3. Where I enter**
A **buy-limit on a pullback to 20-day support** — the plan builder's default.
I place the order and wait. If it doesn't fill, that's a valid outcome and I
log it. I never buy at market because the chart looked good while I was
watching it.

I leave an order resting for **20 trading days**. After that the support level
it was based on is stale, so I cancel and re-plan from current levels rather
than letting a month-old price sit out there. *(This rule only exists because
the backtest refused to run without an answer to it — worth noticing how many
rules you're carrying implicitly until something forces you to state them.)*

**4. How much**
**0.5% of the Roth at risk per trade**, risk-based sizing, stop distance sets
the share count. If 0.5% won't buy a single share, the position is too big for
the account and I skip it rather than sizing up.

**5. How I exit**
Decided before entry, placed as a **bracket order**: profit target at 20-day
resistance, stop at ~2× ATR below entry. Then I leave it alone. Moving a stop
away from price is the single rule I am most likely to break, so it is the one
I grade hardest.

**6. What I don't do**
No options — not covered calls, not cash-secured puts. The Options tab stays a
place to learn and look, not part of my system. No shorting, no leverage, no
averaging down into a loser, no trading a name that isn't in the watchlist.

A rule about what I *don't* do is worth as much as one about what I do: it's
the list I can check against in the moment when something looks tempting.

---

## What I do each week

Once a week, outside market hours, in one sitting:

1. Run the watchlist scan. Note which holdings changed regime.
2. For anything in a golden-cross regime, build a plan and log it — including
   the ones I decide to pass on. **The trades I skip are half the data.**
3. Review every closed trade in the journal: record the outcome, grade whether
   I followed the rules, write one sentence of lesson.
4. Read my own discipline rate. That number, not the P&L, is the score.

Weekly, not daily. A system that needs daily attention isn't a system I can
actually run, and checking prices daily is how a plan turns into a reaction.

---

## Phases — how I earn the right to risk real money

I do not skip a phase because I feel ready. The journal decides.

**Phase 1 — Backtest only. No money, real or paper.**
Run **🧪 Test system** across the whole watchlist over 3–5 years. Before looking
at the output I write down what I expect the win rate and average R to be, so
the comparison is honest. Then I read the segments, not just the headline: by
symbol, by year, by regime.

*Advance when:* I can state from memory my system's **expectancy, worst
drawdown, and worst losing streak**, and the result isn't resting on one symbol
or one good year. If the headline is within about ±0.05R of zero, that is not a
near miss — it's no evidence the system works, and no commissions or slippage
have even been charged yet.

Also worth doing here: a handful of single replays in the Research tab, logged
to the journal one at a time. Not for the statistics — the backtest already has
those — but to learn the interface I'll be using for real.

**Phase 2 — Paper, mirroring the Roth.**
Mirror my actual Roth holdings into the paper account and run the system
alongside what I really do. Same portfolio, zero risk, a live A/B of me versus
my system.
*Advance when:* **20+ graded paper trades AND discipline rate ≥ 80%.**
Not when I'm profitable — when I'm *obedient*. Profit in paper proves nothing;
following the plan 8 times out of 10 proves something.

**Phase 3 — Real Roth money, smallest viable size.**
First real trades are on names **already held in the Roth** — applying the
entry and exit discipline to companies I've already decided I want to own. That
keeps *what I own* and *when I trade it* as two separate decisions, and it means
the first live rep tests my execution, not my stock picking. New names only once
that's routine.

---

## Why a Roth changes the math

Worth re-reading whenever 0.5% feels too small.

- **Contribution room is annual and gone forever.** A loss in a taxable account
  is money. A loss in a Roth is money *plus* permanently destroyed
  tax-advantaged space I cannot buy back at any price. This is the single
  strongest argument for sizing smaller than the usual 1–2% advice.
- **Losses aren't deductible.** No tax-loss harvesting, no consolation prize.
- **Gains are untaxed.** Genuinely favourable: taking a profit here costs
  nothing in tax, so I never hold a winner past my target for tax reasons. The
  target is the target.
- **It's a cash account — no margin.** Proceeds settle T+1, and buying with
  unsettled cash risks a good-faith violation. So I don't sell a position and
  immediately rebuy, and I keep enough settled cash that a fill never depends on
  a sale clearing first. This is the practical constraint most likely to bite a
  stock system in an IRA.

---

## Changing these rules

The failure mode isn't having imperfect rules — it's rewriting them after every
loss until nothing is left. So:

1. **Never mid-trade, never on a loss.** A stop being hit is the system working,
   not evidence against it.
2. **Only at a phase boundary, or after 30 more graded trades**, whichever comes
   later.
3. **Only with a number from the journal.** "This feels too tight" is not a
   reason. "My average loss is -1.4R against a planned -1.0R across 30 trades,
   so my stops are getting jumped" is a reason.
4. **One change at a time.** Two at once and I learn nothing from either.
5. **Log the change here with the date and the evidence.** The git history of
   this file is the record of how my thinking actually developed.

If the journal shows my rule-breaks *outperforming* my rules over a real sample,
that's data too — but the answer is to study what the overrides have in common
and write them into the rules, not to keep freelancing.

---

## Known guesses — revisit first

These are the numbers I made up. In priority order, once 30 reps exist:

| Rule | Current | What would change it |
|---|---|---|
| Risk per trade | 0.5% | Discipline ≥ 80% over 30+ trades → consider 1% |
| Entry style | Pullback only | Compare pullback vs breakout expectancy in replay |
| Stop distance | ~2× ATR | Average loss materially worse than -1.0R → widen |
| Regime filter | Golden cross only | Check how many skipped setups would have won |
| Hold period | No time limit | If winners resolve in ~20 days, dead trades tie up risk |
| Order resting time | 20 trading days | Compare fill rate and expectancy at 10 / 20 / 40 in the backtest |
| Stocks only | No options | Revisit only after a full phase cycle, if ever |

## Change log

- **2026-09-20** — v1 written. Nothing tested yet; every number is a starting guess.
- **2026-09-20** — v1.2: added the order-resting rule (20 trading days), which
  the backtest forced me to make explicit. Phase 1 rewritten around the batch
  backtest rather than 30 manual replays — same lesson, better evidence.
- **2026-09-20** — v1.1: scoped to common stock only. Options overlay removed
  and replaced with an explicit "what I don't do" rule; Phase 3 on-ramp changed
  from covered calls to stock trades in names already held.
