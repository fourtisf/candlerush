import { prisma } from '../db.js';
import { k, redis } from '../redis.js';

/**
 * Leaderboards are Redis sorted sets holding player ids and scores, and nothing else.
 * Names are joined at read time so a rename does not require rewriting every board a
 * player appears on.
 */

export type Window = 'daily' | 'weekly' | 'alltime';

/** UTC day, so a board rolls over at the same instant for everyone. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** ISO-8601 week (Monday start), the same numbering the rest of the world uses. */
export function isoWeekKey(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The daily key for a specific day string, so a settled day can be read back by name. */
export const dailyKeyFor = (day: string): string => k('lb', 'daily', day);

export function keysFor(at: Date): Record<Window, string> {
  return {
    daily: k('lb', 'daily', dayKey(at)),
    weekly: k('lb', 'weekly', isoWeekKey(at)),
    alltime: k('lb', 'alltime'),
  };
}

const DAILY_TTL = 60 * 60 * 24 * 8;
const WEEKLY_TTL = 60 * 60 * 24 * 40;

/** Only an improvement registers — ZADD GT, so a bad session cannot lower a best. */
export async function record(playerId: string, score: number, at = new Date()): Promise<void> {
  const keys = keysFor(at);
  const pipe = redis().pipeline();
  pipe.zadd(keys.daily, 'GT', score, playerId);
  pipe.expire(keys.daily, DAILY_TTL);
  pipe.zadd(keys.weekly, 'GT', score, playerId);
  pipe.expire(keys.weekly, WEEKLY_TTL);
  pipe.zadd(keys.alltime, 'GT', score, playerId);
  await pipe.exec();
}

export interface Entry {
  rank: number;
  playerId: string;
  name: string;
  score: number;
  charId: string;
  mapId: string;
}

export async function top(window: Window, limit: number, at = new Date()): Promise<Entry[]> {
  return topForKey(keysFor(at)[window], limit);
}

/** The same read against a key chosen by the caller — used to settle a day by name. */
export async function topForKey(key: string, limit: number): Promise<Entry[]> {
  const raw = await redis().zrevrange(key, 0, limit - 1, 'WITHSCORES');
  const ids: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    ids.push(raw[i]!);
    scores.push(Number(raw[i + 1]));
  }
  if (!ids.length) return [];
  const players = await prisma.player.findMany({
    where: { id: { in: ids }, banned: false },
    select: { id: true, name: true, activeChar: true, activeMap: true },
  });
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: Entry[] = [];
  ids.forEach((id, i) => {
    const p = byId.get(id);
    if (!p) return; // banned or deleted: drop rather than show a ghost
    out.push({
      rank: out.length + 1,
      playerId: id,
      name: p.name,
      score: scores[i]!,
      charId: p.activeChar,
      mapId: p.activeMap,
    });
  });
  return out;
}

export async function rankOf(
  window: Window,
  playerId: string,
  at = new Date(),
): Promise<{ rank: number; score: number } | null> {
  const key = keysFor(at)[window];
  const [rank, score] = await Promise.all([
    redis().zrevrank(key, playerId),
    redis().zscore(key, playerId),
  ]);
  if (rank === null || score === null) return null;
  return { rank: rank + 1, score: Number(score) };
}

/**
 * Rebuild a board from the sessions table. Redis is a cache of a derivable fact, so
 * losing it must never lose a leaderboard — this is the recovery path.
 */
export async function rebuildAllTime(): Promise<number> {
  const players = await prisma.player.findMany({
    where: { bestSession: { gt: 0 }, banned: false },
    select: { id: true, bestSession: true },
  });
  if (!players.length) return 0;
  const pipe = redis().pipeline();
  pipe.del(k('lb', 'alltime'));
  for (const p of players) pipe.zadd(k('lb', 'alltime'), 'GT', p.bestSession, p.id);
  await pipe.exec();
  return players.length;
}
