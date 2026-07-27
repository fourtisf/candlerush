import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { errorSchema, meReply, migrateGuestBody, nameBody } from '../schemas.js';
import { append, balanceOf, computeBalance, refreshBalanceCache } from '../services/ledger.js';
import { publicPlayer } from '../services/players.js';

export const meRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/me', { preHandler: app.requireAuth, schema: { response: { 200: meReply } } }, async (req) => {
    const player = req.player!;
    return { player: publicPlayer(player), balance: await balanceOf(player.id) };
  });

  r.post(
    '/me/name',
    {
      preHandler: app.requireAuth,
      schema: { body: nameBody, response: { 200: meReply } },
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req) => {
      const updated = await prisma.player.update({
        where: { id: req.player!.id },
        data: { name: req.body.name, named: true },
      });
      return { player: publicPlayer(updated), balance: await balanceOf(updated.id) };
    },
  );

  /**
   * One-time guest balance migration.
   *
   * This is the one place a client-reported number is written to the ledger, and it is
   * deliberate: forcing a wallet connect before the first session costs most of the
   * funnel, so guests keep their progress in localStorage and carry it over once. The
   * exposure is bounded three ways — a hard cap, a brand-new account only, and a unique
   * ledger reference so it can physically happen only once per player. Progression
   * currency has no redemption value; nothing here may ever be reused for anything that
   * does. See docs/SCORE-INTEGRITY.md.
   */
  r.post(
    '/me/migrate-guest',
    {
      preHandler: app.requireAuth,
      schema: { body: migrateGuestBody, response: { 200: meReply, 409: errorSchema } },
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const player = req.player!;
      const amount = Math.min(req.body.balance, env().GUEST_MIGRATION_CAP);

      if (player.totalSessions > 0) {
        return reply
          .code(409)
          .send({ error: 'NOT_A_NEW_ACCOUNT', message: 'Guest progress can only be carried into a fresh account.' });
      }
      const existing = await computeBalance(player.id);
      if (existing !== 0) {
        return reply.code(409).send({ error: 'NOT_A_NEW_ACCOUNT', message: 'This account already has a balance.' });
      }

      if (amount > 0) {
        const written = await append(prisma, {
          playerId: player.id,
          kind: 'GUEST_MIGRATION',
          amount,
          refType: 'guest',
          refId: player.id,
          memo: `claimed ${req.body.balance}, capped at ${env().GUEST_MIGRATION_CAP}`,
        });
        if (!written) {
          return reply
            .code(409)
            .send({ error: 'ALREADY_MIGRATED', message: 'Guest progress has already been carried over.' });
        }
      }

      const balance = await refreshBalanceCache(player.id);
      const fresh = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
      return { player: publicPlayer(fresh), balance };
    },
  );
};
