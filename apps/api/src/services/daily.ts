import { prisma } from '../db.js';
import { append, invalidateBalance } from './ledger.js';
import * as lb from './leaderboard.js';

/**
 * Closing the daily board.
 *
 * A leaderboard that resets with nothing at stake is a scoreboard nobody opens twice, so
 * the reset has to become an event: yesterday's top three are written down and paid.
 *
 * There is no scheduler. Settlement runs off whoever asks first after midnight, and the
 * primary key on `DailyClose.day` is what makes that safe — two requests racing to settle
 * the same day is a unique violation for one of them, not a double payout. A cron job
 * would need to be running for this to work at all, and the one thing this box has already
 * proved is that nobody notices when something quietly stops running.
 */

/** Prize per place. Sized against the stake tiers so winning covers a few Size runs. */
export const PRIZES = [250_000, 100_000, 50_000] as const;

export const dayKey = lb.dayKey;

/** The UTC day before the one `at` falls in. */
export function previousDay(at = new Date()): string {
  const d = new Date(at.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  return dayKey(d);
}

export interface Settlement {
  day: string;
  entrants: number;
  paid: number;
  results: { rank: number; playerId: string; name: string; score: number; prize: number }[];
}

/**
 * Settle one day if it has not been settled already.
 *
 * Returns null when there was nothing to do, which is the overwhelmingly common case —
 * this is called on ordinary requests, so it has to be cheap when the answer is "already
 * done" and it has to never throw into the caller's response.
 */
export async function settleDay(day: string): Promise<Settlement | null> {
  const done = await prisma.dailyClose.findUnique({ where: { day } });
  if (done) return null;

  // Read the board for that day. The daily key lives for eight days, so yesterday is
  // always still there even if nobody asked for a while.
  const top = await lb.topForKey(lb.dailyKeyFor(day), PRIZES.length);

  let claimed = false;
  try {
    await prisma.dailyClose.create({
      data: {
        day,
        entrants: top.length,
        paid: top.reduce((n, _e, i) => n + (PRIZES[i] ?? 0), 0),
      },
    });
    claimed = true;
  } catch (err) {
    // Somebody else settled it between the check and here. Theirs stands.
    if (isUnique(err)) return null;
    throw err;
  }
  if (!claimed) return null;

  const results: Settlement['results'] = [];
  for (const [i, entry] of top.entries()) {
    const prize = PRIZES[i] ?? 0;
    const rank = i + 1;
    await prisma.dailyResult.create({
      data: {
        day,
        rank,
        playerId: entry.playerId,
        // Snapshotted: renaming yourself must not rewrite who won a day that is over.
        name: entry.name,
        score: entry.score,
        prize,
      },
    });
    if (prize > 0) {
      await append(prisma, {
        playerId: entry.playerId,
        kind: 'DAILY_PRIZE',
        amount: prize,
        refType: 'daily',
        // Unique per day and place, so a re-run cannot pay the same prize twice even if
        // the DailyClose row were somehow removed.
        refId: `${day}:${rank}`,
        memo: `#${rank} on ${day}`,
      });
      await invalidateBalance(entry.playerId);
    }
    results.push({ rank, playerId: entry.playerId, name: entry.name, score: entry.score, prize });
  }

  return { day, entrants: top.length, paid: results.reduce((n, r) => n + r.prize, 0), results };
}

/**
 * Settle yesterday, swallowing anything that goes wrong.
 *
 * Deliberately fire-and-forget: this hangs off ordinary requests, and a failure to pay out
 * a prize must never turn into a failed leaderboard read or a lost session submission.
 */
export async function settleYesterday(log?: { warn: (o: unknown, m: string) => void }): Promise<Settlement | null> {
  try {
    return await settleDay(previousDay());
  } catch (err) {
    log?.warn({ err }, 'daily settlement failed');
    return null;
  }
}

/** Yesterday's podium, for showing on the board and in the hub. */
export async function lastPodium(): Promise<Settlement | null> {
  const close = await prisma.dailyClose.findFirst({
    orderBy: { day: 'desc' },
    include: { results: { orderBy: { rank: 'asc' } } },
  });
  if (!close) return null;
  return {
    day: close.day,
    entrants: close.entrants,
    paid: close.paid,
    results: close.results.map((r) => ({
      rank: r.rank,
      playerId: r.playerId,
      name: r.name,
      score: r.score,
      prize: r.prize,
    })),
  };
}

/**
 * Move a player's daily streak on.
 *
 * Display only. It buys nothing, so there is nothing to farm and nothing lost by being
 * wrong about it — which is why it is computed from a stored day string rather than
 * defended with a transaction.
 */
export function nextStreak(
  lastPlayedOn: string | null,
  current: number,
  today = dayKey(new Date()),
): { playStreak: number; lastPlayedOn: string; changed: boolean } {
  if (lastPlayedOn === today) return { playStreak: current, lastPlayedOn: today, changed: false };
  const yesterday = previousDay(new Date(`${today}T12:00:00Z`));
  const playStreak = lastPlayedOn === yesterday ? current + 1 : 1;
  return { playStreak, lastPlayedOn: today, changed: true };
}

function isUnique(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
}
