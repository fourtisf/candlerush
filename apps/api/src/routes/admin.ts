import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { adminStatsQuery, adminStatsReply, errorSchema } from '../schemas.js';

/**
 * The numbers nobody was watching.
 *
 * A wall-clock window written for the wrong version of this game once rejected every
 * single submission on this box, and the only way anyone found out was by opening the site
 * and playing a round. Nothing reported it, because nothing was counting.
 *
 * This is that counter. The session funnel and the rejection reasons behind it answer two
 * questions that were previously unanswerable without a psql prompt: is scoring working,
 * and where are players falling out.
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/admin/stats',
    {
      schema: {
        querystring: adminStatsQuery,
        response: { 200: adminStatsReply, 401: errorSchema, 501: errorSchema },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const token = env().ADMIN_TOKEN;
      if (!token) {
        return reply
          .code(501)
          .send({ error: 'NO_ADMIN_TOKEN', message: 'Set ADMIN_TOKEN to enable this endpoint.' });
      }
      if (!constantTimeEqual(bearer(req.headers.authorization), token)) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Bad admin token.' });
      }

      const since = new Date(Date.now() - req.query.hours * 3_600_000);
      const [byStatus, rejects, players, newPlayers, scored, board] = await Promise.all([
        prisma.session.groupBy({ by: ['status'], where: { issuedAt: { gte: since } }, _count: true }),
        prisma.session.findMany({
          where: { status: 'REJECTED', issuedAt: { gte: since } },
          select: { rejectReason: true },
          take: 500,
        }),
        prisma.player.count(),
        prisma.player.count({ where: { createdAt: { gte: since } } }),
        prisma.session.aggregate({
          where: { status: 'SUBMITTED', issuedAt: { gte: since } },
          _avg: { serverScore: true, levelReached: true },
          _max: { serverScore: true, levelReached: true },
        }),
        prisma.dailyClose.findFirst({ orderBy: { day: 'desc' } }),
      ]);

      const count = (s: string) => byStatus.find((row) => row.status === s)?._count ?? 0;
      const started = byStatus.reduce((n, row) => n + row._count, 0);
      const submitted = count('SUBMITTED');
      const rejected = count('REJECTED');

      // Grouped by the code rather than the whole detail string, which carries the elapsed
      // milliseconds and would give every rejection its own bucket of one.
      const reasons: Record<string, number> = {};
      for (const row of rejects) {
        const code = (row.rejectReason ?? 'UNKNOWN').split(':')[0]!.trim();
        reasons[code] = (reasons[code] ?? 0) + 1;
      }

      return {
        hours: req.query.hours,
        players,
        newPlayers,
        sessions: {
          started,
          submitted,
          rejected,
          expired: count('EXPIRED'),
          abandoned: count('ABANDONED'),
          open: count('OPEN'),
        },
        // The single number worth alerting on. It sat at 100% for days and nothing said so.
        rejectRate: started > 0 ? Number((rejected / started).toFixed(4)) : 0,
        completionRate: started > 0 ? Number((submitted / started).toFixed(4)) : 0,
        rejectReasons: Object.entries(reasons)
          .map(([reason, n]) => ({ reason, count: n }))
          .sort((a, b) => b.count - a.count),
        scores: {
          avg: Math.round(scored._avg.serverScore ?? 0),
          max: scored._max.serverScore ?? 0,
          avgLevel: Number((scored._avg.levelReached ?? 0).toFixed(2)),
          maxLevel: scored._max.levelReached ?? 0,
        },
        lastDailyClose: board ? { day: board.day, entrants: board.entrants, paid: board.paid } : null,
      };
    },
  );
};

function bearer(header: string | undefined): string {
  if (!header) return '';
  return header.startsWith('Bearer ') ? header.slice(7) : header;
}

/** Constant time, so the token cannot be recovered a byte at a time from response timing. */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
