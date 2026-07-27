import { STAKES, stakeById, stakePayout } from '@candle-rush/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { append, computeBalance } from '../src/services/ledger.js';
import { backdate, makePlayer, reset, tapeFor, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

async function funded(amount: number) {
  const made = await makePlayer(app, { unlockedMaps: ['dawn', 'night'] });
  if (amount > 0) {
    await append(prisma, {
      playerId: made.player.id,
      kind: 'ADJUSTMENT',
      amount,
      refType: 'admin',
      refId: `seed-${made.player.id}`,
    });
  }
  return made;
}

const start = (auth: Record<string, string>, stakeId?: string) =>
  app.inject({
    method: 'POST',
    url: '/session/start',
    headers: auth,
    payload: { mapId: 'dawn', charId: 'bull', ...(stakeId ? { stakeId } : {}) },
  });

const sum = (playerId: string) => computeBalance(playerId);

describe('stakes', () => {
  it('defaults to paper, which costs nothing and multiplies nothing', async () => {
    const { auth, player } = await funded(0);
    const res = await start(auth);
    expect(res.statusCode).toBe(200);
    expect(res.json().stake).toMatchObject({ id: 'paper', cost: 0, mult: 1 });
    expect(await sum(player.id)).toBe(0);
  });

  it('debits the stake the moment the session is issued', async () => {
    const { auth, player } = await funded(200_000);
    const res = await start(auth, 'standard');
    expect(res.statusCode).toBe(200);
    expect(res.json().stake.cost).toBe(100_000);
    expect(res.json().balance).toBe(100_000);
    expect(await sum(player.id)).toBe(100_000);
  });

  it('refuses a stake the player cannot cover, and issues nothing', async () => {
    const { auth, player } = await funded(10_000);
    const res = await start(auth, 'standard');
    expect(res.statusCode).toBe(402);
    expect(await sum(player.id)).toBe(10_000);
    // No half-open session left behind — the debit and the row are one transaction.
    expect(await prisma.session.count({ where: { playerId: player.id } })).toBe(0);
  });

  it('takes an id, never a price', async () => {
    const { auth, player } = await funded(500_000);
    const res = await app.inject({
      method: 'POST',
      url: '/session/start',
      headers: auth,
      // A body that tries to name its own terms. Both extra fields are ignored.
      payload: { mapId: 'dawn', charId: 'bull', stakeId: 'size', cost: 1, mult: 999 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stake).toMatchObject({ cost: 400_000, mult: 4 });
    expect(await sum(player.id)).toBe(100_000);
  });

  it('rejects a stake that is not on the menu', async () => {
    const { auth } = await funded(500_000);
    expect((await start(auth, 'whale')).statusCode).toBe(400);
  });

  it('pays the score times the multiplier, and ranks the score', async () => {
    const { auth, player } = await funded(200_000);
    const started = await start(auth, 'standard');
    const body = started.json();
    const stake = stakeById('standard')!;
    const { inputs, score, durationMs } = tapeFor(body.config);
    await backdate(body.sessionId, durationMs + 5_000);

    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: auth,
      payload: { sessionId: body.sessionId, inputs },
    });
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    expect(out.score, 'the leaderboard number is the raw score').toBe(score);
    expect(out.credited).toBe(stakePayout(score, stake.mult));
    expect(out.stake).toMatchObject({ id: 'standard', cost: stake.cost, mult: stake.mult });
    expect(out.stake.net).toBe(out.credited - stake.cost);
    expect(await sum(player.id)).toBe(200_000 - stake.cost + out.credited);
  });

  it('returns the stake when the tape is rejected', async () => {
    // Not charity: a payout needs a replay that validates, so a rejected run gets the
    // player's own money back and nothing more. A wall-clock window set for the wrong game
    // once rejected every run on this box, and it must never also cost people their stake.
    const { auth, player } = await funded(200_000);
    const started = await start(auth, 'standard');
    const body = started.json();
    expect(await sum(player.id)).toBe(100_000);

    const { inputs } = tapeFor(body.config);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: auth,
      payload: { sessionId: body.sessionId, inputs }, // submitted instantly: TOO_FAST
    });
    expect(res.statusCode).toBe(422);
    expect(await sum(player.id), 'stake was not returned').toBe(200_000);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: body.sessionId } });
    expect(row.status).toBe('REJECTED');
    expect(row.stakeSettled).toBe(true);
  });

  it('cannot refund the same stake twice', async () => {
    const { auth, player } = await funded(200_000);
    const started = await start(auth, 'standard');
    const body = started.json();
    const { inputs } = tapeFor(body.config);
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/session/submit',
        headers: auth,
        payload: { sessionId: body.sessionId, inputs },
      });
    }
    expect(await sum(player.id)).toBe(200_000);
    expect(
      await prisma.ledgerEntry.count({ where: { playerId: player.id, kind: 'SESSION_REFUND' } }),
    ).toBe(1);
  });

  it('abandoning gives the stake back and frees the player to start again', async () => {
    // Without this a player who walks away is locked out for the whole submit window,
    // which a thirty-level run forces to half an hour.
    const { auth, player } = await funded(200_000);
    const started = await start(auth, 'standard');
    expect((await start(auth, 'paper')).statusCode, 'second start should collide').toBe(409);

    const gone = await app.inject({
      method: 'POST',
      url: '/session/abandon',
      headers: auth,
      payload: { sessionId: started.json().sessionId },
    });
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toMatchObject({ abandoned: true, refunded: 100_000, balance: 200_000 });
    expect(await sum(player.id)).toBe(200_000);
    expect((await start(auth, 'paper')).statusCode).toBe(200);
  });

  it('cannot submit a session that was abandoned', async () => {
    const { auth, player } = await funded(200_000);
    const started = await start(auth, 'standard');
    const body = started.json();
    const { inputs, durationMs } = tapeFor(body.config);
    await app.inject({
      method: 'POST',
      url: '/session/abandon',
      headers: auth,
      payload: { sessionId: body.sessionId },
    });
    await backdate(body.sessionId, durationMs + 5_000);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: auth,
      payload: { sessionId: body.sessionId, inputs },
    });
    expect(res.statusCode).toBe(409);
    expect(await sum(player.id), 'abandoning then submitting paid out').toBe(200_000);
  });

  it('every tier is a decision rather than a trap', async () => {
    // Break-even is cost / (mult - 1). If a tier needed a score beyond what the game can
    // produce it would be a tax on optimism, not a bet.
    for (const s of STAKES) {
      if (s.mult <= 1) {
        expect(s.cost).toBe(0);
        continue;
      }
      const breakEven = s.cost / (s.mult - 1);
      expect(breakEven, `${s.id} break-even`).toBeLessThan(200_000);
      expect(s.cost, `${s.id} costs more than the whole catalogue`).toBeLessThan(1_530_000);
    }
  });
});
