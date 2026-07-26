# Architecture

```
candle-rush/
├─ packages/
│  ├─ engine/                 pure TS, no DOM, no clock, no unseeded randomness
│  │  ├─ src/
│  │  │  ├─ rng.ts            mulberry32, with inspectable state
│  │  │  ├─ config.ts         C{}, CHARS[], MAPS[], REGIMES{} — verbatim from the prototype
│  │  │  ├─ types.ts          world, player, inputs, events, snapshot, replay result
│  │  │  ├─ generator.ts      World: ensure(), push(), isSolid(), computeWarnings()
│  │  │  ├─ player.ts         landing sweep, recovery and flip-target searches
│  │  │  ├─ sim.ts            Sim: step(), applyInput(), snapshot()
│  │  │  ├─ digest.ts         final-state fingerprint for divergence hunting
│  │  │  └─ replay.ts         runReplay(config, inputs) -> ReplayResult
│  │  └─ test/                determinism, generator invariants, replay rejection, cross-env
│  └─ contracts/              Phase 3. Empty on purpose.
├─ apps/
│  ├─ web/                    Next.js 14, App Router
│  │  ├─ components/game/     renderer, fixed-timestep loop, sprites, audio — zero logic
│  │  ├─ components/ui/       HUD and screens
│  │  └─ lib/                 api client, wagmi, siwe, account state, guest storage
│  └─ api/                    Fastify 4
│     ├─ src/routes/          auth, me, session, shop, leaderboard
│     ├─ src/services/        ledger, leaderboard, siwe, replay pool + worker
│     └─ prisma/schema.prisma
└─ docs/
```

## The one rule everything else follows from

`packages/engine` is the single source of truth for what a score means, and it runs
unmodified in both the browser and Node. Everything else in the repo is either feeding it
inputs or drawing its output.

It therefore imports nothing from the DOM, `window`, `performance`, `Date` or `Math.random`.
If it did, it could not run on the server, and if it could not run on the server the server
would have to believe the client. See [SCORE-INTEGRITY.md](./SCORE-INTEGRITY.md).

## Renderer and simulation

The prototype interleaves them; here they are separate processes that meet at two places.

- **`sim.snapshot()`** — a read-only view of candles, player, pips, powers, buffs and HUD
  values. The renderer draws that and nothing else. The type is readonly; if the renderer
  ever writes to sim state, that is a bug and the compiler will say so.
- **`sim.drainEvents()`** — a list of things that happened this frame: jumped, landed,
  flipped, stumbled, bell rang, died. The renderer turns those into particles, screen shake
  and sound; the UI turns them into toasts. Events never feed back into the simulation, and
  the engine does not collect them at all unless asked, so a server replay allocates nothing
  for an audience that is not there.

`drawChar()` is shared between the in-game player and the character-select thumbnails, as
the handoff asks, so the picture on the shop card and the thing you control cannot drift.

Cosmetic state that the prototype stored on world objects — candle wick length, pip bob
phase — is derived in the renderer from each object's stable index. Same visual result,
stable frame to frame, and no draws from the engine's RNG.

## The frame

```ts
const STEP = 1 / 60;
acc += Math.min((now - last) / 1000, 0.25);
while (acc >= STEP && sim.mode !== 'ended') {
  applyQueuedInputs();     // stamped with sim.frame — this is the tape
  sim.step();
  renderer.consume(sim.drainEvents());
  acc -= STEP;
}
renderer.render(sim.snapshot(), acc / STEP);   // interpolate for the eye, never for logic
```

An input is recorded on the frame it is *applied* to, not the moment the DOM event fired.
Two players on different refresh rates therefore record the same frame for the same reaction
time, and the server replays what they actually did.

## Request flow

| | |
|---|---|
| `POST /auth/nonce` `{address}` | single-use nonce, Redis, 5 min |
| `POST /auth/verify` `{message, signature}` | SIWE via viem, httpOnly JWT, 7 days |
| `GET /me` | player + balance |
| `POST /me/name` `{name}` | |
| `POST /me/migrate-guest` `{balance}` | one-time, capped, new accounts only |
| `POST /session/start` `{mapId, charId}` | server picks the seed; refuses unowned content |
| `POST /session/submit` `{sessionId, inputs, clientScore}` | replays, credits, ranks |
| `POST /shop/unlock` `{itemId}` | price from the engine's config, never the client's |
| `GET /leaderboard?window=` | daily / weekly / all-time |

Every request and response body is validated with Zod. No exceptions.

## Data

Balance is the sum of an append-only ledger; sessions are immutable once settled. Those two
are not negotiable and the schema enforces them rather than trusting the application to.
Leaderboards are Redis sorted sets holding player ids and scores only — names are joined at
read time, so a rename does not rewrite every board — and are rebuildable from Postgres,
because Redis holds a derived fact and losing it must not lose a leaderboard.

## Replay isolation

`runReplay` is CPU-bound and fast, so the worker-thread pool is not about throughput. It is
about blast radius: a malformed or adversarial tape must never hang the API. A worker that
overruns its 2-second budget is terminated and replaced rather than waited on. Set
`REPLAY_INLINE=1` to run replays in-process instead (used by the test suite).

## Deliberately not built

- `packages/contracts` — Phase 3, and only if Phase 1 retention justifies it.
- Share cards, `?challenge={seed}` links, ghost replays, tournaments — Phase 2. Every input
  tape is already stored, so ghosts and challenges are mostly UI on top of data that exists.
- An admin surface. `Player.flagged` is written and nothing reads it yet; see
  [QUESTIONS-FOR-ALFA #8](./QUESTIONS-FOR-ALFA.md#8-tournament-policy--code-exists-policy-does-not).
