import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { redis } from '../src/redis.js';
import { PRIZES, dayKey, nextStreak, previousDay, settleDay } from '../src/services/daily.js';
import { computeBalance } from '../src/services/ledger.js';
import * as lb from '../src/services/leaderboard.js';
import { makePlayer, reset, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

/** Put scores on a specific day's board without waiting for that day to happen. */
async function board(day: string, entries: { playerId: string; score: number }[]) {
  const key = lb.dailyKeyFor(day);
  const pipe = redis().pipeline();
  for (const e of entries) pipe.zadd(key, 'GT', e.score, e.playerId);
  await pipe.exec();
}

const YESTERDAY = previousDay(new Date());

describe('closing the daily board', () => {
  it('pays the podium and writes down who won', async () => {
    const first = await makePlayer(app);
    const second = await makePlayer(app);
    const third = await makePlayer(app);
    const fourth = await makePlayer(app);
    await board(YESTERDAY, [
      { playerId: first.player.id, score: 900_000 },
      { playerId: second.player.id, score: 500_000 },
      { playerId: third.player.id, score: 250_000 },
      { playerId: fourth.player.id, score: 10_000 },
    ]);

    const settled = await settleDay(YESTERDAY);
    expect(settled).not.toBeNull();
    expect(settled!.results.map((r) => r.playerId)).toEqual([
      first.player.id,
      second.player.id,
      third.player.id,
    ]);
    expect(settled!.results.map((r) => r.prize)).toEqual([...PRIZES]);
    expect(await computeBalance(first.player.id)).toBe(PRIZES[0]);
    expect(await computeBalance(second.player.id)).toBe(PRIZES[1]);
    expect(await computeBalance(third.player.id)).toBe(PRIZES[2]);
    // Fourth place is on the board and gets nothing, which is the point of a podium.
    expect(await computeBalance(fourth.player.id)).toBe(0);
  });

  it('cannot pay the same day twice, however many times it is asked', async () => {
    const winner = await makePlayer(app);
    await board(YESTERDAY, [{ playerId: winner.player.id, score: 123_456 }]);

    const first = await settleDay(YESTERDAY);
    expect(first).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(await settleDay(YESTERDAY)).toBeNull();
    expect(await computeBalance(winner.player.id)).toBe(PRIZES[0]);
    expect(await prisma.dailyResult.count({ where: { day: YESTERDAY } })).toBe(1);
  });

  it('survives two requests racing to close the same day', async () => {
    // Whoever opens the board first after midnight is what settles it, so two people
    // opening it at once is the ordinary case rather than an exotic one.
    const winner = await makePlayer(app);
    await board(YESTERDAY, [{ playerId: winner.player.id, score: 77_777 }]);

    const settled = await Promise.all([
      settleDay(YESTERDAY),
      settleDay(YESTERDAY),
      settleDay(YESTERDAY),
    ]);
    expect(settled.filter(Boolean)).toHaveLength(1);
    expect(await computeBalance(winner.player.id)).toBe(PRIZES[0]);
  });

  it('closes an empty day rather than retrying it forever', async () => {
    const settled = await settleDay(YESTERDAY);
    expect(settled).not.toBeNull();
    expect(settled!.entrants).toBe(0);
    expect(settled!.paid).toBe(0);
    expect(await settleDay(YESTERDAY)).toBeNull();
  });

  it('snapshots the winner’s name so a rename cannot rewrite history', async () => {
    const winner = await makePlayer(app);
    await board(YESTERDAY, [{ playerId: winner.player.id, score: 1 }]);
    await settleDay(YESTERDAY);

    await app.inject({ method: 'POST', url: '/me/name', headers: winner.auth, payload: { name: 'SOMEONEELSE' } });
    const row = await prisma.dailyResult.findFirstOrThrow({ where: { day: YESTERDAY } });
    expect(row.name).toBe('TESTER');
  });

  it('shows yesterday on the board so the reset is an event', async () => {
    const winner = await makePlayer(app);
    await board(YESTERDAY, [{ playerId: winner.player.id, score: 4242 }]);

    const res = await app.inject({ method: 'GET', url: '/leaderboard?window=daily&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.yesterday?.day).toBe(YESTERDAY);
    expect(body.yesterday.results[0].score).toBe(4242);
    expect(body.yesterday.results[0].prize).toBe(PRIZES[0]);
  });
});

describe('the play streak', () => {
  const today = '2026-07-27';

  it('counts consecutive days and nothing else', () => {
    expect(nextStreak(null, 0, today)).toMatchObject({ playStreak: 1, lastPlayedOn: today });
    expect(nextStreak('2026-07-26', 4, today)).toMatchObject({ playStreak: 5 });
    // A day missed resets it. Two sessions on the same day do not double it.
    expect(nextStreak('2026-07-25', 9, today)).toMatchObject({ playStreak: 1 });
    expect(nextStreak(today, 6, today)).toMatchObject({ playStreak: 6, changed: false });
  });

  it('crosses a month boundary', () => {
    expect(nextStreak('2026-07-31', 3, '2026-08-01')).toMatchObject({ playStreak: 4 });
  });

  it('agrees with the leaderboard about what day it is', () => {
    // Both key off the same UTC day, so a board that rolls over at midnight and a streak
    // that does not would be a player told they broke a streak they did not break.
    const at = new Date('2026-07-27T23:59:59Z');
    expect(dayKey(at)).toBe('2026-07-27');
    expect(previousDay(at)).toBe('2026-07-26');
  });
});
