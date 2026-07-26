import { prisma } from '../db.js';
import { closeRedis } from '../redis.js';
import { rebuildAllTime } from '../services/leaderboard.js';

/**
 * Rebuild the all-time board from the players table.
 *
 * Redis holds a derived fact, so losing it must never lose a leaderboard. Run:
 *   pnpm --filter @candle-rush/api exec tsx src/scripts/rebuild-leaderboard.ts
 */
const n = await rebuildAllTime();
console.log(`rebuilt lb:alltime from ${n} players`);
await prisma.$disconnect();
await closeRedis();
