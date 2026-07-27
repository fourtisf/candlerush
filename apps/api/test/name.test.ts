import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { findOrCreateByAddress, publicPlayer } from '../src/services/players.js';
import { makePlayer, reset, teardown, testServer } from './setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await testServer();
});
beforeEach(reset);
afterAll(teardown);

const setName = (auth: Record<string, string>, name: string) =>
  app.inject({ method: 'POST', url: '/me/name', headers: auth, payload: { name } });

describe('naming', () => {
  it('signs a new wallet in with a placeholder, and does not call it a name', async () => {
    // The column is NOT NULL and a row exists the moment a wallet signs in, so it carries
    // something. The client keys off `named` precisely so it does not mistake that
    // placeholder for a choice and skip the naming screen.
    const address = '0x00112233445566778899aabbccddeeff01234567';
    const fresh = await findOrCreateByAddress(address);
    expect(fresh.named).toBe(false);
    expect(fresh.name).toBe(`TRADER${address.slice(-4).toUpperCase()}`);
    expect(publicPlayer(fresh).named).toBe(false);
  });

  it('reports a fresh account as unnamed over the wire', async () => {
    const { auth } = await makePlayer(app);
    const me = await app.inject({ method: 'GET', url: '/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json().player.named).toBe(false);
  });

  it('flips to named the moment a name is chosen, and stays that way', async () => {
    const { auth, player } = await makePlayer(app);
    const res = await setName(auth, 'alfa');
    expect(res.statusCode).toBe(200);
    expect(res.json().player.named).toBe(true);
    expect(res.json().player.name).toBe('ALFA'); // upper-cased server-side, not client-side
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).named).toBe(true);

    const again = await setName(auth, 'ALFA TWO');
    expect(again.json().player.named).toBe(true);
  });

  it('refuses a name the client should never have let through', async () => {
    const { auth } = await makePlayer(app);
    for (const bad of ['', '   ', 'A'.repeat(15), 'ALFA<script>', 'ALF@']) {
      const res = await setName(auth, bad);
      expect(res.statusCode, `accepted ${JSON.stringify(bad)}`).toBe(400);
    }
    // Still unnamed after all that — a rejected name must not count as chosen.
    const me = await app.inject({ method: 'GET', url: '/me', headers: auth });
    expect(me.json().player.named).toBe(false);
  });

  it('accepts every character the client offers', async () => {
    const { auth } = await makePlayer(app);
    const res = await setName(auth, 'a b.c_d-1');
    expect(res.statusCode).toBe(200);
    expect(res.json().player.name).toBe('A B.C_D-1');
  });
});
