import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import * as lb from '../src/services/leaderboard.js';
import { makePlayer, reset, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

describe('leaderboards', () => {
  it('only records improvements', async () => {
    const { player } = await makePlayer(app);
    await lb.record(player.id, 5000);
    await lb.record(player.id, 1200); // a bad session must not lower a best
    expect((await lb.rankOf('alltime', player.id))?.score).toBe(5000);
    await lb.record(player.id, 9000);
    expect((await lb.rankOf('alltime', player.id))?.score).toBe(9000);
  });

  it('ranks by score and joins names at read time', async () => {
    const a = await makePlayer(app);
    const b = await makePlayer(app);
    await lb.record(a.player.id, 100);
    await lb.record(b.player.id, 900);

    await prisma.player.update({ where: { id: b.player.id }, data: { name: 'RENAMED' } });

    const res = await app.inject({ method: 'GET', url: '/leaderboard?window=alltime' });
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].playerId).toBe(b.player.id);
    expect(body.entries[0].name).toBe('RENAMED'); // no board rewrite was needed
    expect(body.entries[0].rank).toBe(1);
    expect(body.entries[1].score).toBe(100);
  });

  it('hides banned players without leaving a hole in the ranking', async () => {
    const a = await makePlayer(app);
    const b = await makePlayer(app);
    const c = await makePlayer(app);
    await lb.record(a.player.id, 300);
    await lb.record(b.player.id, 200);
    await lb.record(c.player.id, 100);
    await prisma.player.update({ where: { id: b.player.id }, data: { banned: true } });

    const body = (await app.inject({ method: 'GET', url: '/leaderboard?window=alltime' })).json();
    expect(body.entries.map((e: { playerId: string }) => e.playerId)).toEqual([a.player.id, c.player.id]);
    expect(body.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2]);
  });

  it('tells a signed-in player where they stand even when off the page', async () => {
    const me = await makePlayer(app);
    for (let i = 0; i < 30; i++) {
      const other = await makePlayer(app);
      await lb.record(other.player.id, 10_000 + i);
    }
    await lb.record(me.player.id, 5);

    const body = (
      await app.inject({ method: 'GET', url: '/leaderboard?window=alltime&limit=10', headers: me.auth })
    ).json();
    expect(body.entries).toHaveLength(10);
    expect(body.me.playerId).toBe(me.player.id);
    expect(body.me.rank).toBe(31);
  });

  it('keys daily and weekly boards in UTC', () => {
    const at = new Date('2026-07-26T23:30:00Z');
    expect(lb.dayKey(at)).toBe('2026-07-26');
    expect(lb.isoWeekKey(at)).toBe('2026-W30');
    // A Monday belongs to the week it starts.
    expect(lb.isoWeekKey(new Date('2026-07-27T00:00:00Z'))).toBe('2026-W31');
  });

  it('can be rebuilt from the database after a Redis loss', async () => {
    const a = await makePlayer(app);
    await prisma.player.update({ where: { id: a.player.id }, data: { bestSession: 7777 } });
    const { redis } = await import('../src/redis.js');
    await redis().del('lb:alltime');
    expect(await lb.rankOf('alltime', a.player.id)).toBeNull();

    await lb.rebuildAllTime();
    expect((await lb.rankOf('alltime', a.player.id))?.score).toBe(7777);
  });
});
