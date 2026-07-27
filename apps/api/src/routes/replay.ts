import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../db.js';
import { errorSchema, replayParams, replayReply } from '../schemas.js';

/**
 * Watch a run back.
 *
 * The tape has been stored on every session since the first version, for exactly this.
 * Nothing here is secret — a seed and a list of button presses is what the client already
 * had while playing, and the score attached to it has already been computed by this server
 * from these same inputs. Publishing it is what turns a good run into something a person
 * can send to somebody else, which is the only thing this game currently cannot do.
 *
 * Only settled sessions. An OPEN one would hand out a seed the player is still using, and
 * a REJECTED one is a tape that does not reproduce — showing either would be showing
 * something that is not true.
 */
export const replayRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/replay/:sessionId',
    {
      schema: { params: replayParams, response: { 200: replayReply, 404: errorSchema } },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const session = await prisma.session.findUnique({
        where: { id: req.params.sessionId },
        select: {
          id: true,
          seed: true,
          mapId: true,
          charId: true,
          handicap: true,
          engineVersion: true,
          status: true,
          serverScore: true,
          levelReached: true,
          candles: true,
          bestMult: true,
          endReason: true,
          submittedAt: true,
          replay: true,
          player: { select: { name: true, banned: true } },
        },
      });
      if (!session || session.status !== 'SUBMITTED' || session.player.banned) {
        return reply.code(404).send({ error: 'NO_REPLAY', message: 'No run to watch there.' });
      }

      return {
        sessionId: session.id,
        name: session.player.name,
        config: {
          seed: session.seed,
          mapId: session.mapId,
          charId: session.charId,
          handicap: session.handicap,
          engineVersion: session.engineVersion,
        },
        // The server's own number, from its own replay of these inputs. A viewer that
        // reaches a different one has found a determinism break, which is worth knowing.
        score: session.serverScore ?? 0,
        level: session.levelReached ?? 1,
        candles: session.candles ?? 0,
        bestMult: session.bestMult ?? 1,
        endReason: session.endReason,
        playedAt: (session.submittedAt ?? new Date()).toISOString(),
        inputs: (session.replay ?? []) as [number, number][],
      };
    },
  );
};
