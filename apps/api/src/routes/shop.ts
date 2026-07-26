import { priceOf } from '@candle-rush/engine';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errorSchema, unlockBody, unlockReply } from '../schemas.js';
import { append, computeBalance, playerRef, refreshBalanceCache, serializable } from '../services/ledger.js';
import { owns, publicPlayer } from '../services/players.js';

export const shopRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Buy a trader or a market.
   *
   * The price comes from the engine's config, which is the same module the client renders
   * from — one source, no drift, and no opportunity to submit a discount. The debit runs
   * at serializable isolation and re-derives the balance from the ledger rows inside the
   * transaction: the Redis cache is for display, never for deciding whether someone can
   * afford something.
   */
  r.post(
    '/shop/unlock',
    {
      preHandler: app.requireAuth,
      schema: { body: unlockBody, response: { 200: unlockReply, 400: errorSchema, 402: errorSchema, 409: errorSchema } },
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const player = req.player!;
      const item = priceOf(req.body.itemId);
      if (!item) {
        return reply.code(400).send({ error: 'NO_SUCH_ITEM', message: 'That is not something you can buy.' });
      }
      if (owns(player, item.kind, req.body.itemId)) {
        return reply.code(409).send({ error: 'ALREADY_OWNED', message: `You already own ${item.name}.` });
      }

      try {
        const updated = await serializable(async (tx) => {
          const balance = await computeBalance(player.id, tx);
          if (balance < item.cost) throw new InsufficientFunds(item.cost - balance);

          const written = await append(tx, {
            playerId: player.id,
            kind: 'UNLOCK_PURCHASE',
            amount: -item.cost,
            refType: 'unlock',
            // Namespaced: the unique index is global, so a bare item id would let the
            // first buyer of the Fox lock every other player out of buying one.
            refId: playerRef(player.id, req.body.itemId),
            memo: item.name,
          });
          if (!written) throw new AlreadyOwned();

          const current = await tx.player.findUniqueOrThrow({ where: { id: player.id } });
          const already =
            item.kind === 'char'
              ? current.unlockedChars.includes(req.body.itemId)
              : current.unlockedMaps.includes(req.body.itemId);
          if (already) throw new AlreadyOwned();

          return tx.player.update({
            where: { id: player.id },
            data:
              item.kind === 'char'
                ? { unlockedChars: { push: req.body.itemId }, activeChar: req.body.itemId }
                : { unlockedMaps: { push: req.body.itemId }, activeMap: req.body.itemId },
          });
        });

        const balance = await refreshBalanceCache(player.id);
        return { player: publicPlayer(updated), balance, spent: item.cost };
      } catch (err) {
        if (err instanceof InsufficientFunds) {
          return reply
            .code(402)
            .send({ error: 'INSUFFICIENT_BALANCE', message: `You need ${err.shortfall} more.` });
        }
        if (err instanceof AlreadyOwned) {
          return reply.code(409).send({ error: 'ALREADY_OWNED', message: `You already own ${item.name}.` });
        }
        throw err;
      }
    },
  );
};

class InsufficientFunds extends Error {
  constructor(readonly shortfall: number) {
    super('insufficient balance');
  }
}

class AlreadyOwned extends Error {
  constructor() {
    super('already owned');
  }
}
