# Trade Idea Practice

A working note on how to write a trade idea so it can be judged later.

Most of this came out of reading a weekly market newsletter closely — not for its
calls, but for the shape of them. Every idea in it carried a price, a level, a
target, and a line where the idea dies, and almost none of them were positions.
That format is the useful part. The gaps in it are useful too, and they're marked
below.

> Educational — a practice for planning and review, not financial advice.

Companion doc: [`SYSTEM.md`](SYSTEM.md) holds the standing rules — universe, regime
filter, sizing, exits — that an idea written this way gets measured against.

## Principles

**1. Invalidation before entry.**
Name what kills the idea before you describe the upside. Not a stop-loss — a
thesis death: *"below X, I'm no longer interested."* Decide it while you're calm
and have nothing on the line, because that's the only time you can decide it
honestly.

**2. Precise on the downside, vague on the upside.**
"Out below 100" / "maybe 115+". Never the reverse. You control where you quit;
you don't control where it goes. Most commentary inverts this, and the inversion
is what does the damage.

**3. A plan is not a position.**
A fully-specified idea you never trade is finished work, not failure. Most ideas
should expire unexecuted. That is the normal case, not a wasted week.

**4. Let price come to you — but know what it costs.**
Waiting means missing everything that never pulls back, and the things that never
pull back are often the best moves. Pullback vs breakout is a style to test per
name, not a law. (Trade Bench can settle it: `runReplay` takes an `entryStyle` of
`pullback` or `breakout` — run the same setup both ways and compare.)

**5. The invalidation sets the size.**
Distant or vague invalidation means a smaller position. No exceptions.

```
shares = (account x risk%) / (entry - invalidation)
```

Sizing is where most of the real risk lives, and it's the thing most published
ideas never mention. Two traders with identical plans and different sizing get
completely different outcomes.

**6. Missing a move is not a reason to take a worse version of it.**
The move you missed is gone. The only question is whether there is a *new* entry
with defined risk.

**7. Macro is context, not a trade.**
A weak tape raises the bar for entry. It does not generate a position. Nothing
about the Fed tells you what to own.

## Per-idea template

Every field filled, or the idea isn't ready.

```text
  Ticker         :
  Price now      :            <- anchor it, or you can never score it
  Date           :
  Bias           : bullish / bearish
  Key level      :            <- the zone that actually matters
  Entry style    : pullback / breakout / reclaim
  Entry trigger  :            <- a condition, not "here"
  INVALIDATION   :            <- fill this one FIRST
  Target         :            <- allowed to be vague
  Size at risk % :            <- derived from the invalidation
  Regime         : risk-on / mixed / risk-off
  Position       : none / open
  Note           :
```

Two fields do quiet work. **Price now** is the anchor — an idea without one can
never be checked against what happened. **Regime** is the one that pays off
slowly: after a few months of logged ideas you can finally ask whether your
breakout ideas work when breadth is falling.

## Weekly review

Mark every open idea as exactly one of:

| Status | Meaning |
|---|---|
| `triggered` | price reached the entry |
| `invalidated` | the level broke — the idea is dead, close it out |
| `target hit` | |
| `still waiting` | |
| `expired` | gone stale, no longer interesting |

Then count, across your last ~20 ideas:

- how many triggered
- how many hit target before invalidation
- **how many triggered and you didn't take** ← the one that matters

That last number is the gap between your plan and your behaviour. It's the one
figure no published watchlist will ever show you about its author.

## Where these came from

Principles 1, 2 and 6 are lifted from how the newsletter's ideas are written.
Principle 3 is the newsletter's *format* rather than anything it says out loud.

Principles 4, 5 and 7 are corrections — the places where it goes quiet (sizing is
never mentioned) or where copying the style without testing it would cost you.
The author noted in the same breath that she'd missed a 200-day crossover she'd
been watching; she missed it *because* she waits. That's the standing price of
patience, and it belongs in the method alongside the patience.
