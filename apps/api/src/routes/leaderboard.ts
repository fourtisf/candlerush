import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { leaderboardQuery, leaderboardReply } from '../schemas.js';
import { lastPodium, settleYesterday } from '../services/daily.js';
import * as lb from '../services/leaderboard.js';

export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/leaderboard',
    {
      preHandler: app.optionalAuth,
      schema: { querystring: leaderboardQuery, response: { 200: leaderboardReply } },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { window, limit } = req.query;
      // Whoever opens the board first after midnight is what closes yesterday. It cannot
      // throw into this response and it is a single indexed lookup once the day is done.
      await settleYesterday(req.log);
      const entries = await lb.top(window, limit);

      let me: lb.Entry | null = null;
      const player = req.player;
      if (player) {
        const inPage = entries.find((e) => e.playerId === player.id);
        if (inPage) {
          me = inPage;
        } else {
          const r2 = await lb.rankOf(window, player.id);
          if (r2) {
            me = {
              rank: r2.rank,
              playerId: player.id,
              name: player.name,
              score: r2.score,
              charId: player.activeChar,
              mapId: player.activeMap,
            };
          }
        }
      }
      return { window, entries, me, yesterday: await lastPodium() };
    },
  );
};

// Rebuilding a board from the players table is an operator action, not an HTTP endpoint —
// there is no admin role to gate it behind yet. See src/scripts/rebuild-leaderboard.ts.
