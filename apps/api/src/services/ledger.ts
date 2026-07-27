import type { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { k, redis } from '../redis.js';

/**
 * The ledger.
 *
 * A balance is the sum of an append-only list of signed entries. There is no balance
 * column anywhere and there never will be: the moment one exists, some code path will
 * write to it without a matching entry and the truth becomes unrecoverable.
 *
 * Redis caches the derived number for reads. It is never authoritative for a debit —
 * spending always re-derives from the rows inside a serializable transaction.
 */

const cacheKey = (playerId: string) => k('player', playerId, 'balance');
const CACHE_TTL = 3600;

/** Authoritative balance, straight from the rows. */
export async function computeBalance(
  playerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const agg = await tx.ledgerEntry.aggregate({
    where: { playerId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** Cached balance for display. Falls back to the rows, and repopulates on a miss. */
export async function balanceOf(playerId: string): Promise<number> {
  const key = cacheKey(playerId);
  const hit = await redis().get(key);
  if (hit !== null) {
    const n = Number(hit);
    if (Number.isFinite(n)) return n;
  }
  const fresh = await computeBalance(playerId);
  await redis().set(key, String(fresh), 'EX', CACHE_TTL);
  return fresh;
}

export async function refreshBalanceCache(playerId: string): Promise<number> {
  const fresh = await computeBalance(playerId);
  await redis().set(cacheKey(playerId), String(fresh), 'EX', CACHE_TTL);
  return fresh;
}

export async function invalidateBalance(playerId: string): Promise<void> {
  await redis().del(cacheKey(playerId));
}

export interface EntryInput {
  playerId: string;
  kind: LedgerKind;
  /** Signed: credits positive, purchases negative. */
  amount: number;
  refType: 'session' | 'unlock' | 'admin' | 'guest';
  /**
   * Must be globally unique for its (refType, kind) pair — the database's unique index is
   * global, not per player. Session ids already are; anything keyed by an item id has to
   * be namespaced with the player id, or the first player to buy the Fox locks out
   * everyone else.
   */
  refId: string;
  memo?: string;
}

/** Namespaced reference for entries keyed by something a player can share, like an item id. */
export const playerRef = (playerId: string, itemId: string): string => `${playerId}:${itemId}`;

/**
 * Append one entry. The unique index on (refType, refId, kind) makes a double credit
 * physically impossible rather than merely unlikely, so callers can retry safely.
 * Returns false when the entry already existed.
 */
export async function append(tx: Prisma.TransactionClient, entry: EntryInput): Promise<boolean> {
  try {
    await tx.ledgerEntry.create({
      data: {
        playerId: entry.playerId,
        kind: entry.kind,
        amount: entry.amount,
        refType: entry.refType,
        refId: entry.refId,
        memo: entry.memo ?? null,
      },
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return prismaCode(err) === 'P2002';
}

/** P2034: the transaction lost a serialization race. Expected under contention, not an error. */
export function isWriteConflict(err: unknown): boolean {
  return prismaCode(err) === 'P2034';
}

function prismaCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return (err as { code?: string }).code;
}

/**
 * Run a serializable transaction, retrying when it loses a race.
 *
 * Serializable isolation is how two concurrent purchases are stopped from spending the
 * same balance twice, and the price of it is that one of them gets aborted. That is the
 * database doing its job — retry, re-derive the balance, and let the loser find out it
 * can no longer afford the thing.
 */
export async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err) {
      if (!isWriteConflict(err)) throw err;
      last = err;
    }
  }
  throw last;
}
