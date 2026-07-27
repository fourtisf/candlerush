# Questions and flags for ALFA

The handoff says to flag rather than silently work around. This is that list.

Items 1–4 are things I changed because Phase 1 could not be built otherwise; each says
exactly what changed and what it costs. Items 5–9 are decisions I could not make. Items
10–12 are unverified facts. Nothing in `C`, `CHARS`, `MAPS` or `REGIMES` was touched.

---

## 1. The prototype's world depends on the browser window — blocking, changed

**This is the one that had to change before anything else could work, and it is not in the
handoff.**

The generator is written in terms of the live canvas size:

```js
push(i*C.pitch, H*.55, 'doji', 44)                 // resetWorld
let ny = clamp(prev.y + dy, H*.22, H*.76)          // ensure
dy += (H*.5 - prev.y) * .07
const lim = cam + W + 600                          // generation horizon
S.cam = lerp(S.cam, P.x - W*C.px, ...)             // camera
```

So the same seed produces a different chart on a 1080p monitor than on a laptop, a
different one again on a phone — and none at all on a server, which has no window. Replay
validation is impossible while this is true, and so is a fair leaderboard.

**Changed to:** the simulation runs at a fixed `VIEW = 1280×720` (`packages/engine/src/config.ts`).
The generation horizon and cull distance became constants (`LOOKAHEAD`, `CULL_BEHIND`)
rather than viewport-derived — safe, because generation only ever reads the previous candle
and the RNG, so widening the horizon cannot change the candle sequence. The renderer scales
that band onto whatever canvas it has.

**What it costs:** the prototype adapted to portrait phones by generating a taller world.
A fixed viewport cannot. The client letterboxes (`contain`) and shows a rotate prompt below
820px in portrait. On a 390×844 phone the play area is a 1280×720 band about 220px tall.

**Decision needed.** Three options, in increasing cost:

1. **Landscape only on mobile** — what is implemented. Cheapest, and it is what the game's
   proportions already assume.
2. **A portrait profile** — a second `VIEW` (say 720×1280) selected at session start and
   recorded on the session. Determinism survives because the profile is part of the config.
   It is a genuinely different game though: different jump-to-gap ratios, different sight
   lines. It would need its own leaderboard, or the two are not comparable.
3. **Retune for a single portrait-friendly aspect** — needs your sign-off on the numbers.

I picked (1) because it is reversible and does not touch tuning. If mobile portrait is a
significant share of the funnel, (2) is the honest answer and it is a week of work.

## 2. The ambiguous band `(6, 46)` cannot be what was measured — test adjusted

The handoff asks for an invariant that no rise falls in `(6, 46)`. The prototype's own snap
resolves *into* that band:

```js
const rise = prev.y - ny;
if (rise > 6 && rise < 46) ny = prev.y - 14;   // the result is a 14px rise
```

A 14px rise is below the 24px auto-step threshold, so it is walkable — the player steps up
without jumping. The invariant that actually holds, and the one that matches the intent
("every rise is either a walkable step or an obvious jump"), is:

> `rise ≤ 24` (auto-step) **or** `rise ≥ 46` (obvious jump)

That is what `packages/engine/test/generator.test.ts` asserts, over 108,000 candles, and it
passes. **No generator code changed.** If your simulation measured the band as `(6, 46)`,
one of us is reading `C.step` differently and it is worth reconciling.

## 3. "No gap within 5 candles of a transition" — transition measured from where?

`noGap = 5` is set on the **first doji of the trend-change bridge**, not on the first candle
of the new colour. Measured from the bridge start the guarantee is exactly 5 candles.
Measured from the first candle of the new trend it is only 2.

There is also a case where "colour transition" is not defined at all: the generator can pick
a new run colour and then flip it back, so a bridge is laid down and the trend resumes in
the *same* colour. Measuring from the last colour change then gives a meaningless number.

I tested from the bridge start, because the bridge is where the player is being asked to act
and therefore where a gap would actually hurt. Say if you meant the other one — it would
mean raising `noGap`, which is a tuning change and needs your sign-off.

## 4. A legal tape is 5,760 frames, not 5,400 — limit adjusted

The handoff says to reject frame numbers beyond 5,400. That is the session length, and it
ignores the revive offer. In the prototype the revive countdown runs on a `setInterval`
while `update()` early-returns — the session clock is frozen, but the camera keeps drifting
at 62px/s, and the runway a revive splices in is positioned from wherever it drifted to.

So the frames keep coming. `MAX_FRAMES = 5400 + 360` (6 seconds of offer at 60Hz). Capping
at 5,400 would reject every session in which the player used their top-up.

## 5. The handicap had to move to the server — confirm the mechanic survives

`S.handicap` is persisted adaptive difficulty. It feeds the speed ramp, so it changes the
run, so a replay cannot be validated without it — and a client-held copy is a client-side
difficulty dial. It now lives on `Player.handicap`, is issued with the session config, and
is recomputed server-side from the server's own candle count after each submission. The
formula is unchanged (`< 60 → +0.22`, `> 170 → −0.3`, clamped).

Worth knowing: this is now visible. A player who compares two sessions can tell the game got
easier. It was invisible in the prototype because nothing ever left the browser.

## 6. Pausing spends the submission window

The wall-clock check is now `[2s, 900s]` from issue, plus a floor derived from the tape
itself: a run of N frames took at least N/60 seconds to produce, so anything submitted
faster than its own length is rejected. That replaced a flat `[80s, 300s]`, which under
levels rejected every short run as `TOO_FAST` and every deep one as `TOO_SLOW`.

The ceiling still doubles as the pause budget: a fifteen-level run is about 495 seconds of
play, leaving roughly 400 seconds of pausing across its whole life.

The client currently auto-resumes with a warning when 30 seconds of budget remain. That is a
guess. The alternatives are: no pause in ranked sessions; or a longer ceiling, which weakens
the "too slow means they were computing" signal — though that signal is weak anyway, since
the real precompute attack (§3.4) happens before the session is even started.

**Which do you want?**

## 7. Guest migration is a client-reported number reaching the ledger

The handoff asks for guest play with a one-time carry-over, and also says never to trust a
client-reported score. Those conflict, and I have implemented the carry-over because losing
the funnel is worse.

It is bounded three ways: a hard cap (`GUEST_MIGRATION_CAP`, default 50,000), brand-new
accounts only (zero sessions, zero ledger entries), and a unique ledger reference so it can
physically happen only once per player.

**The commitment that matters:** guest-migrated balance must never become redeemable for
anything with real value. If $CANDLE claims are ever derived from balance rather than from
validated sessions, this becomes a mint. Phase 3 should compute entitlement from the session
table, not from the balance.

## 8. Tournament policy — code exists, policy does not

§3.4 lists four mitigations. The first two are built: input-timing jitter sets `flagged`
(never bans), and the ledger makes per-account caps enforceable. The last two are policy:

- **Hold payouts 24h and review the top N replays.** Every tape is stored (`Session.replay`),
  so the review is possible today. Nobody has said who does it or against what bar.
- **Account age plus a minimum session count before a wallet is payout-eligible.** Not
  implemented — the thresholds are a business decision.

Also unanswered from §12: **who reviews flagged accounts?** There is a `flagged` column and
nothing that reads it. An automated system with no human in the loop will eventually ban a
real player.

## 9. The ledger's unique index is global — item purchases are namespaced

`@@unique([refType, refId, kind])` is table-wide, not per player. Session ids are globally
unique so `refId = sessionId` is correct as specified. Item ids are not: `refId = "fox"`
would mean the first player ever to buy the Fox is the only player who can.

Purchases therefore use `refId = "{playerId}:{itemId}"`. Worth knowing if you ever query the
ledger by reference.

## 10. Robinhood Chain's chain id and RPC are unverified

`https://docs.robinhood.com/chain` returned **HTTP 403** from the build environment, so I
could not read it, and the handoff is explicit about not filling this in from memory.

`RHC_CHAIN_ID` is therefore a **required environment variable with no default** — the API
refuses to boot without it. A wrong chain id does not fail loudly; it silently accepts SIWE
signatures that were scoped to a different network. Please supply the value, or confirm the
docs URL.

`RHC_RPC_URL` is optional: plain EOA signatures are verified locally by recovery. It is only
needed for smart-contract wallets (ERC-1271).

## 11. The 90-day gas reduction programme — not verified

Same reason. Nothing in Phase 1 or 2 depends on gas, and nothing is architected around the
subsidy, so this only matters when Phase 3 is planned.

## 12. Two prototype layout collisions, fixed

Both in a clearly marked block at the bottom of `apps/web/app/globals.css`; revert either if
they were deliberate.

- `#regime` and the session clock are both centred at the top of the HUD, so
  `— BREAKOUT —` prints straight through `CLOSE IN`. Moved the banner below the clock.
- `.wal` and `.pk` labels are inline `<span>`s carrying a `margin-top`, so they sit side by
  side instead of stacking the way the rule intends. Made them block.

---

## Deferred, per instructions

`packages/contracts` is empty. Phase 2 (share cards, challenge links, ghost replays,
tournaments) is not started. Both are Phase 1's dependents and the handoff says not to build
ahead — the tapes needed for ghosts and challenges are already being stored, so Phase 2 is
mostly UI on top of data that exists.
