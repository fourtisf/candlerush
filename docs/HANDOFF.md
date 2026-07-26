# CANDLE RUSH — Production Build Handoff

**For:** Claude Code
**Owner:** ALFA
**Prototype:** `candle-rush-v3.html` (single file, attached — read it fully before writing any code)
**Target chain:** Robinhood Chain (Arbitrum Orbit L2, ETH gas, EVM)

---

## 0. Read this first

You are building the production version of a browser game that already exists as a working single-file prototype. **The prototype is the design spec.** Do not redesign the game. Do not "improve" the mechanics, retune the difficulty, or change the art direction. Every number in it — gravity, jump velocity, coyote time, trend lengths, doji bridge widths — was tuned and validated against a simulation of 163,000 generated candles. If you think something is wrong, flag it and ask; do not silently change it.

Your job is to turn one HTML file into a system that can take real money and real players without falling over.

There is exactly one genuinely hard problem in this build, and it is **not** the graphics, the wallet, or the smart contracts. It is score integrity. Read §3 before you plan anything else.

---

## 1. What exists today

`candle-rush-v3.html` — a complete, playable game in ~58KB with zero dependencies.

**Gameplay.** A 90-second endless runner where the terrain is a candlestick chart. The player auto-runs right and jumps between candle tops. On maps above tier 1, the player also holds a **position**:

- **LONG** → green candles are solid, red candles are holes
- **SHORT** → red candles are solid, green candles are holes
- **Doji** (gold) → always solid; these form 3–4 candle "bridges" at every trend change

The candle the player is currently standing on is **always solid regardless of position**. Flipping only changes the tape *ahead* of the player. This rule is load-bearing — without it, flipping while grounded is instant death. Do not remove it.

The chart is generated in **regimes** (DRIFT / BREAKOUT / SELL-OFF / CHOP) that each last 50–86 candles, producing trends averaging 25 candles. This yields roughly 19 forced position flips per session — one decision every ~4.7 seconds.

The last 20 seconds are the **closing bell**: 2× P&L, +12% speed, sky shifts warm.

**Meta.** Session P&L is credited to a persistent account balance. Balance unlocks 6 characters and 4 markets. Markets are a difficulty ladder — tier 1 (Dawn) is long-only with no holes and no flip button at all; shorting is introduced only when the player buys tier 2.

**Currently faked or missing:**
- Wallet connect is UI only — it calls `eth_requestAccounts` if a provider exists, otherwise generates a fake address. No signature, no verification.
- All state lives in a single client-side key/value blob. Anyone can open devtools and set their balance to a billion.
- No leaderboard, no server, no token, no contracts.

---

## 2. What you're building

A monorepo containing:

1. **`packages/engine`** — the game simulation, extracted from the prototype, made fully deterministic, and runnable in *both* the browser and Node. This is the single source of truth for what a score means.
2. **`apps/web`** — Next.js 14 (App Router) client. Renders the engine, handles wallet, shop, leaderboard.
3. **`apps/api`** — Fastify server. Issues sessions, validates replays, owns the ledger, serves leaderboards.
4. **`packages/contracts`** — Foundry project. Deferred to Phase 3; do not start here.

Stack (matches ALFA's existing infrastructure — do not substitute):
- pnpm workspaces, TypeScript strict everywhere
- Next.js 14, React 18
- Fastify 4, Zod for all request/response schemas
- Prisma + PostgreSQL
- Redis (leaderboards, rate limits, session tokens)
- viem + wagmi + SIWE for wallet auth
- PM2 on Hostinger VPS, deployed from GitHub

---

## 3. THE HARD PART: score integrity

**Read this section twice.**

The game awards a balance. The balance unlocks content and will eventually touch a token. That means a score submitted by the client is a claim about money. **A client-reported score is worth exactly nothing.** Anyone can `fetch('/api/submit', {score: 99999999})`.

Every naive fix fails:

- *Obfuscate/minify the client* — trivially defeated, buys you days
- *Sign the score client-side* — the signing key ships to the attacker
- *Checksum the score* — the checksum function also ships
- *Rate limit implausible scores* — the attacker submits plausible ones, forever

There is exactly one approach that actually works, and the whole architecture depends on it:

> **The server never receives a score. It receives a seed and a list of button presses, replays the game itself, and computes the score.**

### 3.1 How it works

1. Client asks to start a session. **Server** generates a random `seed` (client must never choose it), stores it, returns `{sessionId, seed, mapId, charId, engineVersion, issuedAt}`.
2. Client runs the engine locally with that seed. The world it generates is identical to what the server will generate.
3. Client records an **input tape**: every jump press, jump release, and flip, stamped with the fixed-timestep frame number.
4. On session end, client POSTs `{sessionId, inputs}`. It may also send its own computed score — but only so the server can log mismatches. **The client score is never used.**
5. Server loads the same engine, same seed, same map/char, feeds it the input tape, runs all 5,400 frames, and reads off the score.
6. Server writes that score to an append-only ledger.

This works because 90 seconds at 60Hz is only 5,400 frames, and a full replay costs single-digit milliseconds in Node. A typical tape is 200–400 inputs, a few KB.

### 3.2 Determinism requirements

This is the actual refactor work. The prototype is **not** deterministic today. To make it so:

**Seeded PRNG.** Replace every gameplay `Math.random()` with a seeded generator. Use mulberry32 — small, fast, well-distributed:

```ts
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

**Split gameplay randomness from cosmetic randomness.** Only randomness that affects the score needs seeding. Getting this wrong in either direction is bad: seed too little and replays diverge; seed too much and you waste effort and couple visuals to the sim.

Must be seeded (in `ensure()` and its helpers): regime selection, regime duration, trend run lengths, candle kind, gap placement, `dy` slope, `bodyH`, breather cadence, `dropPips` / `arcPips` positions and counts, `spawnPower` position and kind.

Must **not** be seeded (leave as `Math.random()`): all `burst()` particles, ambient weather particles, the star field, candle `wick` lengths, pip/power bob phases, screen shake offsets. These are cosmetic only. Verify each one before you move it.

**Fixed timestep.** The prototype uses variable `dt` clamped to 45ms. That is non-deterministic by construction — a player on a 144Hz monitor gets a different world than one on 60Hz. Replace with an accumulator:

```ts
const STEP = 1 / 60;
let acc = 0;
function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (acc >= STEP) { sim.step(STEP); acc -= STEP; }
  render(sim, acc / STEP); // interpolate for smoothness, never for logic
  requestAnimationFrame(frame);
}
```

Rendering may interpolate. Simulation must not. `sim.step()` takes no wall-clock time as input, ever.

**No floating-point drift concerns.** Both client and server run the same JS engine on IEEE-754 doubles with identical operation order. This is fine. Do not attempt fixed-point math — it is not needed here and will introduce bugs.

**Engine must be pure.** `packages/engine` imports nothing from the DOM, `window`, `performance`, or `Date`. If it does, it cannot run on the server. Rendering lives entirely in `apps/web` and reads engine state; the engine never draws.

**Version the engine.** Every session records `engineVersion`. When you change gameplay, bump it. Reject replays whose version doesn't match — a v3 tape replayed on a v4 engine produces garbage, and garbage that silently becomes money is the worst possible failure.

### 3.3 Validation rules on submit

Reject the submission if any of these fail:

- `sessionId` unknown, already submitted, or belongs to another player
- Wall-clock elapsed since `issuedAt` is outside `[80s, 300s]` — too fast is impossible, too slow means they were computing
- `engineVersion` mismatch
- Input tape has frame numbers that are non-monotonic, negative, or beyond 5,400
- More than 12 inputs in any 60-frame window (no human taps 12×/sec; this is your crude bot filter)
- Server replay ends in a state inconsistent with the tape (e.g. tape continues after the player died)

Log — but do not reject on — a client/server score mismatch. Mismatches are your early warning that determinism has broken. Alert if the mismatch rate across all players exceeds ~0.1%.

### 3.4 What this does NOT solve — be honest about it

The seed is revealed to the client at session start, because the client has to render the world. A determined attacker can therefore pre-compute an optimal input tape for that seed and submit a perfect run. **Replay validation does not stop this.** It only stops the trivial attack, which is 99% of attackers.

Do not pretend otherwise in any user-facing copy. Mitigations, in order of cost:

- **Input-timing fingerprinting.** Humans have jitter (σ ≈ 20–40ms on reaction taps). Optimal bots are frame-perfect. Flag accounts whose input timing variance is implausibly low. This is a heuristic — flag for review, never auto-ban.
- **Cap value per account.** Off-chain balance is unlimited (it's just progression). Anything with real value — tournament prizes, token claims — gets a per-account cap and a manual review queue above a threshold.
- **Hold tournament payouts.** Freeze the leaderboard for 24h before paying. Review the top N replays. You have the full tape; you can literally watch the run back.
- **Never pay out automatically on a fresh account.** Require account age + minimum sessions before a wallet is payout-eligible.

Build the first two now. The last two are policy, not code — flag them to ALFA.

---

## 4. Repo structure

```
candle-rush/
├─ packages/
│  ├─ engine/                 # pure TS, no DOM, no clock
│  │  ├─ src/
│  │  │  ├─ rng.ts            # mulberry32
│  │  │  ├─ config.ts         # C{}, CHARS[], MAPS[], REGIMES{} — verbatim from prototype
│  │  │  ├─ generator.ts      # ensure(), push(), solid(), markWarnings()
│  │  │  ├─ player.ts         # physics, collision, stumble
│  │  │  ├─ sim.ts            # Sim class: step(dt), applyInput(), getState()
│  │  │  ├─ replay.ts         # runReplay(seed, mapId, charId, inputs) -> Result
│  │  │  └─ index.ts
│  │  └─ test/                # see §9
│  └─ contracts/              # Phase 3 only — leave empty for now
├─ apps/
│  ├─ web/                    # Next.js 14
│  │  ├─ app/
│  │  ├─ components/game/     # Canvas renderer — reads engine state, owns zero logic
│  │  └─ lib/                 # wagmi, siwe, api client
│  └─ api/                    # Fastify
│     ├─ src/routes/
│     ├─ src/services/
│     └─ prisma/schema.prisma
└─ pnpm-workspace.yaml
```

**The renderer is a separate concern from the simulation.** The prototype interleaves them; you must separate them. `sim.getState()` returns candles, player, pips, powers, buffs, hud values. The renderer draws that and nothing else. If the renderer ever writes to sim state, you have a bug.

Port the prototype's canvas drawing — `drawSky`, `drawBG`, `drawCandle`, `drawPlayer`, `drawChar`, `drawPip`, `drawPower`, `drawParts` — essentially as-is. `drawChar()` in particular is shared between the in-game player and the character-select thumbnails; keep it that way so they can never drift apart.

---

## 5. Data model

Two rules that are not negotiable:

**Balance is never a mutable column.** It is the sum of an append-only ledger. Every credit and debit is a row. A balance you can `UPDATE` is a balance you will eventually corrupt, and you will have no way to reconstruct the truth.

**Sessions are immutable once submitted.** Never allow resubmission.

```prisma
model Player {
  id            String   @id @default(cuid())
  address       String   @unique          // lowercase checksum-normalised
  name          String
  activeChar    String   @default("bull")
  activeMap     String   @default("dawn")
  unlockedChars String[] @default(["bull"])
  unlockedMaps  String[] @default(["dawn"])
  bestSession   Int      @default(0)
  totalSessions Int      @default(0)
  flagged       Boolean  @default(false)  // suspected automation — never auto-ban
  banned        Boolean  @default(false)
  createdAt     DateTime @default(now())
  sessions      Session[]
  ledger        LedgerEntry[]
}

model Session {
  id            String   @id @default(cuid())
  playerId      String
  player        Player   @relation(fields: [playerId], references: [id])
  seed          Int
  mapId         String
  charId        String
  engineVersion Int
  issuedAt      DateTime @default(now())
  submittedAt   DateTime?
  status        SessionStatus @default(OPEN)
  serverScore   Int?
  clientScore   Int?     // logged for drift detection only, never trusted
  candles       Int?
  bestMult      Int?
  cleanFlips    Int?
  inputCount    Int?
  inputJitterMs Float?   // stddev of inter-input gaps — the bot signal
  replay        Json?    // the full input tape. Keep it. You will need it.
  @@index([playerId, submittedAt])
  @@index([status, issuedAt])
}

enum SessionStatus { OPEN SUBMITTED REJECTED EXPIRED }

model LedgerEntry {
  id        String     @id @default(cuid())
  playerId  String
  player    Player     @relation(fields: [playerId], references: [id])
  kind      LedgerKind
  amount    Int        // signed: credits positive, purchases negative
  refType   String?    // "session" | "unlock" | "admin"
  refId     String?
  createdAt DateTime   @default(now())
  @@index([playerId, createdAt])
  @@unique([refType, refId, kind])   // idempotency: a session can only ever credit once
}

enum LedgerKind { SESSION_PAYOUT UNLOCK_PURCHASE TOURNAMENT_PRIZE ADJUSTMENT }
```

That `@@unique([refType, refId, kind])` is doing real work — it makes double-crediting a session physically impossible at the database level, not merely unlikely at the application level.

Cache the derived balance in Redis (`player:{id}:balance`) with the ledger as the source of truth. Recompute on write, never trust the cache for a debit.

---

## 6. API

All request and response bodies validated with Zod. No exceptions.

```
POST /auth/nonce           { address }                      -> { nonce }
POST /auth/verify          { message, signature }           -> { token }        # SIWE, JWT httpOnly
GET  /me                                                    -> { player, balance }
POST /me/name              { name }                         -> { player }

POST /session/start        { mapId, charId }                -> { sessionId, seed, engineVersion, config }
POST /session/submit       { sessionId, inputs[], clientScore } -> { score, credited, balance, rank }

POST /shop/unlock          { itemId }                       -> { player, balance }
GET  /leaderboard          ?window=daily|weekly|alltime     -> { entries[], me }
```

**`POST /session/start`**
- Requires auth. Rejects if the player has an `OPEN` session younger than 300s (one at a time).
- Rejects if `mapId`/`charId` is not in the player's unlocked list. Do not trust the client's claim about what it owns.
- `seed = crypto.randomInt(0, 2**31)`. Server-side only.
- Rate limit: 20/hour/player, 60/hour/IP.

**`POST /session/submit`**
- Runs `runReplay()` from `packages/engine` inside a worker thread with a hard 2-second timeout. A malformed tape must never be able to hang the API.
- On success: write `LedgerEntry{kind: SESSION_PAYOUT, refId: sessionId}` inside the same transaction that sets `status: SUBMITTED`. Update `bestSession`, `totalSessions`.
- Push to Redis sorted sets: `lb:daily:{YYYY-MM-DD}`, `lb:weekly:{isoWeek}`, `lb:alltime`. Use `ZADD GT` so only improvements register.
- Compute `inputJitterMs` and set `flagged = true` if below threshold. Log it; take no other action.

**`POST /shop/unlock`**
- Price comes from the **server's** copy of `CHARS`/`MAPS`. Never accept a price from the client.
- Debit and unlock in one transaction. Reject if already owned or balance insufficient.

Leaderboards store `playerId` and score only; join names at read time so a name change doesn't require a rewrite.

---

## 7. Wallet & auth

**SIWE (EIP-4361), not `eth_requestAccounts`.** The prototype's version proves nothing — anyone can claim any address. Real flow:

1. `POST /auth/nonce` with the address → server stores a single-use nonce in Redis, 5-minute TTL
2. Client builds a SIWE message and asks the wallet to sign it
3. `POST /auth/verify` → server recovers the signer with viem, checks it matches, consumes the nonce, issues an httpOnly JWT (7-day)

Chain config for Robinhood Chain — pull the current chainId and RPC from `https://docs.robinhood.com/chain`, do not hardcode from memory:

```ts
export const robinhoodChain = defineChain({
  id: /* verify from docs */,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RHC_RPC_URL!] } },
});
```

**Guest play must work.** A player who has not connected a wallet still plays, with balance in localStorage. On first wallet connect, offer a one-time migration of the guest balance — capped, and only if the wallet has no existing account. Forcing a wallet before the first session will cost you most of your funnel.

---

## 8. Economy

Phase 1 and 2 are entirely off-chain. Balance is progression currency — it is **not** a token, it has no redemption value, and the UI must not imply otherwise.

Prices live in `packages/engine/src/config.ts` and are read by both client (display) and server (enforcement). One source, no drift.

The **revive** is the designed sink. It is free once per session in the prototype. In production: free the first time each day, then costs balance, then eventually costs $CANDLE. Do not implement the token version until Phase 3.

---

## 9. Testing

The engine tests are the only tests that genuinely matter. Without them you will ship a determinism bug and silently mint money.

**Required:**

1. **Determinism** — same seed + same inputs, run 100×, byte-identical final state. Run this in Node *and* in a headless browser; they must agree.
2. **Cross-environment** — generate 50 tapes in the browser, replay all in Node, scores must match exactly.
3. **Generator invariants** — port the simulation ALFA already ran. Over ≥100,000 generated candles, assert:
   - no rise between consecutive candles exceeds `JH - 25` (unjumpable)
   - no rise falls in the ambiguous band `(6, 46)` — every rise is either a walkable step or an obvious jump
   - no gap exceeds `speed * airtime * 0.9` at the speed where it spawns
   - every colour transition has a doji bridge of ≥3 candles
   - no gap occurs within 5 candles of a transition
   - on `longOnly` maps: zero red candles, ever
4. **Replay rejection** — malformed, out-of-order, over-length, and too-fast tapes are all rejected with the correct error code.
5. **Ledger** — submitting the same session twice credits exactly once (hits the unique constraint).

---

## 10. Build phases

Ship each phase before starting the next. Do not build ahead.

**Phase 1 — the honest single-player game (target: 2 weeks)**
Monorepo, engine extraction, determinism refactor, fixed timestep, renderer separation, Fastify + Prisma + Redis, SIWE, session issue/validate/credit, shop, daily & all-time leaderboards, guest play. Deploy to VPS behind Cloudflare.

*This phase is the whole product.* Everything after it is distribution.

**Phase 2 — social (target: 1 week)**
Share cards (server-rendered OG image with score, character, market), `?challenge={seed}` links that let a friend run the identical chart, ghost replay of the leaderboard leader rendered alongside you (you already store every tape — this is nearly free), weekly tournament with a frozen leaderboard.

**Phase 3 — on-chain (only if Phase 1 retention justifies it)**
$CANDLE via ALFA's Robinfun launchpad. Prize distribution via a Merkle distributor: one transaction per week to post the root, one transaction per player to claim. Do not put game logic, scores, or balances on-chain — it costs real ETH gas and buys nothing. The chain is for settlement, not state.

Note the 90-day gas reduction programme that started 2 July 2026 is scheduled to end around 30 September 2026 — **verify its current status before planning around it**, and do not architect anything that only makes economic sense while gas is subsidised.

---

## 11. Non-negotiables

- **Never trust a client-reported score.** Not once, not for "just the leaderboard", not in dev.
- **Never mutate a balance column.** Ledger only.
- **Never let the renderer write to sim state.**
- **Never read wall-clock time inside the engine.**
- **Never accept a price, an unlock list, or a map/char id from the client without server-side verification.**
- **Never auto-ban on a heuristic.** Flag, queue, review.
- **Do not change gameplay tuning.** If a number feels wrong, open an issue with the specific value and your reasoning.

---

## 12. Questions for ALFA before Phase 3

These are business decisions, not engineering ones. Get answers before writing any contract:

1. **Paid entry?** Tournaments with a paid entry fee and a prize pool have a real chance of being characterised as gambling under Indonesian regulation — the same exposure Fourtis has already navigated with OJK and Satgas PASTI. Free entry with a sponsored prize pool carries far less risk and costs you almost nothing in engagement. Which model?
2. **Is $CANDLE its own token, or a utility layer on $ROBIN?** Changes the entire tokenomics surface.
3. **Are characters and markets NFTs, or database rows?** NFTs mean a secondary market and real ownership; they also mean gas per unlock and a much larger attack surface. Database rows are correct for launch. Confirm.
4. **Who reviews flagged accounts?** An automated system with no human in the loop will eventually ban a real player and cost you more in reputation than the cheater cost you in prizes.

---

## Appendix — reference numbers from the prototype

Do not change these without ALFA's sign-off.

| | |
|---|---|
| Gravity | 2300 px/s² |
| Jump velocity | 790 px/s (→ 136px height, 0.687s airtime) |
| Jump cut on release | ×0.42 |
| Coyote time | 180ms |
| Jump buffer | 200ms |
| Auto-step threshold | 24px |
| Landing tolerance | 22px |
| Speed | 232 → 470 px/s, ramp 1.15 px/s², ×map modifier |
| Candle pitch / width | 68 / 57 px |
| Session | 90s, closing bell at 20s remaining (2× P&L, ×1.12 speed) |
| Warm-up | 26 all-doji candles before real generation starts |
| Trend length | ~25 candles avg → ~19 forced flips/session |
| Doji bridge | 3–4 candles |
| Max rise | `JH - 34` ≈ 102px, snapped out of the (6, 46) ambiguous band |
| Multiplier | +1 per 3 landings, capped ×10; halved on stumble |
| Perfect landing | within 18px of a candle's leading edge → +150 × mult |

Ask before you guess. Anything in this document that turns out to be wrong, say so rather than working around it.
