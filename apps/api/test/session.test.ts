import { ENGINE_VERSION, IN, MAX_FRAMES, type InputEvent } from '@candle-rush/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { nextHandicap } from '../src/services/players.js';
import { backdate, makePlayer, reset, tapeFor, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

async function startSession(auth: Record<string, string>, mapId = 'dawn', charId = 'bull') {
  const res = await app.inject({ method: 'POST', url: '/session/start', headers: auth, payload: { mapId, charId } });
  return { res, body: res.json() };
}

describe('POST /session/start', () => {
  it('needs authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/session/start', payload: { mapId: 'dawn', charId: 'bull' } });
    expect(res.statusCode).toBe(401);
  });

  it('issues a server-chosen seed', async () => {
    const { auth } = await makePlayer(app);
    const { res, body } = await startSession(auth);
    expect(res.statusCode).toBe(200);
    expect(body.seed).toBeGreaterThanOrEqual(0);
    expect(body.seed).toBeLessThan(2 ** 31);
    expect(body.config.engineVersion).toBe(ENGINE_VERSION);
    expect(body.config.handicap).toBe(0);
  });

  it('refuses a market the player has not unlocked', async () => {
    const { auth } = await makePlayer(app);
    const { res } = await startSession(auth, 'gold', 'bull');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('NOT_UNLOCKED');
  });

  it('refuses a trader the player has not unlocked', async () => {
    const { auth } = await makePlayer(app);
    const { res } = await startSession(auth, 'dawn', 'whale');
    expect(res.statusCode).toBe(403);
  });

  it('allows only one open session at a time', async () => {
    const { auth } = await makePlayer(app);
    expect((await startSession(auth)).res.statusCode).toBe(200);
    const second = await startSession(auth);
    expect(second.res.statusCode).toBe(409);
    expect(second.body.error).toBe('SESSION_OPEN');
  });

  it('expires a stale open session instead of blocking forever', async () => {
    const { auth } = await makePlayer(app);
    const first = await startSession(auth);
    await backdate(first.body.sessionId, 400_000);
    expect((await startSession(auth)).res.statusCode).toBe(200);
    const stale = await prisma.session.findUniqueOrThrow({ where: { id: first.body.sessionId } });
    expect(stale.status).toBe('EXPIRED');
  });

  it('rate limits session issuance per player', async () => {
    const { auth, player } = await makePlayer(app);
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const { res, body } = await startSession(auth);
      if (res.statusCode === 429) limited++;
      else if (res.statusCode === 200) {
        await prisma.session.update({ where: { id: body.sessionId }, data: { status: 'EXPIRED' } });
      }
    }
    expect(limited).toBeGreaterThan(0);
    expect(await prisma.session.count({ where: { playerId: player.id } })).toBeLessThanOrEqual(20);
  });
});

describe('POST /session/submit', () => {
  async function playable(mapId = 'dawn', charId = 'bull') {
    const made = await makePlayer(app, { unlockedMaps: ['dawn', 'night'], unlockedChars: ['bull'] });
    const { body } = await startSession(made.auth, mapId, charId);
    await backdate(body.sessionId, 90_000);
    const { inputs, score } = tapeFor(body.config);
    return { ...made, sessionId: body.sessionId, config: body.config, inputs, score };
  }

  it('scores the run itself and ignores whatever the client claims', async () => {
    const { auth, sessionId, inputs, score } = await playable();
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: auth,
      payload: { sessionId, inputs, clientScore: 999_999_999 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBe(score);
    expect(body.credited).toBe(score);
    expect(body.balance).toBe(score);

    // The claim is kept, because a mismatch is the early warning for determinism drift.
    const row = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.clientScore).toBe(999_999_999);
    expect(row.serverScore).toBe(score);
    expect(row.status).toBe('SUBMITTED');
  });

  it('credits exactly once when the same session is submitted twice', async () => {
    const { auth, player, sessionId, inputs, score } = await playable();
    const payload = { sessionId, inputs };
    const first = await app.inject({ method: 'POST', url: '/session/submit', headers: auth, payload });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/session/submit', headers: auth, payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('ALREADY_SETTLED');

    const entries = await prisma.ledgerEntry.findMany({ where: { playerId: player.id } });
    expect(entries).toHaveLength(score > 0 ? 1 : 0);
    const sum = entries.reduce((n, e) => n + e.amount, 0);
    expect(sum).toBe(score);
  });

  it('survives concurrent submissions of the same session', async () => {
    const { auth, player, sessionId, inputs, score } = await playable();
    const payload = { sessionId, inputs };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'POST', url: '/session/submit', headers: auth, payload }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const entries = await prisma.ledgerEntry.findMany({ where: { playerId: player.id } });
    expect(entries).toHaveLength(score > 0 ? 1 : 0);
  });

  it('refuses someone else’s session', async () => {
    const { sessionId, inputs } = await playable();
    const other = await makePlayer(app);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: other.auth,
      payload: { sessionId, inputs },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a session submitted faster than it can be played', async () => {
    const made = await makePlayer(app);
    const { body } = await startSession(made.auth);
    const { inputs } = tapeFor(body.config);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: made.auth,
      payload: { sessionId: body.sessionId, inputs },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('TOO_FAST');
    const row = await prisma.session.findUniqueOrThrow({ where: { id: body.sessionId } });
    expect(row.status).toBe('REJECTED');
  });

  it('refuses a session that sat around long enough to be computed', async () => {
    const made = await makePlayer(app);
    const { body } = await startSession(made.auth);
    await backdate(body.sessionId, 600_000);
    const { inputs } = tapeFor(body.config);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: made.auth,
      payload: { sessionId: body.sessionId, inputs },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('TOO_SLOW');
  });

  it('refuses a tape recorded against a different engine version', async () => {
    const made = await makePlayer(app);
    const { body } = await startSession(made.auth);
    await backdate(body.sessionId, 90_000);
    await prisma.session.update({
      where: { id: body.sessionId },
      data: { engineVersion: ENGINE_VERSION + 1 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: made.auth,
      payload: { sessionId: body.sessionId, inputs: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('ENGINE_VERSION_MISMATCH');
  });

  it('refuses a malformed tape and banks nothing', async () => {
    const { auth, player, sessionId } = await playable();
    const bad: InputEvent[] = [
      [500, IN.JUMP_DOWN],
      [100, IN.JUMP_DOWN],
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: auth,
      payload: { sessionId, inputs: bad },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('FRAME_NOT_MONOTONIC');
    expect(await prisma.ledgerEntry.count({ where: { playerId: player.id } })).toBe(0);
  });

  it('refuses a tape that keeps pressing after the run ended', async () => {
    // The fixture run survives to the closing bell at frame 5,400. Frames up to 5,759 are
    // structurally legal — that headroom exists for the revive offer — so a press in the
    // gap is well formed and still has to be rejected, because this run was already over.
    const { auth, sessionId, inputs } = await playable();
    const past = [...inputs, [MAX_FRAMES - 1, IN.JUMP_DOWN]] as InputEvent[];
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: auth,
      payload: { sessionId, inputs: past },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INPUT_AFTER_END');
  });

  it('flags frame-perfect input for review without banning', async () => {
    const made = await makePlayer(app);
    const { body } = await startSession(made.auth);
    await backdate(body.sessionId, 90_000);
    const robotic: InputEvent[] = [];
    for (let f = 60; f < 1200; f += 60) robotic.push([f, IN.JUMP_DOWN]);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: made.auth,
      payload: { sessionId: body.sessionId, inputs: robotic },
    });
    expect(res.statusCode).toBe(200);
    const player = await prisma.player.findUniqueOrThrow({ where: { id: made.player.id } });
    expect(player.flagged).toBe(true);
    expect(player.banned).toBe(false);
  });

  it('keeps the tape so a run can be watched back', async () => {
    const { auth, sessionId, inputs } = await playable();
    await app.inject({ method: 'POST', url: '/session/submit', headers: auth, payload: { sessionId, inputs } });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(Array.isArray(row.replay)).toBe(true);
    expect((row.replay as unknown[]).length).toBe(inputs.length);
    expect(row.serverDigest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('moves the handicap on the server, from the server’s own candle count', async () => {
    const made = await makePlayer(app, { unlockedMaps: ['dawn', 'night'] });
    await prisma.player.update({ where: { id: made.player.id }, data: { handicap: 0.5 } });

    const started = await startSession(made.auth);
    expect(started.body.config.handicap).toBe(0.5); // issued with the session, not held by the client
    await backdate(started.body.sessionId, 90_000);
    const { inputs } = tapeFor(started.body.config);
    const res = await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: made.auth,
      payload: { sessionId: started.body.sessionId, inputs },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.player.findUniqueOrThrow({ where: { id: made.player.id } });
    expect(after.totalSessions).toBe(1);
    // Derived from the server's own candle count, not from anything the client sent.
    expect(after.handicap).toBeCloseTo(nextHandicap(0.5, res.json().stats.candles), 5);
  });
});

describe('nextHandicap', () => {
  it('eases off for players who keep dying early and tightens for players who do not', () => {
    expect(nextHandicap(0, 12)).toBeCloseTo(0.22, 5);
    expect(nextHandicap(0.9, 12)).toBe(1); // clamped
    expect(nextHandicap(0.5, 100)).toBe(0.5); // the middle band leaves it alone
    expect(nextHandicap(0.5, 200)).toBeCloseTo(0.2, 5);
    expect(nextHandicap(0.1, 200)).toBe(0); // clamped
  });
});
