# Candle Rush

A ninety-second endless runner where the terrain is a candlestick chart. Ride the candles,
flip your position when the tape turns, and bank whatever P&L is on the table when the
closing bell rings.

This repository is the production build. The original single-file prototype — which is the
design spec, and still playable on its own — lives in [`prototype/index.html`](prototype/index.html).

```
packages/engine   the simulation. Deterministic, pure, runs in the browser and in Node.
apps/web          Next.js 14 client. Renders the engine, handles wallet, shop, leaderboard.
apps/api          Fastify server. Issues sessions, replays tapes, owns the ledger.
packages/contracts  Phase 3. Empty on purpose.
```

## The one interesting problem

The game awards a balance, the balance unlocks content, and it will eventually touch a
token. That makes a submitted score a claim about money, and **a client-reported score is
worth nothing** — anyone can `fetch('/api/submit', {score: 99999999})`.

So the server never receives a score. It receives a seed it generated itself and a list of
button presses, replays the game, and computes the score. Everything else in this repo is
downstream of that: the engine is pure so it can run on a server, the timestep is fixed so
two machines agree on what frame it is, and gameplay randomness is seeded so the same seed
is the same chart everywhere.

It is verified rather than asserted — 50 tapes generated in headless Chromium replay in Node
to identical scores and identical state digests, and a full browser run signs in with a
wallet, plays ninety seconds and lands on a server-computed score that matches its own.

Read [docs/SCORE-INTEGRITY.md](docs/SCORE-INTEGRITY.md) before changing anything in
`packages/engine`. It also says plainly what this design does *not* stop.

## Running it

Needs Node 20.11+, pnpm 10, Postgres and Redis.

```sh
pnpm install
pnpm --filter @candle-rush/engine build

cp apps/api/.env.example apps/api/.env         # then fill in RHC_CHAIN_ID — see below
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @candle-rush/api exec prisma migrate deploy
pnpm dev                                       # api on :4000, web on :3000
```

`RHC_CHAIN_ID` has no default and the API will not boot without it. That is deliberate: a
wrong chain id does not fail loudly, it silently accepts SIWE signatures scoped to a
different network. See [QUESTIONS-FOR-ALFA #10](docs/QUESTIONS-FOR-ALFA.md#10-robinhood-chains-chain-id-and-rpc-are-unverified).

A wallet is optional. Guests play with their progress in localStorage; those sessions are
unranked and the UI says so.

## Tests

```sh
pnpm test                                       # engine unit + API integration
pnpm --filter @candle-rush/engine test:browser  # Chromium tapes replayed in Node
pnpm --filter @candle-rush/web smoke            # browser guest run, needs a live web server
pnpm --filter @candle-rush/web e2e              # full wallet run, ~2 min, needs the stack
```

The API suite runs against a real Postgres and a real Redis — the things worth testing there
are database behaviours (a unique index that makes double-crediting impossible, serializable
isolation on a debit) and mocking them would only test the mock. Point
`TEST_DATABASE_URL`/`TEST_REDIS_URL` at throwaway instances; the suite truncates between
tests.

The engine tests are the ones that genuinely matter. Without them you will ship a
determinism bug and silently mint money.

## Playing

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump / double jump | `Space` · `W` · `↑` | Tap left half |
| Flip long ↔ short | `Shift` · `S` · `↓` · `E` | Tap right half |
| Pause | `P` · `Esc` | Pause chip |
| Mute | `M` | Sound chip |

Releasing jump early cuts the jump short.

**Position matters.** While long, green candles are solid and red ones are holes; while
short, the reverse. Gold doji are always solid, which makes them the bridges you flip on —
the ones that need a flip are marked with a pulsing `FLIP` arrow. The candle you are
standing on never drops out from under you, so a mistimed flip costs you the tape ahead, not
your footing.

**The clock.** Ninety seconds. At twenty seconds remaining the closing bell doubles all P&L
and speeds the tape up. Land on a candle's leading edge for a perfect bounce; chain landings
for a streak multiplier up to ×10, halved when you stumble.

**Liquidation.** Fall off the chart and you are out. Once per session, after twelve candles,
you can add margin: a fresh doji runway, a free stop loss, and your P&L intact.

## Contributing rules that are not style preferences

- Never trust a client-reported score. Not once, not for "just the leaderboard", not in dev.
- Never mutate a balance column. There is no balance column. Append to the ledger.
- Never let the renderer write to simulation state.
- Never read wall-clock time inside the engine.
- Never accept a price, an unlock list, or a map/character id from the client without
  checking it server-side.
- Never auto-ban on a heuristic. Flag, queue, review.
- Do not change gameplay tuning. Every number in `packages/engine/src/config.ts` was tuned
  against a 163,000-candle simulation. If one looks wrong, open an issue with the value and
  your reasoning.
- Bump `ENGINE_VERSION` on any gameplay change. A tape replayed on the wrong engine produces
  garbage, and garbage that becomes money is the worst thing this system can do.

## Where things stand

Phase 1 is built: monorepo, engine extraction, determinism, fixed timestep, renderer
separation, Fastify + Prisma + Redis, SIWE, session issue/validate/credit, shop, daily,
weekly and all-time leaderboards, guest play.

**Read [docs/QUESTIONS-FOR-ALFA.md](docs/QUESTIONS-FOR-ALFA.md) before Phase 2.** It lists
four things that had to change for Phase 1 to be possible at all — the largest being that
the prototype generates its world from the browser window size, which no server can
reproduce — and five decisions that are yours rather than engineering's.

Phase 2 (share cards, challenge links, ghost replays, tournaments) and Phase 3 (on-chain)
are not started, per the handoff's instruction not to build ahead. Every input tape is
already being stored, so ghost replays and challenge links are mostly UI over data that
exists.
