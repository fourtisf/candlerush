# Score integrity

The game awards a balance. The balance unlocks content and will eventually touch a token.
A score submitted by a client is therefore a claim about money, and a client-reported score
is worth exactly nothing.

## The shape of it

> The server never receives a score. It receives a seed and a list of button presses,
> replays the game itself, and computes the score.

```
client                                   server
  │  POST /session/start                   │
  │ ─────────────────────────────────────► │  seed = crypto.randomInt(0, 2^31)
  │ ◄───────────────────────────────────── │  Session{OPEN, seed, map, char, handicap, v}
  │  {sessionId, seed, config}             │
  │                                        │
  │  plays 5,400 fixed frames locally      │
  │  records [frame, code] on every press  │
  │                                        │
  │  POST /session/submit                  │
  │  {sessionId, inputs, clientScore}      │
  │ ─────────────────────────────────────► │  runReplay(seed, map, char, handicap, inputs)
  │                                        │  → score, in a worker thread, 2s timeout
  │ ◄───────────────────────────────────── │  LedgerEntry{SESSION_PAYOUT, refId: sessionId}
  │  {score, credited, balance, rank}      │
```

`clientScore` is written to the session row and read by nobody. Its only job is to make a
determinism break visible before it becomes a leaderboard dispute.

## What makes the replay reproduce

A full session is 5,400 frames and replays in single-digit milliseconds, so the expensive
part is not the replay. It is keeping the two runs identical.

**Seeded gameplay randomness.** Every draw that can move a score comes from one mulberry32
stream: regime selection and duration, run lengths, candle kind, gap placement, slope,
body height, breather cadence, pip and power positions and counts. The order of the draws is
load-bearing — `pickRegime` makes one unconditional draw and one short-circuiting draw, and
swapping them changes every chart ever generated from every seed.

**Cosmetic randomness is not merely unseeded — it is absent.** Particles, weather, the star
field, screen shake, wick lengths and bob phases live in the renderer. The prototype drew
wick lengths and pip phases from the same stream as the world; those had to come out, and
they are now derived from each object's stable index instead. `packages/engine` contains no
call to `Math.random` at all, and both the Node suite and the browser suite poison
`Math.random` and `Date.now` and run a full session over the top to prove it.

**Fixed timestep.** The prototype's variable `dt` clamped to 45ms is non-deterministic by
construction: a 144Hz monitor generates a different world than a 60Hz one. `sim.step()`
advances exactly 1/60s and takes no wall-clock argument. Rendering interpolates between
steps; the simulation never sees it.

**Fixed viewport.** The prototype generated the world from the live canvas size. See
[QUESTIONS-FOR-ALFA #1](./QUESTIONS-FOR-ALFA.md#1-the-prototypes-world-depends-on-the-browser-window--blocking-changed).

**Everything that changes the run is in the session config.** Seed, map, character,
handicap, engine version. The handicap in particular had to move server-side: it feeds the
speed ramp, so a client-held copy is a client-side difficulty dial.

**Floating point is not a concern.** Both sides run the same JavaScript on IEEE-754 doubles
in the same order. No fixed-point arithmetic — it is not needed and it would introduce bugs.
This is asserted rather than assumed: 50 tapes generated in headless Chromium replay in Node
to identical scores *and* identical state digests, across 188,630 frames.

**Version the engine.** `ENGINE_VERSION` is recorded on every session and checked on submit.
A v1 tape replayed on a v2 engine produces garbage, and garbage that silently becomes money
is the worst failure this system has. Bump it on any gameplay change.

## Rejection rules

`POST /session/submit` rejects when:

| | |
|---|---|
| session unknown, already settled, or another player's | 404 / 409 |
| wall clock outside `[80s, 300s]` since issue | `TOO_FAST` / `TOO_SLOW` |
| engine version mismatch | `ENGINE_VERSION_MISMATCH` |
| frames non-monotonic, negative, fractional, or ≥ 5,760 | `FRAME_NOT_MONOTONIC` / `FRAME_OUT_OF_RANGE` |
| more than 12 presses in any 60-frame window | `INPUT_RATE_EXCEEDED` |
| tape continues after the run ended | `INPUT_AFTER_END` |
| replay exceeds its 2-second budget | `REPLAY_TIMEOUT` |

Rejected sessions are marked `REJECTED` with the reason and the tape kept. They are never
retryable — a session is immutable once settled either way.

The tap limit counts deliberate presses only. A jump *release* is not a tap, and counting it
would halve the real limit to six taps a second, which a mashing human can beat. Releases
are bounded separately at 30 events/second. The client applies the same 12/second throttle
to its own recording, so a masher gets a valid tape instead of a rejected session they
cannot explain.

Logged but **not** rejected on: a client/server score mismatch. That is the canary. Alert if
the mismatch rate across all players exceeds ~0.1%.

## What this does not solve

The seed is revealed to the client at session start, because the client has to render the
world. A determined attacker can pre-compute an optimal tape for that seed and submit a
perfect run. **Replay validation does not stop this.** It stops the trivial attack, which is
99% of attackers. Do not claim otherwise in user-facing copy.

Built now:

- **Input-timing fingerprinting.** Humans jitter (σ ≈ 20–40ms on reaction taps); optimal
  bots are frame-perfect. `Session.inputJitterMs` is the stddev of inter-press gaps; below
  `JITTER_FLAG_MS` the account is `flagged`. It is a heuristic, so it flags for review and
  **never auto-bans**.
- **Per-account caps are enforceable.** Off-chain balance is unlimited progression currency.
  Anything with real value gets a cap and a review queue, which the ledger makes checkable.

Policy, not code — flagged in
[QUESTIONS-FOR-ALFA #8](./QUESTIONS-FOR-ALFA.md#8-tournament-policy--code-exists-policy-does-not):
holding tournament payouts 24h for review, and requiring account age plus a minimum session
count before a wallet is payout-eligible.

## The ledger

Balance is the sum of an append-only table. There is no balance column and there never will
be: the moment one exists, some code path will write to it without a matching entry and the
truth becomes unrecoverable.

- `@@unique([refType, refId, kind])` makes double-crediting a session physically impossible
  at the database level rather than merely unlikely at the application level. The index is
  global, so purchases namespace their reference by player id — see
  [QUESTIONS-FOR-ALFA #9](./QUESTIONS-FOR-ALFA.md#9-the-ledgers-unique-index-is-global--item-purchases-are-namespaced).
- Concurrency control on submit is the status guard: only one request can move a session out
  of `OPEN`, and the ledger write rides in that transaction.
- Debits re-derive the balance from the rows inside a serializable transaction and retry on
  a write conflict. Redis caches the balance for display and is **never** consulted to decide
  whether someone can afford something.

## Tests that hold this up

| | where |
|---|---|
| same seed + inputs, 100 runs, identical digest | `packages/engine/test/determinism.test.ts` |
| 50 browser tapes replayed in Node, identical scores and digests | `packages/engine/test/cross-env.browser.ts` |
| engine never calls `Math.random` or `Date.now` | both of the above |
| generator invariants over 108,000 candles | `packages/engine/test/generator.test.ts` |
| malformed, out-of-order, over-length, too-fast tapes rejected | `packages/engine/test/replay.test.ts` |
| same session submitted twice credits exactly once | `apps/api/test/session.test.ts` |
| five concurrent submissions of one session credit once | `apps/api/test/session.test.ts` |
| concurrent purchases cannot overdraw | `apps/api/test/ledger.test.ts` |
| real browser: SIWE → play → server score matches exactly | `apps/web/test/e2e-wallet.ts` |
