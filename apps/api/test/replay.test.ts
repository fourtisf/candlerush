import { ENGINE_VERSION, runReplay } from '@candle-rush/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { backdate, makePlayer, reset, tapeFor, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

/** Play a session all the way to a settled row, the way a real one gets there. */
async function played() {
  const made = await makePlayer(app);
  const start = await app.inject({
    method: 'POST',
    url: '/session/start',
    headers: made.auth,
    payload: { mapId: 'dawn', charId: 'bull' },
  });
  const body = start.json();
  const tape = tapeFor(body.config);
  await backdate(body.sessionId, tape.durationMs + 5_000);
  const submit = await app.inject({
    method: 'POST',
    url: '/session/submit',
    headers: made.auth,
    payload: { sessionId: body.sessionId, inputs: tape.inputs },
  });
  expect(submit.statusCode, submit.body).toBe(200);
  return { ...made, sessionId: body.sessionId, config: body.config, tape, score: submit.json().score };
}

describe('GET /replay/:sessionId', () => {
  it('hands back everything needed to watch the run again', async () => {
    const { sessionId, score, tape } = await played();
    const res = await app.inject({ method: 'GET', url: `/replay/${sessionId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBe(score);
    expect(body.inputs).toHaveLength(tape.inputs.length);
    expect(body.config.engineVersion).toBe(ENGINE_VERSION);
  });

  it('is a real replay, not a stored number next to an unrelated tape', async () => {
    // The whole promise of the endpoint: anybody can take these inputs, run them through
    // the same engine, and land on the number the server published.
    const { sessionId } = await played();
    const body = (await app.inject({ method: 'GET', url: `/replay/${sessionId}` })).json();
    const again = runReplay({ ...body.config, inputs: body.inputs });
    expect(again.ok, `${again.error} ${again.errorDetail}`).toBe(true);
    expect(again.score).toBe(body.score);
    expect(again.level).toBe(body.level);
  });

  it('needs no authentication — a run is meant to be sendable', async () => {
    const { sessionId } = await played();
    expect((await app.inject({ method: 'GET', url: `/replay/${sessionId}` })).statusCode).toBe(200);
  });

  it('will not hand out a seed somebody is still playing', async () => {
    const made = await makePlayer(app);
    const start = await app.inject({
      method: 'POST',
      url: '/session/start',
      headers: made.auth,
      payload: { mapId: 'dawn', charId: 'bull' },
    });
    const res = await app.inject({ method: 'GET', url: `/replay/${start.json().sessionId}` });
    expect(res.statusCode).toBe(404);
  });

  it('will not show a tape that did not reproduce', async () => {
    const { sessionId } = await played();
    await prisma.session.update({ where: { id: sessionId }, data: { status: 'REJECTED' } });
    expect((await app.inject({ method: 'GET', url: `/replay/${sessionId}` })).statusCode).toBe(404);
  });

  it('hides a banned player’s runs', async () => {
    const { sessionId, player } = await played();
    await prisma.player.update({ where: { id: player.id }, data: { banned: true } });
    expect((await app.inject({ method: 'GET', url: `/replay/${sessionId}` })).statusCode).toBe(404);
  });

  it('404s on a session that does not exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/replay/nope' })).statusCode).toBe(404);
  });
});

describe('GET /admin/stats', () => {
  const token = process.env.ADMIN_TOKEN ?? '';

  it('refuses without the token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/stats' });
    // 501 when the box has no token configured at all, 401 when it has one and you missed.
    expect([401, 501]).toContain(res.statusCode);
  });

  it.skipIf(!token)('counts the funnel and the reasons behind it', async () => {
    await played();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/stats?hours=24',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions.started).toBeGreaterThan(0);
    expect(body.sessions.submitted).toBeGreaterThan(0);
    // The number that sat at 100% for days while nothing said so.
    expect(body.rejectRate).toBe(0);
    expect(body.completionRate).toBeGreaterThan(0);
  });

  it.skipIf(!token)('surfaces why runs are being rejected', async () => {
    const made = await makePlayer(app);
    const start = await app.inject({
      method: 'POST',
      url: '/session/start',
      headers: made.auth,
      payload: { mapId: 'dawn', charId: 'bull' },
    });
    const tape = tapeFor(start.json().config);
    // Submitted immediately: a tape that claims more play than the clock allows.
    await app.inject({
      method: 'POST',
      url: '/session/submit',
      headers: made.auth,
      payload: { sessionId: start.json().sessionId, inputs: tape.inputs },
    });
    const body = (
      await app.inject({
        method: 'GET',
        url: '/admin/stats?hours=24',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();
    expect(body.rejectRate).toBeGreaterThan(0);
    expect(body.rejectReasons[0].reason).toBe('TOO_FAST');
  });
});
