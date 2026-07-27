import type { Session } from '@prisma/client';
import { prisma } from '../db.js';
import { append, invalidateBalance } from './ledger.js';

/**
 * Stakes.
 *
 * A stake is debited when a session is issued and settles exactly one of two ways: it
 * becomes part of a payout when the run is scored, or it comes back. Nothing else is
 * allowed to happen to it, and `stakeSettled` is the flag that makes "nothing else"
 * checkable rather than hoped for.
 *
 * Refunds are deliberately generous. A rejected tape gets its stake back, because a
 * rejection is not always the player's doing — a wall-clock window set for the wrong
 * game once rejected every run on the box, and nobody would have accepted "and it cost
 * them their stake each time" as the answer. There is no exploit in it either: a payout
 * needs a replay that validates, so a rejected run returns the player's own money and
 * nothing more.
 */

/**
 * Return one stake. Idempotent through the ledger's unique reference, so calling it twice
 * is a no-op rather than free money.
 */
export async function refundStake(session: Pick<Session, 'id' | 'playerId' | 'stakeCost'>, why: string): Promise<boolean> {
  if (session.stakeCost <= 0) {
    await prisma.session.updateMany({ where: { id: session.id }, data: { stakeSettled: true } });
    return false;
  }
  const wrote = await prisma.$transaction(async (tx) => {
    const ok = await append(tx, {
      playerId: session.playerId,
      kind: 'SESSION_REFUND',
      amount: session.stakeCost,
      refType: 'session',
      refId: session.id,
      memo: why,
    });
    await tx.session.updateMany({ where: { id: session.id }, data: { stakeSettled: true } });
    return ok;
  });
  if (wrote) await invalidateBalance(session.playerId);
  return wrote;
}

/**
 * Sweep stakes belonging to sessions that will never be scored.
 *
 * Called opportunistically rather than on a timer: whatever expires a session is also what
 * notices the stake is stranded. Bounded so one caller can never turn into a long
 * transaction, and safe to run repeatedly because each refund is idempotent.
 */
export async function refundStranded(playerId: string, limit = 20): Promise<number> {
  const stranded = await prisma.session.findMany({
    where: {
      playerId,
      stakeSettled: false,
      stakeCost: { gt: 0 },
      status: { in: ['EXPIRED', 'ABANDONED', 'REJECTED'] },
    },
    select: { id: true, playerId: true, stakeCost: true, status: true },
    take: limit,
  });
  let refunded = 0;
  for (const s of stranded) {
    if (await refundStake(s, `stake returned — session ${s.status.toLowerCase()}`)) refunded++;
  }
  return refunded;
}
