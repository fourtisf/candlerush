import { execSync } from 'node:child_process';
import {
  ENGINE_VERSION,
  IN,
  MAX_FRAMES,
  Sim,
  runReplay,
  type InputEvent,
  type SessionConfig,
} from '@candle-rush/engine';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { closeRedis, redis } from '../src/redis.js';
import { buildServer } from '../src/server.js';
import { InlineReplayPool } from '../src/services/replay-pool.js';

/**
 * Integration tests, against a real Postgres and a real Redis.
 *
 * The things worth testing here — the unique index that makes a double credit
 * impossible, serializable isolation on a debit, ZADD GT on a leaderboard — are
 * database and Redis behaviours. Mocking them would test the mock.
 */

let app: FastifyInstance | null = null;
let migrated = false;

export async function testServer(): Promise<FastifyInstance> {
  if (!migrated) {
    execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: 'pipe',
    });
    migrated = true;
  }
  if (!app) {
    const built = await buildServer(new InlineReplayPool());
    await built.app.ready();
    app = built.app;
  }
  return app;
}

export async function reset(): Promise<void> {
  await prisma.ledgerEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.player.deleteMany();
  await redis().flushdb();
}

export async function teardown(): Promise<void> {
  if (app) await app.close();
  app = null;
  await prisma.$disconnect();
  await closeRedis();
}

/** A signed-in player, skipping SIWE — the wallet flow has its own tests. */
export async function makePlayer(
  server: FastifyInstance,
  over: Partial<{ address: string; unlockedChars: string[]; unlockedMaps: string[] }> = {},
) {
  const address = over.address ?? `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`;
  const player = await prisma.player.create({
    data: {
      address,
      name: 'TESTER',
      unlockedChars: over.unlockedChars ?? ['bull'],
      unlockedMaps: over.unlockedMaps ?? ['dawn'],
    },
  });
  const token = server.jwt.sign({ sub: player.id, addr: player.address });
  return { player, token, auth: { authorization: `Bearer ${token}` } };
}

/** Backdate a session so the wall-clock window can be satisfied without waiting 80s. */
export async function backdate(sessionId: string, msAgo: number): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { issuedAt: new Date(Date.now() - msAgo) },
  });
}

/**
 * A structurally valid tape and the score it is actually worth.
 *
 * Built by driving a live sim so the tape stops the frame the run does — a tape with
 * inputs past the end is rejected, which is the point of that rule.
 */
export function tapeFor(cfg: SessionConfig): { inputs: InputEvent[]; score: number } {
  const sim = new Sim(cfg);
  const inputs: InputEvent[] = [];
  for (let f = 0; f < MAX_FRAMES && sim.mode !== 'ended'; f++) {
    if (f >= 40 && (f - 40) % 37 === 0) {
      inputs.push([f, IN.JUMP_DOWN]);
      sim.applyInput(IN.JUMP_DOWN);
    } else if (f >= 49 && (f - 49) % 37 === 0) {
      inputs.push([f, IN.JUMP_UP]);
      sim.applyInput(IN.JUMP_UP);
    }
    sim.step();
  }
  const check = runReplay({ ...cfg, inputs });
  if (!check.ok) throw new Error(`fixture tape is invalid: ${check.error} ${check.errorDetail}`);
  if (check.score !== sim.score) throw new Error('fixture tape does not reproduce');
  return { inputs, score: check.score };
}

export const engineVersion = ENGINE_VERSION;
