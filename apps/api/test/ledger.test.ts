import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { balanceOf, append, computeBalance, playerRef } from '../src/services/ledger.js';
import { makePlayer, reset, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

describe('the ledger', () => {
  it('is the balance — there is no balance column to disagree with', async () => {
    const { player } = await makePlayer(app);
    await append(prisma, { playerId: player.id, kind: 'SESSION_PAYOUT', amount: 1200, refType: 'session', refId: 's1' });
    await append(prisma, { playerId: player.id, kind: 'SESSION_PAYOUT', amount: 800, refType: 'session', refId: 's2' });
    await append(prisma, {
      playerId: player.id,
      kind: 'UNLOCK_PURCHASE',
      amount: -500,
      refType: 'unlock',
      refId: playerRef(player.id, 'bear'),
    });
    expect(await computeBalance(player.id)).toBe(1500);
  });

  it('physically cannot credit the same session twice', async () => {
    const { player } = await makePlayer(app);
    const entry = {
      playerId: player.id,
      kind: 'SESSION_PAYOUT' as const,
      amount: 5000,
      refType: 'session' as const,
      refId: 'session-abc',
    };
    expect(await append(prisma, entry)).toBe(true);
    expect(await append(prisma, entry)).toBe(false);
    expect(await computeBalance(player.id)).toBe(5000);
  });

  it('namespaces item purchases so one player cannot lock out another', async () => {
    // The unique index is global. A bare item id as the reference would mean the first
    // player ever to buy the Fox is the only player who can.
    const a = await makePlayer(app);
    const b = await makePlayer(app);
    const buy = (playerId: string) =>
      append(prisma, {
        playerId,
        kind: 'UNLOCK_PURCHASE' as const,
        amount: -50000,
        refType: 'unlock' as const,
        refId: playerRef(playerId, 'fox'),
      });
    expect(await buy(a.player.id)).toBe(true);
    expect(await buy(b.player.id)).toBe(true);
    expect(await buy(a.player.id)).toBe(false);
  });

  it('serves a cached balance but never trusts it for a debit', async () => {
    const { player } = await makePlayer(app);
    await append(prisma, { playerId: player.id, kind: 'SESSION_PAYOUT', amount: 900, refType: 'session', refId: 'x' });
    expect(await balanceOf(player.id)).toBe(900);

    // Poison the cache the way a stale or hostile write would. Built with the same helper
    // the code uses, so this also pins the namespace: a bare `player:<id>:balance` would
    // miss, and a miss here would make the test pass for the wrong reason.
    const { redis, k } = await import('../src/redis.js');
    await redis().set(k('player', player.id, 'balance'), '999999999');
    expect(await balanceOf(player.id)).toBe(999999999); // display path trusts the cache

    const res = await app.inject({
      method: 'POST',
      url: '/shop/unlock',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: player.id, addr: player.address })}` },
      payload: { itemId: 'bear' },
    });
    expect(res.statusCode).toBe(402); // the debit path re-derived from the rows
    expect(await computeBalance(player.id)).toBe(900);
  });
});

describe('POST /shop/unlock', () => {
  async function rich(amount: number) {
    const made = await makePlayer(app);
    await append(prisma, {
      playerId: made.player.id,
      kind: 'ADJUSTMENT',
      amount,
      refType: 'admin',
      refId: `seed-${made.player.id}`,
    });
    return made;
  }

  it('charges the server’s price, not the client’s', async () => {
    const { player, auth } = await rich(60_000);
    const res = await app.inject({
      method: 'POST',
      url: '/shop/unlock',
      headers: auth,
      payload: { itemId: 'fox', cost: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().spent).toBe(50_000); // the Fox costs 50,000, whatever the body said
    expect(res.json().balance).toBe(10_000);
    expect(await computeBalance(player.id)).toBe(10_000);
  });

  it('refuses a purchase the player cannot afford', async () => {
    const { auth } = await rich(100);
    const res = await app.inject({ method: 'POST', url: '/shop/unlock', headers: auth, payload: { itemId: 'fox' } });
    expect(res.statusCode).toBe(402);
  });

  it('refuses to sell the same thing twice', async () => {
    const { auth } = await rich(200_000);
    expect((await app.inject({ method: 'POST', url: '/shop/unlock', headers: auth, payload: { itemId: 'bear' } })).statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/shop/unlock', headers: auth, payload: { itemId: 'bear' } });
    expect(again.statusCode).toBe(409);
  });

  it('does not let concurrent buys overdraw the account', async () => {
    // Enough for exactly one Fox. Two must not both succeed.
    const { player, auth } = await rich(50_000);
    const results = await Promise.allSettled([
      app.inject({ method: 'POST', url: '/shop/unlock', headers: auth, payload: { itemId: 'fox' } }),
      app.inject({ method: 'POST', url: '/shop/unlock', headers: auth, payload: { itemId: 'bear' } }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.statusCode === 200);
    expect(ok.length).toBe(1);
    expect(await computeBalance(player.id)).toBeGreaterThanOrEqual(0);
  });

  it('rejects an item that does not exist', async () => {
    const { auth } = await rich(1_000_000);
    const res = await app.inject({ method: 'POST', url: '/shop/unlock', headers: auth, payload: { itemId: 'dragon' } });
    expect(res.statusCode).toBe(400);
  });
});
