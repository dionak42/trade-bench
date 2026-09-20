# My Trading System

**Version 1 — written 2026-09-20. Provisional by design.**

Every number below is a starting point, not a conviction. The whole point of the
journal is to replace these guesses with evidence. See *Changing these rules* at
the bottom — that section matters as much as the rules themselves.

> This is my own operating document for a personal account. Not advice to anyone else.

---

## The rules

**1. What I trade**
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

**4. How much**
**0.5% of the Roth at risk per trade**, risk-based sizing, stop distance sets
the share count. If 0.5% won't buy a single share, the position is too big for
the account and I skip it rather than sizing up.

**5. How I exit**
Decided before entry, placed as a **bracket order**: profit target at 20-day
resistance, stop at ~2× ATR below entry. Then I leave it alone. Moving a stop
away from price is the single rule I am most likely to break, so it is the one
I grade hardest.

**6. Income overlay — not yet**
Covered calls on Roth holdings of 100+ shares, ~0.30 delta, ~30 DTE. Locked
until Phase 3 below. Only on shares I'd be content to see sold at the strike.

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

**Phase 1 — Replay only. No money, real or paper.**
Run historical replays across watchlist names and varied start dates. Log
every rep.
*Advance when:* **30+ logged replay reps.** Before looking at the stats, I
write down what I expect my win rate and average R to be. Then I compare. Being
wrong about my own system is the lesson of this phase.

**Phase 2 — Paper, mirroring the Roth.**
Mirror my actual Roth holdings into the paper account and run the system
alongside what I really do. Same portfolio, zero risk, a live A/B of me versus
my system.
*Advance when:* **20+ graded paper trades AND discipline rate ≥ 80%.**
Not when I'm profitable — when I'm *obedient*. Profit in paper proves nothing;
following the plan 8 times out of 10 proves something.

**Phase 3 — Real Roth money, smallest viable size.**
Covered calls on existing holdings first (no new position, no new capital).
New stock positions only after that's routine.

---

## Why a Roth changes the math

Worth re-reading whenever 0.5% feels too small.

- **Contribution room is annual and gone forever.** A loss in a taxable account
  is money. A loss in a Roth is money *plus* permanently destroyed
  tax-advantaged space I cannot buy back at any price. This is the single
  strongest argument for sizing smaller than the usual 1–2% advice.
- **Losses aren't deductible.** No tax-loss harvesting, no consolation prize.
- **Gains and assignments are untaxed.** Genuinely favourable: covered calls and
  assignment create no tax event here, so the usual "don't call away a low-basis
  holding" objection doesn't apply to me.
- **It's a cash account — no margin.** No shorting, no naked options. Cash-secured
  puts need the full cash parked. Proceeds settle T+1; spending unsettled cash
  risks a good-faith violation, so I don't sell and immediately rebuy.
- **Options approval is broker-specific.** Confirm the IRA's approval level
  before Phase 3 assumes covered calls are available.

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

## Change log

- **2026-09-20** — v1 written. Nothing tested yet; every number is a starting guess.
