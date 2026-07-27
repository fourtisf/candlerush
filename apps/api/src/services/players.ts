import type { Player, Prisma } from '@prisma/client';
import { DEFAULT_CHAR, DEFAULT_MAP, clamp } from '@candle-rush/engine';
import { prisma } from '../db.js';

export function publicPlayer(p: Player) {
  return {
    id: p.id,
    address: p.address,
    name: p.name,
    named: p.named,
    playStreak: p.playStreak,
    bestStreak: p.bestStreak,
    activeChar: p.activeChar,
    activeMap: p.activeMap,
    unlockedChars: p.unlockedChars,
    unlockedMaps: p.unlockedMaps,
    bestSession: p.bestSession,
    totalSessions: p.totalSessions,
    flagged: p.flagged,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * A placeholder, not a name.
 *
 * The column is NOT NULL and a row exists the moment a wallet signs in, so it needs
 * something. `named` stays false until the player picks one for themselves, which is what
 * keeps them out of the leaderboard under a number nobody chose.
 */
function defaultName(address: string): string {
  return `TRADER${address.slice(-4).toUpperCase()}`;
}

export async function findOrCreateByAddress(address: string): Promise<Player> {
  const existing = await prisma.player.findUnique({ where: { address } });
  if (existing) return existing;
  return prisma.player.create({
    data: {
      address,
      name: defaultName(address),
      activeChar: DEFAULT_CHAR,
      activeMap: DEFAULT_MAP,
      unlockedChars: [DEFAULT_CHAR],
      unlockedMaps: [DEFAULT_MAP],
    },
  });
}

/**
 * Adaptive difficulty, ported from `endRun()`. Lives on the server so it is part of the
 * session config the replay is validated against rather than a number the client keeps.
 */
export function nextHandicap(current: number, candlesCleared: number): number {
  if (candlesCleared < 60) return clamp(current + 0.22, 0, 1);
  if (candlesCleared > 170) return clamp(current - 0.3, 0, 1);
  return current;
}

export function owns(player: Player, kind: 'char' | 'map', id: string): boolean {
  return kind === 'char' ? player.unlockedChars.includes(id) : player.unlockedMaps.includes(id);
}

export type PlayerUpdate = Prisma.PlayerUpdateInput;
